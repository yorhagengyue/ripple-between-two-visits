-- Accounts, family links, consent and access records (docs/plan/real-app.md 3.4-3.6, 3.10, 3.11; C2 architecture
-- review 10-10). Written as a file only; the integrator applies it.
--
-- Who may touch these tables: only the server (service_role through PostgREST). RLS is on with no policies and
-- anon / authenticated get nothing (0008_privileges.sql). The browser never reads them; GET /api/me and the family
-- routes answer from the server, which binds every request to one scope first (web/lib/subject).
--
-- Append-only tables (account_event, care_grant_history, consent_record, care_access_log, service_read_log) refuse
-- UPDATE with a trigger, except a foreign key clearing its column (care_access_log keeps her label when her account
-- or the link goes). DELETE stays possible so an account deletion can cascade (real-app 3.11).

-- ---------------------------------------------------------------- accounts

create table public.account (
  user_id      uuid        primary key,
  login_kind   text        not null,
  username     text,
  display_name text,
  locale       text,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  seq          bigint      generated always as identity,
  constraint account_user_fk foreign key (user_id) references auth.users (id) on delete cascade,
  constraint account_login_kind_check check (login_kind in ('email', 'username')),
  constraint account_username_shape check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  constraint account_username_key unique (username)
);

-- one recovery code per account at a time: a salted scrypt hash, never the code (lib/auth recovery)
create table public.account_recovery (
  user_id    uuid        primary key,
  code_hash  text        not null,
  created_at timestamptz not null default now(),
  constraint account_recovery_user_fk foreign key (user_id) references public.account (user_id) on delete cascade
);

-- the phones he has used (the rp_device cookie, stored as a hash): per-device lockout and "his phones"
create table public.known_device (
  user_id      uuid        not null,
  device_hash  text        not null,
  label        text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  seq          bigint      generated always as identity,
  primary key (user_id, device_hash),
  constraint known_device_user_fk foreign key (user_id) references public.account (user_id) on delete cascade
);

-- a family-assisted password reset (off by default; real-app 3.6): bound to one known device, 10 minutes, one use
create table public.reset_request (
  id          uuid        primary key,
  user_id     uuid        not null,
  device_hash text        not null,
  link_id     uuid,
  code_hash   text,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now(),
  seq         bigint      generated always as identity,
  constraint reset_request_user_fk foreign key (user_id) references public.account (user_id) on delete cascade
);
create index reset_request_user_idx on public.reset_request (user_id);

-- what happened to the account (password_reset, recovery_code, export, family_assisted, ...); never patient content
create table public.account_event (
  id         text        primary key,
  user_id    uuid        not null,
  kind       text        not null,
  detail     jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  seq        bigint      generated always as identity,
  constraint account_event_user_fk foreign key (user_id) references public.account (user_id) on delete cascade
);
create index account_event_user_idx on public.account_event (user_id, seq);

-- ---------------------------------------------------------------- family links

-- him (patient_id) and her (family_id, empty until she accepts). The invitation token is stored as its sha256 only.
create table public.care_link (
  id                uuid        primary key,
  patient_id        uuid        not null,
  family_id         uuid,
  relation          text,
  family_label      text,
  patient_label     text,
  status            text        not null,
  invite_token_hash text,
  invite_expires_at timestamptz,
  accepted_at       timestamptz,
  confirmed_at      timestamptz,
  revoked_at        timestamptz,
  revoked_by        text,
  reset_helper      boolean     not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  seq               bigint      generated always as identity,
  constraint care_link_patient_fk foreign key (patient_id) references auth.users (id) on delete cascade,
  constraint care_link_family_fk foreign key (family_id) references auth.users (id) on delete cascade,
  constraint care_link_status_check check (status in ('invited', 'accepted', 'active', 'declined', 'expired', 'revoked')),
  constraint care_link_not_self check (family_id is null or patient_id <> family_id),
  constraint care_link_revoked_by_check check (revoked_by is null or revoked_by in ('patient', 'family')),
  constraint care_link_token_key unique (invite_token_hash)
);
create index care_link_patient_idx on public.care_link (patient_id);
create index care_link_family_idx on public.care_link (family_id) where family_id is not null;
-- one live link per pair of people
create unique index care_link_pair_live_key on public.care_link (patient_id, family_id) where status in ('accepted', 'active');

