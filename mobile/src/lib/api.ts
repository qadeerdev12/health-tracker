/**
 * Calls the Express server, which is the only thing holding the WHOOP client
 * secret. Requests carry the Supabase access token so the server can identify
 * the user without a second session system.
 */
import { supabase } from './supabase';

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new ApiError(response.status, (await response.text()) || response.statusText);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}
