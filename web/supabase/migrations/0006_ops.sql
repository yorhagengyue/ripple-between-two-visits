-- Push, reminders sent, rate limits and the scheduled jobs' lease (docs/plan/real-app.md 3.5, 3.11; C2 architecture
-- review 10-10). Written as a file only; the integrator applies it. Server-only like every table here: RLS on, no
-- policies, nothing for anon / authenticated (0008_privileges.sql).

-- ---------------------------------------------------------------- web push

-- one row per browser endpoint (a repeated subscribe keeps one row); the push service answering 410 removes it
create table public.push_subscription (
  id           text        primary key,
  user_id      uuid        not null,
  endpoint     text        not null,
  p256dh       text        not null,
  auth         text        not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  seq          bigint      generated always as identity,
  constraint push_subscription_user_fk foreign key (user_id) references auth.users (id) on delete cascade,
  constraint push_subscription_endpoint_key unique (endpoint)
);
create index push_subscription_user_idx on public.push_subscription (user_id);

-- each reminder or alert is sent once: the key is the scope, what kind (dose_first, dose_second, family_no_reply,
-- bp_due, ...), what it is about (a medicine id, a link id), the day and the slot
create table public.reminder_delivery (
  id         text        primary key,
  session_id text        not null,
  kind       text        not null,
  ref        text        not null,
  day        integer     not null,
  slot       text        not null,
  sent_at    timestamptz not null default now(),
  opened_at  timestamptz,
  created_at timestamptz not null default now(),
  seq        bigint      generated always as identity,
  constraint reminder_delivery_once unique (session_id, kind, ref, day, slot),
  constraint reminder_delivery_session_fk foreign key (session_id) references public.session (id) on delete cascade
);

-- ---------------------------------------------------------------- rate limits

-- a fixed window per bucket (the bucket name carries an HMAC of the IP, never the IP itself)
create table public.rate_limit (
  bucket       text        primary key,
  window_start timestamptz not null,
  window_s     integer     not null,
  count        integer     not null,
  updated_at   timestamptz not null default now()
);
create index rate_limit_updated_idx on public.rate_limit (updated_at);

-- one atomic hit: a window that has passed starts again at 1. Returns { count, allowed, reset_at }.
create or replace function public.rp_rate_hit(p_bucket text, p_window_s integer, p_limit integer, p_now timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r public.rate_limit;
begin
  insert into public.rate_limit as x (bucket, window_start, window_s, count, updated_at)
  values (p_bucket, p_now, p_window_s, 1, p_now)
  on conflict (bucket) do update
    set window_start = case when x.window_start + make_interval(secs => x.window_s) <= p_now then p_now else x.window_start end,
        window_s     = case when x.window_start + make_interval(secs => x.window_s) <= p_now then p_window_s else x.window_s end,
        count        = case when x.window_start + make_interval(secs => x.window_s) <= p_now then 1 else x.count + 1 end,
        updated_at   = p_now
  returning * into r;
  return jsonb_build_object(
    'count', r.count,
    'allowed', r.count <= p_limit,
    'reset_at', r.window_start + make_interval(secs => r.window_s)
  );
end;
$$;

-- ---------------------------------------------------------------- the scheduled jobs

-- one runner at a time per job name: a holder keeps the lease until it expires or is released
create table public.job_lease (
  name        text        primary key,
  holder      text        not null,
  expires_at  timestamptz not null,
  acquired_at timestamptz not null default now()
);

-- take (or extend) the lease when it is free, expired or already ours. Returns true when this holder has it.
create or replace function public.rp_job_lease(p_name text, p_holder text, p_ttl_s integer, p_now timestamptz)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  got text;
begin
  insert into public.job_lease as x (name, holder, expires_at, acquired_at)
  values (p_name, p_holder, p_now + make_interval(secs => p_ttl_s), p_now)
  on conflict (name) do update
    set holder = excluded.holder, expires_at = excluded.expires_at,
        acquired_at = case when x.holder = excluded.holder then x.acquired_at else excluded.acquired_at end
    where x.holder = excluded.holder or x.expires_at <= p_now
  returning holder into got;
  return got is not null and got = p_holder;
end;
$$;

create or replace function public.rp_job_release(p_name text, p_holder text)
returns void
language sql
set search_path = ''
as $$
  delete from public.job_lease where name = p_name and holder = p_holder;
$$;

-- what each run did, in counts only (never a scope id or any content)
create table public.ops_run (
  id          text        primary key,
  job         text        not null,
  counts      jsonb       not null default '{}'::jsonb,
  started_at  timestamptz not null,
  finished_at timestamptz,
  created_at  timestamptz not null default now(),
  seq         bigint      generated always as identity
);
create index ops_run_job_idx on public.ops_run (job, seq);

-- ---------------------------------------------------------------- RLS on, nothing for the browser

alter table public.push_subscription enable row level security;
alter table public.reminder_delivery enable row level security;
alter table public.rate_limit        enable row level security;
alter table public.job_lease         enable row level security;
alter table public.ops_run           enable row level security;

revoke all on table public.push_subscription, public.reminder_delivery, public.rate_limit, public.job_lease, public.ops_run
  from anon, authenticated;
grant all on table public.push_subscription, public.reminder_delivery, public.rate_limit, public.job_lease, public.ops_run
  to service_role;

revoke all on all sequences in schema public from anon, authenticated;
grant usage, select on all sequences in schema public to service_role;

revoke all on function public.rp_rate_hit(text, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.rp_job_lease(text, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.rp_job_release(text, text) from public, anon, authenticated;
grant execute on function public.rp_rate_hit(text, integer, integer, timestamptz) to service_role;
grant execute on function public.rp_job_lease(text, text, integer, timestamptz) to service_role;
grant execute on function public.rp_job_release(text, text) to service_role;