-- family_grant per link: on an account, member is the link id and link_id points at the link (demo rows keep member
-- 'wei-ling' and no link); version counts the changes, each change is one care_grant_history row
alter table public.family_grant
  add column link_id uuid,
  add column version integer not null default 1,
  add constraint family_grant_link_fk foreign key (link_id) references public.care_link (id) on delete cascade;
create index family_grant_link_idx on public.family_grant (link_id) where link_id is not null;

create table public.care_grant_history (
  id         bigint      generated always as identity primary key,
  link_id    uuid        not null,
  session_id text        not null,
  version    integer     not null,
  items      jsonb       not null,
  created_at timestamptz not null default now(),
  constraint care_grant_history_link_fk foreign key (link_id) references public.care_link (id) on delete cascade,
  constraint care_grant_history_session_fk foreign key (session_id) references public.session (id) on delete cascade
);
create index care_grant_history_link_idx on public.care_grant_history (link_id, version);

-- every read and write she makes through a link: which link, which sections, which route, her label at the time.
-- Her account going clears her id and keeps the label; his account going removes the rows with his space.
create table public.care_access_log (
  id             text        primary key,
  session_id     text        not null,
  link_id        uuid,
  family_user_id uuid,
  family_label   text,
  route          text        not null,
  items          jsonb       not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  seq            bigint      generated always as identity,
  constraint care_access_log_session_fk foreign key (session_id) references public.session (id) on delete cascade,
  constraint care_access_log_link_fk foreign key (link_id) references public.care_link (id) on delete set null,
  constraint care_access_log_family_fk foreign key (family_user_id) references auth.users (id) on delete set null
);
create index care_access_log_session_idx on public.care_access_log (session_id, seq);

-- a family member's reminder recording keeps its row when her account goes (by_user_id cleared, by_label kept)
alter table public.reminder_clip
  add constraint reminder_clip_by_user_fk foreign key (by_user_id) references auth.users (id) on delete set null,
  add constraint reminder_clip_link_fk foreign key (link_id) references public.care_link (id) on delete set null;

-- the server reading health data with its own key outside a person's request (a job, an operator): who, why, whose
create table public.service_read_log (
  id         text        primary key,
  actor      text        not null,
  reason     text        not null,
  session_id text,
  tables     jsonb       not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  seq        bigint      generated always as identity
);

-- ---------------------------------------------------------------- consent

-- the consent texts as published (insert only; a changed text is a new version)
create table public.consent_text (
  kind         text        not null,
  version      text        not null,
  locale       text        not null,
  sha256       text        not null,
  text         text        not null,
  published_at timestamptz not null default now(),
  primary key (kind, version, locale)
);

create table public.consent_record (
  id          text        primary key,
  user_id     uuid        not null,
  scope_id    text,
  kind        text        not null,
  decision    text        not null,
  version     text,
  text_sha256 text,
  method      text,
  evidence    jsonb,
  assisted    boolean     not null default false,
  created_at  timestamptz not null default now(),
  seq         bigint      generated always as identity,
  constraint consent_record_user_fk foreign key (user_id) references auth.users (id) on delete cascade,
  constraint consent_record_decision_check check (decision in ('granted', 'declined', 'withdrawn'))
);
create index consent_record_user_idx on public.consent_record (user_id, kind, seq);

-- ---------------------------------------------------------------- append-only and the grant history trigger

-- Refuses any UPDATE, except clearing the columns named as trigger arguments: those are the foreign keys declared
-- ON DELETE SET NULL (a deleted account or link), whose referential action is itself an UPDATE of this row.
create or replace function public.rp_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  c text;
begin
  if tg_nargs > 0 then
    foreach c in array tg_argv loop
      if n -> c = 'null'::jsonb then
        o := o - c;
        n := n - c;
      end if;
    end loop;
  end if;
  if o = n then
    return new;
  end if;
  raise exception using errcode = '42501', message = 'append_only';
