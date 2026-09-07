import { db } from '../supabase.js';

/**
 * Per-user WHOOP credentials, split across two tables on purpose:
 *
 *   whoop_connections -- link status, readable by the owning user via RLS
 *   whoop_tokens      -- the secrets, RLS on with no policies, service role only
 *
 * Every function here is keyed by *our* user id, never WHOOP's. The one place
 * WHOOP's id is the key is webhook delivery, which is why it is stored and
 * uniquely indexed on the connection.
 */

export async function getConnection(userId) {
  const { data, error } = await db
    .from('whoop_connections')
    .select('whoop_user_id, scopes, connected_at, revoked_at, last_synced_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(`Could not read WHOOP connection: ${error.message}`);
  return data ?? null;
}

export async function loadTokens(userId) {
  const { data, error } = await db
    .from('whoop_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(`Could not read WHOOP tokens: ${error.message}`);
  if (!data) return null;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(data.expires_at).getTime(),
  };
}

/**
 * Called once, from the OAuth callback. The connection row has to land before
 * the token row: whoop_tokens.user_id is a foreign key to it.
 */
export async function saveConnection(userId, { whoopUserId, scopes, tokens }) {
  const { error: connectionError } = await db.from('whoop_connections').upsert(
    {
      user_id: userId,
      whoop_user_id: String(whoopUserId),
      scopes,
      connected_at: new Date().toISOString(),
      revoked_at: null,
    },
    { onConflict: 'user_id' }
  );

  if (connectionError) {
    throw new Error(`Could not save WHOOP connection: ${connectionError.message}`);
  }

  await saveTokens(userId, tokens);
}

export async function saveTokens(userId, tokens) {
  const { error } = await db.from('whoop_tokens').upsert(
    {
      user_id: userId,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: new Date(tokens.expiresAt).toISOString(),
    },
    { onConflict: 'user_id' }
  );

  if (error) throw new Error(`Could not save WHOOP tokens: ${error.message}`);
}

/**
 * Deleting the connection cascades to whoop_tokens. The synced mirrors are left
 * alone: reconnecting the same account should not mean re-fetching history that
 * is already stored, and re-fetching costs rate limit.
 */
export async function deleteConnection(userId) {
  const { error } = await db.from('whoop_connections').delete().eq('user_id', userId);
  if (error) throw new Error(`Could not disconnect WHOOP: ${error.message}`);
}
