# health-tracker mobile

Expo / React Native app. SDK 57, TypeScript, expo-router (file-based routes in
`src/app/`). Screens are still the Expo starter template — this commit is the
scaffold and the data layer, not the UI.

## Setup

```bash
cp .env.example .env   # fill in the Supabase URL and anon key
npm install
npm start
```

Then scan the QR with Expo Go, or press `w` for the browser.

**There is no Xcode on this machine** — only Command Line Tools — so `npm run ios`
cannot build a native iOS app here. Use Expo Go on a physical phone, or the web
target, until Xcode is installed.

`EXPO_PUBLIC_API_URL` defaults to `http://localhost:3000`, which a phone cannot
reach. Point it at the LAN address Expo prints on start (e.g. `http://192.168.1.42:3000`)
once you are testing against the server.

## What's wired

| File | Role |
| --- | --- |
| `src/lib/supabase.ts` | Supabase client — auth, session persistence, token refresh |
| `src/lib/api.ts` | Calls the Express server, attaching the Supabase access token |

Everything `EXPO_PUBLIC_*` is inlined into the JS bundle and is therefore public.
The Supabase anon key is designed for that; the WHOOP client secret is not, and
stays in the server's `.env`.

## Two things worth knowing

**Session storage is AsyncStorage, unencrypted.** This is what Supabase documents
for React Native, and it is fine for development. Before real users, move the
session to `expo-secure-store` — note its ~2KB per-value limit means a Supabase
session needs chunking.

**Web pre-rendering.** `app.json` sets `web.output: "static"`, so expo-router runs
every web route through Node at build time, where `window` does not exist.
`supabase.ts` swaps in a no-op session store for that pass. If you add a module
that touches browser globals at import time, it will break the web build the same
way.
