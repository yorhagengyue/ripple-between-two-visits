/**
 * npx tsx scripts/deploy/push-env.ts --speech mock|whisper|tencent --tts mock|trtc --dry-run | --yes
 * npx tsx scripts/deploy/push-env.ts --restore-prev --dry-run | --yes
 *
 * Writes the app's environment file on the server, /etc/ripple/web.env (0600 root; systemd reads it as root and starts
 * the app as the service user, which cannot read it), keeps the one before as web.env.prev, restarts the app and
 * compares what the running app reports at /api/health with what was pushed. When they differ, the previous file is
 * put back and the app restarted again (C2 track P; docs/plan/hosting.md 5.5, 5.7).
 *
 * The two open decisions are switches, required on every run:
 *   --speech mock | whisper | tencent   whether this deployment has a transcription service, and which
 *   --tts mock | trtc         which read-aloud voice it uses
 * (--profile judges | commercial is the plan's older spelling of --speech mock | whisper.)
 *
 * What goes into the file: every name of web/.env.example that is not marked [not deployed] and has a value in the
 * deploy file, plus the values the script writes for every deployment (lib/app-env.ts FIXED: RIPPLE_DEPLOYED=1,
 * STORE=supabase, ... and the public address from DEPLOY_APP_DOMAIN). SUPABASE_DB_URL never goes in.
 *
 * It refuses, before anything is sent, when the result is not a configuration the deployed app would start with and
 * run as intended; the check is the app's own code (lib/app-env.ts webEnvProblems). Secrets this computer can make
 * and that are missing are created in the deploy file on the first run with --yes, and never shown.
 *
 * The server must have been provisioned (/etc/ripple exists). Before the first release there is no app to restart:
 * the file is put in place and the first release compares.
 */
import { randomBytes } from "node:crypto";
import { webRoot } from "@/lib/llm/root";
import { generateVapidKeys } from "@/lib/push/crypto";
import { buildWebEnv, expectedHealth, formatEnvFile, switchesOf, type WebEnv, webEnvProblems } from "./lib/app-env";
import { DeployError, finish, guardMain, modeOf, Output, parseArgs, runPlan, startedAs, type Step } from "./lib/cli";
import { CREATABLE, type DeployContext, ensureSecrets, loadContext, RANDOM_SECRETS, refuseTestDatabase } from "./lib/deploy-file";
import { must, putRootFile, realRunner, remoteOp, remoteResult, type Runner, targetOf } from "./lib/exec";

/**
 * For a dry run: stand-ins for the secrets a real run would create, so the rest of the plan and its checks read as
 * they will. They exist in memory only, are never written and never shown.
 */
export function withStandIns(ctx: DeployContext, missing: readonly string[]): DeployContext {
  if (!missing.length) return ctx;
  const values = { ...ctx.deploy.values };
  for (const name of missing) if ((RANDOM_SECRETS as readonly string[]).includes(name)) values[name] = randomBytes(32).toString("base64url");
  if (missing.includes("VAPID_PUBLIC_KEY")) {
    const pair = generateVapidKeys();
    values.VAPID_PUBLIC_KEY = pair.publicKey;
    values.VAPID_PRIVATE_KEY = pair.privateKey;
  }
  return { ...ctx, deploy: { ...ctx.deploy, values } };
}

/** How the file is shown in a plan: the script's own values as they are, everything from the deploy file by name. */
export function describeWebEnv(web: WebEnv): string[] {
  const lines = [`/etc/ripple/web.env: ${Object.keys(web.env).length} names`, "written by the script:"];
  for (const name of [...web.written].sort()) lines.push(`  ${name}=${web.env[name]}`);
  lines.push(`from the deploy file (values not shown): ${[...web.fromFile].sort().join(", ") || "(none)"}`);
  for (const l of web.left) lines.push(`left out: ${l.name} (${l.why})`);
  return lines;
}

