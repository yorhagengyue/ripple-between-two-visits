/**
 * npx tsx scripts/deploy/push-secrets.ts [--only edge|backup] --dry-run | --yes
 * npx tsx scripts/deploy/push-secrets.ts --restore-prev [--only edge|backup] --dry-run | --yes
 *
 * Writes on the server, each keeping the one before as .prev (C2 track P; docs/plan/hosting.md 5.5, 5.7):
 *   edge     /etc/caddy/edge.env        0600 root   EDGE_SECRET: the origin lock Caddy checks on every request.
 *                                                   Caddy is restarted and must be running afterwards; if it is not,
 *                                                   the previous file is put back.
 *   backup   /etc/ripple/backup.env     0600 root   the production connection string and the COS settings
 *            /etc/ripple/backup.age.pub 0644 root   the backup's public key (not a secret)
 *
 * Without --only it does both, with one exception: while NONE of the backup settings is in the deploy file, the backup
 * part is reported as not configured and skipped (the bucket and the key pair are the owner's to make). Some but not
 * all of them is a mistake and stops the script.
 *
 * It refuses when EDGE_SECRET is shorter than 32 characters or has characters a header cannot carry, when
 * BACKUP_AGE_RECIPIENT is not an age public key, when the connection string is the test database's, when a COS setting
 * or the heartbeat address is missing or the address is not https, and without --yes.
 *
 * Changing EDGE_SECRET: change the value in the EdgeOne rule first, then run this at once; between the two every
 * request is answered 403, so pick a quiet moment.
 */
import { webRoot } from "@/lib/llm/root";
import { formatEnvFile } from "./lib/app-env";
import { DeployError, finish, guardMain, modeOf, Output, parseArgs, runPlan, startedAs, type Step } from "./lib/cli";
import { BACKUP_ENV_NAMES, BACKUP_NAMES, BACKUP_RECIPIENT, type DeployContext, ensureSecrets, loadContext, OWNER_ONLY, refuseTestDatabase, requireNames } from "./lib/deploy-file";
import { must, putRootFile, realRunner, remoteOp, remoteResult, type Runner, targetOf } from "./lib/exec";

export type Part = "edge" | "backup";

const BACKUP_ALL = ["SUPABASE_DB_URL", ...BACKUP_NAMES];

/** configured: every backup setting is there; none: not one of the owner's six is; partial: a mistake. */
export function backupState(ctx: DeployContext): { state: "configured" | "none" | "partial"; missing: string[] } {
  const v = ctx.deploy.values;
  const missing = BACKUP_NAMES.filter((n) => !v[n]);
  if (missing.length === BACKUP_NAMES.length) return { state: "none", missing: [...missing] };
  const all = BACKUP_ALL.filter((n) => !v[n]);
  return { state: all.length ? "partial" : "configured", missing: all };
}

/** Which parts this run handles, and the note about a part that is skipped. */
export function partsFor(ctx: DeployContext, only: string | undefined): { parts: Part[]; skipped: string | null } {
  if (only !== undefined && only !== "edge" && only !== "backup") throw new DeployError("--only is edge or backup");
  const backup = backupState(ctx);
  if (only === "edge") return { parts: ["edge"], skipped: null };
  if (backup.state === "partial") {
    throw new DeployError(`the backup settings are incomplete; nothing was sent. Missing:\n${backup.missing.map((n) => `  - ${n}${OWNER_ONLY[n] ? ` (${OWNER_ONLY[n]})` : ""}`).join("\n")}`);
  }
  if (backup.state === "none") {
    if (only === "backup") throw new DeployError(`backup: not configured. The owner supplies: ${backup.missing.join(", ")} (scripts/deploy/README.md, "Backups")`);
    return { parts: ["edge"], skipped: `backup: not configured, nothing pushed for it (the owner supplies ${backup.missing.join(", ")})` };
  }
  return { parts: only === "backup" ? ["backup"] : ["edge", "backup"], skipped: null };
}

