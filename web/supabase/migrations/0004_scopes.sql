-- Scopes (docs/plan/real-app.md 3.2, 3.3, 3.8; C2 architecture review 10-10): one data space per person.
--
-- The `session` table gains a third kind of row. Judges' sandboxes and the crew's filming sessions stay what they are
-- (kind 'sandbox' / 'filming', backfilled from expires_at: no expiry = filming); an account's space is a row with
-- kind = 'account' whose id is the user's id (auth.users.id as text). Every business table keeps its session_id, so
-- for an account those rows are simply his. An account row stores no story clock: the store computes story_day and
-- story_time from d0 and the real time in tz each time it hands the row out (web/lib/time/clock.ts projectScope);
-- a filming account adds clock_offset_ms first.
--
-- Only the server reads and writes (service_role through PostgREST, RLS on, no policies, nothing granted to anon or
-- authenticated: 0001-0003 and 0008_privileges.sql). Written as a file only; the integrator applies it.

-- ---------------------------------------------------------------- session: the scope columns

alter table public.session
  add column kind            text,
  add column owner_user_id   uuid,
  add column d0              date,
  add column tz              text        not null default 'Asia/Singapore',
  add column settings        jsonb       not null default '{}'::jsonb,
  add column onboarding      text,
  add column example_data    boolean     not null default false,
  add column tracking_since  timestamptz,
  add column clock_offset_ms bigint,
  add column filming         boolean     not null default false;

-- every existing row is a demo row: no expiry = the crew's filming session, otherwise a judge's sandbox
update public.session set kind = case when expires_at is null then 'filming' else 'sandbox' end where kind is null;

alter table public.session alter column kind set not null;
alter table public.session alter column join_code drop not null;
alter table public.session alter column story_day drop not null;

alter table public.session
  add constraint session_kind_check check (kind in ('sandbox', 'filming', 'account')),
  -- an account's space: the user's own id, a start date, no join code, no expiry, no stored story clock
  add constraint session_account_shape check (
    kind <> 'account' or (
      owner_user_id is not null and id = owner_user_id::text and d0 is not null
      and expires_at is null and join_code is null and story_day is null and story_time is null
    )
  ),
  -- a demo row (sandbox or filming session): no owner, a join code and a story day, none of the account columns
  add constraint session_demo_shape check (
    kind = 'account' or (
      owner_user_id is null and join_code is not null and story_day is not null
      and not filming and not example_data
    )
  ),
  -- the clock offset is only for an account the crew marked as a filming account
  add constraint session_offset_filming check (clock_offset_ms is null or (kind = 'account' and filming)),
  add constraint session_onboarding_check check (onboarding is null or onboarding in ('started', 'done')),
  add constraint session_settings_object check (jsonb_typeof(settings) = 'object'),
  add constraint session_owner_fk foreign key (owner_user_id) references auth.users (id) on delete cascade;

-- one space per account
create unique index session_owner_account_key on public.session (owner_user_id) where kind = 'account';
-- the scheduled jobs walk the account rows
create index session_account_kind_idx on public.session (kind) where kind = 'account';

-- ---------------------------------------------------------------- columns the journeys need on existing tables

-- visit: retention of the recording (journey 15); two more status values, 'awaiting_transcript' and 'planned'
-- (status is plain text without a CHECK, 0001)
alter table public.visit
  add column retain_until     date,
  add column keep_forever     boolean,
  add column audio_deleted_at timestamptz;

-- medication: the dose slots read from the label (or chosen by him) and when the medicine was confirmed, the lower
-- bound for settling "no reply" (a window that closed before he had the medicine is never his missed dose)
alter table public.medication
  add column dose_slots        jsonb,
  add column dose_slots_source text,
  add column start_at          timestamptz,
  add constraint medication_dose_slots_array check (dose_slots is null or jsonb_typeof(dose_slots) = 'array'),
  add constraint medication_dose_slots_source_check check (dose_slots_source is null or dose_slots_source in ('label', 'patient'));

-- question: kept for questions a family member asks later
alter table public.question add column asked_by_user_id uuid;

