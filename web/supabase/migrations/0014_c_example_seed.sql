-- The example account is laid out in one transaction (docs/plan/real-app.md 4.1 line 904; track C, 10-10). Written as
-- a file only; the integrator renumbers and applies it.
--
-- Until now rp_insert_seed laid out nine tables, and the example's profile facts and the transcripts of its three past
-- visits were written by separate calls afterwards (lib/story/example.ts): a sign-up or a "lay it out again" that
-- failed in between left a half-filled example. This re-creates rp_insert_seed (its 0004 text, unchanged) with two
-- more inserts, read from two more keys of p_tables:
--
--   utterances      the past visits' lines (after the visits: utterance_visit_fk)
--   profile_facts   the example profile's facts, with the 0007 columns
--
-- rp_create_account_space and rp_reseed_account call it inside their own transaction, so the whole example is there or
-- none of it is (rp_reseed_account already deletes both tables first). Absent keys insert nothing: the demo's seed
-- (rp_create_session, rp_reset_session) is unchanged.
--
-- The app works against a database without this file too: the old function ignores the two keys, and
-- lib/story/example.ts ensureExampleWhole writes what is missing right after (and on his next page), safely repeated.
-- No table, column, policy or privilege changes; the function keeps its owner and grants (0004, 0008).

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

  -- 0014: an account's laid-out space may carry its past visits' transcripts (after the visits: the visit foreign key)
  -- and its profile facts; the demo's seed has neither key
  insert into public.utterance (session_id, id, visit_id, t_start_ms, t_end_ms, speaker_cluster, role, role_state, text,
                                lang, clip_path, scripted_fallback, created_at)
  select p_session_id, r.id, r.visit_id, r.t_start_ms, r.t_end_ms, r.speaker_cluster, r.role, r.role_state, r.text,
         r.lang, r.clip_path, coalesce(r.scripted_fallback, false), r.created_at
  from jsonb_array_elements(coalesce(p_tables -> 'utterances', '[]'::jsonb)) with ordinality as e(j, n)
  cross join lateral jsonb_populate_record(null::public.utterance, e.j) as r
  order by e.n;

  insert into public.profile_fact (session_id, id, kind, text, source, entered_by, confirmed_by, visit_item_id,
                                   created_day, data, hidden, entered_by_user_id, link_id, confirmed_at, updated_at,
                                   created_at)
  select p_session_id, r.id, r.kind, r.text, r.source, r.entered_by, r.confirmed_by, r.visit_item_id,
         r.created_day, r.data, r.hidden, r.entered_by_user_id, r.link_id, r.confirmed_at, r.updated_at,
         r.created_at
  from jsonb_array_elements(coalesce(p_tables -> 'profile_facts', '[]'::jsonb)) with ordinality as e(j, n)
  cross join lateral jsonb_populate_record(null::public.profile_fact, e.j) as r
  order by e.n;
end;
$$;

revoke all on function public.rp_insert_seed(text, jsonb) from public, anon, authenticated;
grant execute on function public.rp_insert_seed(text, jsonb) to service_role;
