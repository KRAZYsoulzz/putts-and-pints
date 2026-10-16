-- Putts & Pints director authentication.
-- Run this in the Supabase SQL editor after supabase/001_schema.sql.
-- It does not modify Putt Night tables (anything without the pp_ prefix).
--
-- Directors are Supabase Auth users listed in pp_private.admins.
-- Usernames "admin" and "les" are aliases in pp_private.director_alias.
-- Point both at the Supabase Auth email you create in the dashboard.
-- Supabase rejects addresses on domains that cannot receive mail (.local,
-- example.com). Use a normal email and turn on Auto Confirm User.
-- Do not put the password in this file.
--
-- Do not add the pp_private schema to Exposed schemas. The security-definer
-- check below has to stay off the Data API.

-- ---------------------------------------------------------------------------
-- 1. Director roster (unexposed schema)
-- ---------------------------------------------------------------------------
create schema if not exists pp_private;

revoke all on schema pp_private from public;
grant usage on schema pp_private to anon, authenticated;

create table if not exists pp_private.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table pp_private.admins enable row level security;

revoke all on table pp_private.admins from public, anon, authenticated;

comment on table pp_private.admins is
  'Putts & Pints directors. API roles have no privileges; pp_private.is_admin() reads it as the function owner.';

-- Runs as its owner (postgres in the SQL editor), which bypasses RLS.
-- search_path is pinned so a caller cannot shadow auth.uid() or the table.
create or replace function pp_private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from pp_private.admins
    where user_id = (select auth.uid())
  );
$$;

revoke all on function pp_private.is_admin() from public;
grant execute on function pp_private.is_admin() to anon, authenticated;

-- Exposed RPC so the app can ask "is this session a director?"
-- Invoker rights only: the private function above does the privileged read.
create or replace function public.pp_is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select pp_private.is_admin();
$$;

revoke all on function public.pp_is_admin() from public;
grant execute on function public.pp_is_admin() to anon, authenticated;

-- Username -> email for the existing director login (admin / les).
-- The app reads this before sign-in. The table itself is not granted to the API.
create table if not exists pp_private.director_alias (
  username   text primary key,
  email      text not null check (position('@' in email) > 1),
  created_at timestamptz not null default now()
);

alter table pp_private.director_alias enable row level security;
revoke all on table pp_private.director_alias from public, anon, authenticated;

create or replace function pp_private.director_email(p_username text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select email
  from pp_private.director_alias
  where username = lower(btrim(p_username));
$$;

revoke all on function pp_private.director_email(text) from public;
grant execute on function pp_private.director_email(text) to anon, authenticated;

create or replace function public.pp_director_email(p_username text)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select pp_private.director_email(p_username);
$$;

revoke all on function public.pp_director_email(text) from public;
grant execute on function public.pp_director_email(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Replace open pp_* policies
--    Public read stays. Writes require a director session.
--    Grants are tightened too: policies alone do not remove anon write grants.
-- ---------------------------------------------------------------------------
do $policy$
declare
  t text;
begin
  foreach t in array array[
    'pp_seasons', 'pp_players', 'pp_tags', 'pp_events', 'pp_entries', 'pp_ledger'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_access', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);

    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to anon, authenticated', t);
    execute format('grant insert, update, delete on table public.%I to authenticated', t);

    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (true)',
      t || '_select', t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select pp_private.is_admin()))',
      t || '_insert', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select pp_private.is_admin())) with check ((select pp_private.is_admin()))',
      t || '_update', t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select pp_private.is_admin()))',
      t || '_delete', t
    );
  end loop;
end
$policy$;

-- ---------------------------------------------------------------------------
-- 3. Link a director after you create the Auth user
-- Replace the email below, then run this block. It is safe to run again.
-- ---------------------------------------------------------------------------
-- insert into pp_private.admins (user_id)
-- select id from auth.users where email = 'director@your-domain.com'
-- on conflict (user_id) do nothing;
--
-- insert into pp_private.director_alias (username, email) values
--   ('admin', 'director@your-domain.com'),
--   ('les', 'director@your-domain.com')
-- on conflict (username) do update set email = excluded.email;
