-- C2 track B (time and the day), fix round 10-11: a dose row says what it is to a cell whose window closed before
-- tracking began (docs/plan/real-app.md 4.4). Written as a file only; the integrator renumbers and applies it.
--
-- Until now lib/daily/tracking.ts decided it from the row's created_at: an answer on a cell outside tracking counted in
-- the summaries when it had been written at or before the scope's tracking_since. The example's 33 laid-out mornings
-- are stamped with the very moment tracking begins, so they counted; but so did a 吃了 tapped in that same millisecond
-- on this morning's cell (34 / 30 instead of 33 / 29), and a correction of yesterday's laid-out answer, written later,
-- made that whole morning leave every count (32 / 28).
--
--   dose_log.pre_tracking   true:  the answer is part of his record from before tracking began: laid out with the space
--                                  (the example's history, a filming account's scene), or his correction of an answer
--                                  that already counted there.
--                                  It counts, whenever it was written.
--                           false: an answer written on an account that is not such a row. On a cell outside tracking
--                                  it counts only when it was written strictly before tracking_since (a filming
--                                  account's clock moved on after he answered).
--                           null:  a demo row, or a row from before this column. Read by the rule as it was (written at
--                                  or before tracking_since), so no existing account changes its numbers.
--
-- Two functions are re-created, each with its current text and the one column more:
--   rp_log_dose      (0002) a new row takes pre_tracking as given; an existing row keeps its own, as it keeps its id
--                    and created_at.
--   rp_insert_seed   (0014) the laid-out dose rows take pre_tracking from the tables they are given. The demo's seed
--                    gives none (null, as before).
-- No policy or privilege changes; both functions keep their owner and grants (0004, 0008, 0014).
--
-- The app works against a database without this file too: jsonb_populate_record ignores the unknown key, rows come back
-- without the column, and every row is read by the old rule. Nothing fails; the two faults above simply stay until it
-- is applied. Apply it before the build that carries this file is used for recording.

alter table public.dose_log add column if not exists pre_tracking boolean;

comment on column public.dose_log.pre_tracking is
  'C2 track B: true when the answer is part of his record from before tracking began (laid out with the space, or a correction of an answer that counted there); false for any other answer written on an account; null for demo rows and rows older than the column';

-- One row per (medicine, day, slot). A new row takes p_row as given; an existing row keeps its id, created_at and
-- pre_tracking and takes state, reason and reason_text (the memory store's logDose).
create or replace function public.rp_log_dose(p_row jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  d public.dose_log;
begin
  insert into public.dose_log as x (session_id, id, medication_id, day, slot, state, reason, reason_text, pre_tracking, created_at)
  select r.session_id, r.id, r.medication_id, r.day, r.slot, r.state, r.reason, r.reason_text, r.pre_tracking, r.created_at
  from jsonb_populate_record(null::public.dose_log, p_row) as r
  on conflict (session_id, medication_id, day, slot) do update
    set state = excluded.state, reason = excluded.reason, reason_text = excluded.reason_text
  returning * into d;
  return to_jsonb(d) - 'seq';
end;
$$;

-- rp_insert_seed: its 0014 text, with pre_tracking in the dose_log insert (nothing else changed).
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

  -- 0018: pre_tracking (true on an account's laid-out history; the demo's seed gives none)
  insert into public.dose_log (session_id, id, medication_id, day, slot, state, reason, reason_text, pre_tracking, created_at)
  select p_session_id, r.id, r.medication_id, r.day, r.slot, r.state, r.reason, r.reason_text, r.pre_tracking, r.created_at
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

revoke all on function public.rp_log_dose(jsonb) from public, anon, authenticated;
grant execute on function public.rp_log_dose(jsonb) to service_role;
revoke all on function public.rp_insert_seed(text, jsonb) from public, anon, authenticated;
grant execute on function public.rp_insert_seed(text, jsonb) to service_role;
