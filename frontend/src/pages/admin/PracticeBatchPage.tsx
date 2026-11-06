import VisualCode from "../../components/VisualCode";
import { deferComponent } from "../../components/deferComponent";
import { adminReturnPath } from "../../lib/adminNavigation";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { BatchStudent, PracticeBatchDetail } from "../../lib/types";
import { Button, Pill, Spinner, fmtDate } from "../../components/ui";
import MathText from "../../components/MathText";
import PassageBlock from "../../components/PassageBlock";
const AssignmentReviewModal = deferComponent(() => import("./AssignmentReviewModal"));
import ClassBadge from "../../components/ClassBadge";
import DeleteAssignmentButton from "../../components/DeleteAssignmentButton";
import { useAssignmentAnnotations } from "../../components/AssignmentAnnotations";

function statusTone(s: string): "green" | "amber" | "gray" {
  if (s === "graded" || s === "completed") return "green";
  if (s === "in_progress" || s === "submitted") return "amber";
  return "gray";
}

function statusLabel(s: string): string {
  if (s === "graded" || s === "completed") return "Completed";
  if (s === "in_progress" || s === "submitted") return "In progress";
  return "Not started";
}

export default function PracticeBatchPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const back = adminReturnPath(params.get("return_to"), "/admin/assignments");
  const { batchId } = useParams<{ batchId: string }>();
  const [data, setData] = useState<PracticeBatchDetail | null>(null);
  const [tab, setTab] = useState<"students" | "questions">("students");
  const [wrongOnly, setWrongOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState<BatchStudent | null>(null);
  const annotationQuestions = useMemo(() => (data?.questions ?? []).map((q, i) => ({
    ...q, question_number: i + 1, choices: [...q.choices].sort((a, b) => a.position - b.position),
  })), [data]);
  const annotations = useAssignmentAnnotations(`admin-practice-assignments/${batchId}`, annotationQuestions, data?.batch.title ?? "Assignment review");

  async function load() {
    try {
      const token = await getToken();
      const d = await fnJson<PracticeBatchDetail>(`admin-practice-assignments/${batchId}`, { token });
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load assignment");
    }
  }

  useEffect(() => {
    setWrongOnly(false);
    void load();
  }, [batchId]);

  async function release() {
    if (!data || data.batch.explanations_released_at) return;
    if (!window.confirm("Release explanations to all students in this assignment? This cannot be undone.")) return;
    setBusy(true);
    try {
      const token = await getToken();
      await fnJson(`admin-practice-assignments/${batchId}/release`, { method: "POST", token });
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to release explanations");
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) return <Spinner />;
  if (!data) {
    return (
      <div>
        <h1 className="page-title">Error</h1>
        <div className="login-error">{error}</div>
      </div>
    );
  }

  const b = data.batch;
  const released = !!b.explanations_released_at;
  const wrongQuestionCount = data.questions.filter((q) => q.incorrect_count > 0).length;
  const visibleQuestions = data.questions
    .map((question, index) => ({ question, index }))
    .filter(({ question }) => !wrongOnly || question.incorrect_count > 0);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <Link to={back} className="muted" style={{ textDecoration: "none" }}>← Back to assignments</Link>
        <h1 className="page-title" style={{ margin: 0 }}>Assigned Practice Set</h1>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: "4px 0", fontWeight: 700 }}>{b.title}</h2>
        <ClassBadge {...b} />
        <Pill tone={released ? "green" : "gray"}>{released ? "Explanations released" : "Automatic release after 7 days"}</Pill>
        <span className="muted" style={{ fontSize: 13 }}>
          Assigned {fmtDate(b.assigned_at)} · {b.timer_minutes} min · {data.questions.length} question(s) · {data.students.length} student(s)
        </span>
        {!released && (
          <Button size="sm" disabled={busy} onClick={() => void release()} style={{ marginLeft: "auto" }}>
            {busy ? "Releasing…" : "Release explanations"}
          </Button>
        )}
        <DeleteAssignmentButton kind="practice" batch={{ ...b, student_count: data.students.length }} disabled={busy} onDeleted={() => navigate("/admin/assignments", { replace: true })} />
      </div>
      {!released && (
        <p className="muted" style={{ fontSize: 13 }}>
          Explanations unlock for each student 7 days after they submit. Release them now to make them available to everyone in this assignment.
        </p>
      )}

      {error && <div className="login-error">{error}</div>}

      <div className="score-tabs" style={{ margin: "16px 0" }}>
        <button className={`score-tab${tab === "students" ? " active" : ""}`} onClick={() => setTab("students")}>
          Students ({data.students.length})
        </button>
        <button className={`score-tab${tab === "questions" ? " active" : ""}`} onClick={() => setTab("questions")}>
          All Questions ({data.questions.length})
        </button>
      </div>

      {tab === "students" && (
        <div className="card card-pad">
          <table className="table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Status</th>
                <th>Started</th>
                <th>Submitted</th>
                <th>Score</th>
                <th>Accuracy</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.students.map((s) => (
                <tr key={s.assignment_id}>
                  <td>
                    <Link to={`/admin/students/${s.student_id}?return_to=${encodeURIComponent(location.pathname + location.search)}`} style={{ fontWeight: 600 }}>{s.full_name || "Unnamed"}</Link>
                    {s.email && <div className="muted" style={{ fontSize: 12 }}>{s.email}</div>}
                  </td>
                  <td><Pill tone={statusTone(s.status)}>{statusLabel(s.status)}</Pill></td>
                  <td>{s.started_at ? fmtDate(s.started_at) : "—"}</td>
                  <td>{s.submitted_at ? fmtDate(s.submitted_at) : "—"}</td>
                  <td>{s.raw_score != null && s.total_questions != null ? `${s.raw_score}/${s.total_questions}` : "—"}</td>
                  <td>{s.accuracy != null ? `${s.accuracy}%` : "—"}</td>
                  <td><Button variant="outline" size="sm" disabled={!s.review_attempt_id} onClick={() => setReviewing(s)}>Review</Button></td>
                </tr>
              ))}
              {data.students.length === 0 && (
                <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>No students in this assignment.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "questions" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14 }}>
              <input type="checkbox" checked={wrongOnly} onChange={(event) => setWrongOnly(event.target.checked)} />
              Wrong questions only ({wrongQuestionCount})
            </label>
            <span className="muted" style={{ fontSize: 13 }} role="status">
              Showing {visibleQuestions.length} of {data.questions.length} questions
            </span>
          </div>
          {wrongOnly && <p className="muted" style={{ fontSize: 13, margin: 0 }}>Questions answered incorrectly by at least one student in a completed attempt.</p>}
          {annotations.toolbar}
          {visibleQuestions.map(({ question: q, index: i }) => (
            <div key={q.question_id} className="card card-pad">
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>Q{i + 1}</span>
                {annotations.button(annotationQuestions[i])}
                <Pill tone="green">{q.correct_count} right</Pill>
                <Pill tone="red">{q.incorrect_count} wrong</Pill>
                {q.unanswered_count > 0 && <Pill tone="amber">{q.unanswered_count} unanswered</Pill>}
                <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>
                  {q.accuracy != null ? `${q.accuracy}% right` : "no completed attempts"} · of {q.completed_count} completed
                </span>
              </div>
              <PassageBlock passage={q.passage} compact />
              <VisualCode code={q.visual_code} format={q.visual_format} />
              {!q.visual_code && q.stimulus_image_url && <img src={q.stimulus_image_url} alt="Question stimulus" style={{ maxWidth: "100%", maxHeight: 260, objectFit: "contain", marginBottom: 12 }} />}
              <p style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.6, margin: "0 0 10px" }}>
                <MathText text={q.prompt} />
              </p>
              {q.question_type === "multiple_choice" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[...q.choices].sort((a, b) => a.position - b.position).map((c) => {
                    const pct = q.completed_count > 0 ? Math.round((c.selected_count / q.completed_count) * 100) : 0;
                    return (
                      <div
                        key={c.id}
                        style={{
                          display: "flex",
                          gap: 10,
                          alignItems: "center",
                          padding: "8px 10px",
                          borderRadius: 8,
                          fontSize: 13.5,
                          border: c.is_correct ? "1px solid var(--accent, #4ade80)" : "1px solid rgba(255,255,255,0.12)",
                          background: c.is_correct ? "rgba(74,222,128,0.08)" : "transparent",
                        }}
                      >
                        <span style={{ fontWeight: 600, minWidth: 18 }}>{c.label}</span>
                        <span style={{ flex: 1, lineHeight: 1.5 }}><MathText text={c.text} /></span>
                        {c.is_correct && <span style={{ fontWeight: 600, color: "var(--accent, #4ade80)" }}>✓ correct</span>}
                        <span className="muted" style={{ fontSize: 12.5 }}>{c.selected_count} ({pct}%)</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 13.5 }}>
                  <p style={{ margin: "0 0 6px" }}>
                    <span className="muted">Correct answer: </span>
                    <span style={{ fontWeight: 600 }}>{q.correct_answer ?? "—"}</span>
                  </p>
                  {q.typed_answers.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                      {q.typed_answers.map((t) => (
                        <span key={t.answer} className="pill pill-gray">{t.answer} · {t.count}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {data.questions.length === 0 && (
            <div className="card card-pad muted" style={{ fontSize: 14 }}>No questions in this assignment.</div>
          )}
          {wrongOnly && data.questions.length > 0 && visibleQuestions.length === 0 && (
            <div className="card card-pad muted" style={{ fontSize: 14 }}>No wrong answers in completed attempts. Clear the filter to see all questions.</div>
          )}
        </div>
      )}
      {annotations.overlay}

      {reviewing?.review_attempt_id && (
        <AssignmentReviewModal
          title={`Review — ${reviewing.full_name || reviewing.email || "Student"}`}
          endpoint={`admin-practice-assignments/${batchId}/attempts/${reviewing.review_attempt_id}`}
          onClose={() => setReviewing(null)}
        />
      )}
    </div>
  );
}
