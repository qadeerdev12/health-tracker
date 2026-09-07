-- Binds an in-flight OAuth `state` to the user who started the flow.
--
-- This is the piece single-user code does not need. WHOOP's callback arrives as
-- a bare redirect carrying no session cookie, and the token response says
-- nothing about who we are, so `state` is the only thread back to an account.
-- Checking "did we issue this state" is not enough; the callback has to answer
-- "which of our users is coming back".
--
-- It lives in the database rather than in process memory so the flow survives a
-- restart or a second server instance picking up the callback.
create table public.whoop_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users on delete cascade,
  -- Where to send the browser afterwards. Stored per flow because the right
  -- answer depends on how the app is running: a custom scheme in a real build,
  -- an exp:// URL under Expo Go, an http URL on web. The server validates it
  -- against an allowlist before storing, so this is not an open redirect.
  return_url text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index whoop_oauth_states_expiry on public.whoop_oauth_states (expires_at);

-- RLS on, no policies: only the service role reaches this. A client that could
-- read it could hijack another user's in-flight authorization.
alter table public.whoop_oauth_states enable row level security;
