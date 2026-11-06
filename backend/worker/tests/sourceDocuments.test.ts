import { beforeEach, describe, expect, it, vi } from "vitest";
import { draftSourcePage, importPdf, registerSource, sha256, sourcePdf } from "../src/sourceDocuments";

const f = vi.hoisted(() => ({ download: vi.fn(), render: vi.fn(async () => Buffer.from("rendered-page")) }));
vi.mock("../src/driveSource", () => ({ GoogleDriveSource: class { download = f.download; } }));
vi.mock("../src/renderPage", () => ({ renderPagePng: f.render }));
const pdf = Buffer.from("%PDF-1.7 original");
const client = (id: string, checksum = sha256(pdf)) => ({
  from: () => { const q: any = { select: () => q, eq: () => q, single: async () => ({ data: { id, drive_file_id: "original-drive-file", sha256: checksum, file_size: pdf.length }, error: null }) }; return q; },
  storage: { from: vi.fn() },
});
beforeEach(() => { vi.clearAllMocks(); process.env.GOOGLE_APPLICATION_CREDENTIALS = "test-private-credential.json"; f.download.mockResolvedValue(pdf); });

describe("Drive PDF sources", () => {
  it("renders one page for review and cropping without any Storage upload", async () => {
    const c = client("render-source");
    const draft = { source_document_id: "render-source", source_page_number: 4 };
    await expect(draftSourcePage(c, draft)).resolves.toEqual(Buffer.from("rendered-page"));
    await draftSourcePage(c, draft);
    expect(f.download).toHaveBeenCalledTimes(1);
    expect(f.render).toHaveBeenCalledTimes(1);
    expect(f.render).toHaveBeenCalledWith(pdf, 4, 3);
    expect(c.storage.from).not.toHaveBeenCalled();
  });
  it("refuses changed originals rather than drawing crops from a different PDF", async () => {
    await expect(sourcePdf(client("changed-source", "0".repeat(64)), "changed-source")).rejects.toThrow("changed");
  });
  it("does not share cached data across source identities", async () => {
    await sourcePdf(client("first-source"), "first-source");
    await sourcePdf(client("second-source"), "second-source");
    expect(f.download).toHaveBeenCalledTimes(2);
  });
  it("checks PDF contents before creating a source record", async () => {
    const c = { from: vi.fn() };
    await expect(registerSource(c, { id: "drive-file-id", name: "fake.pdf", mimeType: "application/pdf", folders: [] }, Buffer.from("not a PDF"))).rejects.toThrow("not a PDF");
    expect(c.from).not.toHaveBeenCalled();
  });
  it("rejects invalid pages and missing original references", async () => {
    await expect(draftSourcePage(client("x"), { source_document_id: "x", page_number: -1 })).rejects.toThrow("no original PDF page");
    await expect(importPdf(client("x"), {})).rejects.toThrow("Needs original PDF");
  });
  it("explains the missing worker credential without exposing any secret", async () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    await expect(sourcePdf(client("no-credential"), "no-credential")).rejects.toThrow("not configured");
  });
});
