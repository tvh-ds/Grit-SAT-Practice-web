import { allProgressRows, loadAssignmentProgress, progressRowsByIds, progressUserEmails } from "../_shared/assignment_progress.ts";
import { tryCleanupPublishedTestStorage } from "../_shared/importStorageCleanup.ts";
import { requireRole, HttpError, pathSegments } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";
import { practiceAssignSchema } from "../_shared/validation.ts";
import { buildAttemptReview } from "../_shared/attempt_review.ts";
import { assertAnswerKeys } from "../_shared/answer_keys.ts";
import { classRecipients } from "../_shared/student_classes.ts";
import { deleteAssignmentBatch } from "../_shared/delete_assignment_batch.ts";

type Svc = ReturnType<typeof serviceClient>;

interface TemplateLink {
  id: string;
  module_id: string;
  question_id: string;
  position: number;
  points: number;
}

async function templateModule(svc: Svc, testId: string) {
  const { data: sections, error: sErr } = await svc
    .from("test_sections")
    .select("id, name, section_type, position")
    .eq("test_id", testId)
    .order("position");
  if (sErr) throw new HttpError(500, sErr.message);
  if (!sections || sections.length === 0) throw new HttpError(422, "Practice set has no sections");
  const { data: modules, error: mErr } = await svc
    .from("test_modules")
    .select("id, section_id, name, position, is_adaptive")
    .in("section_id", sections.map((s) => s.id))
    .order("position");
  if (mErr) throw new HttpError(500, mErr.message);
  return { sections, modules: modules ?? [] };
}

