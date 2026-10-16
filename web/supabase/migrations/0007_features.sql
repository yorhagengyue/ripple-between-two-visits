-- The new modules' tables (profile, prevention, watch, diet, chat, the brief's snapshot; journeys 01, 04, 11-14) on
-- top of what 0001 already created for M10-M12 (profile_fact, watch_metric, prevent_done). C2 architecture review
-- 10-10. Written as a file only; the integrator applies it. Server-only: RLS on, no policies, nothing for anon or
-- authenticated (0008_privileges.sql). Every table is keyed by (session_id, id) and goes with its scope.

-- ---------------------------------------------------------------- what 0001 already has, completed

-- profile_fact (0001: kind, text, source, entered_by, confirmed_by, visit_item_id, created_day): structured data, a
-- hidden flag (he said "not right"), who typed it (a family member through a link proposes; he confirms) and when
alter table public.profile_fact
  add column data               jsonb,
  add column hidden             boolean,
  add column entered_by_user_id uuid,
  add column link_id            uuid,
  add column confirmed_at       timestamptz,
  add column updated_at         timestamptz,
  add constraint profile_fact_entered_by_fk foreign key (entered_by_user_id) references auth.users (id) on delete set null,
  add constraint profile_fact_link_fk foreign key (link_id) references public.care_link (id) on delete set null;

-- watch_metric (0001: day, metric, value): the unit, the moment it was measured and where it came from
alter table public.watch_metric
  add column unit        text,
  add column measured_at timestamptz,
  add column source      text;
create index watch_metric_day_idx on public.watch_metric (session_id, day);

-- prevent_done (0001: item_id, day): how he said it (he ticked it, or it came from a visit) and an optional note
alter table public.prevent_done
  add column source        text,
  add column visit_item_id text,
  add column note          text;

-- ---------------------------------------------------------------- new tables

-- the daily diet check: one answer per item per day (official-source items, lib/diet)
create table public.diet_check (
  session_id text        not null,
  id         text        not null,
  day        integer     not null,
  item       text        not null,
  answer     text        not null,
  source_ref text,
  note       text,
  created_at timestamptz not null default now(),
  seq        bigint      generated always as identity,
  primary key (session_id, id),
  constraint diet_check_once unique (session_id, day, item),
  constraint diet_check_session_fk foreign key (session_id) references public.session (id) on delete cascade
);

-- his conversation with Ripple, kept per day so he can scroll back (journey 04); Ripple's turns carry the structured
-- answer the safety layer produced and the safety_event id it came from
create table public.chat_message (
  session_id      text        not null,
  id              text        not null,
  day             integer     not null,
  role            text        not null,
  text            text        not null,
  lang            text,
  safety_event_id text,
  answer          jsonb,
  created_at      timestamptz not null default now(),
  seq             bigint      generated always as identity,
  primary key (session_id, id),
  constraint chat_message_role_check check (role in ('patient', 'ripple')),
  constraint chat_message_session_fk foreign key (session_id) references public.session (id) on delete cascade
);
create index chat_message_day_idx on public.chat_message (session_id, day, seq);

-- the brief as it was shown ("show the doctor"), so a later look is the same page (e2e-chains.md 19)
create table public.brief_snapshot (
  session_id text        not null,
  id         text        not null,
  locale     text,
  data       jsonb       not null,
  shown_at   timestamptz,
  created_at timestamptz not null default now(),
  seq        bigint      generated always as identity,
  primary key (session_id, id),
  constraint brief_snapshot_session_fk foreign key (session_id) references public.session (id) on delete cascade
);

-- ---------------------------------------------------------------- reset / reseed empty the new tables too

