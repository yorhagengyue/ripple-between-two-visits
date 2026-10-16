/**
 * npx tsx scripts/deploy/provision.ts [--node-version 24.15.0] [--pg-major 17] [--accept-new-host-key] --dry-run | --yes
 *
 * Prepares the server once (C2 track P; docs/plan/hosting.md 5.6): sends server/provision.sh and the files it installs
 * (systemd units, Caddy's configuration for the origin name with the origin lock, the backup scripts) through ssh's
 * standard input as one bundle and runs it as root. It can be run again: provision.sh only adds what is missing.
 *
 * It needs from the deploy file: DEPLOY_HOST, DEPLOY_USER, DEPLOY_SSH_KEY and the two host names (they go into the
 * Caddy configuration). Nothing secret is in the bundle.
 *
 * It does not change the SSH server's configuration or any firewall: what the owner should do by hand is printed at
 * the end of the plan and again by provision.sh on the server.
 *
 * --accept-new-host-key   the very first connection: let ssh record the server's host key instead of failing. Without
 *                         it, connect once by hand first (ssh -i <key> <user>@<host>) and compare the fingerprint
 *                         with the one in the Lighthouse console.
 */
import { createHash } from "node:crypto";
import { webRoot } from "@/lib/llm/root";
import { DeployError, finish, guardMain, modeOf, Output, parseArgs, runPlan, startedAs, type Step } from "./lib/cli";
import { type DeployContext, isHostname, loadContext, requireNames } from "./lib/deploy-file";
import { must, realRunner, type Runner, serverFile, ssh, targetOf } from "./lib/exec";

/** The files provision.sh expects next to it: source name under server/ → the name it has in the bundle. */
export const BUNDLE_FILES = [
  "provision.sh",
  "ripple-web.service",
  "caddy-ripple.conf",
  "check-edge-secret.sh",
  "journald-ripple.conf",
  "ripple-backup.service",
  "ripple-backup.timer",
  "ripple-backup-check.service",
  "ripple-backup-check.timer",
  "backup.mjs",
  "backup-check.mjs",
] as const;

/** Caddy's configuration for these two host names (they are checked: only letters, digits, dots and hyphens). */
export function renderCaddyfile(template: string, originDomain: string, appDomain: string, acmeEmail?: string): string {
  if (!isHostname(originDomain) || !isHostname(appDomain)) throw new DeployError("the two host names of the deploy file must be plain host names");
  if (acmeEmail !== undefined && !/^[^\s@{}]+@[^\s@{}]+\.[^\s@{}]+$/.test(acmeEmail)) throw new DeployError("DEPLOY_ACME_EMAIL is not an e-mail address");
  const global = acmeEmail ? `{\n\temail ${acmeEmail}\n}\n` : "";
  return template.replace("__GLOBAL__\n", global).split("__ORIGIN__").join(originDomain).split("__APP__").join(appDomain);
}

export interface Bundle {
  /** the bash text sent through standard input */
  script: string;
  files: Array<{ name: string; bytes: number; sha256: string }>;
  caddyfile: string;
}

/**
 * One bash script that carries every file (base64, so no content can end a here-document or be expanded), unpacks them
 * into a fresh folder and runs provision.sh there. Everything is inside one function that is called on the last line:
 * bash has read the whole script before anything runs, so no command can swallow part of it from standard input.
 */
export function buildBundle(ctx: DeployContext, nodeVersion: string, pgMajor: string): Bundle {
  if (!/^\d+\.\d+\.\d+$/.test(nodeVersion)) throw new DeployError("--node-version looks like 24.15.0");
  if (!/^\d{2}$/.test(pgMajor)) throw new DeployError("--pg-major is a two-digit PostgreSQL major version, e.g. 17");
  const v = ctx.deploy.values;
  const caddyfile = renderCaddyfile(serverFile(ctx.webDir, "Caddyfile.tmpl"), v.DEPLOY_ORIGIN_DOMAIN, v.DEPLOY_APP_DOMAIN, v.DEPLOY_ACME_EMAIL);
  const contents: Array<[string, string]> = [...BUNDLE_FILES.map((name): [string, string] => [name, serverFile(ctx.webDir, name)]), ["Caddyfile", caddyfile]];
  const lines = ["#!/usr/bin/env bash", "set -euo pipefail", "ripple_bundle() {", '  local D code=0', '  D="$(mktemp -d /tmp/ripple-provision.XXXXXX)"'];
  for (const [name, text] of contents) {
    lines.push(`  base64 -d > "$D/${name}" <<'RIPPLE_B64'`);
    lines.push(...(Buffer.from(text, "utf8").toString("base64").match(/.{1,76}/g) ?? []));
    lines.push("RIPPLE_B64");
  }
  lines.push('  bash "$D/provision.sh" "$@" </dev/null || code=$?', '  rm -rf "$D"', '  return "$code"', "}", `ripple_bundle ${nodeVersion} ${pgMajor}`, "");
  return {
    script: lines.join("\n"),
    files: contents.map(([name, text]) => ({ name, bytes: Buffer.byteLength(text, "utf8"), sha256: createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12) })),
    caddyfile,
  };
}

