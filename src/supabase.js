import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

/**
 * Service-role client. It bypasses RLS, which is what lets the server read and
 * write whoop_tokens -- a table with RLS on and no policies, so no other client
 * can touch it at all.
 *
 * Sessions are off: this client is not acting as a user, it is acting as the
 * server, and persisting anything here would be a bug.
 */
export const db = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
