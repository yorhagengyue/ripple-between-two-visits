-- Track A (accounts and sign-in), C2: the sign-in session registry (docs/plan/real-app.md 3.4 会话吊销, 2.3 登录过的设备).
-- Written as a file only; the integrator renumbers and applies it (node scripts/db/migrate.mjs), then runs
-- node scripts/db/check-privileges.mjs.
--
-- One row per sign-in session: the identity provider's session id (the access token's session_id claim, which stays
-- the same across refreshes), whose it is, the device it was opened on (the rp_device cookie, stored as a sha256 hash
-- only), whether it was 「这不是我的手机」, and when it ended. The identity layer (web/lib/auth/gotrue.ts) writes a row
-- at every password sign-in and reads it on every request: a session is signed in only while its row is open
-- (ended_at is null). Logging out, 「退出所有设备」, a new password, a recovery-code reset and signing out one device
-- from 「登录过的设备」 close rows. That is how a token the provider would still accept (Supabase access tokens live an
-- hour; the app's own cookie keeps one for 15 minutes) stops working at once, and how one device is signed out.
--
-- Nothing of his health data is here. Only the server may touch the table (service_role through PostgREST): RLS on,
-- no policy, nothing for anon or authenticated (0008_privileges.sql already revokes the defaults; repeated here).
-- Deleting the user (Supabase Auth's admin API) removes his rows.

create table public.account_session (
  session_id   uuid        primary key,
  user_id      uuid        not null,
  device_hash  text,
  device_label text,
  ephemeral    boolean     not null default false,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at     timestamptz,
  ended_reason text,
  seq          bigint      generated always as identity,
  constraint account_session_user_fk foreign key (user_id) references auth.users (id) on delete cascade,
  constraint account_session_device_hash_shape check (device_hash is null or device_hash ~ '^[0-9a-f]{64}$'),
  constraint account_session_device_label_len check (device_label is null or char_length(device_label) <= 80),
  constraint account_session_ended_reason_len check (ended_reason is null or char_length(ended_reason) <= 40),
  constraint account_session_ended_pair check ((ended_at is null) = (ended_reason is null))
);

create index account_session_user_idx on public.account_session (user_id, seq);
create index account_session_open_idx on public.account_session (user_id) where ended_at is null;

alter table public.account_session enable row level security;

revoke all on table public.account_session from public, anon, authenticated;
grant all on table public.account_session to service_role;

revoke all on all sequences in schema public from anon, authenticated;
grant usage, select on all sequences in schema public to service_role;