async function moduleLinks(svc: Svc, moduleId: string): Promise<TemplateLink[]> {
  const { data, error: err } = await svc
    .from("test_module_questions")
    .select("id, module_id, question_id, position, points")
    .eq("module_id", moduleId)
    .order("position");
  if (err) throw new HttpError(500, err.message);
  return (data ?? []) as TemplateLink[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await requireRole(req, "admin");
    const svc = serviceClient();
    const seg = pathSegments(req);
    const batchId = seg[1];

    if (req.method === "DELETE" && seg.length === 2) {
      return await deleteAssignmentBatch(svc, "practice", batchId, ctx.user.id);
    }

    // ---------------------------------------------------------------- list
    if (req.method === "GET" && seg.length === 1) {
      const rows = await allProgressRows<{ id: string; snapshot_test_id: string; source_test_id: string | null; assigned_at: string }>(start => svc.from("practice_assignment_batches").select("*").order("id").range(start, start + 499));
      const progress = await loadAssignmentProgress(svc, new Date());
      const sources = await progressRowsByIds<{ id: string; title: string }>(svc, "tests", "id,title", "id", rows.flatMap(b => b.source_test_id ? [b.source_test_id] : []));
      const sections = await progressRowsByIds<{ id: string; test_id: string }>(svc, "test_sections", "id,test_id", "test_id", rows.map(b => b.snapshot_test_id));
      const modules = await progressRowsByIds<{ id: string; section_id: string }>(svc, "test_modules", "id,section_id", "section_id", sections.map(s => s.id));
      const links = await progressRowsByIds<{ id: string; module_id: string }>(svc, "test_module_questions", "id,module_id", "module_id", modules.map(m => m.id));
      const sourceTitle = new Map(sources.map(s => [s.id, s.title]));
      const sectionTest = new Map(sections.map(s => [s.id, s.test_id]));
      const moduleTest = new Map(modules.map(m => [m.id, sectionTest.get(m.section_id)]));
      const qCount = new Map<string, number>();
      for (const link of links) { const testId = moduleTest.get(link.module_id); if (testId) qCount.set(testId, (qCount.get(testId) ?? 0) + 1); }
      const list = rows.map(batch => {
        const students = progress.filter(a => a.kind === "practice" && a.batch_id === batch.id);
        const scored = students.filter(a => a.accuracy != null);
        return { ...batch, source_title: sourceTitle.get(batch.source_test_id ?? "") ?? null,
          question_count: qCount.get(batch.snapshot_test_id) ?? 0,
          student_count: students.length, completed_count: students.filter(a => a.status === "completed").length,
          avg_accuracy: scored.length ? Math.round(scored.reduce((n, a) => n + a.accuracy!, 0) / scored.length * 10) / 10 : null };
      }).sort((a, b) => b.assigned_at.localeCompare(a.assigned_at));
      return json({ batches: list });
    }

    // --------------------------------------------------------------- create
    if (req.method === "POST" && seg.length === 1) {
      const raw = await req.json();
      if (!raw?.set_id || typeof raw.set_id !== "string") return error("set_id is required", 422);
      const body = practiceAssignSchema.parse({ ...raw, set_id: undefined });
      const recipients = await classRecipients(svc, body);
      const setId = raw.set_id as string;

      const { data: template, error: tErr } = await svc
        .from("tests")
        .select("id, title, description")
        .eq("id", setId)
        .eq("kind", "practice")
        .maybeSingle();
      if (tErr) return error(tErr.message, 500);
      if (!template) return error("Practice set not found", 404);

      const { sections, modules } = await templateModule(svc, template.id);
      if (modules.length === 0) return error("Practice set has no modules", 422);
      const linksByModule = new Map<string, TemplateLink[]>();
      for (const m of modules) linksByModule.set(m.id, await moduleLinks(svc, m.id));
      const totalLinks = [...linksByModule.values()].reduce((n, ls) => n + ls.length, 0);
      if (totalLinks === 0) return error("Practice set has no questions", 422);
      const uniqueQuestionIds = [...new Set([...linksByModule.values()].flatMap((ls) => ls.map((l) => l.question_id)))];
      const { data: eligible, error: eErr } = await svc
        .from("questions")
        .select("id")
        .in("id", uniqueQuestionIds)
        .not("difficulty", "is", null)
        .eq("status", "active");
      if (eErr) return error(eErr.message, 500);
      if ((eligible ?? []).length !== uniqueQuestionIds.length) {
        return error("This practice set contains questions that are not eligible for the Practice Question Bank. Remove them before assigning.", 422);
      }
      try {
        await assertAnswerKeys(svc, uniqueQuestionIds);
      } catch (e) {
        if (e instanceof HttpError) return error(e.message, e.status);
        throw e;
      }

      const assignedStudentIds = recipients.student_ids;

      // Immutable snapshot: clone structure (shared question rows; template
      // edits use copy-on-write so snapshots never change).
      const { data: snapshot, error: snapErr } = await svc
        .from("tests")
        .insert({
          title: template.title,
          description: template.description,
          status: "published",
          is_public: false,
          kind: "practice",
          created_by: ctx.user.id,
        })
        .select("id")
        .single();
      if (snapErr) return error(snapErr.message, 500);

      const sectionIdMap = new Map<string, string>();
      for (const s of sections) {
        const { data: ns, error: nsErr } = await svc
          .from("test_sections")
          .insert({ test_id: snapshot.id, name: s.name, section_type: s.section_type, position: s.position })
          .select("id")
          .single();
        if (nsErr) return error(nsErr.message, 500);
        sectionIdMap.set(s.id, ns.id);
      }
      for (const m of modules) {
        const { data: nm, error: nmErr } = await svc
          .from("test_modules")
          .insert({
            section_id: sectionIdMap.get(m.section_id)!,
            name: m.name,
            time_limit_minutes: body.timer_minutes,
            position: m.position,
            is_adaptive: false,
          })
          .select("id")
          .single();
        if (nmErr) return error(nmErr.message, 500);
        const links = linksByModule.get(m.id) ?? [];
        if (links.length > 0) {
          const { error: lErr } = await svc.from("test_module_questions").insert(
            links.map((l) => ({ module_id: nm.id, question_id: l.question_id, position: l.position, points: l.points })),
          );
          if (lErr) return error(lErr.message, 500);
        }
      }

      const { data: batch, error: batchErr } = await svc
        .from("practice_assignment_batches")
        .insert({
          source_test_id: template.id,
          class_id: recipients.class_id,
          class_name: recipients.class_name,
          snapshot_test_id: snapshot.id,
          title: template.title,
          timer_minutes: body.timer_minutes,
          assigned_by: ctx.user.id,
        })
        .select("*")
        .single();
      if (batchErr) return error(batchErr.message, 500);

      const { data: inserted, error: aErr } = await svc
        .from("test_assignments")
        .insert(
          assignedStudentIds.map((studentId) => ({
            class_id: recipients.class_id,
            class_name: recipients.class_name,
            test_id: snapshot.id,
            student_id: studentId,
            due_at: body.due_at ?? null,
            assigned_by: ctx.user.id,
            content_scope: "full_test",
            module_ids: [],
          })),
        )
        .select("id");
      if (aErr) return error(aErr.message, 500);

      await svc.from("audit_logs").insert({
        actor_id: ctx.user.id,
        action: "practice.assigned",
        entity_type: "test",
        entity_id: snapshot.id,
        details: { source_test_id: template.id, batch_id: batch.id, count: (inserted ?? []).length, timer_minutes: body.timer_minutes },
      });
      await tryCleanupPublishedTestStorage(svc, snapshot.id);
      return json({ batch: { ...batch, assigned_count: (inserted ?? []).length } }, 201);
    }

    if (!batchId) return error("Not found", 404);

    // --------------------------------------------------------------- detail
    if (req.method === "GET" && seg.length === 2) {
      const { data: batch, error: bErr } = await svc
        .from("practice_assignment_batches")
        .select("*")
        .eq("id", batchId)
        .maybeSingle();
      if (bErr) return error(bErr.message, 500);
      if (!batch) return error("Assignment not found", 404);

      const assignments = await allProgressRows<{ id: string; student_id: string; status: string; assigned_at: string; due_at: string | null }>(start => svc.from("test_assignments").select("id,student_id,status,assigned_at,due_at").eq("test_id", batch.snapshot_test_id).order("id").range(start, start + 499));
      const studentIds = assignments.map(a => a.student_id);
      const [profiles, emails] = await Promise.all([
        progressRowsByIds<{ id: string; profiles: { full_name?: string } | null }>(svc, "student_profiles", "id,profiles:profiles!student_profiles_id_fkey(full_name)", "id", studentIds),
        progressUserEmails(svc),
      ]);
      const nameById = new Map((profiles ?? []).map((p) => {
        const profile = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
        return [p.id, profile?.full_name ?? ""];
      }));


      const assignmentIds = (assignments ?? []).map((a) => a.id);
      const attempts = await progressRowsByIds<{ id: string; assignment_id: string; status: string; started_at: string; submitted_at: string | null }>(svc, "attempts", "id,assignment_id,status,started_at,submitted_at", "assignment_id", assignmentIds);
      // Latest attempt per assignment (a student may retake the same batch).
      const latestByAssignment = new Map<string, { id: string; assignment_id: string; status: string; started_at: string; submitted_at: string | null }>();
      for (const a of (attempts ?? []).sort((x, y) => (x.started_at < y.started_at ? -1 : 1))) {
        latestByAssignment.set(a.assignment_id, a);
      }
      const latestGradedByAssignment = new Map<string, { id: string; assignment_id: string; status: string; started_at: string; submitted_at: string | null }>();
      for (const a of (attempts ?? []).filter((x) => x.status === "graded").sort((x, y) => (x.started_at < y.started_at ? -1 : 1))) {
        latestGradedByAssignment.set(a.assignment_id, a);
      }
      const latestIds = [...latestByAssignment.values()].map((a) => a.id);
      const scores = await progressRowsByIds<{ attempt_id: string; raw_score: number; total_questions: number }>(svc, "scores", "attempt_id,raw_score,total_questions", "attempt_id", latestIds, "attempt_id");
      const scoreByAttempt = new Map((scores ?? []).map((s) => [s.attempt_id, s]));

      const students = (assignments ?? []).map((a) => {
        const att = latestByAssignment.get(a.id);
        const sc = att ? scoreByAttempt.get(att.id) : undefined;
        const total = sc ? Number(sc.total_questions) : 0;
        const raw = sc ? Number(sc.raw_score) : 0;
        return {
          assignment_id: a.id,
          student_id: a.student_id,
          full_name: nameById.get(a.student_id) ?? "",
          email: emails.get(a.student_id) ?? null,
          status: att ? att.status : (a.status === "completed" ? "completed" : "not_started"),
          started_at: att?.started_at ?? null,
          submitted_at: att?.submitted_at ?? null,
          raw_score: sc ? raw : null,
          total_questions: sc ? total : null,
          accuracy: sc && total > 0 ? Math.round((raw / total) * 1000) / 10 : null,
          review_attempt_id: latestGradedByAssignment.get(a.id)?.id ?? null,
        };
      });

      // Question analytics over the immutable snapshot.
      const { sections, modules } = await templateModule(svc, batch.snapshot_test_id);
      void sections;
      const gradedIds = [...latestByAssignment.values()].filter((a) => a.status === "graded").map((a) => a.id);
      const responses = await progressRowsByIds<{ attempt_id: string; question_id: string; selected_choice_id: string | null; typed_answer: string | null; is_correct: boolean | null }>(svc, "attempt_responses", "attempt_id,question_id,selected_choice_id,typed_answer,is_correct", "attempt_id", gradedIds, ["attempt_id", "question_id"]);

      const questions = [];
      for (const m of modules) {
        const { data: links, error: lErr } = await svc
          .from("test_module_questions")
          .select("id, position, question:questions(id, prompt, question_type, correct_answer, stimulus_image_path, visual_code, visual_format, passage:passages(id, title, content), choices:question_choices(id, label, text, is_correct, position))")
          .eq("module_id", m.id)
          .order("position");
        if (lErr) return error(lErr.message, 500);
        for (const l of links ?? []) {
          const q = l.question as unknown as {
            id: string; prompt: string; question_type: string; correct_answer: string | null; stimulus_image_path: string | null; visual_code: string | null; visual_format: string | null;
            passage: { id: string; title: string | null; content: string } | null;
            choices: Array<{ id: string; label: string; text: string; is_correct: boolean; position: number }>;
          } | null;
          if (!q) continue;
          const image = q.stimulus_image_path
            ? await svc.storage.from("question-assets").createSignedUrl(q.stimulus_image_path, 60 * 60)
            : null;
          const resp = (responses ?? []).filter((r) => r.question_id === q.id);
          const answered = new Set(resp.map((r) => r.attempt_id));
          const correct = resp.filter((r) => r.is_correct === true).length;
          const incorrect = resp.filter((r) => r.is_correct === false).length;
          const unanswered = gradedIds.length - answered.size;
          const choiceCounts = (q.choices ?? [])
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((c) => ({ ...c, selected_count: resp.filter((r) => r.selected_choice_id === c.id).length }));
          const typed: Array<{ answer: string; count: number }> = [];
          if (q.question_type !== "multiple_choice") {
            const counts = new Map<string, number>();
            for (const r of resp) {
              const t = (r.typed_answer ?? "").trim();
              if (!t) continue;
              counts.set(t, (counts.get(t) ?? 0) + 1);
            }
            for (const [answer, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) typed.push({ answer, count });
          }
          questions.push({
            question_id: q.id,
            position: l.position,
            prompt: q.prompt,
            question_type: q.question_type,
            correct_answer: q.correct_answer,
            stimulus_image_url: image?.data?.signedUrl ?? null,
            visual_code: q.visual_code, visual_format: q.visual_format,
            passage: q.passage ?? null,
            choices: choiceCounts,
            correct_count: correct,
            incorrect_count: incorrect,
            unanswered_count: unanswered,
            completed_count: gradedIds.length,
            accuracy: gradedIds.length > 0 ? Math.round((correct / gradedIds.length) * 1000) / 10 : null,
            typed_answers: typed,
          });
        }
      }

      return json({ batch, students, questions });
    }

    // --------------------------------------------------------------- student review
    if (req.method === "GET" && seg.length === 4 && seg[2] === "attempts") {
      const attemptId = seg[3];
      const { data: batch, error: bErr } = await svc
        .from("practice_assignment_batches")
        .select("id, snapshot_test_id")
        .eq("id", batchId)
        .maybeSingle();
      if (bErr) return error(bErr.message, 500);
      if (!batch) return error("Assignment not found", 404);

      const { data: attempt, error: aErr } = await svc
        .from("attempts")
        .select("id, test_id, assignment_id, status, started_at, submitted_at, test:tests(title, kind), score:scores(*)")
        .eq("id", attemptId)
        .eq("test_id", batch.snapshot_test_id)
        .maybeSingle();
      if (aErr) return error(aErr.message, 500);
      if (!attempt) return error("Attempt not found", 404);
      if (!attempt.assignment_id) return error("Attempt is not tied to this assignment", 404);

      const { data: assignment, error: asErr } = await svc
        .from("test_assignments")
        .select("id, test_id")
        .eq("id", attempt.assignment_id)
        .eq("test_id", batch.snapshot_test_id)
        .maybeSingle();
      if (asErr) return error(asErr.message, 500);
      if (!assignment) return error("Attempt is not tied to this assignment", 404);

      const review = await buildAttemptReview(svc, attempt, { includeExplanations: true });
      return json({ attempt, review, explanations_released: true });
    }

    // --------------------------------------------------------------- release
    if (req.method === "POST" && seg.length === 3 && seg[2] === "release") {
      const { data, error: err } = await svc
        .from("practice_assignment_batches")
        .update({ explanations_released_at: new Date().toISOString() })
        .eq("id", batchId)
        .select("id, explanations_released_at")
        .maybeSingle();
      if (err) return error(err.message, 500);
      if (!data) return error("Assignment not found", 404);
      await svc.from("audit_logs").insert({
        actor_id: ctx.user.id,
        action: "practice.explanations_released",
        entity_type: "practice_assignment_batch",
        entity_id: batchId,
      });
      return json({ ok: true, explanations_released_at: data.explanations_released_at });
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
