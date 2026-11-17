import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./auth.ts";

export async function loadSharedReviewAnnotations(svc: SupabaseClient, studentId: string, attemptId: string) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(attemptId)) {
    throw new HttpError(404, "Attempt not found");
  }
  const { data: attempt, error } = await svc.from("attempts")
    .select("id,test_id,assignment_id").eq("id", attemptId).eq("student_id", studentId)
    .eq("status", "graded").maybeSingle();
  if (error) throw error;
  if (!attempt) throw new HttpError(404, "Attempt not found");

  const scopes = [`admin-students/${studentId}/attempts/${attempt.id}`];
  let batchScope: string | null = null;
  if (attempt.assignment_id) {
    const [assignment, practiceBatch] = await Promise.all([
      svc.from("test_assignments").select("assignment_batch_id")
        .eq("id", attempt.assignment_id).eq("test_id", attempt.test_id).eq("student_id", studentId).maybeSingle(),
      svc.from("practice_assignment_batches").select("id").eq("snapshot_test_id", attempt.test_id).maybeSingle(),
    ]);
    if (assignment.error) throw assignment.error;
    if (practiceBatch.error) throw practiceBatch.error;
    if (assignment.data?.assignment_batch_id) {
      scopes.push(`admin-tests/assignment-batches/${assignment.data.assignment_batch_id}/attempts/${attempt.id}`);
    }
    if (assignment.data && practiceBatch.data) {
      batchScope = `admin-practice-assignments/${practiceBatch.data.id}`;
      scopes.push(`${batchScope}/attempts/${attempt.id}`, batchScope);
    }
  }

  const { data: modules, error: moduleError } = await svc.from("attempt_modules")
    .select("module_id").eq("attempt_id", attempt.id);
  if (moduleError) throw moduleError;
  if (!modules?.length) return [];
  const { data: links, error: linkError } = await svc.from("test_module_questions")
    .select("question_id").in("module_id", modules.map(row => row.module_id));
  if (linkError) throw linkError;
  const questionIds = [...new Set((links ?? []).map(row => row.question_id))];
  if (!questionIds.length) return [];

  const { data, error: boardError } = await svc.from("admin_review_annotations")
    .select("scope,question_id,content_hash,document")
    .in("scope", scopes).in("question_id", questionIds).not("shared_at", "is", null)
    .order("shared_at", { ascending: false }).order("owner_id");
  if (boardError) throw boardError;
  return (data ?? []).map(({ scope, ...row }) => ({ ...row, assignment_wide: scope === batchScope }));
}
