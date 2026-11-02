import { requireRole, HttpError, pathSegments } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";
import {
  questionCreateSchema,
  questionUpdateSchema,
  passageSchema,
} from "../_shared/validation.ts";

async function signStimulus(svc: ReturnType<typeof serviceClient>, question: {
  stimulus_image_path?: string | null;
  stimulus_image_url?: string | null;
}) {
  question.stimulus_image_url = null;
  if (question.stimulus_image_path) {
    const { data } = await svc.storage
      .from("question-assets")
      .createSignedUrl(question.stimulus_image_path, 60 * 60);
    question.stimulus_image_url = data?.signedUrl ?? null;
  }
  return question;
}

async function withStimulus(svc: ReturnType<typeof serviceClient>, questions: Array<Record<string, unknown>>) {
  const paths = [...new Set(questions.flatMap(q => typeof q.stimulus_image_path === "string" && q.stimulus_image_path ? [q.stimulus_image_path] : []))];
  const signed = new Map<string, string>();
  // One storage request per bounded batch instead of one per question.
  for (let i = 0; i < paths.length; i += 100) {
    const { data } = await svc.storage.from("question-assets").createSignedUrls(paths.slice(i, i + 100), 60 * 60);
    for (const item of data ?? []) if (item.path && item.signedUrl) signed.set(item.path, item.signedUrl);
  }
  return questions.map(q => ({ ...q, stimulus_image_url: signed.get(String(q.stimulus_image_path ?? "")) ?? null }));
}

