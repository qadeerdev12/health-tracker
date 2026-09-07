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

  // Where the OAuth callback sends the user once tokens are stored. The app
  // scheme in mobile/app.json, so the in-app browser closes back into the app.
  appRedirectUrl: process.env.APP_REDIRECT_URL ?? 'healthtracker://whoop',

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
