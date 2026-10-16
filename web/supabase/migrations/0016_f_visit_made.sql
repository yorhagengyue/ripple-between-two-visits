-- C2 track F (visits and medicines), round three: how a visit's record was made.
--
-- real-app 2.2 step 7 and 3.11: without his consent to AI processing a visit's record is made by the fixed rules only
-- and the doctor's English is not translated. The review page says so. Until now it could only look at his setting as
-- it is today, so a visit made with AI on showed the sentence after he turned AI off, and a visit made with AI off
-- stopped showing it after he turned AI on. The record now carries how it was made:
--
--   visit.ai_used   true   the labelling model and the translation were allowed when the record was made
--                   false  the record was made by the fixed rules only, and nothing was translated
--                   null   not recorded (visits made before this column, planned visits, seed rows)
--
-- Handed out only once set (lib/store/rows.ts OPTIONAL_COLUMNS), so every existing visit row reads exactly as before.
-- Until this file is applied the app keeps working: lib/visit/pipeline.ts writes the column in its own best-effort
-- update after the record is made, and the review falls back to his setting as it is now.
--
-- No function is replaced and no privilege changes: the column is on an existing table (service role only, 0008).
-- The same round's undo of a prescription or a planned follow-up deletes a medication or a visit row through the
-- existing table privileges (as 0011 notes for dose_log): nothing is needed for it here.
--
-- Written by track F, not applied: the integrator renumbers this file if needed and applies it (scripts/db/migrate.mjs).

alter table public.visit add column if not exists ai_used boolean;

comment on column public.visit.ai_used is
  'C2 track F: how the record was made: true = model labelling and translation allowed, false = fixed rules only, null = not recorded';
