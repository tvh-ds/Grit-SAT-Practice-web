import VisualCode from "../../components/VisualCode";
import { useState, type FormEvent } from "react";
import { fnJson, getToken } from "../../lib/supabase";
import { Button, Modal } from "../../components/ui";
import MathText from "../../components/MathText";
import PassageBlock from "../../components/PassageBlock";
import {
  type SectionKey,
  type Domain,
  type DifficultyLabel,
  SECTIONS,
  DIFFICULTIES,
  domainsForSection,
  skillsForDomain,
  difficultyLabel,
  difficultyValue,
  sectionLabel,
} from "../../lib/satTaxonomy";

export interface QListRow {
  id: string;
  prompt: string;
  section: string;
  question_type: string;
  domain: string | null;
  skill: string | null;
  difficulty: number | null;
  choices: { id: string; label: string; text: string; is_correct: boolean; position?: number }[];
  correct_answer: string | null;
  explanation?: string | null;
  passage?: { id: string; title: string | null; content: string | null } | null;
  stimulus_image_path?: string | null;
  stimulus_image_url?: string | null;
  visual_code?: string | null;
  visual_format?: "svg" | "html" | null;
  source_question_id?: string | null;
}

export function QuestionPreview({ q, onClose, onEdit }: { q: QListRow; onClose: () => void; onEdit: () => void }) {
  const correctLabel =
    q.choices.find((c) => c.is_correct)?.label ?? (q.correct_answer ? q.correct_answer.toUpperCase() : null);

  return (
    <Modal
      title="Question Preview"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={onEdit}>Edit</Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <span className="chip">{q.section === "math" ? "Math" : "R & W"}</span>
          <span className="chip">{q.question_type === "multiple_choice" ? "Multiple choice" : "Student-produced"}</span>
          {q.difficulty ? <span className="chip">{difficultyLabel(q.difficulty).charAt(0).toUpperCase() + difficultyLabel(q.difficulty).slice(1)}</span> : null}
          {q.domain ? <span className="chip">{q.domain}</span> : null}
          {q.skill ? <span className="chip">{q.skill}</span> : null}
          {q.source_question_id ? <span className="chip chip-muted">Source {q.source_question_id}</span> : null}
        </div>

        <VisualCode code={q.visual_code} format={q.visual_format} />
        {!q.visual_code && q.stimulus_image_url && (
          <img src={q.stimulus_image_url} alt="Stimulus" style={{ maxWidth: "100%", maxHeight: 320, objectFit: "contain", border: "1px solid var(--border, #333)", borderRadius: 8, alignSelf: "center" }} />
        )}

        <PassageBlock passage={q.passage} />

        <div>
          <p style={{ fontWeight: 600, marginBottom: 8 }}><MathText text={q.prompt} /></p>
          {q.question_type === "multiple_choice" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {q.choices.map((c) => {
                const isCorrect = c.label.toUpperCase() === correctLabel?.toUpperCase() || c.is_correct;
                return (
                  <div
                    key={c.id}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: isCorrect
                        ? "1px solid var(--accent, #4ade80)"
                        : "1px solid rgba(255,255,255,0.12)",
                      background: isCorrect ? "rgba(74,222,128,0.08)" : "transparent",
                    }}
                  >
                    <span style={{ fontWeight: 600, minWidth: 18 }}>{c.label}</span>
                    <span style={{ lineHeight: 1.5 }}><MathText text={c.text} /></span>
                    {isCorrect && <span style={{ marginLeft: "auto", fontWeight: 600, color: "var(--accent, #4ade80)" }}>✓</span>}
                  </div>
                );
              })}
            </div>
          ) : (
            <p style={{ lineHeight: 1.5 }}>
              <span className="muted">Correct answer: </span>
              <span style={{ fontWeight: 600 }}>{q.correct_answer ?? "—"}</span>
            </p>
          )}

          {q.explanation && (
            <div style={{ marginTop: 12 }}>
              <p className="muted" style={{ fontWeight: 600, marginBottom: 4 }}>Explanation</p>
              <p style={{ lineHeight: 1.5 }}>{q.explanation}</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function QuestionModal({ question, onClose, onSaved }: { question: QListRow | null; onClose: () => void; onSaved: () => void }) {
  const [section, setSection] = useState<SectionKey>((question?.section as SectionKey) ?? "reading_writing");
  const [qtype, setQtype] = useState(question?.question_type ?? "multiple_choice");
  const [prompt, setPrompt] = useState(question?.prompt ?? "");
  const [domain, setDomain] = useState(question?.domain ?? "");
  const [skill, setSkill] = useState(question?.skill ?? "");
  const [diffLabel, setDiffLabel] = useState<DifficultyLabel>(difficultyLabel(question?.difficulty ?? null));
  const [correctAnswer, setCorrectAnswer] = useState(question?.correct_answer ?? question?.choices.find((choice) => choice.is_correct)?.label ?? "");
  const [explanation, setExplanation] = useState(question?.explanation ?? "");
  const [choices, setChoices] = useState(
    question?.choices ? [...question.choices].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((c) => ({ label: c.label, text: c.text, is_correct: c.is_correct })) :
      ["A", "B", "C", "D"].map((l) => ({ label: l, text: "", is_correct: false })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const domainOptions = domainsForSection(section);
  const skillOptions = domain ? skillsForDomain(section, domain as Domain) : [];

  async function submit(e?: FormEvent) {
    if (e) e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const body = {
        section,
        question_type: qtype,
        prompt,
        domain: domain || null,
        skill: skill || null,
        difficulty: difficultyValue(diffLabel),
        correct_answer: (qtype === "multiple_choice" ? correctAnswer.trim().toUpperCase() : correctAnswer.trim()) || null,
        explanation: explanation || null,
        choices: qtype === "multiple_choice" ? choices.map((c, i) => ({ label: c.label.trim().toUpperCase(), text: c.text, is_correct: c.label.trim().toUpperCase() === correctAnswer.trim().toUpperCase(), position: i + 1 })) : [],
      };
      if (question) {
        await fnJson(`admin-questions/${question.id}`, { method: "PATCH", token, body });
      } else {
        await fnJson("admin-questions", { method: "POST", token, body });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setBusy(false);
    }
  }

  return (
    <Modal
      title={question ? "Edit Question" : "New Question"}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <div>
            <label className="field-label">Section</label>
            <select className="select" value={section} onChange={(e) => { setSection(e.target.value as SectionKey); setDomain(""); setSkill(""); }}>
              {SECTIONS.map((s) => (
                <option key={s} value={s}>{sectionLabel(s)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">Type</label>
            <select className="select" value={qtype} onChange={(e) => setQtype(e.target.value)}>
              <option value="multiple_choice">Multiple choice</option>
              <option value="student_produced">Student-produced</option>
            </select>
          </div>
          <div>
            <label className="field-label">Difficulty</label>
            <select className="select" value={diffLabel} onChange={(e) => setDiffLabel(e.target.value as DifficultyLabel)}>
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
              ))}
            </select>
          </div>
        </div>
        {question?.passage?.content && <PassageBlock passage={question.passage} compact />}
        <div>
          <label className="field-label">Prompt</label>
          <textarea className="textarea" rows={3} required value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label className="field-label">Domain</label>
            <select className="select" value={domain} onChange={(e) => { setDomain(e.target.value); setSkill(""); }}>
              <option value="">—</option>
              {domainOptions.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">Skill</label>
            <select className="select" value={skill} onChange={(e) => setSkill(e.target.value)} disabled={!domain}>
              <option value="">—</option>
              {skillOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        {qtype === "multiple_choice" ? (
          <div>
            <label className="field-label">Choices — set the correct answer by choosing the right label below</label>
            {choices.map((c, i) => (
              <div className="choice-edit" key={i}>
                <input
                  className="input"
                  style={{ width: 70 }}
                  value={c.label}
                  onChange={(e) => setChoices((cs) => cs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                />
                <input
                  className="input"
                  value={c.text}
                  onChange={(e) => setChoices((cs) => cs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                />
                <input
                  type="radio"
                  name="correct-choice"
                  checked={c.label.toUpperCase() === correctAnswer.toUpperCase()}
                  onChange={() => setCorrectAnswer(c.label)}
                  title="Correct answer"
                />
              </div>
            ))}
          </div>
        ) : (
          <div>
            <label className="field-label">Correct answer</label>
            <input className="input" value={correctAnswer} onChange={(e) => setCorrectAnswer(e.target.value)} placeholder="e.g. 24 or 3/5" />
          </div>
        )}

        <div>
          <label className="field-label">Explanation</label>
          <textarea className="textarea" rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="Optional explanation" />
        </div>

        {error && <div className="login-error">{error}</div>}
      </form>
    </Modal>
  );
}
