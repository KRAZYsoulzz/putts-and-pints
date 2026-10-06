-- Putts & Pints Database Schema
-- Safe to run in Supabase SQL editor: all tables are prefixed `pp_`
-- so nothing touches or modifies existing Putt Night tables.

-- ---------------------------------------------------------------------------
-- 1. Create Tables
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
  awards         text[] not null default '{}'
                 check (awards <@ array['perfect_round','perfect5','perfect4','high_score']),
  made_final     boolean not null default false,
  tiebreak       int,
  place          int,
  payout         numeric(10,2) not null default 0,
  points         numeric(6,2)  not null default 0,
  created_at     timestamptz not null default now(),
  unique (event_id, player_id)
);

create table if not exists pp_ledger (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid not null references pp_seasons(id) on delete cascade,
  event_id    uuid references pp_events(id) on delete cascade,
  player_id   uuid references pp_players(id) on delete set null,
  division    text check (division in ('M','W')),
  fund        text not null check (fund in ('perfect_round','backup','perfect5','perfect4','high_score','tag_fund')),
  kind        text not null check (kind in ('carryover','entry','overflow','bonus_payout','transfer','adjustment','expense','tag_sale','rollover')),
  amount      numeric(10,2) not null,
  note        text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------
create index if not exists pp_events_season_idx  on pp_events(season_id);
create index if not exists pp_entries_event_idx  on pp_entries(event_id);
create index if not exists pp_entries_player_idx on pp_entries(player_id);
create index if not exists pp_ledger_season_idx  on pp_ledger(season_id);

-- ---------------------------------------------------------------------------
-- 3. Row Level Security (Explicitly Enabled)
-- ---------------------------------------------------------------------------
alter table pp_seasons enable row level security;
alter table pp_players enable row level security;
alter table pp_tags enable row level security;
alter table pp_events enable row level security;
alter table pp_entries enable row level security;
alter table pp_ledger enable row level security;

-- Policies allowing the application to read and write data
create policy "pp_seasons_access" on pp_seasons for all using (true) with check (true);
create policy "pp_players_access" on pp_players for all using (true) with check (true);
create policy "pp_tags_access" on pp_tags for all using (true) with check (true);
create policy "pp_events_access" on pp_events for all using (true) with check (true);
create policy "pp_entries_access" on pp_entries for all using (true) with check (true);
create policy "pp_ledger_access" on pp_ledger for all using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 4. Realtime Subscriptions (For live scoreboard viewing on spectator phones)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table pp_events, pp_entries, pp_ledger;
