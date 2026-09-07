-- Nutrition: the food catalogue and the log.

-- Foods are either catalogue entries pulled from USDA / Open Food Facts and
-- shared by everyone, or a user's own custom food. owner_id distinguishes them,
-- and the check constraint keeps the two from drifting into each other.
--
-- Everything is per 100 g. Both sources normalise to that, and it means a log
-- entry is one multiplication away regardless of where the food came from.
create table public.foods (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('usda', 'off', 'custom')),
  source_id text,
  owner_id uuid references auth.users on delete cascade,

  name text not null,
  brand text,
  barcode text,

  kcal numeric(7, 2) not null check (kcal >= 0),
  protein_g numeric(6, 2) check (protein_g >= 0),
  carbs_g numeric(6, 2) check (carbs_g >= 0),
  fat_g numeric(6, 2) check (fat_g >= 0),
  fiber_g numeric(6, 2) check (fiber_g >= 0),
  sugar_g numeric(6, 2) check (sugar_g >= 0),
  sodium_mg numeric(8, 2) check (sodium_mg >= 0),

  -- Optional household portion, e.g. "1 slice" = 28 g. The escape hatch for
  -- logging without a scale.
  serving_label text,
  serving_g numeric(7, 2) check (serving_g > 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint foods_custom_has_owner check ((source = 'custom') = (owner_id is not null))
);

create trigger foods_set_updated_at
  before update on public.foods
  for each row execute function public.set_updated_at();

create unique index foods_source_key on public.foods (source, source_id)
  where source_id is not null;
create index foods_barcode on public.foods (barcode) where barcode is not null;
create index foods_name_trgm on public.foods using gin (name gin_trgm_ops);

alter table public.foods enable row level security;

create policy "read catalogue and own foods" on public.foods
  for select using (owner_id is null or (select auth.uid()) = owner_id);
create policy "insert own foods" on public.foods
  for insert with check ((select auth.uid()) = owner_id);
create policy "update own foods" on public.foods
  for update using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "delete own foods" on public.foods
  for delete using ((select auth.uid()) = owner_id);

-- The log. Three things here are worth defending:
--
-- 1. The macros are snapshotted, not joined. Catalogue rows get corrected and
--    Open Food Facts entries get edited by strangers; last March's lunch must
--    not silently change its calorie count. food_id stays as a pointer for
--    "log this again", and is nullable so a quick-add needs no catalogue row.
--
-- 2. portion_confidence is the field that lets one app serve a user who weighs
--    food and a user who eyeballs it. Without it, mixing the two silently
--    poisons every correlation built on top. It cannot be backfilled.
--
-- 3. eaten_at is a real timestamp, separate from local_date. Daily totals need
--    the date; "did eating late hurt my sleep" needs the clock time.
create table public.food_log_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  food_id uuid references public.foods on delete set null,

  eaten_at timestamptz not null,
  local_date date not null,
  meal text check (meal in ('breakfast', 'lunch', 'dinner', 'snack')),

  quantity_g numeric(7, 2) check (quantity_g > 0),
  entry_source text not null
    check (entry_source in ('barcode', 'search', 'frequent', 'photo', 'quick_add', 'recipe')),
  portion_confidence text not null
    check (portion_confidence in ('weighed', 'measured', 'estimated')),

  name text not null,
  kcal numeric(7, 2) not null check (kcal >= 0),
  protein_g numeric(6, 2) check (protein_g >= 0),
  carbs_g numeric(6, 2) check (carbs_g >= 0),
  fat_g numeric(6, 2) check (fat_g >= 0),
  fiber_g numeric(6, 2) check (fiber_g >= 0),

  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A quick-add is a bare calorie number with no food and no weight. Everything
  -- else has to say what was eaten and how much.
  constraint food_log_quick_add_shape check (
    entry_source = 'quick_add' or (food_id is not null and quantity_g is not null)
  )
);

create trigger food_log_entries_set_updated_at
  before update on public.food_log_entries
  for each row execute function public.set_updated_at();

create index food_log_by_date on public.food_log_entries (user_id, local_date desc);
create index food_log_by_time on public.food_log_entries (user_id, eaten_at desc);
-- Powers the frequents list, which is what makes logging fast once your diet
-- settles into its usual loop.
create index food_log_by_food on public.food_log_entries (user_id, food_id)
  where food_id is not null;

alter table public.food_log_entries enable row level security;

create policy "read own log" on public.food_log_entries
  for select using ((select auth.uid()) = user_id);
create policy "insert own log" on public.food_log_entries
  for insert with check ((select auth.uid()) = user_id);
create policy "update own log" on public.food_log_entries
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own log" on public.food_log_entries
  for delete using ((select auth.uid()) = user_id);

-- security_invoker makes the view run under the caller's RLS rather than the
-- view owner's, so these inherit the policies above instead of leaking.
create view public.daily_nutrition with (security_invoker = on) as
select
  user_id,
  local_date,
  sum(kcal) as kcal,
  sum(protein_g) as protein_g,
  sum(carbs_g) as carbs_g,
  sum(fat_g) as fat_g,
  sum(fiber_g) as fiber_g,
  count(*) as entry_count,
  count(*) filter (where portion_confidence = 'estimated') as estimated_count
from public.food_log_entries
group by user_id, local_date;

-- The product, in one query: measured burn against logged intake, with the
-- recovery context that makes the number mean something.
create view public.daily_balance with (security_invoker = on) as
select
  c.user_id,
  c.local_date,
  c.kcal as burned_kcal,
  c.strain,
  r.recovery_score,
  r.hrv_rmssd_milli,
  r.resting_heart_rate,
  s.asleep_milli,
  s.performance_pct as sleep_performance_pct,
  n.kcal as consumed_kcal,
  n.protein_g,
  n.entry_count,
  n.estimated_count,
  n.kcal - c.kcal as balance_kcal
from public.whoop_cycles c
left join public.whoop_recoveries r
  on r.user_id = c.user_id and r.cycle_id = c.cycle_id
left join public.whoop_sleeps s
  on s.user_id = c.user_id and s.cycle_id = c.cycle_id and not s.is_nap
left join public.daily_nutrition n
  on n.user_id = c.user_id and n.local_date = c.local_date;
