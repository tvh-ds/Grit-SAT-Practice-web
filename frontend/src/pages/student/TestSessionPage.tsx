import VisualCode from "../../components/VisualCode";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createPortal } from "react-dom";
import { Bookmark, Flag, Highlighter, MoreVertical, PenLine, Trash2, Underline, MapPin } from "lucide-react";
import { fnJson, getToken } from "../../lib/supabase";
import type { Attempt, AttemptModule, SavedResponse, Test, TestModule, TestSection } from "../../lib/types";
import { AnswerSaveQueue } from "../../lib/answerSaveQueue";
import { findSourceRange, isRangeUnderlined, materializeLegacyHighlights, updateAnnotationsForRange, type AnnotationAction } from "../../lib/textAnnotations";
import { getTestTheme, type TestTheme } from "../../lib/testTheme";
import { Button, Modal, Spinner, fmtSeconds } from "../../components/ui";
import HighlightableText from "../../components/HighlightableText";
import "../../styles/test-session.css";

interface CurrentData {
  attempt: Attempt;
  test: Test;
  responses: SavedResponse[];
  modules: AttemptModule[];
}

type ModalKind = "grid" | "directions" | "reference" | "end" | "submitAll";
type SelectionToolbarState = { target: string; start: number; end: number; left: number; top: number };

const MATH_REFERENCE = [
  "Area of a circle: A = πr²",
  "Circumference of a circle: C = 2πr",
  "Area of a rectangle: A = lw",
  "Area of a triangle: A = ½bh",
  "Pythagorean theorem: a² + b² = c²",
  "Volume of a cylinder: V = πr²h",
  "Volume of a rectangular prism: V = lwh",
  "Quadratic formula: x = (-b ± √(b² − 4ac)) / 2a",
  "Slope of a line: m = (y₂ − y₁) / (x₂ − x₁)",
];

const RW_DIRECTIONS =
  "Each passage or pair of passages is followed by a number of questions. After reading each passage or pair, choose the best answer to each question based on what is stated or implied in the passage or passages and in any accompanying graphics (such as a table or graph).";

const MATH_DIRECTIONS =
  "For each question, choose the best answer from the four choices. For questions with an answer box, enter your answer as a decimal or a fraction (for example, 3/5). Unless directed otherwise, enter your answer in the format described in the question.";

