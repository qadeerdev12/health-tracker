import { config } from '../config.js';
import { loadTokens, saveTokens } from '../tokenStore.js';
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
    super('No WHOOP tokens stored. Visit /auth/whoop to connect an account.');
    this.name = 'NotAuthenticatedError';
  }
}

/** Serializes refreshes so parallel 401s don't race and invalidate each other. */
let refreshInFlight = null;

async function getValidAccessToken() {
  const tokens = await loadTokens();
  if (!tokens) throw new NotAuthenticatedError();
  if (Date.now() < tokens.expiresAt) return tokens.accessToken;
  return forceRefresh();
}

async function forceRefresh() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const tokens = await loadTokens();
    if (!tokens?.refreshToken) {
      throw new NotAuthenticatedError();
    }
    const fresh = await refreshTokens(tokens.refreshToken);
    // A refresh response without `offline` carries no new refresh token; keep the old one.
    await saveTokens({ ...fresh, refreshToken: fresh.refreshToken ?? tokens.refreshToken });
    return fresh.accessToken;
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

async function request(path, { query = {}, retryOn401 = true } = {}) {
  const url = new URL(apiBase + path);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const accessToken = await getValidAccessToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });

  if (res.status === 401 && retryOn401) {
    await forceRefresh();
    return request(path, { query, retryOn401: false });
  }

  if (!res.ok) {
    throw new WhoopApiError(res.status, path, await res.text());
  }

  return res.json();
}

/** Collection endpoints share limit/start/end/nextToken. `limit` maxes out at 25. */
function collection(path) {
  return ({ limit, start, end, nextToken } = {}) =>
    request(path, { query: { limit, start, end, nextToken } });
}

export const whoop = {
  getProfile: () => request('/v2/user/profile/basic'),
  getBodyMeasurement: () => request('/v2/user/measurement/body'),

  getCycles: collection('/v2/cycle'),
  getCycle: (cycleId) => request(`/v2/cycle/${cycleId}`),
  getSleepForCycle: (cycleId) => request(`/v2/cycle/${cycleId}/sleep`),
  getRecoveryForCycle: (cycleId) => request(`/v2/cycle/${cycleId}/recovery`),

  getRecoveries: collection('/v2/recovery'),

  getSleeps: collection('/v2/activity/sleep'),
  getSleep: (sleepId) => request(`/v2/activity/sleep/${sleepId}`),

  getWorkouts: collection('/v2/activity/workout'),
  getWorkout: (workoutId) => request(`/v2/activity/workout/${workoutId}`),

  /**
   * Walks `next_token` pages of a collection method until exhausted or `max`
   * records are collected. WHOOP rate-limits at 100 req/min, so don't pull
   * years of history in one call.
   */
  async collectAll(method, { max = 200, ...params } = {}) {
    const records = [];
    let nextToken;

    do {
      const page = await method({ ...params, limit: Math.min(25, max - records.length), nextToken });
      records.push(...(page.records ?? []));
      nextToken = page.next_token;
    } while (nextToken && records.length < max);

    return records;
  },
};