create or replace function public.rp_reset_session(p_session_id text, p_story_day integer, p_story_time text, p_tables jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  s public.session;
begin
  select * into s from public.session where id = p_session_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'session_not_found';
  end if;
  if s.kind = 'account' then
    raise exception using errcode = '22023', message = 'account_scope';
  end if;
  update public.session set story_day = p_story_day, story_time = p_story_time
  where id = p_session_id
  returning * into s;
  delete from public.utterance      where session_id = p_session_id;
  delete from public.visit_item     where session_id = p_session_id;
  delete from public.visit          where session_id = p_session_id;
  delete from public.medication     where session_id = p_session_id;
  delete from public.dose_log       where session_id = p_session_id;
  delete from public.bp_reading     where session_id = p_session_id;
  delete from public.note           where session_id = p_session_id;
  delete from public.question       where session_id = p_session_id;
  delete from public.family_grant   where session_id = p_session_id;
  delete from public.reminder_clip  where session_id = p_session_id;
  delete from public.safety_event   where session_id = p_session_id;
  delete from public.profile_fact   where session_id = p_session_id;
  delete from public.watch_metric   where session_id = p_session_id;
  delete from public.prevent_done   where session_id = p_session_id;
  delete from public.diet_check     where session_id = p_session_id;
  delete from public.chat_message   where session_id = p_session_id;
  delete from public.brief_snapshot where session_id = p_session_id;
  perform public.rp_insert_seed(p_session_id, p_tables);
  return to_jsonb(s) - 'seq';
end;
$$;

-- an account's reseed keeps its family links and their switches (family_grant): only his own records go, and the
-- reminders already sent (reminder_delivery, 0006)
create or replace function public.rp_reseed_account(p_scope_id text, p_patch jsonb, p_tables jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  s public.session;
begin
  select * into s from public.session where id = p_scope_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'session_not_found';
  end if;
  if s.kind <> 'account' then
    raise exception using errcode = '22023', message = 'account_only';
  end if;
  update public.session set
    template       = coalesce(p_patch ->> 'template', template),
    d0             = coalesce((p_patch ->> 'd0')::date, d0),
    settings       = case when p_patch ? 'settings' then coalesce(p_patch -> 'settings', '{}'::jsonb) else settings end,
    onboarding     = case when p_patch ? 'onboarding' then p_patch ->> 'onboarding' else onboarding end,
    example_data   = case when p_patch ? 'example_data' then (p_patch ->> 'example_data')::boolean else example_data end,
    tracking_since = case when p_patch ? 'tracking_since' then (p_patch ->> 'tracking_since')::timestamptz else tracking_since end
  where id = p_scope_id
  returning * into s;
  delete from public.utterance      where session_id = p_scope_id;
  delete from public.visit_item     where session_id = p_scope_id;
  delete from public.visit          where session_id = p_scope_id;
  delete from public.medication     where session_id = p_scope_id;
  delete from public.dose_log       where session_id = p_scope_id;
  delete from public.bp_reading     where session_id = p_scope_id;
  delete from public.note           where session_id = p_scope_id;
  delete from public.question       where session_id = p_scope_id;
  delete from public.reminder_clip  where session_id = p_scope_id;
  delete from public.safety_event   where session_id = p_scope_id;
  delete from public.profile_fact   where session_id = p_scope_id;
  delete from public.watch_metric   where session_id = p_scope_id;
  delete from public.prevent_done   where session_id = p_scope_id;
  delete from public.diet_check     where session_id = p_scope_id;
  delete from public.chat_message   where session_id = p_scope_id;
  delete from public.brief_snapshot where session_id = p_scope_id;
  -- the reminders sent belong to the old timeline: a reseeded day may be reminded again
  delete from public.reminder_delivery where session_id = p_scope_id;
  -- the links' switches stay (they are about people, not the timeline): seed rows never carry grants here
  perform public.rp_insert_seed(p_scope_id, p_tables - 'family_grants');
  return to_jsonb(s) - 'seq';
end;
$$;

-- ---------------------------------------------------------------- RLS on, nothing for the browser

alter table public.diet_check     enable row level security;
alter table public.chat_message   enable row level security;
alter table public.brief_snapshot enable row level security;

revoke all on table public.diet_check, public.chat_message, public.brief_snapshot from anon, authenticated;
grant all on table public.diet_check, public.chat_message, public.brief_snapshot to service_role;

revoke all on all sequences in schema public from anon, authenticated;
grant usage, select on all sequences in schema public to service_role;

revoke all on function public.rp_reset_session(text, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.rp_reseed_account(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.rp_reset_session(text, integer, text, jsonb) to service_role;
grant execute on function public.rp_reseed_account(text, jsonb, jsonb) to service_role;
