-- pp_007: bar match is worked out from the entries unless a director typed it in.
-- Not run yet: run this in the Supabase SQL editor BEFORE the app that uses it goes live.
alter table pp_events add column if not exists bar_match_men_manual boolean not null default false;
alter table pp_events add column if not exists bar_match_women_manual boolean not null default false;
-- Events that already exist keep the bar match they have stored (it may be a typed amount).
update pp_events set bar_match_men_manual = true, bar_match_women_manual = true where status <> 'scheduled';
