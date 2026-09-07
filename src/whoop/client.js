import { config } from '../config.js';
import { loadTokens, saveTokens } from './tokenStore.js';
import { refreshTokens } from './oauth.js';

const { apiBase } = config.whoop;

export class WhoopApiError extends Error {
  constructor(status, path, body) {
    super(`WHOOP ${path} failed (${status}): ${body}`);
    this.name = 'WhoopApiError';
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

export class NotAuthenticatedError extends Error {
  constructor() {
    super('This account has not connected WHOOP.');
    this.name = 'NotAuthenticatedError';
  }
}

/**
 * Refreshes in flight, keyed by user id.
 *
 * WHOOP invalidates the old refresh token the moment a new pair is issued, so
 * two concurrent refreshes for the same user would leave one holding a dead
 * token. Serializing per user prevents that; using a single global promise --
 * which is what this was when the server had one user -- would instead make
 * every user queue behind whoever refreshed first, and hand them each other's
 * access tokens.
 */
const refreshesInFlight = new Map();

async function getValidAccessToken(userId) {
  const tokens = await loadTokens(userId);
  if (!tokens) throw new NotAuthenticatedError();
  if (Date.now() < tokens.expiresAt) return tokens.accessToken;
  return forceRefresh(userId);
}

function forceRefresh(userId) {
  const existing = refreshesInFlight.get(userId);
  if (existing) return existing;

  const refresh = (async () => {
    const tokens = await loadTokens(userId);
    if (!tokens?.refreshToken) {
      throw new NotAuthenticatedError();
    }
    const fresh = await refreshTokens(tokens.refreshToken);
    // A refresh response without `offline` carries no new refresh token; keep the old one.
    await saveTokens(userId, { ...fresh, refreshToken: fresh.refreshToken ?? tokens.refreshToken });
    return fresh.accessToken;
  })().finally(() => {
    refreshesInFlight.delete(userId);
  });

  refreshesInFlight.set(userId, refresh);
  return refresh;
}

async function request(userId, path, { query = {}, method = 'GET', retryOn401 = true } = {}) {
  const url = new URL(apiBase + path);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const accessToken = await getValidAccessToken(userId);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });

  if (res.status === 401 && retryOn401) {
    await forceRefresh(userId);
    return request(userId, path, { query, method, retryOn401: false });
  }

  if (!res.ok) {
    throw new WhoopApiError(res.status, path, await res.text());
  }

  // Revocation answers 204 with no body.
  return res.status === 204 ? null : res.json();
}

/**
 * A WHOOP client bound to one of our users.
 *
 * Binding at construction rather than threading a userId through every call is
 * what keeps a route from accidentally reading someone else's data: a handler
 * builds the client once from the authenticated request and cannot reach past
 * it.
 */
export function whoopFor(userId) {
  if (!userId) throw new Error('whoopFor requires a user id.');

  const get = (path, query) => request(userId, path, { query });

  /** Collection endpoints share limit/start/end/nextToken. `limit` maxes out at 25. */
  const collection =
    (path) =>
    ({ limit, start, end, nextToken } = {}) =>
      get(path, { limit, start, end, nextToken });

  const api = {
    getProfile: () => get('/v2/user/profile/basic'),
    getBodyMeasurement: () => get('/v2/user/measurement/body'),

    getCycles: collection('/v2/cycle'),
    getCycle: (cycleId) => get(`/v2/cycle/${cycleId}`),
    getSleepForCycle: (cycleId) => get(`/v2/cycle/${cycleId}/sleep`),
    getRecoveryForCycle: (cycleId) => get(`/v2/cycle/${cycleId}/recovery`),

    getRecoveries: collection('/v2/recovery'),

    getSleeps: collection('/v2/activity/sleep'),
    getSleep: (sleepId) => get(`/v2/activity/sleep/${sleepId}`),

    getWorkouts: collection('/v2/activity/workout'),
    getWorkout: (workoutId) => get(`/v2/activity/workout/${workoutId}`),

    /**
     * Revokes this app's access at WHOOP's end. Dropping our rows without
     * calling this leaves the grant standing in the user's WHOOP account.
     */
    revokeAccess: () => request(userId, '/v2/user/access', { method: 'DELETE' }),

    /**
     * Walks `next_token` pages of a collection method until exhausted or `max`
     * records are collected. WHOOP rate-limits at 100 req/min, so don't pull
     * years of history in one call.
     */
    async collectAll(method, { max = 200, ...params } = {}) {
      const records = [];
      let nextToken;

      do {
        const page = await method({
          ...params,
          limit: Math.min(25, max - records.length),
          nextToken,
        });
        records.push(...(page.records ?? []));
        nextToken = page.next_token;
      } while (nextToken && records.length < max);

      return records;
    },
  };

  return api;
}
