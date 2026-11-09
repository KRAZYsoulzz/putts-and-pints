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
-- 4. Private tables in pp_private (RLS enabled with director policies)
-- ---------------------------------------------------------------------------
create schema if not exists pp_private;
revoke all on schema pp_private from public, anon;
grant usage on schema pp_private to authenticated, pp_finance_owner;

create table if not exists pp_private.pp_protected_event (
  event_id           uuid not null,
  season_id          uuid not null,
  install_checksum   text,
  install_checksums  text,
  constraint pp_protected_event_pkey primary key (event_id),
  constraint pp_protected_event_unique unique (event_id, season_id)
);
alter table pp_private.pp_protected_event enable row level security;
revoke all on table pp_private.pp_protected_event from public, anon;
grant select on table pp_private.pp_protected_event to authenticated, pp_finance_owner;

create table if not exists pp_private.pp_protected_ledger (
  ledger_id uuid not null,
  constraint pp_protected_ledger_pkey primary key (ledger_id)
);
alter table pp_private.pp_protected_ledger enable row level security;
revoke all on table pp_private.pp_protected_ledger from public, anon;
grant select on table pp_private.pp_protected_ledger to authenticated, pp_finance_owner;

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
revoke all on table pp_private.pp_season_state from public, anon;
grant select, insert, update on table pp_private.pp_season_state to authenticated, pp_finance_owner;

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
revoke all on table pp_private.pp_postings from public, anon;
grant select, insert on table pp_private.pp_postings to authenticated, pp_finance_owner;

create table if not exists pp_private.pp_corrections (
  id           uuid not null default gen_random_uuid(),
  event_id     uuid not null,
  division     text,
  state        text not null,
  cash_due     numeric(10,2) not null default 0,
  handled      numeric(10,2) not null default 0,
  confirmation text,
  created_at   timestamptz not null default now(),
  constraint pp_corrections_pkey primary key (id)
);
alter table pp_private.pp_corrections enable row level security;
revoke all on table pp_private.pp_corrections from public, anon;
grant select, insert, update on table pp_private.pp_corrections to authenticated, pp_finance_owner;

create table if not exists pp_private.pp_settlement_holds (
  season_id  uuid not null,
  state      text not null,
  constraint pp_settlement_holds_pkey primary key (season_id)
);
alter table pp_private.pp_settlement_holds enable row level security;
revoke all on table pp_private.pp_settlement_holds from public, anon;
grant select, insert, update on table pp_private.pp_settlement_holds to authenticated, pp_finance_owner;

create table if not exists pp_private.pp_cash_audit (
  id           uuid not null default gen_random_uuid(),
  event_id     uuid,
  division     text,
  cash_due     numeric(10,2) not null default 0,
  handled      numeric(10,2) not null default 0,
  confirmation text not null default '',
  created_at   timestamptz not null default now(),
  constraint pp_cash_audit_pkey primary key (id)
);
alter table pp_private.pp_cash_audit enable row level security;
revoke all on table pp_private.pp_cash_audit from public, anon;
grant select, insert on table pp_private.pp_cash_audit to authenticated, pp_finance_owner;

create table if not exists pp_private.pp_requests (
  id           uuid not null default gen_random_uuid(),
  payload_hash text,
  completed    boolean not null default false,
  response     jsonb,
  constraint pp_requests_pkey primary key (id)
);
alter table pp_private.pp_requests enable row level security;
revoke all on table pp_private.pp_requests from public, anon;
grant select, insert, update on table pp_private.pp_requests to authenticated, pp_finance_owner;

create table if not exists pp_private.pp_legacy_journal (
  id        uuid not null default gen_random_uuid(),
  season_id uuid not null,
  state     text not null,
  constraint pp_legacy_journal_pkey primary key (id)
);
alter table pp_private.pp_legacy_journal enable row level security;
revoke all on table pp_private.pp_legacy_journal from public, anon;
grant select, insert, update on table pp_private.pp_legacy_journal to authenticated, pp_finance_owner;

