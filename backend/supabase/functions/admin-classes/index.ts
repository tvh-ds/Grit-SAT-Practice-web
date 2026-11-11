import { requireRole, HttpError, pathSegments } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";
import { classProgressAssignmentSchema, studentClassSchema } from "../_shared/validation.ts";
import { allProgressRows, loadAssignmentProgress } from "../_shared/assignment_progress.ts";
import { loadClassProgress } from "../_shared/class_progress.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await requireRole(req, "admin");
    const svc = serviceClient(), seg = pathSegments(req), id = seg[1];
    if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return error("Invalid class ID", 422);
    if (req.method === "GET" && seg.length === 1) {
      const classes = await allProgressRows<{ id: string; name: string; created_at: string }>(start => svc.from("student_classes").select("id,name,created_at").order("id").range(start, start + 499));
      const members = await allProgressRows<{ class_id: string; student_id: string }>(start => svc.from("student_class_members").select("class_id,student_id").order("class_id").order("student_id").range(start, start + 499));
      return json({ classes: classes.map(cls => ({ ...cls, student_ids: members.filter(m => m.class_id === cls.id).map(m => m.student_id) })).sort((a, b) => a.name.localeCompare(b.name)) });
    }
    const progressRequested = seg.length === 3 && seg[2] === "progress";
    if (req.method === "POST" && progressRequested) {
      const parsed = classProgressAssignmentSchema.safeParse(await req.json());
      if (!parsed.success) return error("Check the skill, question count, timer, and name.", 422);
      const body = parsed.data;
      const { data, error: assignmentError } = await svc.rpc("assign_class_progress_questions", {
        p_class_id: id,
        p_admin_id: ctx.user.id,
        p_section: body.section,
        p_domain: body.domain,
        p_skill: body.skill,
        p_difficulty: body.difficulty,
        p_count: body.count,
        p_timer_minutes: body.timer_minutes,
        p_plan: body.plan ?? null,
        p_title: body.title ?? null,
      });
      if (assignmentError) {
        if (/^PT(?:403|404|409|422)$/.test(assignmentError.code)) {
          return error(assignmentError.message, Number(assignmentError.code.slice(2)));
        }
        console.error("assign_class_progress_questions", assignmentError);
        return error("Unable to prepare or save this assignment.", 500);
      }
      return json(data, body.plan ? 201 : 200);
    }
    if (req.method === "GET" && (seg.length === 2 || progressRequested)) {
      const { data: cls, error: clsError } = await svc.from("student_classes").select("id,name").eq("id", id).maybeSingle();
      if (clsError) return error("Unable to load class", 500);
      if (!cls) return error("Class not found", 404);
      if (progressRequested) return json({ skills: await loadClassProgress(svc, id) });
      const [practice, full, progress] = await Promise.all([
        allProgressRows<{ id: string; title: string; assigned_at: string; timer_minutes: number }>(start => svc.from("practice_assignment_batches").select("id,title,assigned_at,class_name,timer_minutes,snapshot_test_id").eq("class_id", id).order("id").range(start, start + 499)),
        allProgressRows<{ id: string; title: string; assigned_at: string }>(start => svc.from("full_test_assignment_batches").select("id,title,assigned_at,class_name,content_scope").eq("class_id", id).order("id").range(start, start + 499)),
        loadAssignmentProgress(svc, new Date()),
      ]);
      const counts = (batchId: string) => {
        const rows = progress.filter(a => a.batch_id === batchId);
        const scored = rows.filter(a => a.accuracy != null);
        return { student_count: rows.length, completed_count: rows.filter(a => a.status === "completed").length,
          avg_accuracy: scored.length ? Math.round(scored.reduce((n, a) => n + a.accuracy!, 0) / scored.length * 10) / 10 : null };
      };
      return json({ class: cls, assignments: [
        ...practice.map((a) => ({ ...a, ...counts(a.id), kind: "practice" })),
        ...full.map((a) => ({ ...a, ...counts(a.id), kind: "full" })),
      ].sort((a, b) => b.assigned_at.localeCompare(a.assigned_at)) });
    }
    if ((req.method === "POST" && seg.length === 1) || (req.method === "PUT" && seg.length === 2)) {
      const body = studentClassSchema.parse(await req.json());
      const { data, error: saveError } = await svc.rpc("save_student_class", { p_id: id ?? null, p_name: body.name, p_student_ids: body.student_ids, p_admin_id: ctx.user.id });
      if (saveError) return error(saveError.code === "23505" ? "A class with this name already exists." : "Unable to save class. Check the name and student selection.", 422);
      await svc.from("audit_logs").insert({ actor_id: ctx.user.id, action: id ? "class.updated" : "class.created", entity_type: "student_class", entity_id: data, details: { member_count: new Set(body.student_ids).size } });
      return json({ id: data }, id ? 200 : 201);
    }
    return error("Not found", 404);
  } catch (e) {
    if (e instanceof HttpError) return error(e.message, e.status);
    if (e && typeof e === "object" && "issues" in e) return error("Invalid class details", 422);
    console.error("admin-classes", e);
    return error("Unable to manage classes", 500);
  }
});
