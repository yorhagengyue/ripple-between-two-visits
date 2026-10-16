/**
 * npx tsx scripts/deploy/release.ts --commit <sha> [--branch c2-real] [--skip-public-check] --dry-run | --yes
 *
 * One release (C2 track P; docs/plan/hosting.md 5.10):
 *   1. checks on this computer: the commit exists and is pushed to origin/<branch> (default c2-real); no tracked file
 *      is modified; the migration files of the commit are the ones in this checkout; the production database has no
 *      pending migration (prod-db migrate --status, never more than --status);
 *   2. git archive of <commit>:web (tracked files only: no .env, no node_modules, no .next);
 *   3. upload through ssh's standard input;
 *   4. on the server (server/remote.mjs release): unpack as the service user, npm ci and next build as that user,
 *      point /srv/ripple/current at the new folder, restart, wait up to 60 s for /api/health to answer ok with the new
 *      build's id and with what push-env said the app must report; on any failure switch back to the version before,
 *      restart and say so; on success keep the newest five versions;
 *   5. /api/health through the public name must answer ok with the same build id (--skip-public-check for the very
 *      first release, before the EdgeOne rules exist); when it does not, the server is switched back as well.
 *
 * It refuses when a tracked file is modified, when the commit is not on origin/<branch>, when a migration is pending
 * (the owner applies migrations: prod-db migrate), and without --yes. It never applies a migration and never prints
 * an environment value.
 */
import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { webRoot } from "@/lib/llm/root";
import { DeployError, finish, guardMain, modeOf, Output, parseArgs, runPlan, startedAs, type Step } from "./lib/cli";
import { loadContext } from "./lib/deploy-file";
import { type Cmd, must, realRunner, remoteOp, remoteResult, type Runner, ssh, targetOf } from "./lib/exec";
import { dbCall, guardProduction } from "./prod-db";

export const DEFAULT_BRANCH = "c2-real";

/** "20261016T093000-d99d02f": sorts by time, names the commit. */
export function releaseId(commit: string, now: Date): string {
  return `${now.toISOString().slice(0, 19).replace(/[-:]/g, "")}-${commit.slice(0, 7)}`;
}

function git(webDir: string, args: string[]): Cmd {
  return { bin: "git", args, show: `git ${args.join(" ")}`, cwd: webDir, timeoutMs: 120_000 };
}

/** The migration files `migrate --status` reported as pending. */
export function pendingFrom(statusOutput: string): string[] {
  return statusOutput
    .split(/\r?\n/)
    .map((l) => /^\s*pending\s+(\S+\.sql)\s*$/.exec(l)?.[1])
    .filter((f): f is string => !!f);
}

export interface ReleaseDeps {
  run: Runner;
  fetchFn: typeof fetch;
  now: () => Date;
}

