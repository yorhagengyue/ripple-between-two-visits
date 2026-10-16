-- C2 track F: the understanding checklist's answers (journey 06 「开药到会吃」; real-app 6.10, 12 「理解清单的『知道』刷新后
-- 忘了 → 存下来」, e2e-chains 序 21). Four fixed items per medicine (这个药是做什么的 / 没感觉要不要吃 / 什么时候吃 /
-- 漏了怎么办), each answered by him with 知道 or 不确定; 不确定 also puts his question on the list (the question table,
-- as before). Nobody scores him: this keeps what he said about himself so the checklist shows it again.
--
-- One row per (scope, medicine, item): his latest answer. The rows go with the medicine: a demo reset or an account's
-- reseed deletes the medicines (rp_reset_session, rp_reseed_account) and the foreign key cascades, so no function is
-- replaced here; deleting the scope deletes them too.
--
-- Written as a file only; the integrator renumbers it after the other tracks' migrations and applies it. Server-only like
-- every table here (0008_privileges.sql): RLS on with no policies, nothing for anon or authenticated.

create table public.understanding_answer (
  session_id    text        not null,
  id            text        not null,
  medication_id text        not null,
  item          text        not null,
  answer        text        not null,
  day           integer,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  seq           bigint      generated always as identity,
  primary key (session_id, id),
  constraint understanding_answer_item_check check (item in ('purpose', 'feel_fine', 'when', 'missed')),
  constraint understanding_answer_answer_check check (answer in ('know', 'unsure')),
  constraint understanding_answer_once unique (session_id, medication_id, item),
  constraint understanding_answer_session_fk foreign key (session_id) references public.session (id) on delete cascade,
  constraint understanding_answer_medication_fk foreign key (session_id, medication_id)
    references public.medication (session_id, id) on delete cascade
);

alter table public.understanding_answer enable row level security;
revoke all on public.understanding_answer from anon, authenticated;
grant all on public.understanding_answer to service_role;
