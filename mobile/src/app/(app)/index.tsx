import { Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { WhoopConnection } from '@/components/whoop-connection';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

const today = () =>
  new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

export default function HomeScreen() {
  const { session } = useSession();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.accountRow}>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {session?.user.email}
          </ThemedText>
          <Button
            title="Sign out"
            variant="plain"
            style={styles.signOut}
            onPress={() => supabase.auth.signOut()}
          />
        </ThemedView>

        <ThemedView style={styles.heading}>
          <ThemedText type="subtitle">Today</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {today()}
          </ThemedText>
        </ThemedView>

        {/*
          Deliberately empty rather than showing zeroes. Nothing syncs WHOOP into
          Supabase yet, and a balance of "0 kcal" would read as a real
          measurement rather than an absence of one.
        */}
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">Calorie balance</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Once WHOOP is connected and syncing, your measured burn for the day shows here
            against what you have logged.
          </ThemedText>
        </ThemedView>

        <WhoopConnection />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    // The web tab list is absolutely positioned across the top of the page, so
    // content has to be pushed clear of it. Native puts the tabs at the bottom
    // and the safe area handles the top, hence the platform split.
    paddingTop: Platform.OS === 'web' ? Spacing.six : 0,
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.three,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  signOut: {
    alignSelf: 'auto',
    minHeight: 0,
    paddingVertical: Spacing.one,
  },
  heading: {
    gap: Spacing.half,
    marginTop: Spacing.two,
  },
  card: {
    alignSelf: 'stretch',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.four,
  },
});
