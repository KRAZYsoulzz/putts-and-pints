-- Putts & Pints Card PIN Live Scoring (18 Holes & Final 9)
-- Safe to run in the Supabase SQL Editor after supabase/002_admin_auth.sql.
-- Makes Putt Night station-by-station mobile scoring work with 4-digit Card PINs.

-- ---------------------------------------------------------------------------
-- 1. Columns for synced cards (pp_events) and station progress (pp_entries)
-- ---------------------------------------------------------------------------
alter table public.pp_events
  add column if not exists cards jsonb;

alter table public.pp_entries
  add column if not exists station_scores jsonb;

-- ---------------------------------------------------------------------------
-- 2. Private Card PIN storage (never exposed to public SELECT queries)
-- ---------------------------------------------------------------------------
create schema if not exists pp_private;

create table if not exists pp_private.event_card_pins (
  event_id   uuid not null references public.pp_events(id) on delete cascade,
  card_id    text not null,
  pin        text not null check (pin ~ '^[0-9]{4}$'),
  created_at timestamptz not null default now(),
  primary key (event_id, card_id)
);

alter table pp_private.event_card_pins enable row level security;
revoke all on table pp_private.event_card_pins from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Security-definer PIN management & station scorekeeper RPCs
-- ---------------------------------------------------------------------------
create or replace function public.pp_get_event_card_pins(p_event_id uuid)
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
      from pp_private.event_card_pins
      where event_id = p_event_id
    ),
    '{}'::jsonb
  );
end;
$$;

revoke all on function public.pp_get_event_card_pins(uuid) from public, anon;
grant execute on function public.pp_get_event_card_pins(uuid) to authenticated;

