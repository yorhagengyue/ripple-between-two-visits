-- C2 track B (time and the day), second round: a blood pressure reading he corrects or deletes keeps a record of the
-- change (real-app 12 「当天的读数能删、能改，改动留记录」). Until now PATCH /api/bp overwrote the numbers and DELETE
-- /api/bp removed the row: only a bus event said it had happened, and those are kept seven days.
--
--   history     the changes made to this reading, oldest first: [{ at, action: "edit" | "delete" | "restore", systolic,
--               diastolic, pulse, state }], each with the values the reading had before that change. Null until the
--               first change, so every existing reading reads exactly as before (lib/store/rows.ts OPTIONAL_COLUMNS).
--   deleted_at  when he deleted it. The row stays as the record (with its history); every list of readings leaves it out
--               (lib/store: listBp hides it unless asked), so the screens, the brief, her view and the reminders never
--               count it. Putting it back within the undo bar clears the column again.
--
-- Both are his own record only: never compared with anything, never judged. Deleting the scope deletes the rows as
-- before (the session foreign key cascades). No function is replaced: a demo reset and an account's reseed insert rows
-- without these columns.
--
-- Written by track B, not applied: the integrator applies it (scripts/db/migrate.mjs). Until then the Supabase adapter
-- still reads readings (it filters deleted rows after the select) and still records them; what needs the columns is
-- PATCH and DELETE /api/bp (a change, a delete, the undo bar's put-back), and a reading recorded in a part of the day
-- that already had 「这次没量」 (that row is then kept as a deleted row: until 0016 it simply stays, the reading is
-- written either way). Apply it before the build that carries this file goes to people.

alter table public.bp_reading add column if not exists history jsonb;
alter table public.bp_reading add column if not exists deleted_at timestamptz;

comment on column public.bp_reading.history is
  'C2 track B: the changes he made to this reading (values before each change, when, edit / delete / restore); null until the first';
comment on column public.bp_reading.deleted_at is
  'C2 track B: when he deleted this reading; the row stays as the record and every list leaves it out';
