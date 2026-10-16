-- C2 track R (long visit recordings): a visit's recording may be several files.
--
-- The phone records 16 kHz mono 16-bit WAV (about 1.9 MB a minute) and the audio bucket takes at most 50 MB in one
-- file, so a visit longer than about 27 minutes could never be uploaded. A long visit is now uploaded as consecutive
-- parts (lib/visit/parts.ts: 20 minutes of audio each, about 37 MB), each one registered here by the server after it
-- checked the file, before the phone sends the next:
--
--   visit.audio_parts   null                         a recording in one file (every visit until now, and every visit
--                                                    that fits in one part): exactly as before, audio_path alone
--                       [{ "path": ..., "ms": ... }]  the parts in order: the file's path in the audio bucket and the
--                                                    length of its audio in milliseconds, as the server measured it
--
-- audio_path keeps its meaning, "the server holds this visit's whole recording": while parts are still arriving it
-- stays null, and once the last part is there it is the first part's path. Every reader that only asks whether a
-- recording is there is unchanged; the readers that need the audio (transcript, sentence clips, listening, his export,
-- retention, the orphan sweep) read the list (lib/visit/recording.ts).
--
-- Handed out only once set (lib/store/rows.ts OPTIONAL_COLUMNS), so every existing visit row reads exactly as before.
-- Until this file is applied the app keeps working for every visit that fits in one file: nothing writes the column
-- for those. A long visit then fails at its first part (the phone keeps its copy and says the upload did not work).
--
-- No function is replaced and no privilege changes: the column is on an existing table (service role only, 0008).
-- Written by track R, not applied: the integrator renumbers this file if needed and applies it (scripts/db/migrate.mjs).

alter table public.visit
  add column if not exists audio_parts jsonb,
  add constraint visit_audio_parts_array check (audio_parts is null or jsonb_typeof(audio_parts) = 'array');

comment on column public.visit.audio_parts is
  'C2 track R: the parts of a long recording in order, [{path, ms}]; null = one file (audio_path alone)';
