import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./auth.ts";

type StoredAnnotation = {
  scope: string;
  question_id: string;
  content_hash: string;
  document: unknown;
  shared_at: string | null;
  updated_at: string;
  question: {
    updated_at: string;
    passage: { updated_at: string } | null;
    choices: { updated_at: string }[];
  } | null;
};

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
    .select("scope,question_id,content_hash,document,shared_at,updated_at,question:questions(updated_at,passage:passages(updated_at),choices:question_choices(updated_at))")
    .in("scope", scopes).in("question_id", questionIds)
    .order("updated_at", { ascending: false }).order("owner_id");
  if (boardError) throw boardError;
  return ((data ?? []) as unknown as StoredAnnotation[]).map(row => {
    const question = row.question;
    const savedAt = Date.parse(row.updated_at);
    // Old assignment fingerprints included changing answer counts. Keep them
    // usable when the snapshot question and its displayed content are still current.
    const legacyContentUnchanged = row.shared_at === null && question !== null &&
      [question, ...question.choices, ...(question.passage ? [question.passage] : [])]
        .every(content => Date.parse(content.updated_at) <= savedAt);
    return {
      question_id: row.question_id,
      content_hash: row.content_hash,
      document: row.document,
      assignment_wide: row.scope === batchScope,
      legacy_content_unchanged: legacyContentUnchanged,
    };
  });
}
