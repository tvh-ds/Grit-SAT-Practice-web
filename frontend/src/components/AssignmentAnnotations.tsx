import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./ui";
import QuestionAnnotationBoard, { BoardSurface } from "./QuestionAnnotationBoard";
import { loadAnnotations, saveAnnotation, setAnnotationShared } from "../lib/reviewAnnotationStorage";
import { annotationFingerprint } from "../lib/reviewAnnotations";
import type { AnnotationQuestion, ReviewAnnotation, ReviewAnnotationRow } from "../lib/reviewAnnotations";

export function useAssignmentAnnotations(scope: string, questions: AnnotationQuestion[], title: string) {
  const [boards, setBoards] = useState<Record<string, ReviewAnnotationRow>>({});
  const [hashes, setHashes] = useState(new Map<string, { current: string; legacy: string }>());
  const [active, setActive] = useState<AnnotationQuestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [reload, setReload] = useState(0);
  const [sharing, setSharing] = useState<string | null>(null);
  const [shareError, setShareError] = useState("");
  const questionKey = useMemo(() => JSON.stringify(questions), [questions]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(""); setShareError(""); setBoards({}); setActive(null);
    if (questionKey === "[]") { setLoading(false); return; }
    void (async () => {
      try {
        const current: AnnotationQuestion[] = JSON.parse(questionKey);
        const [rows, pairs] = await Promise.all([loadAnnotations(scope), Promise.all(current.map(async q => {
          const [hash, legacy] = await Promise.all([annotationFingerprint(q), annotationFingerprint(q, true)]);
          return [q.question_id, { current: hash, legacy }] as const;
        }))]);
        if (cancelled) return;
        const h = new Map(pairs);
        setHashes(h);
        setBoards(Object.fromEntries(rows.filter(row => {
          const hash = h.get(row.question_id);
          return row.content_hash === hash?.current || row.content_hash === hash?.legacy;
        }).map(row => [row.question_id, row])));
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load annotations."); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [scope, questionKey, reload]);
  const savedQuestions = questions.filter(q => boards[q.question_id]);
  const annotations = Object.fromEntries(Object.entries(boards).map(([id, row]) => [id, row.document]));
  const annotate = useCallback((q: AnnotationQuestion) => setActive(q), []);
  const audience = scope.includes("/attempts/") ? "this student" : "students in this assignment";

  async function toggleShared(row: ReviewAnnotationRow) {
    const hash = hashes.get(row.question_id);
    if (!hash) return;
    setShareError("");
    setSharing(row.question_id);
    try {
      const updated = await setAnnotationShared(scope, row, hash.current, !row.shared_at);
      setBoards(current => current[row.question_id] === row ? { ...current, [row.question_id]: updated } : current);
    } catch (e) {
      setShareError(e instanceof Error ? e.message : "Could not update sharing.");
    } finally {
      setSharing(null);
    }
  }

  return {
    annotate,
    button: (q: AnnotationQuestion) => {
      const row = boards[q.question_id];
      return <>
        <Button size="sm" variant="outline" disabled={loading || Boolean(error)} onClick={() => annotate(q)}>{row ? "Edit annotation" : "Annotate"}</Button>
        {row && <Button size="sm" variant="outline" disabled={sharing !== null} aria-label={`${row.shared_at ? "Unshare" : "Share"} question ${q.question_number} ${row.shared_at ? "from" : "with"} ${audience}`} onClick={() => void toggleShared(row)}>
          {sharing === q.question_id ? "Updating…" : row.shared_at ? "Unshare review" : "Share review"}
        </Button>}
      </>;
    },
    toolbar: <div className="annotation-review-toolbar">
      <Button variant="outline" disabled={loading || Boolean(error) || !savedQuestions.length} onClick={() => setExporting(true)}>Export reviews ({savedQuestions.length})</Button>
      <span role="status" className="muted">{loading ? "Loading annotations…" : `Share saved reviews with ${audience}. Edits to shared reviews are visible to students.`}</span>
      {error && <div role="alert">{error} <Button size="sm" variant="ghost" onClick={() => setReload(r => r + 1)}>Retry</Button></div>}
      {shareError && <div role="alert">{shareError}</div>}
    </div>,
    overlay: <>
      {active && <QuestionAnnotationBoard key={`${scope}:${active.question_id}`} question={active} initial={annotations[active.question_id]} onClose={() => setActive(null)} onSave={async document => {
        const hash = hashes.get(active.question_id);
        if (!hash) throw new Error("Reopen the review before saving.");
        const saved = await saveAnnotation(scope, active.question_id, hash.current, document, boards[active.question_id]);
        setBoards(current => ({ ...current, [active.question_id]: saved }));
      }} />}
      {exporting && <AnnotationExport title={title} questions={savedQuestions} annotations={annotations} onClose={() => setExporting(false)} />}
    </>,
  };
}

export function AnnotationPages({ title, questions, annotations }: {
  title: string; questions: AnnotationQuestion[]; annotations: Record<string, ReviewAnnotation>;
}) {
  return <>{questions.map(q => <section className="annotation-export-page" key={q.question_id}>
    <h2>{title} · Question {q.question_number}</h2>
    <BoardSurface question={q} annotation={annotations[q.question_id]} />
  </section>)}</>;
}

export function AnnotationExport({ title, questions, annotations, onClose, studentActions }: {
  title: string; questions: AnnotationQuestion[]; annotations: Record<string, ReviewAnnotation>; onClose: () => void;
  studentActions?: React.ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [scale, setScale] = useState(1);
  const [fit, setFit] = useState(true);
  const studentView = studentActions !== undefined;
  useEffect(() => {
    const element = root.current;
    if (!studentView || !element) return;
    const resize = new ResizeObserver(([entry]) => setScale(Math.min(1, entry.contentRect.width / 960)));
    resize.observe(element);
    return () => resize.disconnect();
  }, [studentView]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousTitle = document.title;
    const app = studentView ? document.getElementById("root") : null;
    const wasInert = app?.inert ?? false;
    if (app) app.inert = true;
    document.title = `${title} — annotated reviews`;
    document.body.classList.add("annotation-export-active");
    root.current?.focus();
    let cancelled = false;
    void (async () => {
      await document.fonts.ready;
      const images = [...(root.current?.querySelectorAll("img") ?? [])];
      await Promise.all(images.map(image => image.decode().catch(() => {})));
      if (!cancelled) setReady(true);
    })();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key === "Tab") {
        const controls = root.current?.querySelectorAll<HTMLElement>("button:not(:disabled), iframe");
        const first = controls?.[0], last = controls?.[controls.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === root.current)) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      cancelled = true;
      document.title = previousTitle;
      document.body.classList.remove("annotation-export-active");
      document.removeEventListener("keydown", key, true);
      if (app) app.inert = wasInert;
      previous?.focus();
    };
  }, [onClose, studentView, title]);
  return createPortal(<div className={`annotation-export${studentView ? " annotation-student-view" : ""}`} ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label={studentView ? "Annotated reviews" : "Export annotated reviews"}>
    <div className="annotation-export-toolbar">
      <div>{studentView ? <strong>Annotated reviews</strong> : <><strong>Export {questions.length} saved reviews</strong><p>Select “Save as PDF” in the print dialog. Enable background graphics for blackboards.</p></>}</div>
      <div className="annotation-export-actions">
        {studentView && scale < 1 && <Button variant="outline" onClick={() => setFit(value => !value)}>{fit ? "Actual size" : "Fit to width"}</Button>}
        {studentActions}
        <Button variant={studentView ? "outline" : "primary"} disabled={!ready} onClick={() => window.print()}>{ready ? "Print / Save as PDF" : "Preparing…"}</Button>
        <Button variant="outline" onClick={onClose}>{studentView ? "Close" : "Close export"}</Button>
      </div>
    </div>
    <div className="annotation-export-pages" style={studentView && fit ? { zoom: scale } : undefined}>
      <AnnotationPages title={title} questions={questions} annotations={annotations} />
    </div>
  </div>, document.body);
}
