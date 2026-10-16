-- C2 track L: a rate-limit bucket that counts an amount, not hits (docs/plan/real-app.md 3.5 「实时字幕分块，每人每天
-- 4 小时音频」). rp_rate_hit (0006_ops.sql) adds exactly one per call; the live captions' allowance is a sum of seconds,
-- and a piece of audio is 2 to 30 of them. rp_rate_add is the same atomic upsert on the same table with p_amount in
-- place of 1: a window that has passed starts again at p_amount. Returns { count, allowed, reset_at } like rp_rate_hit.
-- Nothing else changes: rp_rate_hit and its callers stay as they are.
--
-- Written as a file only; the integrator renumbers it after the other tracks' migrations and applies it. Until it is
-- applied the app's caption allowance warns once and lets the audio through (lib/subject/limits.ts), so the code can
-- be merged first. Server-only like every function here (0008_privileges.sql; repeated below).

create or replace function public.rp_rate_add(p_bucket text, p_window_s integer, p_limit integer, p_amount integer, p_now timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r public.rate_limit;
  a integer := greatest(coalesce(p_amount, 0), 0);
begin
  insert into public.rate_limit as x (bucket, window_start, window_s, count, updated_at)
  values (p_bucket, p_now, p_window_s, a, p_now)
  on conflict (bucket) do update
    set window_start = case when x.window_start + make_interval(secs => x.window_s) <= p_now then p_now else x.window_start end,
        window_s     = case when x.window_start + make_interval(secs => x.window_s) <= p_now then p_window_s else x.window_s end,
        count        = case when x.window_start + make_interval(secs => x.window_s) <= p_now then a else x.count + a end,
        updated_at   = p_now
  returning * into r;
  return jsonb_build_object(
    'count', r.count,
    'allowed', r.count <= p_limit,
    'reset_at', r.window_start + make_interval(secs => r.window_s)
  );
end;
$$;

revoke all on function public.rp_rate_add(text, integer, integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.rp_rate_add(text, integer, integer, integer, timestamptz) to service_role;