export async function main(argv: readonly string[], out: Output, run: Runner = realRunner(out), webDir: string = webRoot()): Promise<number> {
  return guardMain(out, async () => {
    const args = parseArgs(argv, { bool: ["restore-prev", "accept-new-host-key"], value: ["only", "host"] });
    if (args.bool("help")) {
      out.say("usage: npx tsx scripts/deploy/push-secrets.ts [--only edge|backup] [--restore-prev] --dry-run | --yes");
      return 0;
    }
    const mode = modeOf(args);
    const ctx = loadContext(args, webDir, out);
    const target = targetOf(ctx, { acceptNew: args.bool("accept-new-host-key"), host: args.value("host") });
    const only = args.value("only");

    if (args.bool("restore-prev")) {
      if (only !== undefined && only !== "edge" && only !== "backup") throw new DeployError("--only is edge or backup");
      const parts: Part[] = only ? [only] : ["edge", "backup"];
      const cmd = remoteOp(target, webDir, "secrets-restore", parts);
      let code = 0;
      const steps: Step[] = [
        {
          title: `server: swap ${parts.map((p) => (p === "edge" ? "edge.env" : "backup.env and backup.age.pub")).join(", ")} with the .prev copies${parts.includes("edge") ? "; restart Caddy" : ""}`,
          show: [cmd.show, "undo: run --restore-prev again"],
          run: async () => {
            code = (await run(cmd)).code;
          },
        },
      ];
      const planned = await runPlan(out, mode, "push-secrets --restore-prev", steps);
      if (mode !== "act") return planned;
      if (code !== 0) throw new DeployError(`the restore did not end well (exit ${code}); see the lines above`, code === 255 ? 1 : code);
      out.say("push-secrets --restore-prev: done.");
      return 0;
    }

    const { parts, skipped } = partsFor(ctx, only);
    const steps: Step[] = [];
    if (parts.includes("edge")) {
      const made = ensureSecrets(ctx, ["EDGE_SECRET"], mode === "act", out);
      if (made.length) out.say(mode === "act" ? "Created in the deploy file (value not shown): EDGE_SECRET. The owner pastes the same value into the EdgeOne rule (README)." : "A run with --yes would first create in the deploy file: EDGE_SECRET.");
      if (!made.length || mode === "act") requireNames(ctx, ["EDGE_SECRET"], "the origin lock");
      const put = putRootFile(target, "/etc/caddy/edge.env.new", "0600", formatEnvFile({ EDGE_SECRET: ctx.deploy.values.EDGE_SECRET ?? "" }, "written by scripts/deploy/push-secrets.ts; the same value is in the EdgeOne rule and in web.env"), "EDGE_SECRET=<EDGE_SECRET>");
      steps.push({ title: "server: stage the origin lock for Caddy, 0600 root", show: [put.show], run: async () => void (await must(run, out, put, "staging edge.env (has provision run? /etc/caddy must exist)")) });
    }
    if (parts.includes("backup")) {
      requireNames(ctx, BACKUP_ALL, "the backup");
      refuseTestDatabase(ctx);
      const v = ctx.deploy.values;
      const env = Object.fromEntries(["SUPABASE_DB_URL", ...BACKUP_ENV_NAMES].map((n) => [n, v[n]]));
      const putEnv = putRootFile(target, "/etc/ripple/backup.env.new", "0600", formatEnvFile(env, "written by scripts/deploy/push-secrets.ts; read by the backup services only"), `${Object.keys(env).join(", ")} (values not shown)`);
      const putPub = putRootFile(target, "/etc/ripple/backup.age.pub.new", "0644", `${v[BACKUP_RECIPIENT]}\n`, "the age public key <BACKUP_AGE_RECIPIENT>");
      steps.push(
        { title: "server: stage the backup settings, 0600 root", show: [putEnv.show], run: async () => void (await must(run, out, putEnv, "staging backup.env")) },
        { title: "server: stage the backup's public key, 0644 root", show: [putPub.show], run: async () => void (await must(run, out, putPub, "staging backup.age.pub")) },
      );
    }
    const apply = remoteOp(target, webDir, "secrets-apply", parts);
    let applied = { code: 0, status: "" };
    steps.push({
      title: `server: put ${parts.map((p) => (p === "edge" ? "edge.env" : "backup.env and backup.age.pub")).join(", ")} in place (each one before becomes .prev)${parts.includes("edge") ? "; restart Caddy and check it is running, else put the previous edge.env back" : ""}`,
      show: [apply.show, "undo: push-secrets --restore-prev"],
      run: async () => {
        const res = await run(apply);
        applied = { code: res.code, status: String(remoteResult(res.stdout)?.status ?? "") };
      },
    });
    if (skipped) out.say(skipped);
    const planned = await runPlan(out, mode, `push-secrets (${parts.join(", ")})`, steps);
    if (mode !== "act") return planned;
    if (applied.code === 3) throw new DeployError("Caddy did not come up with the new origin lock; the previous edge.env is back in place", 3);
    if (applied.code !== 0) throw new DeployError(`the secrets were not applied cleanly (exit ${applied.code}${applied.status ? `, ${applied.status}` : ""}); see the lines above`, applied.code === 255 ? 1 : applied.code);
    out.say(`push-secrets: done (${parts.join(", ")}).${skipped ? ` ${skipped}.` : ""}`);
    return 0;
  });
}

if (startedAs("push-secrets")) {
  void main(process.argv.slice(2), new Output()).then(finish);
}
