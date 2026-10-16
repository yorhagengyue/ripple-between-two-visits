/**
 * The reason gate for web/scripts/db/*.mjs that read data tables with the database's own connection (C2 track H;
 * docs/plan/real-app.md 3.11 日志和审计: 「运维排障：脚本必须带一句理由……写 service_read_log，没有理由就拒绝运行」, and 3.8: the log
 * says who (which job or which operator script), why, whose scope, which tables, when; never any content).
 *
 *   readReason(argv, env)                 { ok: true, actor, reason } from --actor / --reason (or RIPPLE_OPS_ACTOR /
 *                                         RIPPLE_OPS_REASON for a script that calls another), or { ok: false, message }
 *   logServiceRead(client, { ... })       one row in public.service_read_log, written before the read; session_id is
 *                                         null for a read about no one person (whole-table row counts)
 *
 * The same rule as lib/privacy/service-read.ts (the app's side): a reason is a sentence, at least 12 characters with
 * letters in it. The per-person read is scripts/ops/read-person.ts.
 */
import { randomUUID } from "node:crypto";

export const MIN_REASON_CHARS = 12;

/**
 * @param {readonly string[]} argv
 * @param {string} name
 */
function arg(argv, name) {
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return "";
  const a = argv[i];
  if (a.includes("=")) return a.slice(a.indexOf("=") + 1);
  const next = argv[i + 1];
  return next && !next.startsWith("--") ? next : "";
}

/**
 * Who reads and why, or the refusal to print.
 * @param {readonly string[]} argv
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ ok: true, actor: string, reason: string } | { ok: false, message: string }}
 */
export function readReason(argv, env = process.env) {
  const actor = (arg(argv, "actor") || env.RIPPLE_OPS_ACTOR || "").trim();
  const reason = (arg(argv, "reason") || env.RIPPLE_OPS_REASON || "").trim().replace(/\s+/g, " ");
  if (!actor) return { ok: false, message: 'refused: say who is reading (--actor <name>) and why (--reason "<a sentence>"); the read is written to service_read_log' };
  if (reason.length < MIN_REASON_CHARS || !/\p{L}/u.test(reason)) {
    return { ok: false, message: `refused: give the reason for this read in a sentence (--reason "...", at least ${MIN_REASON_CHARS} characters); it is written to service_read_log` };
  }
  return { ok: true, actor: actor.slice(0, 120), reason: reason.slice(0, 500) };
}

/**
 * Write the audit row (who, why, which tables; session_id null: no one person). Returns its id.
 * @param {{ query(sql: string, params: unknown[]): Promise<unknown> }} client
 * @param {{ actor: string, reason: string, tables: readonly string[], sessionId?: string | null }} read
 * @returns {Promise<string>}
 */
export async function logServiceRead(client, { actor, reason, tables, sessionId = null }) {
  const id = `read-${randomUUID()}`;
  await client.query(
    "insert into public.service_read_log (id, actor, reason, session_id, tables) values ($1, $2, $3, $4, $5::jsonb)",
    [id, actor, reason, sessionId, JSON.stringify([...new Set(tables)].sort())],
  );
  return id;
}
