import { supabase } from "./supabase";
import { validAnnotation } from "./reviewAnnotations";
import type { ReviewAnnotation, ReviewAnnotationRow } from "./reviewAnnotations";

export async function loadAnnotations(scope: string) {
  const { data, error } = await supabase.from("admin_review_annotations")
    .select("question_id,document,content_hash,shared_at").eq("scope", scope);
  if (error) throw new Error("Could not load saved annotations. Try again.");
  return (data ?? []).filter(row => validAnnotation(row.document)) as ReviewAnnotationRow[];
}

export async function saveAnnotation(scope: string, questionId: string, contentHash: string, document: ReviewAnnotation, previous?: ReviewAnnotationRow) {
  if (!validAnnotation(document) || new TextEncoder().encode(JSON.stringify(document)).length > 900000) throw new Error("Annotation exceeds the supported size.");
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Sign in again before saving.");
  const table = supabase.from("admin_review_annotations");
  const values = { content_hash: contentHash, document, updated_at: new Date().toISOString() };
  const query = previous
    ? table.update(values).eq("owner_id", user.id).eq("scope", scope).eq("question_id", questionId).eq("content_hash", previous.content_hash)
    : table.upsert({ ...values, owner_id: user.id, scope, question_id: questionId, shared_at: null }, { onConflict: "owner_id,scope,question_id" });
  const { data, error } = await query.select("question_id,document,content_hash,shared_at").single();
  if (error) throw new Error("Could not save annotation.");
  return data as ReviewAnnotationRow;
}

export async function setAnnotationShared(scope: string, row: ReviewAnnotationRow, contentHash: string, shared: boolean) {
  const { data, error } = await supabase.from("admin_review_annotations")
    .update({ shared_at: shared ? new Date().toISOString() : null, content_hash: contentHash })
    .eq("scope", scope).eq("question_id", row.question_id).eq("content_hash", row.content_hash)
    .select("question_id,document,content_hash,shared_at").single();
  if (error) throw new Error("Could not update sharing. Reopen the review and try again.");
  return data as ReviewAnnotationRow;
}
