import { config } from '../config.js';

const { clientId, clientSecret, redirectUri, scopes, authUrl, tokenUrl, apiBase } = config.whoop;

export function buildAuthorizationUrl(state) {
  const url = new URL(authUrl);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}

async function postToken(params) {
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`WHOOP token request failed (${res.status}): ${body}`);
  }

  const token = JSON.parse(body);
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    tokenType: token.token_type,
    scope: token.scope,
    // Renew a minute early so a request never leaves with a token about to die.
    expiresAt: Date.now() + (token.expires_in - 60) * 1000,
  };
}

export function exchangeCodeForTokens(code) {
  return postToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
}

export function refreshTokens(refreshToken) {
  // `offline` has to be re-requested here or the response comes back without a
  // new refresh token, and the old one is already invalidated at that point.
  return postToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: 'offline',
  });
}

/**
 * Reads the WHOOP user id straight from a freshly issued access token.
 *
 * The token response does not carry it, and it is needed *before* anything is
 * stored -- whoop_user_id is NOT NULL and UNIQUE on the connection, so there is
 * no valid placeholder to write first and correct afterwards. Deliberately a
 * bare fetch rather than the client: the client reads tokens out of the store,
 * and at this point nothing has been stored.
 */
export async function fetchWhoopUserId(accessToken) {
  const res = await fetch(`${apiBase}/v2/user/profile/basic`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Could not read WHOOP profile (${res.status}): ${await res.text()}`);
  }

  const profile = await res.json();
  return profile.user_id;
}
