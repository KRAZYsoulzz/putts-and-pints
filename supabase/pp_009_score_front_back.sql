-- pp_009: Front 9 and Back 9 scores.
-- Additive and nullable. Older nights keep their per-basket or score_18 columns.
alter table pp_entries add column if not exists score_front smallint;
alter table pp_entries add column if not exists score_back smallint;
alter table pp_entries drop constraint if exists pp_entries_score_front_range;
alter table pp_entries add constraint pp_entries_score_front_range check (score_front is null or score_front between 0 and 50);
alter table pp_entries drop constraint if exists pp_entries_score_back_range;
alter table pp_entries add constraint pp_entries_score_back_range check (score_back is null or score_back between 0 and 50);
