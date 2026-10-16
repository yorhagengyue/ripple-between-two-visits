-- Ripple web app: the tables of docs/plan/spec.md section 3, with the columns web/lib/store/types.ts
-- actually has (types.ts is the source of truth; the spec lists the extension columns too).
--
-- Conventions
--   * Every session-scoped table is keyed by (session_id, id): seed ids such as "v1", "med-amlodipine",
--     "item-R1" repeat in every session. family_grant is keyed by (session_id, member).
--   * Every row has session_id -> session(id) ON DELETE CASCADE, so deleting a session removes its rows.
--   * `seq` (identity) is insertion order. The memory store returns most lists in insertion order and
--     seed rows share one created_at, so the adapter (web/lib/store/supabase.ts) reads ORDER BY seq and
--     strips the column from the rows it hands out.
--   * Enum-like columns are plain text without CHECK constraints: the spec already lists values that
--     types.ts does not have yet (question.origin preventive / watch_pattern / chat, note.source chat),
--     and other modules add values while this adapter exists.
--   * Timestamps are written by the adapter from its own clock (tests fix the clock), never by now().
--
-- Security: RLS is enabled on every table and there are NO policies, and anon / authenticated get no
-- table privileges at all. Only the server talks to Postgres (PostgREST with the secret key, which is
-- the service_role and bypasses RLS). The browser never reads or writes these tables.

create table public.session (
  id           text        primary key,
  join_code    text        not null,
  template     text        not null,
  story_day    integer     not null,
  story_time   text,
  filming_mode boolean     not null default false,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  seq          bigint      generated always as identity,
  constraint session_join_code_key unique (join_code)
);
create index session_expires_at_idx on public.session (expires_at) where expires_at is not null;

create table public.session_member (
  session_id   text        not null,
  id           text        not null,
  role         text        not null,
  device_label text,
  created_at   timestamptz not null default now(),
  seq          bigint      generated always as identity,
  primary key (session_id, id),
  constraint session_member_session_fk foreign key (session_id) references public.session (id) on delete cascade
);

create table public.visit (
  session_id           text        not null,
  id                   text        not null,
  kind                 text        not null,
  place                text        not null,
  day                  integer     not null,
  date                 date        not null,
  consent_utterance_id text,
  status               text        not null,
  audio_path           text,
  script_section       text,
  audio_fixture        text,
  created_at           timestamptz not null default now(),
  seq                  bigint      generated always as identity,
  primary key (session_id, id),
  constraint visit_session_fk foreign key (session_id) references public.session (id) on delete cascade
);

create table public.utterance (
  session_id        text             not null,
  id                text             not null,
  visit_id          text             not null,
  t_start_ms        double precision not null,
  t_end_ms          double precision not null,
  speaker_cluster   integer,
  role              text             not null,
  role_state        text             not null,
  text              text             not null,
  lang              text,
  clip_path         text,
  scripted_fallback boolean          not null default false,
  created_at        timestamptz      not null default now(),
  seq               bigint           generated always as identity,
  primary key (session_id, id),
  constraint utterance_session_fk foreign key (session_id) references public.session (id) on delete cascade,
  constraint utterance_visit_fk foreign key (session_id, visit_id) references public.visit (session_id, id) on delete cascade
);
create index utterance_visit_idx on public.utterance (session_id, visit_id);

create table public.visit_item (
  session_id    text        not null,
  id            text        not null,
  visit_id      text        not null,
  type          text        not null,
  text          text        not null,
  utterance_ids jsonb       not null default '[]'::jsonb,
  slots         jsonb       not null default '{}'::jsonb,
  confirmed_by  text,
  required_line text,
  speaker       text,
  created_at    timestamptz not null default now(),
  seq           bigint      generated always as identity,
  primary key (session_id, id),
  constraint visit_item_session_fk foreign key (session_id) references public.session (id) on delete cascade,
  constraint visit_item_visit_fk foreign key (session_id, visit_id) references public.visit (session_id, id) on delete cascade
);
create index visit_item_visit_idx on public.visit_item (session_id, visit_id);

create table public.medication (
  session_id          text        not null,
  id                  text        not null,
  drug_id             text,
  origin              text        not null,
  label               jsonb,
  status              text        not null,
  start_day           integer,
  prescribed_visit_id text,
  note                text,
  pharmacist_answer   jsonb,
  created_at          timestamptz not null default now(),
  seq                 bigint      generated always as identity,
  primary key (session_id, id),
  constraint medication_session_fk foreign key (session_id) references public.session (id) on delete cascade
);

create table public.dose_log (
  session_id    text        not null,
  id            text        not null,
  medication_id text        not null,
  day           integer     not null,
  slot          text        not null,
  state         text        not null,
  reason        text,
  reason_text   text,
  created_at    timestamptz not null default now(),
  seq           bigint      generated always as identity,
  primary key (session_id, id),
  -- logDose upserts on (medicine, day, slot): a later "taken" replaces an earlier "unconfirmed"
  constraint dose_log_slot_key unique (session_id, medication_id, day, slot),
  constraint dose_log_session_fk foreign key (session_id) references public.session (id) on delete cascade
);

create table public.bp_reading (
  session_id text             not null,
  id         text             not null,
  day        integer          not null,
  slot       text             not null,
  systolic   double precision,
  diastolic  double precision,
  state      text             not null,
  note       text,
  created_at timestamptz      not null default now(),
  seq        bigint           generated always as identity,
  primary key (session_id, id),
  constraint bp_reading_session_fk foreign key (session_id) references public.session (id) on delete cascade
);

