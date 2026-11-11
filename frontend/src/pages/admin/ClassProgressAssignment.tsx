import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../../components/ui";
import type { DifficultyLabel, SectionKey } from "../../lib/satTaxonomy";
import { fnJson, getToken } from "../../lib/supabase";

export type ProgressAssignmentTarget = {
  section: SectionKey;
  domain: string;
  skill: string;
  difficulty: DifficultyLabel;
};

type AssignmentPreview = {
  available: number;
  question_count: number;
  title: string | null;
  plan: string;
  recipient_count: number;
};
type SavedAssignment = Omit<AssignmentPreview, "title"> & { title: string; batch_id: string };

const defaultCount = 20;
const defaultTimer = 15;

async function requestAssignment<T>(classId: string, body: Record<string, unknown>) {
  const token = await getToken();
  return fnJson<T>(`admin-classes/${classId}/progress`, { token, method: "POST", body });
}

export default function ClassProgressAssignment({ classId, target, onClose, onAssigned }: {
  classId: string;
  target: ProgressAssignmentTarget;
  onClose: () => void;
  onAssigned: (assignment: SavedAssignment) => void;
}) {
  const [countText, setCountText] = useState(String(defaultCount));
  const [timerText, setTimerText] = useState(String(defaultTimer));
  const [customTitle, setCustomTitle] = useState<string | null>(null);
  const [preview, setPreview] = useState<AssignmentPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const count = Number(countText);
  const timer = Number(timerText);
  const countValid = Number.isInteger(count) && count >= 1 && count <= 100;
  const timerValid = Number.isInteger(timer) && timer >= 1 && timer <= 600;

  useEffect(() => {
    if (!countValid) return;
    let active = true;
    const timeout = window.setTimeout(() => {
      void requestAssignment<AssignmentPreview>(classId, { ...target, count, timer_minutes: defaultTimer })
        .then(result => { if (active) setPreview(result); })
        .catch(error => { if (active) setPreviewError(error instanceof Error ? error.message : "Unable to preview this assignment."); });
    }, 200);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [classId, target, count, countValid, revision]);

  function refreshPreview() {
    setPreview(null);
    setPreviewError("");
    setRevision(value => value + 1);
  }

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview?.question_count || !countValid || !timerValid || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const assignment = await requestAssignment<SavedAssignment>(classId, {
        ...target, count, timer_minutes: timer, plan: preview.plan, title: customTitle ?? undefined,
      });
      onAssigned(assignment);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to assign these questions.");
      refreshPreview();
    } finally {
      setSaving(false);
    }
  }

  return <form className="class-progress-assign-form" id="class-progress-assignment" aria-label={`Assign ${target.difficulty} questions for ${target.skill}`}
    onSubmit={event => void assign(event)}
    onKeyDown={event => {
      if (event.key === "Escape" && !saving) { event.stopPropagation(); onClose(); }
    }}>
    <div className="class-progress-assign-fields">
      <label>Questions<input className="input" type="number" min={1} max={100} step={1} required autoFocus value={countText} disabled={saving} onChange={event => {
        setCountText(event.target.value);
        if (Number(event.target.value) !== count) {
          setPreview(null);
          setPreviewError("");
          setSaveError("");
        }
      }} /></label>
      <label>Timer (minutes)<input className="input" type="number" min={1} max={600} step={1} required value={timerText} disabled={saving} onChange={event => setTimerText(event.target.value)} /></label>
      <label className="class-progress-assign-name">Assignment name<input className="input" maxLength={300} placeholder={preview?.title ?? ""} value={customTitle ?? preview?.title ?? ""} disabled={saving || !preview?.question_count} onChange={event => setCustomTitle(event.target.value)} /></label>
    </div>
    <div className="class-progress-assign-footer">
      <div className="class-progress-assign-message">
        {saveError && <p role="alert">{saveError}</p>}
        {previewError && <p role="alert">{previewError}</p>}
        {!previewError && countValid && !preview && <p role="status">Checking available questions…</p>}
        {preview && <p role="status">{preview.question_count
          ? `${preview.question_count} of ${preview.available} available questions for ${preview.recipient_count} ${preview.recipient_count === 1 ? "student" : "students"}`
          : "No unassigned questions with answer keys are available."}</p>}
      </div>
      <div className="class-progress-assign-actions">
        <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        {previewError && <Button type="button" size="sm" variant="outline" onClick={refreshPreview}>Retry</Button>}
        <Button type="submit" size="sm" disabled={!preview?.question_count || !countValid || !timerValid || saving}>{saving ? "Assigning…" : "Assign to class"}</Button>
      </div>
    </div>
  </form>;
}
