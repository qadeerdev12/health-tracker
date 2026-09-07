import 'dotenv/config';

const required = [
  'WHOOP_CLIENT_ID',
  'WHOOP_CLIENT_SECRET',
  'WHOOP_REDIRECT_URI',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

export const config = {
  port: Number(process.env.PORT ?? 3000),

  supabase: {
    url: process.env.SUPABASE_URL,
    // Bypasses RLS. This is the only place WHOOP tokens are reachable, and it
    // must never be sent to the app.
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },

  // Where the OAuth callback sends the user once tokens are stored, when the
  // app does not ask for somewhere specific. The scheme from mobile/app.json.
  appRedirectUrl: process.env.APP_REDIRECT_URL ?? 'healthtracker://whoop',

  /**
   * Return URLs the app is allowed to ask for, as prefixes. The app has to
   * choose this at runtime -- Expo Go gets an exp:// URL, a real build gets the
   * custom scheme, web gets http -- so the value cannot simply be fixed here.
   * Accepting it unchecked would turn the callback into an open redirect, so it
   * is matched against this list before being stored.
   */
  appRedirectAllowlist: (
    process.env.APP_REDIRECT_ALLOWLIST ?? 'healthtracker://,exp://,exp+health-tracker://,http://localhost'
  )
    .split(',')
    .map((prefix) => prefix.trim())
    .filter(Boolean),

  /**
   * Browser origins allowed to call this server. Only the web target needs
   * this -- a native app makes no preflight and sends no Origin -- but without
   * it `npm run web` cannot reach the server at all. Explicit list rather than
   * a wildcard: these responses carry a user's WHOOP data.
   */
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:8081,http://localhost:8082')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  whoop: {
    clientId: process.env.WHOOP_CLIENT_ID,
    clientSecret: process.env.WHOOP_CLIENT_SECRET,
    redirectUri: process.env.WHOOP_REDIRECT_URI,
    scopes: (
      process.env.WHOOP_SCOPES ??
      'offline read:profile read:body_measurement read:cycles read:recovery read:sleep read:workout'
    )
      .split(/\s+/)
      .filter(Boolean),
    authUrl: 'https://api.prod.whoop.com/oauth/oauth2/auth',
    tokenUrl: 'https://api.prod.whoop.com/oauth/oauth2/token',
    apiBase: 'https://api.prod.whoop.com/developer',
    stateTtlMs: 10 * 60 * 1000,
  },
};

export function assertConfigured() {
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(
      `Missing required env vars: ${missing.join(', ')}. Copy .env.example to .env and fill them in.`
    );
  }
}