create table public.note (
  session_id text        not null,
  id         text        not null,
  day        integer     not null,
  text       text        not null,
  source     text        not null,
  lang       text,
  app_reply  text,
  created_at timestamptz not null default now(),
  seq        bigint      generated always as identity,
  primary key (session_id, id),
  constraint note_session_fk foreign key (session_id) references public.session (id) on delete cascade
);

create table public.question (
  session_id          text        not null,
  id                  text        not null,
  "for"               text        not null,
  origin              text        not null,
  text                text        not null,
  lang                text,
  status              text        not null,
  answer_text         text,
  answer_utterance_id text,
  answer_visit_id     text,
  answer_speaker      text,
  asked_at_visit_id   text,
  created_day         integer,
  evidence            text,
  created_at          timestamptz not null default now(),
  seq                 bigint      generated always as identity,
  primary key (session_id, id),
  constraint question_session_fk foreign key (session_id) references public.session (id) on delete cascade
);

create table public.family_grant (
  session_id text        not null,
  member     text        not null,
  items      jsonb       not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seq        bigint      generated always as identity,
  primary key (session_id, member),
  constraint family_grant_session_fk foreign key (session_id) references public.session (id) on delete cascade
);

create table public.reminder_clip (
  session_id text        not null,
  id         text        not null,
  "by"       text        not null,
  audio_path text,
  plays_at   text        not null,
  text       text,
  lang       text,
  created_at timestamptz not null default now(),
  seq        bigint      generated always as identity,
  primary key (session_id, id),
  constraint reminder_clip_session_fk foreign key (session_id) references public.session (id) on delete cascade
);

create table public.safety_event (
  session_id text             not null,
  id         text             not null,
  input      text             not null,
  lang       text,
  route      text             not null,
  candidates jsonb,
  layer1     jsonb,
  layer2     jsonb,
  layer3     jsonb,
  output     jsonb,
  blocked    jsonb,
  latency_ms double precision,
  created_at timestamptz      not null default now(),
  seq        bigint           generated always as identity,
  primary key (session_id, id),
  constraint safety_event_session_fk foreign key (session_id) references public.session (id) on delete cascade
);

-- not session-scoped
create table public.eval_run (
  id         text        primary key,
  git_sha    text,
  results    jsonb,
  created_at timestamptz not null default now(),
  seq        bigint      generated always as identity
);

-- M10-M12 tables from spec section 3. They are not in the Store interface yet; the columns follow the spec
-- table and those modules add them to types.ts and the adapter when they are built.
create table public.profile_fact (
  session_id    text        not null,
  id            text        not null,
  kind          text        not null,
  text          text        not null,
  source        text        not null,
  entered_by    text,
  confirmed_by  text,
  visit_item_id text,
  created_day   integer,
  created_at    timestamptz not null default now(),
  seq           bigint      generated always as identity,
  primary key (session_id, id),
  constraint profile_fact_session_fk foreign key (session_id) references public.session (id) on delete cascade
);

create table public.watch_metric (
  session_id text             not null,
  id         text             not null,
  day        integer          not null,
  metric     text             not null,
  value      double precision,
  created_at timestamptz      not null default now(),
  seq        bigint           generated always as identity,
  primary key (session_id, id),
  constraint watch_metric_session_fk foreign key (session_id) references public.session (id) on delete cascade
);

create table public.prevent_done (
  session_id text        not null,
  id         text        not null,
  item_id    text        not null,
  day        integer     not null,
  created_at timestamptz not null default now(),
  seq        bigint      generated always as identity,
  primary key (session_id, id),
  constraint prevent_done_session_fk foreign key (session_id) references public.session (id) on delete cascade
);

-- RLS on, no policies; anon and authenticated get nothing; the server role keeps full access.
alter table public.session        enable row level security;
alter table public.session_member enable row level security;
alter table public.visit          enable row level security;
alter table public.utterance      enable row level security;
alter table public.visit_item     enable row level security;
alter table public.medication     enable row level security;
alter table public.dose_log       enable row level security;
alter table public.bp_reading     enable row level security;
alter table public.note           enable row level security;
alter table public.question       enable row level security;
alter table public.family_grant   enable row level security;
alter table public.reminder_clip  enable row level security;
alter table public.safety_event   enable row level security;
alter table public.eval_run       enable row level security;
alter table public.profile_fact   enable row level security;
alter table public.watch_metric   enable row level security;
alter table public.prevent_done   enable row level security;

revoke all on table
  public.session, public.session_member, public.visit, public.utterance, public.visit_item, public.medication,
  public.dose_log, public.bp_reading, public.note, public.question, public.family_grant, public.reminder_clip,
  public.safety_event, public.eval_run, public.profile_fact, public.watch_metric, public.prevent_done
  from anon, authenticated;

grant all on table
  public.session, public.session_member, public.visit, public.utterance, public.visit_item, public.medication,
  public.dose_log, public.bp_reading, public.note, public.question, public.family_grant, public.reminder_clip,
  public.safety_event, public.eval_run, public.profile_fact, public.watch_metric, public.prevent_done
  to service_role;

-- the identity sequences behind `seq`
revoke all on all sequences in schema public from anon, authenticated;
grant usage, select on all sequences in schema public to service_role;
