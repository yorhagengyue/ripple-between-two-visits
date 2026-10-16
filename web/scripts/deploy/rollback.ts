/**
 * npx tsx scripts/deploy/rollback.ts [--to <release name>] --dry-run | --yes
 *
 * Switches the server back to the version before the one running (or to the named one), restarts the app and checks
 * its health; when that version does not pass, the server goes back to where it was (C2 track P;
 * docs/plan/hosting.md 10). The server keeps the newest five versions, so there are up to four to go back to.
 *
 * It changes code only. It never touches the database: migrations only go forward (hosting.md 5.11), and a version
 * that is still on the server ran against a schema the current one still has.
 * Undo: release names are listed in the output; rollback --to <the newer name> goes forward again.
 */
import { webRoot } from "@/lib/llm/root";
import { DeployError, finish, guardMain, modeOf, Output, parseArgs, runPlan, startedAs, type Step } from "./lib/cli";
import { loadContext } from "./lib/deploy-file";
import { realRunner, remoteOp, remoteResult, type Runner, targetOf } from "./lib/exec";

export async function main(argv: readonly string[], out: Output, run: Runner = realRunner(out), webDir: string = webRoot()): Promise<number> {
  return guardMain(out, async () => {
    const args = parseArgs(argv, { bool: ["accept-new-host-key"], value: ["to", "host"] });
    if (args.bool("help")) {
      out.say("usage: npx tsx scripts/deploy/rollback.ts [--to <release name>] --dry-run | --yes");
      return 0;
    }
    const mode = modeOf(args);
    const to = args.value("to");
    if (to !== undefined && !/^\d{8}T\d{6}-[0-9a-f]{7,40}$/.test(to)) throw new DeployError("--to is a release name as status prints it, e.g. 20261016T093000-d99d02f");
    const ctx = loadContext(args, webDir, out);
    const target = targetOf(ctx, { acceptNew: args.bool("accept-new-host-key"), host: args.value("host") });
    const cmd = remoteOp(target, webDir, "rollback", to ? [to] : [], { timeoutMs: 5 * 60_000 });
    let outcome: { code: number; result: Record<string, unknown> | null } = { code: 0, result: null };
    const steps: Step[] = [
      {
        title: `server: point /srv/ripple/current at ${to ?? "the version before the current one"}, restart ripple-web, check /api/health; switch back if it does not pass`,
        show: [cmd.show, "the database is not touched", "undo: rollback --to <the newer release name>"],
        run: async () => {
          const res = await run(cmd);
          outcome = { code: res.code, result: remoteResult(res.stdout) };
        },
      },
    ];
    const planned = await runPlan(out, mode, "rollback", steps);
    if (mode !== "act") return planned;
    if (outcome.code === 3) throw new DeployError("that version did not pass its health check; the server is back on the version it was running", 3);
    if (outcome.code !== 0) throw new DeployError(`the rollback did not complete (exit ${outcome.code}); see the lines above and run status`, outcome.code === 255 ? 1 : outcome.code);
    out.say(`rollback: running ${String(outcome.result?.release ?? "the version before")}.`);
    return 0;
  });
}

if (startedAs("rollback")) {
  void main(process.argv.slice(2), new Output()).then(finish);
}
