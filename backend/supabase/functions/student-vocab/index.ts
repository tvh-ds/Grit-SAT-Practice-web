import { parseVocabImport, VocabImportError } from "../_shared/vocabImport.ts";
﻿import { requireRole, HttpError, pathSegments } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";
import { requireApprovedStudent } from "../_shared/auth.ts";
import {
  ratingFor,
  previewFsrsRatings,
  snapshotFsrsCard,
  toFsrsCard,
  vocabScheduler,
  VOCAB_SCHEDULER_VERSION,
} from "../_shared/vocab_fsrs.ts";

const DAY_MS = 86_400_000;
import {
  deckCreateSchema,
  deckUpdateSchema,
  cardCreateSchema,
  cardUpdateSchema,
  importCardsSchema,
  vocabReviewSchema,
} from "../_shared/validation.ts";

interface DeckRow { id: string; name: string; description: string | null; color: string; student_id: string | null; status: string }
interface CardRow {
  id: string;
  deck_id: string;
  word: string;
  definition: string;
  example_sentence: string | null;
  part_of_speech: string | null;
  tags: string[];
}
interface StateRow {
  card_id: string;
  fsrs_difficulty: number | null;
  fsrs_stability: number | null;
  fsrs_state: string;
  learning_steps: number;
  scheduled_days: number;
  repetitions: number;
  lapses: number;
  status: string;
  due_at: string;
  last_reviewed_at: string | null;
  scheduler_version: number;
  state_version: number;
  legacy_lapses: number;
}

async function fetchDeck(
  svc: ReturnType<typeof serviceClient>,
  deckId: string,
): Promise<DeckRow> {
  const { data, error: err } = await svc
    .from("vocab_decks")
    .select("id, name, description, color, student_id, status")
    .eq("id", deckId)
    .maybeSingle();
  if (err) throw new HttpError(500, err.message);
  if (!data) throw new HttpError(404, "Deck not found");
  return data as DeckRow;
}

/** Deck the student owns (editable). */
async function getOwnDeck(
  svc: ReturnType<typeof serviceClient>,
  studentId: string,
  deckId: string,
): Promise<DeckRow> {
  const deck = await fetchDeck(svc, deckId);
  if (deck.student_id !== studentId) throw new HttpError(403, "You can only edit decks you created");
  if (deck.status === "archived") throw new HttpError(404, "Deck not found");
  return deck;
}

