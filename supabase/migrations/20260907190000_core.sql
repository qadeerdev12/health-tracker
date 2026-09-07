-- Core: the user's own profile and body measurements.
--
-- Every table in this schema is row-level-secured to auth.uid(). Policies wrap
-- the call as (select auth.uid()) so Postgres hoists it into an InitPlan and
-- evaluates it once per query instead of once per row.

create extension if not exists pg_trgm;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  date_of_birth date,
  sex text check (sex in ('male', 'female', 'other')),
  height_cm numeric(5, 1) check (height_cm > 0),

  goal text not null default 'maintain' check (goal in ('cut', 'maintain', 'bulk')),
  -- Negative for a cut. Drives the daily target on top of WHOOP's measured burn.
  goal_rate_kg_per_week numeric(3, 2) not null default 0,
  protein_target_g integer check (protein_target_g >= 0),

  -- IANA name. WHOOP returns UTC plus an offset; this is the fallback for
  -- bucketing food logged when no cycle has been synced yet.
  timezone text not null default 'UTC',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

create policy "read own profile" on public.profiles
  for select using ((select auth.uid()) = id);
create policy "insert own profile" on public.profiles
  for insert with check ((select auth.uid()) = id);
create policy "update own profile" on public.profiles
  for update using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- A profile row should exist from the moment the account does, so the app never
-- has to handle "signed in but no profile".
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Weight over time. Needed for more than display: comparing predicted weight
-- change against actual is what lets you calibrate out a consistent logging
-- bias later.
create table public.body_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  measured_on date not null,
  weight_kg numeric(5, 2) check (weight_kg > 0),
  body_fat_pct numeric(4, 1) check (body_fat_pct between 0 and 100),
  source text not null default 'manual' check (source in ('manual', 'whoop')),
  created_at timestamptz not null default now(),
  unique (user_id, measured_on, source)
);

alter table public.body_measurements enable row level security;

create policy "read own measurements" on public.body_measurements
  for select using ((select auth.uid()) = user_id);
create policy "insert own measurements" on public.body_measurements
  for insert with check ((select auth.uid()) = user_id);
create policy "update own measurements" on public.body_measurements
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own measurements" on public.body_measurements
  for delete using ((select auth.uid()) = user_id);
