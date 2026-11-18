-- The student score endpoint now reads saved reviews directly, using the
-- authorized attempt's scopes and question IDs.
create index admin_review_annotations_scope_question_idx
  on public.admin_review_annotations (scope, question_id);

drop index public.admin_review_annotations_shared_scope_idx;
