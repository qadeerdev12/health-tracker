import { Redirect, Stack } from 'expo-router';

import { useSession } from '@/lib/session';

export default function AuthLayout() {
  const { session, loading } = useSession();

  if (loading) return null;
  // Signing in flips the session, which lands the user here again; bouncing
  // them to the app is what makes the redirect after sign-in automatic.
  if (session) return <Redirect href="/" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
