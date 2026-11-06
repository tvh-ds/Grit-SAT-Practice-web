import { describe, expect, it, vi } from "vitest";
import { assertStaging, assertDriveTarget, PRODUCTION_URL, STAGING_URL, compareDriveFiles, DEFAULT_DRIVE_FOLDER, discoverDriveFiles, drainDriveQueue, driveImportId, newDriveState, parseFolderId, validateDriveState, validatePdf, type DrivePdf } from "../src/driveIngestion";

const pdf = (id: string, folder: string, name = `${id}.pdf`): DrivePdf => ({ id, name, mimeType: "application/pdf", folders: [folder] });
const oct = pdf("october-file-001", "2026 10");
const sep = pdf("september-file-001", "2026 09");

describe("Drive ingestion", () => {
  it("refuses production, localhost, and deceptive URL inputs", () => {
    for (const url of ["https://ygqndcgpbtmewzkruyuq.supabase.co", "http://localhost:54321", "https://wgkggknyndgaoyazdhdf.supabase.co.attacker.test"]) expect(() => assertStaging(url)).toThrow("staging");
    expect(parseFolderId(`https://drive.google.com/drive/folders/${DEFAULT_DRIVE_FOLDER}`)).toBe(DEFAULT_DRIVE_FOLDER);
    for (const value of ["../../danger", "https://drive.google.com.attacker.test/drive/folders/1234567890", "https://user@drive.google.com/drive/folders/1234567890"]) expect(() => parseFolderId(value)).toThrow();
  });

  it("queues October then September, baselines older tests, and excludes question banks", () => {
    const state = newDriveState(DEFAULT_DRIVE_FOLDER);
    const older = pdf("older-file-0001", "2026 08");
    const bank = pdf("bank-file-00001", "2026 10", "SAT Question Bank.pdf");
    discoverDriveFiles(state, [older, sep, oct, bank]);
    expect(state.entries[older.id]!.status).toBe("baseline");
    expect(state.entries[bank.id]!.status).toBe("ignored");
    expect(Object.values(state.entries).filter(e => e.status === "pending").map(e => e.file).sort(compareDriveFiles).map(f => f.id)).toEqual([oct.id, sep.id]);
  });

  it("finds newly moved old files and files in new subfolders without reimporting known IDs", () => {
    const state = newDriveState(DEFAULT_DRIVE_FOLDER);
    discoverDriveFiles(state, [oct]);
    state.entries[oct.id]!.status = "imported";
    const moved = { ...pdf("moved-old-00001", "2024 05"), modifiedTime: "2024-01-01T00:00:00Z", folders: ["new folder", "nested"] };
    discoverDriveFiles(state, [oct, moved]);
    expect(state.entries[oct.id]!.status).toBe("imported");
    expect(state.entries[moved.id]!.status).toBe("pending");
  });

  it("rejects state from another folder or environment rather than losing the baseline", () => {
    const state = newDriveState(DEFAULT_DRIVE_FOLDER);
    expect(() => validateDriveState(state, "another-folder-001")).toThrow("mismatch");
    expect(() => validateDriveState({ ...state, supabaseUrl: "production" }, DEFAULT_DRIVE_FOLDER)).toThrow();
  });

  it("requires an explicit production target and isolates staging/production state", () => {
    expect(() => assertDriveTarget(PRODUCTION_URL)).toThrow();
    expect(() => assertDriveTarget(PRODUCTION_URL, "production")).not.toThrow();
    expect(() => assertDriveTarget(STAGING_URL, "production")).toThrow();
    const state = newDriveState(DEFAULT_DRIVE_FOLDER, "production");
    expect(state.supabaseUrl).toBe(PRODUCTION_URL);
    expect(() => validateDriveState(state, DEFAULT_DRIVE_FOLDER)).toThrow();
    expect(validateDriveState(state, DEFAULT_DRIVE_FOLDER, "production")).toBe(state);
  });

  it("uses stable UUIDs across restarts and different ones for separate files", () => {
    const id = driveImportId(DEFAULT_DRIVE_FOLDER, oct.id);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(driveImportId(DEFAULT_DRIVE_FOLDER, oct.id)).toBe(id);
    expect(driveImportId(DEFAULT_DRIVE_FOLDER, sep.id)).not.toBe(id);
  });

  it("rejects HTML downloads and incomplete or oversized PDFs", () => {
    expect(() => validatePdf(Buffer.from("<html>"))).toThrow("not a PDF");
    expect(() => validatePdf(Buffer.from("%PDF-1.7"), "100")).toThrow("size mismatch");
    expect(() => validatePdf(Buffer.alloc(50 * 1024 * 1024 + 1))).toThrow("limit");
  });

  it("persists each result, avoids identical PDF imports, and does not repeat finished work", async () => {
    const state = newDriveState(DEFAULT_DRIVE_FOLDER);
    discoverDriveFiles(state, [sep, oct]);
    const deps = { download: vi.fn(async () => Buffer.from("%PDF-1.7 content")), ingest: vi.fn(async (_file: DrivePdf, _bytes: Buffer, _id: string) => ({ status: "imported" as const })), save: vi.fn(async () => {}), log: vi.fn() };
    await drainDriveQueue(state, deps);
    expect(deps.ingest).toHaveBeenCalledTimes(1);
    expect(deps.ingest.mock.calls[0]![0].id).toBe(oct.id);
    expect(state.entries[sep.id]!.status).toBe("duplicate");
    expect(deps.save).toHaveBeenCalledTimes(4);
    await drainDriveQueue(state, deps);
    expect(deps.download).toHaveBeenCalledTimes(2);
  });

  it("records failure without leaking provider tokens, continues the queue, and waits for explicit retry", async () => {
    const state = newDriveState(DEFAULT_DRIVE_FOLDER);
    discoverDriveFiles(state, [sep, oct]);
    const deps = { download: vi.fn(async (file: DrivePdf) => { if (file.id === oct.id) throw new Error("secret-access-token"); return Buffer.from("%PDF-1.7"); }), ingest: vi.fn(async () => ({ status: "imported" as const })), save: vi.fn(async () => {}), log: vi.fn() };
    await drainDriveQueue(state, deps);
    expect(state.entries[oct.id]!.status).toBe("failed");
    expect(state.entries[sep.id]!.status).toBe("imported");
    expect(JSON.stringify(state)).not.toContain("secret-access-token");
    await drainDriveQueue(state, deps);
    expect(deps.download).toHaveBeenCalledTimes(2);
  });

  it("downloads first, checks renamed existing tests, and skips OCR on duplicates", async () => {
    const state = newDriveState(DEFAULT_DRIVE_FOLDER);
    discoverDriveFiles(state, [oct]);
    const deps = { preflight: vi.fn(async () => ({ decision: "duplicate" as const, matches: [{ id: "test-id", kind: "test" as const, label: "October 2026 Int 1", status: "published" }] })), download: vi.fn(async () => Buffer.from("%PDF-1.7")), ingest: vi.fn(async () => ({ status: "imported" as const })), save: vi.fn(async () => {}), log: vi.fn() };
    await drainDriveQueue(state, deps);
    expect(state.entries[oct.id]!.status).toBe("duplicate");
    expect(state.entries[oct.id]!.existingMatches?.[0]?.id).toBe("test-id");
    expect(deps.download).toHaveBeenCalledTimes(1);
    expect(deps.download.mock.invocationCallOrder[0]).toBeLessThan(deps.preflight.mock.invocationCallOrder[0]!);
    expect(deps.ingest).not.toHaveBeenCalled();
  });

  it("holds ambiguous matches and blocks ingestion when the existing-source check fails", async () => {
    const state = newDriveState(DEFAULT_DRIVE_FOLDER);
    discoverDriveFiles(state, [sep, oct]);
    const deps = { preflight: vi.fn(async (file: DrivePdf) => { if (file.id === oct.id) throw new Error("catalog unavailable"); return { decision: "review" as const, matches: [] }; }), download: vi.fn(async () => Buffer.from("%PDF-1.7")), ingest: vi.fn(async () => ({ status: "imported" as const })), save: vi.fn(async () => {}), log: vi.fn() };
    await drainDriveQueue(state, deps);
    expect(state.entries[oct.id]!.status).toBe("failed");
    expect(state.entries[sep.id]!.status).toBe("needs_review");
    expect(deps.download).toHaveBeenCalledTimes(2);
    expect(deps.ingest).not.toHaveBeenCalled();
  });
  it("preserves the rest of the queue when the provider exhausts its quota", async () => {
    const state = newDriveState(DEFAULT_DRIVE_FOLDER);
    discoverDriveFiles(state, [sep, oct]);
    const deps = { download: vi.fn(async () => Buffer.from("%PDF-1.7")), ingest: vi.fn(async () => ({ status: "failed" as const, halt: true, error: "OCR quota exhausted" })), save: vi.fn(async () => {}), log: vi.fn() };
    expect(await drainDriveQueue(state, deps)).toBe(true);
    expect(state.entries[oct.id]!.status).toBe("failed");
    expect(state.entries[sep.id]!.status).toBe("pending");
    expect(deps.ingest).toHaveBeenCalledTimes(1);
    expect(deps.save).toHaveBeenCalledTimes(2);
  });
});
