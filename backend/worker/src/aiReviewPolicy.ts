import { createHash } from "node:crypto";

export const RISK_POLICY_VERSION = "ingestion-review-v2";
export const REVIEW_PROMPT_VERSION = "ingestion-review-v2";
export type ReviewState = "complete" | "review" | "failed";
export type RiskSeverity = "major" | "minor";
export interface ReviewRisk { code: string; severity: RiskSeverity; message: string }
export interface RiskDraft {
  id: string; page_number: number | null; prompt: string; question_type: string | null; suggested_answer: string | null;
  section?: string | null; source_question_number?: number | null; source_module_name?: string | null; source_module_position?: number | null; has_visual_stimulus?: boolean | null; visual_code?: string | null;
  stimulus_source_image_path?: string | null; stimulus_crop_status?: string | null;
  parser_metadata?: Record<string, unknown> | null; choices?: Array<{ text?: string | null }> | null;
}
export interface ImportRiskInput { status: string; textQuality?: Record<string, unknown> | null; drafts: RiskDraft[] }

const MAJOR_FLAGS = new Set(["duplicate_source_number_conflict", "source_question_id_unresolved", "screenshot_section_unresolved", "source_global_id_ocr_unresolved", "number_inference_after_duplicate"]);
const MINOR_FLAGS = new Set(["question_id_recovered_from_neighbors", "source_choice_table_truncated_review_required", "recovered_from_page_replay", "recovered_from_global_marker_block", "source_global_id_positional_slot", "positional_answer_review_required", "repeated_source_question_coalesced", "legacy_parser_unverified"]);
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

function canonicalModule(value: unknown): string | null {
  const name = String(value ?? "").toLowerCase().replaceAll("&", "and");
  const position = name.match(/(?:module|m)\s*([12])\b/)?.[1];
  if (!position) return null;
  if (/\bmath\b/.test(name)) return `math:${position}`;
  if (/\b(reading|writing|rw)\b/.test(name)) return `rw:${position}`;
  return null;
}

export function importRisks(input: ImportRiskInput): { major: ReviewRisk[]; warnings: ReviewRisk[] } {
  const quality = input.textQuality ?? {}; const major: ReviewRisk[] = []; const warnings: ReviewRisk[] = [];
  const add = (target: ReviewRisk[], code: string, message: string) => target.push({ code, severity: target === major ? "major" : "minor", message });
  if (["failed", "cancelled"].includes(input.status)) add(major, "import_processing_failed", "Import processing failed or was cancelled.");
  if (input.drafts.length === 0) add(major, "no_readable_questions", "No readable questions were produced.");
  if (quality.document_family === "full_test" && input.drafts.length > 0) {
    if (input.drafts.length !== 98) add(major, "full_test_question_count", `Full test contains ${input.drafts.length}/98 questions.`);
    const counts = new Map([["rw:1", 0], ["rw:2", 0], ["math:1", 0], ["math:2", 0]]); let unassigned = 0; let duplicate = false; const identities = new Set<string>();
    for (const draft of input.drafts) {
      const module = canonicalModule(draft.source_module_name);
      if (!module || !counts.has(module)) unassigned++;
      else {
        counts.set(module, (counts.get(module) ?? 0) + 1);
        const [moduleSection, modulePosition] = module.split(":");
        const draftSection = draft.section === "math" ? "math" : draft.section === "reading_writing" ? "rw" : null;
        if ((draftSection && draftSection !== moduleSection) || (draft.source_module_position != null && String(draft.source_module_position) !== modulePosition)) {
          add(major, "explicit_module_order_conflict", "An explicit module label conflicts with the derived SAT section or module order.");
        }
        if ((draft.source_question_number ?? 0) > 0) { const key = `${module}:${draft.source_question_number}`; if (identities.has(key)) duplicate = true; identities.add(key); }
      }
    }
    const expected: Record<string, number> = { "rw:1": 27, "rw:2": 27, "math:1": 22, "math:2": 22 };
    if ([...counts].some(([key, count]) => count !== expected[key])) add(major, "module_distribution", "Full-test module counts are not exactly 27/27/22/22.");
    if (unassigned) add(major, "module_assignment", `${unassigned} question(s) have missing or ambiguous module assignment.`);
    if (duplicate) add(major, "duplicate_question_identity", "Duplicate question identities exist within a module.");
  }
  if (asArray(quality.ocr_pages_failed).length) add(warnings, "ocr_page_failure", "One or more OCR pages used fallback.");
  if (asArray(quality.ocr_retry_results).some((row: any) => row?.status === "failed" || row?.status === "rejected")) add(warnings, "ocr_retry_warning", "One or more targeted OCR retries failed or did not improve parsing.");
  if (Number(quality.inferred_question_numbers ?? 0) > 0) add(warnings, "inferred_question_numbers", "Some question numbers were inferred.");
  if (quality.answer_key_status !== "complete") add(warnings, "answer_key_warning", `Answer-key status is ${String(quality.answer_key_status ?? "unknown")}.`);
  if (quality.answer_key_source && quality.answer_key_source !== "parsed") add(warnings, "answer_key_source", `Answer-key source is ${String(quality.answer_key_source).replaceAll("_", " ")}.`);
  if (Number(quality.key_fallback_matches ?? 0) > 0) add(warnings, "positional_key_matches", "Some answer keys were matched by position.");
  if (asArray(quality.answer_key_warnings).length || asArray(quality.unmatched_key_entries).length) add(warnings, "answer_key_diagnostics", "Answer-key diagnostics require human review.");
  if (asArray(quality.parser_warnings).length) add(warnings, "parser_warnings", "Parser warnings are available for human review.");
  return { major: dedupe(major), warnings: dedupe(warnings) };
}