-- ---------------------------------------------------------------------------
-- 5. Helper & RLS policies
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
grant execute on function pp_private.pp_finance_is_admin() to authenticated, pp_finance_owner;

drop policy if exists pp_protected_event_admin_read on pp_private.pp_protected_event;
create policy pp_protected_event_admin_read
  on pp_private.pp_protected_event
  for select
  to authenticated
  using (pp_private.pp_finance_is_admin());

drop policy if exists pp_protected_ledger_admin_read on pp_private.pp_protected_ledger;
create policy pp_protected_ledger_admin_read
  on pp_private.pp_protected_ledger
  for select
  to authenticated
  using (pp_private.pp_finance_is_admin());

drop policy if exists pp_season_state_admin_all on pp_private.pp_season_state;
create policy pp_season_state_admin_all
  on pp_private.pp_season_state
  for all
  to authenticated
  using (pp_private.pp_finance_is_admin())
  with check (pp_private.pp_finance_is_admin());

drop policy if exists pp_postings_admin_all on pp_private.pp_postings;
create policy pp_postings_admin_all
  on pp_private.pp_postings
  for all
  to authenticated
  using (pp_private.pp_finance_is_admin())
  with check (pp_private.pp_finance_is_admin());

drop policy if exists pp_corrections_admin_all on pp_private.pp_corrections;
create policy pp_corrections_admin_all
  on pp_private.pp_corrections
  for all
  to authenticated
  using (pp_private.pp_finance_is_admin())
  with check (pp_private.pp_finance_is_admin());

drop policy if exists pp_settlement_holds_admin_all on pp_private.pp_settlement_holds;
create policy pp_settlement_holds_admin_all
  on pp_private.pp_settlement_holds
  for all
  to authenticated
  using (pp_private.pp_finance_is_admin())
  with check (pp_private.pp_finance_is_admin());

drop policy if exists pp_cash_audit_admin_all on pp_private.pp_cash_audit;
create policy pp_cash_audit_admin_all
  on pp_private.pp_cash_audit
  for all
  to authenticated
  using (pp_private.pp_finance_is_admin())
  with check (pp_private.pp_finance_is_admin());

drop policy if exists pp_requests_admin_all on pp_private.pp_requests;
create policy pp_requests_admin_all
  on pp_private.pp_requests
  for all
  to authenticated
  using (pp_private.pp_finance_is_admin())
  with check (pp_private.pp_finance_is_admin());

drop policy if exists pp_legacy_journal_admin_all on pp_private.pp_legacy_journal;
create policy pp_legacy_journal_admin_all
  on pp_private.pp_legacy_journal
  for all
  to authenticated
  using (pp_private.pp_finance_is_admin())
  with check (pp_private.pp_finance_is_admin());

create or replace function pp_private.pp_is_week1_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pp_events e
    where e.id = p_event_id
      and (
        (
          e.season_id = '81298495-f87c-4d7c-a344-89b97e587d9b'::uuid
          and e.event_date = date '2026-11-05'
          and coalesce(nullif(btrim(e.name), ''), 'Week 1') = 'Week 1'
        )
        or exists (
          select 1
          from pp_private.pp_protected_event pe
          where pe.event_id = e.id
        )
      )
  );
$$;

revoke all on function pp_private.pp_is_week1_event(uuid) from public, anon;
grant execute on function pp_private.pp_is_week1_event(uuid) to authenticated, pp_finance_owner;

