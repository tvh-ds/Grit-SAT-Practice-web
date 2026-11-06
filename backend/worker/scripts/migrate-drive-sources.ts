import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../src/config";
import { createSupabase } from "../src/supabase";
import { assertDriveTarget, type DriveTarget } from "../src/driveIngestion";
import { driveInventory, driveSource, importPdf, registerSource, sha256 } from "../src/sourceDocuments";
import { renderPagePng } from "../src/renderPage";
import { cleanupImportedTestStorage } from "../../supabase/functions/_shared/importStorageCleanup";

const target = process.argv.includes("--production") ? "production" : "staging";
const apply = process.argv.includes("--apply");
const config = loadConfig();
assertDriveTarget(config.supabaseUrl, target as DriveTarget);
const client = createSupabase(config);
const reportPath = path.resolve(process.cwd(), `../../tmp/drive-source-migration-${target}.json`);
const report: any = { target, project: config.supabaseUrl, apply, started_at: new Date().toISOString(), imports: [], deleted: [] };
const save = async () => { await fs.mkdir(path.dirname(reportPath), { recursive: true }); await fs.writeFile(reportPath, JSON.stringify(report, null, 2)); };
async function all(table: string, columns = "*") {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.from(table).select(columns).order("id").range(offset, offset + 999);
    if (error) throw error;
    rows.push(...data); if (data.length < 1000) return rows;
  }
}
async function list(bucket: string, prefix = ""): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    for (const item of data) {
      const name = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id == null) rows.push(...await list(bucket, name)); else rows.push({ ...item, name });
    }
    if (data.length < 1000) return rows;
  }
}
async function main() {
  // Preflight Drive before making any database or Storage changes.
  const files = await driveInventory();
  const imports = await all("pdf_imports");
  const drafts = await all("draft_questions");
  const candidates = new Map<string, string>();
  for (const file of files) {
    // Compare content rather than trusting names. Reads do not change Drive.
    const bytes = await driveSource().download(file);
    candidates.set(sha256(bytes), file.id);
  }
  for (const imp of imports) {
    const entry: any = { id: imp.id, filename: imp.original_filename };
    report.imports.push(entry);
    try {
      const state = await client.rpc("published_import_cleanup_state", { p_import_id: imp.id });
      if (state.error) throw state.error;
      if (state.data?.whole_import) {
        entry.state = "published_final_only";
        if (apply) entry.cleanup = await cleanupImportedTestStorage(client, imp.id);
        continue;
      }
      const ownedDrafts = drafts.filter(d => d.pdf_import_id === imp.id);
      if (!ownedDrafts.length && !imp.storage_path) { entry.state = "no_source_files"; continue; }
      const bytes = await importPdf(client, imp);
      const fileId = candidates.get(sha256(bytes));
      if (!fileId) {
        entry.state = "needs_original";
        entry.draft_ids = ownedDrafts.filter(d => !d.question_id).map(d => d.id);
        if (apply) {
          const result = await client.from("pdf_imports").update({ source_state: "needs_original" }).eq("id", imp.id);
          if (result.error) throw result.error;
        }
        continue;
      }
      const file = files.find(f => f.id === fileId)!;
      for (const page of new Set<number>(ownedDrafts.map(d => d.page_number).filter(n => Number.isInteger(n) && n > 0))) await renderPagePng(bytes, page, 3);
      entry.state = "verified"; entry.drive_file_id = fileId; entry.sha256 = sha256(bytes);
      if (apply) {
        const source = await registerSource(client, file, bytes);
        const result = await client.rpc("bind_import_drive_source", { p_import_id: imp.id, p_source_id: source.id });
        if (result.error) throw result.error;
      }
    } catch (e) { entry.state = "retained_exception"; entry.error = e instanceof Error ? e.message : "Source migration failed"; }
    finally { await save(); }
  }

  // Re-read every live reference after binding. Delete only from verified import
  // directories, never from unmatched or unrelated paths. Publication cleanup
  // handles published directories with its own shared-reference safeguards.
  const currentDrafts = await all("draft_questions");
  const questions = await all("questions", "id,stimulus_image_path");
  const refs = new Set<string>();
  for (const row of [...currentDrafts, ...questions]) for (const field of ["stimulus_image_path", "stimulus_source_image_path", "review_source_image_path"]) if (row[field]) refs.add(row[field]);
  const verified = new Set(report.imports.filter((e: any) => e.state === "verified").map((e: any) => e.id));
  const imageCandidates = (await list("question-assets", "imports")).filter(o => verified.has(o.name.split("/")[1]) && !refs.has(o.name));
  report.removable_image_bytes = imageCandidates.reduce((n, o) => n + Number(o.metadata?.size ?? 0), 0);
  for (const object of imageCandidates) {
    report.deleted.push({ bucket: "question-assets", path: object.name, bytes: object.metadata?.size ?? 0, applied: false });
    if (apply) {
      // Fail closed if a draft or question acquired a reference since the scan.
      const live = await Promise.all([
        client.from("questions").select("id").eq("stimulus_image_path", object.name).limit(1),
        client.from("draft_questions").select("id").or(`stimulus_image_path.eq.${object.name},stimulus_source_image_path.eq.${object.name},review_source_image_path.eq.${object.name}`).limit(1),
      ]);
      if (live.some(r => r.error || r.data?.length)) continue;
      const result = await client.storage.from("question-assets").remove([object.name]);
      if (result.error) throw result.error;
      report.deleted.at(-1).applied = true;
    }
  }
  // PDFs for verified unfinished imports are now reproducible from Drive.
  for (const imp of imports.filter(i => verified.has(i.id) && i.storage_path)) {
    const shared = imports.some(i => i.id !== imp.id && i.storage_path === imp.storage_path && !verified.has(i.id));
    if (shared) continue;
    report.deleted.push({ bucket: "pdf-imports", path: imp.storage_path, applied: false });
    if (apply) {
      const result = await client.storage.from("pdf-imports").remove([imp.storage_path]);
      if (result.error) throw result.error;
      const update = await client.from("pdf_imports").update({ storage_path: null }).eq("storage_path", imp.storage_path).in("id", [...verified]);
      if (update.error) throw update.error;
      report.deleted.at(-1).applied = true;
    }
  }
  report.finished_at = new Date().toISOString(); await save();
  console.log(`Report saved: ${reportPath}`);
  console.log(JSON.stringify({ imports: report.imports.length, needs_original: report.imports.filter((e: any) => e.state === "needs_original").length, apply }));
}
main().catch(async e => { report.error = e instanceof Error ? e.message : "Migration failed"; await save(); console.error(report.error); process.exitCode = 1; });
