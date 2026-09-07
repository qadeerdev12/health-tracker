import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { db } from '../supabase.js';

/** WHOOP rejects a `state` shorter than 8 characters. */
const newState = () => randomBytes(16).toString('hex');

export async function createState(userId) {
  const state = newState();
  const expiresAt = new Date(Date.now() + config.whoop.stateTtlMs).toISOString();

  const { error } = await db
    .from('whoop_oauth_states')
    .insert({ state, user_id: userId, expires_at: expiresAt });

  if (error) throw new Error(`Could not start WHOOP authorization: ${error.message}`);
  return state;
}

/**
 * Single-use: the row is deleted as it is read, so a replayed callback finds
 * nothing. Returns the user id that started the flow, or null.
 */
export async function consumeState(state) {
  if (!state) return null;

  const { data, error } = await db
    .from('whoop_oauth_states')
    .delete()
    .eq('state', state)
    .select('user_id, expires_at')
    .maybeSingle();

  if (error) throw new Error(`Could not verify WHOOP state: ${error.message}`);
  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) return null;

  return data.user_id;
}

/** Housekeeping for abandoned flows -- rows nobody will ever come back for. */
export async function purgeExpiredStates() {
  await db.from('whoop_oauth_states').delete().lt('expires_at', new Date().toISOString());
}
