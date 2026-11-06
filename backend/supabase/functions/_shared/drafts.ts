import { type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./auth.ts";

export interface ApproveDraftOptions {
  section?: string | null;
  question_type?: string | null;
  passage_text?: string | null;
  domain?: string | null;
  skill?: string | null;
  difficulty?: number | null;
  correct_answer?: string | null;
  explanation?: string | null;
  add_to_module_id?: string | null;
  position?: number | null;
}

/**
 * Approve a scraped draft: creates a passage (if it carries passage text),
 * inserts the internal full-test question + choices (+ correct flag), records
 * provenance, marks the draft approved and its suggested answer keys approved.
 * Imported full-test questions are archived so they do not appear in the
 * Practice Question Bank.
 */
export async function approveDraft(
  svc: SupabaseClient,
  adminId: string,
  draftId: string,
  opts: ApproveDraftOptions = {},
  policy: { allowIncomplete?: boolean } = {},
): Promise<{ question_id: string }> {
  const { data: draft, error: dErr } = await svc
    .from("draft_questions")
    .select("*, choices:draft_question_choices(*), answer_keys:draft_answer_keys(*)")
    .eq("id", draftId)
    .maybeSingle();
  if (dErr) throw new HttpError(500, dErr.message);
  if (!draft) throw new HttpError(404, "Draft not found");

  if (!policy.allowIncomplete && draft.has_visual_stimulus && !draft.visual_code && draft.stimulus_crop_status === "pending") {
    throw new HttpError(422, "Crop review required: confirm or adjust this visual draft's crop before approving");
  }

  const section = opts.section ?? draft.section;
  const questionType = opts.question_type ?? draft.question_type ?? "multiple_choice";
  if (!section) throw new HttpError(422, "Draft has no detected section; provide section");

  let passageId: string | null = null;
  const passageText = opts.passage_text ?? draft.passage_text;
  if (passageText) {
    const { data: passage, error: pErr } = await svc
      .from("passages")
      .insert({ content: passageText, source: draft.pdf_import_id, created_by: adminId })
      .select("id")
      .single();
    if (pErr) throw new HttpError(500, pErr.message);
    passageId = passage.id;
  }

  const choices = (draft.choices ?? []) as Array<{ label: string | null; text: string }>;
  if (!policy.allowIncomplete && questionType === "multiple_choice" && choices.length < 2) {
    throw new HttpError(422, "Cannot approve: draft has fewer than 2 choices");
  }

  const suggested = opts.correct_answer ?? draft.suggested_answer ?? null;
  const { data: question, error: qErr } = await svc
    .from("questions")
    .insert({
      section,
      question_type: questionType,
      passage_id: passageId,
      prompt: draft.prompt,
      domain: opts.domain ?? draft.domain ?? null,
      skill: opts.skill ?? draft.skill ?? null,
      difficulty: opts.difficulty ?? draft.difficulty ?? null,
      correct_answer: suggested,
      explanation: opts.explanation ?? draft.explanation ?? null,
      source_pdf_id: draft.pdf_import_id,
      source_page: draft.page_number,
      source_question_id: draft.source_question_id ?? null,
      stimulus_image_path: draft.stimulus_image_path ?? null,
      visual_code: draft.visual_code ?? null,
      visual_format: draft.visual_format ?? null,
      status: "archived",
      created_by: adminId,
    })
    .select("id")
    .single();
  if (qErr) throw new HttpError(500, qErr.message);

  if (choices.length > 0) {
    const { error: cErr } = await svc.from("question_choices").insert(
      choices.map((c, i) => ({
        question_id: question.id,
        label: c.label ?? String.fromCharCode(65 + i),
        text: c.text,
        is_correct: false,
        position: i + 1,
      })),
    );
    if (cErr) throw new HttpError(500, cErr.message);
  }

  if (suggested) {
    await svc.from("question_choices").update({ is_correct: true }).eq("question_id", question.id).eq("label", suggested.trim().toUpperCase());
  }

  await svc
    .from("question_sources")
    .insert({ question_id: question.id, pdf_import_id: draft.pdf_import_id, page_number: draft.page_number, raw_text: draft.prompt });

  if (opts.add_to_module_id && opts.position) {
    const { error: linkErr } = await svc.from("test_module_questions").insert({
      module_id: opts.add_to_module_id,
      question_id: question.id,
      position: opts.position,
    });
    if (linkErr) {
      await svc.from("questions").delete().eq("id", question.id);
      if (passageId) await svc.from("passages").delete().eq("id", passageId);
      throw new HttpError(500, `Question was created but could not be added to its test module: ${linkErr.message}`);
    }
  }

  await svc.from("draft_questions").update({ status: "approved", question_id: question.id }).eq("id", draftId);
  await svc.from("draft_answer_keys").update({ status: "approved" }).eq("draft_question_id", draftId).eq("status", "suggested");
  await svc.from("audit_logs").insert({
    actor_id: adminId,
    action: "draft_question.approved",
    entity_type: "draft_question",
    entity_id: draftId,
    details: { question_id: question.id, section, question_type: questionType },
  });

  return { question_id: question.id };
}
