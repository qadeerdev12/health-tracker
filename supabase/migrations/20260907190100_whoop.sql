-- WHOOP: the OAuth link, and a local mirror of the collections we sync.
--
-- The mirror exists because of rate limits (100/min, 10k/day, most likely
-- per-app). The app must never read through to WHOOP on a screen render; it
-- reads these tables, and the server fills them from webhooks.
--
-- WHOOP ids are text throughout. In API v2 cycle ids are integers while sleep
-- and workout ids are UUIDs; text sidesteps the mismatch and survives WHOOP
-- changing its mind again.

create table public.whoop_connections (
  user_id uuid primary key references auth.users on delete cascade,
  -- Webhooks arrive carrying only WHOOP's own user id. This is what routes an
  -- incoming event back to an account, so it has to be unique and indexed.
  whoop_user_id text not null unique,
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_synced_at timestamptz,
  updated_at timestamptz not null default now()
);

create trigger whoop_connections_set_updated_at
  before update on public.whoop_connections
  for each row execute function public.set_updated_at();

alter table public.whoop_connections enable row level security;

-- The app needs to know whether WHOOP is linked, and to be able to unlink.
-- It never needs to write the link -- that only happens in the OAuth callback,
-- which runs on the server under the service role.
create policy "read own connection" on public.whoop_connections
  for select using ((select auth.uid()) = user_id);
create policy "delete own connection" on public.whoop_connections
  for delete using ((select auth.uid()) = user_id);

-- Tokens live in their own table with RLS on and NO policies, which means no
-- authenticated client can reach them under any query -- only the service role,
-- which bypasses RLS. Keeping them in whoop_connections would have forced a
-- choice between exposing tokens to the client and hiding link status from it.
create table public.whoop_tokens (
  user_id uuid primary key references public.whoop_connections(user_id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create trigger whoop_tokens_set_updated_at
  before update on public.whoop_tokens
  for each row execute function public.set_updated_at();

alter table public.whoop_tokens enable row level security;

-- One row per physiological cycle: WHOOP's notion of a day, which does not line
-- up with midnight. local_date is computed server-side from the cycle's own
-- timezone_offset, the same way src/whoop/summarize.js does it.
create table public.whoop_cycles (
  user_id uuid not null references auth.users on delete cascade,
  cycle_id text not null,
  local_date date not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  timezone_offset text,
  strain numeric(4, 2),
  kcal numeric(7, 1),
  average_heart_rate integer,
  max_heart_rate integer,
  score_state text,
  -- The untouched payload. Re-deriving a column from this beats spending rate
  -- limit re-fetching history you already hold.
  raw jsonb,
  synced_at timestamptz not null default now(),
  primary key (user_id, cycle_id)
);

create index whoop_cycles_by_date on public.whoop_cycles (user_id, local_date desc);

-- Recovery is 1:1 with a cycle and keyed by cycle_id. There is deliberately no
-- foreign key to whoop_cycles: webhooks arrive in no guaranteed order, and a
-- recovery landing before its cycle must not be rejected.
create table public.whoop_recoveries (
  user_id uuid not null references auth.users on delete cascade,
  cycle_id text not null,
  sleep_id text,
  recovery_score integer,
  resting_heart_rate integer,
  hrv_rmssd_milli numeric(8, 3),
  spo2_percentage numeric(5, 2),
  skin_temp_celsius numeric(4, 1),
  user_calibrating boolean not null default false,
  score_state text,
  raw jsonb,
  synced_at timestamptz not null default now(),
  primary key (user_id, cycle_id)
);

create table public.whoop_sleeps (
  user_id uuid not null references auth.users on delete cascade,
  sleep_id text not null,
  cycle_id text,
  is_nap boolean not null default false,
  local_date date not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,

  in_bed_milli bigint,
  asleep_milli bigint,
  awake_milli bigint,
  light_milli bigint,
  slow_wave_milli bigint,
  rem_milli bigint,
  needed_milli bigint,

  sleep_cycle_count integer,
  disturbance_count integer,
  performance_pct numeric(5, 2),
  efficiency_pct numeric(5, 2),
  consistency_pct numeric(5, 2),
  respiratory_rate numeric(5, 2),

  score_state text,
  raw jsonb,
  synced_at timestamptz not null default now(),
  primary key (user_id, sleep_id)
);

create index whoop_sleeps_by_date on public.whoop_sleeps (user_id, local_date desc);
-- Meal-timing correlations look up "the sleep that started after this meal",
-- so started_at needs its own index.
create index whoop_sleeps_by_start on public.whoop_sleeps (user_id, started_at desc);

create table public.whoop_workouts (
  user_id uuid not null references auth.users on delete cascade,
  workout_id text not null,
  sport_name text,
  local_date date not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  strain numeric(4, 2),
  kcal numeric(7, 1),
  average_heart_rate integer,
  max_heart_rate integer,
  distance_meter numeric(10, 2),
  altitude_gain_meter numeric(8, 2),
  percent_recorded numeric(5, 2),
  zone_durations jsonb,
  score_state text,
  raw jsonb,
  synced_at timestamptz not null default now(),
  primary key (user_id, workout_id)
);

create index whoop_workouts_by_date on public.whoop_workouts (user_id, local_date desc);

-- All four mirrors are read-only to the app: the server owns every write.
alter table public.whoop_cycles enable row level security;
alter table public.whoop_recoveries enable row level security;
alter table public.whoop_sleeps enable row level security;
alter table public.whoop_workouts enable row level security;

create policy "read own cycles" on public.whoop_cycles
  for select using ((select auth.uid()) = user_id);
create policy "read own recoveries" on public.whoop_recoveries
  for select using ((select auth.uid()) = user_id);
create policy "read own sleeps" on public.whoop_sleeps
  for select using ((select auth.uid()) = user_id);
create policy "read own workouts" on public.whoop_workouts
  for select using ((select auth.uid()) = user_id);
