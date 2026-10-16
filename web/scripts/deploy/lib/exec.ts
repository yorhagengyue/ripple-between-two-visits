/**
 * Running commands for the deploy scripts (C2 track P): one Runner that every script gets handed (the real one starts
 * a process; the tests' one records the command and answers from a script), and the builders for the only commands
 * that reach the server: ssh with a fixed, short remote command, everything else through standard input.
 *
 * Rules these builders keep:
 *   - no value of the deploy file is ever part of a remote command line (a process list on the server shows those):
 *     file contents and scripts travel through ssh's standard input;
 *   - the target is DEPLOY_USER@DEPLOY_HOST from the deploy file and nothing else; ssh runs in batch mode, so it fails
 *     instead of asking a question (an unknown host key, a passphrase, a password);
 *   - sudo runs with -n: it fails instead of asking for a password;
 *   - what is printed for a command names the values (ssh <DEPLOY_USER>@<DEPLOY_HOST> ...), it does not contain them.
 */
import { spawn } from "node:child_process";
import { createReadStream, readFileSync } from "node:fs";
import path from "node:path";
import { DeployError, type Output } from "./cli";
import { type DeployContext, DOMAIN_NAMES, expandHome, requireNames, SSH_NAMES } from "./deploy-file";

export interface Cmd {
  bin: string;
  args: string[];
  /** how the command is printed: names, never values */
  show: string;
  /** sent to the process's standard input (a file's contents, a script); never printed */
  stdin?: string | Buffer;
  /** or: a local file streamed to standard input */
  stdinFile?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  /** print the process's output lines as they come (through the output's hiding) */
  echo?: boolean;
}

export interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Runner = (cmd: Cmd) => Promise<CmdResult>;

