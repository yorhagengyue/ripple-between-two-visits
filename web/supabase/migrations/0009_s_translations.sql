-- C2 track S: the translation cache (web/lib/translate). A doctor's English line in Chinese (en>zh-Hans), or his own
-- Chinese words in English for the brief (zh-Hans>en): translated once, checked twice (the same numbers, medicine names,
-- dose units, frequencies and times on both sides, a negation kept; then the checker model says the meaning did not
-- change), and kept here so the same text is never translated again on the next look. A rejected text is kept too, so a
-- failed check is not paid for twice; the screen then shows the original words and the recording alone.
--
-- One row per (scope, direction, source text). The rows go with the scope (deleting the scope deletes them). A demo reset
-- or an account's reseed keeps them on purpose: a row is keyed by the source text itself, so it can only ever be shown for
-- those same words.
--
-- Written as a file only; the integrator renumbers it after the other tracks' migrations and applies it. Server-only like
-- every table here (0008_privileges.sql): RLS on with no policies, nothing for anon or authenticated.

create table public.translation (
  session_id    text        not null,
  id            text        not null,
  direction     text        not null,
  source_sha256 text        not null,
  source_text   text        not null,
  text          text,
  status        text        not null,
  checks        jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  seq           bigint      generated always as identity,
  primary key (session_id, id),
  constraint translation_direction_check check (direction in ('en>zh-Hans', 'zh-Hans>en')),
  constraint translation_status_check check (status in ('checked', 'rejected')),
  constraint translation_checked_has_text check (status <> 'checked' or (text is not null and length(text) > 0)),
  constraint translation_sha256_check check (source_sha256 ~ '^[0-9a-f]{64}$'),
  constraint translation_source_unique unique (session_id, direction, source_sha256),
  constraint translation_session_fk foreign key (session_id) references public.session (id) on delete cascade
);

alter table public.translation enable row level security;
revoke all on public.translation from anon, authenticated;
grant all on public.translation to service_role;
