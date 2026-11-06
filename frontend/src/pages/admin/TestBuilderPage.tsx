import VisualCode from "../../components/VisualCode";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { fnJson, getToken, supabase } from "../../lib/supabase";
import { Button, Modal, Pill, Spinner, EmptyState } from "../../components/ui";
import PassageBlock from "../../components/PassageBlock";
import {
  type SectionKey,
  type Domain,
  type DifficultyLabel,
  DIFFICULTIES,
  domainsForSection,
  skillsForDomain,
  sectionLabel,
} from "../../lib/satTaxonomy";

interface Choice { id: string; label: string; text: string; is_correct: boolean; position: number }
interface Question {
  id: string;
  section: "reading_writing" | "math";
  question_type: "multiple_choice" | "student_produced";
  prompt: string;
  domain: string | null;
  skill: string | null;
  difficulty: number | null;
  correct_answer: string | null;
  explanation?: string | null;
  stimulus_image_path?: string | null;
  stimulus_image_url?: string | null;
  visual_code?: string | null;
  visual_format?: "svg" | "html" | null;
  status: string;
  choices: Choice[];
  passage?: { id: string; title: string | null; content: string } | null;
}
interface LinkRow { id: string; module_id: string; question_id: string; position: number; points: number; question: Question }
interface ModuleRow { id: string; section_id: string; name: string; time_limit_minutes: number; position: number; is_adaptive: boolean; questions: LinkRow[] }
interface SectionRow { id: string; test_id: string; name: string; section_type: "reading_writing" | "math"; position: number; modules: ModuleRow[] }
interface TestDetail { id: string; title: string; description: string | null; status: string; created_at: string; sections: SectionRow[] }

const TEMP_POS = 9999;