end;
$$;

create trigger account_event_append_only before update on public.account_event
  for each row execute function public.rp_append_only();
create trigger care_grant_history_append_only before update on public.care_grant_history
  for each row execute function public.rp_append_only();
create trigger care_access_log_append_only before update on public.care_access_log
  for each row execute function public.rp_append_only('family_user_id', 'link_id');
create trigger consent_record_append_only before update on public.consent_record
  for each row execute function public.rp_append_only();
create trigger service_read_log_append_only before update on public.service_read_log
  for each row execute function public.rp_append_only();
create trigger consent_text_append_only before update on public.consent_text
  for each row execute function public.rp_append_only();

-- a link's switches: each change bumps the version and leaves one history row (demo grants have no link: untouched)
create or replace function public.rp_grant_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.link_id is not null and new.items is distinct from old.items then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end;
$$;

create or replace function public.rp_grant_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.link_id is not null and (tg_op = 'INSERT' or new.version <> old.version) then
    insert into public.care_grant_history (link_id, session_id, version, items, created_at)
    values (new.link_id, new.session_id, new.version, new.items, new.updated_at);
  end if;
  return null;
end;
$$;

create trigger family_grant_version before update on public.family_grant
  for each row execute function public.rp_grant_version();
create trigger family_grant_history after insert or update on public.family_grant
  for each row execute function public.rp_grant_history();

-- ---------------------------------------------------------------- the link's life, one transaction each
-- Each returns { ok: true, link } or { ok: false, code } (the memory store answers the same, lib/store/memory.ts).

