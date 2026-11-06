import VisualCode from "./VisualCode";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { PenLine, Highlighter, Eraser, Hand, MessageSquarePlus, Undo2, Redo2, Trash2, Plus, Minus, Maximize, Palette, X, StickyNote, SunMoon, Move, ChevronDown, EyeOff, Scaling } from "lucide-react";
import { Button } from "./ui";
import MathText from "./MathText";
import type { ReviewPassage } from "../lib/types";
import { emptyAnnotation, strokePath, touchesStroke, commentSize, commentConnector } from "../lib/reviewAnnotations";
import type { BoardPoint, BoardStroke, BoardComment, ReviewAnnotation } from "../lib/reviewAnnotations";
import "../styles/review-annotations.css";

export type AnnotationQuestion = {
  question_id: string; question_number: number; prompt: string | null;
  passage?: ReviewPassage | null; stimulus_image_url?: string | null; visual_code?: string | null; visual_format?: "svg" | "html" | null;
  choices: { id: string; label: string; text: string; is_correct: boolean }[];
  correct_answer: string | null; your_answer?: string | null;
};

export function BoardQuestion({ question }: { question: AnnotationQuestion }) {
  const [imageError, setImageError] = useState(false);
  useEffect(() => setImageError(false), [question.stimulus_image_url]);
  return <div className="annotation-question">
    <div className="annotation-question-number">Question {question.question_number}</div>
    {question.passage?.content && <div className="annotation-passage">
      {question.passage.title && <strong>{question.passage.title}</strong>}
      <MathText text={question.passage.content} />
    </div>}
    <VisualCode code={question.visual_code} format={question.visual_format} />
    {!question.visual_code && question.stimulus_image_url && <img src={question.stimulus_image_url} alt="Question stimulus" onError={() => setImageError(true)} />}
    {imageError && <p role="alert">The question image could not load. Reopen the assignment to refresh it before exporting.</p>}
    <div className="annotation-prompt"><MathText text={question.prompt ?? "Question"} /></div>
    {question.choices.map(c => <div className="annotation-choice" key={c.id}>
      <strong>{c.label}.</strong><MathText text={c.text} />
    </div>)}
    <div className="annotation-answer">Correct: <MathText text={(question.correct_answer ?? question.choices.filter(c => c.is_correct).map(c => c.label).join(", ")) || "—"} />
      {question.your_answer != null && <span> · Student answer: <MathText text={question.your_answer} /></span>}
    </div>
  </div>;
}

function CommentMarks({ comments, open }: { comments: BoardComment[]; open?: Set<string> }) {
  return <g>{comments.map(c => {
    const arrow = commentConnector(c);
    return <g key={c.id}>
      {c.highlights.map((h, i) => <rect key={i} {...h} fill={c.color ?? "#ffe43b"} opacity=".45" />)}
      {(!open || open.has(c.id)) && <><path d={arrow.path} stroke="currentColor" strokeWidth="2" fill="none" />
      <path d={`M${arrow.x - 5},${arrow.y + 9} L${arrow.x},${arrow.y} L${arrow.x + 5},${arrow.y + 9}`} stroke="currentColor" strokeWidth="2" fill="none" /></>}
    </g>;
  })}</g>;
}

export function BoardSurface({ question, annotation, children }: { question: AnnotationQuestion; annotation: ReviewAnnotation; children?: ReactNode }) {
  // Reserve export space for expanded plain-text comments, including explicit newlines.
  const commentBottom = Math.max(0, ...(annotation.comments ?? []).map(c => c.y + Math.max(commentSize(c).height, 32 + c.text.split("\n").reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / Math.max(10, Math.floor((commentSize(c).width - 28) / 11)))), 0) * 23)));
  return <div className={`annotation-sheet is-${annotation.theme}${annotation.spacious ? " is-spacious" : ""}`} style={{ minHeight: Math.max(annotation.height, commentBottom) }}>
    <BoardQuestion question={question} />
    {annotation.notes && <div className="annotation-saved-notes">{annotation.notes}</div>}
    <svg className="annotation-ink" style={{ height: annotation.height }} viewBox={`0 0 960 ${annotation.height}`} aria-hidden="true">
      <CommentMarks comments={annotation.comments ?? []} />
      {annotation.strokes.map((s, i) => <path key={i} d={strokePath(s)} stroke={s.color} strokeWidth={s.width} opacity={s.opacity} fill="none" strokeLinecap="round" strokeLinejoin="round" />)}
    </svg>
    {annotation.comments?.map(c => <div key={c.id} className="annotation-comment is-saved" style={{ left: c.x, top: c.y, width: commentSize(c).width, minHeight: commentSize(c).height }}>{c.text || "Comment"}</div>)}
    {children}
  </div>;
}

