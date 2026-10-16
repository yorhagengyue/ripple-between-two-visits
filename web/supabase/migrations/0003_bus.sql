-- Realtime bus across server instances (STORE=supabase): web/lib/bus.ts persists every event here and
-- GET /api/events tails this table, so a dose tick posted to one instance reaches a phone whose event
-- stream is held by another instance.
--
-- Event ids are a per-session sequence without gaps, handed out by rp_bus_publish under the row lock of
-- bus_seq: two publishers in the same session queue on that lock, so a higher seq never commits before a
-- lower one. A tailer reading "seq > last seen ORDER BY seq" therefore never skips an event, and the SSE
-- id (= seq) lets a browser resume exactly after a reconnect (Last-Event-ID), for example after a
-- serverless function timeout. Old events are pruned per session (p_keep, 200 like the in-memory bus).

create table public.bus_seq (
  session_id text   primary key,
  n          bigint not null,
  constraint bus_seq_session_fk foreign key (session_id) references public.session (id) on delete cascade
);

create table public.bus_event (
  session_id text        not null,
  seq        bigint      not null,
  type       text        not null,
  say        text        not null,
  data       jsonb,
  at         timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (session_id, seq),
  constraint bus_event_session_fk foreign key (session_id) references public.session (id) on delete cascade
);

create or replace function public.rp_bus_publish(
  p_session_id text,
  p_type text,
  p_say text,
  p_data jsonb,
  p_at timestamptz,
  p_keep integer default 200
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_seq bigint;
begin
  insert into public.bus_seq as s (session_id, n) values (p_session_id, 1)
  on conflict (session_id) do update set n = s.n + 1
  returning n into v_seq;

  insert into public.bus_event (session_id, seq, type, say, data, at)
  values (p_session_id, v_seq, p_type, p_say, p_data, p_at);

  if p_keep > 0 and v_seq > p_keep then
    delete from public.bus_event where session_id = p_session_id and seq <= v_seq - p_keep;
  end if;
  return v_seq;
end;
$$;

alter table public.bus_seq   enable row level security;
alter table public.bus_event enable row level security;

revoke all on table public.bus_seq, public.bus_event from anon, authenticated;
grant all on table public.bus_seq, public.bus_event to service_role;

revoke all on function public.rp_bus_publish(text, text, text, jsonb, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.rp_bus_publish(text, text, text, jsonb, timestamptz, integer) to service_role;