-- he invites: the link (status invited) and its switches (his choice, effective only once the link is active)
create or replace function public.rp_invite_create(p_link jsonb, p_items jsonb, p_now timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  l public.care_link;
begin
  insert into public.care_link (id, patient_id, relation, family_label, patient_label, status, invite_token_hash,
                                invite_expires_at, reset_helper, created_at, updated_at)
  select r.id, r.patient_id, r.relation, r.family_label, r.patient_label, 'invited', r.invite_token_hash,
         r.invite_expires_at, false, p_now, p_now
  from jsonb_populate_record(null::public.care_link, p_link) as r
  returning * into l;
  insert into public.family_grant (session_id, member, items, created_at, updated_at, link_id, version)
  values (
    l.patient_id::text,
    l.id::text,
    jsonb_build_object(
      'dose_summary', false, 'bp_summary', false, 'questions_count', false,
      'no_reply_alert', false, 'visit_transcripts', false, 'notes', false
    ) || coalesce(p_items, '{}'::jsonb),
    p_now,
    p_now,
    l.id,
    1
  );
  return jsonb_build_object('ok', true, 'link', to_jsonb(l) - 'seq');
end;
$$;

-- she accepts with the token: right hash, not expired, still invited, not his own invitation
create or replace function public.rp_invite_accept(p_token_hash text, p_family_id uuid, p_family_label text, p_now timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  l public.care_link;
begin
  select * into l from public.care_link where invite_token_hash = p_token_hash for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'invite_not_found');
  end if;
  if l.status <> 'invited' then
    return jsonb_build_object('ok', false, 'code', 'invite_used');
  end if;
  if l.invite_expires_at is not null and l.invite_expires_at <= p_now then
    update public.care_link set status = 'expired', updated_at = p_now where id = l.id;
    return jsonb_build_object('ok', false, 'code', 'invite_expired');
  end if;
  if l.patient_id = p_family_id then
    return jsonb_build_object('ok', false, 'code', 'invite_self');
  end if;
  if exists (select 1 from public.care_link x where x.patient_id = l.patient_id and x.family_id = p_family_id and x.status in ('accepted', 'active')) then
    return jsonb_build_object('ok', false, 'code', 'link_exists');
  end if;
  update public.care_link
    set family_id = p_family_id, family_label = coalesce(p_family_label, family_label), status = 'accepted',
        accepted_at = p_now, updated_at = p_now
  where id = l.id
  returning * into l;
  return jsonb_build_object('ok', true, 'link', to_jsonb(l) - 'seq');
end;
$$;

-- he confirms it is her (active, switches take effect) or says it is not (declined, the token is void)
create or replace function public.rp_link_confirm(p_link_id uuid, p_patient_id uuid, p_yes boolean, p_now timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  l public.care_link;
begin
  select * into l from public.care_link where id = p_link_id and patient_id = p_patient_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'link_not_found');
  end if;
  if l.status <> 'accepted' then
    return jsonb_build_object('ok', false, 'code', 'link_not_accepted');
  end if;
  if p_yes then
    update public.care_link set status = 'active', confirmed_at = p_now, invite_token_hash = null, updated_at = p_now
    where id = l.id returning * into l;
  else
    update public.care_link set status = 'declined', invite_token_hash = null, updated_at = p_now
    where id = l.id returning * into l;
  end if;
  return jsonb_build_object('ok', true, 'link', to_jsonb(l) - 'seq');
end;
$$;

-- he stops sharing (by = patient) or she leaves (by = family); an invitation not accepted yet is cancelled the same way
create or replace function public.rp_link_revoke(p_link_id uuid, p_actor_id uuid, p_by text, p_now timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  l public.care_link;
begin
  if p_by not in ('patient', 'family') then
    raise exception using errcode = '22023', message = 'revoked_by';
  end if;
  select * into l from public.care_link
  where id = p_link_id and ((p_by = 'patient' and patient_id = p_actor_id) or (p_by = 'family' and family_id = p_actor_id))
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'link_not_found');
  end if;
  if l.status in ('revoked', 'declined', 'expired') then
    return jsonb_build_object('ok', false, 'code', 'link_closed');
  end if;
  update public.care_link set status = 'revoked', revoked_at = p_now, revoked_by = p_by, invite_token_hash = null, updated_at = p_now
  where id = l.id returning * into l;
  return jsonb_build_object('ok', true, 'link', to_jsonb(l) - 'seq');
end;
$$;

-- ---------------------------------------------------------------- RLS on, nothing for the browser

alter table public.account            enable row level security;
alter table public.account_recovery   enable row level security;
alter table public.known_device       enable row level security;
alter table public.reset_request      enable row level security;
alter table public.account_event      enable row level security;
alter table public.care_link          enable row level security;
alter table public.care_grant_history enable row level security;
alter table public.care_access_log    enable row level security;
alter table public.service_read_log   enable row level security;
alter table public.consent_text       enable row level security;
alter table public.consent_record     enable row level security;

revoke all on table
  public.account, public.account_recovery, public.known_device, public.reset_request, public.account_event,
  public.care_link, public.care_grant_history, public.care_access_log, public.service_read_log,
  public.consent_text, public.consent_record
  from anon, authenticated;

grant all on table
  public.account, public.account_recovery, public.known_device, public.reset_request, public.account_event,
  public.care_link, public.care_grant_history, public.care_access_log, public.service_read_log,
  public.consent_text, public.consent_record
  to service_role;

revoke all on all sequences in schema public from anon, authenticated;
grant usage, select on all sequences in schema public to service_role;

revoke all on function public.rp_append_only() from public, anon, authenticated;
revoke all on function public.rp_grant_version() from public, anon, authenticated;
revoke all on function public.rp_grant_history() from public, anon, authenticated;
revoke all on function public.rp_invite_create(jsonb, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.rp_invite_accept(text, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.rp_link_confirm(uuid, uuid, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.rp_link_revoke(uuid, uuid, text, timestamptz) from public, anon, authenticated;

grant execute on function public.rp_invite_create(jsonb, jsonb, timestamptz) to service_role;
grant execute on function public.rp_invite_accept(text, uuid, text, timestamptz) to service_role;
grant execute on function public.rp_link_confirm(uuid, uuid, boolean, timestamptz) to service_role;
grant execute on function public.rp_link_revoke(uuid, uuid, text, timestamptz) to service_role;