/** What the owner does by hand around this step: the script changes neither SSH nor a firewall. */
export const BY_HAND = [
  "Lighthouse console firewall: TCP 80 and TCP 443 open to everyone (Caddy needs both to get its certificate); TCP 22 only from the owner's own address; remove other default rules (3389).",
  "SSH: key login only, no root login. On the server: printf 'PasswordAuthentication no\\nPermitRootLogin no\\n' | sudo tee /etc/ssh/sshd_config.d/60-ripple.conf ; sudo sshd -t && sudo systemctl reload ssh. Keep the open session until a second login works.",
  "Lighthouse console: take a snapshot once this has run.",
  "Next: push-secrets (the origin lock; Caddy stays stopped until then), push-env, release.",
];

export async function main(argv: readonly string[], out: Output, run: Runner = realRunner(out), webDir: string = webRoot()): Promise<number> {
  return guardMain(out, async () => {
    const args = parseArgs(argv, { bool: ["accept-new-host-key"], value: ["node-version", "pg-major", "host"] });
    if (args.bool("help")) {
      out.say("usage: npx tsx scripts/deploy/provision.ts [--node-version 24.15.0] [--pg-major 17] [--accept-new-host-key] --dry-run | --yes");
      return 0;
    }
    const mode = modeOf(args);
    const ctx = loadContext(args, webDir, out);
    const target = targetOf(ctx, { acceptNew: args.bool("accept-new-host-key"), host: args.value("host") });
    if (ctx.deploy.values.DEPLOY_ACME_EMAIL) requireNames(ctx, ["DEPLOY_ACME_EMAIL"], "the certificate contact");
    const nodeVersion = args.value("node-version") ?? "24.15.0";
    const pgMajor = args.value("pg-major") ?? "17";
    const bundle = buildBundle(ctx, nodeVersion, pgMajor);
    const cmd = ssh(target, "sudo -n bash -s", { stdin: bundle.script, stdinShow: `the bundle: provision.sh and ${bundle.files.length - 1} files`, echo: true, timeoutMs: 45 * 60_000 });

    const steps: Step[] = [
      {
        title: "server, as root: run provision.sh from a bundle sent through standard input (nothing secret in it)",
        show: [
          cmd.show,
          ...bundle.files.map((f) => `file ${f.name}  ${f.bytes} bytes  sha256 ${f.sha256}`),
          `provision.sh ${nodeVersion} ${pgMajor}: time zone Asia/Singapore; apt update and upgrade (configuration files kept), automatic security updates; 2 GB swap if none; Node ${nodeVersion} from nodejs.org checked against SHASUMS256.txt; Caddy from its apt source; postgresql-client-${pgMajor} from apt.postgresql.org; age, rclone; user ripple; /srv/ripple/{releases,shared}, /etc/ripple (0700); the units below; journal limits 1 GB / 14 days`,
          "it enables ripple-web (started by the first release), starts the two backup timers (they report 'not configured' until push-secrets has the backup settings), and leaves Caddy stopped until push-secrets has put the origin lock in place",
          "it never writes /etc/ripple/web.env, /etc/ripple/backup.env, /etc/ripple/backup.age.pub or /etc/caddy/edge.env, never changes the SSH server's configuration and never touches a firewall",
          "undo: nothing is running yet after this step; to start over, restore the Lighthouse snapshot or reinstall the instance",
          "/etc/caddy/Caddyfile will be:",
          ...bundle.caddyfile.split("\n").map((l) => `  | ${l}`),
        ],
        run: async () => void (await must(run, out, cmd, "provisioning (if ssh refused the host key: connect once by hand, or pass --accept-new-host-key)")),
      },
    ];
    const planned = await runPlan(out, mode, "provision", steps);
    out.say("For the owner, by hand (this script changes neither SSH nor a firewall):");
    for (const line of BY_HAND) out.say(`  - ${line}`);
    if (mode !== "act") return planned;
    out.say("provision: done.");
    return 0;
  });
}

if (startedAs("provision")) {
  void main(process.argv.slice(2), new Output()).then(finish);
}
