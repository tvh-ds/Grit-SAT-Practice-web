import { HttpError, pathSegments } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";
import { requireApprovedStudent } from "../_shared/auth.ts";
import { errorLogReviewSaveSchema } from "../_shared/validation.ts";
import { loadErrorLogPage } from "../_shared/error_log.ts";
import { explanationsAvailable } from "../_shared/explanationRelease.ts";

interface ReviewChoice { id: string; label: string; text: string; is_correct: boolean; position: number }
interface ReviewQuestion {
  id: string;
  section: string;
  question_type: string;
  prompt: string;
  domain: string | null;
  skill: string | null;
  difficulty: number | null;
  explanation: string | null;
  correct_answer: string | null;
  stimulus_image_path: string | null;
  visual_code: string | null;
  visual_format: string | null;
  stimulus_image_url?: string | null;
  passage: { id: string; title: string | null; content: string } | null;
  choices: ReviewChoice[];
}
interface LinkRow {
  module_id: string;
  question_id: string;
  position: number;
  question: ReviewQuestion;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await requireApprovedStudent(req);
    const svc = serviceClient();
    const seg = pathSegments(req);

    if (req.method === "GET" && seg.length === 2 && seg[1] === "error-log") {
      return json(await loadErrorLogPage(svc, ctx.user.id, new URL(req.url)));
    }

    if (req.method === "POST" && seg.length === 3 && seg[1] === "error-log" && seg[2] === "review") {
      const body = errorLogReviewSaveSchema.parse(await req.json());
      const { data: attempt, error: attemptErr } = await svc
        .from("attempts")
        .select("id, status")
        .eq("id", body.attempt_id)
        .eq("student_id", ctx.user.id)
        .maybeSingle();
      if (attemptErr) {
        console.error("Unable to verify error log attempt ownership", attemptErr);
        return error("Unable to save this review", 500);
      }
      if (!attempt || attempt.status !== "graded") return error("Review item not found", 404);

      const { data: attemptModules, error: moduleErr } = await svc
        .from("attempt_modules")
        .select("module_id")
        .eq("attempt_id", body.attempt_id);
      if (moduleErr) {
        console.error("Unable to verify error log module ownership", moduleErr);
        return error("Unable to save this review", 500);
      }
      const moduleIds = (attemptModules ?? []).map((module) => module.module_id);
      const { count, error: questionErr } = await svc
        .from("test_module_questions")
        .select("question_id", { count: "exact", head: true })
        .eq("question_id", body.question_id)
        .in("module_id", moduleIds.length > 0 ? moduleIds : [""]);
      if (questionErr) {
        console.error("Unable to verify error log question ownership", questionErr);
        return error("Unable to save this review", 500);
      }
      if (!count) return error("Review item not found", 404);

      const { data: response, error: responseErr } = await svc
        .from("attempt_responses")
        .select("selected_choice_id, typed_answer, is_correct")
        .eq("attempt_id", body.attempt_id)
        .eq("question_id", body.question_id)
        .maybeSingle();
      if (responseErr) {
        console.error("Unable to verify error log response", responseErr);
        return error("Unable to save this review", 500);
      }
      const unanswered = !response || (
        !response.selected_choice_id && !String(response.typed_answer ?? "").trim()
      );
      if (!unanswered && response?.is_correct === true) return error("Review item not found", 404);

      const reviewedAt = body.reviewed ? new Date().toISOString() : null;
      const { data: saved, error: saveErr } = await svc
        .from("student_error_log_reviews")
        .upsert({
          student_id: ctx.user.id,
          attempt_id: body.attempt_id,
          question_id: body.question_id,
          note_text: body.note,
          reviewed_at: reviewedAt,
        }, { onConflict: "student_id,attempt_id,question_id" })
        .select("note_text, reviewed_at, updated_at")
        .single();
      if (saveErr) {
        console.error("Unable to save student error log review", saveErr);
        return error("Unable to save this review", 500);
      }
      return json({ review: saved });
    }

    if (req.method === "GET" && seg.length === 1) {
      const { data, error: err } = await svc
        .from("attempts")
        .select("id, test_id, status, started_at, submitted_at, test:tests(title, kind), score:scores(*)")
        .eq("student_id", ctx.user.id)
        .eq("status", "graded")
        .order("submitted_at", { ascending: false });
      if (err) return error(err.message, 500);
      const history = (data ?? []).map((h: Record<string, unknown>) => {
        const score = h.score as { raw_score?: number; total_questions?: number; accuracy?: number } | null;
        if (score && score.accuracy == null) {
          const raw = Number(score.raw_score ?? 0);
          const total = Number(score.total_questions ?? 0);
          return { ...h, score: { ...score, accuracy: total > 0 ? Math.round((raw / total) * 1000) / 10 : 0 } };
        }
        return h;
      });
      return json({ history });
    }

