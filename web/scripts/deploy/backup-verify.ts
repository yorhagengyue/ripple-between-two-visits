/**
 * npx tsx scripts/deploy/backup-verify.ts --file <downloaded .dump.age or .tar.age> --identity <age key file> [--restore] [--dry-run]
 *
 * The restore drill, on the owner's computer only: the private key never leaves it (C2 track P;
 * docs/plan/hosting.md 5.14 item 4, real-app.md 3.12). Monthly, and before every production migration.
 *
 *   1. the private key in --identity must be the pair of the deploy file's BACKUP_AGE_RECIPIENT (age-keygen -y);
 *   2. decrypt the file into a private temporary folder;
 *   3. a database backup (.dump.age): pg_restore --list must read it; the tables with data are listed by name;
 *      a files backup (.tar.age): the archive is listed and its entries counted;
 *   4. with --restore (database backups): create a database ripple_verify_<time> on THIS computer's PostgreSQL,
 *      restore into it without owners and privileges, print every table's row count, check that every account-owned
 *      space points at an existing account (public.session.owner_user_id → auth.users), then drop that database;
 *   5. remove the temporary folder, whatever happened.
 *
 * It prints table names and row counts only, never a row. It restores only into a PostgreSQL on this computer
 * (--pg-host must be 127.0.0.1, localhost or ::1): never into the production or the test database, and the connection
 * strings of the deploy file and of web/.env are never handed to any tool here. The password of the local PostgreSQL,
 * when it needs one, comes from the PGPASSWORD already in the owner's shell.
 *
 * Not configured (the deploy file has no BACKUP_AGE_RECIPIENT): it says so and ends well; there is nothing to verify.
 * Needs on this computer: age (with age-keygen) and PostgreSQL's client tools of the server's major version or newer.
 *
 * What this drill does not prove: that a restored account can sign in with its password. That needs the sign-in
 * service on top of the restored auth schema, i.e. a restore into a scratch Supabase project.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { webRoot } from "@/lib/llm/root";
import { DeployError, finish, guardMain, Output, parseArgs, printPlan, startedAs, type Step } from "./lib/cli";
import { expandHome, loadContext, shapeProblem } from "./lib/deploy-file";
import { type Cmd, must, realRunner, type Runner } from "./lib/exec";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/** The tables a dump holds data for, "schema.table", from pg_restore --list. */
export function tablesIn(list: string): string[] {
  return [...list.matchAll(/^\d+; \d+ \d+ TABLE DATA (\S+) (\S+) /gm)].map((m) => `${m[1]}.${m[2]}`).sort();
}

/** Environment for the PostgreSQL tools: this computer's server only, nothing inherited that could name another one. */
export function localPgEnv(base: Record<string, string | undefined>, host: string, port: string, user: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...base };
  for (const name of Object.keys(env)) if (/^(PG(HOST|HOSTADDR|PORT|USER|DATABASE|SERVICE|SERVICEFILE|OPTIONS)|DATABASE_URL|SUPABASE_.*)$/i.test(name)) delete env[name];
  return { ...env, PGHOST: host, PGPORT: port, PGUSER: user, PGCONNECT_TIMEOUT: "10", PGAPPNAME: "ripple-backup-verify" };
}

const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

