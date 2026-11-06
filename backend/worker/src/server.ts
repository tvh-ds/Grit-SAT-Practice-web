import { createHash, timingSafeEqual } from "node:crypto";
import express from "express";
import { loadConfig } from "./config";
import { Pipeline } from "./pipeline";
import { AiIngestionReviewService } from "./aiReview";
import { createSupabase } from "./supabase";
import { retryPendingImportStorageCleanup } from "../../supabase/functions/_shared/importStorageCleanup";
import { installSourceRoutes } from "./sourceRoutes";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function constantTimeEquals(actual: string, expected: string): boolean {
  return timingSafeEqual(digest(actual), digest(expected));
}

export function createApp(config: ReturnType<typeof loadConfig>) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  const pipeline = new Pipeline(config);
  const aiReview = new AiIngestionReviewService(config);
  const storageClient = createSupabase(config);

  function kickAiReview(): void {
    setImmediate(() => {
      void aiReview.claimNext()
        .then((job) => job ? aiReview.processJob(job) : null)
        .catch((error) => console.error(`[ai-review] background job failed: ${error instanceof Error ? error.message : String(error)}`));
    });
  }

  function requireWorkerAuth(req: express.Request, res: express.Response): boolean {
    const header = req.get("Authorization") ?? "";
    if (!constantTimeEquals(header, `Bearer ${config.workerAuthToken}`)) {
      res.status(401).json({ error: "Unauthorized" });
      return false;
    }
    return true;
  }

  installSourceRoutes(app, storageClient, requireWorkerAuth);

  app.get("/health", (_req, res) => {
    res.json({ ok: true, pollIntervalMs: config.pollIntervalMs, aiIngestionReviewEnabled: config.aiIngestionReviewEnabled });
  });

  app.post("/process", async (req, res) => {
    if (!requireWorkerAuth(req, res)) return;
    const { import_id } = req.body ?? {};
    if (typeof import_id !== "string" || !import_id) {
      res.status(422).json({ error: "import_id (uuid string) required" });
      return;
    }
    try {
      const result = await pipeline.processImport(import_id);
      const review = result.status === "completed" ? await aiReview.enqueue(import_id).catch((error) => {
        console.error(`[ai-review] enqueue failed: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }) : null;
      if (review) kickAiReview();
      res.json({ ...result, ai_review_job: review });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: message });
    }
  });

  app.post("/jobs/poll", async (_req, res) => {
    if (!requireWorkerAuth(_req, res)) return;
    try {
      await retryPendingImportStorageCleanup(storageClient);
      const next = await pipeline.claimNextPending();
      if (next) {
        const result = await pipeline.processImport(next);
        const review = result.status === "completed" ? await aiReview.enqueue(next).catch(() => null) : null;
        if (review) kickAiReview();
        res.json({ processed: true, kind: "import", result: { ...result, ai_review_job: review } });
        return;
      }
      const reviewJob = await aiReview.claimNext();
      if (!reviewJob) {
        res.json({ processed: false });
        return;
      }
      const result = await aiReview.processJob(reviewJob);
      res.json({ processed: true, kind: "ai_review", result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: message });
    }
  });

  app.post("/review", async (req, res) => {
    if (!requireWorkerAuth(req, res)) return;
    const { import_id, force } = req.body ?? {};
    if (typeof import_id !== "string" || !/^[0-9a-f-]{36}$/i.test(import_id)) {
      res.status(422).json({ error: "import_id (uuid string) required" });
      return;
    }
    try {
      const job = await aiReview.enqueue(import_id, force === true);
      if (!job) {
        res.status(200).json({
          job: null,
          message: config.aiIngestionReviewEnabled
            ? "Deterministic review completed; no minor-risk questions require AI repair"
            : "Deterministic review completed; AI repair is disabled until COHERE_REVIEW_API_KEY is configured",
        });
        return;
      }
      res.status(job.existing ? 200 : 202).json({ job });
      kickAiReview();
    } catch (e) {
      console.error("[ai-review] review enqueue failed", e);
      res.status(500).json({ error: "Unable to enqueue AI review" });
    }
  });

  return app;
}

function main() {
  const config = loadConfig();
  const app = createApp(config);
  app.listen(config.port, () => {
    console.log(`[worker] listening on :${config.port}`);
  });
}

if (process.argv[1] && process.argv[1].includes("server")) {
  main();
}
