/**
 * The two shell scripts that run on the server, actually run (C2 track P; docs/plan/hosting.md 5.6): provision.sh in a
 * folder that stands in for /, with stand-in commands that log what they were asked to do, and check-edge-secret.sh.
 * provision.sh must run to the end, be repeatable, leave the secret files alone, change neither SSH nor a firewall,
 * and keep Caddy stopped until the origin lock is usable.
 *
 * Needs a bash (Git's on Windows, /bin/bash elsewhere); without one these tests are skipped. provision.sh is started
 * only when curl, apt-get and the other commands that would reach outside resolve to the stand-ins: with the real
 * curl on PATH it would download Node from the internet. Its runs are off unless RIPPLE_SANDBOX_TESTS=1 (see below).
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webRoot } from "@/lib/llm/root";
import { parseArgs } from "@/scripts/deploy/lib/cli";
import { loadContext } from "@/scripts/deploy/lib/deploy-file";
import { serverFile } from "@/scripts/deploy/lib/exec";
import { buildBundle, BUNDLE_FILES } from "@/scripts/deploy/provision";
import { APP_EXTRA, fakeFiles, quietOutput } from "./helpers";

const WEB = webRoot();
const SERVER = path.join(WEB, "scripts", "deploy", "server");

/** A bash that runs POSIX scripts: Git's on Windows (never the WSL launcher in System32), /bin/bash elsewhere. */
function findBash(): string | null {
  if (process.platform !== "win32") return existsSync("/bin/bash") ? "/bin/bash" : null;
  const candidates = ["C:/Program Files/Git/bin/bash.exe", "C:/Program Files/Git/usr/bin/bash.exe"];
  const git = spawnSync("git", ["--exec-path"], { encoding: "utf8" });
  if (git.status === 0) candidates.unshift(path.resolve(git.stdout.trim(), "..", "..", "..", "bin", "bash.exe"));
  return candidates.find((c) => existsSync(c)) ?? null;
}
const BASH = findBash();

/** C:/x the way bash's PATH wants it (/c/x): a colon separates PATH entries. */
const posix = (p: string) => (/^[A-Za-z]:\//.test(p) ? `/${p[0].toLowerCase()}/${p.slice(3)}` : p);

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  calls: string[];
}

/**
 * The two full runs of provision.sh start about 150 short processes. On Windows that is ten seconds on a quiet machine
 * and far more on a busy one, and it slows the rest of the unit suite while it lasts (several older tests that walk
 * the whole tree sit close to the 5-second limit). So they run only when asked:
 *
 *   RIPPLE_SANDBOX_TESTS=1 npx vitest run tests/unit/deploy/provision-sandbox.test.ts
 *
 * Run them after every change to server/provision.sh or to a file it installs. The small check of
 * check-edge-secret.sh below always runs.
 */
const FULL_RUNS = !!BASH && process.env.RIPPLE_SANDBOX_TESTS === "1";

describe.skipIf(!BASH)("check-edge-secret.sh", { timeout: 60_000 }, () => {
  it("lets Caddy start only with 32 or more characters of the safe set, and never prints the value", () => {
    const script = path.join(SERVER, "check-edge-secret.sh");
    const cases: Array<[string | undefined, number]> = [
      [undefined, 1],
      ["", 1],
      ["short-zz-secret", 1],
      ["has spaces 0123456789012345678901234567890123456789", 1],
      ["0123456789abcdefghijklmnopqrstuv{$X}", 1],
      ["0123456789abcdefghijklmnopqrstuv", 0],
      [APP_EXTRA.EDGE_SECRET, 0],
    ];
    for (const [value, code] of cases) {
      const res = spawnSync(BASH!, [script], { env: { ...process.env, EDGE_SECRET: value } as NodeJS.ProcessEnv, encoding: "utf8", timeout: 30_000 });
      expect(res.status, String(value)).toBe(code);
      if (value) expect((res.stdout + res.stderr).includes(value)).toBe(false);
    }
  });
});

