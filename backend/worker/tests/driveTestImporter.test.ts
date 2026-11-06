import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";
import { STAGING_URL, PRODUCTION_URL } from "../src/driveIngestion";
import { DriveTestImporter } from "../src/driveTestImporter";
import type { ProcessResult, IngestReport } from "../src/pipeline";

const f = vi.hoisted(() => ({ existing: null as null | { id: string; status: string; generated_test_id?: string }, outcome: { status: "completed", deterministic_review_status: "passed" }, inserted: [] as unknown[], upload: vi.fn(async () => ({ error: null })), process: vi.fn(async (_id: string): Promise<Partial<ProcessResult>> => ({ status: "completed" })), enqueue: vi.fn(async () => null) }));
vi.mock("../src/pipeline", () => ({ Pipeline: class { processImport = f.process; } }));
vi.mock("../src/aiReview", () => ({ AiIngestionReviewService: class { enqueue = f.enqueue; } }));
vi.mock("../src/supabase", () => ({ createSupabase: () => ({
  from(table: string) {
    let finalRead = false;
    const query = { upsert() { return query; }, single: async () => ({ data: { id: "source-id" }, error: null }), select(columns: string) { finalRead = columns === "status,deterministic_review_status"; return query; }, eq() { return query; }, order() { return query; }, limit() { return query; }, maybeSingle: async () => ({ data: finalRead ? f.outcome : table === "profiles" ? { id: "admin-id" } : f.existing, error: null }), insert: async (row: unknown) => { f.inserted.push(row); return { error: null }; } };
    return query;
  },
  storage: { from: () => ({ upload: f.upload }) },
}) }));
const config = () => loadConfig({ SUPABASE_URL: STAGING_URL, SUPABASE_SERVICE_ROLE_KEY: "test", WORKER_AUTH_TOKEN: "test", COHERE_API_KEY: "test" });
const file = { id: "drive-file-00001", name: "202610asiav1.pdf", mimeType: "application/pdf", folders: ["2026 10"] };
beforeEach(() => { f.existing = null; f.outcome = { status: "completed", deterministic_review_status: "passed" }; f.inserted.length = 0; vi.clearAllMocks(); });

describe("Drive staging importer", () => {
  it("enforces staging before constructing any provider", () => {
    expect(() => new DriveTestImporter({ ...config(), supabaseUrl: PRODUCTION_URL })).toThrow("staging");
    expect(() => new DriveTestImporter({ ...config(), supabaseUrl: PRODUCTION_URL }, false, undefined, "production")).not.toThrow();
  });
  it("registers a Drive-backed full-test draft without uploading its PDF at the stable supplied ID", async () => {
    await expect(new DriveTestImporter(config()).ingest(file, Buffer.from("%PDF-1.7"), "stable-import-id")).resolves.toEqual({ status: "imported" });
    expect(f.inserted).toEqual([expect.objectContaining({ id: "stable-import-id", content_scope: "full_test", status: "uploaded", created_by: "admin-id" })]);
    expect(f.upload).not.toHaveBeenCalled();
    expect(f.inserted[0]).toMatchObject({ storage_path: null, source_document_id: "source-id", source_state: "verified" });
    expect(f.process).toHaveBeenCalledWith("stable-import-id");
    expect(f.enqueue).toHaveBeenCalledWith("stable-import-id");
  });
  it("resumes an uploaded row without a second upload or insert", async () => {
    f.existing = { id: "stable-import-id", status: "uploaded" };
    await new DriveTestImporter(config()).ingest(file, Buffer.from("%PDF-1.7"), "stable-import-id");
    expect(f.inserted).toEqual([]);
    expect(f.upload).not.toHaveBeenCalled();
    expect(f.process).toHaveBeenCalledTimes(1);
  });
  it("does not restart completed or active imports and does not automatically retry failed ones", async () => {
    const importer = new DriveTestImporter(config());
    f.existing = { id: "stable-import-id", status: "completed" };
    expect(await importer.ingest(file, Buffer.from("%PDF-1.7"), "stable-import-id")).toEqual({ status: "imported" });
    f.existing.status = "extracting";
    expect((await importer.ingest(file, Buffer.from("%PDF-1.7"), "stable-import-id")).status).toBe("pending");
    f.existing.status = "failed";
    expect((await importer.ingest(file, Buffer.from("%PDF-1.7"), "stable-import-id")).status).toBe("failed");
    expect(f.process).not.toHaveBeenCalled();
  });
  it("does not label a completed processing run as imported when structural validation failed", async () => {
    f.outcome.deterministic_review_status = "failed";
    expect((await new DriveTestImporter(config()).ingest(file, Buffer.from("%PDF-1.7"), "stable-import-id")).status).toBe("failed");
  });
  it("halts the queue when all OCR keys are exhausted", async () => {
    f.process.mockResolvedValueOnce({ status: "failed", message: "Cohere Parse failed on all pages: all API keys exhausted" });
    const result = await new DriveTestImporter(config()).ingest(file, Buffer.from("%PDF-1.7"), "stable-import-id");
    expect(result).toMatchObject({ status: "failed", halt: true });
    expect(f.enqueue).not.toHaveBeenCalled();
  });
  it("halts after quota loss during a partial import even when the pipeline returned completed", async () => {
    f.outcome.deterministic_review_status = "failed";
    f.process.mockResolvedValueOnce({ status: "completed", report: { ocrPagesFailed: [{ page: 27, error: "Cohere Parse failed: all API keys exhausted" }] } as IngestReport });
    expect(await new DriveTestImporter(config()).ingest(file, Buffer.from("%PDF-1.7"), "stable-import-id")).toMatchObject({ status: "failed", halt: true });
  });
});
