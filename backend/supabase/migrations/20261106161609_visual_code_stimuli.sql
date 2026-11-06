alter table public.draft_questions add column if not exists visual_code text, add column if not exists visual_format text;
alter table public.questions add column if not exists visual_code text, add column if not exists visual_format text;

alter table public.draft_questions add constraint draft_visual_code_pair check (
  (visual_code is null and visual_format is null) or
  (visual_code is not null and length(trim(visual_code)) between 1 and 250000 and visual_format is not null and visual_format in ('svg','html'))
);
alter table public.questions add constraint question_visual_code_pair check (
  (visual_code is null and visual_format is null) or
  (visual_code is not null and length(trim(visual_code)) between 1 and 250000 and visual_format is not null and visual_format in ('svg','html'))
);

-- References are removed only after code is saved. Shared objects are retained.
create or replace function public.converted_draft_visual_cleanup() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.visual_code is not null and new.visual_format in ('svg','html') then
    new.has_visual_stimulus := true;
    new.stimulus_image_path := null;
    new.stimulus_source_image_path := null;
    new.review_source_image_path := null;
    new.stimulus_crop_rect := null;
    new.stimulus_crop_source := null;
    new.stimulus_crop_status := null;
    new.review_state := 'complete';
    new.review_route := 'batch_ready';
  end if;
  return new;
end;
$$;
create trigger draft_visual_code_cleanup before insert or update on public.draft_questions
for each row execute function public.converted_draft_visual_cleanup();

