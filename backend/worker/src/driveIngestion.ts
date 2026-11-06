import { createHash } from "node:crypto";
import type { ExistingTestSource } from "./testIdentity";

export const STAGING_URL = "https://wgkggknyndgaoyazdhdf.supabase.co";
export const PRODUCTION_URL = "https://ygqndcgpbtmewzkruyuq.supabase.co";
export type DriveTarget = "staging" | "production";
export const DRIVE_TARGET_URLS = { staging: STAGING_URL, production: PRODUCTION_URL } as const;
export const DEFAULT_DRIVE_FOLDER = "1xw4T-5X0cOCe-Jr-9lqv7C8zFw6byFYU";
export const PRIORITY_FOLDERS = ["2026 10", "2026 09"];
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

export interface DrivePdf {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  sha256Checksum?: string;
  md5Checksum?: string;
  folders: string[];
}
export interface DriveEntry {
  file: DrivePdf;
  status: "baseline" | "pending" | "imported" | "failed" | "duplicate" | "ignored" | "needs_review";
  importId?: string;
  sha256?: string;
  error?: string;
  existingMatches?: ExistingTestSource[];
}
export interface DriveState {
  schemaVersion: 1;
  rootFolderId: string;
  supabaseUrl: string;
  initializedAt: string | null;
  entries: Record<string, DriveEntry>;
}

