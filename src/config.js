import 'dotenv/config';

const required = ['WHOOP_CLIENT_ID', 'WHOOP_CLIENT_SECRET', 'WHOOP_REDIRECT_URI'];

export const config = {
  port: Number(process.env.PORT ?? 3000),
  tokenStorePath: process.env.TOKEN_STORE_PATH ?? '.tokens.json',
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
