import { useEffect, useState } from "react";
import { fn, getToken } from "./supabase";

export function useSourcePage(importId: string, draftId: string, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null); setError(null);
    if (!enabled) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      const token = await getToken();
      const response = await fn(`admin-pdf-imports/${importId}/drafts/${draftId}/source-page`, { token });
      if (!response.ok) {
        const details = await response.json().catch(() => null);
        throw new Error(details?.error || "Original page unavailable");
      }
      const blob = await response.blob();
      if (!cancelled) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
    })().catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Original page unavailable"); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [importId, draftId, enabled]);
  return { url, error };
}
