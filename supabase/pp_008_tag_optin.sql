-- Putts & Pints: tag opt-in.
-- Shared Supabase project. Every object stays prefixed pp_.
-- Do not touch tables that belong to the other app.
--
-- Apply this in the SQL editor. The app does not run it.
--
-- in_tags defaults to false, so every existing player starts OFF, even if a
-- pp_tags row is already there. No backfill. The director turns the switch
-- on for people who actually bought in.

alter table pp_players
  add column if not exists in_tags boolean not null default false;

comment on column pp_players.in_tags is
  'True when this player bought a tag for the current season. The Season page resets it to false when a new season is created.';

-- Season rollover
-- The app resets the flag when a director uses Season → New Season.
-- Tags live on pp_tags (season_id), so the new season simply has none.
-- If a season is inserted by hand in the SQL editor instead, run both:
--   update pp_players set in_tags = false;
--   delete from pp_tags where season_id = '<the new season id>';
