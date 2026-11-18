import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { TestListItem } from "../../lib/types";
import { Button, EmptyState, Pill, Spinner, fmtDate } from "../../components/ui";
import { initReveal } from "../../lib/reveal";

function PracticeSetStats({ set }: { set: TestListItem }) {
  return (
    <div className="practice-set-stats">
      <span><strong>{set.questions}</strong> {set.questions === 1 ? "question" : "questions"}</span>
      <span>{set.time_limit_minutes == null ? "Untimed" : <><strong>{set.time_limit_minutes}</strong> {set.time_limit_minutes === 1 ? "minute" : "minutes"}</>}</span>
    </div>
  );
}

export default function PracticePage() {
  const navigate = useNavigate();
  const [sets, setSets] = useState<TestListItem[] | null>(null);
  const parallaxFrame = useRef<number | null>(null);
  const pendingParallax = useRef({ x: 0, y: 0 });

  useEffect(() => () => {
    if (parallaxFrame.current !== null) window.cancelAnimationFrame(parallaxFrame.current);
  }, []);

  function handlePracticePointerMove(event: ReactPointerEvent<HTMLElement>) {
    if (
      event.pointerType !== "mouse" ||
      !window.matchMedia("(hover: hover) and (pointer: fine)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const page = event.currentTarget.parentElement;
    if (!page || bounds.width === 0 || bounds.height === 0) return;

    pendingParallax.current = {
      x: ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      y: ((event.clientY - bounds.top) / bounds.height) * 2 - 1,
    };

    if (parallaxFrame.current !== null) return;
    parallaxFrame.current = window.requestAnimationFrame(() => {
      parallaxFrame.current = null;
      const { x, y } = pendingParallax.current;
      page.style.setProperty("--practice-bg-x", `${(-x * 8).toFixed(1)}px`);
      page.style.setProperty("--practice-bg-y", `${(-y * 5).toFixed(1)}px`);
      page.style.setProperty("--practice-summary-x", `${(x * 4).toFixed(1)}px`);
      page.style.setProperty("--practice-summary-y", `${(y * 2.5).toFixed(1)}px`);
    });
  }

  function resetPracticePointer(event: ReactPointerEvent<HTMLElement>) {
    const page = event.currentTarget.parentElement;
    if (parallaxFrame.current !== null) {
      window.cancelAnimationFrame(parallaxFrame.current);
      parallaxFrame.current = null;
    }
    page?.style.removeProperty("--practice-bg-x");
    page?.style.removeProperty("--practice-bg-y");
    page?.style.removeProperty("--practice-summary-x");
    page?.style.removeProperty("--practice-summary-y");
  }

  useEffect(() => {
    void (async () => {
      const token = await getToken().catch(() => undefined);
      if (!token) return;
      const res = await fnJson<{ tests: TestListItem[] }>("student-tests", { token }).catch(() => ({ tests: [] }));
      setSets(res.tests.filter((t) => t.kind === "practice"));
    })();
  }, []);

  useEffect(() => { if (sets) requestAnimationFrame(() => initReveal()); }, [sets]);

  const available = (sets ?? []).filter((t) => !t.attempt);
  const inProgress = (sets ?? []).filter((t) => t.attempt?.status === "in_progress");
  const completed = (sets ?? []).filter((t) => t.attempt?.status === "graded");

  return (
    <div className="practice-index">
      <header
        className="practice-intro"
        onPointerMove={handlePracticePointerMove}
        onPointerLeave={resetPracticePointer}
      >
        <div className="practice-intro-copy">
          <p className="practice-intro-label">Practice</p>
          <h1>Sharpen one skill at a time.</h1>
          <p>Short, timed sets with immediate scoring.</p>
        </div>
        <div className="practice-intro-summary" aria-label="Practice activity summary">
          <div><strong>{available.length}</strong><span>Ready to start</span></div>
          <div><strong>{inProgress.length}</strong><span>In progress</span></div>
          <div><strong>{completed.length}</strong><span>Completed</span></div>
        </div>
      </header>

      {!sets && <Spinner />}

      {sets && available.length === 0 && inProgress.length === 0 && completed.length === 0 && (
        <EmptyState title="No practice sets yet" body="Your teacher has not published any practice sets." />
      )}

      {sets && available.length > 0 && (
        <section style={{ marginBottom: 34 }}>
          <div className="section-head">
            <h2>Available</h2>
            <span className="muted" style={{ fontSize: 12 }}>{available.length} ready</span>
          </div>
          {available.map((t) => (
            <div className="card test-card practice-set-card reveal" key={t.assignment_id ?? t.id}>
              <div className="practice-set-copy">
                <h3 className="t-title">{t.title}</h3>
                {t.class_name && <Pill tone="blue">Class: {t.class_name}</Pill>}
                <p className="t-desc">{t.description ?? "Practice set"}</p>
              </div>
              <PracticeSetStats set={t} />
              <div className="practice-set-actions">
                <Button onClick={() => navigate(`/student/practice/${t.id}/start${t.assignment_id ? `?assignment=${t.assignment_id}` : ""}`)}>Start practice</Button>
              </div>
            </div>
          ))}
        </section>
      )}

      {sets && inProgress.length > 0 && (
        <section style={{ marginBottom: 34 }}>
          <div className="section-head">
            <h2>In Progress</h2>
            <span className="muted" style={{ fontSize: 12 }}>{inProgress.length} ongoing</span>
          </div>
          {inProgress.map((t) => (
            <div className="card test-card practice-set-card reveal" key={t.assignment_id ?? t.id}>
              <div className="practice-set-copy">
                <h3 className="t-title">{t.title}</h3>
                {t.class_name && <Pill tone="blue">Class: {t.class_name}</Pill>}
                <p className="t-desc">Started {fmtDate(t.attempt!.started_at)}</p>
              </div>
              <PracticeSetStats set={t} />
              <div className="practice-set-actions">
                <Pill tone="amber">In progress</Pill>
                <Button onClick={() => navigate(`/student/attempts/${t.attempt!.id}/session`)}>Resume</Button>
              </div>
            </div>
          ))}
        </section>
      )}

      {sets && completed.length > 0 && (
        <section className="practice-completed">
          <div className="section-head">
            <h2>Completed</h2>
            <span className="muted" style={{ fontSize: 12 }}>{completed.length} finished</span>
          </div>
          {completed.map((t) => (
            <div className="card test-card practice-set-card reveal" key={t.assignment_id ?? t.id}>
              <div className="practice-set-copy">
                <h3 className="t-title">{t.title}</h3>
                {t.class_name && <Pill tone="blue">Class: {t.class_name}</Pill>}
              </div>
              <PracticeSetStats set={t} />
              <div className="practice-set-actions">
                <Pill tone="green">Graded</Pill>
                <Button variant="outline" onClick={() => navigate(`/student/scores/${t.attempt!.id}`, { state: { fromPractice: true } })}>Review practice</Button>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
