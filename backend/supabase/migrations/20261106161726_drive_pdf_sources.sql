-- Drive originals are read-only. Supabase Storage retains final question crops.
create table public.source_documents (
  id uuid primary key default gen_random_uuid(),
  drive_file_id text not null check (drive_file_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  original_filename text not null,
  file_size bigint not null check (file_size > 0 and file_size <= 52428800),
  drive_modified_time timestamptz,
  created_at timestamptz not null default now(),
  unique (drive_file_id, sha256)
);
alter table public.source_documents enable row level security;
revoke all on public.source_documents from anon, authenticated;
grant all on public.source_documents to service_role;

alter table public.pdf_imports alter column storage_path drop not null;
alter table public.pdf_imports add column source_document_id uuid references public.source_documents(id);
alter table public.pdf_imports add column source_state text not null default 'legacy'
  check (source_state in ('legacy','verified','needs_original','released'));
alter table public.draft_questions add column source_document_id uuid references public.source_documents(id);
alter table public.draft_questions add column source_page_number integer check (source_page_number > 0);
create index draft_source_document_idx on public.draft_questions(source_document_id);
create index pdf_import_source_document_idx on public.pdf_imports(source_document_id);

-- A generated test's drafts are not published merely because approval made
-- question rows. Bank publication is separate and explicitly recorded.
create function public.draft_published_question(p_draft_id uuid) returns uuid
language sql stable security invoker set search_path=public as $$
  select q.id from public.draft_questions d join public.questions q on q.id=d.question_id
  left join public.pdf_imports p on p.id=d.pdf_import_id
  where d.id=p_draft_id and (
    exists(select 1 from public.test_module_questions l
      join public.test_modules m on m.id=l.module_id join public.test_sections s on s.id=m.section_id
      join public.tests t on t.id=s.test_id where l.question_id=q.id and t.status='published')
    or (q.status='active' and p.generated_test_id is null and (
      p.content_scope <> 'full_test' or p.text_quality->>'document_family'='question_bank'
      or p.text_quality->'bank_publication'->>'status'='published'))
  ) limit 1;
$$;
revoke all on function public.draft_published_question(uuid) from public,anon,authenticated;
grant execute on function public.draft_published_question(uuid) to service_role;

create or replace function public.published_import_cleanup_state(p_import_id uuid)
returns jsonb language sql stable set search_path=public as $$
  select jsonb_build_object(
    'eligible', exists(select 1 from public.draft_questions d where d.pdf_import_id=p_import_id
      and public.draft_published_question(d.id) is not null)
      or exists(select 1 from public.pdf_imports p join public.tests t on t.id=p.generated_test_id
        where p.id=p_import_id and t.status='published'),
    'whole_import', exists(select 1 from public.pdf_imports p join public.tests t on t.id=p.generated_test_id
      where p.id=p_import_id and t.status='published')
      or (exists(select 1 from public.draft_questions d where d.pdf_import_id=p_import_id)
        and not exists(select 1 from public.draft_questions d where d.pdf_import_id=p_import_id
          and d.status <> 'rejected' and public.draft_published_question(d.id) is null))
  );
$$;

create or replace function public.release_import_source_images(p_import_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_state jsonb; v_previous text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service role required'; end if;
  perform 1 from public.pdf_imports where id=p_import_id and status='completed' for update;
  if not found then raise exception 'completed import required'; end if;
  v_state:=public.published_import_cleanup_state(p_import_id);
  if not (v_state->>'eligible')::boolean then raise exception 'published questions required'; end if;
  if exists(select 1 from public.ai_ingestion_review_jobs where pdf_import_id=p_import_id and status in ('queued','running')) then
    raise exception 'source review is still running'; end if;
  -- Never detach the sole visible image if a legacy published question still
  -- points to a page; report that exception for an approved replacement.
  if exists(select 1 from public.draft_questions d join public.questions q on q.id=d.question_id
    where d.pdf_import_id=p_import_id and public.draft_published_question(d.id) is not null
      and public.is_import_source_image(q.stimulus_image_path)) then
    raise exception 'Published full-page image requires an approved crop replacement'; end if;
  v_previous:=coalesce(current_setting('sat.import_storage_cleanup',true),'');
  perform set_config('sat.import_storage_cleanup',p_import_id::text,true);
  update public.draft_questions d set stimulus_image_path=q.stimulus_image_path,
    stimulus_source_image_path=null,review_source_image_path=null,stimulus_crop_rect=null,
    source_document_id=null,source_page_number=null
  from public.questions q where d.pdf_import_id=p_import_id and q.id=d.question_id
    and ((v_state->>'whole_import')::boolean or public.draft_published_question(d.id) is not null);
  if (v_state->>'whole_import')::boolean then
    update public.draft_questions set stimulus_image_path=null,stimulus_source_image_path=null,
      review_source_image_path=null,source_document_id=null,source_page_number=null
      where pdf_import_id=p_import_id and status='rejected';
    update public.pdf_imports set source_document_id=null,source_state='released' where id=p_import_id;
  end if;
  perform set_config('sat.import_storage_cleanup',v_previous,true);
end; $$;

-- Source mappings are controlled by the worker, never by public REST clients.
create function public.guard_source_document_reference() returns trigger
language plpgsql set search_path=public as $$
begin
  if auth.role() is distinct from 'service_role' and (
    (tg_op='INSERT' and new.source_document_id is not null)
    or (tg_op='UPDATE' and new.source_document_id is distinct from old.source_document_id)) then
    raise exception 'service role required for PDF source references'; end if;
  return new;
end; $$;
create trigger guard_import_source before insert or update on public.pdf_imports
for each row execute function public.guard_source_document_reference();
create trigger guard_draft_source before insert or update on public.draft_questions
for each row execute function public.guard_source_document_reference();

-- Migration releases only reproducible source pages; final crops keep their
-- paths and existing review approvals. The caller verifies PDF checksums and
-- renders before invoking this service-only operation.
create function public.bind_import_drive_source(p_import_id uuid,p_source_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_previous text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service role required'; end if;
  perform 1 from public.pdf_imports where id=p_import_id for update;
  if not found then raise exception 'Import not found'; end if;
  if not exists(select 1 from public.source_documents where id=p_source_id) then raise exception 'Source not found'; end if;
  if exists(select 1 from public.ai_ingestion_review_jobs where pdf_import_id=p_import_id and status in ('queued','running')) then
    raise exception 'source review is still running'; end if;
  v_previous:=coalesce(current_setting('sat.import_storage_cleanup',true),'');
  perform set_config('sat.import_storage_cleanup',p_import_id::text,true);
  update public.draft_questions d set source_document_id=p_source_id,source_page_number=d.page_number,
    stimulus_source_image_path=null,review_source_image_path=null,
    stimulus_image_path=case when public.is_import_source_image(d.stimulus_image_path) then null else d.stimulus_image_path end,
    stimulus_crop_status=case when public.is_import_source_image(d.stimulus_image_path) then 'pending' else d.stimulus_crop_status end
    where d.pdf_import_id=p_import_id and public.draft_published_question(d.id) is null and d.page_number>0
      -- A refined draft may still belong to a former PDF directory. Do not
      -- substitute its current container PDF for that original source.
      and not exists(select 1 from unnest(array[d.stimulus_source_image_path,d.review_source_image_path]) path
        where path like 'imports/%' and split_part(path,'/',2) <> p_import_id::text);
  update public.pdf_imports set source_document_id=p_source_id,source_state='verified' where id=p_import_id;
  perform set_config('sat.import_storage_cleanup',v_previous,true);
end; $$;
revoke all on function public.bind_import_drive_source(uuid,uuid) from public,anon,authenticated;
grant execute on function public.bind_import_drive_source(uuid,uuid) to service_role;

-- Reject full pages on all new bank publications too, not only test links.
create function public.guard_final_crop() returns trigger language plpgsql set search_path=public as $$
begin
  if new.visual_code is not null and new.visual_format in ('svg','html') then return new; end if;
  if new.status='active' and public.is_import_source_image(new.stimulus_image_path) then
    raise exception 'Save a cropped final image before publication' using errcode='23514'; end if;
  if new.status='active' and exists(select 1 from public.draft_questions d
    where d.pdf_import_id=new.source_pdf_id and d.stimulus_image_path is not distinct from new.stimulus_image_path
      and d.has_visual_stimulus and (new.stimulus_image_path is null or d.stimulus_crop_source='full_page' or d.stimulus_crop_status is distinct from 'confirmed')) then
    raise exception 'Confirm a cropped final image before publication' using errcode='23514'; end if;
  return new;
end; $$;
create trigger guard_final_crop before insert or update of stimulus_image_path,status on public.questions
for each row execute function public.guard_final_crop();
