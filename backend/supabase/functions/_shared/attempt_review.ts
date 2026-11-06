import { type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./auth.ts";

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

export async function buildAttemptReview(
  svc: SupabaseClient,
  attempt: { id: string; test_id: string; status: string },
  options: { includeExplanations?: boolean } = {},
) {
  if (attempt.status !== "graded") throw new HttpError(409, "Attempt has not been graded yet");
  const includeExplanations = options.includeExplanations ?? true;

  const { data: sections, error: sErr } = await svc
    .from("test_sections")
    .select("id, name, section_type, position")
    .eq("test_id", attempt.test_id)
    .order("position", { ascending: true });
  if (sErr) throw new HttpError(500, sErr.message);

  const secIds = (sections ?? []).map((s) => s.id);
  const { data: modules, error: mErr } = await svc
    .from("test_modules")
    .select("id, section_id, name, position")
    .in("section_id", secIds.length > 0 ? secIds : [""])
    .order("position", { ascending: true });
  if (mErr) throw new HttpError(500, mErr.message);

  const { data: attemptModules, error: tmErr } = await svc
    .from("attempt_modules")
    .select("module_id")
    .eq("attempt_id", attempt.id);
  if (tmErr) throw new HttpError(500, tmErr.message);
  const attemptedModuleIds = new Set((attemptModules ?? []).map((am) => am.module_id));

  const modRows = (modules ?? []).filter((m) => attemptedModuleIds.has(m.id));
  const modIds = modRows.map((m) => m.id);
  const { data: links, error: lErr } = await svc
    .from("test_module_questions")
    .select("module_id, question_id, position, question:questions(*, choices:question_choices(*), passage:passages(id, title, content))")
    .in("module_id", modIds.length > 0 ? modIds : [""])
    .order("position", { ascending: true });
  if (lErr) throw new HttpError(500, lErr.message);
  const linkRows = (links ?? []) as unknown as LinkRow[];

  const { data: responses, error: rErr } = await svc
    .from("attempt_responses")
    .select("question_id, selected_choice_id, typed_answer, is_correct, marked_for_review")
    .eq("attempt_id", attempt.id);
  if (rErr) throw new HttpError(500, rErr.message);
  const responseByQ = new Map((responses ?? []).map((r) => [r.question_id, r]));

  let num = 0;
  const review = [];
  for (const sec of sections ?? []) {
    for (const mod of modRows.filter((m) => m.section_id === sec.id)) {
      for (const link of linkRows.filter((l) => l.module_id === mod.id)) {
        const q = link.question;
        if (!q) continue;
        if (q.stimulus_image_path) {
          const { data } = await svc.storage.from("question-assets").createSignedUrl(q.stimulus_image_path, 60 * 60);
          q.stimulus_image_url = data?.signedUrl ?? null;
        }
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
          explanation: includeExplanations ? q.explanation : null,
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

  return review;
}