export default function TestBuilderPage() {
  const { testId = "" } = useParams();
  const [test, setTest] = useState<TestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showMeta, setShowMeta] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<LinkRow | null>(null);
  const [sectionModal, setSectionModal] = useState<{ open: boolean; section?: SectionRow }>({ open: false });
  const [moduleModal, setModuleModal] = useState<{ open: boolean; section?: SectionRow; module?: ModuleRow }>({ open: false });
  const [manualFor, setManualFor] = useState<ModuleRow | null>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    const d = await fnJson<{ test: TestDetail }>(`admin-tests/${testId}`, { token });
    setTest(d.test);
  }, [testId]);

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);

  const sections = useMemo(() => [...(test?.sections ?? [])].sort((a, b) => a.position - b.position), [test]);
  const moduleCount = sections.reduce((n, s) => n + s.modules.length, 0);
  const questionCount = sections.reduce((n, s) => n + s.modules.reduce((m, mo) => m + mo.questions.length, 0), 0);

  async function run(fn: () => Promise<unknown>, then?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      then?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  }

  async function api(path: string, opts: { method?: string; body?: unknown } = {}) {
    const token = await getToken();
    return fnJson(`admin-tests/${testId}${path}`, { method: opts.method ?? "POST", token, body: opts.body });
  }

  async function deleteSection(s: SectionRow) {
    if (!window.confirm(`Delete section "${s.name}" and its modules?`)) return;
    await run(() => api(`/sections/${s.id}`, { method: "DELETE" }));
  }

  async function deleteModule(m: ModuleRow) {
    if (!window.confirm(`Delete module "${m.name}" and its questions?`)) return;
    await run(() => api(`/modules/${m.id}`, { method: "DELETE" }));
  }

  async function unlinkQuestion(l: LinkRow) {
    if (!window.confirm("Remove this question from the module?")) return;
    await run(() => api(`/questions/${l.id}`, { method: "DELETE" }));
  }

  async function moveSection(s: SectionRow, dir: -1 | 1) {
    const list = sections;
    const i = list.findIndex((x) => x.id === s.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const other = list[j];
    await run(async () => {
      const token = await getToken();
      await fnJson(`admin-tests/${testId}/sections/${s.id}`, { method: "PATCH", token, body: { position: TEMP_POS } });
      await fnJson(`admin-tests/${testId}/sections/${other.id}`, { method: "PATCH", token, body: { position: s.position } });
      await fnJson(`admin-tests/${testId}/sections/${s.id}`, { method: "PATCH", token, body: { position: other.position } });
    });
  }

  async function moveModule(m: ModuleRow, dir: -1 | 1) {
    const mods = sections.find((s) => s.id === m.section_id)?.modules ?? [];
    const sorted = [...mods].sort((a, b) => a.position - b.position);
    const i = sorted.findIndex((x) => x.id === m.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sorted.length) return;
    const other = sorted[j];
    await run(async () => {
      const token = await getToken();
      await fnJson(`admin-tests/${testId}/modules/${m.id}`, { method: "PATCH", token, body: { position: TEMP_POS } });
      await fnJson(`admin-tests/${testId}/modules/${other.id}`, { method: "PATCH", token, body: { position: m.position } });
      await fnJson(`admin-tests/${testId}/modules/${m.id}`, { method: "PATCH", token, body: { position: other.position } });
    });
  }

  async function moveQuestion(l: LinkRow, dir: -1 | 1) {
    const mod = sections.flatMap((s) => s.modules).find((m) => m.id === l.module_id);
    if (!mod) return;
    const sorted = [...mod.questions].sort((a, b) => a.position - b.position);
    const i = sorted.findIndex((x) => x.id === l.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sorted.length) return;
    const other = sorted[j];
    await run(async () => {
      const token = await getToken();
      await fnJson(`admin-tests/${testId}/questions/${l.id}`, { method: "PATCH", token, body: { position: TEMP_POS } });
      await fnJson(`admin-tests/${testId}/questions/${other.id}`, { method: "PATCH", token, body: { position: l.position } });
      await fnJson(`admin-tests/${testId}/questions/${l.id}`, { method: "PATCH", token, body: { position: other.position } });
    });
  }

  if (!test) return error ? <div className="page-title">Error: {error}</div> : <Spinner />;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <Link to="/admin/tests" className="muted" style={{ textDecoration: "none" }}>← Full-Length Tests</Link>
        <h1 className="page-title" style={{ margin: 0 }}>Full-Length Test Builder</h1>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: "4px 0", fontWeight: 700 }}>{test.title}</h2>
        <Pill tone={test.status === "archived" ? "gray" : "green"}>{test.status === "archived" ? "Archived" : "Ready to assign"}</Pill>
        <Pill tone="gray">Assigned only</Pill>
        <span className="muted" style={{ fontSize: 13 }}>
          {sections.length} section(s) · {moduleCount} module(s) · {questionCount} question(s)
        </span>
      </div>

      <div className="toolbar" style={{ marginTop: 14 }}>
        <Button variant="outline" onClick={() => setShowMeta(true)} disabled={busy}>Edit Details</Button>
      </div>

      {error && <div className="login-error">{error}</div>}

      {sections.length === 0 ? (
        <EmptyState
          title="No sections yet"
          body="Add a Reading & Writing or Math section to start building the full-length test."
        />
      ) : (
        sections.map((s, si) => (
          <div key={s.id} className="card card-pad" style={{ marginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span className="muted" style={{ fontSize: 13, width: 24 }}>{si + 1}.</span>
              <strong>{s.name}</strong>
              <Pill tone="blue">{sectionLabel(s.section_type)}</Pill>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <Button size="sm" variant="ghost" onClick={() => void moveSection(s, -1)} disabled={busy || si === 0} title="Move up">↑</Button>
                <Button size="sm" variant="ghost" onClick={() => void moveSection(s, 1)} disabled={busy || si === sections.length - 1} title="Move down">↓</Button>
                <Button size="sm" variant="outline" onClick={() => setSectionModal({ open: true, section: s })} disabled={busy}>Edit</Button>
                <Button size="sm" variant="danger" onClick={() => void deleteSection(s)} disabled={busy}>Delete</Button>
              </div>
            </div>

            {s.modules.length === 0 && (
              <p className="muted" style={{ margin: "12px 0 4px", fontSize: 13 }}>No modules yet.</p>
            )}

            {[...s.modules]
              .sort((a, b) => a.position - b.position)
              .map((m, mi) => (
                <div key={m.id} className="module-block">
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 14 }}>{m.name}</strong>
                    <Pill tone={m.is_adaptive ? "amber" : "gray"}>{m.time_limit_minutes} min{m.is_adaptive ? " · adaptive" : ""}</Pill>
                    <span className="muted" style={{ fontSize: 13 }}>{m.questions.length} question(s)</span>
                    <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                      <Button size="sm" variant="ghost" onClick={() => void moveModule(m, -1)} disabled={busy || mi === 0}>↑</Button>
                      <Button size="sm" variant="ghost" onClick={() => void moveModule(m, 1)} disabled={busy || mi === s.modules.length - 1}>↓</Button>
                      <Button size="sm" variant="outline" onClick={() => setModuleModal({ open: true, section: s, module: m })} disabled={busy}>Edit</Button>
                      <Button size="sm" variant="danger" onClick={() => void deleteModule(m)} disabled={busy}>Delete</Button>
                    </div>
                  </div>

                  <div className="module-questions">
                    {[...m.questions]
                      .sort((a, b) => a.position - b.position)
                      .map((l, qi) => (
                        <div key={l.id} className="question-row">
                          <span className="muted" style={{ fontSize: 12, width: 26 }}>Q{qi + 1}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <span>{l.question.prompt.length > 90 ? `${l.question.prompt.slice(0, 90)}…` : l.question.prompt}</span>
                              <Pill tone={l.question.question_type === "student_produced" ? "amber" : "gray"}>{l.question.question_type === "student_produced" ? "Grid-in" : "MC"}</Pill>
                              {l.question.passage?.content && <Pill tone="blue">Passage</Pill>}
                            </div>
                            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                              {[l.question.domain, l.question.skill].filter(Boolean).join(" · ") || "—"}
                              {" · "}correct: <strong>{l.question.correct_answer ?? "—"}</strong>
                            </div>
                            {l.question.passage?.content && (
                              <div style={{ marginTop: 8 }}>
                                <PassageBlock passage={l.question.passage} compact />
                              </div>
                            )}
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <Button size="sm" variant="ghost" onClick={() => void moveQuestion(l, -1)} disabled={busy || qi === 0}>↑</Button>
                            <Button size="sm" variant="ghost" onClick={() => void moveQuestion(l, 1)} disabled={busy || qi === m.questions.length - 1}>↓</Button>
                            <Button size="sm" variant="outline" onClick={() => setEditingQuestion(l)} disabled={busy}>Edit</Button>
                            <Button size="sm" variant="danger" onClick={() => void unlinkQuestion(l)} disabled={busy}>Remove</Button>
                          </div>
                        </div>
                      ))}
                    <div style={{ marginTop: 8 }}>
                      <Button size="sm" variant="outline" onClick={() => setManualFor(m)} disabled={busy}>+ Add Question Manually</Button>
                    </div>
                  </div>
                </div>
              ))}

            <div style={{ marginTop: 12 }}>
              <Button size="sm" variant="outline" onClick={() => setModuleModal({ open: true, section: s })} disabled={busy}>
                + Add Module
              </Button>
            </div>
          </div>
        ))
      )}

      {sections.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Button variant="outline" onClick={() => setSectionModal({ open: true })} disabled={busy}>+ Add Section</Button>
        </div>
      )}

      {sections.length === 0 && (
        <div style={{ marginTop: 16 }}>
          <Button variant="primary" onClick={() => setSectionModal({ open: true })} disabled={busy}>+ Add Section</Button>
        </div>
      )}

      {showMeta && (
        <TestMetaModal
          test={test}
          onClose={() => setShowMeta(false)}
          onSaved={() => {
            setShowMeta(false);
            void run(async () => {});
          }}
        />
      )}
      {editingQuestion && (
        <EditQuestionModal
          key={editingQuestion.id}
          testId={test.id}
          link={editingQuestion}
          onClose={() => setEditingQuestion(null)}
          onSaved={() => { setEditingQuestion(null); void run(async () => {}); }}
        />
      )}
      {sectionModal.open && (
        <SectionModal
          testId={test.id}
          section={sectionModal.section}
          nextPosition={sections.length ? sections[sections.length - 1].position + 1 : 1}
          onClose={() => setSectionModal({ open: false })}
          onSaved={() => setSectionModal({ open: false })}
        />
      )}
      {moduleModal.open && (
        <ModuleModal
          testId={test.id}
          section={moduleModal.section!}
          module={moduleModal.module}
          nextPosition={
            moduleModal.section
              ? ((() => {
                  const sorted = [...moduleModal.section.modules].sort((a, b) => a.position - b.position);
                  return sorted.length ? sorted[sorted.length - 1].position + 1 : 1;
                })())
              : 0
          }
          onClose={() => setModuleModal({ open: false })}
          onSaved={() => setModuleModal({ open: false })}
        />
      )}
      {manualFor && (
        <ManualQuestionModal
          testId={test.id}
          module={manualFor}
          sectionType={sections.find((s) => s.modules.some((m) => m.id === manualFor.id))?.section_type ?? "reading_writing"}
          onClose={() => setManualFor(null)}
          onSaved={() => { setManualFor(null); void run(async () => {}); }}
        />
      )}
    </div>
  );
}

