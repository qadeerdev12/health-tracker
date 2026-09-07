# Supabase schema

Migrations run in filename order.

| File | Contents |
| --- | --- |
| `20260907190000_core.sql` | `profiles`, `body_measurements`, the `updated_at` helper, and the trigger that creates a profile on signup |
| `20260907190100_whoop.sql` | `whoop_connections`, `whoop_tokens`, and the synced mirrors of cycles / recoveries / sleeps / workouts |
| `20260907190200_nutrition.sql` | `foods`, `food_log_entries`, and the `daily_nutrition` / `daily_balance` views |

## Applying them

With the Supabase CLI linked to the project:

```bash
supabase db push
```

Or paste each file into the SQL editor in order. The CLI is not installed on this
machine yet:

```bash
brew install supabase/tap/supabase
```

## The five decisions worth knowing

**Tokens are in their own table.** `whoop_tokens` has RLS enabled and *no
policies at all*, so no authenticated client can read it under any query — only
the service role, which bypasses RLS. Link status lives in `whoop_connections`,
which the app can read. Putting both in one table would have forced a choice
between exposing tokens and hiding link status.

**The WHOOP mirrors are read-only to the app.** Only the server writes them.
This is a rate-limit decision as much as a security one: 100 req/min and
10k/day, likely per-app, means no screen may ever read through to WHOOP.

**Macros are snapshotted onto every log entry, not joined.** Catalogue rows get
corrected and Open Food Facts entries get edited by strangers. `food_id` remains
as a pointer for "log this again", but last March's lunch keeps the numbers it
was logged with.

**`portion_confidence` is on every entry** — `weighed` / `measured` /
`estimated`. This is what lets one app serve a user who weighs food and a user
who eyeballs it without the second silently poisoning correlations built on the
first. It cannot be backfilled, which is why it exists now rather than later.

**No FK from `whoop_recoveries` to `whoop_cycles`.** Webhooks arrive in no
guaranteed order, and a recovery landing before its cycle must not be rejected.

## Verified

Applied against local PostgreSQL 16 with a stubbed `auth` schema, then exercised:
the signup trigger creates profiles; the check constraints reject a custom food
without an owner, a catalogue food with one, a non-quick-add entry with no food,
negative calories, and an invalid confidence value; `daily_balance` joins burn,
recovery, sleep and intake into one row with correct arithmetic; and two users
under the `authenticated` role each see only their own rows, with `whoop_tokens`
returning zero rows to both.
