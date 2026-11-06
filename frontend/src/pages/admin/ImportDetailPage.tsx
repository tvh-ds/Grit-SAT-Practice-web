import VisualCode from "../../components/VisualCode";
import { DrivePdfPicker } from "../../components/DrivePdfPicker";
import { useSourcePage } from "../../lib/useSourcePage";
import { deferComponent } from "../../components/deferComponent";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fnJson, getToken, supabase } from "../../lib/supabase";
import type { AiIngestionReviewSummary, IngestionReviewState, DraftQuestion, DraftSummary, ImportDetailSummary, ModuleSummary, PdfImport } from "../../lib/types";
import { Button, Modal, Pill, Spinner, fmtDate } from "../../components/ui";
const CropImageModal = deferComponent(async () => ({ default: (await import("../../components/CropImageModal")).CropImageModal }));
import MathText from "../../components/MathText";
import KeyStatusBadge, { keyStatusInfo } from "../../components/KeyStatusBadge";
import { polishTestTitle, EXPECTED_MODULE_COUNTS } from "../../lib/testTitle";
import ImportStatus from "../../components/ImportStatus";
import { isCollegeBoardRwBank } from "../../../../backend/supabase/functions/_shared/collegeboardBank";

export default function ImportDetailPage() {
  const { importId } = useParams<{ importId: string }>();
  const navigate = useNavigate();
  const [importInfo, setImportInfo] = useState<PdfImport | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [draftTotal, setDraftTotal] = useState(0);
  const [draftOffset, setDraftOffset] = useState(0);
  const [draftLimit, setDraftLimit] = useState(50);
  const [draftCounts, setDraftCounts] = useState<Record<string, number>>({});
  const [moduleSummary, setModuleSummary] = useState<ModuleSummary[]>([]);
  const [draftStatus, setDraftStatus] = useState<string | null>(null);
  const [draftModule, setDraftModule] = useState<string | null>(null);
  const [reviewState, setReviewState] = useState<IngestionReviewState | null>(null);
  const [aiReview, setAiReview] = useState<AiIngestionReviewSummary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, DraftQuestion>>({});
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [approvalWarnings, setApprovalWarnings] = useState<string[] | null>(null);
  const [generateResult, setGenerateResult] = useState<{ test_id: string; title: string; linked: number; failed: number; already_generated?: boolean } | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [addingQuestion, setAddingQuestion] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef(0);
  const selectedRef = useRef<string | null>(null);
  const draftStatusRef = useRef<string | null>(null);
  const draftModuleRef = useRef<string | null>(null);
  const reviewStateRef = useRef<IngestionReviewState | null>(null);
  offsetRef.current = draftOffset;
  selectedRef.current = selectedId;
  draftStatusRef.current = draftStatus;
  draftModuleRef.current = draftModule;
  reviewStateRef.current = reviewState;

  const loadPage = useCallback(async (offset: number) => {
    if (!importId) return;
    const token = await getToken();
    const params = new URLSearchParams({ draft_limit: "50", draft_offset: String(offset) });
    const status = draftStatusRef.current;
    if (status) params.set("draft_status", status);
    const mod = draftModuleRef.current;
    if (mod) params.set("draft_module", mod);
    const state = reviewStateRef.current;
    if (state) params.set("review_state", state);
    const d = await fnJson<ImportDetailSummary>(`admin-pdf-imports/${importId}?${params.toString()}`, { token });
    setImportInfo(d.import);
    setDrafts(d.drafts);
    setDraftTotal(d.draft_total);
    setDraftOffset(d.draft_offset);
    setDraftLimit(d.draft_limit);
    setDraftCounts(d.draft_counts);
    setModuleSummary(d.module_summary ?? []);
    setAiReview(d.ai_review ?? null);
  }, [importId]);

  useEffect(() => {
    void loadPage(0).catch((e) => setError(e.message));
  }, [loadPage, draftStatus, draftModule, reviewState]);

  useEffect(() => {
    if (!aiReview?.current_job || !["queued", "running"].includes(aiReview.current_job.status)) return;
    const timer = window.setInterval(() => {
      void loadPage(offsetRef.current).catch((e) => setError(e.message));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [aiReview?.current_job?.id, aiReview?.current_job?.status, loadPage]);

  useEffect(() => {
    if (!reprocessing || !importInfo) return;
    const terminal = (importInfo.status === "completed" && ["passed", "failed"].includes(importInfo.deterministic_review_status ?? "")) ||
      (importInfo.status === "failed" && importInfo.deterministic_review_status === "failed");
    if (terminal) {
      setReprocessing(false);
      return;
    }
    const timer = window.setInterval(() => void loadPage(0).catch((e) => setError(e.message)), 3000);
    return () => window.clearInterval(timer);
  }, [reprocessing, importInfo, loadPage]);

  async function openDraft(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
    if (details[id]) return;
    setLoadingDetailId(id);
    try {
      const token = await getToken();
      const d = await fnJson<{ draft: DraftQuestion }>(`admin-pdf-imports/${importId}/drafts/${id}`, { token });
      setDetails((prev) => ({ ...prev, [id]: d.draft }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load draft");
    } finally {
      setLoadingDetailId((cur) => (cur === id ? null : cur));
    }
  }

  useEffect(() => {
    if (selectedId && details[selectedId] && editorRef.current) {
      editorRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedId, details, loadingDetailId]);

  async function refresh() {
    const offset = offsetRef.current;
    await loadPage(offset);
    const sel = selectedRef.current;
    if (sel) {
      const token = await getToken();
      const d = await fnJson<{ draft: DraftQuestion }>(`admin-pdf-imports/${importId}/drafts/${sel}`, { token });
      setDetails((prev) => ({ ...prev, [sel]: d.draft }));
    }
  }

  function onManualDraftCreated(draft: DraftQuestion) {
    setAddingQuestion(false);
    setDraftStatus(null);
    setDraftModule(null);
    setReviewState(null);
    setDraftOffset(0);
    draftStatusRef.current = null;
    draftModuleRef.current = null;
    reviewStateRef.current = null;
    offsetRef.current = 0;
    setDetails((prev) => ({ ...prev, [draft.id]: draft }));
    setSelectedId(draft.id);
    void loadPage(0);
  }

  async function refreshAfterEditorSave(moduleName: string, position: number) {
    const offset = Math.floor((position - 1) / draftLimit) * draftLimit;
    setDraftStatus(null);
    setReviewState(null);
    setDraftModule(moduleName);
    setDraftOffset(offset);
    draftStatusRef.current = null;
    reviewStateRef.current = null;
    draftModuleRef.current = moduleName;
    offsetRef.current = offset;
    await loadPage(offset);
    const selected = selectedRef.current;
    if (selected) {
      const token = await getToken();
      const response = await fnJson<{ draft: DraftQuestion }>(`admin-pdf-imports/${importId}/drafts/${selected}`, { token });
      setDetails((previous) => ({ ...previous, [selected]: response.draft }));
    }
  }

  async function approveImport(acknowledgeWarnings = false) {
    setGenerating(true);
    setError(null);
    try {
      const token = await getToken();
      if (isCollegeBoardRwBank(importId)) {
        await fnJson(`admin-pdf-imports/${importId}/publish-bank`, { method: "POST", token, body: {} });
        await loadPage(offsetRef.current);
        return;
      }
      const approval = await fnJson<{ requires_confirmation?: boolean; warnings?: string[] }>(`admin-pdf-imports/${importId}/approve-import`, {
        method: "POST",
        token,
        body: { acknowledge_warnings: acknowledgeWarnings },
      });
      if (approval.requires_confirmation) {
        setApprovalWarnings(approval.warnings ?? ["Some import requirements are missing."]);
        return;
      }
      setApprovalWarnings(null);
      const res = await fnJson<{ test_id: string; title: string; linked: number; failed: number; already_generated?: boolean }>(
        `admin-pdf-imports/${importId}/generate-test`,
        { method: "POST", token, body: { acknowledge_warnings: acknowledgeWarnings } },
      );
      setGenerateResult(res);
      await loadPage(offsetRef.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import approval or test generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function fullReprocess() {
    setBusy(true);
    setReprocessing(true);
    setError(null);
    try {
      const token = await getToken();
      await fnJson(`admin-pdf-imports/${importId}/process`, { method: "POST", token, body: {} });
      await loadPage(0);
    } catch (e) {
      setReprocessing(false);
      setError(e instanceof Error ? e.message : "Full reprocess could not be started");
    } finally {
      setBusy(false);
    }
  }

  if (error && !importInfo) {
    return (
      <div className="center-fill">
        <p>{error}</p>
        <Button variant="outline" onClick={() => navigate("/admin/imports")}>Back</Button>
      </div>
    );
  }
  if (!importInfo) return <Spinner />;

  const selectedDetail = selectedId ? details[selectedId] ?? null : null;
  const collegeBoardBank = isCollegeBoardRwBank(importId);
  const bankPublication = collegeBoardBank ? importInfo.text_quality?.bank_publication : undefined;
  const pageStart = draftOffset + 1;
  const pageEnd = Math.min(draftOffset + draftLimit, draftTotal);
  const pageIdx = Math.floor(draftOffset / draftLimit);
  const maxPageIdx = Math.max(0, Math.ceil(draftTotal / draftLimit) - 1);
  const incompleteModules = importInfo.text_quality?.incomplete_modules ?? [];
  const parserFlagCounts = Object.entries(importInfo.text_quality?.parser_flag_counts ?? {});
  const questionIssues = importInfo.text_quality?.question_issues ?? [];
  const retryResults = importInfo.text_quality?.ocr_retry_results ?? [];
  const unmatchedKeys = importInfo.text_quality?.unmatched_key_entries ?? [];
  return (
    <div>
      {error && (
        <div className="login-error" role="alert" style={{ marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span>{error}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setError(null)}>Dismiss</Button>
        </div>
      )}
      {!importInfo.generated_test_id && !bankPublication && !importInfo.source_document_id && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <strong>Original PDF in Drive</strong>
          <p className="muted">Select the original PDF to verify it against this import. Existing files remain protected until verification succeeds.</p>
          <DrivePdfPicker busy={busy} onSelect={async (fileId) => {
            setBusy(true); setError(null);
            try {
              const token = await getToken();
              await fnJson(`admin-pdf-imports/${importId}/bind-drive-source`, { method: "POST", token, body: { file_id: fileId } });
              setDetails({}); await loadPage(offsetRef.current);
            } catch (e) { setError(e instanceof Error ? e.message : "Source verification failed"); }
            finally { setBusy(false); }
          }} />
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <h1 className="page-title">{polishTestTitle(importInfo.original_filename)}</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            <span className="muted">{importInfo.original_filename}</span> · Uploaded {fmtDate(importInfo.created_at)} · <ImportStatus status={importInfo.status} /> · {aiReview?.total_questions ?? draftTotal} drafts
            <span style={{ marginLeft: 8 }}>
              <Pill tone="gray">{importInfo.extraction_method ?? "text"} extract</Pill>
            </span>
            <span style={{ marginLeft: 8 }}>
              {collegeBoardBank ? "Keys stored per question" : <>key <KeyStatusBadge imp={importInfo} /></>}
            </span>
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!importInfo.generated_test_id && importInfo.deterministic_review_status === "failed" && (
            <Button variant="outline" disabled={busy || reprocessing} onClick={() => void fullReprocess()}>
              {busy || reprocessing ? "Reprocessing…" : "Full Reprocess"}
            </Button>
          )}
          {bankPublication ? (
            <Button variant="outline" onClick={() => navigate("/admin/questions")}>Open Practice Question Bank</Button>
          ) : importInfo.generated_test_id ? (
            <Button variant="outline" onClick={() => navigate(`/admin/tests/${importInfo.generated_test_id}/build`)}>
              Open Full-Length Test
            </Button>
          ) : (
              <Button
                disabled={generating || busy}
                title={collegeBoardBank ? "Publish this deck's remaining questions to the Practice Question Bank" : "Approve the import and assemble the test; missing requirements will show a warning"}
                onClick={() => void approveImport()}
              >
                {generating ? (collegeBoardBank ? "Publishing…" : "Approving…") : (collegeBoardBank ? "Publish to Practice Bank" : "Approve Import")}
              </Button>
          )}
          <Button variant="outline" onClick={() => navigate("/admin/imports")}>Back</Button>
        </div>
      </div>

      {importInfo.generated_test_id && importInfo.text_quality?.storage_cleanup && (
        <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
          {importInfo.text_quality.storage_cleanup.status === "complete"
            ? "Temporary source images cleaned up. Final images used by questions are kept."
            : importInfo.text_quality.storage_cleanup.status === "awaiting_publication"
              ? "Source images are kept until publication. Publish the test to keep only its final question images."
              : "Your test is published. Source-image cleanup is pending; publishing again retries cleanup."}
        </p>
      )}

      <div className="panel" style={{ marginTop: 18 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Human review queue</h3>
        <p className="muted" style={{ margin: "5px 0 0", fontSize: 12.5 }}>
          {collegeBoardBank
            ? "Review these visual questions and their crops before publishing them to the Practice Question Bank."
            : "Review questions need inspection. Complete questions are ready for import approval. Missing requirements show a warning that you can confirm to proceed."}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <Pill tone="green">Complete {aiReview?.state_counts.complete ?? 0}</Pill>
          <Pill tone="amber">Human Review {aiReview?.state_counts.review ?? 0}</Pill>
          <Pill tone="red">Failed {aiReview?.state_counts.failed ?? 0}</Pill>
        </div>
      </div>

      {importInfo.deterministic_review_status === "failed" && (
        <div className="panel" style={{ marginTop: 18, borderColor: "var(--danger)" }}>
          <h3 style={{ margin: "0 0 7px", fontSize: 15 }}>Structural review failed</h3>
          <p style={{ margin: "0 0 8px", fontSize: 13 }}>Processing stopped before question review. Run Full Reprocess to retry, or approve the import after confirming its warnings.</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {(importInfo.deterministic_major_risks ?? []).map((risk) => <li key={risk.code}>{risk.message}</li>)}
          </ul>
        </div>
      )}

      {(importInfo.deterministic_warnings?.length ?? 0) > 0 && (
        <div className="panel" style={{ marginTop: 18, borderColor: "var(--border-medium)" }}>
          <h3 style={{ margin: "0 0 7px", fontSize: 15 }}>Import warnings</h3>
          <p className="muted" style={{ margin: "0 0 8px", fontSize: 12.5 }}>These import-level warnings do not trigger AI review. Verify them while reviewing the questions.</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {importInfo.deterministic_warnings?.map((risk) => <li key={risk.code}>{risk.message}</li>)}
          </ul>
        </div>
      )}

      {(() => {
        if (collegeBoardBank) return null;
        const ks = keyStatusInfo(importInfo);
        if (!ks.status || ks.status === "complete") return null;
        return (
          <div className="panel" style={{ marginTop: 18, borderColor: "var(--border-medium)" }}>
            <h3 style={{ margin: "0 0 8", fontSize: 15 }}>Answer key — {ks.label}{ks.detail ? ` · ${ks.detail}` : ""}</h3>
            {ks.warnings.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>
                {ks.warnings.map((w, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>{w}</li>
                ))}
              </ul>
            )}
            {ks.warnings.length === 0 && ks.detail && (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>Check module counts above before trusting suggested keys.</p>
            )}
          </div>
        );
      })()}

      {importInfo.error_message && <div className="login-error" style={{ marginTop: 14 }}>{importInfo.error_message}</div>}

      {((importInfo.text_quality?.parser_warnings?.length ?? 0) > 0 ||
        incompleteModules.length > 0 ||
        (importInfo.text_quality?.inferred_question_numbers ?? 0) > 0 ||
        parserFlagCounts.length > 0 ||
        questionIssues.length > 0 ||
        retryResults.length > 0 ||
        unmatchedKeys.length > 0 ||
        (importInfo.text_quality?.answer_key_source != null && importInfo.text_quality.answer_key_source !== "parsed")) && (
        <div className="panel" style={{ marginTop: 18, borderColor: "var(--border-medium)" }}>
          <h3 style={{ margin: "0 0 8", fontSize: 15 }}>Parser warnings</h3>
          {importInfo.text_quality?.document_family && (
            <p className="muted" style={{ margin: "0 0 8", fontSize: 12.5 }}>
              Document type: {importInfo.text_quality.document_family.replaceAll("_", " ")}
            </p>
          )}
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>
            {(importInfo.text_quality?.parser_warnings ?? []).map((w, i) => (
              <li key={i} style={{ marginBottom: 4 }}>{w}</li>
            ))}
          </ul>
          {incompleteModules.length > 0 && (
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 12.5 }}>
              Incomplete or overfull: {incompleteModules.map((m) => m.module + " " + m.actual + "/" + m.expected).join(" · ")}
            </p>
          )}
          {(importInfo.text_quality?.inferred_question_numbers ?? 0) > 0 && (
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 12.5 }}>
              {importInfo.text_quality?.inferred_question_numbers} question number(s) were inferred; verify them against the source.
            </p>
          )}
          {parserFlagCounts.length > 0 && (
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 12.5 }}>
              Parse flags: {parserFlagCounts.map(([flag, count]) => flag.replaceAll("_", " ") + " (" + count + ")").join(" · ")}
            </p>
          )}
          {retryResults.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12.5 }}>
              <strong>Targeted OCR retries</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {retryResults.map((retry) => (
                  <li key={retry.page}>
                    Page {retry.page}: {retry.status}
                    {retry.status !== "failed" && " (" + retry.beforeQuestions + " → " + retry.afterQuestions + " parsed questions)"}
                    {retry.error ? " — " + retry.error : ""}
                    {retry.reason ? "; " + retry.reason : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {questionIssues.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12.5 }}>
              <strong>Question boundaries to verify</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {questionIssues.slice(0, 8).map((issue, i) => (
                  <li key={issue.pageNumber + "-" + (issue.questionNumber ?? "?") + "-" + i}>
                    Page {issue.pageNumber}{issue.moduleName ? " · " + issue.moduleName : ""}
                    {issue.questionNumber ? " · Q" + issue.questionNumber : ""}
                    {" — "}{issue.flags.map((flag) => flag.replaceAll("_", " ")).join(", ")}
                    {issue.prompt ? ": " + issue.prompt : ""}
                  </li>
                ))}
                {questionIssues.length > 8 && <li>{questionIssues.length - 8} more issue(s) recorded in import diagnostics.</li>}
              </ul>
            </div>
          )}
          {unmatchedKeys.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12.5 }}>
              <strong>Unmatched answer-key entries</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {unmatchedKeys.slice(0, 8).map((key, i) => (
                  <li key={key.pageNumber + "-" + key.questionNumber + "-" + i}>
                    Page {key.pageNumber}{key.moduleName ? " · " + key.moduleName : ""}
                    {" · key " + key.questionNumber + ": " + key.reason.replaceAll("_", " ")}
                    {key.sourceText ? " (" + key.sourceText + ")" : ""}
                  </li>
                ))}
                {unmatchedKeys.length > 8 && <li>{unmatchedKeys.length - 8} more unmatched key(s) recorded in import diagnostics.</li>}
              </ul>
            </div>
          )}
          {importInfo.text_quality?.answer_key_source === "present_but_unparsed" && (
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 12.5 }}>
              Answer-key content was detected, but no key entries were parsed. Treat suggested answers as unavailable until reviewed.
            </p>
          )}
          {importInfo.text_quality?.answer_key_source === "not_detected" && (
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 12.5 }}>
              No answer-key section was detected in the source document.
            </p>
          )}
        </div>
      )}

      {bankPublication && (
        <div className="panel" style={{ marginTop: 18, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <strong style={{ fontSize: 15 }}>Published to Practice Question Bank</strong>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
              Added {bankPublication.question_count} questions. This College Board deck now has {bankPublication.bank_total} questions in the bank.
            </p>
          </div>
          <Button size="sm" onClick={() => navigate("/admin/questions")}>Open question bank</Button>
        </div>
      )}

      {generateResult && generateResult.failed > 0 && !importInfo.generated_test_id && (
        <div className="login-error" style={{ marginTop: 14, borderColor: "var(--border-medium)" }}>
          {generateResult.failed} draft(s) could not be approved and were skipped.
        </div>
      )}

      {importInfo.generated_test_id && (
        <div className="panel" style={{ marginTop: 18, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <strong style={{ fontSize: 15 }}>Full-length test generated</strong>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
              Linked {moduleSummary.reduce((n, m) => n + m.approved, 0)}/{draftTotal} drafts into a test named to match this PDF.
            </p>
          </div>
          <Button size="sm" onClick={() => navigate(`/admin/tests/${importInfo.generated_test_id}/build`)}>Edit test</Button>
        </div>
      )}

      {moduleSummary.length > 0 && (
        <div className="panel" style={{ marginTop: 18 }}>
          <h3 style={{ margin: "0 0 12", fontSize: 15 }}>{collegeBoardBank ? "Deck questions" : "Draft modules"}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
            {moduleSummary.map((m) => {
              const expected = collegeBoardBank ? undefined : EXPECTED_MODULE_COUNTS[m.module];
              const ready = m.approved;
              const needsWork = m.total - m.approved - m.rejected;
              return (
                <div key={m.module} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, background: "var(--surface)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <strong style={{ fontSize: 13.5 }}>{collegeBoardBank ? "Reading and Writing bank drafts" : m.module}</strong>
                    <Pill tone={ready >= (collegeBoardBank ? m.total : (expected ?? Infinity)) ? "green" : "amber"}>
                      {ready}/{m.total}
                    </Pill>
                  </div>
                  <p className="muted" style={{ margin: "6px 0 0", fontSize: 12.5 }}>
                    {expected ? `${expected} expected` : `${m.section === "math" ? "Math" : "R&W"} drafts`}
                    {` · key ${m.with_key}/${m.total}`}
                    {needsWork > 0 ? ` · ${needsWork} not approved yet` : ""}
                    {m.rejected > 0 ? ` · ${m.rejected} rejected` : ""}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="panel" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Drafts ({draftTotal}{draftStatus ? ` · ${draftStatus.replace(/_/g, " ")}` : ""}{draftModule ? ` · ${draftModule}` : ""})</h3>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Button size="sm" onClick={() => setAddingQuestion(true)}>+ Add Question</Button>
            <button
              type="button"
              className={`draft-filter${!draftStatus ? " active" : ""}`}
              onClick={() => {
                setSelectedId(null);
                setDraftStatus(null);
              }}
            >
              All
            </button>
            <button
              type="button"
              className={`draft-filter${draftStatus === "needs_review" ? " active" : ""}`}
              onClick={() => {
                setSelectedId(null);
                setDraftStatus("needs_review");
              }}
            >
              Needs review ({draftCounts.needs_review ?? 0})
            </button>
          </div>
        </div>
        {moduleSummary.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            <button
              type="button"
              className={`draft-filter${!draftModule ? " active" : ""}`}
              onClick={() => {
                setSelectedId(null);
                setDraftModule(null);
              }}
            >
              All modules
            </button>
            {moduleSummary.map((m) => (
              <button
                key={m.module}
                type="button"
                className={`draft-filter${draftModule === m.module ? " active" : ""}`}
                onClick={() => {
                  setSelectedId(null);
                  setDraftModule((prev) => (prev === m.module ? null : m.module));
                }}
              >
                {m.module} ({m.total})
              </button>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {([
            [null, "All review states", undefined],
            ["complete", `Complete (${aiReview?.state_counts.complete ?? 0})`, "green"],
            ["review", `Review (${aiReview?.state_counts.review ?? 0})`, "amber"],
            ["failed", `Failed (${aiReview?.state_counts.failed ?? 0})`, "red"],
          ] as const).map(([state, label]) => (
            <button
              key={state ?? "all"}
              type="button"
              className={`draft-filter${reviewState === state ? " active" : ""}`}
              onClick={() => {
                setSelectedId(null);
                setReviewState(state);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {drafts.length === 0 && <p className="muted">No drafts yet.</p>}
        {drafts.map((d) => (
          <div key={d.id}>
            <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
              <button
                className={`draft-card${d.id === selectedId ? " selected" : ""}`}
                style={{ flex: 1, width: "100%", textAlign: "left", cursor: "pointer", border: "1px solid var(--border)" }}
                onClick={() => void openDraft(d.id)}
              >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <strong>
                  Position {d.display_order} · Source Q{d.source_question_number ?? "?"} · {d.section === "math" ? "Math" : "Reading & Writing"}
                  {d.assigned_module_name ? ` · ${d.assigned_module_name}` : ""}
                </strong>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  {d.has_visual_stimulus && <Pill tone="amber">Visual</Pill>}
                  {d.review_state && <ReviewStateBadge state={d.review_state} />}
                  {d.review_state === "complete" && d.status === "approved" && <Pill tone="green">Approved</Pill>}
                  <DraftStatus d={d} />
                </div>
              </div>
              <div style={{ fontSize: 13.5, margin: 0 }}><MathText text={d.prompt.slice(0, 120)} /></div>
              </button>
            </div>
            {d.id === selectedId && (
              <div className="draft-inline-editor" ref={editorRef}>
                {selectedDetail ? (
                  <DraftEditor
                    key={d.id}
                    draft={selectedDetail}
                    onSaved={(moduleName, position) => moduleName && position ? refreshAfterEditorSave(moduleName, position) : refresh()}
                    moduleSummary={moduleSummary}
                    placementLocked={Boolean(importInfo.generated_test_id)}
                    onReject={() => setRejectId(d.id)}
                    busy={busy}
                    setBusy={setBusy}
                    onError={setError}
                  />
                ) : (
                  <div style={{ padding: 18, textAlign: "center" }}>
                    <Spinner />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {pageStart}-{pageEnd} of {draftTotal}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="outline" disabled={pageIdx === 0 || busy} onClick={() => void loadPage((pageIdx - 1) * draftLimit)}>← Prev</Button>
            <Button variant="outline" disabled={pageIdx >= maxPageIdx || busy} onClick={() => void loadPage((pageIdx + 1) * draftLimit)}>Next</Button>
          </div>
        </div>
      </div>

      {approvalWarnings && (
        <Modal
          title="Approve import with warnings?"
          onClose={() => { if (!generating) setApprovalWarnings(null); }}
          footer={
            <>
              <Button variant="outline" disabled={generating} onClick={() => setApprovalWarnings(null)}>Cancel</Button>
              <Button disabled={generating} onClick={() => void approveImport(true)}>{generating ? "Approving…" : "Confirm approval"}</Button>
            </>
          }
        >
          <p>The following requirements are missing. You can still approve this import and generate the test.</p>
          <ul>{approvalWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
          <p className="muted">Confirm to include these questions as they are. Missing answers and unreviewed content may affect test accuracy.</p>
        </Modal>
      )}

      {rejectId && (
        <Modal
          title="Reject Draft"
          onClose={() => setRejectId(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setRejectId(null)}>Cancel</Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    try {
                      const token = await getToken();
                      await fnJson(`admin-pdf-imports/${importId}/drafts/${rejectId}/reject`, { method: "POST", token });
                      setRejectId(null);
                      setSelectedId((prev) => (prev === rejectId ? null : prev));
                      await loadPage(offsetRef.current);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Reject failed");
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                Reject
              </Button>
            </>
          }
        >
          <p>The draft will be marked as rejected and will not be published. You can still edit it before rejecting.</p>
        </Modal>
      )}
      {addingQuestion && importId && (
        <ManualDraftModal
          importId={importId}
          onClose={() => setAddingQuestion(false)}
          onCreated={onManualDraftCreated}
        />
      )}
    </div>
  );
}

function DraftStatus({ d }: { d: { status: string } }) {
  const map: Record<string, [string, "green" | "amber" | "red" | "gray"]> = {
    approved: ["Approved", "green"],
    rejected: ["Rejected", "red"],
    has_suggested_key: ["Suggested key", "amber"],
    missing_key: ["Missing key", "red"],
    needs_review: ["Needs review", "gray"],
  };
  const [label, tone] = map[d.status] ?? [d.status, "gray"];
  return <Pill tone={tone}>{label}</Pill>;
}

const IMPORT_MODULES = [
  "Reading and Writing Module 1",
  "Reading and Writing Module 2",
  "Math Module 1",
  "Math Module 2",
] as const;

function ManualDraftModal({
  importId,
  onClose,
  onCreated,
}: {
  importId: string;
  onClose: () => void;
  onCreated: (draft: DraftQuestion) => void;
}) {
  const [moduleName, setModuleName] = useState<(typeof IMPORT_MODULES)[number]>(IMPORT_MODULES[0]);
  const [questionType, setQuestionType] = useState<"multiple_choice" | "student_produced">("multiple_choice");
  const [prompt, setPrompt] = useState("");
  const [passage, setPassage] = useState("");
  const [answer, setAnswer] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [choices, setChoices] = useState([
    { label: "A", text: "" }, { label: "B", text: "" }, { label: "C", text: "" }, { label: "D", text: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!imageFile) {
      setImagePreview(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  function selectStimulus(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setError("Choose a PNG, JPEG, or WebP image under 10 MB.");
      return;
    }
    setError(null);
    setImageFile(file);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (questionType === "multiple_choice") {
      if (choices.length < 2 || choices.some((choice) => !choice.text.trim())) {
        setError("Multiple-choice questions need at least two choices with text.");
        return;
      }
      if (answer && !choices.some((choice) => choice.label === answer)) {
        setError("Select an answer that matches one of the choice labels.");
        return;
      }
    }
    setBusy(true);
    setError(null);
    let uploadedPath: string | null = null;
    try {
      const token = await getToken();
      if (imageFile) {
        const extension = imageFile.type === "image/jpeg" ? "jpg" : imageFile.type === "image/webp" ? "webp" : "png";
        uploadedPath = `imports/${importId}/manual-stimuli/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from("question-assets").upload(uploadedPath, imageFile, {
          contentType: imageFile.type,
          upsert: false,
        });
        if (uploadError) throw new Error(`Image upload failed: ${uploadError.message}`);
      }
      const response = await fnJson<{ draft: DraftQuestion }>(`admin-pdf-imports/${importId}/drafts`, {
        method: "POST",
        token,
        body: {
          source_module_name: moduleName,
          question_type: questionType,
          prompt: prompt.trim(),
          passage_text: passage.trim() || null,
          suggested_answer: answer.trim() || null,
          stimulus_image_path: uploadedPath,
          choices: questionType === "multiple_choice"
            ? choices.map((choice, index) => ({ ...choice, position: index + 1 }))
            : [],
        },
      });
      onCreated(response.draft);
    } catch (err) {
      if (uploadedPath) await supabase.storage.from("question-assets").remove([uploadedPath]).catch(() => undefined);
      setError(err instanceof Error ? err.message : "Unable to create draft.");
      setBusy(false);
    }
  }

  return (
    <Modal title="Add Question to Import Drafts" onClose={busy ? () => undefined : onClose}>
      <form onSubmit={(event) => void submit(event)} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label className="field-label">Module</label>
            <select className="select" value={moduleName} onChange={(event) => setModuleName(event.target.value as (typeof IMPORT_MODULES)[number])}>
              {IMPORT_MODULES.map((module) => <option key={module} value={module}>{module}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Question type</label>
            <select className="select" value={questionType} onChange={(event) => setQuestionType(event.target.value as typeof questionType)}>
              <option value="multiple_choice">Multiple choice</option>
              <option value="student_produced">Student-produced</option>
            </select>
          </div>
        </div>
        <div>
          <label className="field-label">Question prompt</label>
          <textarea className="textarea" required rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        </div>
        <div>
          <label className="field-label">Passage (optional)</label>
          <textarea className="textarea" rows={4} value={passage} onChange={(event) => setPassage(event.target.value)} placeholder="Add a shared passage for this question" />
        </div>
        <div className="panel" style={{ padding: 12 }}>
          <label className="field-label">Stimulus image (optional)</label>
          {imagePreview && <img src={imagePreview} alt="Selected question stimulus preview" style={{ display: "block", maxWidth: "100%", maxHeight: 240, objectFit: "contain", margin: "8px 0", borderRadius: 8 }} />}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label className="btn btn-outline btn-sm" style={{ cursor: busy ? "not-allowed" : "pointer" }}>
              {imageFile ? "Choose another image" : "Add stimulus image"}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={selectStimulus} disabled={busy} style={{ display: "none" }} />
            </label>
            {imageFile && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setImageFile(null)}>Remove selected image</Button>}
          </div>
          <p className="muted" style={{ margin: "7px 0 0", fontSize: 12 }}>PNG, JPEG, or WebP up to 10 MB. A new visual draft requires crop review before approval.</p>
        </div>
        {questionType === "multiple_choice" && (
          <div>
            <label className="field-label">Answer choices</label>
            {choices.map((choice, index) => (
              <div className="choice-edit" key={`${index}-${choice.label}`}>
                <span className="letter" style={{ width: 28 }}>{choice.label}</span>
                <input className="input" aria-label={`Choice ${choice.label}`} value={choice.text} onChange={(event) => setChoices((items) => items.map((item, i) => i === index ? { ...item, text: event.target.value } : item))} />
                <Button type="button" size="sm" variant="ghost" disabled={choices.length <= 2} aria-label={`Remove choice ${choice.label}`} onClick={() => {
                  setChoices((items) => items.filter((_, i) => i !== index));
                  if (answer === choice.label) setAnswer("");
                }}>Remove</Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" disabled={choices.length >= 6} onClick={() => {
              const used = new Set(choices.map((choice) => choice.label));
              const label = ["A", "B", "C", "D", "E", "F"].find((candidate) => !used.has(candidate));
              if (label) setChoices((items) => [...items, { label, text: "" }]);
            }}>+ Add choice</Button>
          </div>
        )}
        <div>
          <label className="field-label">Correct answer</label>
          {questionType === "multiple_choice" ? (
            <select className="select" value={answer} onChange={(event) => setAnswer(event.target.value)}>
              <option value="">Not provided / needs review</option>
              {choices.map((choice) => <option key={choice.label} value={choice.label}>{choice.label}</option>)}
            </select>
          ) : (
            <input className="input" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="e.g. 24 or 3/5" />
          )}
        </div>
        {error && <div className="login-error">{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy || !prompt.trim()}>{busy ? "Creating…" : "Add question"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ReviewStateBadge({ state }: { state: IngestionReviewState }) {
  const map: Record<IngestionReviewState, [string, "green" | "amber" | "red"]> = {
    complete: ["Complete", "green"],
    review: ["Review", "amber"],
    failed: ["Failed", "red"],
  };
  const [label, tone] = map[state];
  return <Pill tone={tone}>{label}</Pill>;
}

function DraftEditor({
  draft,
  onSaved,
  moduleSummary,
  placementLocked,
  onReject,
  busy,
  setBusy,
  onError,
}: {
  draft: DraftQuestion;
  onSaved: (moduleName?: string, position?: number) => Promise<void>;
  moduleSummary: ModuleSummary[];
  placementLocked: boolean;
  onReject: () => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onError: (e: string | null) => void;
}) {
  const [prompt, setPrompt] = useState(draft.prompt);
  const [passage, setPassage] = useState(draft.passage_text ?? "");
  const [choices, setChoices] = useState(draft.choices.map((c) => ({ id: c.id, label: c.label, text: c.text, position: c.position })));
  const [correct, setCorrect] = useState(draft.suggested_answer ?? "");
  const [domain, setDomain] = useState(draft.domain ?? "");
  const [skill, setSkill] = useState(draft.skill ?? "");
  const [explanation, setExplanation] = useState(draft.explanation ?? "");
  const [assignedModule, setAssignedModule] = useState(draft.assigned_module_name as (typeof IMPORT_MODULES)[number]);
  const [positionInput, setPositionInput] = useState(String(draft.display_order));
  const [cropOpen, setCropOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const sourceAvailable = Boolean(draft.source_page_available || draft.stimulus_source_image_url || draft.review_source_image_url);
  const sourcePage = useSourcePage(draft.pdf_import_id, draft.id, Boolean(draft.source_document_id && (cropOpen || sourceOpen || showFull)));
  const sourcePageUrl = draft.source_document_id ? sourcePage.url : (draft.stimulus_source_image_url ?? draft.review_source_image_url);

  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  useEffect(() => { setShowFull(false); setCropOpen(false); setSourceOpen(false); }, [draft.id]);
  useEffect(() => {
    setAssignedModule(draft.assigned_module_name as (typeof IMPORT_MODULES)[number]);
    setPositionInput(String(draft.display_order));
  }, [draft.id, draft.assigned_module_name, draft.display_order]);

  useEffect(() => {
    if (!imageFile) {
      setImagePreview(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      onError("Choose a PNG, JPEG, or WebP image under 10 MB.");
      return;
    }
    setImageFile(file);
    setSavedNote(null);
  }

  async function acceptFinding(findingId: string) {
    setBusy(true);
    try {
      const token = await getToken();
      await fnJson(`admin-pdf-imports/${draft.pdf_import_id}/findings/${findingId}/accept`, { method: "POST", token, body: {} });
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Finding could not be accepted");
    } finally {
      setBusy(false);
    }
  }

  async function dismissFinding(findingId: string) {
    const reason = window.prompt("Why is this finding being dismissed?")?.trim();
    if (!reason) return;
    setBusy(true);
    try {
      const token = await getToken();
      await fnJson(`admin-pdf-imports/${draft.pdf_import_id}/findings/${findingId}/dismiss`, { method: "POST", token, body: { reason } });
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Finding could not be dismissed");
    } finally {
      setBusy(false);
    }
  }

  async function saveCrop(blob: Blob, rect: { x: number; y: number; w: number; h: number }) {
    setBusy(true);
    try {
      const token = await getToken();
      const module = draft.source_module_name?.match(/(?:module\s*)?(\d+)\s*$/i)?.[1] ?? "unknown";
      const key = `${draft.section === "math" ? "math" : "rw"}-${module}-q${draft.source_question_number ?? "unknown"}-${draft.id}`;
      const path = `imports/${draft.pdf_import_id}/stimuli/${key}-manual-crop.png`;
      const { error: upErr } = await supabase.storage.from("question-assets").upload(path, blob, { contentType: "image/png", upsert: true });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
      await fnJson(`admin-pdf-imports/${draft.pdf_import_id}/drafts/${draft.id}`, {
        method: "PATCH",
        token,
        body: {
          stimulus_image_path: path,
          stimulus_crop_rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) },
          stimulus_crop_source: "manual",
          stimulus_crop_status: "confirmed",
        },
      });
      setCropOpen(false);
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Crop save failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCrop() {
    setBusy(true);
    try {
      const token = await getToken();
      await fnJson(`admin-pdf-imports/${draft.pdf_import_id}/drafts/${draft.id}/confirm-crop`, { method: "POST", token });
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Confirm failed");
    } finally {
      setBusy(false);
    }
  }

  async function resetCrop() {
    setShowFull(true);
    setCropOpen(true);
  }

  async function removeImage() {
    if (!window.confirm("Remove the stimulus image from this draft? The question will become text-only and any crop review requirement will be cleared.")) return;
    setBusy(true);
    try {
      const token = await getToken();
      await fnJson(`admin-pdf-imports/${draft.pdf_import_id}/drafts/${draft.id}`, {
        method: "PATCH",
        token,
        body: { has_visual_stimulus: false },
      });
      setShowFull(false);
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  }

  /** Persist every editable field so approval publishes what the admin sees. */
  async function saveDraft(): Promise<number> {
    if (!/^[1-9]\d*$/.test(positionInput)) throw new Error("Position must be a whole number starting at 1.");
    const position = Number(positionInput);
    if (!Number.isSafeInteger(position)) throw new Error("Position is too large.");
    const token = await getToken();
    let uploadedPath: string | null = null;
    try {
      let imageUpdates: Record<string, unknown> = {};
      if (imageFile) {
        const extension = imageFile.type === "image/jpeg" ? "jpg" : imageFile.type === "image/webp" ? "webp" : "png";
        uploadedPath = `imports/${draft.pdf_import_id}/manual-stimuli/${draft.id}-${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from("question-assets").upload(uploadedPath, imageFile, {
          contentType: imageFile.type,
          upsert: false,
        });
        if (uploadError) throw new Error(`Image upload failed: ${uploadError.message}`);
        imageUpdates = {
          has_visual_stimulus: true,
          stimulus_image_path: uploadedPath,
          stimulus_source_image_path: uploadedPath,
          stimulus_crop_rect: null,
          stimulus_crop_source: "full_page",
          stimulus_crop_status: "pending",
        };
      }
      await fnJson(`admin-pdf-imports/${draft.pdf_import_id}/drafts/${draft.id}/editor`, {
        method: "PUT",
        token,
        body: {
          assigned_module_name: assignedModule,
          display_order: position,
          expected_updated_at: draft.updated_at,
          prompt,
          passage_text: passage.trim() ? passage : null,
          suggested_answer: correct || null,
          domain: domain || null,
          skill: skill || null,
          explanation: explanation || null,
          ...(draft.question_type === "multiple_choice" && JSON.stringify(choices.map((c, i) => ({ label: c.label, text: c.text, position: i + 1 }))) !==
            JSON.stringify(draft.choices.map((c, i) => ({ label: c.label, text: c.text, position: i + 1 }))) && {
            choices: choices.map((c, i) => ({ label: c.label, text: c.text, position: i + 1 })),
          }),
          ...imageUpdates,
        },
      });
      setImageFile(null);
      return position;
    } catch (err) {
      if (uploadedPath) await supabase.storage.from("question-assets").remove([uploadedPath]).catch(() => undefined);
      throw err;
    }
  }

  async function handleSave() {
    setBusy(true);
    setSavedNote(null);
    onError(null);
    try {
      const position = await saveDraft();
      setSavedNote(imageFile ? "Draft and image saved. Review and confirm the crop before approval." : "Draft saved.");
      await onSaved(assignedModule, position);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    setBusy(true);
    onError(null);
    try {
      // Save first: approval reads the draft row, so edited prompt, passage,
      // choices, and key must be persisted before publishing.
      const position = await saveDraft();
      if (imageFile) {
        setSavedNote("Image saved. Review and confirm its crop before approval.");
        await onSaved(assignedModule, position);
        return;
      }
      const token = await getToken();
      await fnJson(`admin-pdf-imports/${draft.pdf_import_id}/drafts/${draft.id}/approve`, {
        method: "POST",
        token,
        body: {},
      });
      await onSaved(assignedModule, position);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setBusy(false);
    }
  }

  const originalSnapshot = draft.parser_original_snapshot ?? null;
  const repairedSnapshot = draft.ai_repair_snapshot ?? null;
  const aiChangedFields = originalSnapshot && repairedSnapshot
    ? Object.keys(repairedSnapshot).filter((field) => field !== "ai_repair_snapshot" && JSON.stringify(originalSnapshot[field]) !== JSON.stringify(repairedSnapshot[field]))
    : [];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>
          Source Q{draft.source_question_number ?? "?"} — {draft.section === "math" ? "Math" : "Reading & Writing"} ({draft.question_type === "multiple_choice" ? "Multiple choice" : "Student-produced"})
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {sourceAvailable && (
            <Button size="sm" variant="outline" onClick={() => setSourceOpen(true)}>View source image</Button>
          )}
          {draft.parser_metadata?.manual_entry && <Pill tone="blue">Manual entry</Pill>}
          <DraftStatus d={draft} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(120px, 180px)", gap: 12, marginBottom: 14 }}>
        <div>
          <label className="field-label" htmlFor={`draft-module-${draft.id}`}>Assigned module</label>
          <select id={`draft-module-${draft.id}`} className="select" value={assignedModule} disabled={busy || placementLocked}
            onChange={(event) => {
              const nextModule = event.target.value as (typeof IMPORT_MODULES)[number];
              setAssignedModule(nextModule);
              setPositionInput(String((moduleSummary.find((module) => module.module === nextModule)?.total ?? 0) + 1));
            }}>
            {IMPORT_MODULES.map((module) => <option key={module} value={module}>{module}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor={`draft-position-${draft.id}`}>Position in module</label>
          <input id={`draft-position-${draft.id}`} className="input" type="number" min={1} step={1}
            value={positionInput} disabled={busy || placementLocked}
            onChange={(event) => setPositionInput(event.target.value)} />
        </div>
      </div>
      <p className="muted" style={{ margin: "-6px 0 12px", fontSize: 12 }}>
        Source: {draft.source_module_name ?? "module not identified"}, Q{draft.source_question_number ?? "?"}. Changing the assigned module requires human approval.
      </p>

      <label className="field-label">Prompt</label>
      <textarea className="textarea" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      {prompt.trim() && (
        <div style={{ marginTop: 8, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, fontSize: 13.5 }}>
          <span className="muted" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Preview (equations rendered)</span>
          <MathText text={prompt} />
        </div>
      )}

      <label className="field-label" style={{ marginTop: 12 }}>Passage (editable — clear to remove)</label>
      <textarea className="textarea" rows={4} value={passage} onChange={(e) => setPassage(e.target.value)} placeholder="No passage" />
      {passage.trim() && (
        <div style={{ marginTop: 8, background: "var(--passage-bg)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, fontSize: 13.5, maxHeight: 180, overflowY: "auto" }}>
          <MathText text={passage} />
        </div>
      )}

      <VisualCode code={draft.visual_code} format={draft.visual_format} />
      {draft.has_visual_stimulus && !draft.visual_code && !draft.stimulus_image_url && (
        <div style={{ marginTop: 12 }}>
          <label className="field-label">Stimulus Image</label>
          <div className="draft-visual-missing">
            Visual stimulus detected, but the full-page image has not been rendered yet. Run the stimulus backfill, then this question will show a Crop Graph tool.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void removeImage()}>Remove image</Button>
          </div>
        </div>
      )}

      {(!draft.visual_code && (draft.stimulus_image_url || (draft.has_visual_stimulus && sourceAvailable))) && (
        <>
          <label className="field-label" style={{ marginTop: 12 }}>
            Stimulus Image{" "}
            <span className="muted" style={{ fontWeight: 400 }}>
              {draft.has_visual_stimulus && draft.stimulus_crop_status === "pending" && draft.stimulus_crop_source === "auto" && "(auto-cropped — review required)"}
              {draft.has_visual_stimulus && draft.stimulus_crop_status === "pending" && draft.stimulus_crop_source !== "auto" && "(full page — review required)"}
              {draft.has_visual_stimulus && draft.stimulus_crop_status !== "pending" && draft.stimulus_crop_source === "manual" && "(manually adjusted)"}
              {draft.has_visual_stimulus && draft.stimulus_crop_status !== "pending" && draft.stimulus_crop_source === "auto" && "(auto-cropped)"}
            </span>
          </label>
          {(showFull ? sourcePageUrl : draft.stimulus_image_url) && <img
            src={(showFull ? (sourcePageUrl ?? draft.stimulus_image_url) : draft.stimulus_image_url) ?? undefined}
            alt={`Stimulus for Q${draft.source_question_number}`}
            style={{ maxWidth: "100%", border: "1px solid var(--border)", borderRadius: 8, marginTop: 4 }}
          />}
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            {draft.has_visual_stimulus && draft.stimulus_image_path && draft.stimulus_crop_source !== "full_page" && draft.stimulus_crop_status === "pending" && (
              <Button size="sm" disabled={busy} onClick={() => void confirmCrop()}>✓ Confirm crop</Button>
            )}
            {sourceAvailable && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setShowFull((v) => !v)}>
                {showFull ? "View crop" : "View full page"}
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={busy || !sourceAvailable} title={sourceAvailable ? "Adjust on the full-page source" : "Full-page source not available"} onClick={() => setCropOpen(true)}>✂ Adjust crop</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void resetCrop()}>Choose a new crop</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void removeImage()}>Remove image</Button>
          </div>
        </>
      )}

      {!draft.visual_code && <div className="panel" style={{ marginTop: 12 }}>
        <label className="field-label">Add or replace stimulus image</label>
        {imagePreview && (
          <div style={{ marginBottom: 10 }}>
            <img src={imagePreview} alt="Selected stimulus preview" style={{ maxWidth: "100%", maxHeight: 260, objectFit: "contain", border: "1px solid var(--border)", borderRadius: 8 }} />
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Unsaved image preview · saving it will require crop review.</div>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label className="btn btn-outline btn-sm" style={{ cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
            {imageFile ? "Choose another image" : draft.stimulus_image_path ? "Replace image" : "Add image"}
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={selectImage} disabled={busy} style={{ display: "none" }} />
          </label>
          {imageFile && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setImageFile(null)}>Clear selection</Button>}
        </div>
        <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>PNG, JPEG, or WebP up to 10 MB. Newly added images start as full-page crops and must be reviewed before approval.</p>
      </div>}

      {draft.question_type === "multiple_choice" && (
        <div style={{ marginTop: 12 }}>
          <label className="field-label">Choices</label>
          {choices.map((c) => (
            <div className="choice-edit" key={c.id}>
              <span className="letter" style={{ width: 26, height: 26, borderRadius: "50%", border: "2px solid var(--border-strong)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13 }}>
                {c.label}
              </span>
              <input
                className="input"
                value={c.text}
                onChange={(e) => setChoices((cs) => cs.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)))}
              />
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div>
          <label className="field-label">Correct answer</label>
          <input className="input" value={correct} onChange={(e) => setCorrect(e.target.value)} placeholder={draft.question_type === "multiple_choice" ? "B" : "24 or 3/5"} />
        </div>
        <div>
          <label className="field-label">Domain</label>
          <input className="input" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="e.g. Algebra" />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="field-label">Skill</label>
        <input className="input" value={skill} onChange={(e) => setSkill(e.target.value)} placeholder="e.g. Linear equations" />
      </div>

      {draft.difficulty != null && (
        <div style={{ marginTop: 12 }}>
          <label className="field-label">Difficulty</label>
          <span className="muted">{draft.difficulty === 1 ? "Easy" : draft.difficulty === 3 ? "Medium" : draft.difficulty === 5 ? "Hard" : draft.difficulty}</span>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <label className="field-label">Explanation</label>
        <textarea className="textarea" rows={3} value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="Optional explanation for this question" />
      </div>

      {draft.source_question_id && (
        <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
          Source ID: {draft.source_question_id}
        </p>
      )}
      {(draft.deterministic_risks?.length ?? 0) > 0 && (
        <div className="panel" style={{ marginTop: 12, borderColor: "var(--border-medium)" }}>
          <strong style={{ fontSize: 13 }}>Deterministic review risks</strong>
          <ul style={{ margin: "7px 0 0", paddingLeft: 18, fontSize: 12.5 }}>
            {draft.deterministic_risks?.map((risk) => (
              <li key={risk.code} style={{ marginBottom: 4 }}>
                <strong>{risk.severity}</strong>: {risk.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {draft.review_error_category && (
        <div className="login-error" style={{ marginTop: 12 }}>
          AI review could not complete for this draft ({draft.review_error_category.replaceAll("_", " ")}). Review it individually or rerun the import review.
        </div>
      )}
      {aiChangedFields.length > 0 && (
        <div className="panel" style={{ marginTop: 12, borderColor: "var(--border-medium)" }}>
          <strong style={{ fontSize: 13 }}>AI-fixed working version</strong>
          <p className="muted" style={{ margin: "6px 0", fontSize: 12.5 }}>Changed fields: {aiChangedFields.map((field) => field.replaceAll("_", " ")).join(", ")}. Human approval is still required.</p>
          <details>
            <summary style={{ cursor: "pointer", fontSize: 12.5 }}>Compare parser original and AI-fixed snapshots</summary>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10, marginTop: 8 }}>
              <pre style={{ margin: 0, padding: 10, overflow: "auto", whiteSpace: "pre-wrap", fontSize: 11.5, background: "var(--surface)" }}>{JSON.stringify(originalSnapshot, null, 2)}</pre>
              <pre style={{ margin: 0, padding: 10, overflow: "auto", whiteSpace: "pre-wrap", fontSize: 11.5, background: "var(--surface)" }}>{JSON.stringify(repairedSnapshot, null, 2)}</pre>
            </div>
          </details>
        </div>
      )}
      {(draft.review_findings?.filter((finding) => finding.status === "open").length ?? 0) > 0 && (
        <div className="panel" style={{ marginTop: 12, borderColor: "var(--border-medium)" }}>
          <strong style={{ fontSize: 13 }}>AI review findings</strong>
          {draft.review_findings?.filter((finding) => finding.status === "open").map((finding) => {
            const canApply = ["prompt", "passage_text", "suggested_answer"].includes(finding.proposed_field) && finding.proposed_value != null;
            return (
              <div key={finding.id} style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <Pill tone={finding.severity === "major" ? "red" : "blue"}>{finding.severity}</Pill>
                  {finding.applied_automatically && <Pill tone="green">AI repair applied</Pill>}
                  <strong style={{ fontSize: 12.5 }}>{finding.issue_type.replaceAll("_", " ")} · source page {finding.source_page}</strong>
                </div>
                <p style={{ fontSize: 13, margin: "7px 0 0" }}>{finding.explanation}</p>
                <blockquote style={{ margin: "7px 0", padding: "8px 10px", borderLeft: "3px solid var(--border-medium)", fontSize: 12.5 }}>
                  {finding.source_evidence}
                </blockquote>
                {finding.proposed_field !== "none" && (
                  <p className="muted" style={{ fontSize: 12.5, margin: "5px 0" }}>
                    Proposed {finding.proposed_field.replaceAll("_", " ")}: {typeof finding.proposed_value === "string" ? finding.proposed_value : finding.proposed_value == null ? "Review manually" : JSON.stringify(finding.proposed_value)}
                  </p>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  {canApply && <Button size="sm" disabled={busy} onClick={() => void acceptFinding(finding.id)}>Accept correction</Button>}
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void dismissFinding(finding.id)}>Dismiss</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {((draft.parser_metadata?.parse_flags?.length ?? 0) > 0 ||
        draft.parser_metadata?.source_number_origin === "inferred" ||
        draft.parser_metadata?.key_match_confidence === "low") && (
        <div className="panel" style={{ marginTop: 12, borderColor: "var(--border-medium)" }}>
          <strong style={{ fontSize: 13 }}>Parser review</strong>
         {draft.parser_metadata?.source_number_origin === "inferred" && (
           <p className="muted" style={{ margin: "6px 0 0", fontSize: 12.5 }}>Question number was inferred from document order; verify it against the source.</p>
         )}
          {draft.parser_metadata?.key_match_confidence === "low" && (
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 12.5 }}>
              Suggested answer matched by {draft.parser_metadata.key_match_method?.replaceAll("_", " ") ?? "inferred alignment"}; verify it against the source before approval.
            </p>
          )}
          {(draft.parser_metadata?.parse_flags?.length ?? 0) > 0 && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12.5 }}>
              {draft.parser_metadata?.parse_flags?.map((flag) => <li key={flag}>{flag.replaceAll("_", " ")}</li>)}
            </ul>
          )}
        </div>
      )}

      {draft.parser_metadata?.answer_key_state && draft.parser_metadata.answer_key_state !== "matched" && (
        <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
          {draft.parser_metadata.answer_key_state === "unmatched"
            ? "The document contains answer-key entries, but none could be safely matched to this question."
            : "No answer key was detected in the document."}
        </p>
      )}

      {draft.answer_keys.length > 0 && (
        <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
          Detected answer{Object.values(draft.answer_keys.map((k) => k.detected_answer)).join(", ")} — confidence{" "}
          {Math.round((draft.answer_keys[0]?.confidence ?? 0) * 100)}%. Verify before approving.
        </p>
      )}

      {savedNote && <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>{savedNote}</p>}

      <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
        <Button variant="danger" disabled={busy} onClick={onReject}>Reject</Button>
        <Button variant="outline" disabled={busy} onClick={() => void handleSave()}>{busy ? "Saving…" : "Save draft"}</Button>
        {draft.review_state === "review" && <Button disabled={busy} onClick={() => void approve()}>{busy ? "Saving…" : "Approve Draft"}</Button>}
      </div>

      {sourcePage.error && <p className="login-error" role="alert">{sourcePage.error}</p>}
      {(cropOpen || sourceOpen || showFull) && draft.source_document_id && !sourcePage.url && !sourcePage.error && <p className="muted">Loading original page from Drive…</p>}
      {cropOpen && (sourcePageUrl ?? draft.stimulus_image_url) && !(!sourcePageUrl && draft.source_document_id) && (
        <CropImageModal
          title={`Crop Graph — Q${draft.source_question_number}`}
          src={(sourcePageUrl ?? draft.stimulus_image_url)!}
          initialRect={draft.stimulus_crop_source === "auto" ? (draft.stimulus_crop_rect ?? null) : null}
          onCancel={() => {
            if (!busy) setCropOpen(false);
          }}
          onSave={saveCrop}
        />
      )}
      {sourceOpen && sourcePageUrl && (
        <Modal title={`Source image — Q${draft.source_question_number}`} onClose={() => setSourceOpen(false)}>
          <img
            src={sourcePageUrl!}
            alt={`Source page for Q${draft.source_question_number}`}
            style={{ display: "block", maxWidth: "100%", maxHeight: "75vh", margin: "0 auto", objectFit: "contain" }}
          />
        </Modal>
      )}
    </div>
  );
}
