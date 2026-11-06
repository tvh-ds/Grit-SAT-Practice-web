import VisualCode from "../../components/VisualCode";
import { useEffect, useMemo, useState } from "react";
import { fnJson, getToken } from "../../lib/supabase";
import type { ReviewItem, ScoreDetail } from "../../lib/types";
import { Button, EmptyState, Modal, Pill, Spinner, fmtDate } from "../../components/ui";
import MathText from "../../components/MathText";
import PassageBlock from "../../components/PassageBlock";
import { useAssignmentAnnotations } from "../../components/AssignmentAnnotations";

type Tab = "all" | "wrong" | "unanswered";

export default function AssignmentReviewModal({
  title,
  endpoint,
  onClose,
}: {
  title: string;
  endpoint: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<ScoreDetail | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const token = await getToken();
        setData(await fnJson<ScoreDetail>(endpoint, { token }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load review");
      }
    })();
  }, [endpoint]);

  const review = data?.review ?? [];
  const correct = review.filter((r) => r.is_correct === true).length;
  const wrong = review.filter((r) => r.is_correct === false).length;
  const unanswered = review.filter((r) => r.unanswered).length;
  const pct = review.length > 0 ? Math.round((correct / review.length) * 100) : 0;

  const filtered = useMemo(() => review.filter((r) => {
    if (tab === "wrong" && r.is_correct !== false) return false;
    if (tab === "unanswered" && !r.unanswered) return false;
    return true;
  }), [review, tab]);
  const annotations = useAssignmentAnnotations(endpoint, review, title);

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={<Button variant="outline" onClick={onClose}>Close</Button>}
    >
      {error && <div className="login-error">{error}</div>}
      {!data && !error && <Spinner />}
      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card card-pad" style={{ background: "var(--bg-surface)", fontSize: 13.5 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 700 }}>{data.attempt.test?.title ?? "Assigned test"}</div>
                <div className="muted">Submitted {fmtDate(data.attempt.submitted_at)}</div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <Pill tone="green">{correct}/{review.length} correct</Pill>
                <Pill tone={pct >= 70 ? "green" : pct >= 40 ? "amber" : "red"}>{pct}%</Pill>
                {unanswered > 0 && <Pill tone="amber">{unanswered} unanswered</Pill>}
              </div>
            </div>
          </div>

          <div className="score-tabs" style={{ margin: 0 }}>
            <button className={`score-tab${tab === "all" ? " active" : ""}`} onClick={() => setTab("all")}>All ({review.length})</button>
            <button className={`score-tab${tab === "wrong" ? " active" : ""}`} onClick={() => setTab("wrong")}>Incorrect ({wrong})</button>
            <button className={`score-tab${tab === "unanswered" ? " active" : ""}`} onClick={() => setTab("unanswered")}>Unanswered ({unanswered})</button>
          </div>
          {annotations.toolbar}

          {filtered.length === 0 ? (
            <EmptyState title="No questions match" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {filtered.map((item) => <ReviewCard key={item.question_id} item={item} annotate={annotations.button(item)} />)}
            </div>
          )}
        </div>
      )}
      {annotations.overlay}
    </Modal>
  );
}

function ReviewCard({ item, annotate }: { item: ReviewItem; annotate: React.ReactNode }) {
  return (
    <div className="review-item review-open">
      <div className="qhead">
        <span className="prompt">Q{item.question_number}. <MathText text={item.prompt ?? "Question"} /></span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {item.unanswered ? <Pill tone="amber">Unanswered</Pill> : item.is_correct ? <Pill tone="green">Correct</Pill> : <Pill tone="red">Incorrect</Pill>}
          {item.marked_for_review && <Pill tone="amber">Marked</Pill>}
          {annotate}
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
      {item.question_type === "multiple_choice" ? (
        <div className="review-choices">
          {item.choices.map((c) => {
            const isSelected = c.id === item.selected_choice_id;
            const cls = c.is_correct ? "correct-ans" : isSelected ? "wrong-sel" : "";
            return (
              <div key={c.id} className={`rev-choice ${cls}`}>
                <span className="letter">{c.label}</span>
                <span style={{ flex: 1 }}><MathText text={c.text} /></span>
                {c.is_correct && <span style={{ color: "var(--green)", fontWeight: 700 }}>correct</span>}
                {isSelected && !c.is_correct && <span style={{ color: "var(--red)", fontWeight: 700 }}>student choice</span>}
                {isSelected && c.is_correct && <span style={{ color: "var(--green)", fontWeight: 700 }}>student choice</span>}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="answer-chips" style={{ marginTop: 10 }}>
          <div className={`chip ${item.unanswered ? "chip-muted" : item.is_correct ? "chip-ok" : "chip-bad"}`}>Student: {item.your_answer ?? "not answered"}</div>
          <div className="chip chip-ok">Correct: {item.correct_answer ?? "—"}</div>
        </div>
      )}
      {item.explanation && (
        <div className="muted" style={{ fontSize: 13.5, marginTop: 10, lineHeight: 1.6 }}>
          <strong style={{ display: "block", marginBottom: 2 }}>Explanation</strong>
          <MathText text={item.explanation} />
        </div>
      )}
    </div>
  );
}
