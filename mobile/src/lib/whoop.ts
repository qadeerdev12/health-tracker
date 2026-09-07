import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { api } from './api';

export type WhoopStatus = {
  connected: boolean;
  whoopUserId: string | null;
  scopes: string[];
  connectedAt: string | null;
  lastSyncedAt: string | null;
};

export type ConnectOutcome =
  | { outcome: 'connected' }
  | { outcome: 'cancelled' }
  | { outcome: 'failed'; reason: string };

export const getWhoopStatus = () => api<WhoopStatus>('/auth/whoop/status');

export const disconnectWhoop = () =>
  api<{ connected: boolean }>('/auth/whoop', { method: 'DELETE' });

/**
 * Runs the WHOOP authorization round trip.
 *
 * The return URL is computed here rather than fixed on the server because it
 * depends on how the app is running: Expo Go gets an exp:// URL, a real build
 * gets the healthtracker:// scheme, web gets an http one. The server checks it
 * against an allowlist before it will use it.
 */
export async function connectWhoop(): Promise<ConnectOutcome> {
  const returnUrl = Linking.createURL('whoop');

  const { authorizationUrl } = await api<{ authorizationUrl: string }>(
    `/auth/whoop/start?returnUrl=${encodeURIComponent(returnUrl)}`,
  );

  const result = await WebBrowser.openAuthSessionAsync(authorizationUrl, returnUrl);

  // 'dismiss' is the user closing the sheet; 'cancel' is the web popup being
  // closed. Neither is an error worth showing.
  if (result.type !== 'success') return { outcome: 'cancelled' };

  const { queryParams } = Linking.parse(result.url);
  const failure = queryParams?.error;

  if (failure) {
    const description = queryParams?.error_description;
    return {
      outcome: 'failed',
      reason: [failure, description].filter(Boolean).join(' — '),
    };
  }

  return { outcome: 'connected' };
}
