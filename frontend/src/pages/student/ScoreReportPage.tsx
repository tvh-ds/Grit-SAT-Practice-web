import VisualCode from "../../components/VisualCode";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { ReviewItem, ScoreDetail } from "../../lib/types";
import { Button, EmptyState, Pill, Spinner, fmtDate } from "../../components/ui";
import MathText from "../../components/MathText";
import PassageBlock from "../../components/PassageBlock";

type Tab = "all" | "wrong" | "unanswered";

export default function ScoreReportPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ScoreDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [section, setSection] = useState("all");
  const [domain, setDomain] = useState("all");
  const [skill, setSkill] = useState("all");

  useEffect(() => {
    if (!attemptId) return;
    void (async () => {
      try {
        const token = await getToken();
        setData(await fnJson<ScoreDetail>(`student-scores/${attemptId}`, { token }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load score");
      }
    })();
  }, [attemptId]);

  const review = data?.review ?? [];

  const domains = useMemo(() => Array.from(new Set(review.map((r) => r.domain).filter(Boolean))).sort() as string[], [review]);
  const skills = useMemo(() => Array.from(new Set(review.map((r) => r.skill).filter(Boolean))).sort() as string[], [review]);

  const filtered = useMemo(() => {
    return review.filter((r) => {
      if (tab === "wrong" && r.is_correct !== false) return false;
      if (tab === "unanswered" && !r.unanswered) return false;
      if (section !== "all" && r.section_type !== section) return false;
      if (domain !== "all" && r.domain !== domain) return false;
      if (skill !== "all" && r.skill !== skill) return false;
      return true;
    });
  }, [review, tab, section, domain, skill]);

  const bySection = useMemo(() => {
    const map = new Map<string, { correct: number; total: number }>();
    for (const r of review) {
      const key = r.section_type ?? "other";
      const e = map.get(key) ?? { correct: 0, total: 0 };
      e.total++;
      if (r.is_correct === true) e.correct++;
      map.set(key, e);
    }
    return map;
  }, [review]);

  const byDomain = useMemo(() => {
    const map = new Map<string, { correct: number; total: number; skills: Set<string> }>();
    for (const r of review) {
      const key = r.domain ?? "Uncategorized";
      const e = map.get(key) ?? { correct: 0, total: 0, skills: new Set<string>() };
      e.total++;
      if (r.is_correct === true) e.correct++;
      if (r.skill) e.skills.add(r.skill);
      map.set(key, e);
    }
    return [...map.entries()].map(([domain, v]) => ({ domain, ...v, skills: [...v.skills] }));
  }, [review]);

  if (error) {
    return (
      <div className="center-fill">
        <p>{error}</p>
        <Button variant="outline" onClick={() => navigate("/student/results")}>Back to results</Button>
      </div>
    );
  }
  if (!data) return <Spinner />;

  const totalQ = review.length;
  const correct = review.filter((r) => r.is_correct === true).length;
  const wrong = review.filter((r) => r.is_correct === false).length;
  const unanswered = review.filter((r) => r.unanswered).length;
  const pct = totalQ > 0 ? Math.round((correct / totalQ) * 100) : 0;

  return (
    <div className="score-report">
      <div className="section-label">Score report</div>
      <div className="page-head-row">
        <div>
          <h1 className="page-title"><span className="hl-muted">Score</span> <span className="hl-bright">report</span></h1>
          <p className="page-sub">
            {data.attempt.test?.title ?? "Full-Length Test"} · Submitted {fmtDate(data.attempt.submitted_at)}
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate("/student/results")}>← Results</Button>
      </div>

      <div className="score-hero">
        <div>
          <div className="lbl">Correct answers</div>
          <div className="big">
            {correct} <span className="hero-soft" style={{ fontSize: 20, fontWeight: 600 }}>/ {totalQ}</span>
          </div>
          <div className="lbl" style={{ marginTop: 6 }}>
            Accuracy {pct}%
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <Pill tone="green">{correct} correct</Pill>
            <Pill tone="red">{wrong} wrong</Pill>
            {unanswered > 0 && <Pill tone="amber">{unanswered} unanswered</Pill>}
          </div>
        </div>
        <div className="score-orbit" style={{ "--score-pct": `${pct}%` } as CSSProperties} role="img" aria-label={`${pct}% accuracy`}><span>{pct}%</span></div>
        <div style={{ textAlign: "right" }}>
          <div className="lbl">Section accuracy</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>
            {[...bySection.entries()].map(([name, s]) => {
              const spct = s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
              return (
                <div key={name} style={{ marginTop: 8, textAlign: "right" }}>
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center" }}>
                    <span className="hero-soft">{name === "reading_writing" ? "Reading & Writing" : "Math"}</span>
                    <span>{s.correct}/{s.total}</span>
                    <span className="hero-soft" style={{ fontSize: 12.5 }}>({spct}%)</span>
                  </div>
                  <div className="score-bar" style={{ width: 200, marginLeft: "auto" }}>
                    <div style={{ width: `${spct}%`, background: spct >= 70 ? "var(--green)" : spct >= 40 ? "var(--amber)" : "var(--red)" }} />
                  </div>
                </div>
              );
            })}
            {bySection.size === 0 && <span className="hero-soft">—</span>}
          </div>
        </div>
      </div>

      {byDomain.length > 0 && (
        <section style={{ marginBottom: 30 }}>
          <div className="section-label">Domains</div>
          <div className="section-head">
            <h2>Performance by Domain</h2>
          </div>
          <div className="card card-pad">
            {byDomain.map((t) => {
              const tpct = t.total > 0 ? Math.round((t.correct / t.total) * 100) : 0;
              return (
                <div key={t.domain} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, fontWeight: 600 }}>
                    <span>
                      {t.domain}
                      {t.skills.length === 1 ? ` · ${t.skills[0]}` : ""}
                    </span>
                    <span className="muted">
                      {t.correct}/{t.total} ({tpct}%)
                    </span>
                  </div>
                  <div className="score-bar">
                    <div style={{ width: `${tpct}%`, background: tpct >= 70 ? "var(--green)" : tpct >= 40 ? "var(--amber)" : "var(--red)" }} />
                  </div>
                  {t.skills.length > 1 && (
                    <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                      {t.skills.map((s) => (
                        <span key={s} className="pill pill-blue">{s}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <div className="section-label">Review</div>
        <div className="section-head" style={{ flexWrap: "wrap" }}>
          <h2>Answer Review</h2>
        </div>

        {data.explanations_released === false && (
          <div className="card card-pad" style={{ marginBottom: 16, fontSize: 13.5 }}>
            You can see your score and the correct answers below. Explanations unlock 7 days after
            you submit, or sooner if your teacher releases them.
          </div>
        )}

        <div className="score-tabs">
          <button className={`score-tab${tab === "all" ? " active" : ""}`} onClick={() => setTab("all")}>All ({review.length})</button>
          <button className={`score-tab${tab === "wrong" ? " active" : ""}`} onClick={() => setTab("wrong")}>Incorrect ({wrong})</button>
          <button className={`score-tab${tab === "unanswered" ? " active" : ""}`} onClick={() => setTab("unanswered")}>Unanswered ({unanswered})</button>
        </div>

        <div className="filter-row">
          <select className="input" value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="all">All sections</option>
            <option value="reading_writing">Reading & Writing</option>
            <option value="math">Math</option>
          </select>
          <select className="input" value={domain} onChange={(e) => setDomain(e.target.value)}>
            <option value="all">All domains</option>
            {domains.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className="input" value={skill} onChange={(e) => setSkill(e.target.value)}>
            <option value="all">All skills</option>
            {skills.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {filtered.length === 0 ? (
          <EmptyState title="No questions match" body="Try a different tab or filter." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {filtered.map((item) => (
              <ReviewCard key={item.question_id} item={item} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ReviewCard({ item }: { item: ReviewItem }) {
  const [open, setOpen] = useState(true);
  const selected = item.choices.find((c) => c.id === item.selected_choice_id);
  return (
    <div className={`review-item${open ? " review-open" : ""}`}>
      <div className="qhead">
        <span className="prompt">
          Q{item.question_number}. <MathText text={item.prompt ?? "Question"} />
        </span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
          {item.section_type === "math" ? <Pill tone="blue">Math</Pill> : <Pill tone="blue">Reading & Writing</Pill>}
          {item.unanswered ? (
            <Pill tone="amber">Unanswered</Pill>
          ) : item.is_correct ? (
            <Pill tone="green">Correct</Pill>
          ) : (
            <Pill tone="red">Incorrect</Pill>
          )}
          {item.marked_for_review && <Pill tone="amber">✦ Marked</Pill>}
          <button className="review-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Hide details ▴" : "Show details ▾"}
          </button>
        </div>
      </div>

      <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
        {item.module_name} · {[item.domain, item.skill].filter(Boolean).join(" · ") || "No topic"}
      </div>

      <PassageBlock passage={item.passage} compact />
      <VisualCode code={item.visual_code} format={item.visual_format} />
      {!item.visual_code && item.stimulus_image_url && (
        <img src={item.stimulus_image_url} alt="Question stimulus" style={{ maxWidth: "100%", maxHeight: 260, objectFit: "contain", borderRadius: 10, marginTop: 10 }} />
      )}

      <div className="review-detail">
        <div>
      {item.question_type === "multiple_choice" ? (
        <div className="review-choices">
          {item.choices.map((c) => {
            const isSel = c.id === item.selected_choice_id;
            const cls = c.is_correct ? "correct-ans" : isSel ? "wrong-sel" : "";
            return (
              <div key={c.id} className={`rev-choice ${cls}`}>
                <span className="letter">{c.label}</span>
                <span style={{ flex: 1 }}><MathText text={c.text} /></span>
                {c.is_correct && <span style={{ color: "var(--green)", fontWeight: 700 }}>✓ correct</span>}
                {isSel && !c.is_correct && <span style={{ color: "var(--red)", fontWeight: 700 }}>✗ your answer</span>}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="answer-chips">
          <div className={`chip ${item.unanswered ? "chip-muted" : item.is_correct ? "chip-ok" : "chip-bad"}`}>
            Your answer: {item.your_answer ?? "not answered"}
          </div>
          <div className="chip chip-ok">Correct: {item.correct_answer ?? "—"}</div>
        </div>
      )}

      {!item.unanswered && selected && item.correct_answers.length === 0 && (
        <div className="answer-line incorrect">Your answer: {item.your_answer}</div>
      )}

      {item.explanation && (
        <div className="muted" style={{ fontSize: 13.5, marginTop: 8, lineHeight: 1.6 }}>
          <strong style={{ display: "block", marginBottom: 2 }}>Explanation</strong>
          <MathText text={item.explanation} />
        </div>
      )}
        </div>
      </div>
    </div>
  );
}
