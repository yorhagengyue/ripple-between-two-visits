/**
 * npx tsx scripts/deploy/prod-db.ts <migrate|inspect|setup-storage|privileges|preflight> [options] --dry-run | --yes
 *
 * Runs the existing database scripts against the PRODUCTION project, and only that one (C2 track P;
 * docs/plan/hosting.md 5.4, 5.11, 5.12 item 6):
 *
 *   migrate [--status]             node scripts/db/migrate.mjs            apply web/supabase/migrations (or list them)
 *   inspect [--rls | --counts] [--actor <who> --reason "<why>"]
 *                                  node scripts/db/inspect.mjs            RLS listing; row counts need who and why
 *   setup-storage                  tsx scripts/setup-storage.ts           the two private buckets
 *   privileges                     node scripts/db/check-privileges.mjs   anon / authenticated get nothing
 *   preflight [--url https://<DEPLOY_APP_DOMAIN>]
 *                                  tsx scripts/preflight.ts --url ...     the deployed app and its database
 *
 * How the existing scripts end up on production: they read web/.env with process.loadEnvFile, which never replaces a
 * variable that is already set. This script puts the deploy file's four database variables into the child's
 * environment, so web/.env's test values for the same names are not used.
 *
 * It refuses, before starting any child:
 *   - when one of SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, SUPABASE_DB_URL is missing from the deploy
 *     file (an empty one would silently fall back to the test project) or malformed;
 *   - when the address, the connection string or the key equals web/.env's, or names the same project;
 *   - when the connection string names another project than SUPABASE_URL;
 *   - when --url is not https://<DEPLOY_APP_DOMAIN>;
 *   - without --yes (--dry-run prints the plan). Every subcommand needs --yes: even "migrate --status" creates the
 *     bookkeeping table on a database that has never been migrated.
 * It prints the first 8 characters of sha256(project reference), never the reference, a host or a key; the child's
 * output is printed through the same hiding.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { webRoot } from "@/lib/llm/root";
import { DeployError, finish, guardMain, modeOf, Output, parseArgs, runPlan, startedAs, type Step } from "./lib/cli";
import { DB_FOUR, type DeployContext, loadContext, projectRefOfUrl, refuseTestDatabase, requireNames, sha8 } from "./lib/deploy-file";
import { type Cmd, realRunner, type Runner } from "./lib/exec";

export const SUBCOMMANDS = ["migrate", "inspect", "setup-storage", "privileges", "preflight"] as const;
export type Subcommand = (typeof SUBCOMMANDS)[number];

/** The child's environment: this process's, with the production project's four variables on top. */
export function childEnv(ctx: DeployContext, base: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...base };
  for (const name of DB_FOUR) env[name] = ctx.deploy.values[name];
  // a preview link from the shell or web/.env must not send the preflight somewhere else
  delete env.PREVIEW_URL;
  return env;
}

/** Everything that must hold before a child may be started. Returns the project's printed name (sha256, first 8). */
export function guardProduction(ctx: DeployContext): { project: string; note: string | null } {
  requireNames(ctx, DB_FOUR, "working on the production database");
  const note = refuseTestDatabase(ctx);
  return { project: sha8(projectRefOfUrl(ctx.deploy.values.SUPABASE_URL) ?? ""), note };
}

export function pendingMigrationFiles(webDir: string): string[] {
  return readdirSync(path.join(webDir, "supabase", "migrations"))
    .filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f))
    .sort();
}

export interface DbCall {
  sub: Subcommand;
  cmd: Cmd;
  changes: string;
}

