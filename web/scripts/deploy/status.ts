/**
 * npx tsx scripts/deploy/status.ts [--dry-run]
 *
 * Reads the server's state and prints it (C2 track P; docs/plan/hosting.md 5.13): the version running and the ones
 * kept, the services, what /api/health answers against what was pushed, which configuration files exist (name, mode,
 * date; never their contents), the last backup and the last backup check, the certificate's end date, time zone, disk,
 * memory, and the app's most recent error lines.
 *
 * It changes nothing, so it does not ask for --yes; --dry-run prints the one command without connecting.
 * It never opens an environment file and prints no environment value; the output still goes through the same hiding as
 * every other script's.
 */
import { webRoot } from "@/lib/llm/root";
import { DeployError, finish, guardMain, Output, parseArgs, printPlan, startedAs } from "./lib/cli";
import { loadContext } from "./lib/deploy-file";
import { realRunner, remoteOp, type Runner, targetOf } from "./lib/exec";

export async function main(argv: readonly string[], out: Output, run: Runner = realRunner(out), webDir: string = webRoot()): Promise<number> {
  return guardMain(out, async () => {
    const args = parseArgs(argv, { bool: ["accept-new-host-key"], value: ["host"] });
    if (args.bool("help")) {
      out.say("usage: npx tsx scripts/deploy/status.ts [--dry-run]");
      return 0;
    }
    const ctx = loadContext(args, webDir, out);
    const target = targetOf(ctx, { acceptNew: args.bool("accept-new-host-key"), host: args.value("host") });
    const cmd = remoteOp(target, webDir, "status", [], { timeoutMs: 120_000 });
    printPlan(out, "status (read-only)", [{ title: "server: read version, services, health, file dates, backups, certificate, disk, memory, recent errors", show: [cmd.show] }]);
    if (args.bool("dry-run")) {
      out.say("Dry run: nothing was touched.");
      return 0;
    }
    const res = await run(cmd);
    if (res.code !== 0) throw new DeployError(`could not read the server's state (exit ${res.code})`, 1);
    return 0;
  });
}

if (startedAs("status")) {
  void main(process.argv.slice(2), new Output()).then(finish);
}
