import express from 'express';
import { config, assertConfigured } from './src/config.js';
import { buildAuthorizationUrl, exchangeCodeForTokens, generateState } from './src/whoop/oauth.js';
import { whoop, NotAuthenticatedError, WhoopApiError } from './src/whoop/client.js';
import { summarize } from './src/whoop/summarize.js';
import { loadTokens, saveTokens, clearTokens } from './src/tokenStore.js';

assertConfigured();

const app = express();
app.use(express.static('public'));

/** Pending OAuth `state` values, kept in memory for CSRF checking. */
const pendingStates = new Set();

const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

// --- OAuth ---------------------------------------------------------------

app.get('/auth/whoop', (req, res) => {
  const state = generateState();
  pendingStates.add(state);
  setTimeout(() => pendingStates.delete(state), 10 * 60 * 1000).unref();
  res.redirect(buildAuthorizationUrl(state));
});

app.get(
  '/auth/whoop/callback',
  wrap(async (req, res) => {
    const { code, state, error, error_description: errorDescription } = req.query;

    if (error) {
      return res.status(400).send(`WHOOP denied authorization: ${error} — ${errorDescription ?? ''}`);
    }
    if (!state || !pendingStates.delete(state)) {
      return res.status(400).send('Invalid or expired state parameter. Start again at /auth/whoop');
    }
    if (!code) {
      return res.status(400).send('No authorization code in callback.');
    }

    const tokens = await exchangeCodeForTokens(code);
    await saveTokens(tokens);
    res.redirect('/?connected=1');
  })
);

app.get(
  '/auth/status',
  wrap(async (req, res) => {
    const tokens = await loadTokens();
    res.json({
      connected: Boolean(tokens),
      scope: tokens?.scope ?? null,
      hasRefreshToken: Boolean(tokens?.refreshToken),
      accessTokenExpiresAt: tokens ? new Date(tokens.expiresAt).toISOString() : null,
    });
  })
);

app.post(
  '/auth/logout',
  wrap(async (req, res) => {
    await clearTokens();
    res.json({ connected: false });
  })
);

// --- WHOOP passthrough ---------------------------------------------------

const paging = (req) => ({
  limit: req.query.limit,
  start: req.query.start,
  end: req.query.end,
  nextToken: req.query.nextToken,
});

app.get('/api/whoop/profile', wrap(async (req, res) => res.json(await whoop.getProfile())));
app.get('/api/whoop/body', wrap(async (req, res) => res.json(await whoop.getBodyMeasurement())));
app.get('/api/whoop/cycles', wrap(async (req, res) => res.json(await whoop.getCycles(paging(req)))));
app.get('/api/whoop/recovery', wrap(async (req, res) => res.json(await whoop.getRecoveries(paging(req)))));
app.get('/api/whoop/sleep', wrap(async (req, res) => res.json(await whoop.getSleeps(paging(req)))));
app.get('/api/whoop/workouts', wrap(async (req, res) => res.json(await whoop.getWorkouts(paging(req)))));

/**
 * Everything the dashboard needs, in one round trip: profile, body, and the last
 * N days joined into one row per cycle. Fetched in parallel — WHOOP allows 100
 * requests/minute and this spends 6.
 */
app.get(
  '/api/whoop/overview',
  wrap(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 60);
    const start = new Date(Date.now() - days * 86_400_000).toISOString();
    const range = { start, max: days + 5 };

    const [profile, body, cycles, recoveries, sleeps, workouts] = await Promise.all([
      whoop.getProfile(),
      whoop.getBodyMeasurement(),
      whoop.collectAll(whoop.getCycles, range),
      whoop.collectAll(whoop.getRecoveries, range),
      whoop.collectAll(whoop.getSleeps, range),
      whoop.collectAll(whoop.getWorkouts, { start, max: 100 }),
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
    const checks = {
      profile: () => whoop.getProfile(),
      body: () => whoop.getBodyMeasurement(),
      cycles: () => whoop.getCycles({ limit: 1 }),
      recovery: () => whoop.getRecoveries({ limit: 1 }),
      sleep: () => whoop.getSleeps({ limit: 1 }),
      workouts: () => whoop.getWorkouts({ limit: 1 }),
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
  if (err instanceof NotAuthenticatedError) {
    return res.status(401).json({ error: err.message, connectUrl: '/auth/whoop' });
  }
  if (err instanceof WhoopApiError) {
    return res.status(err.status).json({ error: err.message, whoopStatus: err.status });
  }
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(config.port, () => {
  console.log(`health-tracker on http://localhost:${config.port}`);
  console.log(`connect WHOOP at http://localhost:${config.port}/auth/whoop`);
});
