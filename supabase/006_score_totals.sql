-- pp_006: scorers enter two totals (18 holes, Final 9) instead of per-basket scores.
-- Additive and nullable. Older nights keep their per-basket columns and still total correctly.
-- Not run yet: run this in the Supabase SQL editor BEFORE the app that uses it goes live.
alter table pp_entries add column if not exists score_18 smallint;
alter table pp_entries add column if not exists score_final smallint;
alter table pp_entries drop constraint if exists pp_entries_score_18_range;
alter table pp_entries add constraint pp_entries_score_18_range check (score_18 is null or score_18 between 0 and 100);
alter table pp_entries drop constraint if exists pp_entries_score_final_range;
alter table pp_entries add constraint pp_entries_score_final_range check (score_final is null or score_final between 0 and 50);
