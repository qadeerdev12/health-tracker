import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { db } from '../supabase.js';

/** WHOOP rejects a `state` shorter than 8 characters. */
const newState = () => randomBytes(16).toString('hex');

/**
 * Rejects a return URL the app is not allowed to ask for. Without this the
 * callback would redirect anywhere a caller named, which is an open redirect.
 */
export function isAllowedReturnUrl(url) {
  if (!url) return false;
  return config.appRedirectAllowlist.some((prefix) => url.startsWith(prefix));
}

export async function createState(userId, returnUrl) {
  const state = newState();
  const expiresAt = new Date(Date.now() + config.whoop.stateTtlMs).toISOString();

  const { error } = await db.from('whoop_oauth_states').insert({
    state,
    user_id: userId,
    return_url: returnUrl ?? null,
    expires_at: expiresAt,
  });

  if (error) throw new Error(`Could not start WHOOP authorization: ${error.message}`);
  return state;
}

/**
 * Single-use: the row is deleted as it is read, so a replayed callback finds
 * nothing. Returns { userId, returnUrl } for the flow, or null.
 */
export async function consumeState(state) {
  if (!state) return null;

  const { data, error } = await db
    .from('whoop_oauth_states')
    .delete()
    .eq('state', state)
    .select('user_id, return_url, expires_at')
    .maybeSingle();

  if (error) throw new Error(`Could not verify WHOOP state: ${error.message}`);
  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) return null;

  return { userId: data.user_id, returnUrl: data.return_url };
}

/** Housekeeping for abandoned flows -- rows nobody will ever come back for. */
export async function purgeExpiredStates() {
  await db.from('whoop_oauth_states').delete().lt('expires_at', new Date().toISOString());
}
