import { Redirect } from 'expo-router';

import AppTabs from '@/components/app-tabs';
import { useSession } from '@/lib/session';

export default function AppLayout() {
  const { session, loading } = useSession();

  // Render nothing rather than a spinner: the splash overlay is still up while
  // the persisted session is read, so a spinner would only flash behind it.
  if (loading) return null;
  if (!session) return <Redirect href="/sign-in" />;

  return <AppTabs />;
}
