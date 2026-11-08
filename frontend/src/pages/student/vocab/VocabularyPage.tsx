import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fnJson, getToken } from "../../../lib/supabase";
import type { VocabDashboard, VocabDeck } from "../../../lib/types";
import { Button, EmptyState, Modal, Pill, Spinner } from "../../../components/ui";
import "../../../styles/vocab-navigation.css";

const DAY_MS = 86_400_000;

export default function VocabularyPage() {
  const navigate = useNavigate();
  const [dash, setDash] = useState<VocabDashboard | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#7f1d1d");
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = () => {
    void (async () => {
      const token = await getToken().catch(() => undefined);
      if (!token) return;
      const d = await fnJson<VocabDashboard>("student-vocab", { token }).catch(() => null);
      setDash(d);
    })();
  };

  useEffect(load, []);

  const weeks = useMemo(() => {
    if (!dash) return [];
    const byDate = new Map(dash.heatmap.map((h) => [h.date, h.count]));
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const start = new Date(today.getTime() - 181 * DAY_MS);
    const days: Array<{ date: Date; count: number }> = [];
    for (let i = 0; i < 182; i++) {
      const d = new Date(start.getTime() + i * DAY_MS);
      const key = d.toISOString().slice(0, 10);
      days.push({ date: d, count: byDate.get(key) ?? 0 });
    }
    const out: Array<Array<{ date: Date; count: number }>> = [];
    for (let w = 0; w < 26; w++) out.push(days.slice(w * 7, w * 7 + 7));
    return out;
  }, [dash]);

  const heatClass = (n: number) => (n === 0 ? "heat-0" : n <= 2 ? "heat-1" : n <= 4 ? "heat-2" : n <= 7 ? "heat-3" : "heat-4");

  const createDeck = async () => {
    if (!name.trim()) return;
    setError(null);
    try {
      const token = await getToken();
      const { deck } = await fnJson<{ deck: VocabDeck }>("student-vocab/decks", {
        method: "POST",
        body: { name: name.trim(), description: description.trim() || null, color },
        token,
      });
      setCreating(false);
      setName("");
      setDescription("");
      load();
      navigate(`/student/vocabulary/decks/${deck.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create deck");
    }
  };

  const deleteDeck = async (deck: VocabDeck) => {
    if (deck.assigned !== false || deletingId) return;
    if (!window.confirm(`Delete "${deck.name}"? Its cards and review history will be permanently deleted.`)) return;

    setDeletingId(deck.id);
    setDeleteError(null);
    try {
      const token = await getToken();
      await fnJson<{ ok: boolean }>(`student-vocab/decks/${deck.id}`, { method: "DELETE", token });
      setDash((current) => {
        if (!current) return current;
        const decks = current.decks.filter((item) => item.id !== deck.id);
        const totals = decks.reduce((sum, item) => ({
          cards: sum.cards + item.card_count,
          due: sum.due + item.due_count,
          fresh: sum.fresh + item.new_count,
        }), { cards: 0, due: 0, fresh: 0 });
        return { ...current, decks, totals };
      });
    } catch {
      setDeleteError(`Could not delete "${deck.name}". Please try again.`);
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => { if (dash) requestAnimationFrame(() => import("../../../lib/reveal").then(m => m.initReveal())); }, [dash]);

  if (!dash) return <Spinner />;

  return (
    <div>
      <div className="section-label">Vocabulary</div>
      <div className="page-head-row">
        <div>
          <h1 className="page-title"><span className="hl-muted">Your</span> <span className="hl-bright">vocabulary</span></h1>
          <p className="page-sub">Personalized daily practice</p>
        </div>
        <Button onClick={() => setCreating(true)}>New Deck</Button>
      </div>

      <section className="card vocab-hero">
        <div className="vocab-streak">
          <div className="streak-flame" style={{ background: dash.streak.current > 0 ? "var(--streak)" : "var(--border-strong)" }}>
            {dash.streak.current}
          </div>
          <div>
            <strong>{dash.streak.current} day streak</strong>
            <span className="muted">Best: {dash.streak.best} days</span>
          </div>
        </div>
        <div className="vocab-heatmap">
          <div className="heat-legend muted">
            <span>26 weeks</span>
            <span>Less</span>
            <span className="heat-0" />
            <span className="heat-1" />
            <span className="heat-2" />
            <span className="heat-3" />
            <span className="heat-4" />
            <span>More</span>
          </div>
          <div className="heat-grid">
            {weeks.map((week, wi) => (
              <div className="heat-col" key={wi}>
                {week.map((day) => (
                  <div
                    key={day.date.toISOString()}
                    className={`heat-cell ${heatClass(day.count)}`}
                    title={`${day.date.toISOString().slice(0, 10)}: ${day.count} review${day.count === 1 ? "" : "s"}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="vocab-stats">
          <div><strong>{dash.totals.cards}</strong><span className="muted">cards</span></div>
          <div><strong style={{ color: "var(--amber)" }}>{dash.totals.due}</strong><span className="muted">due today</span></div>
          <div><strong style={{ color: "var(--green)" }}>{dash.totals.fresh}</strong><span className="muted">new</span></div>
        </div>
      </section>

      {dash.decks.length === 0 && (
        <EmptyState
          title="No decks yet"
          body="Create a deck, add word cards, and start studying to build your streak."
        />
      )}

      {deleteError && <p className="form-error" role="alert">{deleteError}</p>}
      <section className="deck-grid">
        {dash.decks.map((deck) => (
          <div className="card deck-card" key={deck.id}>
            <div className="deck-color" style={{ background: deck.color }} />
            <div className="deck-status">
              {deck.assigned && <Pill tone="blue">assigned</Pill>}
              {deck.due_count > 0 && <Pill tone="amber">Due · {deck.due_count}</Pill>}
            </div>
            <h3 className="t-title">{deck.name}</h3>
            <p className="t-desc">{deck.description ?? "Word deck"}</p>
            <p className="t-desc">
              {deck.card_count} card{deck.card_count === 1 ? "" : "s"}
              {deck.new_count > 0 ? ` · ${deck.new_count} new` : ""}
            </p>
            <div className="deck-actions">
              <Button variant="outline" onClick={() => navigate(`/student/vocabulary/decks/${deck.id}`)}>Manage</Button>
              <Button disabled={deck.card_count === 0} onClick={() => navigate(`/student/vocabulary/study?deck_id=${deck.id}`)}>
                Study
              </Button>
              <Button variant="ghost" disabled={deck.card_count === 0} onClick={() => navigate(`/student/vocabulary/sprint?deck_id=${deck.id}`)}>
                Sprint
              </Button>
              {deck.assigned === false && (
                <Button variant="danger" disabled={deletingId !== null} aria-label={`Delete deck ${deck.name}`} onClick={() => void deleteDeck(deck)}>
                  {deletingId === deck.id ? "Deleting…" : "Delete"}
                </Button>
              )}
            </div>
          </div>
        ))}
      </section>

      {creating && (
        <Modal
          title="New Deck"
          onClose={() => setCreating(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
              <Button onClick={createDeck}>Create</Button>
            </>
          }
        >
          <label className="f-label">Name</label>
          <input className="f-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SAT High-Frequency Words" autoFocus />
          <label className="f-label">Description (optional)</label>
          <input className="f-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short note" />
          <label className="f-label">Color</label>
          <div className="color-row">
            {["#7f1d1d", "#b91c1c", "#c2410c", "#b45309", "#1d4ed8", "#0f766e", "#15803d", "#6d28d9"].map((c) => (
              <button
                key={c}
                className={`color-dot${color === c ? " color-dot-on" : ""}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={c}
              />
            ))}
          </div>
          {error && <p className="form-error">{error}</p>}
        </Modal>
      )}
    </div>
  );
}
