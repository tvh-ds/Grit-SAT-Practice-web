import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { importPdf } from "./sourceDocuments";
import { stimulusAssetKey } from "./stimulusAssetKey";
import { createSupabase } from "./supabase";
import { extractText, analyzeTextQuality, type PageText } from "./extractor";
import { parseQuestions } from "./parser";
import { parseScraperQuestions } from "./scraperParser";
import { parseAnswerKey, answerMap, answerMapGlobal } from "./answerKey";
import { looksLikeQuestionBank, parseQuestionBank } from "./questionBankParser";
import { renderPagePng } from "./renderPage";
import { normalizeText, hasSpacedText } from "./textNormalize";
import { parseFullTest, type ContentScope, type FullTestParseResult } from "./fullTestParser";
import { evaluateModuleCompleteness, type ModuleCompleteness, type ScraperParseResult } from "./scraperParser";
import {
  createParseProvider,
  fitImageForParse,
  parsePageTiled,
  PARSE_RENDER_SCALE,
  type ParseProvider,
  type ParseVisualBlock,
} from "./ocr";
import {
  visualsToNormBoxes,
  decideCrop,
  cropPng,
  inkRatio,
  isNoiseVisual,
  CROP_MIN_INK,
  type NormBox,
} from "./cropStimulus";

export interface PipelineConfig {
  supabaseUrl: string;
  supabaseServiceKey: string;
  cohereApiKey?: string;
  cohereApiKeys?: string[];
  cohereKeyPageCap?: number;
  ocrModel?: string;
  ocrProvider: string;
  ocrMode: "auto" | "all" | "none";
}

export interface ProcessResult {
  importId: string;
  status: string;
  pages: number;
  drafts: number;
  suggestedKeys: number;
  method: string | null;
  message?: string;
  report?: IngestReport | null;
}

export interface PhaseTimingsMs {
  ocrMs: number;
  parserMs: number;
  finalizeMs: number;
  totalMs: number;
}

export interface OcrPageFailure {
  page: number;
  error: string;
}

export interface OcrRetryDiagnostic {
  page: number;
  reason: string;
  status: "accepted" | "rejected" | "failed";
  beforeQuestions: number;
  afterQuestions: number;
  error?: string;
}

export interface UnmatchedKeyDiagnostic {
  questionNumber: number;
  moduleName: string | null;
  pageNumber: number;
  sourceText: string;
  reason: "question_key_count_mismatch" | "no_matching_question";
}

export interface QuestionIssueDiagnostic {
  pageNumber: number;
  moduleName: string | null;
  questionNumber: number | null;
  prompt: string;
  flags: string[];
}

export const MAX_SUSPECT_OCR_RETRIES = 4;

export type KeyStatus = "complete" | "partial" | "missing";
/**
 * Words showing the question text itself refers to a visual ("the graph
 * shows …", "data in the table …"). Used only together with a page-level
 * visual to attribute flattened table content (no "[figure: …]" marker)
 * to the question that owns it — never alone.
 */
export const VISUAL_CUE_RE = /\b(data|graph|table|figure|chart|scatterplot|histogram|diagram|plot)\b/i;
/**
 * Structural answer-key status: total + per-module key/question alignment.
 * "low_confidence" means every question has a key but alignment is suspect
 * (module counts mismatch, duplicate key numbers, positional fallback, or
 * orphan reassignment). The DB column only allows complete/partial/missing,
 * so low_confidence is stored there as "partial" while text_quality keeps
 * the structural value plus warnings.
 */
export type StructuralKeyStatus = "complete" | "partial" | "missing" | "low_confidence";

/** Visual/table content Parse found on a page (graphs, figures, boxes). */
export interface PageVisualInfo {
  imageCount: number;
  tableCount: number;
  notes: string[];
  /** Full OCR visual blocks incl. bounding boxes (drives auto-crop). */
  boxes: StoredVisualBox[];
}

/** Persisted OCR visual block: kind + description + bounding boxes. */
export interface StoredVisualBox {
  kind: "image" | "table";
  description: string | null;
  category: string | null;
  bbox: { topLeftX: number; topLeftY: number; bottomRightX: number; bottomRightY: number } | null;
  bboxNormalized: { topLeftX: number; topLeftY: number; bottomRightX: number; bottomRightY: number } | null;
}

/** One module's completeness check. */
export interface ModuleCheck {
  module: string;
  expected: number;
  actual: number;
  status: "complete" | "partial" | "over";
}

/** Per-document ingestion report for the Parse 5 pipeline. */
export interface IngestReport {
  file: string | null;
  importId: string;
  status: string;
  totalPages: number;
  ocrProvider: string;
  ocrModel: string;
  ocrPagesAttempted: number;
  ocrPagesSucceeded: number;
  ocrPagesFailed: OcrPageFailure[];
  billedParsePages: number;
  ocrRetryResults?: OcrRetryDiagnostic[];
  finalQuestionsByModule: Record<string, number>;
  moduleChecks: ModuleCheck[];
  visualReviewQuestions: number;
  visualPages: number[];
  answerKeyStatus: KeyStatus | null;
  structuralKeyStatus?: StructuralKeyStatus | null;
  answerKeyByModule: Record<string, { questions: number; keys: number; status: string }>;
  answerKeyWarnings?: string[];
  warnings: string[];
  timingsMs: PhaseTimingsMs;
  message?: string;
}

interface AssembledQuestion {
  sourceQuestionNumber: number;
  sourceQuestionNumberOrigin: "observed" | "inferred";
  parseFlags: string[];
  sourceModuleName: string | null;
  sourceModulePosition: number | null;
  sourceQuestionId: string | null;
  sourceGlobalQuestionId?: string | null;
  pageNumber: number;
  section: "reading_writing" | "math";
  questionType: "multiple_choice" | "student_produced";
  prompt: string;
  passageText: string | null;
  choices: Array<{ label: string; text: string; position: number }>;
  confidence: number;
  correctAnswer: string | null;
  explanation: string | null;
  domain: string | null;
  skill: string | null;
  difficulty: number | null;
  hasVisualStimulus: boolean;
  /** Visual marker spans in this question (drives OCR box attribution). */
  visualMarkerCount: number;
}

interface ParsedBundle {
  bank: ReturnType<typeof parseQuestionBank> | null;
  fullTest: FullTestParseResult | null;
  scraper: ScraperParseResult | null;
  questions: AssembledQuestion[];
  completeness: ModuleCompleteness[];
  legacyGlobal: Map<number, { answer: string; pageNumber: number; sourceText: string }> | null;
}

interface MatchedAnswer {
  answer: string;
  pageNumber: number;
  sourceText: string;
  method?: "question_id" | "recovered_question_id" | "module_position" | "document_position" | "bank";
  confidence?: "high" | "low";
  keyEntryIndex?: number;
}

interface IndexedKeyEntry {
  index: number;
  questionNumber: number;
  answer: string;
  pageNumber: number;
  sourceText: string;
  moduleName: string | null;
  inferredModule: string | null;
  global: boolean;
}

function countByModule(questions: Array<{ sourceModuleName: string | null }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of questions) {
    const mod = q.sourceModuleName ?? "Unknown";
    out[mod] = (out[mod] ?? 0) + 1;
  }
  return out;
}

