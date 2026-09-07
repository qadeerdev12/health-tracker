import { AuthError } from '@supabase/supabase-js';

/**
 * Supabase surfaces a dropped connection as the platform's raw fetch failure --
 * "Failed to fetch" in a browser, "Network request failed" on native. Neither
 * tells a user anything, and both read like a bug in the app rather than a
 * connectivity problem, so they get replaced. Real auth errors ("Invalid login
 * credentials") are already written for humans and pass through untouched.
 */
export function describeAuthError(error: AuthError | Error): string {
  const message = error.message ?? '';

  const looksLikeNetworkFailure =
    /failed to fetch|network request failed|load failed|networkerror/i.test(message);

  if (looksLikeNetworkFailure) {
    return 'Could not reach the server. Check your connection and try again.';
  }

  return message || 'Something went wrong. Try again.';
}
