// Storage is not covered by database cascades. Only run after a complete test
// has been published; final cropped question images must survive cleanup.
type Client = { from(table: string): any; rpc(name: string, args: Record<string, unknown>): any; storage: { from(bucket: string): any } };
type Row = Record<string, any>;
export type ImportStorageCleanup = {
  status: "complete" | "pending" | "awaiting_publication";
  deleted_images: number;
  retained_images: number;
  deleted_pdfs: number;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function check(result: { error?: { message: string } | null }, operation: string): void {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
}

async function all(query: () => any): Promise<Row[]> {
  const out: Row[] = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await query().order("id").range(offset, offset + 999);
    check(result, "read image references");
    out.push(...result.data);
    if (result.data.length < 1000) return out;
  }
}

function importPrefix(path: unknown): string | null {
  if (typeof path !== "string" || path.includes("\\") || path.split("/").some((s) => s === ".." || s === "." || !s)) return null;
  const parts = path.split("/");
  return parts[0] === "imports" && uuid.test(parts[1] ?? "") && parts.length > 2 ? `imports/${parts[1]}` : null;
}

async function listImages(client: Client, prefix: string): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await client.storage.from("question-assets").list(prefix, {
      limit: 1000, offset, sortBy: { column: "name", order: "asc" },
    });
    check(result, "list import images");
    for (const object of result.data) {
      if (!object.name || object.name.includes("/") || object.name.includes("\\") || [".", ".."].includes(object.name)) throw new Error("Invalid storage object name");
      const path = `${prefix}/${object.name}`;
      if (object.id == null) paths.push(...await listImages(client, path));
      else paths.push(path);
    }
    if (result.data.length < 1000) return paths;
  }
}

