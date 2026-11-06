export interface ApprovalDraft {
  question_type?: string | null;
  choices?: unknown[] | null;
  review_state?: string | null;
  status?: string | null;
  suggested_answer?: string | null;
  has_visual_stimulus?: boolean | null;
  stimulus_crop_status?: string | null;
  visual_code?: string | null;
}

/** Quality checks are advisory; authorization and processing locks are separate. */
export function importApprovalWarnings(drafts: ApprovalDraft[], deterministicStatus: string | null, countError: string | null): string[] {
  const warnings: string[] = [];
  if (deterministicStatus !== "passed") warnings.push("Structural review has not passed.");
  if (!drafts.length) warnings.push("No questions have been imported yet.");
  const checks: Array<[number, string]> = [
    [drafts.filter((d) => d.question_type === "multiple_choice" && (d.choices?.length ?? 0) < 2).length, "multiple-choice question(s) have fewer than two choices"],
    [drafts.filter((d) => !d.visual_code && d.review_state !== "complete").length, "question(s) are not Complete"],
    [drafts.filter((d) => !d.suggested_answer?.trim()).length, "question(s) have no usable answer"],
    [drafts.filter((d) => d.has_visual_stimulus && !d.visual_code && d.stimulus_crop_status !== "confirmed").length, "visual question(s) have unconfirmed crops"],
    [drafts.filter((d) => d.status === "rejected").length, "rejected question(s) will be included in this import"],
  ];
  for (const [count, message] of checks) if (count) warnings.push(`${count} ${message}.`);
  if (countError) warnings.push(countError);
  return warnings;
}
