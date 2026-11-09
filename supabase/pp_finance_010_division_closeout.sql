-- Putts & Pints division closeout migration (unapplied).
-- Review in the SQL editor later; the app does not run this; do not apply to production from this worktree.
--
-- This file defines additive schema for a future install.
-- It must not UPDATE, DELETE, or INSERT any business row. No backfill. No Week 1 rewrite.
-- Week 1 is season 81298495-f87c-4d7c-a344-89b97e587d9b, date 2026-11-05, name Week 1.
-- A future install resolves exactly one such event and aborts on missing or duplicate,
-- then stores those UUIDs; this file does not do that write.
-- Direct split writes are not granted here and Week 1 guards must still refuse finance-owner
-- changes once the protected ids exist. No trigger is created to update existing rows.

-- ---------------------------------------------------------------------------
-- 1. Finance owner role
-- ---------------------------------------------------------------------------
do $role$
begin
  if not exists (select 1 from pg_roles where rolname = 'pp_finance_owner') then
    create role pp_finance_owner with nologin nosuperuser nobypassrls;
  end if;
end
$role$;

-- ---------------------------------------------------------------------------
-- 2. Additive columns on pp_events (existing rows stay legacy)
-- ---------------------------------------------------------------------------
alter table public.pp_events
  add column if not exists pp_close_mode text not null default 'legacy',
  add column if not exists pp_stage_men text null,
  add column if not exists pp_stage_women text null,
  add column if not exists pp_closed_men boolean not null default false,
  add column if not exists pp_closed_women boolean not null default false,
  add column if not exists pp_input_revision_men integer not null default 0,
  add column if not exists pp_input_revision_women integer not null default 0,
  add column if not exists pp_result_revision_men integer not null default 0,
  add column if not exists pp_result_revision_women integer not null default 0,
  add column if not exists pp_reserve_p4_men numeric(10,2) not null default 0,
  add column if not exists pp_reserve_p5_men numeric(10,2) not null default 0,
  add column if not exists pp_reserve_p4_women numeric(10,2) not null default 0,
  add column if not exists pp_reserve_p5_women numeric(10,2) not null default 0,
  add column if not exists pp_shared_pots_posted boolean not null default false,
  add column if not exists pp_financial_snapshot_id uuid null;

-- ---------------------------------------------------------------------------
-- 3. Additive columns on pp_ledger
-- ---------------------------------------------------------------------------
alter table public.pp_ledger
  add column if not exists pp_scope text null,
  add column if not exists pp_posting_id uuid null,
  add column if not exists pp_correction_id uuid null,
  add column if not exists pp_leg_key text null;

-- ---------------------------------------------------------------------------
-- 4. Private tables in pp_private (empty, RLS enabled, revoked)
-- ---------------------------------------------------------------------------
create schema if not exists pp_private;
revoke all on schema pp_private from public;

create table if not exists pp_private.pp_protected_event (
  event_id           uuid not null,
  season_id          uuid not null,
  install_checksum   text,
  install_checksums  text,
  constraint pp_protected_event_pkey primary key (event_id),
  constraint pp_protected_event_unique unique (event_id, season_id)
);
alter table pp_private.pp_protected_event enable row level security;
revoke all on table pp_private.pp_protected_event from public, anon, authenticated;

create table if not exists pp_private.pp_protected_ledger (
  ledger_id uuid not null,
  constraint pp_protected_ledger_pkey primary key (ledger_id)
);
alter table pp_private.pp_protected_ledger enable row level security;
revoke all on table pp_private.pp_protected_ledger from public, anon, authenticated;

create table if not exists pp_private.pp_season_state (
  season_id           uuid not null,
  finance_revision    bigint not null default 0,
  settings_revision   bigint not null default 0,
  tag_revision        bigint not null default 0,
  structure_revision  bigint not null default 0,
  split_enabled       boolean not null default false,
  constraint pp_season_state_pkey primary key (season_id)
);
alter table pp_private.pp_season_state enable row level security;
revoke all on table pp_private.pp_season_state from public, anon, authenticated;

create table if not exists pp_private.pp_postings (
  id         uuid not null default gen_random_uuid(),
  event_id   uuid not null,
  division   text,
  phase      text,
  snapshot   jsonb,
  created_at timestamptz not null default now(),
  constraint pp_postings_pkey primary key (id)
);
alter table pp_private.pp_postings enable row level security;
revoke all on table pp_private.pp_postings from public, anon, authenticated;

create table if not exists pp_private.pp_corrections (
  id         uuid not null default gen_random_uuid(),
  event_id   uuid not null,
  state      text not null,
  created_at timestamptz not null default now(),
  constraint pp_corrections_pkey primary key (id)
);
alter table pp_private.pp_corrections enable row level security;
revoke all on table pp_private.pp_corrections from public, anon, authenticated;

create table if not exists pp_private.pp_settlement_holds (
  season_id  uuid not null,
  state      text not null,
  constraint pp_settlement_holds_pkey primary key (season_id)
);
alter table pp_private.pp_settlement_holds enable row level security;
revoke all on table pp_private.pp_settlement_holds from public, anon, authenticated;

create table if not exists pp_private.pp_cash_audit (
  id         uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  constraint pp_cash_audit_pkey primary key (id)
);
alter table pp_private.pp_cash_audit enable row level security;
revoke all on table pp_private.pp_cash_audit from public, anon, authenticated;

create table if not exists pp_private.pp_requests (
  id           uuid not null default gen_random_uuid(),
  payload_hash text,
  completed    boolean not null default false,
  constraint pp_requests_pkey primary key (id)
);
alter table pp_private.pp_requests enable row level security;
revoke all on table pp_private.pp_requests from public, anon, authenticated;

create table if not exists pp_private.pp_legacy_journal (
  id        uuid not null default gen_random_uuid(),
  season_id uuid not null,
  state     text not null,
  constraint pp_legacy_journal_pkey primary key (id)
);
alter table pp_private.pp_legacy_journal enable row level security;
revoke all on table pp_private.pp_legacy_journal from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Helper & preview functions
-- ---------------------------------------------------------------------------
create or replace function pp_private.pp_finance_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select pp_private.is_admin();
$$;

revoke all on function pp_private.pp_finance_is_admin() from public;
revoke all on function pp_private.pp_finance_is_admin() from anon;
grant execute on function pp_private.pp_finance_is_admin() to authenticated;

create or replace function public.pp_preview_close(p_event_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not coalesce(pp_private.pp_finance_is_admin(), false) then
    raise exception 'insufficient privilege'
      using errcode = 'insufficient_privilege';
  end if;

  raise exception 'canonical close is not installed for execution yet'
    using errcode = 'feature_not_enabled';
end;
$$;

revoke all on function public.pp_preview_close(uuid) from public;
revoke all on function public.pp_preview_close(uuid) from anon;
grant execute on function public.pp_preview_close(uuid) to authenticated;