-- reminder_clip: who recorded it (cleared when her account goes, the label stays), and through which family link
alter table public.reminder_clip
  add column by_user_id uuid,
  add column by_label   text,
  add column link_id    uuid;

create index reminder_clip_link_idx on public.reminder_clip (link_id) where link_id is not null;

-- ---------------------------------------------------------------- store functions

-- rp_insert_seed: the seed of a new space, plus the new columns (absent keys are NULL, as before)
create or replace function public.rp_insert_seed(p_session_id text, p_tables jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.visit (session_id, id, kind, place, day, date, consent_utterance_id, status, audio_path,
                            script_section, audio_fixture, retain_until, keep_forever, audio_deleted_at, created_at)
  select p_session_id, r.id, r.kind, r.place, r.day, r.date, r.consent_utterance_id, r.status, r.audio_path,
         r.script_section, r.audio_fixture, r.retain_until, r.keep_forever, r.audio_deleted_at, r.created_at
  from jsonb_array_elements(coalesce(p_tables -> 'visits', '[]'::jsonb)) with ordinality as e(j, n)
  cross join lateral jsonb_populate_record(null::public.visit, e.j) as r
  order by e.n;

  insert into public.visit_item (session_id, id, visit_id, type, text, utterance_ids, slots, confirmed_by,
                                 required_line, speaker, created_at)
  select p_session_id, r.id, r.visit_id, r.type, r.text, coalesce(r.utterance_ids, '[]'::jsonb),
         coalesce(r.slots, '{}'::jsonb), r.confirmed_by, r.required_line, r.speaker, r.created_at
  from jsonb_array_elements(coalesce(p_tables -> 'visit_items', '[]'::jsonb)) with ordinality as e(j, n)
  cross join lateral jsonb_populate_record(null::public.visit_item, e.j) as r
  order by e.n;

  insert into public.medication (session_id, id, drug_id, origin, label, status, start_day, prescribed_visit_id,
                                 note, pharmacist_answer, dose_slots, dose_slots_source, start_at, created_at)
  select p_session_id, r.id, r.drug_id, r.origin, r.label, r.status, r.start_day, r.prescribed_visit_id,
         r.note, r.pharmacist_answer, r.dose_slots, r.dose_slots_source, r.start_at, r.created_at
  from jsonb_array_elements(coalesce(p_tables -> 'medications', '[]'::jsonb)) with ordinality as e(j, n)
  cross join lateral jsonb_populate_record(null::public.medication, e.j) as r
  order by e.n;

  insert into public.dose_log (session_id, id, medication_id, day, slot, state, reason, reason_text, created_at)
  select p_session_id, r.id, r.medication_id, r.day, r.slot, r.state, r.reason, r.reason_text, r.created_at
  from jsonb_array_elements(coalesce(p_tables -> 'dose_logs', '[]'::jsonb)) with ordinality as e(j, n)
  cross join lateral jsonb_populate_record(null::public.dose_log, e.j) as r
  order by e.n;

  insert into public.bp_reading (session_id, id, day, slot, systolic, diastolic, state, note, created_at)
  select p_session_id, r.id, r.day, r.slot, r.systolic, r.diastolic, r.state, r.note, r.created_at
  from jsonb_array_elements(coalesce(p_tables -> 'bp_readings', '[]'::jsonb)) with ordinality as e(j, n)
  cross join lateral jsonb_populate_record(null::public.bp_reading, e.j) as r
  order by e.n;

  insert into public.note (session_id, id, day, text, source, lang, app_reply, created_at)
  select p_session_id, r.id, r.day, r.text, r.source, r.lang, r.app_reply, r.created_at
  from jsonb_array_elements(coalesce(p_tables -> 'notes', '[]'::jsonb)) with ordinality as e(j, n)
  cross join lateral jsonb_populate_record(null::public.note, e.j) as r
  order by e.n;

  insert into public.question (session_id, id, "for", origin, text, lang, status, answer_text, answer_utterance_id,
                               answer_visit_id, answer_speaker, asked_at_visit_id, created_day, evidence,
                               asked_by_user_id, created_at)
  select p_session_id, r.id, r."for", r.origin, r.text, r.lang, r.status, r.answer_text, r.answer_utterance_id,
         r.answer_visit_id, r.answer_speaker, r.asked_at_visit_id, r.created_day, r.evidence,
         r.asked_by_user_id, r.created_at
  from jsonb_array_elements(coalesce(p_tables -> 'questions', '[]'::jsonb)) with ordinality as e(j, n)
  cross join lateral jsonb_populate_record(null::public.question, e.j) as r
  order by e.n;

  insert into public.family_grant (session_id, member, items, created_at, updated_at)
  select p_session_id, r.member, r.items, r.created_at, r.updated_at
  from jsonb_array_elements(coalesce(p_tables -> 'family_grants', '[]'::jsonb)) with ordinality as e(j, n)
  cross join lateral jsonb_populate_record(null::public.family_grant, e.j) as r
  order by e.n;

  insert into public.reminder_clip (session_id, id, "by", audio_path, plays_at, text, lang, by_user_id, by_label,
                                    link_id, created_at)
  select p_session_id, r.id, r."by", r.audio_path, r.plays_at, r.text, r.lang, r.by_user_id, r.by_label,
         r.link_id, r.created_at
  from jsonb_array_elements(coalesce(p_tables -> 'reminder_clips', '[]'::jsonb)) with ordinality as e(j, n)
  cross join lateral jsonb_populate_record(null::public.reminder_clip, e.j) as r
  order by e.n;
end;
$$;

-- rp_create_session: a demo row (sandbox or filming session) and its seed. The kind is written explicitly; an
-- account space never comes through here (rp_create_account_space).
create or replace function public.rp_create_session(p_session jsonb, p_tables jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  s public.session;
  v_kind text := coalesce(p_session ->> 'kind', case when p_session ->> 'expires_at' is null then 'filming' else 'sandbox' end);
begin
  if v_kind not in ('sandbox', 'filming') then
    raise exception using errcode = '22023', message = 'demo_kind_only';
  end if;
  insert into public.session (id, join_code, template, story_day, story_time, filming_mode, created_at, expires_at, kind)
  select r.id, r.join_code, r.template, r.story_day, r.story_time, coalesce(r.filming_mode, false), r.created_at, r.expires_at, v_kind
  from jsonb_populate_record(null::public.session, p_session) as r
  returning * into s;
  perform public.rp_insert_seed(s.id, p_tables);
  return to_jsonb(s) - 'seq';
end;
$$;

-- rp_reset_session: demo rows only. An account's space has no story clock to reset (its own reseed is
-- rp_reseed_account, for the example and filming accounts).
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
  delete from public.utterance     where session_id = p_session_id;
  delete from public.visit_item    where session_id = p_session_id;
  delete from public.visit         where session_id = p_session_id;
  delete from public.medication    where session_id = p_session_id;
  delete from public.dose_log      where session_id = p_session_id;
  delete from public.bp_reading    where session_id = p_session_id;
  delete from public.note          where session_id = p_session_id;
  delete from public.question      where session_id = p_session_id;
  delete from public.family_grant  where session_id = p_session_id;
  delete from public.reminder_clip where session_id = p_session_id;
  delete from public.safety_event  where session_id = p_session_id;
  delete from public.profile_fact  where session_id = p_session_id;
  delete from public.watch_metric  where session_id = p_session_id;
  delete from public.prevent_done  where session_id = p_session_id;
  perform public.rp_insert_seed(p_session_id, p_tables);
  return to_jsonb(s) - 'seq';
end;
$$;

-- rp_create_account_space: an account's space and its seed (blank: no rows; example: the template shifted to today)
-- in one transaction. p_scope carries the row's columns; kind, the owner and the empty story clock are set here.
create or replace function public.rp_create_account_space(p_scope jsonb, p_tables jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  s public.session;
begin
  insert into public.session (id, kind, owner_user_id, join_code, template, story_day, story_time, filming_mode,
                              created_at, expires_at, d0, tz, settings, onboarding, example_data, tracking_since,
                              clock_offset_ms, filming)
  select ((p_scope ->> 'owner_user_id')::uuid)::text, 'account', (p_scope ->> 'owner_user_id')::uuid, null, r.template, null, null,
         false, r.created_at, null, r.d0, coalesce(r.tz, 'Asia/Singapore'), coalesce(r.settings, '{}'::jsonb), r.onboarding,
         coalesce(r.example_data, false), r.tracking_since, null, false
  from jsonb_populate_record(null::public.session, p_scope) as r
  returning * into s;
  perform public.rp_insert_seed(s.id, p_tables);
  return to_jsonb(s) - 'seq';
end;
$$;

-- rp_reseed_account: the example account's "lay it out again" and "start from my own", the filming account's
-- "lay out to a beat": every row of the space goes, the new seed comes in, and the scope columns given are set.
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
  delete from public.utterance     where session_id = p_scope_id;
  delete from public.visit_item    where session_id = p_scope_id;
  delete from public.visit         where session_id = p_scope_id;
  delete from public.medication    where session_id = p_scope_id;
  delete from public.dose_log      where session_id = p_scope_id;
  delete from public.bp_reading    where session_id = p_scope_id;
  delete from public.note          where session_id = p_scope_id;
  delete from public.question      where session_id = p_scope_id;
  delete from public.reminder_clip where session_id = p_scope_id;
  delete from public.safety_event  where session_id = p_scope_id;
  delete from public.profile_fact  where session_id = p_scope_id;
  delete from public.watch_metric  where session_id = p_scope_id;
  delete from public.prevent_done  where session_id = p_scope_id;
  perform public.rp_insert_seed(p_scope_id, p_tables - 'family_grants');
  return to_jsonb(s) - 'seq';
end;
$$;

-- rp_update_scope: an account's settings (merged key by key), onboarding, time zone, example flag, tracking start
-- (only the keys present in p_patch change). Accounts only.
create or replace function public.rp_update_scope(p_scope_id text, p_patch jsonb)
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
    settings       = case when p_patch ? 'settings' then settings || coalesce(p_patch -> 'settings', '{}'::jsonb) else settings end,
    onboarding     = case when p_patch ? 'onboarding' then p_patch ->> 'onboarding' else onboarding end,
    tz             = case when p_patch ? 'tz' then p_patch ->> 'tz' else tz end,
    example_data   = case when p_patch ? 'example_data' then (p_patch ->> 'example_data')::boolean else example_data end,
    tracking_since = case when p_patch ? 'tracking_since' then (p_patch ->> 'tracking_since')::timestamptz else tracking_since end
  where id = p_scope_id
  returning * into s;
  return to_jsonb(s) - 'seq';
end;
$$;

-- rp_set_clock_offset: a filming account's offset (null clears it); tracking starts again at the scope's new "now"
-- (p_now + the offset), so the skipped time is never settled as "no reply" (real-app 5.4).
create or replace function public.rp_set_clock_offset(p_scope_id text, p_offset_ms bigint, p_now timestamptz)
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
  if s.kind <> 'account' or not s.filming then
    raise exception using errcode = '22023', message = 'filming_account_only';
  end if;
  update public.session
    set clock_offset_ms = p_offset_ms,
        tracking_since  = p_now + make_interval(secs => coalesce(p_offset_ms, 0) / 1000.0)
  where id = p_scope_id
  returning * into s;
  return to_jsonb(s) - 'seq';
end;
$$;

revoke all on function public.rp_insert_seed(text, jsonb) from public, anon, authenticated;
revoke all on function public.rp_create_session(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.rp_reset_session(text, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.rp_create_account_space(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.rp_reseed_account(text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.rp_update_scope(text, jsonb) from public, anon, authenticated;
revoke all on function public.rp_set_clock_offset(text, bigint, timestamptz) from public, anon, authenticated;

grant execute on function public.rp_insert_seed(text, jsonb) to service_role;
grant execute on function public.rp_create_session(jsonb, jsonb) to service_role;
grant execute on function public.rp_reset_session(text, integer, text, jsonb) to service_role;
grant execute on function public.rp_create_account_space(jsonb, jsonb) to service_role;
grant execute on function public.rp_reseed_account(text, jsonb, jsonb) to service_role;
grant execute on function public.rp_update_scope(text, jsonb) to service_role;
grant execute on function public.rp_set_clock_offset(text, bigint, timestamptz) to service_role;