function retryCandidatePages(
  parsed: ParsedBundle,
  visualPages: number[],
  failedPages: number[],
): Array<{ page: number; reason: string }> {
  const candidates = new Map<number, { score: number; reasons: string[] }>();
  const add = (page: number, score: number, reason: string) => {
    if (!Number.isInteger(page) || page < 1) return;
    const current = candidates.get(page) ?? { score: 0, reasons: [] };
    current.score = Math.max(current.score, score);
    if (!current.reasons.includes(reason)) current.reasons.push(reason);
    candidates.set(page, current);
  };

  for (const page of failedPages) add(page, 100, "initial OCR page failure");
  if (parsed.fullTest && parsed.fullTest.documentFamily !== "question_bank") {
    for (const module of parsed.completeness) {
      const moduleQuestions = parsed.questions
        .filter((q) => q.sourceModuleName === module.name)
        .sort((a, b) =>
          a.pageNumber - b.pageNumber ||
          (a.sourceModulePosition ?? 0) - (b.sourceModulePosition ?? 0),
        );
      const hasUnresolvedBoundaries = moduleQuestions.some((q) =>
        q.parseFlags.includes("source_question_id_unresolved"),
      );
      if (!((module.missing > 0 && module.missing <= 4) || hasUnresolvedBoundaries)) continue;
      const questions = moduleQuestions;
      for (const q of questions) {
        if (q.sourceQuestionNumber < 1 || q.parseFlags.includes("source_question_id_unresolved")) {
          add(q.pageNumber, 85, module.name + " has an unresolved question boundary");
        }
      }
      const numbered = questions.filter((q) => q.sourceQuestionNumber > 0);
      for (let i = 1; i < numbered.length; i++) {
        const before = numbered[i - 1]!;
        const after = numbered[i]!;
        if (after.sourceQuestionNumber > before.sourceQuestionNumber + 1) {
          add(before.pageNumber, 75, module.name + " has a source-question number gap");
          add(after.pageNumber, 75, module.name + " has a source-question number gap");
        }
      }
      for (const page of visualPages) {
        if (page >= module.startPage && page <= module.endPage) {
          add(page, 60, module.name + " is short and the page contains a visual/table");
        }
      }
      if (![...candidates.keys()].some((page) => page >= module.startPage && page <= module.endPage)) {
        // No stronger signal: retry only the final pages in the short module,
        // where a missing trailing question is most likely to be truncated.
        const pageCount = Math.max(0, module.endPage - module.startPage + 1);
        for (let page = Math.max(module.startPage, module.endPage - Math.min(pageCount, 4) + 1); page <= module.endPage; page++) {
          add(page, 10, module.name + " is short by " + module.missing + " question(s)");
        }
      }
    }
  }

  return [...candidates.entries()]
    .sort((a, b) => b[1].score - a[1].score || a[0] - b[0])
    .slice(0, MAX_SUSPECT_OCR_RETRIES)
    .map(([page, info]) => ({ page, reason: info.reasons.join("; ") }));
}

function parseQualityScore(parsed: ParsedBundle): number {
  const unresolved = parsed.questions.filter((q) => q.parseFlags.includes("source_question_id_unresolved")).length;
  const inferred = parsed.questions.filter((q) => q.sourceQuestionNumberOrigin === "inferred").length;
  const observed = parsed.questions.filter((q) => q.sourceQuestionNumberOrigin === "observed").length;
  const moduleDeviation = parsed.completeness.reduce((sum, m) => sum + Math.abs(m.expected - m.actual), 0);
  const promptQuality = parsed.questions.reduce((sum, q) => sum + Math.min(q.prompt.length, 400) / 400, 0);
  return parsed.questions.length * 100 + observed * 2 - inferred * 2 - unresolved * 30 - moduleDeviation * 25 + promptQuality;
}

function retryImprovesParse(before: ParsedBundle, after: ParsedBundle): boolean {
  if (after.questions.length < before.questions.length) return false;
  const beforeDeviation = before.completeness.reduce((sum, m) => sum + Math.abs(m.expected - m.actual), 0);
  const afterDeviation = after.completeness.reduce((sum, m) => sum + Math.abs(m.expected - m.actual), 0);
  if (afterDeviation > beforeDeviation) return false;
  return parseQualityScore(after) > parseQualityScore(before);
}

/** Module-scoped key slots ("Module|n") parsed from the document. */
function collectKeySlots(parsed: ParsedBundle): string[] {
  const slots: string[] = [];
  if (parsed.fullTest) {
    for (const e of parsed.fullTest.keyEntries) {
      if (e.moduleName) slots.push(`${e.moduleName}|${e.questionNumber}`);
    }
  } else if (parsed.scraper) {
    for (const k of parsed.scraper.keys) {
      if (k.moduleName && !k.global) slots.push(`${k.moduleName}|${k.questionNumber}`);
    }
  }
  return slots;
}

/**
 * Structural answer-key assessment: do parsed keys match detected questions
 * in total AND per module, without duplicates, extras, or fallback matching?
 */
export function assessAnswerKey(args: {
  bank: boolean;
  questionCount: number;
  matchedCount: number;
  fallbackMatches: number;
  scopedMatches: number;
  keyEntries: number;
  keySlots: string[];
  summary: Record<string, { questions: number; keys: number; status: string }>;
}): { structural: StructuralKeyStatus; warnings: string[] } {
  const { bank, questionCount, matchedCount, fallbackMatches, keyEntries, keySlots, summary } = args;
  const warnings: string[] = [];
  if (bank) {
    if (keyEntries > questionCount) warnings.push(keyEntries + " key entries exceed " + questionCount + " questions");
    const structural: StructuralKeyStatus =
      questionCount > 0 && matchedCount === questionCount && keyEntries === questionCount
        ? "complete"
        : matchedCount === 0
          ? "missing"
          : "partial";
    return { structural: warnings.length > 0 && structural === "complete" ? "low_confidence" : structural, warnings };
  }
  // Duplicate key numbers inside one module (first match wins downstream).
  const seen = new Map<string, number>();
  for (const s of keySlots) seen.set(s, (seen.get(s) ?? 0) + 1);
  const dups = [...seen.entries()].filter(([, n]) => n > 1).slice(0, 8);
  for (const [slot] of dups) warnings.push(`duplicate key entry for ${slot}`);
  if (keyEntries > questionCount) {
    warnings.push(`${keyEntries} key entries exceed ${questionCount} questions`);
  }
  const moduleMismatch = Object.entries(summary)
    .filter(([, s]) => s.keys !== s.questions)
    .map(([mod, s]) => `${mod} ${s.keys}/${s.questions}`);
  if (matchedCount === 0) {
    if (keyEntries > 0) warnings.push(`${keyEntries} key entries parsed but none matched any question`);
    return { structural: "missing", warnings };
  }
  if (matchedCount < questionCount) {
    if (moduleMismatch.length > 0) warnings.push(`module key shortfall: ${moduleMismatch.join("; ")}`);
    if (fallbackMatches > 0) warnings.push(`${fallbackMatches} keys matched by position, not module scope`);
    return { structural: "partial", warnings };
  }
  // Every question has a key — still suspect when alignment is indirect.
  if (fallbackMatches > 0) warnings.push(`${fallbackMatches} keys matched by position, not module scope`);
  if (moduleMismatch.length > 0) warnings.push(`module counts differ after matching: ${moduleMismatch.join("; ")}`);
  if (warnings.length > 0) return { structural: "low_confidence", warnings };
  return { structural: "complete", warnings };
}

export class Pipeline {
  private svc: SupabaseClient;
  private parse: ParseProvider;
  private ocrModel: string;

  constructor(config: PipelineConfig) {
    this.svc = createSupabase(config);
    // Parse 5 is the only OCR provider; COHERE_API_KEY is mandatory.
    // Multiple keys rotate automatically on quota/rate-limit/timeout.
    const keys = (config.cohereApiKeys ?? []).length > 0 ? config.cohereApiKeys! : config.cohereApiKey;
    this.parse = createParseProvider(config.ocrProvider, keys, config.ocrModel, config.cohereKeyPageCap ?? 1000);
    this.ocrModel = this.parse.model;
  }

