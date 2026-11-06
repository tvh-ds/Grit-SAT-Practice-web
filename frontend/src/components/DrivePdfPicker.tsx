import { useState } from "react";
import { fnJson, getToken } from "../lib/supabase";
import { Button } from "./ui";

type DrivePdf = { id: string; name: string; folders: string[] };
export function DrivePdfPicker({ onSelect, busy = false }: { onSelect: (fileId: string) => Promise<void>; busy?: boolean }) {
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<DrivePdf[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function search() {
    setLoading(true); setError(null);
    try {
      const token = await getToken();
      const result = await fnJson<{ files: DrivePdf[] }>(`admin-pdf-imports/drive-files?q=${encodeURIComponent(query)}`, { token });
      setFiles(result.files);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to read Drive"); }
    finally { setLoading(false); }
  }
  return <div>
    <div className="toolbar">
      <input className="input" aria-label="Search original PDFs in Google Drive" placeholder="Search original PDF filename or folder" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void search(); } }} />
      <Button disabled={busy || loading} onClick={() => void search()}>{loading ? "Searching…" : "Browse Drive"}</Button>
    </div>
    {error && <p className="login-error" role="alert">{error}</p>}
    {files && <div style={{ maxHeight: 300, overflowY: "auto" }}>
      {files.length === 0 && <p className="muted">No matching PDFs in the configured original folders.</p>}
      {files.map(file => <div className="toolbar" key={file.id} style={{ marginTop: 10 }}>
        <div style={{ flex: 1 }}><strong>{file.name}</strong><div className="muted">{file.folders.join(" / ")}</div></div>
        <Button size="sm" disabled={busy} onClick={() => void onSelect(file.id)}>{busy ? "Verifying…" : "Select PDF"}</Button>
      </div>)}
    </div>}
  </div>;
}