function TestMetaModal({ test, onClose, onSaved }: { test: TestDetail; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(test.title);
  const [description, setDescription] = useState(test.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      await fnJson(`admin-tests/${test.id}`, {
        method: "PATCH",
        token,
        body: { title, description: description || null, is_public: false },
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setBusy(false);
    }
  }

  return (
    <Modal title="Full-Length Test Details" onClose={onClose}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label className="field-label">Title</label>
          <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Description</label>
          <textarea className="textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {error && <div className="login-error">{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function EditQuestionModal({
  testId,
  link,
  onClose,
  onSaved,
}: {
  testId: string;
  link: LinkRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const question = link.question;
  const [prompt, setPrompt] = useState(question.prompt);
  const [passage, setPassage] = useState(question.passage?.content ?? "");
  const [answer, setAnswer] = useState(() => {
    const value = question.correct_answer ?? question.choices.find((choice) => choice.is_correct)?.label ?? "";
    return question.question_type === "multiple_choice" ? value.trim().toUpperCase() : value;
  });
  const [explanation, setExplanation] = useState(question.explanation ?? "");
  const [choices, setChoices] = useState(
    [...question.choices].sort((a, b) => a.position - b.position).map(({ label, text }) => ({ label: label.trim().toUpperCase(), text })),
  );
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!imageFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  function handleImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    if (!(["image/png", "image/jpeg", "image/webp"].includes(file.type)) || file.size > 10 * 1024 * 1024) {
      setError("Choose a PNG, JPEG, or WebP image under 10 MB.");
      return;
    }
    setError(null);
    setImageFile(file);
    setRemoveImage(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim()) return setError("Question prompt is required.");
    if (question.question_type === "multiple_choice") {
      if (choices.length < 2 || choices.some((choice) => !choice.label.trim() || !choice.text.trim())) {
        return setError("Multiple-choice questions need at least two complete choices.");
      }
      if (new Set(choices.map((choice) => choice.label.toUpperCase())).size !== choices.length) {
        return setError("Choice labels must be unique.");
      }
      if (!choices.some((choice) => choice.label.toUpperCase() === answer.trim().toUpperCase())) {
        return setError("Choose a correct answer that matches one of the choice labels.");
      }
    }

    setBusy(true);
    setError(null);
    let uploadedPath: string | null = null;
    try {
      const token = await getToken();
      let imagePath = removeImage ? null : question.stimulus_image_path ?? null;
      if (imageFile) {
        const extension = imageFile.type === "image/jpeg" ? "jpg" : imageFile.type === "image/webp" ? "webp" : "png";
        uploadedPath = `tests/${testId}/questions/${link.id}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from("question-assets").upload(uploadedPath, imageFile, {
          contentType: imageFile.type,
          upsert: false,
        });
        if (uploadError) throw new Error(`Image upload failed: ${uploadError.message}`);
        imagePath = uploadedPath;
      }

      await fnJson(`admin-tests/${testId}/questions/${link.id}/content`, {
        method: "POST",
        token,
        body: {
          prompt: prompt.trim(),
          passage_text: passage.trim() || null,
          correct_answer: (question.question_type === "multiple_choice" ? answer.trim().toUpperCase() : answer.trim()) || null,
          explanation: explanation.trim() || null,
          stimulus_image_path: imagePath,
          choices: question.question_type === "multiple_choice" ? choices : [],
        },
      });
      onSaved();
    } catch (err) {
      if (uploadedPath) await supabase.storage.from("question-assets").remove([uploadedPath]).catch(() => undefined);
      setError(err instanceof TypeError
        ? "Unable to reach the server. Your edits are still here. Check your connection and try saving again."
        : err instanceof Error ? err.message : "Unable to save question.");
      setBusy(false);
    }
  }

  return (
    <Modal title="Edit Test Question" onClose={busy ? () => undefined : onClose}>
      <form onSubmit={(event) => void submit(event)} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label className="field-label">Question prompt</label>
          <textarea className="textarea" rows={5} required value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        </div>
        <div>
          <label className="field-label">Passage (clear to remove)</label>
          <textarea className="textarea" rows={5} value={passage} onChange={(event) => setPassage(event.target.value)} placeholder="No passage" />
        </div>
        {question.question_type === "multiple_choice" && (
          <div>
            <label className="field-label">Answer choices</label>
            {choices.map((choice, index) => (
              <div className="choice-edit" key={index}>
                <input
                  className="input"
                  aria-label={`Choice ${index + 1} label`}
                  style={{ width: 64 }}
                  maxLength={2}
                  value={choice.label}
                  onChange={(event) => setChoices((items) => items.map((item, i) => i === index ? { ...item, label: event.target.value.toUpperCase() } : item))}
                />
                <input
                  className="input"
                  aria-label={`Choice ${choice.label || index + 1} text`}
                  value={choice.text}
                  onChange={(event) => setChoices((items) => items.map((item, i) => i === index ? { ...item, text: event.target.value } : item))}
                />
                <Button type="button" size="sm" variant="ghost" disabled={choices.length <= 2} aria-label={`Remove choice ${choice.label}`} onClick={() => {
                  setChoices((items) => items.filter((_, i) => i !== index));
                  if (answer.toUpperCase() === choice.label.toUpperCase()) setAnswer("");
                }}>Remove</Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" disabled={choices.length >= 6} onClick={() => {
              const used = new Set(choices.map((choice) => choice.label.toUpperCase()));
              const label = ["A", "B", "C", "D", "E", "F"].find((candidate) => !used.has(candidate));
              if (!label) return;
              setChoices((items) => [...items, { label, text: "" }]);
            }}>+ Add choice</Button>
          </div>
        )}
        <div>
          <label className="field-label">Correct answer</label>
          {question.question_type === "multiple_choice" ? (
            <select className="select" required value={answer} onChange={(event) => setAnswer(event.target.value)}>
              <option value="">Choose the correct answer</option>
              {choices.map((choice) => <option key={choice.label} value={choice.label}>{choice.label} · {choice.text.slice(0, 80)}</option>)}
            </select>
          ) : (
            <input className="input" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="e.g. 24 or 3/5" />
          )}
        </div>
        <div>
          <label className="field-label">Explanation (optional)</label>
          <textarea className="textarea" rows={3} value={explanation} onChange={(event) => setExplanation(event.target.value)} />
        </div>
        <div>
          <label className="field-label">Question visual</label>
          <VisualCode code={question.visual_code} format={question.visual_format} />
          {(previewUrl || (!removeImage && question.stimulus_image_url)) && (
            <img src={previewUrl ?? question.stimulus_image_url!} alt="Question stimulus preview" style={{ display: "block", maxWidth: "100%", maxHeight: 260, objectFit: "contain", borderRadius: 8, border: "1px solid var(--border)", marginBottom: 8 }} />
          )}
          {!question.visual_code && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label className="btn btn-outline btn-sm" style={{ cursor: "pointer" }}>
              {imageFile ? "Replace image" : question.stimulus_image_path && !removeImage ? "Change image" : "Add image"}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImage} style={{ display: "none" }} />
            </label>
            {(imageFile || question.stimulus_image_path) && !removeImage && (
              <Button type="button" size="sm" variant="ghost" onClick={() => { setImageFile(null); setRemoveImage(true); }}>Remove image</Button>
            )}
            {removeImage && <Button type="button" size="sm" variant="ghost" onClick={() => setRemoveImage(false)}>Undo remove</Button>}
          </div>}
          <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>PNG, JPEG, or WebP up to 10 MB.</p>
        </div>
        {error && <div className="login-error">{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save question"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function SectionModal({
  testId,
  section,
  nextPosition,
  onClose,
  onSaved,
}: {
  testId: string;
  section?: SectionRow;
  nextPosition: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(section?.name ?? "");
  const [type, setType] = useState<"reading_writing" | "math">(section?.section_type ?? "reading_writing");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (section) {
        await fnJson(`admin-tests/${testId}/sections/${section.id}`, { method: "PATCH", token, body: { name, section_type: type } });
      } else {
        await fnJson(`admin-tests/${testId}/sections`, { method: "POST", token, body: { test_id: testId, name, section_type: type, position: nextPosition } });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setBusy(false);
    }
  }

  return (
    <Modal title={section ? "Edit Section" : "Add Section"} onClose={onClose}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label className="field-label">Name</label>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Reading and Writing" />
        </div>
        <div>
          <label className="field-label">Type</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as "reading_writing" | "math")}>
            <option value="reading_writing">Reading & Writing</option>
            <option value="math">Math</option>
          </select>
        </div>
        {error && <div className="login-error">{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ModuleModal({
  testId,
  section,
  module,
  nextPosition,
  onClose,
  onSaved,
}: {
  testId: string;
  section: SectionRow;
  module?: ModuleRow;
  nextPosition: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(module?.name ?? "");
  const [minutes, setMinutes] = useState(module ? String(module.time_limit_minutes) : "32");
  const [adaptive, setAdaptive] = useState(module?.is_adaptive ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const mins = Number(minutes);
    if (!Number.isInteger(mins) || mins < 1 || mins > 600) {
      setError("Time limit must be a whole number of minutes (1–600).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (module) {
        await fnJson(`admin-tests/${testId}/modules/${module.id}`, { method: "PATCH", token, body: { name, time_limit_minutes: mins, is_adaptive: adaptive } });
      } else {
        await fnJson(`admin-tests/${testId}/modules`, {
          method: "POST",
          token,
          body: { section_id: section.id, name, time_limit_minutes: mins, position: nextPosition, is_adaptive: adaptive },
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setBusy(false);
    }
  }

  return (
    <Modal title={module ? "Edit Module" : "Add Module"} onClose={onClose}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label className="field-label">Name</label>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Module 1" />
        </div>
        <div>
          <label className="field-label">Time limit (minutes)</label>
          <input className="input" type="number" min={1} max={600} required value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
          <input type="checkbox" checked={adaptive} onChange={(e) => setAdaptive(e.target.checked)} />
          Adaptive (second module difficulty adjusts to first-module performance)
        </label>
        {error && <div className="login-error">{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ManualQuestionModal({
  testId,
  module,
  sectionType,
  onClose,
  onSaved,
}: {
  testId: string;
  module: ModuleRow;
  sectionType: "reading_writing" | "math";
  onClose: () => void;
  onSaved: () => void;
}) {
  const [qtype, setQtype] = useState<"multiple_choice" | "student_produced">("multiple_choice");
  const [prompt, setPrompt] = useState("");
  const [domain, setDomain] = useState("");
  const [skill, setSkill] = useState("");
  const [diffLabel, setDiffLabel] = useState<DifficultyLabel>("medium");
  const [correctAnswer, setCorrectAnswer] = useState("");
  const [explanation, setExplanation] = useState("");
  const [choices, setChoices] = useState(
    ["A", "B", "C", "D"].map((l) => ({ label: l, text: "", is_correct: false })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const domains = domainsForSection(sectionType as SectionKey);
  const skills = domain ? skillsForDomain(sectionType as SectionKey, domain as Domain) : [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const nextPos = module.questions.reduce((m, l) => Math.max(m, l.position), 0) + 1;

      const qRes = await fnJson<{ question: { id: string } }>("admin-questions", {
        method: "POST",
        token,
        body: {
          section: sectionType,
          question_type: qtype,
          prompt,
          domain: domain || null,
          skill: skill || null,
          difficulty: diffLabel === "easy" ? 1 : diffLabel === "hard" ? 5 : 3,
          correct_answer: correctAnswer || null,
          explanation: explanation || null,
          status: "archived",
          choices: qtype === "multiple_choice"
            ? choices.map((c, i) => ({
                label: c.label,
                text: c.text,
                is_correct: c.label.toUpperCase() === correctAnswer.toUpperCase(),
                position: i + 1,
              }))
            : [],
        },
      });

      await fnJson(`admin-tests/${testId}/questions`, {
        method: "POST",
        token,
        body: { module_id: module.id, question_id: qRes.question.id, position: nextPos },
      });

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create question");
      setBusy(false);
    }
  }

  return (
    <Modal title={`Add Question Manually — ${sectionLabel(sectionType)}`} onClose={onClose}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <div>
            <label className="field-label">Type</label>
            <select className="select" value={qtype} onChange={(e) => setQtype(e.target.value as typeof qtype)}>
              <option value="multiple_choice">Multiple choice</option>
              <option value="student_produced">Student-produced</option>
            </select>
          </div>
          <div>
            <label className="field-label">Domain</label>
            <select className="select" value={domain} onChange={(e) => { setDomain(e.target.value); setSkill(""); }}>
              <option value="">—</option>
              {domains.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Skill</label>
            <select className="select" value={skill} onChange={(e) => setSkill(e.target.value)} disabled={!domain}>
              <option value="">—</option>
              {skills.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label className="field-label">Difficulty</label>
            <select className="select" value={diffLabel} onChange={(e) => setDiffLabel(e.target.value as DifficultyLabel)}>
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Correct Answer</label>
            <input className="input" value={correctAnswer} onChange={(e) => setCorrectAnswer(e.target.value)} placeholder={qtype === "multiple_choice" ? "e.g. A" : "e.g. 24 or 3/5"} />
          </div>
        </div>
        <div>
          <label className="field-label">Prompt</label>
          <textarea className="textarea" rows={3} required value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </div>
        {qtype === "multiple_choice" && (
          <div>
            <label className="field-label">Choices</label>
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
                  placeholder={`Choice ${c.label}`}
                />
              </div>
            ))}
          </div>
        )}
        <div>
          <label className="field-label">Explanation (optional)</label>
          <textarea className="textarea" rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
        </div>
        {error && <div className="login-error">{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || !prompt.trim()}>{busy ? "Creating…" : "Create & Add Question"}</Button>
        </div>
      </form>
    </Modal>
  );
}
