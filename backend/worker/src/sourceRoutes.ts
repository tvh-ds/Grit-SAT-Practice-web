import type express from "express";
import { driveInventory, driveSource, registerSource, draftSourcePage, importPdf, sha256 } from "./sourceDocuments";
import { renderPagePng } from "./renderPage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function installSourceRoutes(app: express.Express, client: any, auth: (req: express.Request, res: express.Response) => boolean) {
  app.get("/drive/files", async (req, res) => {
    if (!auth(req, res)) return;
    try {
      const query = String(req.query.q ?? "").slice(0, 200).toLowerCase();
      const files = (await driveInventory()).filter(f => !query || [...f.folders, f.name].join("/").toLowerCase().includes(query));
      res.json({ files: files.slice(0, 100), total: files.length });
    } catch (e) { console.error("[sources] Drive inventory failed", e instanceof Error ? e.message : "Error"); res.status(503).json({ error: "Drive access is not configured or available on the processing worker" }); }
  });

  app.post("/drive/register", async (req, res) => {
    if (!auth(req, res)) return;
    try {
      const fileId = req.body?.file_id;
      if (typeof fileId !== "string" || !/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) { res.status(422).json({ error: "Select a valid Drive PDF" }); return; }
      // Resolve only within the configured original folder tree.
      const file = (await driveInventory()).find(f => f.id === fileId);
      if (!file) { res.status(404).json({ error: "PDF not found in the configured Drive folders" }); return; }
      const bytes = await driveSource().download(file);
      const importId = req.body?.import_id;
      if (importId !== undefined) {
        if (!UUID.test(importId)) { res.status(422).json({ error: "Invalid import" }); return; }
        const { data: imp, error } = await client.from("pdf_imports").select("*").eq("id", importId).single();
        if (error || !imp) { res.status(404).json({ error: "Import not found" }); return; }
        const original = await importPdf(client, imp);
        if (sha256(original) !== sha256(bytes)) { res.status(409).json({ error: "This PDF does not exactly match the imported original" }); return; }
        const { data: drafts, error: draftError } = await client.from("draft_questions").select("page_number").eq("pdf_import_id", importId);
        if (draftError) throw draftError;
        for (const page of new Set<number>((drafts ?? []).map((d: any) => d.page_number).filter((n: number) => Number.isInteger(n) && n > 0))) await renderPagePng(bytes, page, 3);
        const source = await registerSource(client, file, bytes);
        const bound = await client.rpc("bind_import_drive_source", { p_import_id: importId, p_source_id: source.id });
        if (bound.error) throw bound.error;
        res.json({ source }); return;
      }
      const source = await registerSource(client, file, bytes);
      res.json({ source });
    } catch (e) { console.error("[sources] PDF registration failed", e instanceof Error ? e.message : "Error"); res.status(503).json({ error: "Unable to verify the original PDF; existing source files were preserved" }); }
  });

  app.post("/source-page", async (req, res) => {
    if (!auth(req, res)) return;
    const { import_id: importId, draft_id: draftId } = req.body ?? {};
    if (!UUID.test(importId ?? "") || !UUID.test(draftId ?? "")) { res.status(422).json({ error: "Invalid draft reference" }); return; }
    try {
      const { data: draft, error } = await client.from("draft_questions").select("*").eq("id", draftId).eq("pdf_import_id", importId).single();
      if (error || !draft) { res.status(404).json({ error: "Draft not found" }); return; }
      const published = await client.rpc("draft_published_question", { p_draft_id: draftId });
      if (published.error) throw published.error;
      if (published.data) { res.status(409).json({ error: "Published questions retain only their final crop" }); return; }
      const png = await draftSourcePage(client, draft);
      res.set({ "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }).send(png);
    } catch (e) { console.error("[sources] Page render failed", e instanceof Error ? e.message : "Error"); res.status(503).json({ error: "Original page unavailable. Check Drive access and the processing service, then retry." }); }
  });
}