  async processImport(importId: string): Promise<ProcessResult> {
    const { data: pdfImport, error } = await this.svc
      .from("pdf_imports")
      .select("*")
      .eq("id", importId)
      .maybeSingle();
    if (error) throw new Error(`load import: ${error.message}`);
    if (!pdfImport) throw new Error(`import not found: ${importId}`);
    if (pdfImport.generated_test_id) throw new Error("Generated tests cannot be reprocessed; upload a new import");

    if (!["uploaded", "failed"].includes(pdfImport.status)) {
      throw new Error(`import ${importId} is in status ${pdfImport.status}; not processable`);
    }

    const rebuilding = pdfImport.status === "failed";
    await this.svc.from("pdf_imports").update({ status: "extracting", error_message: null }).eq("id", importId);

    const t0 = Date.now();
    const fileName: string | null = typeof pdfImport.original_filename === "string" ? pdfImport.original_filename : null;
    try {
      const buffer = await importPdf(this.svc, pdfImport);
      if (rebuilding) {
        // Rebuilding deletes every draft; never silently discard converted code.
        const { data: converted, error: convertedError } = await this.svc.from("draft_questions")
          .select("id").eq("pdf_import_id", importId).not("visual_code", "is", null).limit(1);
        if (convertedError) throw new Error(`check converted visuals: ${convertedError.message}`);
        if (converted?.length) throw new Error("Cannot rebuild an import containing converted visuals; its drafts must be preserved");
        const { error: jobDeleteError } = await this.svc.from("ai_ingestion_review_jobs").delete().eq("pdf_import_id", importId);
        if (jobDeleteError) throw new Error(`clear old AI review jobs: ${jobDeleteError.message}`);
        const { error: draftDeleteError } = await this.svc.from("draft_questions").delete().eq("pdf_import_id", importId);
        if (draftDeleteError) throw new Error(`clear old drafts: ${draftDeleteError.message}`);
        const { error: pageDeleteError } = await this.svc.from("pdf_import_pages").delete().eq("pdf_import_id", importId);
        if (pageDeleteError) throw new Error(`clear old import pages: ${pageDeleteError.message}`);
      }
      const bufferForFinalize = new Uint8Array(new ArrayBuffer(buffer.byteLength));
      bufferForFinalize.set(new Uint8Array(buffer));
      // Selectable text is kept only as a per-page fallback when Parse fails
      // on that page; the parser always reads Parse OCR output.
      const fallbackTexts = await extractText(new Uint8Array(buffer));
      const fallbackByPage = new Map(fallbackTexts.map((p) => [p.pageNumber, p.text]));
      const totalPages = fallbackTexts.length;

      const warnings: string[] = [];

      // --- Step 1: OCR the full test with Cohere Parse 5 (timed) ---
      const tOcr = Date.now();
      const ocrPages: PageText[] = [];
      const visualByPage = new Map<number, PageVisualInfo>();
      const ocrSucceeded: number[] = [];
      const ocrFailed: OcrPageFailure[] = [];
      let billedParsePages = 0;
      for (let pn = 1; pn <= totalPages; pn++) {
        try {
          const png = await renderPagePng(bufferForFinalize, pn, PARSE_RENDER_SCALE);
          const fitted = await fitImageForParse(png);
          const out = await parsePageTiled(this.parse, fitted);
          billedParsePages += out.billedPages;
          const text = out.text.trim().length > 0 ? out.text : (fallbackByPage.get(pn) ?? "");
          ocrPages.push({ pageNumber: pn, text });
          if (out.imageCount > 0 || out.tableCount > 0) {
            visualByPage.set(pn, {
              imageCount: out.imageCount,
              tableCount: out.tableCount,
              notes: out.visuals.map((v) => `${v.kind}: ${v.description ?? v.category ?? "visual"}`),
              boxes: out.visuals.map((v) => ({
                kind: v.kind,
                description: v.description,
                category: v.category,
                bbox: v.bbox,
                bboxNormalized: v.bboxNormalized,
              })),
            });
          }
          ocrSucceeded.push(pn);
          console.log(`[pipeline] OCR ${importId}: page ${pn}/${totalPages} completed`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/auth failure|check COHERE_API_KEY/.test(msg)) {
            throw new Error(`Cohere Parse auth failure on page ${pn}: ${msg} (stopping; check COHERE_API_KEY)`);
          }
          console.warn(`[pipeline] Parse page ${pn} failed: ${msg}`);
          ocrFailed.push({ page: pn, error: msg.slice(0, 300) });
          // Fall back to selectable text so one bad page cannot sink the test.
          ocrPages.push({ pageNumber: pn, text: fallbackByPage.get(pn) ?? "" });
        }
      }
      const ocrMs = Date.now() - tOcr;
      console.log(`[pipeline] Parse OCR: ${ocrSucceeded.length}/${totalPages} pages (model ${this.ocrModel})`);
      // --- Step 2: parser reads OCR output, questions become drafts ---
      const tParser = Date.now();
      let parsed = this.parseAll(normalizeText(ocrPages), "full_test");
      const retry = await this.retrySuspectPages(
        bufferForFinalize,
        ocrPages,
        parsed,
        visualByPage,
        ocrFailed.map((failure) => failure.page),
      );
      parsed = retry.parsed;
      billedParsePages += retry.billedPages;
      if (totalPages > 0 && ocrSucceeded.length === 0 && !retry.results.some((result) => result.status === "accepted")) {
        throw new Error(
          "Cohere Parse failed on all " + totalPages + " page(s); first error: " +
          (ocrFailed[0]?.error ?? "unknown") + " (stopping for diagnosis)",
        );
      }
      const quality = analyzeTextQuality(ocrPages);
      for (const outcome of retry.results) {
        if (outcome.status === "failed") {
          warnings.push("Targeted OCR retry failed on page " + outcome.page + ": " + (outcome.error ?? "unknown error"));
        } else if (outcome.status === "rejected") {
          warnings.push("Targeted OCR retry on page " + outcome.page + " did not improve parser completeness; original OCR was kept.");
        }
      }
      await this.writePages(pdfImport.id, ocrPages);
      const parserMs = Date.now() - tParser;

      // Nothing usable: fail with the OCR attempt recorded.
      if (!parsed.bank && parsed.questions.length === 0) {
        const msg =
          `No readable SAT modules detected after Parse OCR (${ocrSucceeded.length}/${totalPages} pages parsed). ` +
          `The PDF may be malformed or unsupported.`;
        const timingsMs: PhaseTimingsMs = { ocrMs, parserMs, finalizeMs: 0, totalMs: Date.now() - t0 };
        await this.svc
          .from("pdf_imports")
          .update({
            status: "failed",
            error_message: msg,
            text_quality: {
              ...quality.metrics,
              parser_warnings: [...warnings, msg],
              detected_modules: {},
              ocr_provider: this.parse.name,
              ocr_model: this.ocrModel,
              ocr_pages: totalPages,
              ocr_pages_succeeded: ocrSucceeded.length,
              ocr_pages_failed: ocrFailed,
              billed_parse_pages: billedParsePages,
              ocr_retry_results: retry.results,
              timings_ms: timingsMs,
            },
          })
          .eq("id", importId);
        return {
          importId,
          status: "failed",
          pages: totalPages,
          drafts: 0,
          suggestedKeys: 0,
          method: null,
          message: msg,
          report: {
            file: fileName,
            importId,
            status: "failed",
            totalPages,
            ocrProvider: this.parse.name,
            ocrModel: this.ocrModel,
            ocrPagesAttempted: totalPages,
            ocrPagesSucceeded: ocrSucceeded.length,
            ocrPagesFailed: ocrFailed,
            billedParsePages,
            finalQuestionsByModule: {},
            moduleChecks: [],
            visualReviewQuestions: 0,
            visualPages: [...visualByPage.keys()],
            answerKeyStatus: "missing",
            answerKeyByModule: {},
            warnings: [...warnings, msg],
            timingsMs,
            message: msg,
          },
        };
      }

      // --- Step 3: completeness checks (modules, counts, keys, visuals) ---
      const moduleChecks: ModuleCheck[] = parsed.completeness.map((c) => ({
        module: c.name,
        expected: c.expected,
        actual: c.actual,
        status: c.missing > 0 ? "partial" : c.missing < 0 ? "over" : "complete",
      }));
      for (const c of parsed.completeness) {
        if (c.missing > 0) {
          warnings.push(`${c.name}: ${c.actual}/${c.expected} questions (partial — review needed).`);
        } else if (c.missing < 0) {
          warnings.push(`${c.name}: ${c.actual}/${c.expected} questions (over count — module boundaries may be wrong, review needed).`);
        }
      }
      if (ocrFailed.length > 0) {
        const recoveredPages = new Set(
          (retry.results ?? [])
            .filter((result) => result.status === "accepted" && ocrFailed.some((failure) => failure.page === result.page))
            .map((result) => result.page),
        );
        const remainingFailures = ocrFailed.filter((failure) => !recoveredPages.has(failure.page));
        warnings.push(
          "Initial Parse OCR failed on " + ocrFailed.length + " page(s)" +
          (recoveredPages.size > 0 ? "; targeted retry recovered " + recoveredPages.size + " page(s)" : "") +
          (remainingFailures.length > 0
            ? "; selectable-text fallback remains on page(s) " + remainingFailures.map((failure) => failure.page).join(", ")
            : "; no selectable-text fallback was needed after retry") +
          ".",
        );
      }
      if (visualByPage.size > 0) {
        warnings.push(
          `${visualByPage.size} page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.`,
        );
      }

      const tFin = Date.now();
      const result = await this.finalize(parsed, quality, ocrPages, "parse_ocr", bufferForFinalize, {
        importId,
        ocrPages: totalPages,
        ocrSucceeded: ocrSucceeded.length,
        ocrFailed,
        billedParsePages,
        ocrRetryResults: retry.results,
        visualByPage: Object.fromEntries(visualByPage),
        warnings,
        moduleChecks,
        timings: { ocrMs, parserMs, finalizeMs: 0, totalMs: 0 },
        startedAt: t0,
        finalizeStartedAt: tFin,
      });
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const risk = [{ code: "import_processing_failed", severity: "major", message: "Import processing failed before structural validation completed." }];
      await this.svc.from("pdf_imports").update({
        status: "failed",
        error_message: message.slice(0, 2000),
        deterministic_review_status: "failed",
        deterministic_policy_version: "ingestion-review-v2",
        deterministic_major_risks: risk,
        deterministic_reviewed_at: new Date().toISOString(),
      }).eq("id", importId);
      await this.svc.from("draft_questions").update({ review_state: "failed", deterministic_risks: risk, review_route: "blocked" }).eq("pdf_import_id", importId);
      return { importId, status: "failed", pages: 0, drafts: 0, suggestedKeys: 0, method: null, message, report: null };
    }
  }