export async function cleanupImportedTestStorage(client: Client, importId: string): Promise<ImportStorageCleanup> {
  if (!uuid.test(importId)) throw new Error("Invalid import ID");
  const loaded = await client.from("pdf_imports").select("id,status,storage_path,generated_test_id,text_quality").eq("id", importId).single();
  check(loaded, "load generated import");
  const imp = loaded.data;
  if (imp.status !== "completed") throw new Error("Storage cleanup requires a completed import");
  const state = await client.rpc("published_import_cleanup_state", { p_import_id: importId });
  check(state, "check publication status");
  const quality = imp.text_quality ?? {};
  const savedPrefixes = quality.storage_cleanup?.prefixes ?? [];
  const mark = async (details: Row) => {
    const result = await client.from("pdf_imports").update({ text_quality: { ...quality, storage_cleanup: details } }).eq("id", importId);
    check(result, "record storage cleanup");
  };
  if (!state.data?.eligible) {
    await mark({ status: "awaiting_publication", prefixes: savedPrefixes, policy_version: 2 });
    return { status: "awaiting_publication", deleted_images: 0, retained_images: 0, deleted_pdfs: 0 };
  }
  await mark({ status: "pending", prefixes: savedPrefixes, policy_version: 2 });
  const jobs = await client.from("ai_ingestion_review_jobs").select("id").eq("pdf_import_id", importId).in("status", ["queued", "running"]).limit(1);
  check(jobs, "check active review jobs");
  if (jobs.data.length) throw new Error("Review is still running");
  const drafts = await all(() => client.from("draft_questions").select("id,question_id,stimulus_image_path,stimulus_source_image_path,review_source_image_path").eq("pdf_import_id", importId));

  // Refinement moves drafts between imports without moving their files. Only
  // extend cleanup to a former directory when a current draft points into it
  // and that directory's import no longer exists. Global references below
  // still protect files used by other imports and published questions.
  const prefixes = new Set([`imports/${importId}`]);
  for (const prefix of savedPrefixes) {
    if (typeof prefix !== "string" || importPrefix(`${prefix}/saved`) !== prefix) throw new Error("Invalid saved cleanup prefix");
    if (prefix === `imports/${importId}`) continue;
    const owner = await client.from("pdf_imports").select("id").eq("id", prefix.split("/")[1]).maybeSingle();
    check(owner, "check saved directory owner");
    if (!owner.data) prefixes.add(prefix);
  }
  for (const draft of drafts) {
    for (const field of ["stimulus_image_path", "stimulus_source_image_path", "review_source_image_path"]) {
      const prefix = importPrefix(draft[field]);
      if (!prefix || prefixes.has(prefix)) continue;
      const owner = await client.from("pdf_imports").select("id").eq("id", prefix.split("/")[1]).maybeSingle();
      check(owner, "check image directory owner");
      if (!owner.data) prefixes.add(prefix);
    }
  }
  const candidates = [...new Set((await Promise.all([...prefixes].map((p) => listImages(client, p)))).flat())];
  // Persist provenance before releasing references, so a failed deletion can
  // retry the same former refinement directories on the next worker poll.
  await mark({ status: "pending", prefixes: [...prefixes], policy_version: 2 });

  // Keep the final active image for both the test and its editable draft.
  // Source-page/review evidence is temporary once questions are published.
  const released = await client.rpc("release_import_source_images", { p_import_id: importId });
  check(released, "release temporary image references");
  const references = new Set<string>();
  for (const [table, columns] of [
    ["questions", "id,stimulus_image_path"],
    ["draft_questions", "id,stimulus_image_path,stimulus_source_image_path,review_source_image_path"],
  ]) {
    for (const row of await all(() => client.from(table!).select(columns!))) {
      for (const field of ["stimulus_image_path", "stimulus_source_image_path", "review_source_image_path"]) {
        if (row[field]) references.add(row[field]);
      }
    }
  }
  const unused = candidates.filter((path) => !references.has(path));
  let deletedImages = 0;
  for (let offset = 0; offset < unused.length; offset += 100) {
    const result = await client.storage.from("question-assets").remove(unused.slice(offset, offset + 100));
    check(result, "delete temporary images");
    deletedImages += result.data?.length ?? 0;
  }
  let deletedPdfs = 0;
  if (imp.storage_path && state.data.whole_import) {
    // A shared source PDF must remain available to any other import.
    const shared = await client.from("pdf_imports").select("id").eq("storage_path", imp.storage_path).neq("id", importId).limit(1);
    check(shared, "check shared PDF references");
    if (!shared.data.length) {
      const result = await client.storage.from("pdf-imports").remove([imp.storage_path]);
      check(result, "delete imported PDF");
      deletedPdfs = result.data?.length ?? 0;
      const detached = await client.from("pdf_imports").update({ storage_path: null }).eq("id", importId).eq("storage_path", imp.storage_path);
      check(detached, "detach deleted original PDF");
    }
  }
  const result: ImportStorageCleanup = { status: "complete", deleted_images: deletedImages, retained_images: candidates.length - unused.length, deleted_pdfs: deletedPdfs };
  await mark({ ...result, policy_version: 2, prefixes: [...prefixes], completed_at: new Date().toISOString() });
  return result;
}

export async function retryPendingImportStorageCleanup(client: Client): Promise<void> {
  const pending = await client.from("pdf_imports").select("id")
    .eq("text_quality->storage_cleanup->>status", "pending").order("updated_at").limit(1);
  check(pending, "load pending storage cleanup");
  if (pending.data[0]) await tryCleanupImportedTestStorage(client, pending.data[0].id);
}

// Publication is committed before cleanup. Storage failures keep a durable
// pending marker and must never roll back or delete the published test.
export async function tryCleanupImportedTestStorage(client: Client, importId: string): Promise<ImportStorageCleanup> {
  try {
    return await cleanupImportedTestStorage(client, importId);
  } catch (error) {
    console.error(`[import-storage] cleanup pending for ${importId}`, error);
    return { status: "pending", deleted_images: 0, retained_images: 0, deleted_pdfs: 0 };
  }
}


export async function tryCleanupPublishedTestStorage(client: Client, testId: string): Promise<ImportStorageCleanup[]> {
  const imports = await client.rpc("published_image_imports", { p_test_id: testId });
  if (imports.error) { console.error(`[import-storage] publication cleanup lookup failed: ${imports.error.message}`); return []; }
  const results: ImportStorageCleanup[] = [];
  for (const row of imports.data ?? []) results.push(await tryCleanupImportedTestStorage(client, row.import_id));
  return results;
}
