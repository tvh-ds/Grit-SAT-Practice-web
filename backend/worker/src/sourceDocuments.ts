import { createHash } from "node:crypto";
import { GoogleDriveSource } from "./driveSource";
import { DEFAULT_DRIVE_FOLDER, validatePdf, type DrivePdf } from "./driveIngestion";
import { renderPagePng } from "./renderPage";

const TTL = 15 * 60_000;
const MAX_CACHE = 512 * 1024 * 1024;
type Entry = { bytes: Buffer; expires: number };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Buffer>>();
let cacheBytes = 0;
export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function cached(key: string, get: () => Promise<Buffer>): Promise<Buffer> {
  for (const [k, entry] of cache) if (entry.expires <= Date.now()) { cache.delete(k); cacheBytes -= entry.bytes.length; }
  const hit = cache.get(key);
  if (hit) return hit.bytes;
  if (inflight.has(key)) return inflight.get(key)!;
  const pending = get().then(bytes => {
    while (cacheBytes + bytes.length > MAX_CACHE && cache.size) {
      const first = cache.keys().next().value!;
      cacheBytes -= cache.get(first)!.bytes.length; cache.delete(first);
    }
    if (bytes.length <= MAX_CACHE) { cache.set(key, { bytes, expires: Date.now() + TTL }); cacheBytes += bytes.length; }
    return bytes;
  }).finally(() => inflight.delete(key));
  inflight.set(key, pending);
  return pending;
}

/** Credentials belong to the worker, never to the browser or a chat session. */
export function driveSource(): GoogleDriveSource {
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyFile) throw new Error("Drive access is not configured on the processing worker");
  return new GoogleDriveSource(keyFile);
}

export async function driveInventory(): Promise<DrivePdf[]> {
  return driveSource().inventory(process.env.GOOGLE_DRIVE_FOLDER_ID || DEFAULT_DRIVE_FOLDER);
}

export async function registerSource(client: any, file: DrivePdf, bytes: Buffer) {
  validatePdf(bytes, file.size);
  const row = {
    drive_file_id: file.id, sha256: sha256(bytes), original_filename: file.name,
    file_size: bytes.length, drive_modified_time: file.modifiedTime ?? null,
  };
  const { data, error } = await client.from("source_documents")
    .upsert(row, { onConflict: "drive_file_id,sha256" }).select("*").single();
  if (error) throw new Error(`Register PDF source: ${error.message}`);
  return data;
}

export async function sourcePdf(client: any, sourceId: string): Promise<Buffer> {
  const { data, error } = await client.from("source_documents").select("*").eq("id", sourceId).single();
  if (error || !data) throw new Error("Original PDF reference is unavailable");
  return cached(`pdf:${sourceId}:${data.sha256}`, async () => {
    const bytes = await driveSource().download({ id: data.drive_file_id, name: data.original_filename, mimeType: "application/pdf", size: String(data.file_size), folders: [] });
    validatePdf(bytes, String(data.file_size));
    if (sha256(bytes) !== data.sha256) throw new Error("The original Drive PDF changed; source verification is required");
    return bytes;
  });
}

export async function importPdf(client: any, imp: any): Promise<Buffer> {
  if (imp.source_document_id) return sourcePdf(client, imp.source_document_id);
  if (!imp.storage_path) throw new Error("Needs original PDF: select the original file in Drive");
  const { data, error } = await client.storage.from("pdf-imports").download(imp.storage_path);
  if (error || !data) throw new Error("Original PDF is unavailable");
  return Buffer.from(await data.arrayBuffer());
}

let rendering = 0;
const waiting: Array<() => void> = [];
async function renderBounded(pdf: Buffer, page: number): Promise<Buffer> {
  if (rendering >= 2) {
    if (waiting.length >= 10) throw new Error("Source renderer is busy; retry shortly");
    await new Promise<void>(resolve => waiting.push(resolve));
  }
  rendering++;
  try { return await renderPagePng(pdf, page, 3); }
  finally { rendering--; waiting.shift()?.(); }
}

export async function draftSourcePage(client: any, draft: any): Promise<Buffer> {
  const page = draft.source_page_number ?? draft.page_number;
  if (!Number.isInteger(page) || page < 1) throw new Error("This draft has no original PDF page");
  if (draft.source_document_id) {
    const pdf = await sourcePdf(client, draft.source_document_id);
    return cached(`page:${draft.source_document_id}:${page}:scale3:v1`, () => renderBounded(pdf, page));
  }
  const path = draft.stimulus_source_image_path ?? draft.review_source_image_path;
  if (path) {
    const { data, error } = await client.storage.from("question-assets").download(path);
    if (error || !data) throw new Error("Legacy source image is unavailable");
    return Buffer.from(await data.arrayBuffer());
  }
  if (draft.pdf_import_id) {
    const { data: imp, error } = await client.from("pdf_imports").select("storage_path,source_document_id").eq("id", draft.pdf_import_id).single();
    if (!error && imp && (imp.source_document_id || imp.storage_path)) return renderBounded(await importPdf(client, imp), page);
  }
  throw new Error("Needs original PDF: no verified source page is available");
}