export default function QuestionAnnotationBoard({ question, initial, onSave, onClose }: {
  question: AnnotationQuestion; initial?: ReviewAnnotation;
  onSave: (annotation: ReviewAnnotation) => Promise<void>; onClose: () => void;
}) {
  const [board, setBoard] = useState(initial ?? emptyAnnotation);
  const [tool, setTool] = useState<"pen" | "highlighter" | "eraser" | "pan" | "comment">("pan");
  const [palette, setPalette] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);
  const [color, setColor] = useState("#c43d4b");
  const [width, setWidth] = useState(3);
  const [undo, setUndo] = useState<ReviewAnnotation[]>([]);
  const [redo, setRedo] = useState<ReviewAnnotation[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saved = useRef(JSON.stringify(initial ?? emptyAnnotation()));
  const active = useRef<BoardStroke | null>(null);
  const drawingPointer = useRef<number | null>(null);
  const drawingPointerType = useRef("");
  const dialog = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const commentDrag = useRef<{ id: string; start: BoardPoint; x: number; y: number } | null>(null);
  const [newComment, setNewComment] = useState("");
  const [openComments, setOpenComments] = useState<Set<string>>(() => new Set());
  const resizeDrag = useRef<{ id: string; start: BoardPoint; width: number; height: number } | null>(null);
  const closeRef = useRef<() => void>(() => {});
  closeRef.current = () => {
    if (busy) return;
    if (JSON.stringify(board) !== saved.current && !window.confirm("Discard unsaved annotation changes?")) return;
    onClose();
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); }
      if (e.key !== "Tab") return;
      const items = [...(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled),select,textarea,input,[tabindex='0']") ?? [])];
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", key, true);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", key, true); previous?.focus(); };
  }, []);
  useLayoutEffect(() => {
    const content = sheet.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      const height = Math.min(20000, Math.max(1000, content.scrollHeight + 250));
      setBoard(b => height > b.height ? { ...b, height } : b);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const area = workspace.current;
    if (!area || !fit) return;
    const resize = () => setZoom(Math.max(.1, Math.min(1.5, (area.clientWidth - 32) / 960, (area.clientHeight - 32) / board.height)));
    resize();
    const observer = new ResizeObserver(resize); observer.observe(area);
    return () => observer.disconnect();
  }, [fit, board.height, palette, notesOpen]);
  function checkpoint() { setUndo(u => [...u.slice(-49), board]); setRedo([]); }
  function changeZoom(delta: number) { setFit(false); setZoom(z => Math.max(.1, Math.min(3, z + delta))); }
  function addComment() {
    if (busy || tool !== "comment") return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount || !sheet.current?.contains(selection.anchorNode) || !sheet.current?.contains(selection.focusNode)) return;
    if ((board.comments?.length ?? 0) >= 100) { setError("This board has reached its comment limit."); return; }
    const bounds = page.current!.getBoundingClientRect();
    const highlights = [...selection.getRangeAt(0).getClientRects()].map(r => ({
      x: Math.max(0, (r.left - bounds.left) / zoom), y: Math.max(0, (r.top - bounds.top) / zoom),
      width: r.width / zoom, height: r.height / zoom,
    })).filter(r => r.width > 0 && r.height > 0 && r.x + r.width <= 960 && r.y + r.height <= board.height).slice(0, 100);
    if (!highlights.length) return;
    const bottom = Math.max(...highlights.map(r => r.y + r.height));
    const contentBottom = sheet.current!.scrollHeight;
    const y = Math.min(19820, Math.max(bottom + 32, contentBottom + 24, ...(board.comments ?? []).map(c => c.y + 200)));
    const comment = { id: crypto.randomUUID(), highlights, color, x: 650, y, text: "" };
    checkpoint(); setBoard(b => ({ ...b, height: Math.max(b.height, y + 200), comments: [...(b.comments ?? []), comment] }));
    selection.removeAllRanges(); setOpenComments(ids => new Set([...ids, comment.id])); setNewComment(comment.id);
  }
  function point(e: { clientX: number; clientY: number }, surface: SVGSVGElement): BoardPoint {
    const box = surface.getBoundingClientRect();
    return [Math.max(0, Math.min(960, (e.clientX - box.left) * 960 / box.width)), Math.max(0, Math.min(board.height, (e.clientY - box.top) * board.height / box.height))];
  }
  function start(e: PointerEvent<SVGSVGElement>) {
    // A pen can be non-primary while a palm is touching the screen.
    if (busy || e.button !== 0 || (e.pointerType !== "pen" && !e.isPrimary)) return;
    if (drawingPointer.current !== null) {
      if (e.pointerType !== "pen" || drawingPointerType.current !== "touch") return;
      // Let the stylus take over if a palm landed first.
      const previousPointer = drawingPointer.current;
      drawingPointer.current = null; active.current = null;
      if (e.currentTarget.hasPointerCapture(previousPointer)) e.currentTarget.releasePointerCapture(previousPointer);
    }
    if (tool !== "pen" && tool !== "highlighter" && tool !== "eraser") return;
    if (tool !== "eraser" && board.strokes.length >= 2000) { setError("This board has reached its stroke limit. Erase some marks before drawing more."); return; }
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drawingPointer.current = e.pointerId; drawingPointerType.current = e.pointerType; checkpoint();
    const p = point(e, e.currentTarget);
    if (tool === "eraser") { setBoard(b => ({ ...b, strokes: b.strokes.filter(s => !touchesStroke(s, p)) })); return; }
    active.current = { points: [p], color, width: tool === "highlighter" ? 20 : width, opacity: tool === "highlighter" ? 0.3 : 1 };
    const stroke = active.current;
    setBoard(b => ({ ...b, strokes: [...b.strokes, stroke] }));
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    if (drawingPointer.current !== e.pointerId || busy) return;
    e.preventDefault();
    const samples = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const points = (samples.length ? samples : [e.nativeEvent]).map(sample => point(sample, e.currentTarget));
    if (tool === "eraser") { setBoard(b => ({ ...b, strokes: b.strokes.filter(s => !points.some(p => touchesStroke(s, p))) })); return; }
    if (!active.current || active.current.points.length >= 10000) return;
    active.current = { ...active.current, points: [...active.current.points, ...points].slice(0, 10000) };
    const stroke = active.current;
    setBoard(b => ({ ...b, strokes: [...b.strokes.slice(0, -1), stroke] }));
  }
  function finish(e: PointerEvent<SVGSVGElement>) {
    if (drawingPointer.current !== e.pointerId) return;
    if (e.type === "pointerup") move(e);
    active.current = null; drawingPointer.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }
  async function save() {
    setBusy(true); setError("");
    try { await onSave(board); saved.current = JSON.stringify(board); onClose(); }
    catch { setError("Could not save this annotation. Your drawing is still here; try Save again."); }
    finally { setBusy(false); }
  }
  const icons = { pen: PenLine, highlighter: Highlighter, eraser: Eraser, pan: Hand, comment: MessageSquarePlus };
  const names = { pen: "Pen", highlighter: "Highlighter", eraser: "Eraser", pan: "Pan / select", comment: "Highlight and comment" };
  function iconButton(label: string, Icon: typeof PenLine, action: () => void, disabled = false, pressed?: boolean) {
    return <button type="button" className="annotation-icon" title={label} aria-label={label} aria-pressed={pressed} disabled={busy || disabled} onClick={action}><Icon size={20} aria-hidden="true" /></button>;
  }
  function moveComment(id: string, x: number, y: number) {
    setBoard(b => ({ ...b, comments: b.comments?.map(c => c.id === id ? { ...c, x: Math.max(0, Math.min(700, 960 - commentSize(c).width, x)), y: Math.max(0, Math.min(b.height - Math.max(180, commentSize(c).height), y)) } : c) }));
  }
  function resizeComment(id: string, width: number, height: number) {
    setBoard(b => ({ ...b, comments: b.comments?.map(c => c.id === id ? { ...c, width: Math.max(180, Math.min(600, 960 - c.x, width)), height: Math.max(120, Math.min(600, b.height - c.y, height)) } : c) }));
  }
  return createPortal(<div className="annotation-backdrop">
    <div className="annotation-dialog" role="dialog" aria-modal="true" aria-labelledby="annotation-title" ref={dialog} tabIndex={-1}>
      <header><h2 id="annotation-title">Question {question.question_number}</h2><div className="annotation-header-actions">
        {iconButton("Drawing tools", Palette, () => setPalette(p => !p), false, palette)}
        {iconButton("Zoom out", Minus, () => changeZoom(-.1), zoom <= .1)}
        <output className="annotation-zoom" aria-label="Zoom level">{Math.round(zoom * 100)}%</output>
        {iconButton("Zoom in", Plus, () => changeZoom(.1), zoom >= 3)}
        {iconButton("Fit page", Maximize, () => setFit(true), false, fit)}
        {iconButton("Review notes", StickyNote, () => setNotesOpen(n => !n), false, notesOpen)}
        <Button disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save annotation"}</Button>
        {iconButton("Close", X, () => closeRef.current())}
      </div></header>
      {palette && <div className="annotation-toolbar" role="group" aria-label="Drawing tools">
        {(Object.keys(icons) as (keyof typeof icons)[]).map(t => <span key={t}>{iconButton(names[t], icons[t], () => { if (t === "comment" && tool === "comment") addComment(); setTool(t); }, false, tool === t)}</span>)}
        <span className="annotation-tool-divider" />
        {["#c43d4b", "#ffe43b", "#2684e8", "#25a36f", "#161d28", "#ffffff"].map(ink => <button key={ink} type="button" className="annotation-swatch" style={{ background: ink }} aria-label={`Ink ${ink}`} aria-pressed={color === ink} title={`Ink ${ink}`} disabled={busy} onClick={() => setColor(ink)} />)}
        <input type="color" aria-label="Custom ink color" title="Custom ink color" value={color} onChange={e => setColor(e.target.value)} disabled={busy} />
        <select aria-label="Stroke width" value={width} onChange={e => setWidth(Number(e.target.value))} disabled={busy}><option value="2">Fine</option><option value="3">Regular</option><option value="6">Bold</option></select>
        {iconButton("Toggle whiteboard / blackboard", SunMoon, () => { checkpoint(); setBoard(b => ({ ...b, theme: b.theme === "white" ? "black" : "white" })); })}
        {iconButton("Undo", Undo2, () => { setRedo(r => [...r, board]); setBoard(undo[undo.length - 1]); setUndo(u => u.slice(0, -1)); }, !undo.length)}
        {iconButton("Redo", Redo2, () => { setUndo(u => [...u, board]); setBoard(redo[redo.length - 1]); setRedo(r => r.slice(0, -1)); }, !redo.length)}
        {iconButton("Clear ink", Trash2, () => { checkpoint(); setBoard(b => ({ ...b, strokes: [] })); }, !board.strokes.length)}
        {iconButton("Add space", ChevronDown, () => { checkpoint(); setBoard(b => ({ ...b, height: Math.min(20000, b.height + 500) })); }, board.height >= 20000)}
      </div>}
      <div className="annotation-tool-hint" role="status">{tool === "comment" ? "Select text to create a linked comment; on touch, select text then tap this tool again. Drag the move icon to reposition the box." : tool === "pan" ? "Scroll to move around the board. Fit page shows the whole question and answers." : `${names[tool]} selected. Draw directly on the page.`}</div>
      <div className="annotation-workspace" ref={workspace}><div className="annotation-scaled-page" style={{ width: 960 * zoom, height: board.height * zoom }}>
        <div ref={page} className={`annotation-sheet is-${board.theme}${board.spacious ? " is-spacious" : ""}${tool === "pen" || tool === "highlighter" || tool === "eraser" ? " is-drawing" : ""}`} style={{ height: board.height, transform: `scale(${zoom})`, transformOrigin: "top left" }}>
          <div ref={sheet} onPointerUp={addComment}><BoardQuestion question={question} />{board.notes && <div className="annotation-saved-notes">{board.notes}</div>}</div>
          <svg ref={svg} className={`annotation-ink${tool === "pan" || tool === "comment" ? "" : " is-interactive"}`} viewBox={`0 0 960 ${board.height}`} aria-label="Drawing surface. Use review notes for keyboard annotations." role="img" onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onContextMenu={e => { if (tool !== "pan" && tool !== "comment") e.preventDefault(); }}>
            <CommentMarks comments={board.comments ?? []} open={openComments} />
            {board.strokes.map((s, i) => <path key={i} d={strokePath(s)} stroke={s.color} strokeWidth={s.width} opacity={s.opacity} fill="none" strokeLinecap="round" strokeLinejoin="round" />)}
          </svg>
          {board.comments?.flatMap((c, i) => c.highlights.map((h, line) => <button key={`${c.id}-${line}`} type="button" className="annotation-highlight-target" style={{ left: h.x, top: h.y, width: h.width, height: h.height }} title={`Open comment ${i + 1}`} aria-label={`Open comment ${i + 1}, highlighted line ${line + 1}`} aria-expanded={openComments.has(c.id)} disabled={busy} onClick={() => { setOpenComments(ids => new Set([...ids, c.id])); setNewComment(c.id); }} />))}
          {board.comments?.map((c, i) => openComments.has(c.id) && <div key={c.id} className="annotation-comment" style={{ left: c.x, top: c.y, ...commentSize(c) }}>
            <div className="annotation-comment-header"><button type="button" title="Drag to move. Arrow keys also move this comment." aria-label={`Move comment ${i + 1}`} disabled={busy}
              onPointerDown={e => { e.preventDefault(); checkpoint(); e.currentTarget.setPointerCapture(e.pointerId); commentDrag.current = { id: c.id, start: [e.clientX, e.clientY], x: c.x, y: c.y }; }}
              onPointerMove={e => { const d = commentDrag.current; if (d?.id === c.id && e.currentTarget.hasPointerCapture(e.pointerId)) moveComment(c.id, d.x + (e.clientX - d.start[0]) / zoom, d.y + (e.clientY - d.start[1]) / zoom); }}
              onPointerUp={e => { commentDrag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} onPointerCancel={() => { commentDrag.current = null; }}
              onKeyDown={e => { const offsets: Record<string, BoardPoint> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }; const d = offsets[e.key]; if (d) { e.preventDefault(); checkpoint(); moveComment(c.id, c.x + d[0], c.y + d[1]); } }}><Move size={18} /></button>
              <span>Comment {i + 1}</span><button type="button" aria-label={`Hide comment ${i + 1}`} title="Hide comment" disabled={busy} onClick={() => { setOpenComments(ids => { const next = new Set(ids); next.delete(c.id); return next; }); setNewComment(""); dialog.current?.querySelector<HTMLButtonElement>(`[aria-label="Open comment ${i + 1}, highlighted line 1"]`)?.focus(); }}><EyeOff size={18} /></button>
              <button type="button" aria-label={`Delete comment ${i + 1}`} title="Delete comment" disabled={busy} onClick={() => { checkpoint(); setBoard(b => ({ ...b, comments: b.comments?.filter(item => item.id !== c.id) })); }}><X size={18} /></button></div>
            <textarea aria-label={`Comment ${i + 1}`} autoFocus={newComment === c.id} value={c.text} maxLength={2000} disabled={busy} placeholder="Add your comment…" onFocus={() => { checkpoint(); setNewComment(""); }} onChange={e => setBoard(b => ({ ...b, comments: b.comments?.map(item => item.id === c.id ? { ...item, text: e.target.value } : item) }))} />
            <button type="button" className="annotation-comment-resize" aria-label={`Resize comment ${i + 1}`} title="Drag to resize. Arrow keys also resize this comment." disabled={busy}
              onPointerDown={e => { e.preventDefault(); checkpoint(); e.currentTarget.setPointerCapture(e.pointerId); resizeDrag.current = { id: c.id, start: [e.clientX, e.clientY], ...commentSize(c) }; }}
              onPointerMove={e => { const d = resizeDrag.current; if (d?.id === c.id && e.currentTarget.hasPointerCapture(e.pointerId)) resizeComment(c.id, d.width + (e.clientX - d.start[0]) / zoom, d.height + (e.clientY - d.start[1]) / zoom); }}
              onPointerUp={e => { resizeDrag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} onPointerCancel={() => { resizeDrag.current = null; }}
              onKeyDown={e => { const d: Record<string, BoardPoint> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }; if (!d[e.key]) return; e.preventDefault(); checkpoint(); const size = commentSize(c); resizeComment(c.id, size.width + d[e.key][0], size.height + d[e.key][1]); }}><Scaling size={18} /></button>
          </div>)}
        </div>
      </div></div>
      {(notesOpen || error) && <footer>{notesOpen && <label className="annotation-note-label">Review notes<textarea value={board.notes} maxLength={10000} disabled={busy} onFocus={checkpoint} onChange={e => setBoard(b => ({ ...b, notes: e.target.value }))} placeholder="Add a teaching note or solution steps…" /></label>}{error && <p role="alert" className="login-error">{error}</p>}</footer>}
    </div>
  </div>, document.body);
}