/** The real runner: starts the process without a shell, never inherits the terminal's input. */
export function realRunner(out: Output): Runner {
  return (cmd) =>
    new Promise<CmdResult>((resolve) => {
      const child = spawn(cmd.bin, cmd.args, {
        cwd: cmd.cwd,
        env: cmd.env ? (cmd.env as NodeJS.ProcessEnv) : process.env,
        stdio: [cmd.stdin !== undefined || cmd.stdinFile ? "pipe" : "ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let pending = "";
      const echo = (chunk: string) => {
        if (!cmd.echo) return;
        pending += chunk;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) out.say(`    | ${line}`);
      };
      child.stdout?.setEncoding("utf8").on("data", (c: string) => {
        stdout += c;
        echo(c);
      });
      child.stderr?.setEncoding("utf8").on("data", (c: string) => {
        stderr += c;
        echo(c);
      });
      const timer = cmd.timeoutMs ? setTimeout(() => child.kill(), cmd.timeoutMs) : null;
      const done = (code: number) => {
        if (timer) clearTimeout(timer);
        if (cmd.echo && pending) out.say(`    | ${pending}`);
        resolve({ code, stdout, stderr });
      };
      child.on("error", (err) => {
        stderr += `could not start ${cmd.bin}: ${(err as NodeJS.ErrnoException).code ?? "error"}`;
        done(127);
      });
      child.on("close", (code) => done(code ?? 1));
      if (child.stdin) {
        child.stdin.on("error", () => {});
        if (cmd.stdinFile) createReadStream(cmd.stdinFile).pipe(child.stdin);
        else child.stdin.end(cmd.stdin);
      }
    });
}

/** Run and stop the script when the command fails; the message carries the shown form and the tail of its output. */
export async function must(run: Runner, out: Output, cmd: Cmd, what: string): Promise<CmdResult> {
  const res = await run(cmd);
  if (res.code !== 0) {
    const tail = out.clean((res.stderr || res.stdout).trim().split(/\r?\n/).slice(-6).join("\n"));
    throw new DeployError(`${what} failed (exit ${res.code}): ${cmd.show}${tail ? `\n${tail}` : ""}`, 1);
  }
  return res;
}

// ------------------------------------------------------------------ the server

export interface Target {
  host: string;
  user: string;
  key: string;
  port: string | null;
  /** --accept-new-host-key: let ssh record a host key it has not seen (the first connection only) */
  acceptNew: boolean;
}

/** The one server these scripts talk to: taken from the deploy file, checked, and compared with --host when given. */
export function targetOf(ctx: DeployContext, opts: { acceptNew?: boolean; host?: string } = {}): Target {
  requireNames(ctx, [...SSH_NAMES, ...DOMAIN_NAMES], "reaching the server");
  const v = ctx.deploy.values;
  if (v.DEPLOY_SSH_PORT) requireNames(ctx, ["DEPLOY_SSH_PORT"], "reaching the server");
  if (opts.host !== undefined && opts.host.trim().toLowerCase() !== v.DEPLOY_HOST.toLowerCase()) {
    throw new DeployError("--host is not the DEPLOY_HOST of the deploy file: these scripts only ever act on the server that file names");
  }
  return { host: v.DEPLOY_HOST, user: v.DEPLOY_USER, key: expandHome(v.DEPLOY_SSH_KEY), port: v.DEPLOY_SSH_PORT ?? null, acceptNew: opts.acceptNew === true };
}

/** A remote command line may hold only these characters: fixed words, paths, release names. Nothing to quote, nothing to inject. */
const SAFE_REMOTE = /^[A-Za-z0-9_@%+=:,./ >&|-]*$/;

export function ssh(t: Target, remote: string, more: Pick<Cmd, "stdin" | "stdinFile" | "timeoutMs" | "echo"> & { stdinShow?: string } = {}): Cmd {
  if (!SAFE_REMOTE.test(remote)) throw new DeployError("internal: a remote command with characters outside the safe set was built; nothing was sent", 1);
  const { stdinShow, ...rest } = more;
  const args = ["-i", t.key, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "ConnectTimeout=20", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=8"];
  if (t.acceptNew) args.push("-o", "StrictHostKeyChecking=accept-new");
  if (t.port) args.push("-p", t.port);
  args.push(`${t.user}@${t.host}`, remote);
  const show = `ssh -i <DEPLOY_SSH_KEY>${t.acceptNew ? " -o StrictHostKeyChecking=accept-new" : ""}${t.port ? " -p <DEPLOY_SSH_PORT>" : ""} <DEPLOY_USER>@<DEPLOY_HOST> "${remote}"${stdinShow ? `   < ${stdinShow}` : ""}`;
  return { bin: "ssh", args, show, ...rest };
}

/**
 * Put a root-owned file on the server: the file is created empty with its final mode first, then filled from standard
 * input, so its contents are never readable by another user and never on a command line.
 */
export function putRootFile(t: Target, remotePath: string, mode: "0600" | "0644", content: string, what: string): Cmd {
  return ssh(t, `sudo -n install -m ${mode} -o root -g root /dev/null ${remotePath} && sudo -n tee ${remotePath} > /dev/null`, { stdin: content, stdinShow: what, timeoutMs: 60_000 });
}

/** A file under web/scripts/deploy/server, with Unix line ends whatever the checkout did to it. */
export function serverFile(webDir: string, name: string): string {
  return readFileSync(path.join(webDir, "scripts", "deploy", "server", name), "utf8").replace(/\r\n/g, "\n");
}

const SAFE_ARG = /^[A-Za-z0-9_@%+=:,./-]+$/;

/**
 * Run one operation of server/remote.mjs on the server as root: the script itself is sent through standard input
 * (always this checkout's version, nothing to keep in step on the server), the operation and its arguments are plain
 * words on the command line.
 */
export function remoteOp(t: Target, webDir: string, op: string, opArgs: readonly string[] = [], more: { timeoutMs?: number } = {}): Cmd {
  for (const a of [op, ...opArgs]) if (!SAFE_ARG.test(a)) throw new DeployError("internal: a remote argument with characters outside the safe set was built; nothing was sent", 1);
  return ssh(t, `sudo -n /usr/local/bin/node --input-type=module - ${[op, ...opArgs].join(" ")}`, {
    stdin: serverFile(webDir, "remote.mjs"),
    stdinShow: "scripts/deploy/server/remote.mjs",
    timeoutMs: more.timeoutMs ?? 120_000,
    echo: true,
  });
}

/** The last RIPPLE_RESULT line a remote operation printed, parsed; null when there is none. */
export function remoteResult(stdout: string): Record<string, unknown> | null {
  const lines = stdout.split(/\r?\n/).filter((l) => l.startsWith("RIPPLE_RESULT "));
  if (!lines.length) return null;
  try {
    return JSON.parse(lines[lines.length - 1].slice("RIPPLE_RESULT ".length)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
