# health-tracker

Calorie/health tracking app, built around one idea: WHOOP measures what your body
actually burned, so the calorie target can be the real number instead of a formula.

Two parts:

| Directory | What it is |
| --- | --- |
| `.` (root) | Express server. Holds the WHOOP client secret, runs OAuth, and will sync WHOOP records into Supabase. |
| `mobile/` | The Expo / React Native app. See [mobile/README.md](mobile/README.md). |

The split is not optional: `WHOOP_CLIENT_SECRET` cannot live in the app, because
everything in a React Native bundle is extractable. The app talks to the server;
only the server talks to WHOOP.

The sections below cover the server.

## Setup

1. Create an app in the [WHOOP Developer Dashboard](https://developer-dashboard.whoop.com).
   Register `http://localhost:3000/auth/whoop/callback` as a Redirect URI — it must match
   `WHOOP_REDIRECT_URI` exactly, and add yourself under the app's members so the account
   you log in with is allowed to authorize it.
2. Apply the migrations in [supabase/](supabase/) to your Supabase project.
3. ```bash
   cp .env.example .env
   ```
   Fill in the WHOOP credentials plus `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
4. ```bash
   npm install && npm start
   ```

## Routes

Everything except the callback requires a `Authorization: Bearer <supabase access token>`
header — the token the app already holds after signing in. The server resolves it to a
user id through Supabase and scopes every query to that user.

| Route | Purpose |
| --- | --- |
| `GET /auth/whoop/start` | Issues a `state` bound to the caller and returns the WHOOP authorization URL for the app to open |
| `GET /auth/whoop/callback` | WHOOP redirects here. Unauthenticated by necessity — `state` is what identifies the user |
| `GET /auth/whoop/status` | Whether this account has WHOOP linked |
| `DELETE /auth/whoop` | Revokes at WHOOP, then drops the local rows |
| `GET /api/whoop/*` | Per-user passthrough. For debugging and backfill only — see the rate-limit note below |

### The `state` parameter carries the identity

WHOOP's callback is a bare redirect: no session cookie, and the token response says
nothing about who is coming back. So `state` cannot just prove "we started some flow" —
it has to answer "**which** of our users is this". That binding lives in
`whoop_oauth_states`, in the database rather than in memory, so the flow survives a
restart and works with more than one server instance. Rows are single-use: consumed on
read, which is what makes a replayed callback fail.

### Do not call `/api/whoop/*` from a screen

WHOOP allows 100 requests/minute and 10,000/day, most likely per app rather than per
user. `/api/whoop/overview` alone spends 6. The app reads Supabase; the server fills
Supabase from webhooks. These passthrough routes exist for debugging and the initial
backfill.

### The old HTML dashboards no longer work

`public/index.html` and `public/charts.html` were built against unauthenticated,
single-user endpoints. Those endpoints now require a Supabase token, and the server no
longer serves the `public/` directory at all. The files are still in the tree; the React
Native app in [mobile/](mobile/) replaces them.

## Endpoints

Base URL is `https://api.prod.whoop.com/developer`. The client is built per user with
`whoopFor(userId)` — binding at construction rather than passing a user id into every
call, so a handler cannot accidentally read another account's data.

| Wrapper method | WHOOP endpoint |
| --- | --- |
| `api.getProfile()` | `GET /v2/user/profile/basic` |
| `api.getBodyMeasurement()` | `GET /v2/user/measurement/body` |
| `api.getCycles({limit,start,end,nextToken})` | `GET /v2/cycle` |
| `api.getCycle(id)` | `GET /v2/cycle/{cycleId}` |
| `api.getSleepForCycle(id)` | `GET /v2/cycle/{cycleId}/sleep` |
| `api.getRecoveryForCycle(id)` | `GET /v2/cycle/{cycleId}/recovery` |
| `api.getRecoveries(params)` | `GET /v2/recovery` |
| `api.getSleeps(params)` / `getSleep(id)` | `GET /v2/activity/sleep` |
| `api.getWorkouts(params)` / `getWorkout(id)` | `GET /v2/activity/workout` |

`api.collectAll(api.getWorkouts, { start, end, max })` walks `next_token` pages for you.

The server adds one endpoint of its own: `GET /api/whoop/overview?days=N` fetches all six
in parallel and returns them joined into one row per cycle, with kilojoules converted to
kcal (`kJ × 0.239006`).

## Things that will bite you

- **`offline` scope is mandatory** for a refresh token. Without it the connection dies after
  the access token expires (~1 hour) and you have to re-authorize by hand.
- **Refreshing invalidates the old refresh token**, and two concurrent refreshes will fail.
  The client serializes them behind a single in-flight promise.
- **`state` must be at least 8 characters** or WHOOP rejects the authorization request.
- **`limit` caps at 25** on every collection endpoint; use `nextToken` for more.
- **Rate limit is 100 requests/minute.** `collectAll` defaults to `max: 200` for that reason.
- **v2 IDs for sleep and workout are UUIDs**, not the integers v1 used. Store them as strings.

## Not production-ready

`.tokens.json` holds a single user's tokens in plaintext on disk. Before this turns into a
real app: per-user rows in a database, encrypted at rest, plus webhook subscriptions instead
of polling.
