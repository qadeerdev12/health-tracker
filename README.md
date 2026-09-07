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
2. ```bash
   cp .env.example .env
   ```
   Fill in `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET`.
3. ```bash
   npm install && npm start
   ```
4. Open http://localhost:3000, click **Connect**, approve, and pick an endpoint.

## The two pages

- **`/` — raw JSON dashboard.** The main view. Endpoint list down the side, response
  pretty-printed with collapsible nodes and syntax colouring, plus status code, latency,
  payload size and record count. **Copy** puts the unformatted response on the clipboard.
- **`/charts.html` — charted view.** The same data joined into one row per cycle and
  drawn as charts (energy burned, recovery, strain, sleep stages) with a workouts table.
  Every chart has a table-view toggle.

## What's here

| File | Role |
| --- | --- |
| `src/whoop/oauth.js` | Authorization URL, code exchange, token refresh |
| `src/whoop/client.js` | Authenticated API client — auto-refresh on expiry/401, pagination |
| `src/whoop/summarize.js` | Joins cycles + recovery + sleep by `cycle_id`; kJ → kcal |
| `src/tokenStore.js` | File-backed token storage (single user, dev only) |
| `server.js` | OAuth routes + `/api/whoop/*` passthrough + `/overview` + smoke test |
| `public/index.html` | Raw JSON dashboard |
| `public/charts.html` | Charted dashboard |

## Endpoints

Base URL is `https://api.prod.whoop.com/developer`.

| Wrapper method | WHOOP endpoint |
| --- | --- |
| `whoop.getProfile()` | `GET /v2/user/profile/basic` |
| `whoop.getBodyMeasurement()` | `GET /v2/user/measurement/body` |
| `whoop.getCycles({limit,start,end,nextToken})` | `GET /v2/cycle` |
| `whoop.getCycle(id)` | `GET /v2/cycle/{cycleId}` |
| `whoop.getSleepForCycle(id)` | `GET /v2/cycle/{cycleId}/sleep` |
| `whoop.getRecoveryForCycle(id)` | `GET /v2/cycle/{cycleId}/recovery` |
| `whoop.getRecoveries(params)` | `GET /v2/recovery` |
| `whoop.getSleeps(params)` / `getSleep(id)` | `GET /v2/activity/sleep` |
| `whoop.getWorkouts(params)` / `getWorkout(id)` | `GET /v2/activity/workout` |

`whoop.collectAll(whoop.getWorkouts, { start, end, max })` walks `next_token` pages for you.

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
