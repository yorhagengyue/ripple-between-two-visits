-- Track D (C2, round two): which device a push subscription was made on (docs/plan/real-app.md 2.3 登录过的设备,
-- 2.24 推送). Written as a file only; the integrator renumbers and applies it (node scripts/db/migrate.mjs), then
-- runs node scripts/db/check-privileges.mjs.
--
-- Why: 「退出这台」 for another device (POST /api/auth/devices/sign-out) ends that device's sign-in sessions, but its
-- push subscription stayed attached to the account, so a phone he had signed out from his other phone kept getting his
-- reminders (track I's open item: push_subscription had no way to say which device a row belongs to). The column is the
-- same sha256 of the rp_device cookie that known_device.device_hash and account_session.device_hash hold (never the
-- cookie itself), written when the phone subscribes; signing a device out then removes the rows that carry its hash.
-- Rows made before this migration have null and are left as they are: 「退出登录」 on the phone itself and 「退出所有设备」
-- already remove them.
--
-- No new table, no policy change: push_subscription stays server-only (RLS on, nothing for anon / authenticated,
-- 0006_ops.sql and 0008_privileges.sql).

alter table public.push_subscription
  add column device_hash text,
  add constraint push_subscription_device_hash_shape check (device_hash is null or device_hash ~ '^[0-9a-f]{64}$');

create index push_subscription_device_idx on public.push_subscription (user_id, device_hash) where device_hash is not null;
