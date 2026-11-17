alter table public.admin_review_annotations
  add column shared_at timestamptz,
  drop constraint admin_review_annotations_scope_check,
  add constraint admin_review_annotations_scope_check check (
    length(scope) <= 200 and (
      scope ~ '^admin-(practice-assignments|tests/assignment-batches)/[0-9a-f-]{36}(/attempts/[0-9a-f-]{36})?$'
      or scope ~ '^admin-students/[0-9a-f-]{36}/attempts/[0-9a-f-]{36}$'
    )
  );

-- Student reads go through the authenticated score endpoint. Direct table access
-- stays restricted to the administrator who owns the board.
create index admin_review_annotations_shared_scope_idx
  on public.admin_review_annotations (scope, question_id)
  where shared_at is not null;
