/**
 * An operator reading a person's data with the server's key (docs/plan/real-app.md 3.11 日志和审计: 「运维排障：脚本必须带一句
 * 理由，按人写 service_read_log，没有理由就拒绝运行」; 8.9 privacy/service-read-audit; C2 track H). Server-only.
 *
 * /privacy tells people that the people who run the service look only when fixing a fault and that every look is
 * logged: who, when and why (lib/privacy/notice.ts). This is the code that makes it so: a script that reads a person's
 * records goes through here, and nothing is read before the log row is written.
 *
 *   auditedRead(store, { actor, reason, scopeId, tables }, read)
 *        refuses (ServiceReadRefused) without an actor, without a reason that is a sentence, or without tables; writes
 *        one service_read_log row (who, why, whose scope, which tables; never any content); only then runs `read`. If
 *        the row cannot be written, nothing is read.
 *   readPerson(store, { actor, reason, login | userId, tables?, rows? })
 *        what scripts/ops/read-person.ts does: finds the person's space, and through auditedRead returns the row count
 *        of each table asked for (and the rows themselves when asked). One log row per person per run.
 *
 * The person sees these rows in his export (service_reads) and they stay when his account goes (the audit trail is kept
 * on purpose; the scope id in them then names nobody).
 */
import { isAccount } from "@/lib/store/scope";
import type { ServiceReadLogRow, SessionRow, Store } from "@/lib/store/types";
import { systemSubject } from "@/lib/subject/resolve";

export type ServiceReadRefusal = "no_actor" | "no_reason" | "no_tables" | "no_such_person" | "unknown_table";

export class ServiceReadRefused extends Error {
  constructor(
    readonly code: ServiceReadRefusal,
    message: string,
  ) {
    super(message);
    this.name = "ServiceReadRefused";
  }
}

/** A reason is a sentence someone can read later: at least this many characters, with letters in it. */
export const MIN_REASON_CHARS = 12;

export interface ServiceRead {
  /** who is reading: a person's name or handle, or the script's own name */
  actor: string;
  /** why, in a sentence ("fault FB-12: his 9:15 reminder was not sent") */
  reason: string;
  /** whose data: the person's scope id; null only for a read that is about no one person (whole-table counts) */
  scopeId: string | null;
  /** the tables read */
  tables: readonly string[];
}

/** The reason as it will be stored, or a refusal. */
export function checkServiceRead(req: Pick<ServiceRead, "actor" | "reason" | "tables">): { actor: string; reason: string } {
  const actor = (req.actor ?? "").trim();
  const reason = (req.reason ?? "").trim().replace(/\s+/g, " ");
  if (!actor) throw new ServiceReadRefused("no_actor", "refused: say who is reading (--actor <name>)");
  if (reason.length < MIN_REASON_CHARS || !/\p{L}/u.test(reason)) {
    throw new ServiceReadRefused("no_reason", `refused: give the reason for this read in a sentence (--reason "...", at least ${MIN_REASON_CHARS} characters); it is written to service_read_log`);
  }
  if (!req.tables.length) throw new ServiceReadRefused("no_tables", "refused: name the tables to read");
  return { actor: actor.slice(0, 120), reason: reason.slice(0, 500) };
}

/** Write the log row, then read. No reason, no read; no log row, no read. */
export async function auditedRead<T>(store: Pick<Store, "addServiceReadLog">, req: ServiceRead, read: (entry: ServiceReadLogRow) => Promise<T>): Promise<T> {
  const ok = checkServiceRead(req);
  const entry = await store.addServiceReadLog({ actor: ok.actor, reason: ok.reason, session_id: req.scopeId, tables: [...new Set(req.tables)].sort() });
  return read(entry);
}

type Reader = (store: Store, scope: SessionRow) => Promise<unknown[]>;

/** What an operator can read of one person, by table name. Every read goes through a store bound to that scope. */
export const PERSON_TABLES: Readonly<Record<string, Reader>> = {
  visits: (s, scope) => s.listVisits(scope.id),
  utterances: async (s, scope) => (await Promise.all((await s.listVisits(scope.id)).map((v) => s.listUtterances(scope.id, v.id)))).flat(),
  visit_items: (s, scope) => s.listVisitItems(scope.id),
  medications: (s, scope) => s.listMeds(scope.id),
  understanding_answers: (s, scope) => s.listUnderstandingAnswers(scope.id),
  dose_log: (s, scope) => s.listDoses(scope.id),
  bp_readings: (s, scope) => s.listBp(scope.id),
  notes: (s, scope) => s.listNotes(scope.id),
  questions: (s, scope) => s.listQuestions(scope.id),
  reminder_clips: (s, scope) => s.listReminderClips(scope.id),
  safety_events: (s, scope) => s.listSafetyEvents(scope.id),
  profile_facts: (s, scope) => s.listProfileFacts(scope.id),
  prevent_done: (s, scope) => s.listPreventDone(scope.id),
  watch_metrics: (s, scope) => s.listWatchMetrics(scope.id),
  diet_checks: (s, scope) => s.listDietChecks(scope.id),
  chat_messages: (s, scope) => s.listChatMessages(scope.id),
  brief_snapshots: (s, scope) => s.listBriefSnapshots(scope.id),
  translations: (s, scope) => s.listTranslations(scope.id),
  reminder_deliveries: (s, scope) => s.listDeliveries(scope.id),
  family_access_log: (s, scope) => s.listCareAccessLog(scope.id),
};

export interface ReadPersonRequest {
  actor: string;
  reason: string;
  /** his username as he signs in with it, or */
  login?: string;
  /** his user id */
  userId?: string;
  /** the tables to read (default: all of PERSON_TABLES) */
  tables?: readonly string[];
  /** hand back the rows too, not only how many */
  rows?: boolean;
}

export interface ReadPersonResult {
  /** the id of the service_read_log row this read left */
  logId: string;
  tables: string[];
  counts: Record<string, number>;
  rows?: Record<string, unknown[]>;
}

/**
 * One operator read of one person: refuse without a reason, find his space, write the log row, then read the tables
 * through a store bound to his scope. `store` is the process-wide store (a script's own access; never a request's).
 */
export async function readPerson(store: Store, req: ReadPersonRequest): Promise<ReadPersonResult> {
  const tables = [...new Set(req.tables?.length ? req.tables : Object.keys(PERSON_TABLES))];
  // the refusals that need no lookup come first: nothing at all is read without a reason
  checkServiceRead({ actor: req.actor, reason: req.reason, tables });
  const unknown = tables.filter((t) => !(t in PERSON_TABLES));
  if (unknown.length) throw new ServiceReadRefused("unknown_table", `refused: unknown table ${unknown.join(", ")}; known: ${Object.keys(PERSON_TABLES).join(", ")}`);
  const userId = req.userId?.trim() || (req.login?.trim() ? ((await store.getAccountByUsername(req.login.trim()))?.user_id ?? null) : null);
  const row = userId ? await store.getSession(userId) : null;
  const scope = row && isAccount(row) ? row : null;
  if (!scope) throw new ServiceReadRefused("no_such_person", "refused: no account space for that login or user id");
  return auditedRead(store, { actor: req.actor, reason: req.reason, scopeId: scope.id, tables }, async (entry) => {
    const bound = systemSubject(store, scope).store;
    const counts: Record<string, number> = {};
    const rows: Record<string, unknown[]> = {};
    for (const t of tables) {
      const got = await PERSON_TABLES[t](bound, scope);
      counts[t] = got.length;
      if (req.rows) rows[t] = got;
    }
    return { logId: entry.id, tables, counts, ...(req.rows ? { rows } : {}) };
  });
}