/** Deck the student can read: owned, or an active admin deck assigned to them. */
async function getReadableDeck(
  svc: ReturnType<typeof serviceClient>,
  studentId: string,
  deckId: string,
): Promise<DeckRow> {
  const deck = await fetchDeck(svc, deckId);
  if (deck.student_id === studentId) return deck;
  const { data: assigned, error: err } = await svc
    .from("vocab_deck_assignments")
    .select("id")
    .eq("deck_id", deckId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (err) throw new HttpError(500, err.message);
  if (!assigned) throw new HttpError(403, "Deck not found");
  if (deck.status === "archived") throw new HttpError(404, "Deck not found");
  return deck;
}

async function deckIdList(
  svc: ReturnType<typeof serviceClient>,
  studentId: string,
  deckId: string | null,
): Promise<string[]> {
  if (deckId) {
    await getReadableDeck(svc, studentId, deckId);
    return [deckId];
  }
  const { data: own, error: oErr } = await svc
    .from("vocab_decks")
    .select("id")
    .eq("student_id", studentId)
    .eq("status", "active");
  if (oErr) throw new HttpError(500, oErr.message);
  const { data: assigned, error: aErr } = await svc
    .from("vocab_deck_assignments")
    .select("deck_id")
    .eq("student_id", studentId);
  if (aErr) throw new HttpError(500, aErr.message);
  const ids = new Set<string>([...(own ?? []).map((d: { id: string }) => d.id)]);
  for (const a of assigned ?? []) ids.add((a as { deck_id: string }).deck_id);
  return [...ids];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await requireApprovedStudent(req);
    const svc = serviceClient();
    const seg = pathSegments(req);
    const url = new URL(req.url);

    // ---- dashboard ---------------------------------------------------------
    if (req.method === "GET" && seg.length === 1) {
      const now = new Date();
      const cutoff = new Date(now.getTime() - 182 * DAY_MS).toISOString().slice(0, 10);
      const [ownResult, assignedResult, activityResult] = await Promise.all([
        svc.from("vocab_decks")
          .select("id, name, description, color, created_at, student_id")
          .eq("student_id", ctx.user.id)
          .eq("status", "active")
          .order("created_at", { ascending: true }),
        svc.from("vocab_deck_assignments").select("deck_id").eq("student_id", ctx.user.id),
        svc.from("vocab_daily_activity")
          .select("activity_date, cards_reviewed")
          .eq("student_id", ctx.user.id)
          .gte("activity_date", cutoff)
          .order("activity_date", { ascending: true }),
      ]);
      if (ownResult.error) return error(ownResult.error.message, 500);
      if (assignedResult.error) return error(assignedResult.error.message, 500);
      if (activityResult.error) return error(activityResult.error.message, 500);
      const own = ownResult.data;
      const ownIds = new Set((own ?? []).map((d: { id: string }) => d.id));
      const assigned = assignedResult.data;
      const assignedIds = (assigned ?? []).map((a: { deck_id: string }) => a.deck_id);

      let decksOut: Array<Record<string, unknown>> = [];
      if (ownIds.size > 0 || assignedIds.length > 0) {
        const deckIds = [...ownIds, ...assignedIds];
        const { data: deckRows, error: d2Err } = await svc
          .from("vocab_decks")
          .select("id, name, description, color, created_at, student_id")
          .in("id", deckIds)
          .eq("status", "active");
        if (d2Err) return error(d2Err.message, 500);
        decksOut = (deckRows ?? []).map((d) => ({ ...(d as Record<string, unknown>), assigned: ownIds.has((d as { id: string }).id) ? false : true }));
      }

      const deckRows = decksOut as unknown as DeckRow[];
      const ids = deckRows.map((d) => d.id);

      const { data: cardRows, error: cErr } = ids.length === 0
        ? { data: [], error: null }
        : await svc
          .from("vocab_cards")
          .select("id, deck_id, study_states:vocab_card_state(card_id, due_at)")
          .in("deck_id", ids)
          .eq("study_states.student_id", ctx.user.id);
      if (cErr) return error(cErr.message, 500);
      const cards = (cardRows ?? []) as unknown as Array<{
        id: string;
        deck_id: string;
        study_states?: Array<Pick<StateRow, "card_id" | "due_at">>;
      }>;
      const states = cards.flatMap((card) => card.study_states ?? []);

      const nowIso = new Date().toISOString();
      const cardCountByDeck = new Map<string, number>();
      const dueSet = new Set<string>(states.filter((s) => s.due_at <= nowIso).map((s) => s.card_id));
      const stateSet = new Set<string>(states.map((s) => s.card_id));
      for (const row of cards) {
        cardCountByDeck.set(row.deck_id, (cardCountByDeck.get(row.deck_id) ?? 0) + 1);
      }

      const activity = activityResult.data;

      const dates = new Set((activity ?? []).map((a: { activity_date: string }) => a.activity_date));
      let current = 0;
      let best = 0;
      let cursor = new Date();
      cursor.setUTCHours(0, 0, 0, 0);
      if (!dates.has(cursor.toISOString().slice(0, 10))) cursor.setUTCDate(cursor.getUTCDate() - 1);
      while (dates.has(cursor.toISOString().slice(0, 10))) {
        current++;
        cursor.setUTCDate(cursor.getUTCDate() - 1);
      }
      const sortedDays = [...dates].sort();
      let run = 0;
      let prev = "";
      for (const day of sortedDays) {
        if (prev && daysBetween(prev, day) === 1) run++;
        else if (prev && daysBetween(prev, day) > 1) run = 0;
        else run = 1;
        best = Math.max(best, run);
        prev = day;
      }

      const todayIso = now.toISOString().slice(0, 10);
      const todayRow = (activity ?? []).find((a: { activity_date: string }) => a.activity_date === todayIso) as
        | { activity_date: string; cards_reviewed: number }
        | undefined;

      const totals = { cards: 0, due: 0, fresh: 0 };
      const decksOut2 = deckRows.map((d) => {
        const total = cardCountByDeck.get(d.id) ?? 0;
        const deckCards = cards.filter((c) => c.deck_id === d.id);
        const due = deckCards.filter((c) => dueSet.has(c.id)).length;
        const fresh = deckCards.filter((c) => !stateSet.has(c.id)).length;
        totals.cards += total;
        totals.due += due;
        totals.fresh += fresh;
        return { ...d, card_count: total, due_count: due, new_count: fresh };
      });

      return json({
        decks: decksOut2,
        heatmap: (activity ?? []).map((a: { activity_date: string; cards_reviewed: number }) => ({ date: a.activity_date, count: a.cards_reviewed })),
        today: todayRow ? { reviewed: todayRow.cards_reviewed } : null,
        streak: { current, best },
        totals,
      });
    }

    // ---- decks -------------------------------------------------------------
    if (req.method === "POST" && seg.length === 2 && seg[1] === "decks") {
      const body = deckCreateSchema.parse(await req.json());
      const { data, error: err } = await svc
        .from("vocab_decks")
        .insert({ ...body, student_id: ctx.user.id })
        .select("id, name, description, color")
        .single();
      if (err) return error(err.message, 500);
      return json({ deck: data }, 201);
    }

    if (req.method === "PATCH" && seg.length === 3 && seg[1] === "decks") {
      const body = deckUpdateSchema.parse(await req.json());
      await getOwnDeck(svc, ctx.user.id, seg[2]);
      const { data, error: err } = await svc
        .from("vocab_decks")
        .update(body)
        .eq("id", seg[2])
        .select("id, name, description, color")
        .single();
      if (err) return error(err.message, 500);
      return json({ deck: data });
    }

    if (req.method === "DELETE" && seg.length === 3 && seg[1] === "decks") {
      await getOwnDeck(svc, ctx.user.id, seg[2]);
      const { error: err } = await svc.from("vocab_decks")
        .delete()
        .eq("id", seg[2])
        .eq("student_id", ctx.user.id)
        .eq("status", "active");
      if (err) {
        console.error("Failed to delete student vocabulary deck", err);
        return error("Could not delete deck", 500);
      }
      return json({ ok: true });
    }

    // ---- cards -------------------------------------------------------------
    if (req.method === "GET" && seg.length === 4 && seg[1] === "decks" && seg[3] === "cards") {
      await getReadableDeck(svc, ctx.user.id, seg[2]);
      const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
      const tag = url.searchParams.get("tag")?.trim() ?? "";
      let query = svc.from("vocab_cards").select("id, deck_id, word, definition, example_sentence, part_of_speech, tags").eq("deck_id", seg[2]).order("word", { ascending: true });
      if (tag) query = query.contains("tags", [tag]);
      const { data, error: err } = await query;
      if (err) return error(err.message, 500);
      const rows = (data ?? []) as CardRow[];
      const filtered = q ? rows.filter((r) => `${r.word} ${r.definition} ${r.part_of_speech ?? ""}`.toLowerCase().includes(q)) : rows;
      return json({ cards: filtered });
    }

    if (req.method === "POST" && seg.length === 2 && seg[1] === "cards") {
      const body = cardCreateSchema.parse(await req.json());
      await getOwnDeck(svc, ctx.user.id, body.deck_id);
      const { data, error: err } = await svc
        .from("vocab_cards")
        .insert(body)
        .select("id, deck_id, word, definition, example_sentence, part_of_speech, tags")
        .single();
      if (err) return error(err.message, 500);
      return json({ card: data }, 201);
    }

    if (req.method === "POST" && seg.length === 3 && seg[1] === "cards" && seg[2] === "import") {
      const body = importCardsSchema.parse(await req.json());
      await getOwnDeck(svc, ctx.user.id, body.deck_id);
      const rows = parseVocabImport(body.text);
      if (rows.length === 0) return error("No valid word/definition pairs found", 422);
      const { data: existing, error: eErr } = await svc
        .from("vocab_cards")
        .select("word")
        .eq("deck_id", body.deck_id);
      if (eErr) return error(eErr.message, 500);
      const have = new Set((existing ?? []).map((r: { word: string }) => r.word.toLowerCase()));
      const toInsert = rows.filter((r) => {
        const key = r.word.toLowerCase();
        if (have.has(key)) return false;
        have.add(key);
        return true;
      });
      let inserted = 0;
      for (const row of toInsert) {
        const { error: iErr } = await svc.from("vocab_cards").insert({ ...row, deck_id: body.deck_id });
        if (iErr) {
          if (iErr.message.includes("vocab_cards_word_deck_unique")) continue;
          return error(iErr.message, 500);
        }
        inserted++;
      }
      return json({ imported: inserted, skipped: rows.length - inserted, total: rows.length });
    }

    if (req.method === "PATCH" && seg.length === 3 && seg[1] === "cards") {
      const body = cardUpdateSchema.parse(await req.json());
      const { data: card, error: cErr } = await svc.from("vocab_cards").select("deck_id").eq("id", seg[2]).maybeSingle();
      if (cErr) return error(cErr.message, 500);
      if (!card) return error("Card not found", 404);
      await getOwnDeck(svc, ctx.user.id, card.deck_id);
      const { data, error: err } = await svc
        .from("vocab_cards")
        .update(body)
        .eq("id", seg[2])
        .select("id, deck_id, word, definition, example_sentence, part_of_speech, tags")
        .single();
      if (err) return error(err.message, 500);
      return json({ card: data });
    }

    if (req.method === "DELETE" && seg.length === 3 && seg[1] === "cards") {
      const { data: card, error: cErr } = await svc.from("vocab_cards").select("deck_id").eq("id", seg[2]).maybeSingle();
      if (cErr) return error(cErr.message, 500);
      if (!card) return error("Card not found", 404);
      await getOwnDeck(svc, ctx.user.id, card.deck_id);
      const { error: err } = await svc.from("vocab_cards").delete().eq("id", seg[2]);
      if (err) return error(err.message, 500);
      return json({ ok: true });
    }

    // ---- study / sprint queues ---------------------------------------------
    if (req.method === "GET" && seg.length === 2 && seg[1] === "study") {
      const ids = await deckIdList(svc, ctx.user.id, url.searchParams.get("deck_id"));
      const pageSize = 1000;
      const cardRows: CardRow[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const { data, error: cErr } = await svc
          .from("vocab_cards")
          .select("id, deck_id, word, definition, example_sentence, part_of_speech, tags")
          .in("deck_id", ids.length > 0 ? ids : [""])
          .order("id")
          .range(offset, offset + pageSize - 1);
        if (cErr) return error(cErr.message, 500);
        cardRows.push(...((data ?? []) as CardRow[]));
        if ((data ?? []).length < pageSize) break;
      }

      const states: StateRow[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const { data, error: sErr } = await svc
          .from("vocab_card_state")
          .select("card_id, fsrs_difficulty, fsrs_stability, fsrs_state, learning_steps, scheduled_days, repetitions, lapses, status, due_at, last_reviewed_at, scheduler_version, state_version, legacy_lapses")
          .eq("student_id", ctx.user.id)
          .order("card_id")
          .range(offset, offset + pageSize - 1);
        if (sErr) return error(sErr.message, 500);
        states.push(...((data ?? []) as StateRow[]));
        if ((data ?? []).length < pageSize) break;
      }
      const stateMap = new Map<string, StateRow>((states ?? []).map((s) => [s.card_id, s as StateRow]));
      const now = new Date();
      const nowIso = now.toISOString();
      const due = cardRows.filter((c) => {
        const s = stateMap.get(c.id);
        return !s || new Date(s.due_at).getTime() <= now.getTime();
      });
      due.sort((a, b) => {
        const sa = stateMap.get(a.id);
        const sb = stateMap.get(b.id);
        const da = sa ? sa.due_at : null;
        const db = sb ? sb.due_at : null;
        if (da && db) return da < db ? -1 : da > db ? 1 : 0;
        if (da) return 1;
        if (db) return -1;
        return 0;
      });
      const out = due.map((c) => {
        const s = stateMap.get(c.id);
        const fsrsCard = toFsrsCard(s ? {
          due_at: s.due_at,
          stability: s.fsrs_stability,
          difficulty: s.fsrs_difficulty,
          learning_steps: s.learning_steps,
          scheduled_days: s.scheduled_days,
          repetitions: s.repetitions,
          lapses: s.lapses,
          fsrs_state: s.fsrs_state,
          last_reviewed_at: s.last_reviewed_at,
        } : null, now);
        return {
          card: c,
          state: s
            ? {
                stability: s.fsrs_stability,
                difficulty: s.fsrs_difficulty,
                fsrs_state: s.fsrs_state,
                learning_steps: s.learning_steps,
                scheduled_days: s.scheduled_days,
                repetitions: s.repetitions,
                lapses: s.lapses,
                legacy_lapses: s.legacy_lapses,
                status: s.status,
                due_at: s.due_at,
                last_reviewed_at: s.last_reviewed_at,
                scheduler_version: s.scheduler_version,
                state_version: s.state_version,
              }
            : null,
          state_version: s?.state_version ?? 0,
          previews: previewFsrsRatings(fsrsCard, now),
          ready_at: nowIso,
        };
      });
      return json({ cards: out, due_count: due.length, server_time: nowIso });
    }

    if (req.method === "GET" && seg.length === 2 && seg[1] === "sprint") {
      const ids = await deckIdList(svc, ctx.user.id, url.searchParams.get("deck_id"));
      const { data, error: err } = await svc
        .from("vocab_cards")
        .select("id, deck_id, word, definition, example_sentence, part_of_speech, tags")
        .in("deck_id", ids.length > 0 ? ids : [""])
        .limit(250);
      if (err) return error(err.message, 500);
      const rows = (data ?? []) as CardRow[];
      for (let i = rows.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rows[i], rows[j]] = [rows[j], rows[i]];
      }
      return json({ cards: rows });
    }

    // ---- reviews -------------------------------------------------------------
    if (req.method === "POST" && seg.length === 2 && seg[1] === "review") {
      const body = vocabReviewSchema.parse(await req.json());
      const reviewedOn = body.reviewed_on ?? new Date().toISOString().slice(0, 10);
      let stateBefore: ReturnType<typeof snapshotFsrsCard> | null = null;
      let nextState: ReturnType<typeof snapshotFsrsCard> | null = null;
      let predictedRecall: number | null = null;
      if (body.mode === "study") {
        const { data: stateRow, error: stateErr } = await svc
          .from("vocab_card_state")
          .select("fsrs_difficulty, fsrs_stability, fsrs_state, learning_steps, scheduled_days, repetitions, lapses, due_at, last_reviewed_at, state_version")
          .eq("student_id", ctx.user.id)
          .eq("card_id", body.card_id)
          .maybeSingle();
        if (stateErr) return error("Failed to load vocabulary schedule", 500);
        const now = new Date();
        const currentCard = toFsrsCard(stateRow ? {
          due_at: stateRow.due_at,
          stability: stateRow.fsrs_stability,
          difficulty: stateRow.fsrs_difficulty,
          fsrs_state: stateRow.fsrs_state,
          learning_steps: stateRow.learning_steps,
          scheduled_days: stateRow.scheduled_days,
          repetitions: stateRow.repetitions,
          lapses: stateRow.lapses,
          last_reviewed_at: stateRow.last_reviewed_at,
        } : null, now);
        if (stateRow?.fsrs_stability && stateRow.last_reviewed_at) {
          predictedRecall = vocabScheduler.get_retrievability(currentCard, now, false);
        }
        stateBefore = snapshotFsrsCard(currentCard);
        const result = vocabScheduler.next(currentCard, now, ratingFor(body.rating));
        nextState = {
          ...snapshotFsrsCard(result.card),
          state_version: (stateRow?.state_version ?? 0) + 1,
          previews: previewFsrsRatings(result.card, now),
        } as ReturnType<typeof snapshotFsrsCard>;
      }
      const { data: result, error: reviewErr } = await svc.rpc("record_student_vocab_review_fsrs", {
        p_student_id: ctx.user.id,
        p_card_id: body.card_id,
        p_rating: body.rating,
        p_mode: body.mode,
        p_response_ms: body.response_ms ?? null,
        p_reviewed_on: reviewedOn,
        p_submission_id: body.submission_id,
        p_expected_version: body.mode === "study" ? body.expected_version : null,
        p_scheduler_version: body.mode === "study" ? VOCAB_SCHEDULER_VERSION : null,
        p_state_before: stateBefore,
        p_next_state: nextState,
        p_predicted_recall: predictedRecall,
      });
      if (reviewErr) {
        if (reviewErr.code === "P0002") return error("Card not found", 404);
        if (reviewErr.code === "42501") return error("Deck not found", 403);
        if (reviewErr.code === "P0001" && reviewErr.message.includes("Vocabulary schedule changed")) {
          return error("This card was reviewed elsewhere. Reload the study session and try again.", 409);
        }
        if (reviewErr.code === "23505") return error("Review submission was already used", 409);
        console.error("Failed to record vocabulary review", reviewErr);
        return error("Failed to save vocabulary review", 500);
      }

      return json({ ok: true, next_state: result?.next_state ?? null, replayed: result?.replayed ?? false, server_time: new Date().toISOString() });
    }

    return error("Not found", 404);
  } catch (e) {
    if (e instanceof VocabImportError) return error(e.message, 422);
    if (e instanceof HttpError) return error(e.message, e.status);
    if (e instanceof SyntaxError) return error("Invalid JSON body", 400);
    if (e instanceof Error && "issues" in (e as object)) return error("Validation failed", 422, (e as unknown as { issues: unknown }).issues);
    console.error(e);
    return error("Internal error", 500);
  }
});

function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((db - da) / DAY_MS);
}
