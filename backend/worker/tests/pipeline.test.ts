import { describe, it, expect, beforeEach, vi } from "vitest";
import PDFDocument from "pdfkit";
import { Pipeline, assessAnswerKey, type PipelineConfig } from "../src/pipeline";
import { stimulusAssetKey } from "../src/stimulusAssetKey";
import { createCanvas } from "@napi-rs/canvas";

let mockClient: Record<string, unknown>;

vi.mock("../src/supabase", () => ({
  createSupabase: () => mockClient,
}));

vi.mock("../src/renderPage", () => ({
  renderPagePng: async (_pdf: Uint8Array, page: number, scale: number) => Buffer.from("fake-page-" + page + "-scale-" + scale),
}));

const parseState = vi.hoisted(() => ({
  text: "",
  visuals: [] as Array<{ kind: "image" | "table"; description: string | null; category: string | null; bbox: null; bboxNormalized: null }>,
  failWith: null as string | null,
  retryPage: null as number | null,
  retryText: null as string | null,
  retryError: null as string | null,
  retryCalls: 0,
}));

vi.mock("../src/ocr", () => ({
  PARSE_RENDER_SCALE: 3,
  createParseProvider: () => ({
    name: "cohere_parse",
    model: "parse-v5.0",
    parseImage: async (image: Buffer) => {
      const label = image.toString("utf8");
      const retry = label.includes("-scale-4");
      if (retry) {
        parseState.retryCalls += 1;
        const page = Number(label.match(/fake-page-(\d+)/)?.[1]);
        if (parseState.retryError && page === parseState.retryPage) throw new Error(parseState.retryError);
        if (parseState.retryText !== null && page === parseState.retryPage) {
          return {
            text: parseState.retryText,
            visuals: parseState.visuals,
            tableCount: parseState.visuals.filter((v) => v.kind === "table").length,
            imageCount: parseState.visuals.filter((v) => v.kind === "image").length,
            textBlockCount: 1,
            billedPages: 1,
          };
        }
      }
      if (parseState.failWith) throw new Error(parseState.failWith);
      return {
        text: parseState.text,
        visuals: parseState.visuals,
        tableCount: parseState.visuals.filter((v) => v.kind === "table").length,
        imageCount: parseState.visuals.filter((v) => v.kind === "image").length,
        textBlockCount: 1,
        billedPages: 1,
      };
    },
  }),
  fitImageForParse: async (png: Buffer) => ({ image: png, mime: "image/png", width: 10, height: 10, pixels: 100 }),
  parsePageTiled: async (provider: { parseImage: (image: Buffer, mime: "image/png") => Promise<unknown> }, fitted: { image: Buffer; mime: "image/png" }) =>
    provider.parseImage(fitted.image, fitted.mime),
}));

function chainable(tables: Record<string, any[]>, table: string) {
  const where: Record<string, unknown> = {};
  const rows = () =>
    (tables[table] ?? []).filter((r) =>
      Object.entries(where).every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v)),
    );
  const api: Record<string, unknown> = {
    select: () => api,
    eq: (col: string, val: unknown) => {
      where[col] = val;
      return api;
    },
    in: (col: string, vals: unknown[]) => {
      where[col] = vals;
      return api;
    },
    order: () => api,
    limit: () => api,
    insert: (rows: unknown) => {
      tables[table] = (tables[table] ?? []).concat(Array.isArray(rows) ? rows : [rows]);
      return api;
    },
    upsert: (rows: unknown) => {
      tables[table] = (tables[table] ?? []).concat(Array.isArray(rows) ? rows : [rows]);
      return api;
    },
    update: (patch: unknown) => {
      const target = rows();
      if (target.length) Object.assign(target[0], patch as object);
      else tables[table] = [patch];
      return api;
    },
    delete: () => api,
    single: async () => ({ data: rows()[0] ?? null, error: null }),
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
  };
  return api;
}

function makePdf(lines: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    for (const line of lines) doc.text(line);
    doc.end();
  });
}

