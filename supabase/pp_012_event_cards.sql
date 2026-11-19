-- Sync Putt Night playing cards across devices and public live view.
-- Safe to run in the Supabase SQL Editor.
alter table public.pp_events
  add column if not exists cards jsonb;