export async function main(argv: readonly string[], out: Output, deps: Partial<ReleaseDeps> = {}, webDir: string = webRoot()): Promise<number> {
  const run = deps.run ?? realRunner(out);
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? (() => new Date());
  return guardMain(out, async () => {
    const args = parseArgs(argv, { bool: ["skip-public-check", "accept-new-host-key"], value: ["commit", "branch", "host"] });
    if (args.bool("help")) {
      out.say("usage: npx tsx scripts/deploy/release.ts --commit <sha> [--branch c2-real] [--skip-public-check] --dry-run | --yes");
      return 0;
    }
    const mode = modeOf(args);
    const commitArg = args.value("commit");
    if (!commitArg || !/^[0-9a-f]{7,40}$/.test(commitArg)) throw new DeployError("--commit <sha> is required: 7 to 40 hexadecimal characters of the commit to release");
    const branch = args.value("branch") ?? DEFAULT_BRANCH;
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,80}$/.test(branch) || branch.includes("..")) throw new DeployError("--branch is not a branch name");
    const ctx = loadContext(args, webDir, out);
    const target = targetOf(ctx, { acceptNew: args.bool("accept-new-host-key"), host: args.value("host") });
    const guard = guardProduction(ctx);
    const publicUrl = `https://${ctx.deploy.values.DEPLOY_APP_DOMAIN}/api/health`;

    const id = releaseId(commitArg, now());
    const archive = path.join(os.tmpdir(), `ripple-release-${id}.tgz`);
    const remoteArchive = `/tmp/ripple-release-${id}.tgz`;
    const status = dbCall(ctx, "migrate", { status: true });
    const upload = ssh(target, `cat > ${remoteArchive}`, { stdinFile: archive, stdinShow: "the archive", timeoutMs: 20 * 60_000 });
    const remote = remoteOp(target, webDir, "release", [id, remoteArchive], { timeoutMs: 45 * 60_000 });

    let commit = commitArg;
    let prefix = "web";
    let outcome: { code: number; result: Record<string, unknown> | null } = { code: 0, result: null };

    const steps: Step[] = [
      {
        title: "this computer: the commit exists, no tracked file is modified, the commit is on origin/<branch>, its migration files are this checkout's",
        show: [
          `git rev-parse --verify ${commitArg}^{commit}`,
          "git status --porcelain --untracked-files=no      (must print nothing)",
          `git fetch --quiet origin ${branch}`,
          `git merge-base --is-ancestor ${commitArg} refs/remotes/origin/${branch}      (must succeed: the commit is pushed)`,
          `git diff --quiet ${commitArg} HEAD -- supabase/migrations      (must succeed: the pending check below reads this checkout's files)`,
        ],
        run: async () => {
          const resolved = await run(git(webDir, ["rev-parse", "--verify", `${commitArg}^{commit}`]));
          if (resolved.code !== 0 || !/^[0-9a-f]{40}$/.test(resolved.stdout.trim())) throw new DeployError("that commit is not in this repository");
          commit = resolved.stdout.trim();
          const dirty = await must(run, out, git(webDir, ["status", "--porcelain", "--untracked-files=no"]), "git status");
          if (dirty.stdout.trim()) throw new DeployError("tracked files are modified in this checkout: commit or put them away first (a release is made from a commit, and the checks read this checkout)");
          await must(run, out, git(webDir, ["fetch", "--quiet", "origin", branch]), `fetching origin/${branch}`);
          const pushed = await run(git(webDir, ["merge-base", "--is-ancestor", commit, `refs/remotes/origin/${branch}`]));
          if (pushed.code !== 0) throw new DeployError(`the commit is not on origin/${branch}: push it first (only pushed commits are released)`);
          const sameMigrations = await run(git(webDir, ["diff", "--quiet", commit, "HEAD", "--", "supabase/migrations"]));
          if (sameMigrations.code !== 0) throw new DeployError("the commit's migration files differ from this checkout's: check out the commit you release, so the pending-migration check reads the right files");
          const shown = await must(run, out, git(webDir, ["rev-parse", "--show-prefix"]), "git rev-parse");
          prefix = shown.stdout.trim().replace(/\/+$/, "") || ".";
          if (prefix !== "web" && prefix !== ".") throw new DeployError("run this from the app's web folder: the release packs the folder it is run in");
        },
      },
      {
        title: `production database (project ${guard.project}): no migration is pending (read only; the owner applies migrations with prod-db migrate)`,
        show: [status.cmd.show, "a pending migration stops the release here"],
        run: async () => {
          const res = await run({ ...status.cmd, echo: false });
          if (res.code !== 0) throw new DeployError(`could not read the production database's migration state (exit ${res.code}); nothing was released`, 1);
          const pending = pendingFrom(res.stdout);
          if (pending.length) throw new DeployError(`the production database has ${pending.length} pending migration(s): ${pending.join(", ")}. Releases never apply migrations: after the owner's nod and a backup, run prod-db migrate, then release again.`);
        },
      },
      {
        title: "this computer: pack the commit's web folder (tracked files only)",
        show: [`git archive --format=tar.gz -o <temp>/ripple-release-${id}.tgz ${commitArg}      (run inside web/: git packs that folder of the commit, paths relative to it)`],
        // the commit alone, never `<commit>:web`: run inside web/, git looks for web/ INSIDE that tree, packs nothing and
        // exits 0 (the first real release, 2026-10-11, sent an empty archive that way)
        run: async () => void (await must(run, out, git(webDir, ["archive", "--format=tar.gz", "-o", archive, commit]), "git archive")),
      },
      { title: "server: upload the archive", show: [upload.show], run: async () => void (await must(run, out, upload, "the upload")) },
      {
        title: `server: release ${id}: unpack, npm ci and next build as the service user, switch, restart, health check; switch back by itself on failure; keep five versions`,
        show: [
          remote.show,
          "as user ripple, in /srv/ripple/releases/<name>: npm ci (no NODE_ENV, so the build's dev dependencies are installed), then next build",
          "then: /srv/ripple/current → the new folder; systemctl restart ripple-web; wait up to 60 s for http://127.0.0.1:3200/api/health: ok, the new build's id, and the provider names push-env staged",
          "on failure: /srv/ripple/current → the version before, restart, the new folder removed; exit code 3",
          "on success: the newest five version folders stay, older ones are removed, never the one in use",
          "undo: rollback",
        ],
        run: async () => {
          const res = await run(remote);
          outcome = { code: res.code, result: remoteResult(res.stdout) };
          rmSync(archive, { force: true });
        },
      },
    ];
    if (!args.bool("skip-public-check")) {
      steps.push({
        title: "the public name: /api/health answers ok with the new build's id; if not, the server is switched back",
        show: ["GET https://<DEPLOY_APP_DOMAIN>/api/health", "(--skip-public-check leaves this out: the very first release, before the EdgeOne rules exist)"],
        run: async () => {
          if (outcome.code !== 0) return;
          const build = String(outcome.result?.build ?? "");
          let problem = "";
          try {
            const res = await fetchFn(publicUrl, { signal: AbortSignal.timeout(20_000), headers: { "Cache-Control": "no-cache" } });
            const body = (await res.json().catch(() => null)) as { ok?: unknown; build?: unknown } | null;
            if (res.status !== 200 || body?.ok !== true) problem = `HTTP ${res.status}, ok is not true`;
            else if (build && body.build !== build) problem = "it answers with another build's id (a cached answer, or another server)";
          } catch {
            problem = "no answer";
          }
          if (!problem) return;
          const previous = String(outcome.result?.previous ?? "");
          if (previous) await run(remoteOp(target, webDir, "rollback", [previous], { timeoutMs: 5 * 60_000 }));
          throw new DeployError(`the public name did not pass its health check (${problem}); ${previous ? "the server was switched back to the version before" : "there is no version before to switch back to: the new one keeps running on the server"}. If the EdgeOne rules are not set up yet, release with --skip-public-check and run edge-check afterwards.`, 3);
        },
      });
    }

    const planned = await runPlan(out, mode, `release ${commitArg} (branch ${branch})`, steps);
    if (mode !== "act") return planned;
    const result = outcome.result ?? {};
    if (outcome.code === 3) throw new DeployError(`the new version did not pass its health check; the server switched back by itself to ${String(result.current ?? "the version before")}`, 3);
    if (outcome.code !== 0) throw new DeployError(`the release did not complete (exit ${outcome.code}${result.status ? `, ${String(result.status)}` : ""}); see the lines above and run status`, outcome.code === 255 ? 1 : outcome.code);
    out.say(`release: ${id} is running. commit ${commit}; build ${String(result.build)}; built in ${String(result.build_seconds)} s; peak memory during the build ${String(result.peak_ram_mb)} MB (swap ${String(result.peak_swap_mb)} MB); health ok${args.bool("skip-public-check") ? " on the server (the public name was not checked)" : " on the server and through the public name"}.`);
    return 0;
  });
}

if (startedAs("release")) {
  void main(process.argv.slice(2), new Output()).then(finish);
}
