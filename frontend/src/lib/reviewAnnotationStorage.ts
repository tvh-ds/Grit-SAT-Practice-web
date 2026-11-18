import { supabase } from "./supabase";
import { validAnnotation } from "./reviewAnnotations";
import type { ReviewAnnotation, ReviewAnnotationRow } from "./reviewAnnotations";

type StoredAnnotation = ReviewAnnotationRow & {
  updated_at: string;
  question: {
    updated_at: string;
    passage: { updated_at: string } | null;
    choices: { updated_at: string }[];
  } | null;
};

export async function loadAnnotations(scope: string) {
  const { data, error } = await supabase.from("admin_review_annotations")
    .select("question_id,document,content_hash,shared_at,updated_at,question:questions(updated_at,passage:passages(updated_at),choices:question_choices(updated_at))")
    .eq("scope", scope);
  if (error) throw new Error("Could not load saved annotations. Try again.");
  return ((data ?? []) as unknown as StoredAnnotation[]).filter(row => validAnnotation(row.document))
    .map(({ updated_at, question, ...row }) => ({
      ...row,
      legacy_content_unchanged: row.shared_at === null && question !== null &&
        [question, ...question.choices, ...(question.passage ? [question.passage] : [])]
          .every(content => Date.parse(content.updated_at) <= Date.parse(updated_at)),
    }));
}

export async function saveAnnotation(scope: string, questionId: string, contentHash: string, document: ReviewAnnotation, previous?: ReviewAnnotationRow) {
  if (!validAnnotation(document) || new TextEncoder().encode(JSON.stringify(document)).length > 900000) throw new Error("Annotation exceeds the supported size.");
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Sign in again before saving.");
  const table = supabase.from("admin_review_annotations");
  const now = new Date().toISOString();
  const values = { content_hash: contentHash, document, updated_at: now, shared_at: now };
  const query = previous
    ? table.update(values).eq("owner_id", user.id).eq("scope", scope).eq("question_id", questionId).eq("content_hash", previous.content_hash)
    : table.upsert({ ...values, owner_id: user.id, scope, question_id: questionId }, { onConflict: "owner_id,scope,question_id" });
  const { data, error } = await query.select("question_id,document,content_hash,shared_at").single();
  if (error) throw new Error("Could not save annotation.");
  return data as ReviewAnnotationRow;
}
