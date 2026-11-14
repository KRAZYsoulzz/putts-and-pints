-- Putts & Pints Special Events (Spin-Off Events & Card PIN Scoring)
-- Safe to run in the Supabase SQL Editor after supabase/002_admin_auth.sql.
-- Does not touch weekly Putt Night tables (pp_seasons, pp_events, pp_entries, pp_ledger).

-- ---------------------------------------------------------------------------
-- 1. Public special events table (reads public; writes director-only)
-- ---------------------------------------------------------------------------
create table if not exists public.pp_special_events (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  event_date date not null default current_date,
  status     text not null default 'checkin'
             check (status in ('checkin', 'draw', 'scoring', 'results', 'complete')),
  state      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pp_special_events_date_idx on public.pp_special_events (event_date desc);

alter table public.pp_special_events enable row level security;

drop policy if exists pp_special_events_select on public.pp_special_events;
drop policy if exists pp_special_events_insert on public.pp_special_events;
drop policy if exists pp_special_events_update on public.pp_special_events;
drop policy if exists pp_special_events_delete on public.pp_special_events;

revoke all on table public.pp_special_events from anon, authenticated;
grant select on table public.pp_special_events to anon, authenticated;
grant insert, update, delete on table public.pp_special_events to authenticated;

create policy pp_special_events_select
  on public.pp_special_events for select
  to anon, authenticated
  using (true);

create policy pp_special_events_insert
  on public.pp_special_events for insert
  to authenticated
  with check ((select pp_private.is_admin()));

create policy pp_special_events_update
  on public.pp_special_events for update
  to authenticated
  using ((select pp_private.is_admin()))
  with check ((select pp_private.is_admin()));

create policy pp_special_events_delete
  on public.pp_special_events for delete
  to authenticated
  using ((select pp_private.is_admin()));

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pp_special_events'
  ) then
    alter publication supabase_realtime add table public.pp_special_events;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Private Card PIN storage (never exposed in public SELECT queries)
-- ---------------------------------------------------------------------------
create schema if not exists pp_private;

create table if not exists pp_private.special_card_pins (
  event_id   uuid not null references public.pp_special_events(id) on delete cascade,
  card_id    text not null,
  pin        text not null check (pin ~ '^[0-9]{4}$'),
  created_at timestamptz not null default now(),
  primary key (event_id, card_id)
);

alter table pp_private.special_card_pins enable row level security;
revoke all on table pp_private.special_card_pins from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Security-definer PIN management & player scorecard RPCs
-- ---------------------------------------------------------------------------
create or replace function public.pp_get_special_card_pins(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(pp_private.is_admin(), false) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;

  return coalesce(
    (
      select jsonb_object_agg(card_id, pin)
      from pp_private.special_card_pins
      where event_id = p_event_id
    ),
    '{}'::jsonb
  );
end;
$$;

revoke all on function public.pp_get_special_card_pins(uuid) from public, anon;
grant execute on function public.pp_get_special_card_pins(uuid) to authenticated;

create or replace function public.pp_set_special_card_pins(p_event_id uuid, p_pins jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(pp_private.is_admin(), false) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;

  delete from pp_private.special_card_pins
  where event_id = p_event_id;

  insert into pp_private.special_card_pins (event_id, card_id, pin)
  select p_event_id, kv.key, btrim(kv.value)
  from jsonb_each_text(coalesce(p_pins, '{}'::jsonb)) as kv
  where btrim(kv.value) ~ '^[0-9]{4}$';
end;
$$;

revoke all on function public.pp_set_special_card_pins(uuid, jsonb) from public, anon;
grant execute on function public.pp_set_special_card_pins(uuid, jsonb) to authenticated;

create or replace function public.pp_verify_special_card_pin(
  p_event_id uuid,
  p_card_id  text,
  p_pin      text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from pp_private.special_card_pins
    where event_id = p_event_id
      and card_id = p_card_id
      and pin = btrim(coalesce(p_pin, ''))
  );
$$;

revoke all on function public.pp_verify_special_card_pin(uuid, text, text) from public;
grant execute on function public.pp_verify_special_card_pin(uuid, text, text) to anon, authenticated;

create or replace function public.pp_submit_special_card_scores(
  p_event_id   uuid,
  p_card_id    text,
  p_pin        text,
  p_team_holes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev          public.pp_special_events%rowtype;
  v_pin_ok      boolean;
  v_new_teams   jsonb := '[]'::jsonb;
  v_team        jsonb;
  v_raw_holes   jsonb;
  v_clean_holes jsonb;
  v_elem        jsonb;
  v_num         numeric;
  v_idx         int;
  v_now         timestamptz := now();
  v_new_state   jsonb;
begin
  select exists (
    select 1
    from pp_private.special_card_pins
    where event_id = p_event_id
      and card_id = p_card_id
      and pin = btrim(coalesce(p_pin, ''))
  )
  into v_pin_ok;

  if not coalesce(v_pin_ok, false) then
    raise exception 'invalid card pin' using errcode = '42501';
  end if;

  select *
  into v_ev
  from public.pp_special_events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'event not found' using errcode = 'P0002';
  end if;

  if v_ev.status = 'complete' then
    raise exception 'event is finalized' using errcode = 'P0001';
  end if;

  for v_team in
    select * from jsonb_array_elements(coalesce(v_ev.state->'teams', '[]'::jsonb))
  loop
    if (v_team->>'cardId') = p_card_id
       and jsonb_typeof(p_team_holes) = 'object'
       and (p_team_holes ? (v_team->>'id'))
       and jsonb_typeof(p_team_holes->(v_team->>'id')) = 'array' then
      v_raw_holes := p_team_holes->(v_team->>'id');
      v_clean_holes := '[]'::jsonb;
      for v_idx in 0..17 loop
        v_elem := v_raw_holes->v_idx;
        if v_elem is not null and jsonb_typeof(v_elem) = 'number' then
          v_num := (v_elem#>>'{}')::numeric;
          v_clean_holes := v_clean_holes || to_jsonb(least(20, greatest(1, trunc(v_num)::int)));
        else
          v_clean_holes := v_clean_holes || 'null'::jsonb;
        end if;
      end loop;
      v_team := jsonb_set(v_team, '{holes}', v_clean_holes);
    end if;
    v_new_teams := v_new_teams || jsonb_build_array(v_team);
  end loop;

  v_new_state := jsonb_set(
    jsonb_set(v_ev.state, '{teams}', v_new_teams),
    '{updatedAt}',
    to_jsonb(v_now)
  );

  update public.pp_special_events
  set state = v_new_state,
      updated_at = v_now
  where id = p_event_id;

  return v_new_state;
end;
$$;

revoke all on function public.pp_submit_special_card_scores(uuid, text, text, jsonb) from public;
grant execute on function public.pp_submit_special_card_scores(uuid, text, text, jsonb) to anon, authenticated;
