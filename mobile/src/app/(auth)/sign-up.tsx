import { Link } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { describeAuthError } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';

const MIN_PASSWORD_LENGTH = 8;

export default function SignUpScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0 && confirm.length > 0 && !busy;

  async function signUp() {
    if (password !== confirm) {
      setError('Those passwords do not match.');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    setBusy(true);
    setError(null);

    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });

    if (error) {
      setError(describeAuthError(error));
      setBusy(false);
      return;
    }

    // With email confirmation on (the Supabase default) no session comes back
    // and nothing redirects, so the screen has to say why. With it off, the
    // session arrives and the auth layout's guard moves us into the app.
    if (!data.session) {
      setAwaitingConfirmation(true);
      setBusy(false);
    }
  }

  if (awaitingConfirmation) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText type="subtitle">Check your email</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            We sent a confirmation link to {email.trim()}. Open it, then sign in.
          </ThemedText>
          <Link href="/sign-in" replace asChild>
            <Button title="Back to sign in" />
          </Link>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedView style={styles.header}>
            <ThemedText type="subtitle">Create account</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              You can connect WHOOP once you are in.
            </ThemedText>
          </ThemedView>

          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            placeholder="you@example.com"
            editable={!busy}
          />

          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            editable={!busy}
          />

          <TextField
            label="Confirm password"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            placeholder="••••••••"
            editable={!busy}
            onSubmitEditing={() => canSubmit && signUp()}
            returnKeyType="go"
          />

          {error ? (
            <ThemedText type="small" style={styles.error}>
              {error}
            </ThemedText>
          ) : null}

          <Button title="Create account" onPress={signUp} disabled={!canSubmit} busy={busy} />

          <ThemedView style={styles.footer}>
            <ThemedText type="small" themeColor="textSecondary">
              Already have one?
            </ThemedText>
            <Link href="/sign-in" replace>
              <ThemedText type="linkPrimary">Sign in</ThemedText>
            </Link>
          </ThemedView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  keyboardView: { flex: 1 },
  safeArea: {
    flex: 1,
    justifyContent: 'center',
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth / 2,
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  header: { gap: Spacing.one, marginBottom: Spacing.two },
  error: { color: '#e5484d' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
});
