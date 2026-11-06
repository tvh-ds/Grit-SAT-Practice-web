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
    if new.status = 'needs_review' then new.status := 'approved'; end if;
  end if;
  return new;
end;
$$;
update public.draft_questions set status='approved'
where visual_code is not null and visual_format in ('svg','html') and status='needs_review';