async function fetchQuestion(svc: ReturnType<typeof serviceClient>, id: string) {
  const { data, error } = await svc
    .from("questions")
    .select("*, choices:question_choices(*), passage:passages(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) return { data, error };
  if (data) await signStimulus(svc, data);
  return { data, error };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await requireRole(req, "admin");
    const svc = serviceClient();
    const seg = pathSegments(req);
    const id = seg[1];

    if (req.method === "GET" && seg.length === 1) {
      const url = new URL(req.url);
      const section = url.searchParams.get("section");
      const domain = url.searchParams.get("domain");
      const skill = url.searchParams.get("skill");
      const difficulty = url.searchParams.get("difficulty");
      const status = url.searchParams.get("status") ?? "active";
      const search = url.searchParams.get("search");
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 500);
      const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

      const applyFilters = (q: { eq: (c: string, v: unknown) => unknown; not: (c: string, op: string, v: unknown) => unknown; ilike: (c: string, v: string) => unknown }) => {
        if (section) q.eq("section", section);
        if (domain) q.eq("domain", domain);
        if (skill) q.eq("skill", skill);
        if (difficulty) q.eq("difficulty", Number(difficulty));
        q.eq("status", status);
        q.not("difficulty", "is", null);
        if (search) q.ilike("prompt", `%${search}%`);
      };

      const countQ = svc.from("questions").select("id", { count: "exact", head: true });
      applyFilters(countQ);

      const dataQ = svc
        .from("questions")
        .select("*, choices:question_choices(*), passage:passages(*)");
      applyFilters(dataQ);
      dataQ.order("created_at", { ascending: false });
      dataQ.range(offset, offset + limit - 1);

      const [{ count, error: countErr }, { data, error: err }] = await Promise.all([countQ, dataQ]);
      if (countErr) return error(countErr.message, 500);
      if (err) return error(err.message, 500);

      const questions = await withStimulus(svc, data ?? []);
      return json({
        questions,
        question_total: count ?? 0,
        question_limit: limit,
        question_offset: offset,
        question_has_more: offset + (data?.length ?? 0) < (count ?? 0),
      });
    }

    if (req.method === "GET" && seg.length === 2) {
      const { data, error: err } = await fetchQuestion(svc, id);
      if (err) return error(err.message, 500);
      if (!data) return error("Question not found", 404);
      return json({ question: data });
    }

    if (req.method === "POST" && seg.length === 1) {
      const body = questionCreateSchema.parse(await req.json());
      if (body.question_type === "multiple_choice" && body.choices.length < 2) {
        return error("Multiple choice questions need at least 2 choices", 422);
      }
      if (body.question_type === "student_produced" && body.choices.length > 0) {
        return error("Student-produced questions cannot have choices", 422);
      }
      const status = body.status ?? "active";
      const { data, error: err } = await svc
        .from("questions")
        .insert({
          section: body.section,
          question_type: body.question_type,
          passage_id: body.passage_id ?? null,
          prompt: body.prompt,
          domain: body.domain ?? null,
          skill: body.skill ?? null,
          difficulty: body.difficulty ?? (status === "active" ? 3 : null),
          correct_answer: body.correct_answer ?? null,
          explanation: body.explanation ?? null,
          source_question_id: body.source_question_id ?? null,
          stimulus_image_path: body.stimulus_image_path ?? null,
          status,
          created_by: ctx.user.id,
        })
        .select("id")
        .single();
      if (err) return error(err.message, 500);
      if (body.choices.length > 0) {
        const { error: cErr } = await svc.from("question_choices").insert(
          body.choices.map((c) => ({ question_id: data.id, ...c })),
        );
        if (cErr) return error(cErr.message, 500);
      }
      await svc.from("audit_logs").insert({
        actor_id: ctx.user.id,
        action: "question.created",
        entity_type: "question",
        entity_id: data.id,
        details: { section: body.section, question_type: body.question_type },
      });
      const { data: full } = await fetchQuestion(svc, data.id);
      return json({ question: full }, 201);
    }

    if (req.method === "PATCH" && seg.length === 2) {
      const body = questionUpdateSchema.parse(await req.json());
      const { data: existing, error: existingErr } = await fetchQuestion(svc, id);
      if (existingErr) return error(existingErr.message, 500);
      if (!existing) return error("Question not found", 404);

      const questionType = body.question_type ?? existing.question_type;
      const answer = body.correct_answer === undefined ? existing.correct_answer : body.correct_answer;
      const correctAnswer = questionType === "multiple_choice" ? answer?.trim().toUpperCase() || null : answer;
      const effectiveChoices = body.choices ?? existing.choices;
      // Validate the complete resulting question before making any writes. An
      // empty choices array is the normal payload for student-produced answers.
      if (questionType === "multiple_choice") {
        if (effectiveChoices.length < 2) return error("Multiple choice questions need at least 2 choices", 422);
        const labels = effectiveChoices.map((c: { label: string }) => c.label.trim().toUpperCase());
        if (new Set(labels).size !== labels.length) return error("Choice labels must be unique", 422);
        if (correctAnswer && !labels.includes(correctAnswer)) return error("Correct answer must match one of the choice labels", 422);
      } else if (body.choices && body.choices.length > 0) {
        return error("Student-produced questions cannot have choices", 422);
      }

      const { choices, ...rest } = body;
      const { error: err } = await svc
        .from("questions")
        .update({ ...rest, correct_answer: correctAnswer })
        .eq("id", id)
        .select("id")
        .single();
      if (err) return error(err.message, 500);
      if (choices !== undefined || questionType === "student_produced") {
        if (questionType === "multiple_choice" && choices) {
          // A normal answer/text edit must retain choice IDs referenced by
          // student responses. Only replace rows when their structure changes.
          const sameStructure = choices.length === existing.choices.length && choices.every((c) =>
            existing.choices.some((old: { label: string; position: number }) => old.label === c.label.trim().toUpperCase() && old.position === c.position)
          );
          const rows = choices.map((c) => ({
            ...c,
            ...(sameStructure ? { id: existing.choices.find((old: { label: string }) => old.label === c.label.trim().toUpperCase()).id } : {}),
            question_id: id,
            label: c.label.trim().toUpperCase(),
            is_correct: c.label.trim().toUpperCase() === correctAnswer,
          }));
          if (!sameStructure) {
            const { error: dErr } = await svc.from("question_choices").delete().eq("question_id", id);
            if (dErr) return error(dErr.message, 500);
          }
          const { error: iErr } = sameStructure
            ? await svc.from("question_choices").upsert(rows)
            : await svc.from("question_choices").insert(rows);
          if (iErr) return error(iErr.message, 500);
        } else {
          const { error: dErr } = await svc.from("question_choices").delete().eq("question_id", id);
          if (dErr) return error(dErr.message, 500);
        }
      } else if (body.correct_answer !== undefined) {
        // Answer-only PATCH requests must also update the flags used by previews
        // and grading, while retaining the existing choice IDs.
        const { error: clearErr } = await svc.from("question_choices").update({ is_correct: false }).eq("question_id", id);
        if (clearErr) return error(clearErr.message, 500);
        if (correctAnswer) {
          const correctChoice = existing.choices.find((c: { label: string }) => c.label.trim().toUpperCase() === correctAnswer);
          const { error: keyErr } = await svc.from("question_choices").update({ is_correct: true }).eq("question_id", id).eq("id", correctChoice.id);
          if (keyErr) return error(keyErr.message, 500);
        }
      }
      await svc.from("audit_logs").insert({
        actor_id: ctx.user.id,
        action: "question.updated",
        entity_type: "question",
        entity_id: id,
        details: { fields: Object.keys(body) },
      });
      const { data: full } = await fetchQuestion(svc, id);
      return json({ question: full });
    }

    if (req.method === "DELETE" && seg.length === 2) {
      const { data: linked } = await svc
        .from("test_module_questions")
        .select("id")
        .eq("question_id", id)
        .limit(1);
      if ((linked ?? []).length > 0) {
        const { error: aErr } = await svc.from("questions").update({ status: "archived" }).eq("id", id);
        if (aErr) return error(aErr.message, 500);
      } else {
        const { error: dErr } = await svc.from("questions").delete().eq("id", id);
        if (dErr) return error(dErr.message, 500);
      }
      await svc.from("audit_logs").insert({
        actor_id: ctx.user.id,
        action: "question.deleted",
        entity_type: "question",
        entity_id: id,
      });
      return json({ ok: true });
    }

    if (req.method === "POST" && seg.length === 3 && seg[2] === "passage") {
      const body = passageSchema.parse(await req.json());
      const { data, error: err } = await svc
        .from("passages")
        .insert({ ...body, created_by: ctx.user.id })
        .select("id, title, content")
        .single();
      if (err) return error(err.message, 500);
      return json({ passage: data }, 201);
    }

    return error("Not found", 404);
  } catch (e) {
    if (e instanceof HttpError) return error(e.message, e.status);
    if (e instanceof SyntaxError) return error("Invalid JSON body", 400);
    if (e instanceof Error && "issues" in (e as object)) return error("Validation failed", 422, (e as unknown as { issues: unknown }).issues);
    console.error(e);
    return error("Internal error", 500);
  }
});
