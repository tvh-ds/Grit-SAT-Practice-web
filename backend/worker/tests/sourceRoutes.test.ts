import { describe, expect, it, vi } from "vitest";
import { installSourceRoutes } from "../src/sourceRoutes";

const f = vi.hoisted(() => ({ render: vi.fn(async () => Buffer.from("png")), inventory: vi.fn(async () => [{ id: "allowed-drive-file", name: "test.pdf", folders: [] }]) }));
vi.mock("../src/sourceDocuments", () => ({ driveInventory: f.inventory, draftSourcePage: f.render }));

function fixture(authorized = true, published: string | null = null) {
  const routes = new Map<string, any>();
  const app: any = { get: (p: string, h: any) => routes.set(`GET ${p}`, h), post: (p: string, h: any) => routes.set(`POST ${p}`, h) };
  const eq = vi.fn();
  const draft = { id: "00000000-0000-4000-8000-000000000001", pdf_import_id: "00000000-0000-4000-8000-000000000002", source_document_id: "server-source", source_page_number: 7 };
  const q: any = { select: () => q, eq: (...args: any[]) => { eq(...args); return q; }, single: async () => ({ data: draft, error: null }) };
  const client = { from: vi.fn(() => q), rpc: vi.fn(async () => ({ data: published, error: null })) };
  installSourceRoutes(app, client, (_req, res) => { if (!authorized) { res.status(401).json({ error: "Unauthorized" }); return false; } return true; });
  const res: any = { status: vi.fn(() => res), json: vi.fn(() => res), set: vi.fn(() => res), send: vi.fn(() => res) };
  return { routes, res, client, draft, eq };
}
describe("private original-page worker API", () => {
  it("denies unauthenticated source access before any database or rendering work", async () => {
    const x = fixture(false); await x.routes.get("POST /source-page")({ body: {} }, x.res);
    expect(x.res.status).toHaveBeenCalledWith(401); expect(x.client.from).not.toHaveBeenCalled();
  });
  it("resolves the page from the database, not a caller supplied URL, file ID, or page", async () => {
    const x = fixture();
    await x.routes.get("POST /source-page")({ body: { import_id: x.draft.pdf_import_id, draft_id: x.draft.id, page: 99, url: "http://localhost/private" } }, x.res);
    expect(x.eq).toHaveBeenCalledWith("pdf_import_id", x.draft.pdf_import_id);
    expect(f.render).toHaveBeenCalledWith(x.client, x.draft);
    expect(x.res.set).toHaveBeenCalledWith(expect.objectContaining({ "Content-Type": "image/png", "Cache-Control": "private, no-store" }));
  });
  it("refuses original-page viewing for published questions", async () => {
    const x = fixture(true, "published-question"); f.render.mockClear();
    await x.routes.get("POST /source-page")({ body: { import_id: x.draft.pdf_import_id, draft_id: x.draft.id } }, x.res);
    expect(x.res.status).toHaveBeenCalledWith(409); expect(f.render).not.toHaveBeenCalled();
  });
  it("rejects invalid import and draft identifiers", async () => {
    const x = fixture(); await x.routes.get("POST /source-page")({ body: { import_id: "../file", draft_id: "x" } }, x.res);
    expect(x.res.status).toHaveBeenCalledWith(422); expect(x.client.from).not.toHaveBeenCalled();
  });
});
