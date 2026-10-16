-- C2 track B (time and the day): the pulse from the blood pressure keypad.
--
-- The keypad copies a home monitor's three rows: the top number, the bottom number and the pulse (which may stay
-- empty). The pulse is his record only: never compared with anything, never judged, and handed out only once set
-- (lib/store/rows.ts OPTIONAL_COLUMNS), so every existing reading reads exactly as before.
--
-- Undo of a dose answer (journey 02) deletes the dose_log row through the existing table privileges (service role
-- only, 0008): no change is needed for it here.
--
-- Written by track B, not applied: the integrator renumbers this file and applies it (scripts/db/migrate.mjs).

alter table public.bp_reading add column if not exists pulse double precision;

comment on column public.bp_reading.pulse is
  'C2 track B: the pulse he typed from the monitor (optional); a record only, never a comparison';
