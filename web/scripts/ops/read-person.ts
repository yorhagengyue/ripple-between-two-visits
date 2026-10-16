/**
 * An operator's read of one person's records, with a reason (docs/plan/real-app.md 3.11 日志和审计: 「运维排障：脚本必须带一句
 * 理由，按人写 service_read_log，没有理由就拒绝运行」; C2 track H). The only script that reads a person's data with the
 * server's key; the read itself is lib/privacy/service-read.ts readPerson.
 *
 *   cd web && npx tsx scripts/ops/read-person.ts --actor <who> --reason "<why, in a sentence>" (--login <username> | --user <user id>)
 *                                                [--tables visits,dose_log,...] [--rows]
 *
 *   --actor    who is reading (your name or handle)
 *   --reason   why, in a sentence; written to service_read_log with the actor, the person's scope and the table names
 *   --login    the person's username as they sign in with it; or --user with their user id
 *   --tables   which tables (default: every table of his space); the names are listed when one is unknown
 *   --rows     print the rows as JSON too (default: only how many rows each table has)
 *
 * Without --actor or without a reason it stops before anything is read (exit code 2). One service_read_log row is
 * written per run, before the read; if it cannot be written nothing is read. The person sees these rows in their
 * export. Reads web/.env (STORE, SUPABASE_URL, SUPABASE_SERVICE_KEY); values already in the environment win, so
 * scripts/deploy/prod-db.mjs can point it at the production database. Never prints a key or a URL.
 * Takes its arguments from the command line only: it never asks a question and never waits for input.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { getStore } from "../../lib/store";
import { PERSON_TABLES, ServiceReadRefused, readPerson, type ReadPersonRequest } from "../../lib/privacy/service-read";

const WEB = path.resolve(__dirname, "..", "..");

/** --name value or --name=value; flags without a value are true. */
export function parseArgs(argv: readonly string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}

export function requestFrom(args: Record<string, string | true>): ReadPersonRequest {
  const text = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "");
  return {
    actor: text("actor"),
    reason: text("reason"),
    login: text("login") || undefined,
    userId: text("user") || undefined,
    tables: text("tables") ? text("tables").split(",").map((t) => t.trim()).filter(Boolean) : undefined,
    rows: args.rows === true,
  };
}

async function main(): Promise<number> {
  const envFile = path.join(WEB, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const args = parseArgs(process.argv.slice(2));
  if (args.help === true) {
    console.log(`usage: npx tsx scripts/ops/read-person.ts --actor <who> --reason "<why>" (--login <username> | --user <id>) [--tables a,b] [--rows]`);
    console.log(`tables: ${Object.keys(PERSON_TABLES).join(", ")}`);
    return 0;
  }
  try {
    const result = await readPerson(getStore(), requestFrom(args));
    console.log(`service_read_log: ${result.logId}`);
    for (const t of result.tables) console.log(`  ${t.padEnd(22)} ${result.counts[t]}`);
    if (result.rows) console.log(JSON.stringify(result.rows, null, 2));
    return 0;
  } catch (err) {
    if (err instanceof ServiceReadRefused) {
      console.error(err.message);
      return 2;
    }
    // a store error's message names the operation and a status, never a key or a URL
    console.error(`read-person: ${err instanceof Error ? err.message.slice(0, 200) : "failed"}`);
    return 1;
  }
}

// run directly (npx tsx scripts/ops/read-person.ts ...), not when a test imports the pure parts
if (/[\\/]scripts[\\/]ops[\\/]read-person\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) void main().then((code) => process.exit(code));