/** The one child process a subcommand starts. */
export function dbCall(ctx: DeployContext, sub: Subcommand, opts: { status?: boolean; rls?: boolean; counts?: boolean; actor?: string; reason?: string; url?: string }): DbCall {
  const node = process.execPath;
  const tsx = path.join(ctx.webDir, "node_modules", "tsx", "dist", "cli.mjs");
  const env = childEnv(ctx);
  const cmd = (args: string[], show: string): Cmd => ({ bin: node, args, show: `${show}   (with the deploy file's ${DB_FOUR.join(", ")})`, cwd: ctx.webDir, env, echo: true, timeoutMs: 15 * 60_000 });
  switch (sub) {
    case "migrate":
      return opts.status
        ? { sub, cmd: cmd(["scripts/db/migrate.mjs", "--status"], "node scripts/db/migrate.mjs --status"), changes: "lists applied and pending migrations; on a database never migrated it creates the empty bookkeeping table public.schema_migrations" }
        : { sub, cmd: cmd(["scripts/db/migrate.mjs"], "node scripts/db/migrate.mjs"), changes: "applies every pending migration, each in its own transaction; there is no way back but a restore" };
    case "inspect": {
      if (opts.rls && opts.counts) throw new DeployError("inspect takes --rls or --counts, not both (neither: both listings)");
      const wantsCounts = !opts.rls;
      if (opts.counts && (!opts.actor || !opts.reason)) throw new DeployError('inspect --counts reads the data tables: it needs --actor <who> and --reason "<why, in a sentence>" (one row is written to service_read_log first)');
      const args = ["scripts/db/inspect.mjs", ...(opts.rls ? ["--rls"] : []), ...(opts.counts ? ["--counts"] : [])];
      if (wantsCounts && opts.actor && opts.reason) args.push("--actor", opts.actor, "--reason", opts.reason);
      const counting = wantsCounts && !!opts.actor && !!opts.reason;
      return {
        sub,
        cmd: cmd(args, `node scripts/db/inspect.mjs${opts.rls ? " --rls" : ""}${opts.counts ? " --counts" : ""}${counting ? " --actor <who> --reason <why>" : ""}`),
        changes: counting ? "reads the catalog and counts rows; writes one row to service_read_log (who, why, which tables)" : "reads the catalog only (row level security, policies, privileges); changes nothing",
      };
    }
    case "setup-storage":
      return { sub, cmd: cmd([tsx, "scripts/setup-storage.ts"], "tsx scripts/setup-storage.ts"), changes: "creates the private buckets audio and labels, or sets an existing one to the same settings" };
    case "privileges":
      return { sub, cmd: cmd(["scripts/db/check-privileges.mjs"], "node scripts/db/check-privileges.mjs"), changes: "reads the catalog only; changes nothing" };
    case "preflight": {
      const want = `https://${ctx.deploy.values.DEPLOY_APP_DOMAIN ?? ""}`;
      requireNames(ctx, ["DEPLOY_APP_DOMAIN"], "the preflight");
      if (opts.url !== undefined && opts.url.replace(/\/+$/, "").toLowerCase() !== want) throw new DeployError("--url is not https://<DEPLOY_APP_DOMAIN> of the deploy file: the preflight only ever runs against the deployment that file names");
      return {
        sub,
        cmd: cmd([tsx, "scripts/preflight.ts", "--url", want], "tsx scripts/preflight.ts --url https://<DEPLOY_APP_DOMAIN>"),
        changes: "on the deployment: one sandbox session (it expires after 48 h) and a 4 MB upload that is not kept; in the database: a throwaway session and one small file, both removed again. Its two model lines describe THIS computer's settings, not the deployment's (those are in /api/health)",
      };
    }
  }
}

export async function main(argv: readonly string[], out: Output, run: Runner = realRunner(out), webDir: string = webRoot()): Promise<number> {
  return guardMain(out, async () => {
    const args = parseArgs(argv, { bool: ["status", "rls", "counts"], value: ["actor", "reason", "url"] });
    const sub = args.positional[0] as Subcommand | undefined;
    if (args.bool("help") || !sub) {
      out.say(`usage: npx tsx scripts/deploy/prod-db.ts <${SUBCOMMANDS.join("|")}> [--status] [--rls|--counts --actor <who> --reason "<why>"] [--url <link>] --dry-run | --yes`);
      return args.bool("help") ? 0 : 2;
    }
    if (!SUBCOMMANDS.includes(sub) || args.positional.length > 1) throw new DeployError(`unknown subcommand; one of: ${SUBCOMMANDS.join(", ")}`);
    const ctx = loadContext(args, webDir, out);
    const guard = guardProduction(ctx);
    const call = dbCall(ctx, sub, { status: args.bool("status"), rls: args.bool("rls"), counts: args.bool("counts"), actor: args.value("actor"), reason: args.value("reason"), url: args.value("url") });

    let code = 0;
    const show = [call.cmd.show, `changes: ${call.changes}`];
    if (sub === "migrate") show.push(`migration files in this checkout (${pendingMigrationFiles(webDir).length}): ${pendingMigrationFiles(webDir).join(", ")}`);
    const steps: Step[] = [
      {
        title: `production database (project ${guard.project}): ${sub}`,
        show,
        run: async () => {
          const res = await run(call.cmd);
          code = res.code;
        },
      },
    ];
    out.say(`Production project (sha256 of its reference, first 8): ${guard.project}. ${guard.note ? `NOTE: ${guard.note}` : "It is not the test project of web/.env."}`);
    const planned = await runPlan(out, modeOf(args), `prod-db ${sub}`, steps);
    if (planned !== 0 || modeOf(args) !== "act") return planned;
    out.say(code === 0 ? `prod-db ${sub}: done.` : `prod-db ${sub}: the script ended with exit code ${code}.`);
    return code;
  });
}

if (startedAs("prod-db")) {
  void main(process.argv.slice(2), new Output()).then(finish);
}
