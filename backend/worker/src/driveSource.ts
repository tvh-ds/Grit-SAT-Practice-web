import fs from "node:fs/promises";
import { GoogleAuth } from "google-auth-library";
import { assertDriveId, MAX_PDF_BYTES, type DrivePdf } from "./driveIngestion";

const FOLDER_MIME = "application/vnd.google-apps.folder";
interface DriveItem { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string; sha256Checksum?: string; md5Checksum?: string; }

/** Read-only service-account or authorized_user credentials; tokens stay in memory. */
export class GoogleDriveSource {
  private auth: GoogleAuth;
  constructor(keyFile: string) {
    if (!keyFile) throw new Error("Set GOOGLE_APPLICATION_CREDENTIALS to your private Google credentials JSON path (see docs/drive-ingestion.md)");
    this.auth = new GoogleAuth({ keyFile, scopes: ["https://www.googleapis.com/auth/drive.readonly"] });
  }

  private async request(url: URL): Promise<Response> {
    if (url.origin !== "https://www.googleapis.com") throw new Error("Unexpected Drive API host");
    const token = await this.auth.getAccessToken();
    if (!token) throw new Error("Unable to obtain Drive access token");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(120000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Drive API HTTP ${response.status}`); }
    return response;
  }

  async inventory(rootId: string): Promise<DrivePdf[]> {
    assertDriveId(rootId);
    const rootUrl = new URL(`https://www.googleapis.com/drive/v3/files/${rootId}`);
    rootUrl.searchParams.set("fields", "id,mimeType"); rootUrl.searchParams.set("supportsAllDrives", "true");
    const root = await (await this.request(rootUrl)).json() as DriveItem;
    if (root.id !== rootId || root.mimeType !== FOLDER_MIME) throw new Error("Watched Drive item is not a folder");
    const files: DrivePdf[] = [];
    const folders: Array<{ id: string; path: string[] }> = [{ id: rootId, path: [] }];
    const visited = new Set<string>();
    for (let i = 0; i < folders.length; i++) {
      const folder = folders[i]!;
      if (visited.has(folder.id)) continue;
      visited.add(folder.id);
      if (visited.size > 2000 || folder.path.length > 30) throw new Error("Drive folder traversal limit exceeded");
      let pageToken: string | undefined;
      const seenPages = new Set<string>();
      do {
        const url = new URL("https://www.googleapis.com/drive/v3/files");
        url.searchParams.set("q", `'${assertDriveId(folder.id)}' in parents and trashed = false`);
        url.searchParams.set("fields", "nextPageToken,incompleteSearch,files(id,name,mimeType,size,modifiedTime,sha256Checksum,md5Checksum)");
        url.searchParams.set("pageSize", "1000");
        url.searchParams.set("supportsAllDrives", "true"); url.searchParams.set("includeItemsFromAllDrives", "true");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const data = await (await this.request(url)).json() as { files?: DriveItem[]; nextPageToken?: string; incompleteSearch?: boolean };
        if (!Array.isArray(data.files) || data.incompleteSearch) throw new Error("Incomplete Drive inventory; baseline was not updated");
        for (const item of data.files) {
          assertDriveId(item.id);
          if (typeof item.name !== "string" || item.name.length > 2000) throw new Error("Invalid Drive filename");
          if (item.mimeType === FOLDER_MIME) folders.push({ id: item.id, path: [...folder.path, item.name] });
          else if (item.mimeType === "application/pdf") files.push({ ...item, folders: folder.path });
          // Shortcuts are not followed, keeping downloads inside the selected tree.
        }
        pageToken = data.nextPageToken;
        if (pageToken && seenPages.has(pageToken)) throw new Error("Repeated Drive pagination token");
        if (pageToken) seenPages.add(pageToken);
        if (files.length > 100000) throw new Error("Drive inventory limit exceeded");
      } while (pageToken);
    }
    return files;
  }

  async download(file: DrivePdf): Promise<Buffer> {
    if (file.size && Number(file.size) > MAX_PDF_BYTES) throw new Error("Drive PDF exceeds 50 MiB");
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${assertDriveId(file.id)}`);
    url.searchParams.set("alt", "media"); url.searchParams.set("supportsAllDrives", "true");
    const response = await this.request(url);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty Drive response");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_PDF_BYTES) throw new Error("Drive PDF exceeds 50 MiB");
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    return Buffer.concat(chunks);
  }
}

/** One-time bootstrap uses connector-downloaded PDFs, never expiring URLs in persistent state. */
export async function readBootstrapFiles(manifestPath: string): Promise<{ rootFolderId: string; files: DrivePdf[] }> {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assertDriveId(manifest.rootFolderId);
  if (!Array.isArray(manifest.files)) throw new Error("Invalid bootstrap manifest");
  return { rootFolderId: manifest.rootFolderId, files: manifest.files.map((file: DrivePdf & { folder?: string }) => {
    assertDriveId(file.id);
    if (file.mimeType !== "application/pdf" || typeof file.name !== "string") throw new Error("Invalid bootstrap file");
    return { id: file.id, name: file.name, mimeType: file.mimeType, size: file.size, modifiedTime: file.modifiedTime, folders: file.folders ?? [file.folder ?? ""] };
  }) };
}