describe.skipIf(!FULL_RUNS)("provision.sh, run with stand-in commands (RIPPLE_SANDBOX_TESTS=1)", { timeout: 180_000 }, () => {
  // (a skipped block is still read to list its tests: no folder is made then)
  const top = FULL_RUNS ? mkdtempSync(path.join(os.tmpdir(), "ripple-provision-test-")).replace(/\\/g, "/") : "/unused";
  const root = `${top}/root`;
  const stubs = `${top}/stubs`;
  const here = `${top}/bundle`;
  const log = `${top}/calls.log`;
  let caddyfile = "";
  const SECRET_FILES: Record<string, string> = {
    [`${root}/etc/ripple/web.env`]: "RIPPLE_DEEPSEEK_API_KEY=sk-already-on-the-server-zz\n",
    [`${root}/etc/ripple/backup.env`]: "BACKUP_COS_SECRET_KEY=cos-already-on-the-server-zz\n",
    [`${root}/etc/ripple/backup.age.pub`]: "age1alreadyontheserver\n",
    [`${root}/etc/caddy/edge.env`]: "EDGE_SECRET=too-short\n",
  };
  // two full runs, one after the other, on the same stand-in machine (each starts some seventy stand-in processes)
  let first: Run; // a fresh machine that already holds secret files, the origin lock not usable
  let second: Run; // the origin lock now usable, and a newer version of one of our own files
  let badArgs: Run;

  const provisionOnce = (args: string[] = []): Run => {
    writeFileSync(log, "");
    // PATH is set inside bash, whatever the shell does to it at start-up; and nothing runs unless the stand-ins win
    const guard =
      'export PATH="$1:$PATH"; for c in curl apt-get install tar ln id systemctl gpg sha256sum; do if [ "$(command -v "$c")" != "$1/$c" ]; then echo "stand-in for $c is not first on PATH" >&2; exit 97; fi; done; shift; exec bash "$@"';
    const res = spawnSync(BASH!, ["-c", guard, "sandbox", posix(stubs), `${here}/provision.sh`, ...args], { env: { ...process.env, RIPPLE_SANDBOX_ROOT: root, STUB_LOG: log } as NodeJS.ProcessEnv, encoding: "utf8", timeout: 120_000 });
    return { status: res.status, stdout: res.stdout, stderr: res.stderr, calls: readFileSync(log, "utf8").split("\n").filter(Boolean) };
  };

  beforeAll(() => {
    for (const d of [root, stubs, here, `${root}/usr/share/postgresql-common/pgdg`, `${root}/etc/ripple`, `${root}/etc/caddy`]) mkdirSync(d, { recursive: true });
    const stub = (name: string, body: string) => {
      writeFileSync(`${stubs}/${name}`, `#!/usr/bin/env bash\necho "${name} $*" >> "$STUB_LOG"\n${body}\n`);
      chmodSync(`${stubs}/${name}`, 0o755);
    };
    for (const name of ["apt-get", "useradd", "mkswap", "tar", "sha256sum", "ln", "iptables", "nft", "firewall-cmd"]) stub(name, "exit 0");
    stub("fallocate", ': > "${@: -1}"\nexit 0');
    stub("timedatectl", 'if [ "$1" = "show" ]; then echo "Asia/Shanghai"; fi\nexit 0');
    stub("systemctl", 'if [ "$1" = "is-active" ]; then echo "inactive"; fi\nexit 0');
    stub("swapon", "exit 0");
    stub("id", 'if [ "$1" = "-u" ]; then echo 0; exit 0; fi\nexit 1');
    stub("sshd", 'echo "passwordauthentication yes"\necho "permitrootlogin yes"\nexit 0');
    stub("ufw", 'echo "Status: inactive"\nexit 0');
    stub("gpg", 'out=""\nwhile [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then out="$2"; shift; fi; shift; done\ncat > /dev/null\n[ -n "$out" ] && echo key > "$out"\nexit 0');
    stub("curl", 'out=""\nwhile [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then out="$2"; shift; fi; shift; done\nif [ -n "$out" ]; then case "$out" in *SHASUMS256.txt) echo "0000  node-v24.15.0-linux-x64.tar.xz" > "$out" ;; *) echo data > "$out" ;; esac; else echo "deb stand-in"; fi\nexit 0');
    // install: -d makes folders; otherwise copies the source to the destination; owner, group and mode are ignored here
    stub("install", 'dirs=0\nargs=()\nwhile [ $# -gt 0 ]; do case "$1" in -d) dirs=1 ;; -m|-o|-g) shift ;; *) args+=("$1") ;; esac; shift; done\nif [ "$dirs" = "1" ]; then for d in "${args[@]}"; do mkdir -p "$d"; done; else cp "${args[0]}" "${args[1]}"; fi\nexit 0');
    const pgdg = `${root}/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh`;
    writeFileSync(pgdg, `#!/usr/bin/env bash\necho "apt.postgresql.org.sh $*" >> "$STUB_LOG"\nexit 0\n`);
    chmodSync(pgdg, 0o755);
    // the bundle folder as the starter unpacks it on the server
    const f = fakeFiles();
    const bundle = buildBundle(loadContext(parseArgs(f.flags), WEB, quietOutput()), "24.15.0", "17");
    caddyfile = bundle.caddyfile;
    for (const name of BUNDLE_FILES) writeFileSync(`${here}/${name}`, serverFile(WEB, name));
    writeFileSync(`${here}/Caddyfile`, caddyfile);
    for (const [file, content] of Object.entries(SECRET_FILES)) writeFileSync(file, content);

    badArgs = provisionOnce(["24.15.0; reboot"]);
    first = provisionOnce();
    writeFileSync(`${root}/etc/caddy/edge.env`, `EDGE_SECRET=${APP_EXTRA.EDGE_SECRET}\n`);
    writeFileSync(`${here}/ripple-web.service`, `${serverFile(WEB, "ripple-web.service")}# a newer version\n`);
    second = provisionOnce();
  }, 180_000);

  afterAll(() => {
    rmSync(top, { recursive: true, force: true });
  });

  it("refuses version arguments that are not numbers, before doing anything", () => {
    expect(badArgs.status).toBe(2);
    expect(badArgs.calls).toEqual([]);
  });

  it("runs to the end on a fresh machine and installs its files", () => {
    expect(first.status, first.stderr + first.stdout).toBe(0);
    expect(readFileSync(`${root}/etc/caddy/Caddyfile`, "utf8")).toBe(caddyfile);
    expect(readFileSync(`${root}/etc/systemd/system/caddy.service.d/ripple.conf`, "utf8")).toBe(serverFile(WEB, "caddy-ripple.conf"));
    expect(readFileSync(`${root}/etc/systemd/system/ripple-backup.timer`, "utf8")).toBe(serverFile(WEB, "ripple-backup.timer"));
    expect(readFileSync(`${root}/usr/local/lib/ripple/backup.mjs`, "utf8")).toBe(serverFile(WEB, "backup.mjs"));
    expect(readFileSync(`${root}/usr/local/lib/ripple/check-edge-secret.sh`, "utf8")).toBe(serverFile(WEB, "check-edge-secret.sh"));
    expect(readFileSync(`${root}/etc/systemd/journald.conf.d/ripple.conf`, "utf8")).toContain("SystemMaxUse=1G");
    expect(first.stdout).toMatch(/installed \/etc\/systemd\/system\/ripple-web\.service/);
    expect(first.stdout).toMatch(/time zone set to Asia\/Singapore/);
    expect(first.calls).toContain("timedatectl set-timezone Asia/Singapore");
    expect(first.calls.some((c) => /^apt-get .*install postgresql-client-17$/.test(c))).toBe(true);
    // never Ubuntu's own client package: it is version 16 and cannot dump a version 17 database
    expect(first.calls.some((c) => /^apt-get .*install postgresql-client$/.test(c))).toBe(false);
    expect(first.calls.some((c) => /^apt-get .*install age rclone$/.test(c))).toBe(true);
    expect(first.calls.some((c) => /^apt-get .*install caddy$/.test(c))).toBe(true);
    expect(first.calls).toContain(`fallocate -l 2G ${root}/swapfile`);
    expect(first.calls).toContain("useradd --system --home-dir /srv/ripple --no-create-home --shell /usr/sbin/nologin ripple");
    expect(first.calls).toContain("systemctl enable ripple-web.service");
    expect(first.calls).toContain("systemctl enable --now ripple-backup.timer ripple-backup-check.timer");
    // the app is not started: there is no release yet
    expect(first.calls.filter((c) => /^systemctl (start|restart) ripple-web/.test(c))).toEqual([]);
  });

  it("changes neither the SSH server nor a firewall: it reads them and prints what the owner should do", () => {
    for (const run of [first, second]) {
      expect(run.calls.filter((c) => c.startsWith("sshd "))).toEqual(["sshd -T"]);
      expect(run.calls.filter((c) => c.startsWith("ufw "))).toEqual(["ufw status"]);
      expect(run.calls.filter((c) => /^(iptables|nft|firewall-cmd) /.test(c))).toEqual([]);
      expect(run.calls.filter((c) => /ssh/.test(c) && c !== "sshd -T")).toEqual([]);
    }
    expect(existsSync(`${root}/etc/ssh`)).toBe(false);
    expect(first.stdout).toMatch(/passwordauthentication yes/);
    expect(first.stdout).toMatch(/sudo tee \/etc\/ssh\/sshd_config\.d\/60-ripple\.conf/);
    expect(first.stdout).toMatch(/open TCP 80 and 443 to everyone/);
  });

  it("leaves the secret files exactly as they are and never prints what is in them", () => {
    for (const [file, content] of Object.entries(SECRET_FILES)) {
      if (file.endsWith("edge.env")) continue; // the test itself replaced it between the runs
      expect(readFileSync(file, "utf8"), file).toBe(content);
    }
    expect(readFileSync(`${root}/etc/caddy/edge.env`, "utf8")).toBe(`EDGE_SECRET=${APP_EXTRA.EDGE_SECRET}\n`);
    for (const run of [first, second]) {
      expect(run.stdout + run.stderr).not.toMatch(/on-the-server-zz|too-short/);
      expect(run.stdout + run.stderr).not.toContain(APP_EXTRA.EDGE_SECRET);
    }
  });

  it("keeps Caddy stopped until the origin lock is usable, then starts it", () => {
    expect(first.calls).toContain("systemctl stop caddy");
    expect(first.calls.filter((c) => c === "systemctl restart caddy")).toEqual([]);
    expect(first.stdout).toMatch(/Caddy is stopped: there is no usable origin lock yet/);
    expect(second.status, second.stderr + second.stdout).toBe(0);
    expect(second.calls).toContain("systemctl restart caddy");
    expect(second.calls).not.toContain("systemctl stop caddy");
  });

  it("a second run installs only the one file that changed, keeps the old one, and does nothing else again", () => {
    expect(second.status, second.stderr + second.stdout).toBe(0);
    expect(second.stdout.match(/installed \/\S+/g)).toEqual(["installed /etc/systemd/system/ripple-web.service"]);
    expect(readFileSync(`${root}/etc/systemd/system/ripple-web.service.prev`, "utf8")).toBe(serverFile(WEB, "ripple-web.service"));
    expect(readFileSync(`${root}/etc/systemd/system/ripple-web.service`, "utf8")).toMatch(/# a newer version\n$/);
    expect(second.calls).toContain("systemctl daemon-reload");
    expect(second.calls.filter((c) => c.startsWith("fallocate"))).toEqual([]);
    expect(second.calls).not.toContain("systemctl restart systemd-journald");
    expect(second.stdout).not.toMatch(/swap added|automatic security updates switched on/);
  });
});
