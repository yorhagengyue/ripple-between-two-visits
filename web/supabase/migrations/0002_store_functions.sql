-- Functions the Supabase store adapter calls through PostgREST (POST /rest/v1/rpc/<name>), for the writes
-- that must be atomic or must not lose a concurrent update when several server instances share the DB:
--
--   rp_create_session(p_session, p_tables)                       session row + the whole seed, one transaction
--   rp_reset_session(p_session_id, p_story_day, p_story_time, p_tables)
--                                                                 back to the seed, one transaction
--   rp_log_dose(p_row)                                           upsert on (medicine, day, slot)
--   rp_set_family_grant(p_session_id, p_member, p_items, p_now)  merge switches into a grant
--
-- p_tables is lib/story/seed.ts SeedTables as JSON ({ visits: [...], visit_items: [...], ... }); rows are
-- inserted in array order so `seq` keeps the seed order. Rows come back as JSON without `seq`.
-- search_path is empty and every name is schema-qualified. Only service_role may execute these.

create or replace function public.rp_insert_seed(p_session_id text, p_tables jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.visit (session_id, id, kind, place, day, date, consent_utterance_id, status, audio_path,
                            script_section, audio_fixture, created_at)
  select p_session_id, r.id, r.kind, r.place, r.day, r.date, r.consent_utterance_id, r.status, r.audio_path,
         r.script_section, r.audio_fixture, r.created_at
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
                                 note, pharmacist_answer, created_at)
  select p_session_id, r.id, r.drug_id, r.origin, r.label, r.status, r.start_day, r.prescribed_visit_id,
         r.note, r.pharmacist_answer, r.created_at
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
                               answer_visit_id, answer_speaker, asked_at_visit_id, created_day, evidence, created_at)
  select p_session_id, r.id, r."for", r.origin, r.text, r.lang, r.status, r.answer_text, r.answer_utterance_id,
         r.answer_visit_id, r.answer_speaker, r.asked_at_visit_id, r.created_day, r.evidence, r.created_at
  from jsonb_array_elements(coalesce(p_tables -> 'questions', '[]'::jsonb)) with ordinality as e(j, n)
  cross join lateral jsonb_populate_record(null::public.question, e.j) as r
  order by e.n;

  insert into public.family_grant (session_id, member, items, created_at, updated_at)
  select p_session_id, r.member, r.items, r.created_at, r.updated_at
  from jsonb_array_elements(coalesce(p_tables -> 'family_grants', '[]'::jsonb)) with ordinality as e(j, n)
  cross join lateral jsonb_populate_record(null::public.family_grant, e.j) as r
  order by e.n;

  insert into public.reminder_clip (session_id, id, "by", audio_path, plays_at, text, lang, created_at)
  select p_session_id, r.id, r."by", r.audio_path, r.plays_at, r.text, r.lang, r.created_at
  from jsonb_array_elements(coalesce(p_tables -> 'reminder_clips', '[]'::jsonb)) with ordinality as e(j, n)
  cross join lateral jsonb_populate_record(null::public.reminder_clip, e.j) as r
  order by e.n;
end;
$$;

create or replace function public.rp_create_session(p_session jsonb, p_tables jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  s public.session;
begin
  insert into public.session (id, join_code, template, story_day, story_time, filming_mode, created_at, expires_at)
  select r.id, r.join_code, r.template, r.story_day, r.story_time, coalesce(r.filming_mode, false), r.created_at, r.expires_at
  from jsonb_populate_record(null::public.session, p_session) as r
  returning * into s;
  perform public.rp_insert_seed(s.id, p_tables);
  return to_jsonb(s) - 'seq';
end;
$$;

-- Keeps id, join_code, members and filming_mode; story_day / story_time go to the given template defaults;
-- every other table goes back to the seed (utterances, safety events and the M10-M12 tables are emptied).
create or replace function public.rp_reset_session(p_session_id text, p_story_day integer, p_story_time text, p_tables jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  s public.session;
begin
  update public.session set story_day = p_story_day, story_time = p_story_time
  where id = p_session_id
  returning * into s;
  if not found then
    raise exception using errcode = 'P0002', message = 'session_not_found';
  end if;
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

-- One row per (medicine, day, slot). A new row takes p_row as given; an existing row keeps its id and
-- created_at and takes state, reason and reason_text (the memory store's logDose).
create or replace function public.rp_log_dose(p_row jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  d public.dose_log;
begin
  insert into public.dose_log as x (session_id, id, medication_id, day, slot, state, reason, reason_text, created_at)
  select r.session_id, r.id, r.medication_id, r.day, r.slot, r.state, r.reason, r.reason_text, r.created_at
  from jsonb_populate_record(null::public.dose_log, p_row) as r
  on conflict (session_id, medication_id, day, slot) do update
    set state = excluded.state, reason = excluded.reason, reason_text = excluded.reason_text
  returning * into d;
  return to_jsonb(d) - 'seq';
end;
$$;

-- Merge switches into a member's grant; a missing grant starts with every switch off.
create or replace function public.rp_set_family_grant(p_session_id text, p_member text, p_items jsonb, p_now timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  g public.family_grant;
begin
  insert into public.family_grant as x (session_id, member, items, created_at, updated_at)
  values (
    p_session_id,
    p_member,
    jsonb_build_object(
      'dose_summary', false, 'bp_summary', false, 'questions_count', false,
      'no_reply_alert', false, 'visit_transcripts', false, 'notes', false
    ) || coalesce(p_items, '{}'::jsonb),
    p_now,
    p_now
  )
  on conflict (session_id, member) do update
    set items = x.items || coalesce(p_items, '{}'::jsonb), updated_at = p_now
  returning * into g;
  return to_jsonb(g) - 'seq';
end;
$$;

revoke all on function public.rp_insert_seed(text, jsonb) from public, anon, authenticated;
revoke all on function public.rp_create_session(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.rp_reset_session(text, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.rp_log_dose(jsonb) from public, anon, authenticated;
revoke all on function public.rp_set_family_grant(text, text, jsonb, timestamptz) from public, anon, authenticated;

grant execute on function public.rp_insert_seed(text, jsonb) to service_role;
grant execute on function public.rp_create_session(jsonb, jsonb) to service_role;
grant execute on function public.rp_reset_session(text, integer, text, jsonb) to service_role;
grant execute on function public.rp_log_dose(jsonb) to service_role;
grant execute on function public.rp_set_family_grant(text, text, jsonb, timestamptz) to service_role;
