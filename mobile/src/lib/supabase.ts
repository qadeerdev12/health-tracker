import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Copy .env.example to .env and fill them in, then restart the dev server.',
  );
}

/**
 * `web.output: "static"` makes Expo Router pre-render every web route in Node,
 * where AsyncStorage's web backend reaches for `window` and throws. There is no
 * session to restore during a pre-render anyway, so hand Supabase a store that
 * always misses and let the real one take over once the app is hydrated.
 */
const hasWindow = typeof window !== 'undefined';

const noopStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: hasWindow ? AsyncStorage : noopStorage,
    persistSession: hasWindow,
    autoRefreshToken: hasWindow,
    // There is no browser URL to read the session back out of on native.
    detectSessionInUrl: false,
  },
});

// Supabase only refreshes on a timer while the app is awake; pause it in the
// background so a returning app refreshes immediately instead of waiting.
if (hasWindow) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
