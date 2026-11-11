-- Create the published snapshot, batch, roster assignments, and audit entry
-- together. Recheck the preview after locking the class for concurrent writes.
create function public.assign_class_progress_questions(
  p_class_id uuid,
  p_admin_id uuid,
  p_section text,
  p_domain text,
  p_skill text,
  p_difficulty text,
  p_count integer,
  p_timer_minutes integer,
  p_plan text,
  p_title text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_class_name text;
  v_recipients uuid[];
  v_has_invalid_member boolean;
  v_question_ids uuid[];
  v_available integer;
  v_assigned integer;
  v_count integer;
  v_plan text;
  v_title text;
  v_preview jsonb;
  v_test_id uuid;
  v_section_id uuid;
  v_module_id uuid;
  v_batch_id uuid;
begin
  if not exists (select 1 from public.profiles where id = p_admin_id and role = 'admin') then
    raise sqlstate 'PT403' using message = 'Admin access required.';
  end if;
  if p_section is null or p_section not in ('math', 'reading_writing')
    or p_difficulty is null or p_difficulty not in ('easy', 'medium', 'hard')
    or coalesce(btrim(p_domain), '') = '' or coalesce(btrim(p_skill), '') = ''
    or p_count is null or p_count not between 1 and 100
    or p_timer_minutes is null or p_timer_minutes not between 1 and 600
    or char_length(p_title) > 300 then
    raise sqlstate 'PT422' using message = 'Check the skill, question count, timer, and name.';
  end if;

  if p_plan is null then
    select name into v_class_name from public.student_classes where id = p_class_id;
  else
    select name into v_class_name from public.student_classes where id = p_class_id for update;
  end if;
  if not found then
    raise sqlstate 'PT404' using message = 'Class not found.';
  end if;

  select array_agg(m.student_id order by m.student_id),
    bool_or(p.role is distinct from 'student')
  into v_recipients, v_has_invalid_member
  from public.student_class_members m
  left join public.profiles p on p.id = m.student_id
  where m.class_id = p_class_id;
  if v_recipients is null then
    raise sqlstate 'PT422' using message = 'Add students to this class before assigning work.';
  end if;
  if cardinality(v_recipients) > 1000 or v_has_invalid_member then
    raise sqlstate 'PT422' using message = 'A class assignment supports up to 1,000 valid student accounts.';
  end if;

  with scopes as (
    select distinct test_id, content_scope, module_ids
    from public.test_assignments
    where class_id = p_class_id
  ), assigned as (
    select distinct l.question_id
    from scopes a
    join public.test_sections s on s.test_id = a.test_id
    join public.test_modules m on m.section_id = s.id
    join public.test_module_questions l on l.module_id = m.id
    where (
      coalesce(a.content_scope, 'full_test') = 'full_test'
      or a.content_scope = s.section_type
      or (a.content_scope = 'custom_modules' and m.id = any(a.module_ids))
    )
  ), bank as (
    select q.id, q.created_at, q.question_type, q.correct_answer, a.question_id is not null as assigned
    from public.questions q
    left join assigned a on a.question_id = q.id
    where q.status = 'active' and q.section = p_section and q.difficulty is not null
      and coalesce(nullif(btrim(q.domain), ''), 'Unclassified domain') = p_domain
      and coalesce(nullif(btrim(q.skill), ''), 'Unclassified skill') = p_skill
      and case p_difficulty when 'easy' then q.difficulty <= 2
        when 'medium' then q.difficulty = 3 else q.difficulty >= 4 end
  ), available as (
    select b.id, b.created_at from bank b
    where not b.assigned and case when b.question_type = 'multiple_choice' then exists (
      select 1 from public.question_choices c where c.question_id = b.id and c.is_correct
    ) else coalesce(b.correct_answer, '') ~ '[^[:space:]]' end
  )
  select (select count(*) from bank where assigned),
    (select count(*) from available),
    (select array_agg(id order by created_at desc, id)
      from (select id, created_at from available order by created_at desc, id limit p_count) next_questions)
  into v_assigned, v_available, v_question_ids;

  v_count := coalesce(cardinality(v_question_ids), 0);
  v_plan := md5(jsonb_build_array(p_class_id, v_assigned, v_question_ids, v_recipients)::text);
  if v_count > 0 then
    v_title := format('%s - %s - %s-%s', left(p_skill, 260), initcap(p_difficulty), v_assigned + 1, v_assigned + v_count);
  end if;
  v_preview := jsonb_build_object('available', v_available, 'question_count', v_count, 'title', v_title,
    'plan', v_plan, 'recipient_count', cardinality(v_recipients));
  if p_plan is null then
    return v_preview;
  end if;
  if p_plan <> v_plan then
    raise sqlstate 'PT409' using message = 'The class roster or available questions changed. Review the updated assignment.';
  end if;
  if v_count = 0 then
    raise sqlstate 'PT422' using message = 'There are no unassigned questions with answer keys for this difficulty.';
  end if;
  v_title := coalesce(nullif(btrim(p_title), ''), v_title);

  insert into public.tests (title, status, is_public, kind, created_by)
    values (v_title, 'published', false, 'practice', p_admin_id) returning id into v_test_id;
  insert into public.test_sections (test_id, name, section_type, position)
    values (v_test_id, case p_section when 'math' then 'Math' else 'Reading & Writing' end, p_section, 1)
    returning id into v_section_id;
  insert into public.test_modules (section_id, name, time_limit_minutes, position)
    values (v_section_id, 'Practice', p_timer_minutes, 1) returning id into v_module_id;
  insert into public.test_module_questions (module_id, question_id, position)
    select v_module_id, question_id, position
    from unnest(v_question_ids) with ordinality as questions(question_id, position);
  insert into public.practice_assignment_batches (class_id, class_name, snapshot_test_id, title, timer_minutes, assigned_by)
    values (p_class_id, v_class_name, v_test_id, v_title, p_timer_minutes, p_admin_id) returning id into v_batch_id;
  insert into public.test_assignments (class_id, class_name, test_id, student_id, assigned_by, content_scope, module_ids)
    select p_class_id, v_class_name, v_test_id, student_id, p_admin_id, 'full_test', '{}'::uuid[]
    from unnest(v_recipients) as members(student_id);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
    values (p_admin_id, 'practice.assigned', 'test', v_test_id,
      jsonb_build_object('batch_id', v_batch_id, 'class_id', p_class_id, 'count', cardinality(v_recipients),
        'question_count', v_count, 'timer_minutes', p_timer_minutes));

  return v_preview || jsonb_build_object('title', v_title, 'batch_id', v_batch_id);
end;
$$;

revoke all on function public.assign_class_progress_questions(uuid, uuid, text, text, text, text, integer, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.assign_class_progress_questions(uuid, uuid, text, text, text, text, integer, integer, text, text)
  to service_role;
