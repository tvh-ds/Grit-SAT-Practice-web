import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleDriveSource } from "../src/driveSource";
import { DEFAULT_DRIVE_FOLDER } from "../src/driveIngestion";

vi.mock("google-auth-library", () => ({ GoogleAuth: class { async getAccessToken() { return "test-token"; } } }));
afterEach(() => vi.unstubAllGlobals());
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

describe("Google Drive source", () => {
  it("requires worker credentials independently of the chat connection", () => {
    expect(() => new GoogleDriveSource("")).toThrow("GOOGLE_APPLICATION_CREDENTIALS");
  });

  it("traverses nested folders and every page, including empty intermediate pages", async () => {
    const fetcher = vi.fn(async (url: URL, options: RequestInit) => {
      expect(url.origin).toBe("https://www.googleapis.com");
      expect(options.redirect).toBe("error");
      if (!url.searchParams.has("q")) return json({ id: DEFAULT_DRIVE_FOLDER, mimeType: "application/vnd.google-apps.folder" });
      const parent = url.searchParams.get("q")!;
      const token = url.searchParams.get("pageToken");
      if (parent.includes(DEFAULT_DRIVE_FOLDER) && !token) return json({ files: [], nextPageToken: "second-page" });
      if (token) return json({ files: [
        { id: "nested-folder-001", name: "2026 10", mimeType: "application/vnd.google-apps.folder" },
        { id: "shortcut-file-001", name: "Shortcut", mimeType: "application/vnd.google-apps.shortcut" },
      ] });
      return json({ files: [{ id: "nested-pdf-0001", name: "test.pdf", mimeType: "application/pdf", size: "9" }] });
    });
    vi.stubGlobal("fetch", fetcher);
    const files = await new GoogleDriveSource("test.json").inventory(DEFAULT_DRIVE_FOLDER);
    expect(files).toEqual([{ id: "nested-pdf-0001", name: "test.pdf", mimeType: "application/pdf", size: "9", folders: ["2026 10"] }]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("rejects partial inventories and unauthorized roots rather than baselining missing files", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ id: DEFAULT_DRIVE_FOLDER, mimeType: "application/vnd.google-apps.folder" })).mockResolvedValueOnce(json({ files: [], incompleteSearch: true })));
    await expect(new GoogleDriveSource("test.json").inventory(DEFAULT_DRIVE_FOLDER)).rejects.toThrow("Incomplete");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("secret-token-in-provider-body", { status: 403 })));
    await expect(new GoogleDriveSource("test.json").inventory(DEFAULT_DRIVE_FOLDER)).rejects.toThrow("Drive API HTTP 403");
  });

  it("refuses non-folder roots and repeated page tokens", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ id: DEFAULT_DRIVE_FOLDER, mimeType: "application/pdf" })));
    await expect(new GoogleDriveSource("test.json").inventory(DEFAULT_DRIVE_FOLDER)).rejects.toThrow("not a folder");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ id: DEFAULT_DRIVE_FOLDER, mimeType: "application/vnd.google-apps.folder" })).mockImplementation(async () => json({ files: [], nextPageToken: "repeated" })));
    await expect(new GoogleDriveSource("test.json").inventory(DEFAULT_DRIVE_FOLDER)).rejects.toThrow("Repeated");
  });

  it("streams downloads and rejects oversized input before fetching", async () => {
    const fetcher = vi.fn(async () => new Response("%PDF-1.7"));
    vi.stubGlobal("fetch", fetcher);
    const source = new GoogleDriveSource("test.json");
    const file = { id: "pdf-file-000001", name: "test.pdf", mimeType: "application/pdf", folders: [] };
    expect((await source.download(file)).toString()).toBe("%PDF-1.7");
    await expect(source.download({ ...file, size: String(51 * 1024 * 1024) })).rejects.toThrow("50 MiB");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
