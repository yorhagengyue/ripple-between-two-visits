-- His question list (journey 07 「他能自己加、改、跳过问题」, journeys 14, 22; track C, 10-10): two columns on question so
-- what he does to his own list is kept as he did it. Written as a file only; the integrator renumbers and applies it.
--
--   edited_at    he changed the words himself: the list shows the words as he wrote them (his own words), never a
--                recorded summary in their place (lib/profile/questions.ts)
--   merged_into  the id of the question this one was folded into (a duplicate he merged, status skipped): kept for the
--                record and for undo, never shown as a question of its own nor counted as waiting
--
-- Plain columns, no constraint across rows: the server checks that merged_into names a question of the same scope
-- (lib/profile/questions.ts). Seed rows never carry them (rp_insert_seed lists its columns), so the demo is unchanged.
-- RLS and privileges are the table's own (0001, 0008): nothing for anon or authenticated.

alter table public.question
  add column edited_at   timestamptz,
  add column merged_into text;