-- ---------------------------------------------------------------------------
-- 6. Closeout preview, idempotent division close, and correction RPCs
-- ---------------------------------------------------------------------------
create or replace function public.pp_preview_close(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.pp_events%rowtype;
  v_week1 boolean;
  v_later_posted boolean;
begin
  if not coalesce(pp_private.pp_finance_is_admin(), false) then
    raise exception 'insufficient privilege'
      using errcode = '42501';
  end if;

  select *
  into v_event
  from public.pp_events
  where id = p_event_id;

  if not found then
    raise exception 'event not found'
      using errcode = 'P0002';
  end if;

  v_week1 := pp_private.pp_is_week1_event(p_event_id);

  select exists (
    select 1
    from public.pp_events e2
    where e2.season_id = v_event.season_id
      and e2.id <> v_event.id
      and (e2.event_date > v_event.event_date or (e2.event_date = v_event.event_date and e2.created_at > v_event.created_at))
      and (
        e2.pp_closed_men
        or e2.pp_closed_women
        or exists (select 1 from public.pp_ledger l where l.event_id = e2.id)
      )
  )
  into v_later_posted;

  return jsonb_build_object(
    'event_id', v_event.id,
    'season_id', v_event.season_id,
    'close_mode', v_event.pp_close_mode,
    'closed_men', v_event.pp_closed_men,
    'closed_women', v_event.pp_closed_women,
    'shared_pots_posted', v_event.pp_shared_pots_posted,
    'reserve_p4_men', v_event.pp_reserve_p4_men,
    'reserve_p5_men', v_event.pp_reserve_p5_men,
    'reserve_p4_women', v_event.pp_reserve_p4_women,
    'reserve_p5_women', v_event.pp_reserve_p5_women,
    'week1_frozen', v_week1,
    'later_posted', v_later_posted,
    'can_close', (not v_week1 and not v_later_posted)
  );
end;
$$;

alter function public.pp_preview_close(uuid) owner to pp_finance_owner;
revoke all on function public.pp_preview_close(uuid) from public;
revoke all on function public.pp_preview_close(uuid) from anon;
grant execute on function public.pp_preview_close(uuid) to authenticated;

create or replace function public.pp_execute_division_close(
  p_event_id uuid,
  p_division text,
  p_request_id uuid,
  p_payload_hash text,
  p_legs jsonb default '[]'::jsonb,
  p_reserve_p4 numeric default 0,
  p_reserve_p5 numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.pp_events%rowtype;
  v_req pp_private.pp_requests%rowtype;
  v_later_posted boolean;
  v_posting_id uuid;
  v_closed_men boolean;
  v_closed_women boolean;
  v_shared_posted boolean;
  v_phase text;
  v_leg jsonb;
  v_idx integer := 0;
  v_response jsonb;
begin
  if not coalesce(pp_private.pp_finance_is_admin(), false) then
    raise exception 'insufficient privilege'
      using errcode = '42501';
  end if;

  if p_division not in ('M', 'W') then
    raise exception 'invalid division'
      using errcode = '22023';
  end if;

  select *
  into v_event
  from public.pp_events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'event not found'
      using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('season_finance:' || v_event.season_id::text, 0));

  if pp_private.pp_is_week1_event(p_event_id) then
    raise exception 'week1_frozen'
      using errcode = 'P0001';
  end if;

  select *
  into v_req
  from pp_private.pp_requests
  where id = p_request_id
  for update;

  if found then
    if coalesce(v_req.payload_hash, '') <> coalesce(p_payload_hash, '') then
      raise exception 'request payload collision'
        using errcode = '23505';
    end if;
    if v_req.completed then
      return coalesce(
        v_req.response,
        jsonb_build_object(
          'ok', true,
          'cached', true,
          'event_id', v_event.id,
          'division', p_division,
          'closed_men', v_event.pp_closed_men,
          'closed_women', v_event.pp_closed_women,
          'shared_pots_posted', v_event.pp_shared_pots_posted
        )
      );
    end if;
  else
    insert into pp_private.pp_requests (id, payload_hash, completed)
    values (p_request_id, p_payload_hash, false);
  end if;

  select exists (
    select 1
    from public.pp_events e2
    where e2.season_id = v_event.season_id
      and e2.id <> v_event.id
      and (e2.event_date > v_event.event_date or (e2.event_date = v_event.event_date and e2.created_at > v_event.created_at))
      and (
        e2.pp_closed_men
        or e2.pp_closed_women
        or exists (select 1 from public.pp_ledger l where l.event_id = e2.id)
      )
  )
  into v_later_posted;

  if v_later_posted then
    raise exception 'chronology'
      using errcode = 'P0001';
  end if;

  v_closed_men := v_event.pp_closed_men or (p_division = 'M');
  v_closed_women := v_event.pp_closed_women or (p_division = 'W');
  v_shared_posted := v_closed_men and v_closed_women;
  v_phase := case when v_shared_posted then 'second_close' else 'first_close' end;

  insert into pp_private.pp_postings (event_id, division, phase, snapshot)
  values (
    v_event.id,
    p_division,
    v_phase,
    jsonb_build_object('payload_hash', p_payload_hash, 'legs', p_legs)
  )
  returning id into v_posting_id;

  for v_leg in select * from jsonb_array_elements(coalesce(p_legs, '[]'::jsonb))
  loop
    v_idx := v_idx + 1;
    insert into public.pp_ledger (
      season_id,
      event_id,
      player_id,
      division,
      fund,
      kind,
      amount,
      note,
      pp_scope,
      pp_posting_id,
      pp_leg_key
    )
    values (
      v_event.season_id,
      v_event.id,
      nullif(v_leg->>'player_id', '')::uuid,
      v_leg->>'division',
      v_leg->>'fund',
      v_leg->>'kind',
      (v_leg->>'amount')::numeric(10,2),
      v_leg->>'note',
      v_phase,
      v_posting_id,
      v_posting_id::text || ':' || v_idx::text
    );
  end loop;

  update public.pp_events
  set
    pp_close_mode = 'split',
    pp_closed_men = v_closed_men,
    pp_closed_women = v_closed_women,
    pp_shared_pots_posted = v_shared_posted,
    pp_reserve_p4_men = case when p_division = 'M' and not v_shared_posted then p_reserve_p4 when v_shared_posted then 0 else pp_reserve_p4_men end,
    pp_reserve_p5_men = case when p_division = 'M' and not v_shared_posted then p_reserve_p5 when v_shared_posted then 0 else pp_reserve_p5_men end,
    pp_reserve_p4_women = case when p_division = 'W' and not v_shared_posted then p_reserve_p4 when v_shared_posted then 0 else pp_reserve_p4_women end,
    pp_reserve_p5_women = case when p_division = 'W' and not v_shared_posted then p_reserve_p5 when v_shared_posted then 0 else pp_reserve_p5_women end,
    pp_financial_snapshot_id = v_posting_id,
    status = case when v_shared_posted then 'complete' else status end
  where id = v_event.id;

  insert into pp_private.pp_season_state (season_id, finance_revision, split_enabled)
  values (v_event.season_id, 1, true)
  on conflict (season_id) do update
  set
    finance_revision = pp_private.pp_season_state.finance_revision + 1,
    split_enabled = true;

  v_response := jsonb_build_object(
    'ok', true,
    'cached', false,
    'event_id', v_event.id,
    'posting_id', v_posting_id,
    'division', p_division,
    'closed_men', v_closed_men,
    'closed_women', v_closed_women,
    'shared_pots_posted', v_shared_posted
  );

  update pp_private.pp_requests
  set completed = true, response = v_response
  where id = p_request_id;

  return v_response;
end;
$$;

alter function public.pp_execute_division_close(uuid, text, uuid, text, jsonb, numeric, numeric) owner to pp_finance_owner;
revoke all on function public.pp_execute_division_close(uuid, text, uuid, text, jsonb, numeric, numeric) from public;
revoke all on function public.pp_execute_division_close(uuid, text, uuid, text, jsonb, numeric, numeric) from anon;
grant execute on function public.pp_execute_division_close(uuid, text, uuid, text, jsonb, numeric, numeric) to authenticated;

create or replace function public.pp_apply_correction(
  p_event_id uuid,
  p_division text,
  p_request_id uuid,
  p_payload_hash text,
  p_confirmation text,
  p_cash_due numeric,
  p_handled numeric,
  p_legs jsonb default '[]'::jsonb,
  p_reopen boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.pp_events%rowtype;
  v_later_posted boolean;
  v_correction_id uuid;
  v_leg jsonb;
  v_idx integer := 0;
begin
  if not coalesce(pp_private.pp_finance_is_admin(), false) then
    raise exception 'insufficient privilege'
      using errcode = '42501';
  end if;

  if p_division not in ('M', 'W') then
    raise exception 'invalid division'
      using errcode = '22023';
  end if;

  if coalesce(p_confirmation, '') <> 'All cash differences shown have been physically settled.'
     or coalesce(p_handled, -1) <> coalesce(p_cash_due, 0) then
    raise exception 'physical cash settlement confirmation required'
      using errcode = 'P0001';
  end if;

  select *
  into v_event
  from public.pp_events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'event not found'
      using errcode = 'P0002';
  end if;

  if pp_private.pp_is_week1_event(p_event_id) then
    raise exception 'week1_frozen'
      using errcode = 'P0001';
  end if;

  select exists (
    select 1
    from public.pp_events e2
    where e2.season_id = v_event.season_id
      and e2.id <> v_event.id
      and (e2.event_date > v_event.event_date or (e2.event_date = v_event.event_date and e2.created_at > v_event.created_at))
      and (
        e2.pp_closed_men
        or e2.pp_closed_women
        or exists (select 1 from public.pp_ledger l where l.event_id = e2.id)
      )
  )
  into v_later_posted;

  if v_later_posted then
    raise exception 'chronology'
      using errcode = 'P0001';
  end if;

  insert into pp_private.pp_cash_audit (event_id, division, cash_due, handled, confirmation)
  values (v_event.id, p_division, p_cash_due, p_handled, p_confirmation);

  insert into pp_private.pp_corrections (event_id, division, state, cash_due, handled, confirmation)
  values (v_event.id, p_division, 'applied', p_cash_due, p_handled, p_confirmation)
  returning id into v_correction_id;

  for v_leg in select * from jsonb_array_elements(coalesce(p_legs, '[]'::jsonb))
  loop
    v_idx := v_idx + 1;
    insert into public.pp_ledger (
      season_id,
      event_id,
      player_id,
      division,
      fund,
      kind,
      amount,
      note,
      pp_scope,
      pp_correction_id,
      pp_leg_key
    )
    values (
      v_event.season_id,
      v_event.id,
      nullif(v_leg->>'player_id', '')::uuid,
      coalesce(v_leg->>'division', p_division),
      coalesce(v_leg->>'fund', 'purse'),
      coalesce(v_leg->>'kind', 'adjustment'),
      (v_leg->>'amount')::numeric(10,2),
      coalesce(v_leg->>'note', 'Correction'),
      'correction',
      v_correction_id,
      v_correction_id::text || ':' || v_idx::text
    );
  end loop;

  if p_reopen then
    update public.pp_events
    set
      pp_closed_men = case when p_division = 'M' then false else pp_closed_men end,
      pp_closed_women = case when p_division = 'W' then false else pp_closed_women end,
      status = 'results'
    where id = v_event.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'event_id', v_event.id,
    'correction_id', v_correction_id,
    'division', p_division,
    'reopened', p_reopen
  );
end;
$$;

alter function public.pp_apply_correction(uuid, text, uuid, text, text, numeric, numeric, jsonb, boolean) owner to pp_finance_owner;
revoke all on function public.pp_apply_correction(uuid, text, uuid, text, text, numeric, numeric, jsonb, boolean) from public;
revoke all on function public.pp_apply_correction(uuid, text, uuid, text, text, numeric, numeric, jsonb, boolean) from anon;
grant execute on function public.pp_apply_correction(uuid, text, uuid, text, text, numeric, numeric, jsonb, boolean) to authenticated;