  /**
   * Finalize an import from previously saved OCR (no Parse calls).
   * Used by the mirrored post_ocr batch: parse saved text, persist pages +
   * drafts, attach full-page stimulus images from the local PDF bytes.
   */
  async importSavedOcr(
    importId: string,
    ocrPages: PageText[],
    visualByPage: Record<number, PageVisualInfo>,
    pdfBytes?: Uint8Array,
  ): Promise<ProcessResult> {
    const t0 = Date.now();
    const { data: pdfImport, error } = await this.svc.from("pdf_imports").select("*").eq("id", importId).maybeSingle();
    if (error) throw new Error(`load import: ${error.message}`);
    if (!pdfImport) throw new Error(`import not found: ${importId}`);
    if (!["uploaded", "failed"].includes(pdfImport.status)) {
      throw new Error(`import ${importId} is in status ${pdfImport.status}; not processable`);
    }
    const fileName: string | null = typeof pdfImport.original_filename === "string" ? pdfImport.original_filename : null;
    await this.svc.from("pdf_imports").update({ status: "extracting", error_message: null }).eq("id", importId);

    const totalPages = ocrPages.length;
    const warnings: string[] = [`OCR loaded from saved post_ocr text (no Parse calls in this step).`];
    const visualPages = Object.keys(visualByPage).map(Number);
    if (visualPages.length > 0) {
      warnings.push(
        `${visualPages.length} page(s) contain figures/tables/graphs; affected questions are marked needs_review with page images attached.`,
      );
    }
    const quality = analyzeTextQuality(ocrPages);
    await this.writePages(pdfImport.id, ocrPages);

    const tParser = Date.now();
    const parsed = this.parseAll(normalizeText(ocrPages), "full_test");
    const parserMs = Date.now() - tParser;
    if (!parsed.bank && parsed.questions.length === 0) {
      const msg = `No readable SAT modules detected in saved OCR for ${fileName ?? importId}.`;
      await this.svc.from("pdf_imports").update({ status: "failed", error_message: msg }).eq("id", importId);
      return { importId, status: "failed", pages: totalPages, drafts: 0, suggestedKeys: 0, method: null, message: msg, report: null };
    }
    const moduleChecks: ModuleCheck[] = parsed.completeness.map((c) => ({
      module: c.name,
      expected: c.expected,
      actual: c.actual,
      status: c.missing > 0 ? "partial" : c.missing < 0 ? "over" : "complete",
    }));
    for (const c of parsed.completeness) {
      if (c.missing > 0) warnings.push(`${c.name}: ${c.actual}/${c.expected} questions (partial — review needed).`);
      else if (c.missing < 0) warnings.push(`${c.name}: ${c.actual}/${c.expected} questions (over count — review needed).`);
    }
    const tFin = Date.now();
    return this.finalize(parsed, quality, ocrPages, "parse_ocr_saved", pdfBytes ?? new Uint8Array(), {
      importId,
      ocrPages: totalPages,
      ocrSucceeded: totalPages,
      ocrFailed: [],
      billedParsePages: 0,
      visualByPage,
      warnings,
      moduleChecks,
      timings: { ocrMs: 0, parserMs, finalizeMs: 0, totalMs: 0 },
      startedAt: t0,
      finalizeStartedAt: tFin,
    });
  }