export async function main(argv: readonly string[], out: Output, run: Runner = realRunner(out), webDir: string = webRoot(), now: () => Date = () => new Date()): Promise<number> {
  return guardMain(out, async () => {
    const args = parseArgs(argv, { bool: ["restore"], value: ["file", "identity", "pg-host", "pg-port", "pg-user"] });
    if (args.bool("help")) {
      out.say("usage: npx tsx scripts/deploy/backup-verify.ts --file <.dump.age|.tar.age> --identity <age key file> [--restore [--pg-host 127.0.0.1] [--pg-port 5432] [--pg-user postgres]] [--dry-run]");
      return 0;
    }
    const ctx = loadContext(args, webDir, out);
    const recipient = ctx.deploy.values.BACKUP_AGE_RECIPIENT;
    if (!recipient) {
      out.say("backup-verify: not configured (the deploy file has no BACKUP_AGE_RECIPIENT, so no backup can have been made yet). Nothing to verify.");
      return 0;
    }
    const bad = shapeProblem("BACKUP_AGE_RECIPIENT", recipient, ctx.deploy.values);
    if (bad) throw new DeployError(`BACKUP_AGE_RECIPIENT ${bad}`);

    const file = args.value("file");
    const identity = args.value("identity");
    if (!file || !identity) throw new DeployError("--file <the downloaded backup> and --identity <the age private key file> are both needed");
    const filePath = path.resolve(expandHome(file));
    const identityPath = path.resolve(expandHome(identity));
    const kind = /\.dump\.age$/.test(filePath) ? "db" : /\.tar\.age$/.test(filePath) ? "blob" : null;
    if (!kind) throw new DeployError("--file must be a backup as the server names it: <date>T<time>.dump.age or <date>T<time>.tar.age");
    const restore = args.bool("restore");
    if (restore && kind !== "db") throw new DeployError("--restore is for a database backup (.dump.age)");
    const host = args.value("pg-host") ?? "127.0.0.1";
    const port = args.value("pg-port") ?? "5432";
    const user = args.value("pg-user") ?? "postgres";
    if (!LOCAL_HOSTS.has(host.toLowerCase())) throw new DeployError("--pg-host must be 127.0.0.1, localhost or ::1: a backup is only ever restored into a PostgreSQL on this computer, never into the production or the test database");
    if (!/^\d{1,5}$/.test(port) || !/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(user)) throw new DeployError("--pg-port is a port number and --pg-user a role name");

    const stamp = now().toISOString().slice(0, 19).replace(/[-:T]/g, "");
    const database = `ripple_verify_${stamp}`;
    const pg = localPgEnv(process.env, host, port, user);
    const tool = (bin: string, a: string[], show: string, env?: Record<string, string | undefined>): Cmd => ({ bin, args: a, show, env, timeoutMs: 60 * 60_000 });

    const steps: Step[] = [
      { title: "this computer: the private key is the pair of BACKUP_AGE_RECIPIENT", show: ["age-keygen -y <identity>      (prints the public key; compared with <BACKUP_AGE_RECIPIENT>)"] },
      { title: "this computer: decrypt into a private temporary folder", show: ["age -d -i <identity> -o <temp>/backup <file>"] },
      kind === "db" ? { title: "this computer: read the dump's table of contents", show: ["pg_restore --list <temp>/backup", "prints the names of the tables that have data"] } : { title: "this computer: list the archive", show: ["tar -tf <temp>/backup", "prints the number of entries, no names"] },
    ];
    if (restore) {
      steps.push({
        title: `this computer's PostgreSQL (${host}:${port}): create ${database}, restore into it, count the rows of every table, check accounts, drop it`,
        show: [
          `createdb ${database}`,
          `pg_restore --no-owner --no-privileges --dbname=${database} <temp>/backup`,
          "psql: count(*) of every table in public and auth (names and numbers only)",
          "psql: account spaces whose owner is missing from auth.users (must be 0)",
          `dropdb ${database}`,
        ],
      });
    }
    steps.push({ title: "this computer: remove the temporary folder (the plain backup is real people's data)", show: ["always, also when a step above failed"] });
    printPlan(out, `backup-verify (${kind === "db" ? "database backup" : "files backup"}${restore ? ", with a restore drill" : ""})`, steps);
    if (args.bool("dry-run")) {
      out.say("Dry run: nothing was touched.");
      return 0;
    }

    if (!existsSync(filePath)) throw new DeployError("--file does not exist");
    if (!existsSync(identityPath)) throw new DeployError("--identity does not exist");
    const pub = await run(tool("age-keygen", ["-y", identityPath], "age-keygen -y <identity>"));
    if (pub.code === 127) throw new DeployError("age is not installed on this computer (age and age-keygen are needed)");
    if (pub.code !== 0 || pub.stdout.trim() !== recipient) throw new DeployError("this private key is not the pair of BACKUP_AGE_RECIPIENT: the server encrypts for another key");

    const work = mkdtempSync(path.join(os.tmpdir(), "ripple-verify-"));
    const plain = path.join(work, "backup");
    let created = false;
    try {
      await must(run, out, tool("age", ["-d", "-i", identityPath, "-o", plain, filePath], "age -d -i <identity> -o <temp>/backup <file>"), "decrypting");
      if (kind === "blob") {
        const listed = await must(run, out, tool("tar", ["-tf", plain], "tar -tf <temp>/backup"), "listing the archive");
        out.say(`the archive reads: ${listed.stdout.split(/\r?\n/).filter((l) => l && !l.endsWith("/")).length} files`);
        return 0;
      }
      const list = await run(tool("pg_restore", ["--list", plain], "pg_restore --list <temp>/backup"));
      if (list.code === 127) throw new DeployError("PostgreSQL's client tools are not installed on this computer (pg_restore; for --restore also psql, createdb, dropdb)");
      if (list.code !== 0) throw new DeployError("pg_restore --list cannot read the decrypted dump: this backup is not usable (an older pg_restore than the server's pg_dump cannot read it either)", 1);
      const tables = tablesIn(list.stdout);
      out.say(`the dump reads: ${tables.length} tables with data: ${tables.join(", ")}`);
      if (!tables.includes("auth.users")) throw new DeployError("the dump has no auth.users: the accounts are not in this backup", 1);
      if (!restore) return 0;

      await must(run, out, tool("createdb", [database], `createdb ${database}`, pg), "creating the scratch database (is PostgreSQL running on this computer, is PGPASSWORD set if it needs one?)");
      created = true;
      const restored = await run(tool("pg_restore", ["--no-owner", "--no-privileges", `--dbname=${database}`, plain], `pg_restore --no-owner --no-privileges --dbname=${database} <temp>/backup`, pg));
      if (restored.code !== 0) out.say(`pg_restore reported problems (exit ${restored.code}); on a plain PostgreSQL that is expected for roles and extensions Supabase has and this computer does not. The counts below say what arrived.`);
      const sql = (q: string) => tool("psql", ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", database, "-c", q], "psql -d <scratch> -c <count>", pg);
      const names = await must(run, out, sql("select schemaname || '.' || tablename from pg_tables where schemaname in ('public','auth') order by 1"), "listing the restored tables");
      const restoredTables = names.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[a-z_]+\.[A-Za-z0-9_]+$/.test(l));
      out.say(`restored ${restoredTables.length} tables; rows per table:`);
      for (const t of restoredTables) {
        const [schema, table] = t.split(".");
        const n = await run(sql(`select count(*) from ${quoteIdent(schema)}.${quoteIdent(table)}`));
        out.say(`  ${t.padEnd(34)} ${n.code === 0 ? n.stdout.trim() : "could not be counted"}`);
      }
      const missingData = tables.filter((t) => !restoredTables.includes(t));
      if (missingData.length) throw new DeployError(`these tables have data in the dump and did not arrive: ${missingData.join(", ")}`, 1);
      const orphans = await run(sql("select count(*) from public.session s where s.owner_user_id is not null and not exists (select 1 from auth.users u where u.id = s.owner_user_id)"));
      if (orphans.code !== 0) throw new DeployError("could not check that every account space has its account (public.session.owner_user_id against auth.users)", 1);
      if (orphans.stdout.trim() !== "0") throw new DeployError(`${orphans.stdout.trim()} account space(s) point at an account that is not in the restored auth.users`, 1);
      out.say("every account space points at an account that was restored (public.session.owner_user_id → auth.users): ok");
      out.say("backup-verify: the backup restores. Not proven here: signing in with a restored password (that needs the sign-in service; restore into a scratch Supabase project for that).");
      return 0;
    } finally {
      if (created) {
        const dropped = await run(tool("dropdb", ["--if-exists", database], `dropdb --if-exists ${database}`, pg));
        if (dropped.code !== 0) out.say(`COULD NOT DROP the scratch database ${database}: drop it by hand, it holds real people's data.`);
      }
      rmSync(work, { recursive: true, force: true });
      out.say("the temporary folder with the plain backup is removed.");
    }
  });
}

if (startedAs("backup-verify")) {
  void main(process.argv.slice(2), new Output()).then(finish);
}