    if (req.method === "GET" && seg.length === 2) {
      const { data: attempt, error: aErr } = await svc
        .from("attempts")
        .select("id, test_id, assignment_id, status, started_at, submitted_at, test:tests(title, kind), score:scores(*)")
        .eq("id", seg[1])
        .eq("student_id", ctx.user.id)
        .maybeSingle();
      if (aErr) return error(aErr.message, 500);
      if (!attempt) return error("Attempt not found", 404);
      if (attempt.status !== "graded") return error("Attempt has not been graded yet", 409);

      // Assigned practice explanations unlock per student seven days after
      // submission, or earlier when the teacher manually releases the batch.
      let explanationsReleased = true;
      if (attempt.assignment_id) {
        const { data: asg, error: assignmentErr } = await svc
          .from("test_assignments")
          .select("test_id")
          .eq("id", attempt.assignment_id)
          .maybeSingle();
        if (assignmentErr) return error("Unable to check explanation release", 500);
        if (!asg) return error("Assignment not found", 404);
        if (asg) {
          const { data: batch, error: batchErr } = await svc
            .from("practice_assignment_batches")
            .select("explanations_released_at")
            .eq("snapshot_test_id", asg.test_id)
            .maybeSingle();
          if (batchErr) return error("Unable to check explanation release", 500);
          if (batch) explanationsReleased = explanationsAvailable(attempt.submitted_at, batch.explanations_released_at);
        }
      }

      // Full test structure so the report covers every question (incl. unanswered)
      const { data: sections, error: sErr } = await svc
        .from("test_sections")
        .select("id, name, section_type, position")
        .eq("test_id", attempt.test_id)
        .order("position", { ascending: true });
      if (sErr) return error(sErr.message, 500);

      const secIds = (sections ?? []).map((s) => s.id);
      const { data: modules, error: mErr } = await svc
        .from("test_modules")
        .select("id, section_id, name, position")
        .in("section_id", secIds.length > 0 ? secIds : [""])
        .order("position", { ascending: true });
      if (mErr) return error(mErr.message, 500);

      // Only score/show the modules this student was actually assigned
      const { data: attemptModules, error: tmErr } = await svc
        .from("attempt_modules")
        .select("module_id")
        .eq("attempt_id", attempt.id);
      if (tmErr) return error(tmErr.message, 500);
      const attemptedModuleIds = new Set((attemptModules ?? []).map((am) => am.module_id));

      const modRows = (modules ?? []).filter((m) => attemptedModuleIds.has(m.id));
      const modIds = modRows.map((m) => m.id);
      const [linksResult, responsesResult] = await Promise.all([
        svc.from("test_module_questions")
          .select("module_id, question_id, position, question:questions(*, choices:question_choices(*), passage:passages(id, title, content))")
          .in("module_id", modIds.length > 0 ? modIds : [""])
          .order("position", { ascending: true }),
        svc.from("attempt_responses")
          .select("question_id, selected_choice_id, typed_answer, is_correct, marked_for_review")
          .eq("attempt_id", attempt.id),
      ]);
      if (linksResult.error) return error(linksResult.error.message, 500);
      if (responsesResult.error) return error(responsesResult.error.message, 500);
      const linkRows = (linksResult.data ?? []) as unknown as LinkRow[];
      const responses = responsesResult.data;

      const responseByQ = new Map((responses ?? []).map((r) => [r.question_id, r]));

      const imagePaths = [...new Set(linkRows
        .map((link) => link.question?.stimulus_image_path)
        .filter((path): path is string => Boolean(path)))];
      const signedByPath = new Map<string, string>();
      for (let i = 0; i < imagePaths.length; i += 100) {
        const { data, error: signErr } = await svc.storage
          .from("question-assets")
          .createSignedUrls(imagePaths.slice(i, i + 100), 60 * 60);
        if (signErr) {
          console.error("Failed to sign score-review stimulus images", signErr);
          continue;
        }
        for (const item of data ?? []) {
          if (item.path && item.signedUrl) signedByPath.set(item.path, item.signedUrl);
        }
      }
      for (const link of linkRows) {
        const path = link.question?.stimulus_image_path;
        link.question.stimulus_image_url = path ? signedByPath.get(path) ?? null : null;
      }

      let num = 0;
      const review = [];
      for (const sec of sections ?? []) {
        for (const mod of modRows.filter((m) => m.section_id === sec.id)) {
          for (const link of linkRows.filter((l) => l.module_id === mod.id)) {
            const q = link.question;
            if (!q) continue;
            num++;
            const r = responseByQ.get(q.id);
            const selected = r?.selected_choice_id
              ? (q.choices ?? []).find((c) => c.id === r.selected_choice_id)
              : undefined;
            const correctChoices = (q.choices ?? []).filter((c) => c.is_correct);
            review.push({
              question_id: q.id,
              question_number: num,
              section: q.section,
              section_name: sec.name,
              section_type: sec.section_type,
              module_name: mod.name,
              prompt: q.prompt,
              question_type: q.question_type,
              domain: q.domain,
              skill: q.skill,
              difficulty: q.difficulty,
              explanation: explanationsReleased ? q.explanation : null,
              correct_answer: q.correct_answer,
              stimulus_image_path: q.stimulus_image_path,
              stimulus_image_url: q.stimulus_image_url ?? null,
          visual_code: q.visual_code ?? null,
          visual_format: q.visual_format ?? null,
              passage: q.passage ?? null,
              choices: (q.choices ?? [])
                .slice()
                .sort((a, b) => a.position - b.position)
                .map((c) => ({ id: c.id, label: c.label, text: c.text, is_correct: c.is_correct })),
              selected_choice_id: r?.selected_choice_id ?? null,
              typed_answer: r?.typed_answer ?? null,
              your_answer: selected ? `${selected.label}. ${selected.text}` : r?.typed_answer ?? null,
              correct_answers: correctChoices.map((c) => ({ label: c.label, text: c.text })),
              is_correct: r?.is_correct ?? null,
              unanswered: !r,
              marked_for_review: r?.marked_for_review ?? false,
            });
          }
        }
      }

      return json({ attempt, review, explanations_released: explanationsReleased });
    }

    return error("Not found", 404);
  } catch (e) {
    if (e instanceof HttpError) return error(e.message, e.status);
    console.error(e);
    return error("Internal error", 500);
  }
});