  /** Find the next pending import (polling mode). */
  async claimNextPending(): Promise<string | null> {
    const { data, error } = await this.svc
      .from("pdf_imports")
      .select("id")
      .in("status", ["uploaded", "failed"])
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) throw new Error(`claim next: ${error.message}`);
    return data?.[0]?.id ?? null;
  }

  private async retrySuspectPages(
    pdfBytes: Uint8Array,
    pages: PageText[],
    initialParse: ParsedBundle,
    visualByPage: Map<number, PageVisualInfo>,
    failedPages: number[],
  ): Promise<{ parsed: ParsedBundle; results: OcrRetryDiagnostic[]; billedPages: number }> {
    const candidates = retryCandidatePages(initialParse, [...visualByPage.keys()], failedPages);
    let parsed = initialParse;
    let billedPages = 0;
    const results: OcrRetryDiagnostic[] = [];

    for (const candidate of candidates) {
      const beforeQuestions = parsed.questions.length;
      try {
        // Re-render only suspect pages at a higher scale; this uses the same
        // configured Parse provider/key rotation and is capped per import.
        const png = await renderPagePng(pdfBytes, candidate.page, PARSE_RENDER_SCALE + 1);
        const fitted = await fitImageForParse(png);
        const out = await parsePageTiled(this.parse, fitted);
        billedPages += out.billedPages;
        const text = out.text.trim();
        if (!text) {
          results.push({
            page: candidate.page,
            reason: candidate.reason,
            status: "rejected",
            beforeQuestions,
            afterQuestions: beforeQuestions,
          });
          continue;
        }

        const pageIndex = pages.findIndex((page) => page.pageNumber === candidate.page);
        if (pageIndex < 0) {
          results.push({
            page: candidate.page,
            reason: candidate.reason,
            status: "failed",
            beforeQuestions,
            afterQuestions: beforeQuestions,
            error: "page is missing from OCR output",
          });
          continue;
        }
        const retryPages = pages.map((page, index) =>
          index === pageIndex ? { pageNumber: page.pageNumber, text } : page,
        );
        const retryParse = this.parseAll(normalizeText(retryPages), "full_test");
        const accepted = retryImprovesParse(parsed, retryParse);
        if (accepted) {
          pages[pageIndex] = { pageNumber: pages[pageIndex]!.pageNumber, text };
          parsed = retryParse;
          if (out.imageCount > 0 || out.tableCount > 0) {
            visualByPage.set(candidate.page, {
              imageCount: out.imageCount,
              tableCount: out.tableCount,
              notes: out.visuals.map((v) => v.kind + ": " + (v.description ?? v.category ?? "visual")),
              boxes: out.visuals.map((v) => ({
                kind: v.kind,
                description: v.description,
                category: v.category,
                bbox: v.bbox,
                bboxNormalized: v.bboxNormalized,
              })),
            });
          }
        }
        results.push({
          page: candidate.page,
          reason: candidate.reason,
          status: accepted ? "accepted" : "rejected",
          beforeQuestions,
          afterQuestions: accepted ? retryParse.questions.length : beforeQuestions,
        });
      } catch (e) {
        results.push({
          page: candidate.page,
          reason: candidate.reason,
          status: "failed",
          beforeQuestions,
          afterQuestions: beforeQuestions,
          error: (e instanceof Error ? e.message : String(e)).slice(0, 240),
        });
      }
    }

    return { parsed, results, billedPages };
  }

  /** Parse normalized page texts: bank first, then full-test, then scraper, then legacy. */
  private parseAll(normalizedTexts: PageText[], contentScope: ContentScope): ParsedBundle {
    // Try question bank first (highest quality for known bank PDFs)
    const bank = looksLikeQuestionBank(normalizedTexts) ? parseQuestionBank(normalizedTexts) : null;

    // Then try the full-test parser (handles module headings, scope filtering)
    const fullTest = bank ? null : parseFullTest(normalizedTexts, { contentScope, targetModule: null });

    // Fall back to scraper parser if full-test found nothing useful
    const scraper = !bank && (!fullTest || fullTest.questions.length === 0) ? parseScraperQuestions(normalizedTexts) : null;

    // --- Assemble questions ---
    const questions: AssembledQuestion[] = bank
      ? bank.questions.map((q) => ({
          sourceQuestionNumber: q.sourceQuestionNumber,
          sourceQuestionNumberOrigin: "observed" as const,
          parseFlags: [],
          sourceModuleName: null as string | null,
          sourceModulePosition: null as number | null,
          sourceQuestionId: q.sourceQuestionId,
          pageNumber: q.pageNumber,
          section: q.section,
          questionType: q.questionType,
          prompt: q.prompt,
          passageText: q.passageText,
          choices: q.choices,
          confidence: q.confidence,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          domain: q.domain,
          skill: q.skill,
          difficulty: q.difficulty,
          hasVisualStimulus: q.hasVisualStimulus,
          visualMarkerCount: q.visualMarkerCount,
        }))
      : fullTest && fullTest.questions.length > 0
        ? fullTest.questions
        : scraper && scraper.questions.length > 0
          ? scraper.questions.map((q) => ({
              sourceQuestionNumber: q.sourceQuestionNumber,
              sourceQuestionNumberOrigin: q.sourceQuestionNumberOrigin,
              parseFlags: [...q.parseFlags],
              sourceModuleName: q.sourceModuleName,
              sourceModulePosition: q.sourceModulePosition,
              sourceQuestionId: null as string | null,
              pageNumber: q.pageNumber,
              section: q.section,
              questionType: q.questionType,
              prompt: q.prompt,
              passageText: q.passageText,
              choices: q.choices,
              confidence: q.confidence,
              correctAnswer: null as string | null,
              explanation: null as string | null,
              domain: null as string | null,
              skill: null as string | null,
              difficulty: null as number | null,
              hasVisualStimulus: q.hasVisualStimulus,
              visualMarkerCount: q.visualMarkerCount,
            }))
          : parseQuestions(normalizedTexts).map((q) => ({
              sourceQuestionNumber: q.sourceQuestionNumber,
              sourceQuestionNumberOrigin: "inferred" as const,
              parseFlags: ["legacy_parser_unverified"],
              sourceModuleName: null as string | null,
              sourceModulePosition: null as number | null,
              sourceQuestionId: null as string | null,
              pageNumber: q.pageNumber,
              section: q.section,
              questionType: q.questionType,
              prompt: q.prompt,
              passageText: q.passageText,
              choices: q.choices,
              confidence: q.confidence,
              correctAnswer: null as string | null,
              explanation: null as string | null,
              domain: null as string | null,
              skill: null as string | null,
              difficulty: null as number | null,
              hasVisualStimulus: false,
              visualMarkerCount: 0,
            }));

    const completeness = fullTest && !["question_bank", "screenshot_compilation"].includes(fullTest.documentFamily)
      ? evaluateModuleCompleteness(fullTest.modules)
      : scraper
        ? evaluateModuleCompleteness(scraper.modules)
        : [];
    const fromLegacy = !bank && (!fullTest || fullTest.questions.length === 0) && (!scraper || scraper.questions.length === 0);
    const legacyGlobal = fromLegacy && questions.length > 0 ? answerMapGlobal(parseAnswerKey(normalizedTexts, questions.length)) : null;
    return { bank, fullTest, scraper, questions, completeness, legacyGlobal };
  }

  /**
   * Match answer keys to questions:
   * 1. module-scoped lookup ("Module Name|qNum"),
   * 2. a single global key block mapped positionally onto the still-unmatched
   *    questions in document order (end-of-test "Answer Key 1..N"),
   * 3. generic keys inferred to the module that just ended, mapped within
   *    that module only.
   */
  private matchAnswers(parsed: ParsedBundle): {
    answers: Array<MatchedAnswer | null>;
    keyEntries: number;
    fallbackMatches: number;
    scopedMatches: number;
    unmatchedKeyEntries: UnmatchedKeyDiagnostic[];
  } {
    const questions = parsed.questions;
    if (parsed.bank) {
      const answers = questions.map((q) =>
        q.correctAnswer
          ? {
              answer: q.correctAnswer,
              pageNumber: q.pageNumber,
              sourceText: "Correct Answer: " + q.correctAnswer,
              method: "bank" as const,
              confidence: "high" as const,
            }
          : null,
      );
      return {
        answers,
        keyEntries: questions.filter((q) => q.correctAnswer).length,
        fallbackMatches: 0,
        scopedMatches: answers.filter(Boolean).length,
        unmatchedKeyEntries: [],
      };
    }

    const entries: IndexedKeyEntry[] = [];
    if (parsed.fullTest && parsed.fullTest.questions.length > 0) {
      parsed.fullTest.keyEntries.forEach((e, index) => entries.push({
        index,
        questionNumber: e.questionNumber,
        answer: e.answer,
        pageNumber: e.pageNumber,
        sourceText: e.sourceText,
        moduleName: e.moduleName ?? null,
        inferredModule: e.inferredModule ?? null,
        global: !e.moduleName && !e.inferredModule,
      }));
    } else if (parsed.scraper && parsed.scraper.questions.length > 0) {
      parsed.scraper.keys.forEach((k, index) => entries.push({
        index,
        questionNumber: k.questionNumber,
        answer: k.answer,
        pageNumber: k.pageNumber,
        sourceText: k.sourceText,
        moduleName: !k.global && k.moduleName ? k.moduleName : null,
        inferredModule: k.global && k.moduleName ? k.moduleName : null,
        global: k.global && !k.moduleName,
      }));
    } else if (parsed.legacyGlobal) {
      for (const [n, v] of parsed.legacyGlobal) entries.push({
        index: entries.length,
        questionNumber: n,
        answer: v.answer,
        pageNumber: v.pageNumber,
        sourceText: v.sourceText,
        moduleName: null,
        inferredModule: null,
        global: true,
      });
    }

    const answers: Array<MatchedAnswer | null> = new Array<MatchedAnswer | null>(questions.length).fill(null);
    const usedEntries = new Set<number>();
    const byModule = new Map<string, IndexedKeyEntry[]>();
    const global: IndexedKeyEntry[] = [];
    for (const entry of entries) {
      const module = entry.moduleName ?? entry.inferredModule;
      if (module) {
        if (!byModule.has(module)) byModule.set(module, []);
        byModule.get(module)!.push(entry);
      } else if (entry.global) {
        global.push(entry);
      }
    }

    const questionsByModule = new Map<string, number[]>();
    questions.forEach((q, index) => {
      const module = q.sourceModuleName ?? "";
      if (!questionsByModule.has(module)) questionsByModule.set(module, []);
      questionsByModule.get(module)!.push(index);
    });
    const directEntryBySlot = new Map<string, IndexedKeyEntry[]>();
    for (const entry of entries) {
      if (!entry.moduleName) continue;
      const slot = entry.moduleName + "|" + entry.questionNumber;
      if (!directEntryBySlot.has(slot)) directEntryBySlot.set(slot, []);
      directEntryBySlot.get(slot)!.push(entry);
    }

    questions.forEach((q, i) => {
      const eligible =
        (q.sourceQuestionNumberOrigin === "observed" || q.parseFlags.includes("question_id_recovered_from_neighbors")) &&
        q.sourceQuestionNumber > 0 &&
        !q.parseFlags.some((flag) =>
          flag === "duplicate_source_number_conflict" ||
          flag === "source_question_id_unresolved" ||
          flag === "screenshot_section_unresolved"
        );
      if (!q.sourceModuleName || !eligible) return;
      const candidates = directEntryBySlot.get(q.sourceModuleName + "|" + q.sourceQuestionNumber) ?? [];
      if (candidates.length !== 1) return;
      const entry = candidates[0]!;
      const lowConfidence =
        q.sourceQuestionNumberOrigin !== "observed" ||
        q.parseFlags.includes("question_id_recovered_from_neighbors") ||
        Boolean(entry.inferredModule);
      answers[i] = {
        answer: entry.answer,
        pageNumber: entry.pageNumber,
        sourceText: entry.sourceText,
        method: lowConfidence ? "recovered_question_id" : "question_id",
        confidence: lowConfidence ? "low" : "high",
        keyEntryIndex: entry.index,
      };
      usedEntries.add(entry.index);
    });

    // A module-position mapping is allowed only for an exact one-key-per-
    // question list. Existing exact matches must agree with that same order.
    for (const [module, questionIndexes] of questionsByModule) {
      const moduleEntries = byModule.get(module) ?? [];
      if (!module || moduleEntries.length !== questionIndexes.length) continue;
      const orderAgrees = questionIndexes.every((qi, position) => {
        const matched = answers[qi];
        return !matched || matched.keyEntryIndex === moduleEntries[position]!.index;
      });
      if (!orderAgrees) continue;
      questionIndexes.forEach((qi, position) => {
        if (answers[qi]) return;
        const entry = moduleEntries[position]!;
        answers[qi] = {
          answer: entry.answer,
          pageNumber: entry.pageNumber,
          sourceText: entry.sourceText,
          method: "module_position",
          confidence: "low",
          keyEntryIndex: entry.index,
        };
        usedEntries.add(entry.index);
      });
    }

    // Bare document keys are safe only when their count equals the full
    // question count; a short list never shifts onto subsequent questions.
    const positionalFamily =
      parsed.fullTest?.documentFamily === "full_test" ||
      parsed.fullTest?.documentFamily === "section_test";
    const noPriorMatches = answers.filter(Boolean).length === 0;
    if (
      global.length === questions.length &&
      byModule.size === 0 &&
      positionalFamily &&
      noPriorMatches
    ) {
      questions.forEach((_, qi) => {
        const entry = global[qi]!;
        answers[qi] = {
          answer: entry.answer,
          pageNumber: entry.pageNumber,
          sourceText: entry.sourceText,
          method: "document_position",
          confidence: "low",
          keyEntryIndex: entry.index,
        };
        usedEntries.add(entry.index);
      });
    }

    const scopedMatches = answers.filter(
      (answer) => answer?.method === "question_id" || answer?.method === "recovered_question_id",
    ).length;
    const fallbackMatches = answers.filter((answer) => answer?.confidence === "low").length;
    const unmatchedKeyEntries = entries
      .filter((entry) => !usedEntries.has(entry.index))
      .map((entry): UnmatchedKeyDiagnostic => {
        const module = entry.moduleName ?? entry.inferredModule;
        const targetQuestions = module
          ? questions.filter((q) => q.sourceModuleName === module)
          : questions;
        const targetKeys = module ? byModule.get(module) ?? [] : global;
        return {
          questionNumber: entry.questionNumber,
          moduleName: module,
          pageNumber: entry.pageNumber,
          sourceText: entry.sourceText.slice(0, 160),
          reason: targetQuestions.length > 0 && targetKeys.length !== targetQuestions.length
            ? "question_key_count_mismatch"
            : "no_matching_question",
        };
      });

    return {
      answers,
      keyEntries: entries.length,
      fallbackMatches,
      scopedMatches,
      unmatchedKeyEntries,
    };
  }

  private async finalize(
    parsed: ParsedBundle,
    quality: ReturnType<typeof analyzeTextQuality>,
    original: PageText[],
    method: string,
    pdfBytes: Uint8Array,
    opts: {
      importId: string;
      ocrPages: number;
      ocrSucceeded: number;
      ocrFailed: OcrPageFailure[];
      billedParsePages: number;
      ocrRetryResults?: OcrRetryDiagnostic[];
      visualByPage: Record<number, PageVisualInfo>;
      warnings: string[];
      moduleChecks: ModuleCheck[];
      timings: PhaseTimingsMs;
      startedAt: number;
      finalizeStartedAt: number;
    },
  ): Promise<ProcessResult> {
    const { bank, fullTest, scraper, questions } = parsed;
    const importId = opts.importId;

    // --- Match answer keys (scoped, inferred-module, then global positional) ---
    const {
      answers: matchedAnswers,
      keyEntries,
      fallbackMatches,
      scopedMatches,
      unmatchedKeyEntries,
    } = this.matchAnswers(parsed);
    const keyConfidence = bank
      ? 0.99
      : fullTest && fullTest.questions.length > 0
        ? fullTest.keyConfidence
        : scraper && scraper.questions.length > 0
          ? scraper.keyConfidence
          : parseAnswerKey(original, questions.length).confidence;

    const visualPages = Object.keys(opts.visualByPage).map(Number);
    const draftStatuses: string[] = [];

    // --- OCR box attribution (per-question, document order) ---
    // Page boxes queue in Parse block order; marker-bearing questions consume
    // their marker count first; a lone cue-only question gets the last box.
    const boxQueues = new Map<number, NormBox[]>();
    for (const [pnStr, info] of Object.entries(opts.visualByPage)) {
      boxQueues.set(
        Number(pnStr),
        visualsToNormBoxes((info.boxes ?? []).filter((b) => !isNoiseVisual(b.description)) as ParseVisualBlock[]),
      );
    }
    const boxesForQuestion = new Map<number, NormBox[]>();
    questions.forEach((q, qi) => {
      if (!q.hasVisualStimulus || q.visualMarkerCount <= 0) return;
      const queue = boxQueues.get(q.pageNumber) ?? [];
      if (queue.length === 0) return;
      boxesForQuestion.set(qi, queue.splice(0, Math.min(q.visualMarkerCount, queue.length)));
      boxQueues.set(q.pageNumber, queue);
    });
    const cueOnlyByPage = new Map<number, number[]>();
    questions.forEach((q, qi) => {
      if (boxesForQuestion.has(qi) || q.visualMarkerCount > 0) return;
      const pageVisual = opts.visualByPage[q.pageNumber] ?? null;
      const pageHasVisual = pageVisual !== null && pageVisual.imageCount + pageVisual.tableCount > 0;
      if (!q.hasVisualStimulus && !(pageHasVisual && VISUAL_CUE_RE.test(`${q.prompt} ${q.passageText ?? ""}`))) return;
      if (!cueOnlyByPage.has(q.pageNumber)) cueOnlyByPage.set(q.pageNumber, []);
      cueOnlyByPage.get(q.pageNumber)!.push(qi);
    });
    for (const [pn, qis] of cueOnlyByPage) {
      const queue = boxQueues.get(pn) ?? [];
      if (qis.length === 1 && queue.length === 1) {
        boxesForQuestion.set(qis[0]!, queue.splice(0, 1));
        boxQueues.set(pn, queue);
      }
    }
    // One scale-3 render per page, shared by all its questions.
    const stimulusCache = new Map<number, { sourcePath: string; png: Buffer; W: number; H: number }>();
    const { data: sourceImport, error: sourceError } = await this.svc.from("pdf_imports").select("source_document_id").eq("id", importId).single();
    if (sourceError) throw new Error(`Load source document: ${sourceError.message}`);

    for (let qi = 0; qi < questions.length; qi++) {
      const q = questions[qi]!;
      const draftId = randomUUID();
      const matched = matchedAnswers[qi] ?? null;
      const matchedConfidence = matched
        ? matched.confidence === "low"
          ? Math.min(keyConfidence, 0.65)
          : keyConfidence
        : null;
      // Visual attribution is per-question, not per-page: the parser flags
      // the block that actually contains the "[figure: …]"/"[table: …]"
      // marker. A page-level visual additionally applies only when the
      // question text itself references it (covers table blocks flattened
      // to plain text with no marker). This stops a graph on a shared page
      // from attaching its stimulus image to neighboring text-only questions.
      const pageVisual = opts.visualByPage[q.pageNumber] ?? null;
      const pageHasVisual = pageVisual !== null && pageVisual.imageCount + pageVisual.tableCount > 0;
      const cuesVisual = VISUAL_CUE_RE.test(`${q.prompt} ${q.passageText ?? ""}`);
      const hasVisual = q.hasVisualStimulus || (pageHasVisual && cuesVisual);
      const status = hasVisual ? "needs_review" : matched ? "has_suggested_key" : "missing_key";
      draftStatuses.push(status);
      let stimulusImagePath: string | null = null;
      let stimulusSourcePath: string | null = null;
      let stimulusCropRect: { x: number; y: number; w: number; h: number } | null = null;
      let stimulusCropSource: "auto" | "full_page" = "full_page";
      const stimulusCropStatus = hasVisual ? "pending" : null;
      if (hasVisual) {
        try {
          const stim = await this.uploadStimulus(
            importId,
            stimulusAssetKey(q.section, q.sourceModuleName, q.sourceQuestionNumber > 0 ? q.sourceQuestionNumber : null, draftId),
            q.pageNumber,
            pdfBytes,
            boxesForQuestion.get(qi) ?? [],
            stimulusCache,
          );
          stimulusSourcePath = stim.sourcePath;
          stimulusImagePath = stim.activePath;
          stimulusCropRect = stim.rect;
          stimulusCropSource = stim.source;
        } catch (e) {
          console.warn(`[pipeline] stimulus upload skipped (page ${q.pageNumber}): ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      const { data: draft, error: dErr } = await this.svc
        .from("draft_questions")
        .insert({
          id: draftId,
          pdf_import_id: importId,
          page_number: q.pageNumber,
          section: q.section,
          question_type: q.questionType,
          prompt: q.prompt,
          passage_text: q.passageText,
          domain: q.domain,
          skill: q.skill,
          difficulty: q.difficulty,
          suggested_answer: q.correctAnswer ?? matched?.answer ?? null,
          answer_confidence: matchedConfidence,
          status,
          source_question_number: q.sourceQuestionNumber > 0 ? q.sourceQuestionNumber : null,
          source_module_name: q.sourceModuleName,
          source_module_position: q.sourceModulePosition,
          source_question_id: q.sourceQuestionId,
          explanation: q.explanation,
          has_visual_stimulus: hasVisual,
          stimulus_image_path: stimulusImagePath,
          stimulus_source_image_path: stimulusSourcePath,
          source_document_id: sourceImport.source_document_id,
          source_page_number: q.pageNumber,
          stimulus_crop_rect: stimulusCropRect,
          stimulus_crop_source: stimulusCropSource,
          stimulus_crop_status: stimulusCropStatus,
          parser_metadata: {
            parser: bank ? "rw-question-bank" : "parse5-full-test",
            scope: "full_test",
            ocr_provider: this.parse.name,
            ocr_model: this.ocrModel,
            source_number_origin: q.sourceQuestionNumberOrigin,
            source_global_question_id: q.sourceGlobalQuestionId ?? null,
            parse_flags: q.parseFlags,
            answer_key_state: matched ? "matched" : keyEntries > 0 ? "unmatched" : "not_detected",
            key_match_method: matched?.method ?? null,
            key_match_confidence: matched?.confidence ?? null,
            visual: opts.visualByPage[q.pageNumber] ?? null,
          },
        })
        .select("id")
        .single();
      if (dErr) throw new Error(`insert draft: ${dErr.message}`);

      if (q.choices.length > 0) {
        const { error: cErr } = await this.svc.from("draft_question_choices").insert(
          q.choices.map((c) => ({ draft_question_id: draft.id, label: c.label, text: c.text, position: c.position })),
        );
        if (cErr) throw new Error(`insert draft choices: ${cErr.message}`);
      }

      if (matched) {
        await this.svc.from("draft_answer_keys").insert({
          draft_question_id: draft.id,
          detected_answer: matched.answer,
          confidence: matchedConfidence,
          source_text: matched.sourceText.slice(0, 200),
          source_page: matched.pageNumber,
          status: "suggested",
        });
      }
    }

    const moduleStats = bank
      ? {
          "RW Question Bank": questions.length,
          "Text-only": questions.filter((q) => !q.hasVisualStimulus).length,
          "Visual stimulus": questions.filter((q) => q.hasVisualStimulus).length,
          "Parse errors": bank.errors.length,
        }
      : Object.fromEntries(parsed.completeness.map((c) => [c.name, c.actual]));

    // --- Answer-key status: structural (total + per-module alignment) ---
    const withKey = matchedAnswers.filter(Boolean).length;
    const answerKeySummary: Record<string, { questions: number; keys: number; status: string }> = {};
    questions.forEach((q, qi) => {
      const mod = q.sourceModuleName ?? (bank ? "Question Bank" : "Unknown");
      const s = answerKeySummary[mod] ?? { questions: 0, keys: 0, status: "missing" };
      s.questions += 1;
      if (matchedAnswers[qi]) s.keys += 1;
      answerKeySummary[mod] = s;
    });
    for (const s of Object.values(answerKeySummary)) {
      s.status = s.keys === 0 ? "missing" : s.keys >= s.questions ? "complete" : "partial";
    }
    const { structural, warnings: keyWarnings } = assessAnswerKey({
      bank: !!bank,
      questionCount: questions.length,
      matchedCount: withKey,
      fallbackMatches,
      scopedMatches,
      keyEntries,
      keySlots: collectKeySlots(parsed),
      summary: answerKeySummary,
    });
    // DB column only allows complete/partial/missing — low_confidence lands
    // as partial there; text_quality keeps the structural value + warnings.
    const answerKeyStatus: KeyStatus =
      structural === "complete" ? "complete" : structural === "missing" ? "missing" : "partial";

    const incompleteModules = parsed.completeness
      .filter((c) => !c.complete)
      .map((c) => ({ module: c.name, expected: c.expected, actual: c.actual }));
    const visualReviewQuestions = draftStatuses.filter((s) => s === "needs_review").length;

    const timingsMs: PhaseTimingsMs = {
      ...opts.timings,
      finalizeMs: Date.now() - opts.finalizeStartedAt,
      totalMs: Date.now() - opts.startedAt,
    };
    const qualityPayload = {
      ...quality.metrics,
      drafts: questions.length,
      key_entries: keyEntries,
      key_confidence: keyConfidence,
      modules: moduleStats,
      ocr_provider: this.parse.name,
      ocr_model: this.ocrModel,
      ocr_pages: opts.ocrPages,
      ocr_pages_succeeded: opts.ocrSucceeded,
      ocr_pages_failed: opts.ocrFailed,
      billed_parse_pages: opts.billedParsePages,
      visual_review_questions: visualReviewQuestions,
      visual_pages: visualPages,
      timings_ms: timingsMs,
      parser_warnings: opts.warnings,
      document_family: bank ? "question_bank" : fullTest?.documentFamily ?? "full_test",
      inferred_question_numbers: questions.filter((q) => q.sourceQuestionNumberOrigin === "inferred").length,
      parser_flag_counts: questions.reduce((counts, q) => {
        for (const flag of q.parseFlags) counts[flag] = (counts[flag] ?? 0) + 1;
        return counts;
      }, {} as Record<string, number>),
      answer_key_source:
        keyEntries > 0
          ? "parsed"
          : original.some((page) => /answer\s*keys?|correct\s*answer/i.test(page.text))
            ? "present_but_unparsed"
            : "not_detected",
      module_checks: opts.moduleChecks,
      incomplete_modules: incompleteModules,
      answer_key_status: structural,
      answer_key_summary: answerKeySummary,
      answer_key_warnings: keyWarnings,
      key_fallback_matches: fallbackMatches,
      key_scoped_matches: scopedMatches,
      question_issues: questions
        .filter((q) => q.parseFlags.length > 0 || q.sourceQuestionNumberOrigin === "inferred")
        .map((q): QuestionIssueDiagnostic => ({
          pageNumber: q.pageNumber,
          moduleName: q.sourceModuleName,
          questionNumber: q.sourceQuestionNumber > 0 ? q.sourceQuestionNumber : null,
          prompt: q.prompt.slice(0, 180),
          flags: q.parseFlags.length > 0 ? [...q.parseFlags] : ["question_number_inferred"],
        })),
      ocr_retry_results: opts.ocrRetryResults ?? [],
      unmatched_key_entries: unmatchedKeyEntries,
    };
    const { error: finErr } = await this.svc
      .from("pdf_imports")
      .update({
        status: "completed",
        page_count: original.length,
        extraction_method: method,
        text_quality: qualityPayload,
      })
      .eq("id", importId);
    if (finErr) {
      // Older DBs whose extraction_method check predates Parse OCR reject
      // 'parse_ocr'. Retry without the method so the import still lands.
      console.warn(`[pipeline] finalize update failed (${finErr.message}); retrying without extraction_method`);
      const { error: retryErr } = await this.svc
        .from("pdf_imports")
        .update({ status: "completed", page_count: original.length, text_quality: qualityPayload })
        .eq("id", importId);
      if (retryErr) throw new Error(`finalize import: ${retryErr.message}`);
    }

    // Dedicated answer-key columns (added by migration 20260916000000).
    // Best-effort: the import must not fail if the migration is not applied yet.
    try {
      await this.svc
        .from("pdf_imports")
        .update({ answer_key_status: answerKeyStatus, answer_key_summary: answerKeySummary })
        .eq("id", importId);
    } catch (e) {
      console.warn(`[pipeline] answer-key columns update skipped: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Retain the PDF for review and Full Reprocess. Source storage is cleaned
    // only after generate-test commits the complete test.

    const report: IngestReport = {
      file: null,
      importId,
      status: "completed",
      totalPages: original.length,
      ocrProvider: this.parse.name,
      ocrModel: this.ocrModel,
      ocrPagesAttempted: opts.ocrPages,
      ocrPagesSucceeded: opts.ocrSucceeded,
      ocrPagesFailed: opts.ocrFailed,
      billedParsePages: opts.billedParsePages,
      ocrRetryResults: opts.ocrRetryResults ?? [],
      finalQuestionsByModule: countByModule(questions),
      moduleChecks: opts.moduleChecks,
      visualReviewQuestions,
      visualPages,
      answerKeyStatus: answerKeyStatus as KeyStatus,
      structuralKeyStatus: structural,
      answerKeyByModule: answerKeySummary,
      answerKeyWarnings: keyWarnings,
      warnings: opts.warnings,
      timingsMs,
    };

    return {
      importId,
      status: "completed",
      pages: original.length,
      drafts: questions.length,
      suggestedKeys: withKey,
      method,
      report,
    };
  }

  private async writePages(importId: string, pages: PageText[]): Promise<void> {
    // Best-effort: some DBs predate the ocr_status/needs_ocr columns.
    try {
      for (const p of pages) {
        const words = p.text.trim().split(/\s+/).filter(Boolean).length;
        await this.svc.from("pdf_import_pages").upsert(
          {
            pdf_import_id: importId,
            page_number: p.pageNumber,
            extracted_text: p.text,
            word_count: words,
            needs_ocr: false,
            ocr_status: "completed",
          },
          { onConflict: "pdf_import_id,page_number" },
        );
      }
    } catch (e) {
      console.warn(`[pipeline] writePages skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Upload the immutable full-page source (scale 3, shared per page) plus,
   * when OCR boxes were attributed, the auto-crop cut from that same render.
   * Every guard failure degrades to the full-page image — never a bad crop.
   */
  private async uploadStimulus(
    importId: string,
    sourceQuestionId: string,
    pageNumber: number,
    pdfBuffer: Uint8Array,
    boxes: NormBox[],
    cache: Map<number, { sourcePath: string; png: Buffer; W: number; H: number }>,
  ): Promise<{
    activePath: string | null;
    sourcePath: string | null;
    rect: { x: number; y: number; w: number; h: number } | null;
    source: "auto" | "full_page";
  }> {
    let entry = cache.get(pageNumber);
    if (!entry) {
      const png = await renderPagePng(pdfBuffer, pageNumber, 3);
      // Dimensions are best-effort: an undecodable render still uploads as
      // the full-page source (auto-crop is skipped without them).
      let W = 0;
      let H = 0;
      try {
        const { loadImage } = await import("@napi-rs/canvas");
        const img = await loadImage(png);
        W = img.width;
        H = img.height;
      } catch {
        console.warn(`[pipeline] stimulus render undecodable (page ${pageNumber}); auto-crop skipped`);
      }
      entry = { sourcePath: "", png, W, H };
      cache.set(pageNumber, entry);
    }
    if (boxes.length === 0 || entry.W <= 0 || entry.H <= 0) {
      return { activePath: null, sourcePath: null, rect: null, source: "full_page" };
    }
    const decision = decideCrop(boxes, entry.W, entry.H);
    if (decision.kind !== "crop") {
      console.log(`[pipeline] auto-crop fallback (page ${pageNumber}): ${decision.reason}`);
      return { activePath: null, sourcePath: null, rect: null, source: "full_page" };
    }
    const cropBuf = await cropPng(entry.png, decision.rect);
    if ((await inkRatio(cropBuf)) < CROP_MIN_INK) {
      console.log(`[pipeline] auto-crop rejected as blank (page ${pageNumber})`);
      return { activePath: null, sourcePath: null, rect: null, source: "full_page" };
    }
    const cropPath = `imports/${importId}/stimuli/${sourceQuestionId}-auto-crop.png`;
    const { error: cErr } = await this.svc.storage.from("question-assets").upload(cropPath, cropBuf, {
      contentType: "image/png",
      upsert: true,
    });
    if (cErr) throw new Error(`upload auto-crop ${cropPath}: ${cErr.message}`);
    return { activePath: cropPath, sourcePath: null, rect: decision.rect, source: "auto" };
  }

  private async download(storagePath: string): Promise<ArrayBuffer> {
    const { data, error } = await this.svc.storage.from("pdf-imports").download(storagePath);
    if (error || !data) throw new Error(`download ${storagePath}: ${error?.message ?? "no data"}`);
    return data.arrayBuffer();
  }
}
