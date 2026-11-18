import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Target, Trophy } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { fnJson, getToken } from "../../lib/supabase";
import type { ScoreEntry } from "../../lib/types";
import { EmptyState, Pill, Spinner, fmtDate } from "../../components/ui";
import { initReveal } from "../../lib/reveal";
import { deferComponent } from "../../components/deferComponent";
const ErrorLogPanel = deferComponent(() => import("./ErrorLogPanel"));
import "../../styles/student-error-log.css";

type ReviewSection = "results" | "error-log";

export default function ResultsPage() {
  const { profile } = useAuth();
  const [section, setSection] = useState<ReviewSection>("results");
  const [errorLogOpened, setErrorLogOpened] = useState(false);
  const [history, setHistory] = useState<ScoreEntry[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyRetry, setHistoryRetry] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const token = await getToken();
        const result = await fnJson<{ history: ScoreEntry[] }>("student-scores", { token });
        if (active) {
          setHistory(result.history.filter((item) => item.status === "graded"));
          setHistoryError(null);
        }
      } catch (loadError) {
        if (active) setHistoryError(loadError instanceof Error ? loadError.message : "Unable to load results.");
      }
    })();
    return () => { active = false; };
  }, [historyRetry]);

  useEffect(() => {
    if (history && section === "results") requestAnimationFrame(() => initReveal());
  }, [history, section]);

  const studentName = profile?.full_name?.trim() || "there";

  return (
    <main className="student-review-page">
      <header className="student-review-heading">
        <div className="section-label">Review</div>
        <h1 className="page-title">Review your progress</h1>
        <p className="page-sub">See how your attempts went, then revisit questions that need another look.</p>
      </header>

      <div className="score-tabs review-section-switch" role="tablist" aria-label="Review sections">
        <button
          id="results-tab"
          className={`score-tab${section === "results" ? " active" : ""}`}
          type="button"
          role="tab"
          aria-selected={section === "results"}
          aria-controls="results-panel"
          onClick={() => setSection("results")}
        >Results</button>
        <button
          id="error-log-tab"
          className={`score-tab${section === "error-log" ? " active" : ""}`}
          type="button"
          role="tab"
          aria-selected={section === "error-log"}
          aria-controls="error-log-panel"
          onClick={() => { setErrorLogOpened(true); setSection("error-log"); }}
        >Error Log</button>
      </div>

      <section id="results-panel" role="tabpanel" aria-labelledby="results-tab" tabIndex={0} hidden={section !== "results"}>
        {historyError ? (
          <div className="card card-pad review-load-error" role="alert">
            <p>{historyError}</p>
            <button className="btn btn-secondary" type="button" onClick={() => setHistoryRetry((value) => value + 1)}>Retry</button>
          </div>
        ) : history === null ? (
          <div className="review-loading" role="status"><Spinner /><span>Loading results…</span></div>
        ) : (
          <ResultsPanel history={history} />
        )}
      </section>
      <section id="error-log-panel" role="tabpanel" aria-labelledby="error-log-tab" tabIndex={0} hidden={section !== "error-log"}>
        {errorLogOpened && <ErrorLogPanel studentName={studentName} />}
      </section>
    </main>
  );
}

function ResultsPanel({ history }: { history: ScoreEntry[] }) {
  const withScore = history.filter((attempt) => attempt.score);
  const avg = withScore.length > 0
    ? Math.round(withScore.reduce((sum, attempt) => sum + (attempt.score?.accuracy ?? 0), 0) / withScore.length)
    : 0;
  const totalCorrect = withScore.reduce((sum, attempt) => sum + (attempt.score?.raw_score ?? 0), 0);
  const totalAnswered = withScore.reduce((sum, attempt) => sum + (attempt.score?.total_questions ?? 0), 0);

  if (history.length === 0) {
    return <EmptyState title="No results yet" body="Complete a test or practice set and your report will appear here." />;
  }

  return (
    <div className="results-section">
      <section className="review-results-summary" aria-label="Results summary">
        <div className="section-label">Results</div>
        <h2 className="page-title"><span className="hl-muted">Your</span> <span className="hl-bright">results</span></h2>
        <p className="page-sub">Completed attempts with full answer reviews.</p>

        <div className="stat-grid">
          <div className="stat-card reveal">
            <div className="ico"><Trophy size={18} strokeWidth={1.6} /></div>
            <div className="num" data-countup={history.length}>{history.length}</div>
            <div className="lbl">Completed</div>
            <div className="arch-meta">{withScore.length} graded attempt{withScore.length === 1 ? "" : "s"}</div>
          </div>
          <div className="stat-card reveal">
            <div className="ico"><Target size={18} strokeWidth={1.6} /></div>
            <div className="num">{avg}%</div>
            <div className="lbl">Average accuracy</div>
            <div className="arch-meta">Average across graded attempts</div>
          </div>
          <div className="stat-card reveal">
            <div className="ico"><CheckCircle2 size={18} strokeWidth={1.6} /></div>
            <div className="num">{totalCorrect}<span className="muted"> / {totalAnswered}</span></div>
            <div className="lbl">Questions correct</div>
            <div className="arch-meta">Out of {totalAnswered} answered questions</div>
          </div>
        </div>
      </section>

      <div className="section-label" style={{ marginTop: 28 }}>[ Attempts ]</div>
      <div className="section-head">
        <h2>All Attempts</h2>
        <span className="muted" style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>{history.length} GRADED</span>
      </div>

      <div className="results-attempt-list">
        {history.map((attempt) => {
          const score = attempt.score;
          const sectionScores = score?.section_scores ?? {};
          const accuracy = score && score.total_questions > 0
            ? Math.round((score.raw_score / score.total_questions) * 100)
            : 0;
          return (
            <article className="card card-pad reveal result-attempt-card" key={attempt.id}>
              <div className="result-attempt-primary">
                <div className="result-attempt-title">
                  <h3 className="t-title">{attempt.test?.title ?? "Completed test"}</h3>
                  {attempt.test?.kind === "practice" && <Pill tone="amber">Practice</Pill>}
                </div>
                <p className="t-desc">Submitted {fmtDate(attempt.submitted_at)}</p>
                <div className="score-bar result-attempt-progress"><div style={{ width: `${accuracy}%` }} /></div>
              </div>
              <div className="result-attempt-sections">
                {Object.keys(sectionScores).length === 0 && <span className="muted">No section data</span>}
                {Object.entries(sectionScores).map(([name, values]) => (
                  <div className="result-attempt-section" key={name}>
                    <span>{name === "reading_writing" ? "Reading & Writing" : "Math"}</span>
                    <strong>{values.correct}/{values.total}</strong>
                  </div>
                ))}
              </div>
              <div className="result-attempt-score">
                <strong>{score ? `${score.accuracy}%` : "—"}</strong>
                <span>{score ? `${score.raw_score} / ${score.total_questions}` : "NO SCORE"}</span>
              </div>
              <Link className="btn btn-secondary" to={`/student/scores/${attempt.id}`}>{attempt.test?.kind === "practice" ? "Review practice" : "Open Report"}</Link>
            </article>
          );
        })}
      </div>
    </div>
  );
}
