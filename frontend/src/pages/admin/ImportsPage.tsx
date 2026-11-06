import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { ImportReadinessMetric, PdfImport } from "../../lib/types";
import { DrivePdfPicker } from "../../components/DrivePdfPicker";
import { Spinner, fmtDate } from "../../components/ui";
import { polishTestTitle } from "../../lib/testTitle";

type OverallReadiness = "complete" | "partial" | "failed" | "processing";

function overallReadiness(im: PdfImport): OverallReadiness {
  const readiness = im.import_readiness;
  if (["queued", "processing", "running", "uploaded"].includes(im.status)) return "processing";
  if (im.status === "failed" || im.deterministic_review_status === "failed") return "failed";
  if (!readiness) return "processing";
  const { questions, answer_key: answerKey } = readiness;
  if (questions.status === "failed" || answerKey.status === "failed") return "failed";
  if (questions.status === "complete" && answerKey.status === "complete") return "complete";
  if (questions.status === "processing" || answerKey.status === "processing") return "processing";
  return "partial";
}

function ReadinessBadge({ metric, noun }: { metric: ImportReadinessMetric | undefined; noun: string }) {
  if (!metric) return <span className="muted">—</span>;

  const label = metric.status === "complete"
    ? "Complete"
    : metric.status === "partial"
      ? "Partial"
      : metric.status === "failed"
        ? "Failed"
        : "Processing";
  const tone = metric.status === "complete"
    ? "green"
    : metric.status === "partial"
      ? "amber"
      : metric.status === "failed"
        ? "red"
        : "gray";
  const moduleDetails = metric.modules.map((module) => {
    const name = module.name
      .replace("Reading and Writing", "RW")
      .replace("Module ", "M");
    return `${name} ${module.actual}/${module.expected}${module.inferred ? " (inferred)" : ""}`;
  });
  const detail = [
    `${metric.actual}/${metric.expected} ${noun}`,
    ...moduleDetails,
    ...metric.details,
  ].join("\n");

  return (
    <span title={detail} aria-label={`${label}: ${detail}`} tabIndex={0}>
      <span className={`pill pill-${tone}`}>{label}</span>
      <span className="muted" style={{ display: "block", fontSize: 12, marginTop: 4 }}>
        {metric.actual}/{metric.expected}
      </span>
    </span>
  );
}

export default function ImportsPage() {
  const [imports, setImports] = useState<PdfImport[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readinessFilter, setReadinessFilter] = useState<"all" | Exclude<OverallReadiness, "processing">>("all");

  async function load() {
    const token = await getToken();
    const d = await fnJson<{ imports: PdfImport[] }>("admin-pdf-imports", { token });
    setImports(d.imports);
  }

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);

  async function importDrive(fileId: string) {
    setUploading(true); setError(null);
    try {
      const token = await getToken();
      await fnJson("admin-pdf-imports/drive-import", { method: "POST", token, body: { file_id: fileId } });
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Import failed"); }
    finally { setUploading(false); }
  }

  const counts = {
    all: imports?.length ?? 0,
    complete: imports?.filter((im) => overallReadiness(im) === "complete").length ?? 0,
    partial: imports?.filter((im) => overallReadiness(im) === "partial").length ?? 0,
    failed: imports?.filter((im) => overallReadiness(im) === "failed").length ?? 0,
  };
  const visibleImports = (imports ?? []).filter((im) => readinessFilter === "all" || overallReadiness(im) === readinessFilter);

  return (
    <div>
      <div className="section-label">Imports</div>
      <h1 className="page-title"><span className="hl-muted">PDF</span> <span className="hl-bright">imports</span></h1>
      <p className="page-sub">Select an original full SAT PDF from Drive — the system detects Reading &amp; Writing and Math modules automatically and parses the whole file. OCR is applied automatically only to modules that need it.</p>

      <div className="card card-pad" style={{ maxWidth: 560, marginBottom: 18 }}>
        <DrivePdfPicker onSelect={importDrive} busy={uploading} />
        <p className="muted" style={{ margin: "10px 0 0", fontSize: 12.5 }}>Choose a full-length SAT PDF from its original Drive folder. Only saved question crops are stored in Supabase.</p>
      </div>

      {error && <div className="login-error">{error}</div>}
      {!imports && <Spinner />}

      {imports && (
        <div className="card card-pad">
          <div className="toolbar" style={{ marginBottom: 14 }} aria-label="Filter imports by completeness">
            {(["all", "complete", "partial", "failed"] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                className={`draft-filter${readinessFilter === filter ? " active" : ""}`}
                aria-pressed={readinessFilter === filter}
                onClick={() => setReadinessFilter(filter)}
              >
                {filter === "all" ? "All" : filter.charAt(0).toUpperCase() + filter.slice(1)} ({counts[filter]})
              </button>
            ))}
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>File</th>
                <th>Questions</th>
                <th>Drafts</th>
                <th>Answer key</th>
                <th>Pages</th>
                <th>Method</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibleImports.map((im) => {
                const draftCount = Object.values(im.draft_counts ?? {}).reduce((a: number, n) => a + (n as number), 0);
                return (
                  <tr key={im.id} className="row-link">
                    <td>
                      <div style={{ fontWeight: 600 }}>{polishTestTitle(im.original_filename)}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{im.original_filename}</div>
                      {im.deterministic_review_status === "failed" && (
                        <span className="pill pill-red" style={{ marginTop: 6 }}>Structural review failed</span>
                      )}
                      {im.generated_test_id && (
                        <Link to={`/admin/tests/${im.generated_test_id}/build`} style={{ fontSize: 12 }}>Open full-length test</Link>
                      )}
                    </td>
                    <td><ReadinessBadge metric={im.import_readiness?.questions} noun="questions" /></td>
                    <td>{draftCount}</td>
                    <td><ReadinessBadge metric={im.import_readiness?.answer_key} noun="keys" /></td>
                    <td>{im.page_count ?? "—"}</td>
                    <td>{im.extraction_method ?? "—"}</td>
                    <td>{fmtDate(im.created_at)}</td>
                    <td>
                      <Link className="btn btn-secondary btn-sm" to={`/admin/imports/${im.id}`}>Review</Link>
                    </td>
                  </tr>
                );
              })}
              {visibleImports.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted" style={{ textAlign: "center", padding: 30 }}>
                    {imports.length === 0 ? "No imports yet — upload a practice PDF above." : `No ${readinessFilter} imports.`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