export default function TestSessionPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<CurrentData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [moduleIdx, setModuleIdx] = useState(0);
  const [qIndex, setQIndex] = useState(0);
  const [responses, setResponses] = useState<Record<string, SavedResponse>>({});
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [testTheme] = useState<TestTheme>(getTestTheme);
  const [timerVisible, setTimerVisible] = useState(true);
  const [eliminateMode, setEliminateMode] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [autoFlag, setAutoFlag] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [navigationPending, setNavigationPending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [typedDraft, setTypedDraft] = useState("");
  const [highlighterOn, setHighlighterOn] = useState(false);
  const [selectionToolbar, setSelectionToolbar] = useState<SelectionToolbarState | null>(null);

  const saveTimer = useRef<number | null>(null);
  const pendingTypedSave = useRef<{ qid: string; value: string } | null>(null);
  const responsesRef = useRef<Record<string, SavedResponse>>({});
  const saveQueue = useRef(new AnswerSaveQueue());
  const enteredAt = useRef(Date.now());
  const moduleStart = useRef(Date.now());
  const leavingRef = useRef(false);
  const paneRef = useRef<HTMLDivElement | null>(null);

  const allModules = useMemo(() => {
    if (!data) return [];
    return (data.test.sections ?? [])
      .flatMap((s: TestSection) => s.modules ?? [])
      .sort((a, b) => a.position - b.position);
  }, [data]);

  const module = allModules[moduleIdx] as TestModule | undefined;
  const questions = useMemo(() => {
    if (!module) return [];
    return [...module.questions].sort((a, b) => a.position - b.position);
  }, [module]);

  const current = questions[qIndex];

  // ---- load ----
  useEffect(() => {
    if (!attemptId) return;
    void (async () => {
      try {
        const token = await getToken();
        const res = await fnJson<CurrentData>(`student-attempts/current?attempt_id=${encodeURIComponent(attemptId)}`, { token });
        if (res.attempt.id !== attemptId) throw new Error("Loaded attempt does not match the current URL");
        setData(res);

        const mods = (res.test.sections ?? [])
          .flatMap((s: TestSection) => s.modules ?? [])
          .sort((a, b) => a.position - b.position);
        const idx = Math.max(0, mods.findIndex((m) => m.id === res.attempt.current_module_id));
        setModuleIdx(idx);
        setQIndex(Math.max(0, (res.attempt.current_question_position ?? 1) - 1));

        const map: Record<string, SavedResponse> = {};
        for (const r of res.responses) map[r.question_id] = r;
        responsesRef.current = map;
        setResponses(map);

        const am = res.modules.find((m) => m.module_id === mods[idx]?.id);
        if (am && am.seconds_left != null) setDeadline(Date.now() + am.seconds_left * 1000);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load attempt");
      }
    })();
  }, [attemptId]);

  // ---- timer tick ----
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const secondsLeft = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;

  useEffect(() => {
    if (secondsLeft !== null && secondsLeft === 0 && !autoFlag && !submitting && !leavingRef.current) {
      setAutoFlag(true);
      void submitModule();
    }
  }, [secondsLeft, autoFlag, submitting]);

  // ---- save ----
  const saveResponse = useCallback(
    async (qid: string, patch: Partial<SavedResponse>, waitForRemote = false) => {
      if (!data || !module) return;
      const prev = responsesRef.current[qid];
      const next: SavedResponse = {
        attempt_id: data.attempt.id,
        question_id: qid,
        module_id: module.id,
        selected_choice_id: prev?.selected_choice_id ?? null,
        typed_answer: prev?.typed_answer ?? null,
        marked_for_review: prev?.marked_for_review ?? false,
        eliminated_choice_ids: prev?.eliminated_choice_ids ?? [],
        highlights: prev?.highlights ?? [],
        annotations: prev?.annotations ?? [],
        is_correct: prev?.is_correct ?? null,
        ...patch,
      };
      responsesRef.current = { ...responsesRef.current, [qid]: next };
      setResponses(responsesRef.current);
      const spent = Math.round((Date.now() - enteredAt.current) / 1000);
      const request = saveQueue.current.enqueue(qid, async () => {
        const token = await getToken();
        await fnJson("student-responses", {
          method: "POST",
          token,
          body: {
            attempt_id: next.attempt_id,
            question_id: qid,
            module_id: next.module_id,
            selected_choice_id: next.selected_choice_id,
            typed_answer: next.typed_answer,
            marked_for_review: next.marked_for_review,
            eliminated_choice_ids: next.eliminated_choice_ids,
            highlights: next.highlights,
            annotations: next.annotations,
            time_spent_seconds: spent,
          },
        });
      });
      void request.then(() => {
        if (saveQueue.current.failedQuestionIds.length === 0) setSaveError(null);
      }).catch(() => {
        setSaveError("An answer could not be saved. Retry the save before moving on or submitting.");
      });
      if (waitForRemote) await request;
    },
    [data, module],
  );

  const saveTypedDebounced = useCallback(
    (qid: string, value: string) => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      pendingTypedSave.current = { qid, value };
      saveTimer.current = window.setTimeout(() => {
        pendingTypedSave.current = null;
        void saveResponse(qid, { typed_answer: value.trim() || null });
      }, 600);
    },
    [saveResponse],
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!current) return;
    setTypedDraft(responses[current.question_id]?.typed_answer ?? "");
  }, [current, responses]);

  useEffect(() => {
    setSelectionToolbar(null);
  }, [current?.question_id]);

  async function flushPendingSave() {
    const pending = pendingTypedSave.current;
    if (!pending) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    pendingTypedSave.current = null;
    await saveResponse(pending.qid, { typed_answer: pending.value.trim() || null }, true);
  }

  async function flushAnswerSaves() {
    await flushPendingSave();
    await saveQueue.current.flush();
  }

  async function retryFailedSaves() {
    const questionIds = saveQueue.current.failedQuestionIds;
    if (questionIds.length === 0) return;
    setNavigationPending(true);
    try {
      for (const questionId of questionIds) await saveResponse(questionId, {}, false);
      await flushAnswerSaves();
      setSaveError(null);
      setLeaveError(null);
    } catch {
      setSaveError("The answer still could not be saved. Check your connection and retry.");
    } finally {
      setNavigationPending(false);
    }
  }

  function closeSelectionToolbar() {
    setSelectionToolbar(null);
    window.getSelection()?.removeAllRanges();
  }

  useEffect(() => {
    if (!selectionToolbar) return;
    const dismissOnOutsidePress = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".selection-annotation-toolbar")) return;
      setSelectionToolbar(null);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSelectionToolbar();
    };
    document.addEventListener("mousedown", dismissOnOutsidePress);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("mousedown", dismissOnOutsidePress);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [selectionToolbar]);

  function annotationSource(target: string): string {
    if (!current) return "";
    if (target === "passage") return current.question.passage?.content ?? "";
    if (target === "prompt") return current.question.prompt;
    if (target.startsWith("choice:")) {
      return current.question.choices.find((choice) => `choice:${choice.id}` === target)?.text ?? "";
    }
    return "";
  }

  function annotationTargets(): Array<{ target: string; text: string }> {
    if (!current) return [];
    return [
      ...(current.question.passage?.content ? [{ target: "passage", text: current.question.passage.content }] : []),
      { target: "prompt", text: current.question.prompt },
      ...current.question.choices.map((choice) => ({ target: `choice:${choice.id}`, text: choice.text })),
    ];
  }

  function applySelectionAnnotation(action: AnnotationAction) {
    if (!current || !selectionToolbar) return;
    const response = responsesRef.current[current.question_id];
    const legacy = materializeLegacyHighlights(response?.highlights ?? [], annotationTargets(), response?.annotations ?? []);
    const updated = updateAnnotationsForRange(
      [...(response?.annotations ?? []), ...legacy.annotations],
      selectionToolbar.target,
      annotationSource(selectionToolbar.target),
      { start: selectionToolbar.start, end: selectionToolbar.end },
      action,
    );
    if (updated.length > 500) {
      setSaveError("This question has too many highlight ranges to save. Erase some ranges and retry.");
      closeSelectionToolbar();
      return;
    }
    void saveResponse(current.question_id, { annotations: updated, highlights: legacy.remaining });
    closeSelectionToolbar();
  }

  function isSelectionUnderlined(): boolean {
    if (!current || !selectionToolbar) return false;
    return isRangeUnderlined(
      responsesRef.current[current.question_id]?.annotations ?? [],
      selectionToolbar.target,
      annotationSource(selectionToolbar.target),
      { start: selectionToolbar.start, end: selectionToolbar.end },
    );
  }

  /** Keep a text selection and place annotation actions beside it. */
  function handlePaneSelect() {
    if (!highlighterOn || !current) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    const end = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement;
    const startText = start?.closest<HTMLElement>("[data-annotation-scope]");
    const endText = end?.closest<HTMLElement>("[data-annotation-scope]");
    if (!startText || startText !== endText || !paneRef.current?.contains(startText)) return;
    const quote = sel.toString().trim();
    const target = startText.dataset.annotationScope;
    if (!target || quote.length < 1 || quote.length > 2000) return;
    const prefixRange = document.createRange();
    prefixRange.selectNodeContents(startText);
    prefixRange.setEnd(range.startContainer, range.startOffset);
    const prefix = prefixRange.toString();
    const visibleText = startText.textContent ?? "";
    let occurrence = 0;
    for (let index = visibleText.indexOf(quote); index >= 0 && index < prefix.length; index = visibleText.indexOf(quote, index + quote.length)) {
      if (index + quote.length <= prefix.length) occurrence += 1;
    }
    const sourceRange = findSourceRange(annotationSource(target), quote, occurrence);
    if (!sourceRange) return;
    const rect = range.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - 292, rect.left + rect.width / 2 - 142));
    const top = rect.top > 84 ? rect.top - 60 : rect.bottom + 10;
    setSelectionToolbar({ target, ...sourceRange, left, top });
  }

  // ---- navigation ----
  async function goTo(index: number): Promise<boolean> {
    const nextIndex = Math.max(0, Math.min(questions.length - 1, index));
    if (nextIndex === qIndex) return true;
    setNavigationPending(true);
    try {
      await flushAnswerSaves();
      setQIndex(nextIndex);
      setTypedDraft(responsesRef.current[questions[nextIndex]?.question_id]?.typed_answer ?? "");
      enteredAt.current = Date.now();
      return true;
    } catch {
      setSaveError("An answer could not be saved. Retry the save before moving to another question.");
      return false;
    } finally {
      setNavigationPending(false);
    }
  }

  function nextModuleId(): string | null {
    return allModules[moduleIdx + 1]?.id ?? null;
  }

  async function submitModule() {
    if (!data || !module || submitting) return;
    setSubmitting(true);
    try {
      const token = await getToken();
      await flushAnswerSaves();
      const nextId = nextModuleId();
      const spent = Math.max(1, Math.round((Date.now() - moduleStart.current) / 1000));
      if (nextId) {
        await fnJson("student-attempts/advance", {
          method: "POST",
          token,
          body: { attempt_id: data.attempt.id, module_id: nextId, time_spent_seconds: spent },
        });
        const nextIdx = moduleIdx + 1;
        setModuleIdx(nextIdx);
        setQIndex(0);
        setModal(null);
        setAutoFlag(false);
        moduleStart.current = Date.now();
        const nextAm = data.modules.find((m) => m.module_id === nextId);
        const limit = allModules[nextIdx]?.time_limit_minutes ?? 0;
        setDeadline(Date.now() + (nextAm?.seconds_left ?? limit * 60) * 1000);
      } else {
        await fnJson("student-submit", { method: "POST", token, body: { attempt_id: data.attempt.id } });
        navigate(`/student/scores/${data.attempt.id}`, { replace: true });
      }
    } catch (err) {
      if (saveQueue.current.failedQuestionIds.length > 0) {
        setSaveError("An answer could not be saved. Retry the save before submitting.");
      } else {
        setLoadError(err instanceof Error ? err.message : "Submit failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Submit the whole test from any module (Review modal). Unvisited and
   * unanswered questions score as incorrect server-side; pending saves are
   * flushed first so nothing typed, flagged, or highlighted is lost.
   */
  async function submitAll() {
    if (!data || !current || submitting) return;
    setSubmitting(true);
    try {
      const token = await getToken();
      await flushAnswerSaves();
      await fnJson("student-submit", { method: "POST", token, body: { attempt_id: data.attempt.id } });
      navigate(`/student/scores/${data.attempt.id}`, { replace: true });
    } catch (err) {
      if (saveQueue.current.failedQuestionIds.length > 0) {
        setSaveError("An answer could not be saved. Retry the save before submitting.");
      } else {
        setLoadError(err instanceof Error ? err.message : "Submit failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function leaveAttempt() {
    if (!data || !current || submitting || navigationPending || leaving) return;
    leavingRef.current = true;
    setLeaving(true);
    setNavigationPending(true);
    setLeaveError(null);
    try {
      await flushAnswerSaves();
      const token = await getToken();
      await fnJson("student-attempts/pause", {
        method: "POST",
        token,
        body: { attempt_id: data.attempt.id },
      });
      const destination = data.test.kind === "practice" ? "/student/practice" : "/student/tests";
      navigate(destination, { replace: true });
    } catch (err) {
      leavingRef.current = false;
      const message = err instanceof Error ? err.message : "Unable to leave this attempt";
      setLeaveError(`Could not save and pause this attempt. ${message}`);
      if (saveQueue.current.failedQuestionIds.length > 0) {
        setSaveError("An answer could not be saved. Retry the save before leaving.");
      }
      setNavigationPending(false);
      setLeaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="center-fill">
        <p>{loadError}</p>
        <Button variant="outline" onClick={() => navigate("/student")}>Back to home</Button>
      </div>
    );
  }

  if (!data || !module || !current) return <Spinner />;

  const resp = responses[current.question_id];
  const section = (data.test.sections ?? []).find((s: TestSection) => s.id === module.section_id);
  const answeredCount = questions.filter((q) => responses[q.question_id]?.selected_choice_id || responses[q.question_id]?.typed_answer).length;
  const markedCount = questions.filter((q) => responses[q.question_id]?.marked_for_review).length;
  const unanswered = questions.length - answeredCount;
  const kindLabel = data.test.kind === "practice" ? "Practice Test" : "Full-Length Test";
  // Whole-test totals for the submit-from-review confirmation.
  const allTestQuestions = allModules.flatMap((m) => m.questions ?? []);
  const hasPassage = !!current.question.passage?.content;
  const isLastModule = moduleIdx === allModules.length - 1;
  const isMath = section?.section_type === "math";
  const gridTitle = `Section ${section?.position ?? 1}, Module ${module.position}: ${section?.name ?? kindLabel} Questions`;

  const totalAnswered = allTestQuestions.filter((q) => {
    const r = responses[q.question_id];
    return r?.selected_choice_id || r?.typed_answer;
  }).length;
  const totalMarked = allTestQuestions.filter((q) => responses[q.question_id]?.marked_for_review).length;
  const totalUnanswered = allTestQuestions.length - totalAnswered;

  const timerClass = secondsLeft === null ? "" : secondsLeft < 60 ? "danger" : secondsLeft < 300 ? "warn" : "";
  return (
    <div className={`session-root${highlighterOn ? " highlight-mode" : ""}`} data-test-theme={testTheme}>
      {saveError && (
        <div className="login-error" role="alert" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <span>{saveError}</span>
          <Button variant="outline" disabled={navigationPending || submitting} onClick={() => void retryFailedSaves()}>
            Retry answer saves
          </Button>
        </div>
      )}
      {/* ---------- top bar ---------- */}
      <header className="session-topbar">
        <div className="session-header-main">
          <div className="session-title-block">
            <div className="t-title">Section {section?.position ?? 1}, Module {module.position}: {section?.name ?? kindLabel}</div>
            <button className="session-directions-button" disabled={navigationPending || submitting} onClick={() => setModal("directions")}>
              Directions <span aria-hidden="true">⌄</span>
            </button>
          </div>
          <div className="session-timer-center" role="timer" aria-label="Module time left">
            <span className={`timer-pill ${timerClass}`}>{timerVisible && secondsLeft !== null ? fmtSeconds(secondsLeft) : timerVisible ? "--:--" : "••:••"}</span>
            <button className="timer-visibility-button" onClick={() => setTimerVisible((visible) => !visible)} aria-pressed={!timerVisible}>
              {timerVisible ? "Hide" : "Show"}
            </button>
          </div>
          <div className="session-tools">
            <div
              className={`session-annotation-toggle${highlighterOn ? " is-active" : ""}`}
              role="switch"
              aria-checked={highlighterOn}
              aria-label="Highlights"
              tabIndex={navigationPending || submitting ? -1 : 0}
              aria-disabled={navigationPending || submitting}
              onClick={() => {
                if (navigationPending || submitting) return;
                setHighlighterOn((enabled) => !enabled);
                setSelectionToolbar(null);
              }}
              onKeyDown={(event) => {
                if ((event.key === "Enter" || event.key === " ") && !navigationPending && !submitting) {
                  event.preventDefault();
                  setHighlighterOn((enabled) => !enabled);
                  setSelectionToolbar(null);
                }
              }}
            >
              <span className="session-annotation-icons" aria-hidden="true"><PenLine size={15} /><Highlighter size={15} /></span>
              <span>Highlights</span>
            </div>
            <div className="session-more-placeholder" aria-hidden="true">
              <MoreVertical size={17} />
              <span>More</span>
            </div>
          </div>
        </div>
        <ProgressStrip questions={questions} responses={responses} currentIndex={qIndex} />
      </header>

      {/* ---------- question area ---------- */}
      <div className="session-body">
        <div
          className={`session-question-pane${hasPassage ? " has-passage" : " no-passage"}`}
          ref={paneRef}
          onMouseUp={() => handlePaneSelect()}
          onTouchEnd={() => handlePaneSelect()}
        >
          {hasPassage && (
            <div className="session-panel left">
              <div key={current.question_id} className="q-anim">
                {current.question.passage?.title && (
                  <div className="muted" style={{ fontWeight: 700, marginBottom: 8 }}>
                    {current.question.passage.title}
                  </div>
                )}
                <div className="passage-text">
                  <HighlightableText
                    text={current.question.passage!.content}
                    annotations={resp?.annotations}
                    legacyHighlights={resp?.highlights}
                    target="passage"
                  />
                </div>
              </div>
            </div>
          )}
          <div className={`session-panel right${hasPassage ? "" : " solo"}`}>
            <div key={current.question_id} className="q-anim">
            <div className="q-number">
              <span className="question-index-badge">{qIndex + 1}</span>
              <button
                className={`mark-toggle${resp?.marked_for_review ? " on" : ""}`}
                disabled={navigationPending || submitting}
                onClick={() => void saveResponse(current.question_id, { marked_for_review: !resp?.marked_for_review })}
                title={resp?.marked_for_review ? "Remove review flag" : "Flag for review later"}
              >
                <Bookmark size={15} fill={resp?.marked_for_review ? "currentColor" : "none"} />
                {resp?.marked_for_review ? "Marked for Review" : "Mark for Review"}
              </button>
              {current.question.question_type === "multiple_choice" && (
                <button
                  className={`eliminate-mode-toggle${eliminateMode ? " is-active" : ""}`}
                  type="button"
                  aria-label="Eliminate answer choices"
                  aria-pressed={eliminateMode}
                  title={eliminateMode ? "Turn off choice elimination" : "Eliminate choices"}
                  disabled={navigationPending || submitting}
                  onClick={() => setEliminateMode((enabled) => !enabled)}
                >
                  <ABCStrikeIcon />
                </button>
              )}
            </div>
            <p className="q-prompt">
              <HighlightableText
                text={current.question.prompt}
                annotations={resp?.annotations}
                legacyHighlights={resp?.highlights}
                target="prompt"
              />
            </p>

            <VisualCode code={current.question.visual_code} format={current.question.visual_format} />
            {!current.question.visual_code && current.question.stimulus_image_url && (
              <div style={{ margin: "12px 0" }}>
                <img
                  src={current.question.stimulus_image_url}
                  alt="Question stimulus"
                  style={{ maxWidth: "100%", border: "1px solid var(--border)", borderRadius: 8 }}
                />
              </div>
            )}

            {current.question.question_type === "multiple_choice" ? (
              <div className="choices">
                {[...current.question.choices].sort((a, b) => a.position - b.position).map((c) => {
                  const eliminated = resp?.eliminated_choice_ids?.includes(c.id) ?? false;
                  return (
                    <div className="choice-row" key={c.id}>
                      <button
                        className={`choice ${resp?.selected_choice_id === c.id ? "selected" : ""} ${eliminated ? "eliminated" : ""}`}
                        type="button"
                        disabled={navigationPending || submitting}
                        onClick={() => {
                          if (highlighterOn) return;
                          void saveResponse(current.question_id, { selected_choice_id: c.id, eliminated_choice_ids: resp?.eliminated_choice_ids?.filter((id) => id !== c.id) ?? [] });
                        }}
                      >
                        <span className="letter">{c.label}</span>
                        <span className="choice-text">
                          <HighlightableText
                            text={c.text}
                            annotations={resp?.annotations}
                            legacyHighlights={resp?.highlights}
                            target={`choice:${c.id}`}
                          />
                        </span>
                      </button>
                      {eliminateMode && (
                        <button
                          className={`choice-eliminate${eliminated ? " is-eliminated" : ""}`}
                          type="button"
                          aria-label={`${eliminated ? "Restore" : "Eliminate"} choice ${c.label}`}
                          aria-pressed={eliminated}
                          disabled={navigationPending || submitting}
                          onClick={() => void saveResponse(current.question_id, {
                            eliminated_choice_ids: eliminated
                              ? (resp?.eliminated_choice_ids ?? []).filter((id) => id !== c.id)
                              : [...(resp?.eliminated_choice_ids ?? []), c.id],
                          })}
                        >
                          <CrossedLetter label={c.label} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid-in">
                <input
                  value={typedDraft}
                  placeholder="Enter your answer"
                  disabled={navigationPending || submitting}
                  onChange={(e) => {
                    setTypedDraft(e.target.value);
                    saveTypedDebounced(current.question_id, e.target.value);
                  }}
                />
                <div className="hint">Enter a fraction such as 3/5 or a decimal such as 0.6.</div>
              </div>
            )}
            </div>
          </div>
        </div>

        {/* ---------- bottom bar ---------- */}
        <div className="session-bottom-progress">
          <ProgressStrip questions={questions} responses={responses} currentIndex={qIndex} />
        </div>
        <div className="session-bottombar">
          <Button variant="outline" onClick={() => void goTo(qIndex - 1)} disabled={qIndex === 0 || navigationPending || submitting}>
            Back
          </Button>
          <button className="question-count-button" disabled={navigationPending || submitting} onClick={() => setModal("grid")}>
            Question {qIndex + 1} of {questions.length} <span aria-hidden="true">⌃</span>
          </button>
          {qIndex < questions.length - 1 ? (
            <Button disabled={navigationPending || submitting} onClick={() => void goTo(qIndex + 1)}>{navigationPending ? "Saving…" : "Next"}</Button>
          ) : (
            <Button disabled={navigationPending || submitting} onClick={() => setModal("end")}>{isLastModule ? `Submit ${kindLabel}` : "Submit Module"}</Button>
          )}
        </div>
      </div>

      {/* ---------- modals ---------- */}
      {modal === "grid" && (
        <Modal
          title={gridTitle}
          onClose={() => setModal(null)}
          footer={
            <div className="session-grid-actions">
              <Button variant="outline" disabled={submitting || navigationPending || leaving} onClick={() => void leaveAttempt()}>
                {leaving ? "Saving and leaving…" : "Leave"}
              </Button>
              <Button disabled={submitting || navigationPending || leaving} onClick={() => setModal("submitAll")}>
                Submit {kindLabel}
              </Button>
            </div>
          }
        >
          {leaveError && (
            <div className="login-error" role="alert" style={{ marginBottom: 16 }}>
              <div>{leaveError}</div>
              {saveQueue.current.failedQuestionIds.length > 0 && (
                <Button variant="outline" disabled={navigationPending || submitting} onClick={() => void retryFailedSaves()} style={{ marginTop: 10 }}>
                  Retry answer saves
                </Button>
              )}
            </div>
          )}
          <QuestionGrid
            questions={questions}
            qIndex={qIndex}
            responses={responses}
            onJump={(i) => {
              if (navigationPending || submitting) return;
              void goTo(i).then((moved) => { if (moved) setModal(null); });
            }}
          />
          <div className="session-review-counts">
            <span>{answeredCount} answered</span>
            <span>{unanswered} unanswered</span>
            <span>{markedCount} flagged</span>
          </div>
        </Modal>
      )}

      {modal === "submitAll" && (
        <Modal
          title={`Submit ${kindLabel}`}
          onClose={() => setModal(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setModal("grid")}>Back to review</Button>
              <Button disabled={submitting || navigationPending} onClick={() => void submitAll()}>
                {submitting ? "Submitting…" : `Submit ${kindLabel}`}
              </Button>
            </>
          }
        >
          <p>
            You are about to submit the entire {kindLabel.toLowerCase()}. You will not be able to return to any module.
          </p>
          <div style={{ display: "flex", gap: 18, marginTop: 16, fontSize: 13, color: "var(--muted)", flexWrap: "wrap" }}>
            <span><span className="pill pill-green">{totalAnswered}</span> answered</span>
            <span><span className="pill pill-gray">{totalUnanswered}</span> unanswered</span>
            <span><Flag size={12} color="var(--error)" style={{ verticalAlign: -1 }} /> {totalMarked} flagged</span>
          </div>
          {totalUnanswered > 0 && (
            <div className="login-error" style={{ marginTop: 16 }}>
              You have {totalUnanswered} unanswered question{totalUnanswered === 1 ? "" : "s"} across the test. Unanswered questions will be counted as incorrect.
            </div>
          )}
        </Modal>
      )}

      {modal === "end" && (
        <Modal
          title={isLastModule ? `Submit ${kindLabel}` : "Submit Module"}
          onClose={() => {
            setModal(null);
            setAutoFlag(false);
          }}
          footer={
            <>
              <Button variant="outline" onClick={() => setModal(null)}>Back to {kindLabel}</Button>
              <Button disabled={submitting || navigationPending} onClick={() => void submitModule()}>
                {submitting ? "Submitting…" : isLastModule ? `Submit ${kindLabel}` : "Submit Module"}
              </Button>
            </>
          }
        >
          <p>
            {autoFlag ? "Time is up. " : ""}You are about to submit this module. You will not be able to return to it.
          </p>
          <QuestionGrid
            title={gridTitle}
            questions={questions}
            qIndex={qIndex}
            responses={responses}
            onJump={(i) => {
              if (navigationPending || submitting) return;
              void goTo(i).then((moved) => { if (moved) setModal(null); });
            }}
          />
          <div style={{ display: "flex", gap: 18, marginTop: 20, fontSize: 13, color: "var(--muted)", flexWrap: "wrap" }}>
            <span><span className="pill pill-green">{answeredCount}</span> answered</span>
            <span><span className="pill pill-gray">{unanswered}</span> unanswered</span>
            <span><span className="pill pill-red">{markedCount}</span> flagged</span>
          </div>
          {unanswered > 0 && (
            <div className="login-error" style={{ marginTop: 16 }}>
              You have {unanswered} unanswered question{unanswered === 1 ? "" : "s"}. Unanswered questions will be counted as incorrect.
            </div>
          )}
        </Modal>
      )}

      {modal === "directions" && (
        <Modal title="Directions" onClose={() => setModal(null)}>
          <p style={{ lineHeight: 1.7 }}>{isMath ? MATH_DIRECTIONS : RW_DIRECTIONS}</p>
          <p className="muted" style={{ fontSize: 13 }}>
            This module has {questions.length} questions and a {module.time_limit_minutes}-minute time limit. Your
            answers are saved automatically as you move through the full-length test.
          </p>
          {isMath && <button type="button" className="session-reference-link" onClick={() => setModal("reference")}>Open math reference</button>}
        </Modal>
      )}

      {modal === "reference" && (
        <Modal title="Math reference" onClose={() => setModal(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {MATH_REFERENCE.map((f) => (
              <div key={f} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", fontFamily: "var(--font-mono)", fontSize: 13.5 }}>
                {f}
              </div>
            ))}
          </div>
        </Modal>
      )}
      {selectionToolbar && createPortal(
        <div
          className="selection-annotation-toolbar"
          data-test-theme={testTheme}
          style={{ left: selectionToolbar.left, top: selectionToolbar.top }}
          role="toolbar"
          aria-label="Text annotation tools"
          onMouseDown={(event) => event.preventDefault()}
        >
          <div className="annotation-toolbar-actions">
            <button type="button" className="annotation-color yellow" aria-label="Highlight yellow" title="Yellow highlight" onClick={() => applySelectionAnnotation({ kind: "color", color: "yellow" })} />
            <button type="button" className="annotation-color blue" aria-label="Highlight blue" title="Blue highlight" onClick={() => applySelectionAnnotation({ kind: "color", color: "blue" })} />
            <button type="button" className="annotation-color pink" aria-label="Highlight pink" title="Pink highlight" onClick={() => applySelectionAnnotation({ kind: "color", color: "pink" })} />
            <span className="annotation-toolbar-divider" />
            <button
              type="button"
              className={`annotation-tool-button${isSelectionUnderlined() ? " is-active" : ""}`}
              aria-label="Underline selection"
              title="Underline"
              onClick={() => applySelectionAnnotation({ kind: "underline" })}
            ><Underline size={20} /></button>
            <button type="button" className="annotation-tool-button" aria-label="Erase highlights from selection" title="Erase" onClick={() => applySelectionAnnotation({ kind: "erase" })}><Trash2 size={18} /></button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function ABCStrikeIcon() {
  return (
    <svg className="abc-strike-icon" viewBox="0 0 52 24" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.35">
        <circle cx="10" cy="12" r="8" /><circle cx="26" cy="12" r="8" /><circle cx="42" cy="12" r="8" />
      </g>
      <g fill="currentColor" fontFamily="Arial, sans-serif" fontSize="8" fontWeight="700" textAnchor="middle">
        <text x="10" y="15">A</text><text x="26" y="15">B</text><text x="42" y="15">C</text>
      </g>
      <path d="M2 20 50 4" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function CrossedLetter({ label }: { label: string }) {
  return (
    <svg className="crossed-letter-icon" viewBox="0 0 30 30" aria-hidden="true">
      <circle cx="15" cy="15" r="10.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <text x="15" y="19" fill="currentColor" fontFamily="Arial, sans-serif" fontSize="11" fontWeight="700" textAnchor="middle">{label}</text>
      <path d="M4 15h22" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function BookmarkRibbon() {
  return (
    <svg className="qflag" viewBox="0 0 12 16" aria-hidden="true">
      <path d="M1 0.5h10V15l-5-3.6L1 15z" fill="var(--error)" />
    </svg>
  );
}

function ProgressStrip({
  questions,
  responses,
  currentIndex,
}: {
  questions: TestModule["questions"];
  responses: Record<string, SavedResponse>;
  currentIndex: number;
}) {
  return (
    <div className="session-progress-strip" aria-hidden="true">
      {questions.map((item, index) => {
        const response = responses[item.question_id];
        const answered = !!response?.selected_choice_id || !!response?.typed_answer;
        const marked = !!response?.marked_for_review;
        return (
          <span
            key={item.question_id}
            className={`${index === currentIndex ? "current " : ""}${answered ? "answered " : ""}${marked ? "marked" : ""}`.trim()}
          />
        );
      })}
    </div>
  );
}

function ReviewLegend() {
  return (
    <div className="qlegend">
      <span className="qlegend-item"><MapPin size={15} /> Current</span>
      <span className="qlegend-item"><span className="qlegend-box unanswered" /> Unanswered</span>
      <span className="qlegend-item"><span className="qlegend-box answered" /> Answered</span>
      <span className="qlegend-item"><BookmarkRibbon /> For Review</span>
    </div>
  );
}

function QuestionGrid({
  title,
  questions,
  qIndex,
  responses,
  onJump,
}: {
  title?: string;
  questions: TestModule["questions"];
  qIndex: number;
  responses: Record<string, SavedResponse>;
  onJump: (i: number) => void;
}) {
  return (
    <div className="qreview">
      {title && (
        <>
          <div className="qreview-title">{title}</div>
          <hr className="qreview-div" />
        </>
      )}
      <ReviewLegend />
      <hr className="qreview-div" />
      <div className="qgrid">
        {questions.map((mq, i) => {
          const r = responses[mq.question_id];
          const answered = !!r?.selected_choice_id || !!r?.typed_answer;
          const marked = !!r?.marked_for_review;
          const isCurrent = i === qIndex;
          const label = `Question ${i + 1}${answered ? ", answered" : ", unanswered"}${marked ? ", flagged for review" : ""}${isCurrent ? ", current" : ""}`;
          return (
            <span key={mq.question_id} className="qcell-wrap">
              <span className="qcell-loc">{isCurrent && <MapPin size={16} />}</span>
              <button
                title={label}
                aria-label={label}
                className={`qcell${answered ? " answered" : " unanswered"}`}
                onClick={() => onJump(i)}
              >
                {marked && <BookmarkRibbon />}
                <span className="qnum">{i + 1}</span>
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
