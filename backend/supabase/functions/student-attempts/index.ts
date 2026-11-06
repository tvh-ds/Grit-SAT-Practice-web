import { requireApprovedStudent, HttpError, pathSegments } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";
import { startAttemptSchema, advanceModuleSchema, pauseAttemptSchema } from "../_shared/validation.ts";

const TEST_STRUCTURE_QUERY =
  "id, title, description, status, is_public, kind, sections:test_sections(id, test_id, name, section_type, position, modules:test_modules(id, section_id, name, time_limit_minutes, position, is_adaptive, questions:test_module_questions(id, module_id, question_id, position, points, question:questions(id, section, question_type, passage_id, prompt, domain, skill, difficulty, stimulus_image_path, visual_code, visual_format, choices:question_choices(id, label, text, position), passage:passages(id, title, content)))))";
const ASSIGNED_TEST_QUERY =
  `id, test_id, content_scope, module_ids, test:tests!test_assignments_test_id_fkey(${TEST_STRUCTURE_QUERY})`;

async function loadTestStructure(svc: ReturnType<typeof serviceClient>, testId: string) {
  const { data, error: err } = await svc
    .from("tests")
    .select(TEST_STRUCTURE_QUERY)
    .eq("id", testId)
    .maybeSingle();
  if (err) throw new HttpError(500, err.message);
  return data;
}

async function attachStimulusUrls(svc: ReturnType<typeof serviceClient>, test: Record<string, unknown> | null): Promise<void> {
  if (!test) return;
  const sections = (test.sections ?? []) as Array<{ modules?: Array<{ questions?: Array<{ question?: Record<string, unknown> }> }> }>;
  const questions: Array<{ question: Record<string, unknown>; path: string }> = [];
  const paths = new Set<string>();
  for (const section of sections) {
    for (const module of section.modules ?? []) {
      for (const link of module.questions ?? []) {
        const question = link.question;
        const path = question?.stimulus_image_path;
        if (typeof path !== "string" || !path) continue;
        questions.push({ question, path });
        paths.add(path);
      }
    }
  }
  if (paths.size === 0) return;

  const signedByPath = new Map<string, string>();
  const uniquePaths = [...paths];
  for (let i = 0; i < uniquePaths.length; i += 100) {
    const { data, error: signErr } = await svc.storage
      .from("question-assets")
      .createSignedUrls(uniquePaths.slice(i, i + 100), 60 * 60);
    if (signErr) {
      console.error("Failed to sign stimulus image URLs", signErr);
      continue;
    }
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) signedByPath.set(item.path, item.signedUrl);
    }
  }
  for (const { question, path } of questions) {
    const signedUrl = signedByPath.get(path);
    if (signedUrl) question.stimulus_image_url = signedUrl;
  }
}

interface SectionLike {
  id: string;
  section_type?: string;
  modules?: Array<{ id: string }>;
}

/**
 * Resolve which module ids a student can take for a test given their
 * assignment scope. Public tests (and missing assignments) mean the full
 * test. `custom_modules` uses the stored module_ids; section scopes map to
 * modules under that section type.
 */
function allowedModuleIds(
  test: Record<string, unknown> | null,
  assignment: { content_scope?: string | null; module_ids?: string[] | null } | null,
): Set<string> {
  const sections = (test?.sections ?? []) as Array<SectionLike>;
  const all = new Set<string>();
  for (const s of sections) for (const m of s.modules ?? []) all.add(m.id);

  const scope = assignment?.content_scope ?? "full_test";
  if (scope === "full_test" || !assignment) return all;
  if (scope === "custom_modules") {
    const explicit = new Set<string>(assignment.module_ids ?? []);
    return new Set([...explicit].filter((id) => all.has(id)));
  }
  const wanted = scope as "reading_writing" | "math";
  const allowed = new Set<string>();
  for (const s of sections) {
    if (s.section_type !== wanted) continue;
    for (const m of s.modules ?? []) allowed.add(m.id);
  }
  return allowed;
}

