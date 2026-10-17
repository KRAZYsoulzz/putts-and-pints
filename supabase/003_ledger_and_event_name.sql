-- Putts & Pints migration 003
-- Review this, then run it in the Supabase SQL editor. Do not apply it from the app.
-- Safe for the shared project: it only touches pp_ tables.
--
-- Run this BEFORE deploying the app that posts purse / bar-match / place-payout
-- rows and optional event names. Until it runs, those saves are rejected.

-- Optional event name. Null means the event is shown by its date.
alter table pp_events add column if not exists name text;

-- Night payout purse, so entry-fee payout money, the bar match, and place
-- checks have a fund to land in. Bonus pots are funded from this purse
-- before a Perfect 5 / Perfect 4 / High Score is paid, so they don't go negative.
alter table pp_ledger drop constraint if exists pp_ledger_fund_check;
alter table pp_ledger add constraint pp_ledger_fund_check
  check (fund in (
    'perfect_round', 'backup', 'perfect5', 'perfect4', 'high_score', 'tag_fund', 'purse'
  ));

alter table pp_ledger drop constraint if exists pp_ledger_kind_check;
alter table pp_ledger add constraint pp_ledger_kind_check
  check (kind in (
    'carryover', 'entry', 'overflow', 'bonus_payout', 'transfer',
    'adjustment', 'expense', 'tag_sale', 'rollover', 'bar_match', 'place_payout'
  ));

-- Tag numbers start at 1. Skip this statement if any existing row is 0 or negative;
-- fix those rows first, then re-run it.
alter table pp_entries drop constraint if exists pp_entries_tag_in_positive;
alter table pp_entries add constraint pp_entries_tag_in_positive check (tag_in is null or tag_in >= 1);
alter table pp_entries drop constraint if exists pp_entries_tag_out_positive;
alter table pp_entries add constraint pp_entries_tag_out_positive check (tag_out is null or tag_out >= 1);
alter table pp_tags drop constraint if exists pp_tags_tag_number_positive;
alter table pp_tags add constraint pp_tags_tag_number_positive check (tag_number >= 1);

-- One roster name, ignoring case and surrounding space.
-- This fails if two players already share a name — rename one, then re-run this statement.
create unique index if not exists pp_players_name_unique on pp_players (lower(trim(name)));