-- One-deck exception. Do not change generic PDF approval or full-test generation.
-- Invoker permissions + service-role-only EXECUTE keep this off the public API.
create or replace function public.publish_collegeboard_rw_bank(p_admin_id uuid)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_import_id constant uuid := '5a255e65-742d-41e1-ba7c-ca0379257ebc';
  v_import public.pdf_imports%rowtype;
  v_draft public.draft_questions%rowtype;
  v_existing public.questions%rowtype;
  v_question_id uuid;
  v_passage_id uuid;
  v_published int := 0;
  v_total int;
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role required'; end if;
  if not exists (select 1 from public.profiles where id = p_admin_id and role = 'admin') then
    raise exception 'admin required';
  end if;

  select * into v_import from public.pdf_imports where id = v_import_id for update;
  if not found then raise exception 'College Board R&W deck not found'; end if;
  if v_import.generated_test_id is not null then raise exception 'This deck already has a generated test'; end if;
  if v_import.status <> 'completed' then raise exception 'Wait for PDF processing to finish before publishing'; end if;
  if exists (select 1 from public.ai_ingestion_review_jobs where pdf_import_id = v_import_id and status in ('queued','running')) then
    raise exception 'Wait for source review to finish before publishing';
  end if;

  -- A retry returns the saved result without duplicating questions or passages.
  if v_import.text_quality->'bank_publication'->>'status' = 'published' then
    return v_import.text_quality->'bank_publication' || jsonb_build_object('already_published', true);
  end if;
  perform 1 from public.draft_questions where pdf_import_id = v_import_id for update;
  if not found then raise exception 'This deck has no remaining drafts to publish'; end if;

  -- This legacy bank predates AI review states. Validate the actual content,
  -- official keys, and confirmed figures instead of requiring a new AI run.
  if exists (
    select 1 from public.draft_questions d
    where d.pdf_import_id = v_import_id and (
      d.section is distinct from 'reading_writing'
      or d.question_type is distinct from 'multiple_choice'
      or d.status = 'rejected'
      or nullif(btrim(d.prompt), '') is null
      or nullif(btrim(d.source_question_id), '') is null
      or upper(btrim(d.suggested_answer)) not in ('A','B','C','D')
      or nullif(btrim(d.suggested_answer), '') is null
      or (select count(*) from public.draft_question_choices c where c.draft_question_id=d.id) <> 4
      or (select count(distinct upper(btrim(c.label))) from public.draft_question_choices c
          where c.draft_question_id=d.id and upper(btrim(c.label)) in ('A','B','C','D') and nullif(btrim(c.text),'') is not null) <> 4
      or (d.has_visual_stimulus and d.visual_code is null and (
        d.stimulus_crop_status is distinct from 'confirmed'
        or not exists(select 1 from storage.objects o where o.bucket_id='question-assets' and o.name=d.stimulus_image_path)
      ))
    )
  ) then raise exception 'Every bank draft needs readable content, four choices, an official answer and a confirmed available figure'; end if;

  for v_draft in select * from public.draft_questions where pdf_import_id = v_import_id order by id loop
    v_question_id := null;
    v_passage_id := null;
    select * into v_existing from public.questions
      where id = v_draft.question_id or source_question_id = v_draft.source_question_id
      order by (id = v_draft.question_id) desc nulls last limit 1;
    if found then
      if v_existing.source_pdf_id is distinct from v_import_id or v_existing.status <> 'active'
        or v_existing.section <> 'reading_writing' then
        raise exception 'Source question % already belongs to another publication', v_draft.source_question_id;
      end if;
      v_question_id := v_existing.id;
    else
      if nullif(btrim(v_draft.passage_text), '') is not null then
        insert into public.passages(content,source,created_by)
          values (v_draft.passage_text,v_import_id::text,p_admin_id) returning id into v_passage_id;
      end if;
      insert into public.questions(section,question_type,passage_id,prompt,domain,skill,difficulty,
        correct_answer,explanation,source_pdf_id,source_page,source_question_id,stimulus_image_path,visual_code,visual_format,status,created_by)
      values ('reading_writing','multiple_choice',v_passage_id,v_draft.prompt,v_draft.domain,v_draft.skill,
        coalesce(v_draft.difficulty,3),upper(btrim(v_draft.suggested_answer)),v_draft.explanation,
        v_import_id,v_draft.page_number,v_draft.source_question_id,v_draft.stimulus_image_path,v_draft.visual_code,v_draft.visual_format,'active',p_admin_id)
      returning id into v_question_id;
      insert into public.question_choices(question_id,label,text,is_correct,position)
        select v_question_id,upper(btrim(label)),text,
          upper(btrim(label))=upper(btrim(v_draft.suggested_answer)),position
        from public.draft_question_choices where draft_question_id=v_draft.id;
      insert into public.question_sources(question_id,pdf_import_id,page_number,raw_text)
        values (v_question_id,v_import_id,v_draft.page_number,v_draft.prompt);
      v_published := v_published + 1;
    end if;
    update public.draft_questions set question_id=v_question_id,status='approved',human_review_mode='batch',
      human_reviewed_by=p_admin_id,human_reviewed_at=now() where id=v_draft.id;
  end loop;
  update public.draft_answer_keys k set status='approved' from public.draft_questions d
    where d.pdf_import_id=v_import_id and k.draft_question_id=d.id and k.status='suggested';
  select count(*) into v_total from public.questions where source_pdf_id=v_import_id and status='active';
  v_result := jsonb_build_object('status','published','published_at',now(),'question_count',v_published,'bank_total',v_total);
  update public.pdf_imports set text_quality=coalesce(text_quality,'{}'::jsonb)||jsonb_build_object('bank_publication',v_result)
    where id=v_import_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
    values (p_admin_id,'question_bank.published','pdf_import',v_import_id,v_result);
  return v_result || jsonb_build_object('already_published',false);
end; $$;

revoke all on function public.publish_collegeboard_rw_bank(uuid) from public, anon, authenticated;
grant execute on function public.publish_collegeboard_rw_bank(uuid) to service_role;