export function assertStaging(url: string): void {
  if (url !== STAGING_URL) throw new Error(`Drive ingestion requires staging project wgkggknyndgaoyazdhdf (${STAGING_URL})`);
}
export function assertDriveTarget(url: string, target: DriveTarget = "staging"): void {
  if (!Object.hasOwn(DRIVE_TARGET_URLS, target) || url !== DRIVE_TARGET_URLS[target]) throw new Error(`Drive ingestion URL does not match the explicitly selected ${target} project`);
}
export function assertDriveId(id: string): string {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) throw new Error("Invalid Drive file or folder ID");
  return id;
}
export function parseFolderId(value: string): string {
  if (!value.startsWith("https://")) return assertDriveId(value);
  const url = new URL(value);
  if (url.hostname !== "drive.google.com" || url.port || url.username || url.password) throw new Error("Expected a Google Drive folder URL");
  const match = url.pathname.match(/^\/drive\/folders\/([A-Za-z0-9_-]+)\/?$/);
  if (!match) throw new Error("Expected a Google Drive folder URL");
  return assertDriveId(match[1]!);
}
export function newDriveState(rootFolderId: string, target: DriveTarget = "staging"): DriveState {
  return { schemaVersion: 1, rootFolderId: assertDriveId(rootFolderId), supabaseUrl: DRIVE_TARGET_URLS[target], initializedAt: null, entries: {} };
}
export function validateDriveState(value: unknown, rootFolderId: string, target: DriveTarget = "staging"): DriveState {
  const state = value as DriveState;
  if (!state || state.schemaVersion !== 1 || state.rootFolderId !== rootFolderId || state.supabaseUrl !== DRIVE_TARGET_URLS[target] || !state.entries || typeof state.entries !== "object" || Array.isArray(state.entries)) {
    throw new Error("Invalid Drive state or project/folder mismatch; refusing to reset the baseline");
  }
  for (const [id, entry] of Object.entries(state.entries)) {
    assertDriveId(id);
    if (!entry || entry.file?.id !== id || !Array.isArray(entry.file.folders) || !["baseline", "pending", "imported", "failed", "duplicate", "ignored", "needs_review"].includes(entry.status)) throw new Error("Invalid Drive state entry");
  }
  return state;
}
export function isQuestionBank(file: DrivePdf): boolean {
  return /question[ _-]*bank/i.test([...file.folders, file.name].join("/"));
}
export function compareDriveFiles(a: DrivePdf, b: DrivePdf): number {
  const rank = (f: DrivePdf) => { const i = PRIORITY_FOLDERS.findIndex(p => f.folders.includes(p)); return i < 0 ? PRIORITY_FOLDERS.length : i; };
  return rank(a) - rank(b) || b.folders.join("/").localeCompare(a.folders.join("/")) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/** Call only after a complete, successful recursive inventory. No modified-time cutoff:
 * moving an old file/folder into the watched tree must still count as an addition. */
export function discoverDriveFiles(state: DriveState, files: DrivePdf[], now = new Date().toISOString()): void {
  const first = !state.initializedAt;
  for (const file of files) {
    assertDriveId(file.id);
    if (Object.hasOwn(state.entries, file.id) || file.mimeType !== "application/pdf") continue;
    const priority = file.folders.some(folder => PRIORITY_FOLDERS.includes(folder));
    state.entries[file.id] = { file, status: isQuestionBank(file) ? "ignored" : first && !priority ? "baseline" : "pending" };
  }
  state.initializedAt ??= now;
}

export function driveImportId(root: string, id: string): string {
  assertDriveId(root); assertDriveId(id);
  const bytes = createHash("sha256").update(`sat-drive-v1:${root}:${id}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function validatePdf(bytes: Buffer, expectedSize?: string): void {
  if (!bytes.length || bytes.length > MAX_PDF_BYTES) throw new Error("PDF exceeds the 50 MiB limit or is empty");
  if (expectedSize !== undefined && bytes.length !== Number(expectedSize)) throw new Error("Drive file changed during download (size mismatch); rescan required");
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Downloaded file is not a PDF");
}

export interface DriveQueueDeps {
  preflight?(file: DrivePdf, importId: string): Promise<{ decision: "new" | "duplicate" | "review"; matches: ExistingTestSource[] }>;
  download(file: DrivePdf): Promise<Buffer>;
  ingest(file: DrivePdf, bytes: Buffer, importId: string): Promise<{ status: "imported" | "failed" | "pending"; error?: string; halt?: boolean }>;
  save(state: DriveState): Promise<void>;
  log(message: string): void;
}

/** Failures are recorded and require an explicit retry; never repeatedly spend OCR quota. */
export async function drainDriveQueue(state: DriveState, deps: DriveQueueDeps): Promise<boolean> {
  const queue = Object.values(state.entries).filter(e => e.status === "pending").sort((a, b) => compareDriveFiles(a.file, b.file));
  for (const entry of queue) {
    let halt = false;
    entry.importId ??= driveImportId(state.rootFolderId, entry.file.id);
    await deps.save(state);
    deps.log(`Importing ${[...entry.file.folders, entry.file.name].join("/")} (${entry.importId})`);
    try {
      const bytes = await deps.download(entry.file);
      validatePdf(bytes, entry.file.size);
      entry.sha256 = createHash("sha256").update(bytes).digest("hex");
      const check = await deps.preflight?.(entry.file, entry.importId);
      if (check && check.decision !== "new") {
        entry.status = check.decision === "duplicate" ? "duplicate" : "needs_review";
        entry.existingMatches = check.matches;
        entry.error = check.decision === "review" ? "Source identity is ambiguous or an earlier attempt exists; compare the recorded matches before importing." : undefined;
        await deps.save(state);
        deps.log(`${entry.file.name}: ${entry.status}; existing matches: ${check.matches.map(m => `${m.kind}:${m.id} ${m.label}`).join("; ") || "unrecognized test identity"}`);
        continue;
      }
      const previous = Object.values(state.entries).find(e => e !== entry && e.status === "imported" && e.sha256 === entry.sha256);
      if (previous) {
        entry.status = "duplicate";
        entry.importId = previous.importId;
      } else {
        const result = await deps.ingest(entry.file, bytes, entry.importId);
        entry.status = result.status;
        entry.error = result.error;
        halt = result.halt ?? false;
      }
    } catch {
      // Provider error bodies can contain bearer URLs or credentials. Keep them out of state/logs.
      entry.status = "failed";
      entry.error = "Download or ingestion failed; check provider connectivity and worker logs before --retry-failed.";
    }
    await deps.save(state);
    deps.log(`${entry.file.name}: ${entry.status}${entry.error ? ` (${entry.error})` : ""}`);
    if (halt) {
      deps.log("Stopping this scan because the OCR provider has no available quota; remaining files stay pending.");
      return true;
    }
  }
  return false;
}
