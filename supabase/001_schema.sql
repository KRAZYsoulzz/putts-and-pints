-- Putts & Pints schema
-- Lives in the same Supabase project as Putt Night. Every object is prefixed `pp_`
-- so nothing collides with or touches the Putt Night tables.

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------
create table if not exists pp_seasons (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  active      boolean not null default false,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create table if not exists pp_players (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  division    text not null check (division in ('M','W')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Tag holders for a season. tag_number is the tag they currently hold.
create table if not exists pp_tags (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid not null references pp_seasons(id) on delete cascade,
  player_id   uuid not null references pp_players(id) on delete cascade,
  tag_number  int  not null,
  created_at  timestamptz not null default now(),
  unique (season_id, player_id)
);

create table if not exists pp_events (
  id                 uuid primary key default gen_random_uuid(),
  season_id          uuid not null references pp_seasons(id) on delete cascade,
  event_date         date not null default current_date,
  status             text not null default 'checkin'
                     check (status in ('checkin','scoring','final9','results','complete')),
  bar_match_men      numeric(10,2) not null default 0,
  bar_match_women    numeric(10,2) not null default 0,
  final_cut_men      int,
  final_cut_women    int,
  payouts_men        numeric(10,2)[] not null default '{}',
  payouts_women      numeric(10,2)[] not null default '{}',
  settings_snapshot  jsonb,
  notes              text,
  created_at         timestamptz not null default now()
);

create table if not exists pp_entries (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references pp_events(id) on delete cascade,
  player_id      uuid not null references pp_players(id) on delete restrict,
  division       text not null check (division in ('M','W')),
  paid           boolean not null default false,
  tag_in         int,
  tag_out        int,
  r1_b1          smallint check (r1_b1 between 0 and 30),
  r1_b2          smallint check (r1_b2 between 0 and 20),
  r2_b1          smallint check (r2_b1 between 0 and 30),
  r2_b2          smallint check (r2_b2 between 0 and 20),
  f_b1           smallint check (f_b1 between 0 and 30),
  f_b2           smallint check (f_b2 between 0 and 20),
  awards         text[] not null default '{}'      -- manually awarded: perfect_round, perfect5, perfect4, high_score
                 check (awards <@ array['perfect_round','perfect5','perfect4','high_score']),
  made_final     boolean not null default false,
  tiebreak       int,                              -- manual playoff order (1 = best)
  place          int,                              -- written on finalize
  payout         numeric(10,2) not null default 0, -- written on finalize
  points         numeric(6,2)  not null default 0, -- written on finalize
  created_at     timestamptz not null default now(),
  unique (event_id, player_id)
);

-- Every dollar that moves through a pot. Balances = sum(amount).
create table if not exists pp_ledger (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid not null references pp_seasons(id) on delete cascade,
  event_id    uuid references pp_events(id) on delete cascade,
  player_id   uuid references pp_players(id) on delete set null,
  division    text check (division in ('M','W')),       -- null = season-wide (tag fund)
  fund        text not null check (fund in ('perfect_round','backup','perfect5','perfect4','high_score','tag_fund')),
  kind        text not null check (kind in ('carryover','entry','overflow','bonus_payout','transfer','adjustment','expense','tag_sale','rollover')),
  amount      numeric(10,2) not null,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists pp_events_season_idx  on pp_events(season_id);
create index if not exists pp_entries_event_idx  on pp_entries(event_id);
create index if not exists pp_entries_player_idx on pp_entries(player_id);
create index if not exists pp_ledger_season_idx  on pp_ledger(season_id);

-- Only one active season at a time
create unique index if not exists pp_seasons_one_active on pp_seasons(active) where active;

-- ---------------------------------------------------------------------------
-- Row Level Security: Allow read & write via client (admin app is password-protected)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['pp_seasons','pp_players','pp_tags','pp_events','pp_entries','pp_ledger'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "%s_policy" on %I', t, t);
    execute format('drop policy if exists "%s_read" on %I', t, t);
    execute format('drop policy if exists "%s_write" on %I', t, t);
    execute format('create policy "%s_policy" on %I for all using (true) with check (true)', t, t);
  end loop;
end $$;

-- Live updates for the public (QR) view
alter publication supabase_realtime add table pp_events, pp_entries, pp_ledger;