function filterTestToModules(test: Record<string, unknown> | null, allowed: Set<string>): void {
  if (!test) return;
  const sections = (test.sections ?? []) as Array<SectionLike>;
  for (const s of sections) {
    s.modules = (s.modules ?? []).filter((m) => allowed.has(m.id));
  }
  test.sections = sections.filter((s) => (s.modules ?? []).length > 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await requireApprovedStudent(req);
    const svc = serviceClient();
    const seg = pathSegments(req);

    if (req.method === "POST" && seg.length === 1) {
      const body = startAttemptSchema.parse(await req.json());

      // Repeat assignments: the client starts a specific assignment. The
      // test is resolved from it, and the active-attempt check is scoped to
      // that assignment — other assignments of the same test are unaffected.
      let testId = body.test_id;
      let assignmentId: string | null = null;
      let assignmentScope: { content_scope?: string | null; module_ids?: string[] | null } | null = null;
      let preloadedExistingResult: { data: { id: string } | null; error: { message: string } | null } | null = null;
      let test: Record<string, unknown> | null = null;
      if (body.assignment_id) {
        const [assignmentResult, activeAttemptResult] = await Promise.all([
          svc.from("test_assignments")
            .select(ASSIGNED_TEST_QUERY)
            .eq("id", body.assignment_id)
            .eq("student_id", ctx.user.id)
            .maybeSingle(),
          svc.from("attempts")
          .select("id")
          .eq("student_id", ctx.user.id)
          .eq("assignment_id", body.assignment_id)
          .in("status", ["in_progress", "submitted"])
            .maybeSingle(),
        ]);
        const { data: asg, error: asgErr } = assignmentResult;
        if (asgErr) return error("Unable to load test assignment", 500);
        if (!asg) return error("Assignment not found", 404);
        testId = asg.test_id;
        assignmentId = asg.id;
        assignmentScope = asg;
        test = (asg.test as unknown as Record<string, unknown> | null) ?? null;
        preloadedExistingResult = activeAttemptResult;
      } else {
        test = await loadTestStructure(svc, testId);
      }

      if (!test) return error("Test not found", 404);
      if (test.status !== "published") return error("Test is not available", 403);

      if (test.is_public !== true && !assignmentId) {
        // Legacy path for clients that do not send assignment_id: use the
        // student's (first) assignment for this test.
        const { data: assignment, error: assignmentErr } = await svc
          .from("test_assignments")
          .select("id, content_scope, module_ids")
          .eq("test_id", testId)
          .eq("student_id", ctx.user.id)
          .maybeSingle();
        if (assignmentErr) return error(assignmentErr.message, 500);
        if (!assignment) return error("You do not have access to this test", 403);
        assignmentId = assignment.id;
        assignmentScope = assignment;
      }

      const allowed = allowedModuleIds(test as Record<string, unknown>, assignmentScope);
      filterTestToModules(test as Record<string, unknown>, allowed);
      if (allowed.size === 0) return error("This assignment has no modules", 409);

      // One active attempt per assignment (public attempts: per test).
      let existingQuery = svc
        .from("attempts")
        .select("id")
        .eq("student_id", ctx.user.id)
        .in("status", ["in_progress", "submitted"]);
      existingQuery = assignmentId
        ? existingQuery.eq("assignment_id", assignmentId)
        : existingQuery.eq("test_id", testId).is("assignment_id", null);
      const [existingResult] = await Promise.all([
        preloadedExistingResult ?? existingQuery.maybeSingle(),
        attachStimulusUrls(svc, test as Record<string, unknown>),
      ]);
      const { data: existing, error: existingErr } = existingResult;
      if (existingErr) {
        console.error("Failed to check for an active student attempt", existingErr);
        return error("Unable to check active attempt", 500);
      }
      if (existing) return error("An attempt for this test already exists", 409);

      const modules = ((test.sections ?? []) as Array<{ modules?: Array<{ id: string; position: number }> }>)
        .flatMap((s) => s.modules ?? []);
      const firstModule = modules.sort((a, b) => a.position - b.position)[0];

      const { data: attempt, error: aErr } = await svc
        .from("attempts")
        .insert({
          student_id: ctx.user.id,
          test_id: testId,
          assignment_id: assignmentId,
          status: "in_progress",
          current_module_id: firstModule?.id ?? null,
          current_question_position: 1,
        })
        .select("*")
        .single();
      if (aErr) return error(aErr.message, 500);

      const startedAt = new Date().toISOString();
      const [moduleResult, assignmentResult] = await Promise.all([
        modules.length > 0
          ? svc.from("attempt_modules").insert(modules.map((m: { id: string }) => ({
              attempt_id: attempt.id,
              module_id: m.id,
              status: m.id === firstModule?.id ? "in_progress" : "not_started",
              started_at: m.id === firstModule?.id ? startedAt : null,
            })))
          : Promise.resolve({ error: null }),
        assignmentId
          ? svc.from("test_assignments").update({ status: "in_progress" }).eq("id", assignmentId)
          : Promise.resolve({ error: null }),
        svc.from("attempt_events").insert({ attempt_id: attempt.id, event_type: "attempt.started", payload: { test_id: body.test_id } }),
      ]);
      if (moduleResult.error) return error(moduleResult.error.message, 500);
      if (assignmentResult.error) return error(assignmentResult.error.message, 500);

      return json({ attempt_id: attempt.id, test }, 201);
    }

    if (req.method === "GET" && seg.length === 2 && seg[1] === "current") {
      const url = new URL(req.url);
      const attemptId = url.searchParams.get("attempt_id");
      const testId = url.searchParams.get("test_id");
      let attempt = null;
      if (attemptId) {
        const { data, error: aErr } = await svc
          .from("attempts")
          .select("*")
          .eq("id", attemptId)
          .eq("student_id", ctx.user.id)
          .in("status", ["in_progress", "submitted"])
          .maybeSingle();
        if (aErr) return error(aErr.message, 500);
        attempt = data;
      } else if (testId) {
        const { data, error: aErr } = await svc
          .from("attempts")
          .select("*")
          .eq("student_id", ctx.user.id)
          .eq("test_id", testId)
          .in("status", ["in_progress", "submitted"])
          .maybeSingle();
        if (aErr) return error(aErr.message, 500);
        attempt = data;
      } else {
        const { data, error: aErr } = await svc
          .from("attempts")
          .select("*")
          .eq("student_id", ctx.user.id)
          .eq("status", "in_progress")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (aErr) return error(aErr.message, 500);
        attempt = data;
      }
      if (!attempt) return error("No active attempt found", 404);
      const resolvedTestId = testId ?? attempt.test_id;
      if (testId && attempt.test_id !== testId) return error("No active attempt found for this test", 404);

      const [test, modulesResult, responsesResult] = await Promise.all([
        loadTestStructure(svc, resolvedTestId),
        svc.from("attempt_modules").select("*, module:test_modules(*)").eq("attempt_id", attempt.id),
        svc.from("attempt_responses")
          .select("attempt_id, question_id, module_id, selected_choice_id, typed_answer, marked_for_review, eliminated_choice_ids, highlights, annotations")
          .eq("attempt_id", attempt.id),
      ]);
      if (modulesResult.error) return error(modulesResult.error.message, 500);
      if (responsesResult.error) return error(responsesResult.error.message, 500);
      let attemptModules = modulesResult.data ?? [];
      const attemptModuleIds = new Set<string>((attemptModules ?? []).map((am) => am.module_id));
      filterTestToModules(test as Record<string, unknown>, attemptModuleIds);
      await attachStimulusUrls(svc, test as Record<string, unknown>);
      const responses = responsesResult.data;

      // A paused module has no running clock. The first session load after
      // leaving starts a new server-timed segment from its stored remainder.
      if (attempt.status === "in_progress" && attempt.current_module_id) {
        const active = attemptModules.find((am) => am.module_id === attempt.current_module_id && am.status === "in_progress");
        if (active && !active.started_at) {
          const resumeAt = new Date().toISOString();
          const { data: resumed, error: resumeErr } = await svc
            .from("attempt_modules")
            .update({ started_at: resumeAt })
            .eq("attempt_id", attempt.id)
            .eq("module_id", active.module_id)
            .eq("status", "in_progress")
            .is("started_at", null)
            .select("*, module:test_modules(*)")
            .maybeSingle();
          if (resumeErr) return error("Unable to resume the attempt timer", 500);
          if (resumed) {
            attemptModules = attemptModules.map((am) => am.module_id === resumed.module_id ? resumed : am);
          } else {
            const { data: refreshed, error: refreshErr } = await svc
              .from("attempt_modules")
              .select("*, module:test_modules(*)")
              .eq("attempt_id", attempt.id);
            if (refreshErr) return error("Unable to load the attempt timer", 500);
            attemptModules = refreshed ?? [];
          }
        }
      }

      const now = Date.now();
      const modules = (attemptModules ?? []).map((am) => {
        const remaining = (am.remaining_seconds ?? am.module.time_limit_minutes * 60) * 1000;
        let secondsLeft: number | null = null;
        if (am.started_at && am.status === "in_progress") {
          const elapsed = Math.max(0, now - new Date(am.started_at).getTime());
          secondsLeft = Math.max(0, Math.ceil((remaining - elapsed) / 1000));
        } else if (am.status === "not_started") {
          secondsLeft = am.remaining_seconds ?? Math.ceil(remaining / 1000);
        }
        return { ...am, seconds_left: secondsLeft };
      });

      return json({ attempt, test, responses: responses ?? [], modules });
    }

    if (req.method === "POST" && seg.length === 2 && seg[1] === "pause") {
      const body = pauseAttemptSchema.parse(await req.json());
      const { data, error: pauseErr } = await svc.rpc("pause_current_student_attempt", {
        p_attempt_id: body.attempt_id,
        p_student_id: ctx.user.id,
      });
      if (pauseErr) {
        console.error("Unable to pause student attempt", pauseErr);
        return error("Unable to pause this attempt", 500);
      }
      const pause = Array.isArray(data) ? data[0] : data;
      if (!pause?.ok) {
        const status = pause?.error_code === "not_found" ? 404 : 409;
        const message = pause?.error_code === "not_found"
          ? "Attempt not found"
          : "This attempt is no longer in progress";
        return error(message, status);
      }
      await svc.from("attempt_events").insert({
        attempt_id: body.attempt_id,
        event_type: "attempt.paused",
        payload: { module_id: pause.module_id, remaining_seconds: pause.seconds_left },
      });
      return json({ ok: true, module_id: pause.module_id, remaining_seconds: pause.seconds_left });
    }

    if (req.method === "POST" && seg.length === 2 && seg[1] === "advance") {
      const body = advanceModuleSchema.parse(await req.json());
      const { data: attempt, error: aErr } = await svc
        .from("attempts")
        .select("*")
        .eq("id", body.attempt_id)
        .eq("student_id", ctx.user.id)
        .maybeSingle();
      if (aErr) return error(aErr.message, 500);
      if (!attempt) return error("Attempt not found", 404);
      if (attempt.status !== "in_progress") return error("Attempt is not in progress", 409);

      const { data: targetModule, error: mErr } = await svc
        .from("test_modules")
        .select("*, section:test_sections(*)")
        .eq("id", body.module_id)
        .maybeSingle();
      if (mErr) return error(mErr.message, 500);
      if (!targetModule) return error("Module not found", 404);

      if (attempt.current_module_id) {
        const { data: activeModule, error: activeErr } = await svc
          .from("attempt_modules")
          .select("id, started_at, time_spent_seconds")
          .eq("attempt_id", attempt.id)
          .eq("module_id", attempt.current_module_id)
          .maybeSingle();
        if (activeErr) return error("Unable to load the current module timer", 500);
        const activeSeconds = activeModule?.started_at
          ? Math.max(0, Math.floor((Date.now() - new Date(activeModule.started_at).getTime()) / 1000))
          : 0;
        const { error: cErr } = await svc
          .from("attempt_modules")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            time_spent_seconds: (activeModule?.time_spent_seconds ?? 0) + activeSeconds,
            remaining_seconds: 0,
            started_at: null,
          })
          .eq("attempt_id", attempt.id)
          .eq("module_id", attempt.current_module_id);
        if (cErr) return error(cErr.message, 500);
      }

      const { error: nErr } = await svc
        .from("attempt_modules")
        .update({ status: "in_progress", started_at: new Date().toISOString() })
        .eq("attempt_id", attempt.id)
        .eq("module_id", body.module_id);
      if (nErr) return error(nErr.message, 500);

      let difficulty: string | null = null;
      if (targetModule.is_adaptive && targetModule.section.position === 1) {
        const { data: module1 } = await svc
          .from("attempt_modules")
          .select("id, module_id")
          .eq("attempt_id", attempt.id)
          .eq("status", "completed")
          .order("started_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (module1) {
          const { data: m1questions } = await svc
            .from("test_module_questions")
            .select("question_id")
            .eq("module_id", module1.module_id);
          const ids = (m1questions ?? []).map((q) => q.question_id);
          const { data: m1responses } = await svc
            .from("attempt_responses")
            .select("is_correct")
            .eq("attempt_id", attempt.id)
            .in("question_id", ids.length > 0 ? ids : [""]);
          const correct = (m1responses ?? []).filter((r) => r.is_correct).length;
          const total = (m1responses ?? []).length;
          difficulty = total > 0 && correct / total >= 0.6 ? "harder" : "easier";
        }
      }

      const { error: uErr } = await svc
        .from("attempts")
        .update({
          current_module_id: body.module_id,
          current_question_position: 1,
          module2_difficulty: difficulty ?? attempt.module2_difficulty,
        })
        .eq("id", attempt.id);
      if (uErr) return error(uErr.message, 500);

      await svc.from("attempt_events").insert({ attempt_id: attempt.id, event_type: "module.advanced", payload: { module_id: body.module_id, difficulty } });
      return json({ ok: true, module2_difficulty: difficulty });
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
