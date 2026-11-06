import { createSupabase } from "./supabase";
import { Pipeline, type ProcessResult } from "./pipeline";
import { AiIngestionReviewService } from "./aiReview";
import type { WorkerConfig } from "./config";
import { assertDriveTarget, validatePdf, type DrivePdf, type DriveTarget } from "./driveIngestion";
import { findExistingTest, type ExistingTestSource } from "./testIdentity";
import { registerSource } from "./sourceDocuments";

export class DriveTestImporter {
  private client;
  private pipeline;
  private review;
  private adminId: string | undefined;
  constructor(private config: WorkerConfig, private retryFailed = false, adminId?: string, private target: DriveTarget = "staging") {
    assertDriveTarget(config.supabaseUrl, target);
    this.client = createSupabase(config);
    this.pipeline = new Pipeline(config);
    this.review = new AiIngestionReviewService(config);
    this.adminId = adminId;
  }

  async preflight(file: DrivePdf, importId: string) {
    assertDriveTarget(this.config.supabaseUrl, this.target);
    const sources: ExistingTestSource[] = [];
    // Page through both published/draft full tests AND ungenerated imports.
    // Checking only filenames or only tests would miss renamed and in-progress sources.
    for (const table of ["tests", "pdf_imports"] as const) {
      for (let offset = 0; ; offset += 500) {
        let query = this.client.from(table).select(table === "tests" ? "id,title,status,kind" : "id,original_filename,status,content_scope");
        if (table === "tests") query = query.eq("kind", "full");
        const { data, error } = await query.order("id").range(offset, offset + 499);
        if (error || !data) throw new Error("Unable to check existing tests; refusing to import");
        for (const raw of data) {
          const row = raw as unknown as { id: string; title?: string; original_filename?: string; status: string; content_scope?: string };
          if (table === "pdf_imports" && row.id === importId) continue;
          const label = table === "tests" ? row.title : row.original_filename;
          if (typeof row.id !== "string" || typeof label !== "string" || typeof row.status !== "string") throw new Error("Invalid existing source metadata; refusing to import");
          sources.push({ id: row.id, kind: table === "tests" ? "test" : "import", label, status: row.status, contentScope: table === "pdf_imports" ? row.content_scope : undefined });
        }
        if (data.length < 500) break;
      }
    }
    return findExistingTest(file.name, sources);
  }

  async ingest(file: DrivePdf, bytes: Buffer, importId: string): Promise<{ status: "imported" | "failed" | "pending"; error?: string; halt?: boolean }> {
    assertDriveTarget(this.config.supabaseUrl, this.target);
    validatePdf(bytes, file.size);
    const { data: existing, error } = await this.client.from("pdf_imports").select("id,status,generated_test_id").eq("id", importId).maybeSingle();
    if (error) throw new Error("Unable to read import");
    if (existing?.generated_test_id) return { status: "imported" };
    if (existing?.status === "failed" && !this.retryFailed) return { status: "failed", error: "Import failed validation or processing; inspect it before explicitly retrying." };
    if (existing && !["completed", "uploaded", "failed"].includes(existing.status)) return { status: "pending", error: "Existing import is already processing; no duplicate was started." };

    if (!existing) {
      let query = this.client.from("profiles").select("id").eq("role", "admin");
      if (this.adminId) query = query.eq("id", this.adminId);
      const { data: admin, error: adminError } = await query.order("id").limit(1).maybeSingle();
      if (adminError || !admin) throw new Error("No admin profile is available");
      this.adminId = admin.id;
      const source = await registerSource(this.client, file, bytes);
      const { error: insertError } = await this.client.from("pdf_imports").insert({
        id: importId, storage_path: null, source_document_id: source.id, source_state: "verified", original_filename: file.name, file_size: bytes.length,
        created_by: this.adminId, content_scope: "full_test", ocr_mode: "auto", status: "uploaded",
      });
      if (insertError) throw new Error("Import registration failed");
    }

    const result: Partial<ProcessResult> = existing?.status === "completed" ? { status: "completed" } : await this.pipeline.processImport(importId);
    const unavailable = /all API keys exhausted|HTTP 429.*(?:month|quota|limit)/i;
    const quotaExhausted = unavailable.test(result.message ?? "") || (result.report?.ocrPagesFailed ?? []).some(page => unavailable.test(page.error));
    if (result.status !== "completed") return {
      status: "failed", ...(quotaExhausted ? { halt: true } : {}),
      error: quotaExhausted ? "Cohere OCR quota exhausted; restore quota before retrying this import." : "Import did not complete; inspect its full-test validation and OCR report in admin review.",
    };
    // Same deterministic review gate as /process. This never approves, generates, or publishes tests.
    const job = await this.review.enqueue(importId);
    if (job && !["completed", "failed"].includes(job.status)) {
      const claimed = await this.review.claimNext();
      if (claimed) await this.review.processJob(claimed);
    }
    const { data: outcome, error: outcomeError } = await this.client.from("pdf_imports").select("status,deterministic_review_status").eq("id", importId).maybeSingle();
    if (outcomeError || !outcome) throw new Error("Unable to verify the final import validation result");
    if (outcome.status !== "completed" || outcome.deterministic_review_status !== "passed") return {
      status: "failed", ...(quotaExhausted ? { halt: true } : {}),
      error: quotaExhausted ? "OCR quota exhausted during this import; validation failed and remaining files were left pending." : "Import failed structural validation; inspect the draft import before retrying.",
    };
    if (quotaExhausted) return { status: "imported", halt: true, error: "Import passed validation, but OCR quota is exhausted; remaining files were left pending." };
    return { status: "imported" };
  }
}