export function draftRisks(draft: RiskDraft): ReviewRisk[] {
  const risks: ReviewRisk[] = []; const add = (code: string, severity: RiskSeverity, message: string) => risks.push({ code, severity, message }); const metadata = draft.parser_metadata ?? {};
  for (const flag of asArray(metadata.parse_flags).filter((v): v is string => typeof v === "string")) {
    if (MAJOR_FLAGS.has(flag)) add(`parser:${flag}`, "major", `Parser flagged ${flag.replaceAll("_", " ")}.`);
    else if (MINOR_FLAGS.has(flag)) add(`parser:${flag}`, "minor", `Parser flagged ${flag.replaceAll("_", " ")}.`);
    else add(`parser:${flag}`, "major", `Unknown parser flag ${flag.replaceAll("_", " ")} requires human review.`);
  }
  if (draft.page_number == null || draft.page_number < 1) add("source_evidence_missing", "major", "No source PDF page is available.");
  if (!draft.prompt.trim() || draft.prompt.trim().length < 8) add("prompt_suspect", "minor", "Prompt is empty or unusually short.");
  if (!draft.suggested_answer?.trim()) add("required_answer_missing", "major", "No safely matched answer is available.");
  if (draft.question_type === "multiple_choice" && ((draft.choices ?? []).length !== 4 || (draft.choices ?? []).some((choice) => !choice.text?.trim()))) add("choice_structure", "minor", "Multiple-choice structure is incomplete or malformed.");
  if (metadata.source_number_origin === "inferred") add("question_number_inferred", "minor", "Question identity was inferred from document order.");
  if (metadata.key_match_confidence === "low" || ["recovered_question_id", "module_position", "document_position"].includes(String(metadata.key_match_method))) add("answer_alignment_low_confidence", "minor", "Answer alignment used a low-confidence method.");
  if (draft.has_visual_stimulus && !draft.visual_code) {
    if (!draft.stimulus_source_image_path) add("visual_source_missing", "major", "The visual source image is unavailable.");
    else if (draft.stimulus_crop_status !== "confirmed") add("crop_unconfirmed", "minor", "The visual crop requires AI and human review.");
  }
  return dedupe(risks);
}

export const hasMinorRisk = (risks: ReviewRisk[]) => risks.some((risk) => risk.severity === "minor");
export const hasMajorRisk = (risks: ReviewRisk[]) => risks.some((risk) => risk.severity === "major");
export const stateForRisks = (risks: ReviewRisk[]): ReviewState => risks.length ? "review" : "complete";
const dedupe = (risks: ReviewRisk[]) => [...new Map(risks.map((risk) => [risk.code, risk])).values()];
export function canonicalSnapshot(value: unknown): string {
  const normalize = (input: unknown): unknown => Array.isArray(input) ? input.map(normalize) : input && typeof input === "object" ? Object.fromEntries(Object.entries(input as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)])) : input;
  return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}
