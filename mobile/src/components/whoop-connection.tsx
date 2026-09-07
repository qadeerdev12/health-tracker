import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api';
import { connectWhoop, disconnectWhoop, getWhoopStatus, type WhoopStatus } from '@/lib/whoop';

export function WhoopConnection() {
  const [status, setStatus] = useState<WhoopStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getWhoopStatus());
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `Could not reach the server (${err.status}).`
          : 'Could not reach the server.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function onConnect() {
    setBusy(true);
    setError(null);
    try {
      const result = await connectWhoop();
      if (result.outcome === 'failed') setError(result.reason);
      // Re-read rather than trusting the redirect: the server is the only thing
      // that knows whether the tokens actually landed.
      if (result.outcome !== 'cancelled') await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start WHOOP authorization.');
    } finally {
      setBusy(false);
    }
  }

  async function onDisconnect() {
    setBusy(true);
    setError(null);
    try {
      await disconnectWhoop();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedView type="backgroundElement" style={styles.headingRow}>
        <ThemedText type="smallBold">WHOOP</ThemedText>
        {loading ? (
          <ActivityIndicator />
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {status?.connected ? 'Connected' : 'Not connected'}
          </ThemedText>
        )}
      </ThemedView>

      {status?.connected ? (
        <ThemedText type="small" themeColor="textSecondary">
          {status.lastSyncedAt
            ? `Last synced ${new Date(status.lastSyncedAt).toLocaleString()}`
            : 'No data synced yet.'}
        </ThemedText>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Link WHOOP to use your measured daily burn instead of an estimate.
        </ThemedText>
      )}

      {error ? (
        <ThemedText type="small" style={styles.error}>
          {error}
        </ThemedText>
      ) : null}

      {!loading &&
        (status?.connected ? (
          <Button title="Disconnect" variant="plain" busy={busy} onPress={onDisconnect} />
        ) : (
          <Button title="Connect WHOOP" busy={busy} onPress={onConnect} />
        ))}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.four,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  error: { color: '#e5484d' },
});
