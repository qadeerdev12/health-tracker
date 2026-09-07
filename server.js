import express from 'express';
import { config, assertConfigured } from './src/config.js';
import { requireUser, UnauthorizedError } from './src/auth.js';
import {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  fetchWhoopUserId,
} from './src/whoop/oauth.js';
import { createState, consumeState, purgeExpiredStates } from './src/whoop/oauthStates.js';
import { whoopFor, NotAuthenticatedError, WhoopApiError } from './src/whoop/client.js';
import { getConnection, saveConnection, deleteConnection } from './src/whoop/tokenStore.js';
import { summarize } from './src/whoop/summarize.js';

assertConfigured();

const app = express();
app.use(express.json());

const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

/** Sends the user back into the app, with the outcome in the query string. */
function redirectToApp(res, params) {
  const url = new URL(config.appRedirectUrl);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  res.redirect(url.toString());
}

// --- OAuth ---------------------------------------------------------------

/**
 * Starts the flow. Authenticated, because the whole point is to bind the
 * `state` we are about to issue to a known user -- the callback has no other
 * way to find out who came back.
 *
 * Returns the URL rather than redirecting: the app opens it in an auth session
 * browser and needs the string, not a 302 it would have to follow itself.
 */
app.get(
  '/auth/whoop/start',
  requireUser,
  wrap(async (req, res) => {
    const state = await createState(req.userId);
    res.json({ authorizationUrl: buildAuthorizationUrl(state) });
  })
);

app.get(
  '/auth/whoop/callback',
  wrap(async (req, res) => {
    const { code, state, error, error_description: errorDescription } = req.query;

    if (error) {
      return redirectToApp(res, { error, error_description: errorDescription ?? '' });
    }

    // Single-use, and it is what identifies the user -- a callback we cannot
    // tie to an account is unusable even if the code is valid.
    const userId = await consumeState(state);
    if (!userId) {
      return redirectToApp(res, { error: 'invalid_state' });
    }
    if (!code) {
      return redirectToApp(res, { error: 'missing_code' });
    }

    const tokens = await exchangeCodeForTokens(code);

    // WHOOP's own user id is not in the token response, and it is what routes
    // incoming webhooks back to this account, so it is read before the
    // connection is written rather than patched in afterwards.
    const whoopUserId = await fetchWhoopUserId(tokens.accessToken);

    await saveConnection(userId, {
      whoopUserId,
      scopes: tokens.scope ? tokens.scope.split(/\s+/) : config.whoop.scopes,
      tokens,
    });

    purgeExpiredStates().catch((err) => console.error('state purge failed', err));
    redirectToApp(res, { connected: '1' });
  })
);

app.get(
  '/auth/whoop/status',
  requireUser,
  wrap(async (req, res) => {
    const connection = await getConnection(req.userId);
    res.json({
      connected: Boolean(connection && !connection.revoked_at),
      whoopUserId: connection?.whoop_user_id ?? null,
      scopes: connection?.scopes ?? [],
      connectedAt: connection?.connected_at ?? null,
      lastSyncedAt: connection?.last_synced_at ?? null,
    });
  })
);

/**
 * Disconnect. Revoking at WHOOP first matters: dropping our rows alone would
 * leave the grant standing in the user's WHOOP account with no way for them to
 * see it from here. A failure there is logged, not fatal -- the user asked to
 * disconnect and must end up disconnected locally regardless.
 */
app.delete(
  '/auth/whoop',
  requireUser,
  wrap(async (req, res) => {
    try {
      await whoopFor(req.userId).revokeAccess();
    } catch (err) {
      if (!(err instanceof NotAuthenticatedError)) {
        console.error('WHOOP revocation failed, deleting local rows anyway:', err.message);
      }
    }

    await deleteConnection(req.userId);
    res.json({ connected: false });
  })
);

// --- WHOOP passthrough ---------------------------------------------------
//
// Every route below is per-user and authenticated. These stay for debugging and
// for the initial backfill; the app must not call them on a screen render, or
// 10k requests/day gets spent on page views.

const paging = (req) => ({
  limit: req.query.limit,
  start: req.query.start,
  end: req.query.end,
  nextToken: req.query.nextToken,
});

app.use('/api/whoop', requireUser);

app.get('/api/whoop/profile', wrap(async (req, res) => res.json(await whoopFor(req.userId).getProfile())));
app.get('/api/whoop/body', wrap(async (req, res) => res.json(await whoopFor(req.userId).getBodyMeasurement())));
app.get('/api/whoop/cycles', wrap(async (req, res) => res.json(await whoopFor(req.userId).getCycles(paging(req)))));
app.get('/api/whoop/recovery', wrap(async (req, res) => res.json(await whoopFor(req.userId).getRecoveries(paging(req)))));
app.get('/api/whoop/sleep', wrap(async (req, res) => res.json(await whoopFor(req.userId).getSleeps(paging(req)))));
app.get('/api/whoop/workouts', wrap(async (req, res) => res.json(await whoopFor(req.userId).getWorkouts(paging(req)))));

/**
 * Profile, body, and the last N days joined into one row per cycle. Six
 * requests per call -- fine for a one-off backfill, not for a screen.
 */
app.get(
  '/api/whoop/overview',
  wrap(async (req, res) => {
    const api = whoopFor(req.userId);
    const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 60);
    const start = new Date(Date.now() - days * 86_400_000).toISOString();
    const range = { start, max: days + 5 };

    const [profile, body, cycles, recoveries, sleeps, workouts] = await Promise.all([
      api.getProfile(),
      api.getBodyMeasurement(),
      api.collectAll(api.getCycles, range),
      api.collectAll(api.getRecoveries, range),
      api.collectAll(api.getSleeps, range),
      api.collectAll(api.getWorkouts, { start, max: 100 }),
    ]);

    res.json({
      profile,
      body,
      rangeDays: days,
      ...summarize({ cycles, recoveries, sleeps, workouts }),
    });
  })
);

/** One call that touches every endpoint — the quickest "does this all work?" check. */
app.get(
  '/api/whoop/smoke-test',
  wrap(async (req, res) => {
    const api = whoopFor(req.userId);
    const checks = {
      profile: () => api.getProfile(),
      body: () => api.getBodyMeasurement(),
      cycles: () => api.getCycles({ limit: 1 }),
      recovery: () => api.getRecoveries({ limit: 1 }),
      sleep: () => api.getSleeps({ limit: 1 }),
      workouts: () => api.getWorkouts({ limit: 1 }),
    };

    const results = {};
    for (const [name, run] of Object.entries(checks)) {
      try {
        results[name] = { ok: true, sample: await run() };
      } catch (err) {
        results[name] = { ok: false, status: err.status ?? null, error: err.message };
      }
    }

    const allOk = Object.values(results).every((r) => r.ok);
    res.status(allOk ? 200 : 207).json({ ok: allOk, results });
  })
);

// --- Errors --------------------------------------------------------------

app.use((err, req, res, next) => {
  if (err instanceof UnauthorizedError) {
    return res.status(401).json({ error: err.message });
  }
  if (err instanceof NotAuthenticatedError) {
    return res.status(409).json({ error: err.message, connect: '/auth/whoop/start' });
  }
  if (err instanceof WhoopApiError) {
    return res.status(err.status).json({ error: err.message, whoopStatus: err.status });
  }
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(config.port, () => {
  console.log(`health-tracker on http://localhost:${config.port}`);
});