const FULL_PDF_LINES = [
  "Reading and Writing",
  "Passage: The canal system transformed inland trade, cutting journey times from weeks to days and slashing costs.",
  "1. Which choice best states the main idea of the passage?",
  "A. Canals were expensive.",
  "B. The canal system changed commerce.",
  "C. Merchants built the canals.",
  "D. Ports closed after.",
  "2. As used in the passage, transformed most nearly means",
  "A. altered",
  "B. removed",
  "C. frozen",
  "D. hidden",
  "Math",
  "1. If 3x + 7 = 22, what is the value of x?",
  "A. 4",
  "B. 5",
  "C. 6",
  "D. 7",
  "2. If 2(x + 3) = x + 10, what is the value of x?",
  "Answer Key",
  "1. B",
  "2. A",
  "3. B",
  "4. 4",
];

const config: PipelineConfig = {
  supabaseUrl: "http://localhost:54321",
  supabaseServiceKey: "test",
  cohereApiKey: "test-key",
  ocrProvider: "cohere_parse",
  ocrMode: "auto",
};

describe("Pipeline (Parse 5)", () => {
  let tables: Record<string, any[]>;
  let pdfBuffer: Buffer;
  let uploads: string[];
  let removals: string[];

  beforeEach(async () => {
    tables = {};
    uploads = [];
    removals = [];
    pdfBuffer = await makePdf(FULL_PDF_LINES);
    parseState.text = FULL_PDF_LINES.join("\n");
    parseState.visuals = [];
    parseState.failWith = null;
    parseState.retryPage = null;
    parseState.retryText = null;
    parseState.retryError = null;
    parseState.retryCalls = 0;
    mockClient = {
      from: (t: string) => chainable(tables, t),
      storage: {
        from: (_bucket: string) => ({
          download: async () => ({ data: new Blob([pdfBuffer]), error: null }),
          upload: async (path: string) => {
            uploads.push(path);
            return { data: { path }, error: null };
          },
          createSignedUrl: async () => ({ data: { signedUrl: "http://x/page.png" }, error: null }),
          remove: async (paths: string[]) => { removals.push(...paths); return { data: {}, error: null }; },
        }),
      },
    };
  });

  it("OCRs the full PDF with Parse 5 then parses drafts", async () => {
    tables["pdf_imports"] = [{ id: "imp-1", storage_path: "uploads/t.pdf", original_filename: "t.pdf", status: "uploaded" }];

    const pipeline = new Pipeline(config);
    const result = await pipeline.processImport("imp-1");

    expect(result.status).toBe("completed");
    expect(removals).toEqual([]); // The source PDF must survive until test generation.
    expect(result.method).toBe("parse_ocr");
    expect(result.pages).toBeGreaterThanOrEqual(1);
    expect(result.drafts).toBeGreaterThanOrEqual(4);
    expect(result.suggestedKeys).toBeGreaterThanOrEqual(3);

    expect(tables["pdf_imports"][0].status).toBe("completed");
    expect(tables["draft_questions"]?.length).toBe(result.drafts);
    expect(tables["pdf_import_pages"]?.length).toBe(result.pages);

    const mathDraft = tables["draft_questions"]!.find((d) => d.section === "math");
    expect(mathDraft).toBeDefined();
    const keyed = tables["draft_questions"]!.filter((d) => d.status === "has_suggested_key");
    expect(keyed.length).toBeGreaterThanOrEqual(3);

    expect(result.report?.ocrProvider).toBe("cohere_parse");
    expect(result.report?.ocrModel).toBe("parse-v5.0");
    expect(result.report?.ocrPagesSucceeded).toBe(result.pages);
    expect(result.report?.moduleChecks.length).toBeGreaterThan(0);
    expect(result.report?.timingsMs.ocrMs).toBeGreaterThanOrEqual(0);
  });

  it("flags only the question owning the visual, not page neighbors", async () => {
    tables["pdf_imports"] = [{ id: "imp-2", storage_path: "uploads/v.pdf", original_filename: "v.pdf", status: "uploaded" }];
    parseState.text = [
      "Math Module 1",
      "22 QUESTIONS",
      "1",
      "If $x + 5 = 95$, what value of $x$ is the solution to the given equation?",
      "A. 90",
      "B. 100",
      "2",
      "[figure: The graph shows height over time with axes and gridlines described at length.]",
      "The graph shows height over time. Which statement is best supported?",
      "A. It rises",
      "B. It falls",
    ].join("\n");
    parseState.visuals = [{ kind: "image", description: "graph", category: "other", bbox: null, bboxNormalized: null }];

    const pipeline = new Pipeline(config);
    const result = await pipeline.processImport("imp-2");

    expect(result.status).toBe("completed");
    const drafts = tables["draft_questions"]!;
    expect(drafts).toHaveLength(2);
    const visual = drafts.filter((d) => d.has_visual_stimulus);
    const plain = drafts.filter((d) => !d.has_visual_stimulus);
    expect(visual).toHaveLength(1);
    expect(plain).toHaveLength(1);
    expect(visual[0].status).toBe("needs_review");
    expect(visual[0].stimulus_image_path).toBeNull();
    expect(visual[0].stimulus_source_image_path).toBeNull();
    expect(visual[0].source_page_number).toBe(1);
    expect(uploads).toEqual([]);
    expect(visual[0].prompt).not.toContain("[figure");
    expect(visual[0].prompt).toContain("Which statement is best");
    expect(plain[0].stimulus_image_path).toBeFalsy();
    expect(plain[0].status).not.toBe("needs_review");
  });

  it("attributes page visuals via text cues for flattened tables", async () => {
    tables["pdf_imports"] = [{ id: "imp-2b", storage_path: "uploads/t.pdf", original_filename: "t.pdf", status: "uploaded" }];
    parseState.text = [
      "Math Module 1",
      "22 QUESTIONS",
      "1",
      "The table shows values. Which choice completes the statement?",
      "Value 10 20",
      "A. 10",
      "B. 20",
    ].join("\n");
    parseState.visuals = [{ kind: "table", description: null, category: "table", bbox: null, bboxNormalized: null }];

    const pipeline = new Pipeline(config);
    const result = await pipeline.processImport("imp-2b");

    expect(result.status).toBe("completed");
    const drafts = tables["draft_questions"]!;
    expect(drafts).toHaveLength(1);
    expect(drafts[0].has_visual_stimulus).toBe(true);
    expect(drafts[0].status).toBe("needs_review");
  });

  it("matches a missing-number question by module position only when all module key counts align", async () => {
    tables["pdf_imports"] = [{ id: "imp-key-gap", storage_path: "uploads/gap.pdf", original_filename: "gap.pdf", status: "uploaded" }];
    parseState.text = [
      "Math Module 1",
      "22 QUESTIONS",
      "1. What is 2 + 2?",
      "A. 3",
      "B. 4",
      "C. 5",
      "D. 6",
      "If 3x + 7 = 22, what is the value of x?",
      "A. 4",
      "B. 5",
      "C. 6",
      "D. 7",
      "Math Module 1 Answers",
      "1. B",
      "2. B",
    ].join("\n");

    const pipeline = new Pipeline(config);
    await pipeline.processImport("imp-key-gap");

    const drafts = tables["draft_questions"]!;
    expect(drafts).toHaveLength(2);
    expect(drafts[0].suggested_answer).toBe("B");
    expect(drafts[1].suggested_answer).toBe("B");
    expect(drafts[1].parser_metadata.source_number_origin).toBe("inferred");
    expect(drafts[1].parser_metadata.key_match_method).toBe("module_position");
    expect(drafts[1].parser_metadata.key_match_confidence).toBe("low");
    expect(drafts[1].answer_confidence).toBeLessThanOrEqual(0.65);
    expect(drafts[1].status).toBe("has_suggested_key");
  });

  it("does not shift a short module key list onto an unnumbered question", async () => {
    tables["pdf_imports"] = [{ id: "imp-short-key-list", storage_path: "uploads/short.pdf", original_filename: "short.pdf", status: "uploaded" }];
    parseState.text = [
      "Math Module 1",
      "22 QUESTIONS",
      "1. What is 2 + 2?",
      "A. 3",
      "B. 4",
      "C. 5",
      "D. 6",
      "If 3x + 7 = 22, what is the value of x?",
      "A. 4",
      "B. 5",
      "C. 6",
      "D. 7",
      "Math Module 1 Answers",
      "1. B",
    ].join("\n");

    const pipeline = new Pipeline(config);
    await pipeline.processImport("imp-short-key-list");

    const drafts = tables["draft_questions"]!;
    expect(drafts).toHaveLength(2);
    expect(drafts[0].suggested_answer).toBe("B");
    expect(drafts[1].suggested_answer).toBeNull();
    expect(drafts[1].status).toBe("missing_key");
  });

  it("retries a near-complete module page once at higher resolution when it recovers a question", async () => {
    tables["pdf_imports"] = [{ id: "imp-retry", storage_path: "uploads/retry.pdf", original_filename: "retry.pdf", status: "uploaded" }];
    const original = ["Math Module 1", "22 QUESTIONS", ...Array.from(
      { length: 21 },
      (_, i) => (i + 1) + ". What is the value of x + " + (i + 1) + "?",
    )].join("\n");
    parseState.text = original;
    parseState.retryPage = 1;
    parseState.retryText = original + "\n22. What is the value of x + 22?";

    const pipeline = new Pipeline(config);
    const result = await pipeline.processImport("imp-retry");

    expect(result.status).toBe("completed");
    expect(result.drafts).toBe(22);
    expect(parseState.retryCalls).toBe(1);
    expect(tables["pdf_import_pages"]![0].extracted_text).toContain("x + 22");
    expect(tables["pdf_imports"][0].text_quality.ocr_retry_results).toEqual([
      expect.objectContaining({ page: 1, status: "accepted", beforeQuestions: 21, afterQuestions: 22 }),
    ]);
  });

  it("keeps the initial parse when a bounded retry fails", async () => {
    tables["pdf_imports"] = [{ id: "imp-retry-fail", storage_path: "uploads/retry-fail.pdf", original_filename: "retry-fail.pdf", status: "uploaded" }];
    parseState.text = ["Math Module 1", "22 QUESTIONS", ...Array.from(
      { length: 21 },
      (_, i) => (i + 1) + ". What is the value of x + " + (i + 1) + "?",
    )].join("\n");
    parseState.retryPage = 1;
    parseState.retryError = "temporary Parse error";

    const pipeline = new Pipeline(config);
    const result = await pipeline.processImport("imp-retry-fail");

    expect(result.status).toBe("completed");
    expect(result.drafts).toBe(21);
    expect(parseState.retryCalls).toBe(1);
    expect(tables["pdf_imports"][0].text_quality.ocr_retry_results).toEqual([
      expect.objectContaining({ page: 1, status: "failed", error: "temporary Parse error" }),
    ]);
  });

  it("can recover an import when every first-pass page OCR call failed", async () => {
    tables["pdf_imports"] = [{ id: "imp-all-failed-retry", storage_path: "uploads/all-failed.pdf", original_filename: "all-failed.pdf", status: "uploaded" }];
    const recoveredText = ["Math Module 1", "22 QUESTIONS", ...Array.from(
      { length: 22 },
      (_, i) => (i + 1) + ". What is the value of x + " + (i + 1) + "?",
    )].join("\n");
    parseState.failWith = "temporary OCR service error";
    parseState.retryPage = 1;
    parseState.retryText = recoveredText;

    const pipeline = new Pipeline(config);
    const result = await pipeline.processImport("imp-all-failed-retry");

    expect(result.status).toBe("completed");
    expect(result.drafts).toBe(22);
    expect(result.report?.ocrPagesSucceeded).toBe(0);
    expect(result.report?.ocrRetryResults).toEqual([
      expect.objectContaining({ page: 1, status: "accepted", afterQuestions: 22 }),
    ]);
  });

  it("fails when Parse OCR yields no readable modules", async () => {
    tables["pdf_imports"] = [{ id: "imp-3", storage_path: "uploads/empty.pdf", original_filename: "empty.pdf", status: "uploaded" }];
    parseState.text = "tiny";

    const pipeline = new Pipeline(config);
    const result = await pipeline.processImport("imp-3");

    expect(result.status).toBe("failed");
    expect(tables["pdf_imports"][0].status).toBe("failed");
    expect(result.drafts).toBe(0);
    expect(result.message).toMatch(/No readable SAT modules detected after Parse OCR/);
  });

  it("fails fast on Parse auth errors", async () => {
    tables["pdf_imports"] = [{ id: "imp-4", storage_path: "uploads/a.pdf", original_filename: "a.pdf", status: "uploaded" }];
    parseState.failWith = "Cohere Parse auth failure (HTTP 401): invalid key (check COHERE_API_KEY)";

    const pipeline = new Pipeline(config);
    const result = await pipeline.processImport("imp-4");

    expect(result.status).toBe("failed");
    expect(result.message).toMatch(/auth failure/);
  });

  it("rejects unprocessable statuses", async () => {
    tables["pdf_imports"] = [{ id: "imp-5", storage_path: "x.pdf", original_filename: "x", status: "parsing" }];
    const pipeline = new Pipeline(config);
    await expect(pipeline.processImport("imp-5")).rejects.toThrow(/not processable/);
  });

  it("assesses answer keys structurally: total + per-module alignment", () => {
    const full = {
      "Math Module 1": { questions: 22, keys: 22, status: "complete" },
      "Math Module 2": { questions: 22, keys: 22, status: "complete" },
    };
    const slots = (mod: string, n: number) => Array.from({ length: n }, (_, i) => `${mod}|${i + 1}`);
    expect(
      assessAnswerKey({
        bank: false,
        questionCount: 44,
        matchedCount: 44,
        fallbackMatches: 0,
        scopedMatches: 44,
        keyEntries: 44,
        keySlots: [...slots("Math Module 1", 22), ...slots("Math Module 2", 22)],
        summary: full,
      }).structural,
    ).toBe("complete");

    const pos = assessAnswerKey({
      bank: false,
      questionCount: 44,
      matchedCount: 44,
      fallbackMatches: 44,
      scopedMatches: 0,
      keyEntries: 44,
      keySlots: [],
      summary: full,
    });
    expect(pos.structural).toBe("low_confidence");
    expect(pos.warnings.join(" ")).toMatch(/position/);

    const dup = assessAnswerKey({
      bank: false,
      questionCount: 44,
      matchedCount: 44,
      fallbackMatches: 0,
      scopedMatches: 44,
      keyEntries: 45,
      keySlots: [...slots("Math Module 1", 22), ...slots("Math Module 2", 22), "Math Module 1|5"],
      summary: full,
    });
    expect(dup.structural).toBe("low_confidence");
    expect(dup.warnings.join(" ")).toMatch(/duplicate/);

    const part = assessAnswerKey({
      bank: false,
      questionCount: 44,
      matchedCount: 22,
      fallbackMatches: 0,
      scopedMatches: 22,
      keyEntries: 22,
      keySlots: slots("Math Module 1", 22),
      summary: {
        "Math Module 1": { questions: 22, keys: 22, status: "complete" },
        "Math Module 2": { questions: 22, keys: 0, status: "missing" },
      },
    });
    expect(part.structural).toBe("partial");

    const missing = assessAnswerKey({
      bank: false,
      questionCount: 44,
      matchedCount: 0,
      fallbackMatches: 0,
      scopedMatches: 0,
      keyEntries: 0,
      keySlots: [],
      summary: {},
    });
    expect(missing.structural).toBe("missing");
  });

  it("claims the next pending import", async () => {
    tables["pdf_imports"] = [
      { id: "a", storage_path: "x", original_filename: "x", status: "completed" },
      { id: "b", storage_path: "y", original_filename: "y", status: "uploaded" },
    ];
    const pipeline = new Pipeline(config);
    expect(await pipeline.claimNextPending()).toBe("b");
  });

  it("keeps same-number crops separate across all four modules and on a shared page", async () => {
    const canvas = createCanvas(1000, 1400);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 1000, 1400);
    ctx.fillStyle = "black";
    ctx.fillRect(100, 200, 700, 900);
    const png = Buffer.from(await canvas.encode("png"));
    const cache = new Map([[1, { sourcePath: "page-1.png", png, W: 1000, H: 1400 }]]);
    const pipeline = new Pipeline(config);
    const paths: string[] = [];
    for (const [i, module] of ["Reading and Writing Module 1", "Reading and Writing Module 2", "Math Module 1", "Math Module 2", "Math Module 2"].entries()) {
      const key = stimulusAssetKey(module.startsWith("Math") ? "math" : "reading_writing", module, 10, `draft-${i}`);
      const result = await (pipeline as any).uploadStimulus("imp", key, 1, new Uint8Array(), [{ x1: .1, y1: .2, x2: .6, y2: .5 }], cache);
      paths.push(result.activePath);
      expect(result.source).toBe("auto");
      expect(result.sourcePath).toBeNull();
    }
    expect(new Set(paths).size).toBe(5);
    expect(paths[0]).toContain("/rw-1-q10-draft-0-auto-crop.png");
    expect(paths[3]).toContain("/math-2-q10-draft-3-auto-crop.png");
    expect(uploads).toEqual(paths);
  });
});