export async function main(argv: readonly string[], out: Output, run: Runner = realRunner(out), webDir: string = webRoot()): Promise<number> {
  return guardMain(out, async () => {
    const args = parseArgs(argv, { bool: ["restore-prev", "accept-new-host-key"], value: ["speech", "tts", "profile", "host"] });
    if (args.bool("help")) {
      out.say("usage: npx tsx scripts/deploy/push-env.ts --speech mock|whisper|tencent --tts mock|trtc [--restore-prev] --dry-run | --yes");
      return 0;
    }
    const mode = modeOf(args);
    let ctx = loadContext(args, webDir, out);
    const target = targetOf(ctx, { acceptNew: args.bool("accept-new-host-key"), host: args.value("host") });

    if (args.bool("restore-prev")) {
      const cmd = remoteOp(target, webDir, "env-restore");
      let code = 0;
      const steps: Step[] = [
        {
          title: "server: swap /etc/ripple/web.env with web.env.prev, restart the app, compare its health with the restored file's expectation",
          show: [cmd.show, "undo: run --restore-prev again (the two files swap back)"],
          run: async () => {
            const res = await run(cmd);
            code = res.code;
          },
        },
      ];
      const planned = await runPlan(out, mode, "push-env --restore-prev", steps);
      if (mode !== "act") return planned;
      if (code !== 0) throw new DeployError(`the restore did not end well (exit ${code}); see the lines above and run status`, code === 255 ? 1 : code);
      out.say("push-env --restore-prev: done.");
      return 0;
    }

    const sw = switchesOf(args);
    const missing = ensureSecrets(ctx, CREATABLE, mode === "act", out);
    if (missing.length) out.say(mode === "act" ? `Created in the deploy file (values not shown): ${missing.join(", ")}.` : `A run with --yes would first create in the deploy file: ${missing.join(", ")}.`);
    if (mode !== "act") ctx = withStandIns(ctx, missing);

    const note = refuseTestDatabase(ctx);
    const web = buildWebEnv(ctx, sw);
    const problems = webEnvProblems(ctx, web, sw);
    if (problems.length) throw new DeployError(`this environment would not be a working deployment (--speech ${sw.speech} --tts ${sw.tts}); nothing was sent:\n${problems.map((p) => `  - ${p}`).join("\n")}`);

    const expect = expectedHealth(web.env);
    const stamp = new Date().toISOString();
    const envText = formatEnvFile(web.env, `written by scripts/deploy/push-env.ts on ${stamp} (--speech ${sw.speech} --tts ${sw.tts}); change web/.env.deploy and push again, do not edit here`);
    const putEnv = putRootFile(target, "/etc/ripple/web.env.new", "0600", envText, "the app environment (contents below)");
    const putExpect = putRootFile(target, "/etc/ripple/web.expect.json.new", "0644", `${JSON.stringify(expect)}\n`, "what /api/health must answer (provider names, no secrets)");
    const apply = remoteOp(target, webDir, "env-apply");

    let applied: { code: number; status: string } = { code: 0, status: "" };
    const steps: Step[] = [
      { title: "server: stage the new environment file, 0600 root, contents through standard input", show: [putEnv.show, ...describeWebEnv(web)], run: async () => void (await must(run, out, putEnv, "staging the environment file (has provision run? /etc/ripple must exist)")) },
      {
        title: "server: stage what the app must report once it runs with that file",
        show: [putExpect.show, `expected health: ${Object.entries(expect).map(([k, val]) => `${k}=${String(val)}`).join(" ")}`],
        run: async () => void (await must(run, out, putExpect, "staging the expectation")),
      },
      {
        title: "server: put the file in place (the one before becomes web.env.prev), restart ripple-web, compare /api/health with the expectation; on a difference put the previous file back and restart again",
        show: [apply.show, "before the first release there is no app: the file is put in place and the first release compares", "undo: push-env --restore-prev"],
        run: async () => {
          const res = await run(apply);
          applied = { code: res.code, status: String(remoteResult(res.stdout)?.status ?? "") };
        },
      },
    ];
    if (note) out.say(`NOTE: ${note}`);
    const planned = await runPlan(out, mode, `push-env --speech ${sw.speech} --tts ${sw.tts}`, steps);
    if (mode !== "act") return planned;
    if (applied.code === 3) throw new DeployError("the running app did not report what was pushed; the previous environment file is back in place (see DIFFERS above)", 3);
    if (applied.code !== 0) throw new DeployError(`the environment was not applied cleanly (exit ${applied.code}${applied.status ? `, ${applied.status}` : ""}); see the lines above and run status`, applied.code === 255 ? 1 : applied.code);
    out.say(applied.status === "staged" ? "push-env: the file is in place; no release is installed yet, so nothing was restarted or compared." : "push-env: done; the running app reports what was pushed.");
    return 0;
  });
}

if (startedAs("push-env")) {
  void main(process.argv.slice(2), new Output()).then(finish);
}