-- Edit one full-test question without mutating a question that may be shared
-- by another test or referenced by a historical student response.
create or replace function public.clone_full_test_question_for_edit(
  p_test_id uuid,
  p_link_id uuid,
  p_payload jsonb,
  p_admin_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original public.questions%rowtype;
  v_new_question_id uuid;
  v_passage_id uuid;
  v_passage_text text;
  v_correct_answer text;
  v_choice jsonb;
  v_position integer := 0;
  v_summary jsonb;
  v_total integer;
  v_keyed integer;
begin
  select q.* into v_original
  from public.test_module_questions link
  join public.test_modules module on module.id = link.module_id
  join public.test_sections section on section.id = module.section_id
  join public.tests test on test.id = section.test_id
  join public.questions q on q.id = link.question_id
  where test.id = p_test_id
    and test.kind = 'full'
    and link.id = p_link_id
  for update of link;

  if not found then
    raise exception 'Full-test question link not found';
  end if;

  v_passage_text := nullif(btrim(p_payload->>'passage_text'), '');
  if v_passage_text is not null then
    insert into public.passages(title, content, source, created_by)
    values (null, v_passage_text, 'Edited in full-length test', p_admin_id)
    returning id into v_passage_id;
  end if;

  v_correct_answer := nullif(btrim(p_payload->>'correct_answer'), '');
  insert into public.questions(
    section, question_type, passage_id, prompt, domain, skill, difficulty,
    correct_answer, explanation, status, source_pdf_id, source_page,
    stimulus_image_path, visual_code, visual_format, created_by
  ) values (
    v_original.section,
    v_original.question_type,
    v_passage_id,
    btrim(p_payload->>'prompt'),
    v_original.domain,
    v_original.skill,
    v_original.difficulty,
    v_correct_answer,
    nullif(p_payload->>'explanation', ''),
    'archived',
    v_original.source_pdf_id,
    v_original.source_page,
    nullif(p_payload->>'stimulus_image_path', ''),
    v_original.visual_code,
    v_original.visual_format,
    p_admin_id
  ) returning id into v_new_question_id;

  for v_choice in select value from jsonb_array_elements(coalesce(p_payload->'choices', '[]'::jsonb))
  loop
    v_position := v_position + 1;
    insert into public.question_choices(question_id, label, text, is_correct, position)
    values (
      v_new_question_id,
      upper(btrim(coalesce(v_choice->>'label', chr(64 + v_position)))),
      v_choice->>'text',
      upper(btrim(coalesce(v_choice->>'label', chr(64 + v_position)))) = upper(coalesce(v_correct_answer, '')),
      v_position
    );
  end loop;

  insert into public.question_sources(question_id, pdf_import_id, page_number, raw_text)
  select v_new_question_id, source.pdf_import_id, source.page_number, source.raw_text
  from public.question_sources source
  where source.question_id = v_original.id;

  update public.test_module_questions
  set question_id = v_new_question_id
  where id = p_link_id;

  select coalesce(jsonb_object_agg(module_name, jsonb_build_object(
           'questions', question_count,
           'keys', key_count,
           'status', case when key_count = 0 then 'missing'
                          when key_count >= question_count then 'complete'
                          else 'partial' end
         )), '{}'::jsonb),
         coalesce(sum(question_count), 0)::integer,
         coalesce(sum(key_count), 0)::integer
    into v_summary, v_total, v_keyed
  from (
    select module.name as module_name,
           count(link.id)::integer as question_count,
           count(question.correct_answer)::integer as key_count
    from public.test_sections section
    join public.test_modules module on module.section_id = section.id
    left join public.test_module_questions link on link.module_id = module.id
    left join public.questions question on question.id = link.question_id
    where section.test_id = p_test_id
    group by module.id, module.name, module.position
    order by module.position
  ) modules;

  update public.tests
  set answer_key_status = case when v_total = 0 or v_keyed = 0 then 'missing'
                               when v_keyed >= v_total then 'complete'
                               else 'partial' end,
      answer_key_summary = v_summary
  where id = p_test_id;

  return v_new_question_id;
end;
$$;

revoke all on function public.clone_full_test_question_for_edit(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.clone_full_test_question_for_edit(uuid, uuid, jsonb, uuid) to service_role;
