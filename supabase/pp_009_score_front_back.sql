-- pp_009: Front 9 and Back 9 scores.
-- Additive and nullable. Older nights keep their per-basket or score_18 columns.
alter table public.pp_entries add column if not exists score_front smallint;
alter table public.pp_entries add column if not exists score_back smallint;
alter table public.pp_entries drop constraint if exists pp_entries_score_front_range;
alter table public.pp_entries add constraint pp_entries_score_front_range check (score_front is null or score_front between 0 and 50);
alter table public.pp_entries drop constraint if exists pp_entries_score_back_range;
alter table public.pp_entries add constraint pp_entries_score_back_range check (score_back is null or score_back between 0 and 50);

create or replace function public.pp_entries_sync_score_18()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.score_front is not null and new.score_back is not null then
    new.score_18 := new.score_front + new.score_back;
  elsif new.score_front is not null or new.score_back is not null
     or old.score_front is not null or old.score_back is not null then
    new.score_18 := null;
  end if;
  return new;
end;
$$;

drop trigger if exists pp_entries_sync_score_18_trigger on public.pp_entries;
create trigger pp_entries_sync_score_18_trigger
  before update on public.pp_entries
  for each row
  execute function public.pp_entries_sync_score_18();