create or replace function public.pp_set_event_card_pins(p_event_id uuid, p_pins jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(pp_private.is_admin(), false) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;

  if p_event_id = 'e1ff57b8-9569-485d-aaa2-d538470bf9f4'::uuid then
    raise exception 'Week 1 is locked' using errcode = 'P0001';
  end if;

  delete from pp_private.event_card_pins
  where event_id = p_event_id;

  insert into pp_private.event_card_pins (event_id, card_id, pin)
  select p_event_id, kv.key, btrim(kv.value)
  from jsonb_each_text(coalesce(p_pins, '{}'::jsonb)) as kv
  where btrim(kv.value) ~ '^[0-9]{4}$';
end;
$$;

revoke all on function public.pp_set_event_card_pins(uuid, jsonb) from public, anon;
grant execute on function public.pp_set_event_card_pins(uuid, jsonb) to authenticated;

create or replace function public.pp_verify_event_card_pin(
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
    from pp_private.event_card_pins
    where event_id = p_event_id
      and card_id = p_card_id
      and pin = btrim(coalesce(p_pin, ''))
  );
$$;

revoke all on function public.pp_verify_event_card_pin(uuid, text, text) from public;
grant execute on function public.pp_verify_event_card_pin(uuid, text, text) to anon, authenticated;

create or replace function public.pp_submit_event_card_scores(
  p_event_id        uuid,
  p_card_id         text,
  p_pin             text,
  p_round           text,
  p_player_stations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev             public.pp_events%rowtype;
  v_pin_ok         boolean;
  v_cards_group    jsonb;
  v_allowed_pids   jsonb := null;
  v_div            text;
  v_card_elem      jsonb;
  v_player_id      text;
  v_payload        jsonb;
  v_entry          public.pp_entries%rowtype;
  v_updated_entry  public.pp_entries%rowtype;
  v_updated_rows   jsonb := '[]'::jsonb;
  v_weights        constant int[] := array[1, 2, 3, 4, 5, 1, 2, 3, 4];
  v_round_key      text;
  v_raw_arr        jsonb;
  v_clean_arr      jsonb;
  v_has_any        boolean;
  v_idx            int;
  v_elem           jsonb;
  v_make           int;
  v_stations       jsonb;
  v_prev_auto      text[];
  v_next_auto      text[] := array[]::text[];
  v_new_awards     text[] := array[]::text[];
  v_award          text;
  v_auto_p5        boolean := false;
  v_auto_p4        boolean := false;
  v_auto_pr        boolean := false;
  v_r_b1_cnt       int;
  v_r_b2_cnt       int;
  v_r_b1_pts       int;
  v_r_b2_pts       int;
  v_f_b1           int;
  v_f_b2           int;
  v_f_tot          int;
  v_b_b1           int;
  v_b_b2           int;
  v_b_tot          int;
  v_fin_b1         int;
  v_fin_b2         int;
  v_fin_tot        int;
  v_next_front     int;
  v_next_back      int;
  v_next_18        int;
begin
  if p_round not in ('18', 'final') then
    raise exception 'invalid round' using errcode = '22023';
  end if;

  if p_event_id = 'e1ff57b8-9569-485d-aaa2-d538470bf9f4'::uuid then
    raise exception 'Week 1 is locked' using errcode = 'P0001';
  end if;

  select exists (
    select 1
    from pp_private.event_card_pins
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
  from public.pp_events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'event not found' using errcode = 'P0002';
  end if;

  if v_ev.status = 'complete' then
    raise exception 'event is finalized' using errcode = 'P0001';
  end if;

  if v_ev.status = 'results' and not coalesce(pp_private.is_admin(), false) then
    raise exception 'scoring is closed' using errcode = 'P0001';
  end if;

  if p_round = '18' and v_ev.status = 'final9' and not coalesce(pp_private.is_admin(), false) then
    raise exception '18-hole scoring is closed' using errcode = 'P0001';
  end if;

  if v_ev.cards is null or jsonb_typeof(v_ev.cards) <> 'object' then
    raise exception 'cards not configured' using errcode = 'P0002';
  end if;

  v_cards_group := case
    when p_round = '18' then v_ev.cards->'cards'
    else v_ev.cards->'final9Cards'
  end;

  if v_cards_group is not null and jsonb_typeof(v_cards_group) = 'object' then
    foreach v_div in array array['M', 'W'] loop
      if jsonb_typeof(v_cards_group->v_div) = 'array' then
        for v_card_elem in select * from jsonb_array_elements(v_cards_group->v_div) loop
          if (v_card_elem->>'id') = p_card_id then
            v_allowed_pids := v_card_elem->'playerIds';
            exit;
          end if;
        end loop;
      end if;
      exit when v_allowed_pids is not null;
    end loop;
  end if;

  if v_allowed_pids is null or jsonb_typeof(v_allowed_pids) <> 'array' then
    raise exception 'card not found' using errcode = 'P0002';
  end if;

  if p_player_stations is null or jsonb_typeof(p_player_stations) <> 'object' then
    return v_updated_rows;
  end if;

  for v_player_id, v_payload in
    select key, value from jsonb_each(p_player_stations)
  loop
    if not exists (
      select 1 from jsonb_array_elements_text(v_allowed_pids) as pid where pid = v_player_id
    ) then
      continue;
    end if;

    if jsonb_typeof(v_payload) <> 'object' then
      continue;
    end if;

    select *
    into v_entry
    from public.pp_entries
    where event_id = p_event_id
      and player_id = v_player_id::uuid
    for update;

    if not found then
      continue;
    end if;

    if p_round = 'final' and not v_entry.made_final then
      continue;
    end if;

    v_stations := case
      when v_entry.station_scores is not null and jsonb_typeof(v_entry.station_scores) = 'object'
        then v_entry.station_scores
      else '{}'::jsonb
    end;

    select coalesce(array_agg(x), array[]::text[])
    into v_prev_auto
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(v_stations->'autoAwards') = 'array' then v_stations->'autoAwards'
        else '[]'::jsonb
      end
    ) as x;

    foreach v_round_key in array (
      case when p_round = '18' then array['front', 'back'] else array['final'] end
    ) loop
      if (v_payload ? v_round_key) and jsonb_typeof(v_payload->v_round_key) = 'array' then
        v_raw_arr := v_payload->v_round_key;
        v_clean_arr := '[]'::jsonb;
        v_has_any := false;
        for v_idx in 0..8 loop
          v_elem := v_raw_arr->v_idx;
          if v_elem is not null and jsonb_typeof(v_elem) = 'number' then
            v_make := trunc((v_elem#>>'{}')::numeric)::int;
            if v_make in (0, 1, 2) then
              v_clean_arr := v_clean_arr || to_jsonb(v_make);
              v_has_any := true;
            else
              v_clean_arr := v_clean_arr || 'null'::jsonb;
            end if;
          else
            v_clean_arr := v_clean_arr || 'null'::jsonb;
          end if;
        end loop;

        if v_has_any then
          v_stations := jsonb_set(v_stations, array[v_round_key], v_clean_arr);
        else
          v_stations := v_stations - v_round_key;
        end if;
      end if;
    end loop;

    -- Recompute round totals & auto bonus eligibility across merged station arrays
    v_f_b1 := null; v_f_b2 := null; v_f_tot := null;
    v_b_b1 := null; v_b_b2 := null; v_b_tot := null;
    v_fin_b1 := null; v_fin_b2 := null; v_fin_tot := null;
    v_auto_p5 := false; v_auto_p4 := false; v_auto_pr := false;

    foreach v_round_key in array array['front', 'back', 'final'] loop
      if (v_stations ? v_round_key) and jsonb_typeof(v_stations->v_round_key) = 'array' then
        v_raw_arr := v_stations->v_round_key;
        v_r_b1_cnt := 0; v_r_b2_cnt := 0;
        v_r_b1_pts := 0; v_r_b2_pts := 0;
        for v_idx in 0..8 loop
          v_elem := v_raw_arr->v_idx;
          if v_elem is not null and jsonb_typeof(v_elem) = 'number' then
            v_make := trunc((v_elem#>>'{}')::numeric)::int;
            if v_make in (0, 1, 2) then
              if v_idx < 5 then
                v_r_b1_cnt := v_r_b1_cnt + 1;
                v_r_b1_pts := v_r_b1_pts + v_make * v_weights[v_idx + 1];
              else
                v_r_b2_cnt := v_r_b2_cnt + 1;
                v_r_b2_pts := v_r_b2_pts + v_make * v_weights[v_idx + 1];
              end if;
            end if;
          end if;
        end loop;

        if v_r_b1_cnt = 5 and v_r_b1_pts = 30 then
          v_auto_p5 := true;
        end if;
        if v_r_b2_cnt = 4 and v_r_b2_pts = 20 then
          v_auto_p4 := true;
        end if;
        if v_r_b1_cnt = 5 and v_r_b1_pts = 30 and v_r_b2_cnt = 4 and v_r_b2_pts = 20 then
          v_auto_pr := true;
        end if;

        if v_round_key = 'front' then
          v_f_b1 := case when v_r_b1_cnt > 0 then v_r_b1_pts else null end;
          v_f_b2 := case when v_r_b2_cnt > 0 then v_r_b2_pts else null end;
          v_f_tot := case when (v_r_b1_cnt + v_r_b2_cnt) > 0 then (v_r_b1_pts + v_r_b2_pts) else null end;
        elsif v_round_key = 'back' then
          v_b_b1 := case when v_r_b1_cnt > 0 then v_r_b1_pts else null end;
          v_b_b2 := case when v_r_b2_cnt > 0 then v_r_b2_pts else null end;
          v_b_tot := case when (v_r_b1_cnt + v_r_b2_cnt) > 0 then (v_r_b1_pts + v_r_b2_pts) else null end;
        else
          v_fin_b1 := case when v_r_b1_cnt > 0 then v_r_b1_pts else null end;
          v_fin_b2 := case when v_r_b2_cnt > 0 then v_r_b2_pts else null end;
          v_fin_tot := case when (v_r_b1_cnt + v_r_b2_cnt) > 0 then (v_r_b1_pts + v_r_b2_pts) else null end;
        end if;
      end if;
    end loop;

    v_next_auto := array[]::text[];
    if v_auto_p5 then v_next_auto := array_append(v_next_auto, 'perfect5'); end if;
    if v_auto_p4 then v_next_auto := array_append(v_next_auto, 'perfect4'); end if;
    if v_auto_pr then v_next_auto := array_append(v_next_auto, 'perfect_round'); end if;

    v_new_awards := array[]::text[];
    foreach v_award in array coalesce(v_entry.awards, array[]::text[]) loop
      if (v_award = any(v_prev_auto)) and not (v_award = any(v_next_auto)) then
        continue;
      end if;
      if not (v_award = any(v_new_awards)) then
        v_new_awards := array_append(v_new_awards, v_award);
      end if;
    end loop;
    foreach v_award in array v_next_auto loop
      if not (v_award = any(v_new_awards)) then
        v_new_awards := array_append(v_new_awards, v_award);
      end if;
    end loop;

    if coalesce(array_length(v_next_auto, 1), 0) > 0 then
      v_stations := jsonb_set(v_stations, '{autoAwards}', to_jsonb(v_next_auto));
    else
      v_stations := v_stations - 'autoAwards';
    end if;

    if not ((v_stations ? 'front') or (v_stations ? 'back') or (v_stations ? 'final')) then
      v_stations := null;
    end if;

    if p_round = '18' then
      v_next_front := case
        when v_stations is not null and (v_stations ? 'front') then v_f_tot
        when (v_payload ? 'front') then null
        else v_entry.score_front
      end;
      v_next_back := case
        when v_stations is not null and (v_stations ? 'back') then v_b_tot
        when (v_payload ? 'back') then null
        else v_entry.score_back
      end;
      v_next_18 := case
        when v_next_front is not null and v_next_back is not null then v_next_front + v_next_back
        else null
      end;

      update public.pp_entries
      set r1_b1 = case when v_stations is not null and (v_stations ? 'front') then v_f_b1 when (v_payload ? 'front') then null else r1_b1 end,
          r1_b2 = case when v_stations is not null and (v_stations ? 'front') then v_f_b2 when (v_payload ? 'front') then null else r1_b2 end,
          r2_b1 = case when v_stations is not null and (v_stations ? 'back') then v_b_b1 when (v_payload ? 'back') then null else r2_b1 end,
          r2_b2 = case when v_stations is not null and (v_stations ? 'back') then v_b_b2 when (v_payload ? 'back') then null else r2_b2 end,
          score_front = v_next_front,
          score_back = v_next_back,
          score_18 = v_next_18,
          awards = v_new_awards,
          station_scores = v_stations
      where id = v_entry.id
      returning * into v_updated_entry;
    else
      update public.pp_entries
      set f_b1 = case when v_stations is not null and (v_stations ? 'final') then v_fin_b1 when (v_payload ? 'final') then null else f_b1 end,
          f_b2 = case when v_stations is not null and (v_stations ? 'final') then v_fin_b2 when (v_payload ? 'final') then null else f_b2 end,
          score_final = case when v_stations is not null and (v_stations ? 'final') then v_fin_tot when (v_payload ? 'final') then null else score_final end,
          awards = v_new_awards,
          station_scores = v_stations
      where id = v_entry.id
      returning * into v_updated_entry;
    end if;

    v_updated_rows := v_updated_rows || jsonb_build_array(to_jsonb(v_updated_entry));
  end loop;

  return v_updated_rows;
end;
$$;

revoke all on function public.pp_submit_event_card_scores(uuid, text, text, text, jsonb) from public;
grant execute on function public.pp_submit_event_card_scores(uuid, text, text, text, jsonb) to anon, authenticated;
