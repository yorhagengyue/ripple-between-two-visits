/**
 * release, rollback and status on the owner's computer (C2 track P; docs/plan/hosting.md 5.10, 10): git and ssh are a
 * recording runner, the public name is a scripted fetch. One test per refusal: a modified checkout, a commit that is
 * not pushed, a pending migration; and a release never applies one.
 */
import { describe, expect, it } from "vitest";
import { webRoot } from "@/lib/llm/root";
import type { Cmd, CmdResult } from "@/scripts/deploy/lib/exec";
import { DEFAULT_BRANCH, main as release, pendingFrom, releaseId } from "@/scripts/deploy/release";
import { main as rollback } from "@/scripts/deploy/rollback";
import { main as status } from "@/scripts/deploy/status";
import { APP_DOMAIN, expectNoLeak, fakeFiles, fakeRunner, quietOutput, remoteOpOf, resultLine } from "./helpers";

const WEB = webRoot();
const SHA = "d99d02f0123456789abcdef0123456789abcdef0";
const NOW = new Date("2026-10-16T01:30:00.000Z");
const ID = "20261016T013000-d99d02f";

type Answer = Partial<CmdResult> | void;

/** A world where everything is fine; `over` changes single answers. */
function world(over: { git?: (args: string[]) => Answer; status?: Answer; remote?: (op: string, cmd: Cmd) => Answer; health?: () => Response | Promise<Response> } = {}) {
  const r = fakeRunner((cmd) => {
    if (cmd.bin === "git") {
      const mine = over.git?.(cmd.args);
      if (mine) return mine;
      if (cmd.args[0] === "rev-parse" && cmd.args[1] === "--verify") return { stdout: `${SHA}\n` };
      if (cmd.args[0] === "rev-parse" && cmd.args[1] === "--show-prefix") return { stdout: "web/\n" };
      return {};
    }
    if (cmd.bin === process.execPath) return over.status ?? { stdout: "  applied   0001_tables.sql\n  applied   0002_store_functions.sql\nstatus only; nothing changed\n" };
    const op = remoteOpOf(cmd);
    if (op) return over.remote?.(op, cmd) ?? { stdout: resultLine({ op, status: "ok", release: ID, previous: "20261010T010101-aaaaaaa", build: "BUILD-NEW", build_seconds: 95, peak_ram_mb: 1800, peak_swap_mb: 0 }) };
    return {};
  });
  const fetched: string[] = [];
  const fetchFn = (async (url: string | URL | Request) => {
    fetched.push(String(url));
    return over.health ? over.health() : Response.json({ ok: true, build: "BUILD-NEW" });
  }) as typeof fetch;
  return { ...r, fetched, deps: { run: r.run, fetchFn, now: () => NOW } };
}

const go = async (w: ReturnType<typeof world>, f: ReturnType<typeof fakeFiles>, argv: string[]) => {
  const out = quietOutput();
  const code = await release([...argv, ...f.flags], out, w.deps, WEB);
  return { code, text: out.text() };
};
const gitCalls = (w: ReturnType<typeof world>) => w.calls.filter((c) => c.bin === "git").map((c) => c.args.join(" "));
const sshCalls = (w: ReturnType<typeof world>) => w.calls.filter((c) => c.bin === "ssh");

describe("release", () => {
  it("names a release by time and commit, and deploys c2-real unless told otherwise", () => {
    expect(releaseId(SHA, NOW)).toBe(ID);
    expect(DEFAULT_BRANCH).toBe("c2-real");
    expect(pendingFrom("  applied   0001_tables.sql\n  pending   0015_l_rate_add.sql\n  pending   0016_b_bp_changes.sql\nstatus only; nothing changed\n")).toEqual(["0015_l_rate_add.sql", "0016_b_bp_changes.sql"]);
  });

  it("needs --commit, and does nothing without --yes or in a dry run", async () => {
    const f = fakeFiles();
    const none = world();
    expect((await go(none, f, ["--yes"])).code).toBe(2);
    expect((await go(none, f, ["--commit", "main", "--yes"])).code).toBe(2);
    expect((await go(none, f, ["--commit", SHA])).code).toBe(2);
    const dry = await go(none, f, ["--commit", SHA, "--dry-run"]);
    expect(dry.code).toBe(0);
    expect(none.calls).toHaveLength(0);
    expect(none.fetched).toHaveLength(0);
    expect(dry.text).toContain(`git merge-base --is-ancestor ${SHA} refs/remotes/origin/c2-real`);
    expect(dry.text).toContain("node scripts/db/migrate.mjs --status");
    expect(dry.text).toContain(`"sudo -n /usr/local/bin/node --input-type=module - release ${ID} /tmp/ripple-release-${ID}.tgz"`);
    expect(dry.text).toContain("GET https://<DEPLOY_APP_DOMAIN>/api/health");
    expectNoLeak(dry.text, f);
  });

  it("a good run: checks, packs the commit's web folder, uploads through standard input, releases, checks the public name", async () => {
    const f = fakeFiles();
    const w = world();
    const res = await go(w, f, ["--commit", SHA, "--yes"]);
    expect(res.code).toBe(0);
    expect(gitCalls(w)).toEqual([
      `rev-parse --verify ${SHA}^{commit}`,
      "status --porcelain --untracked-files=no",
      "fetch --quiet origin c2-real",
      `merge-base --is-ancestor ${SHA} refs/remotes/origin/c2-real`,
      `diff --quiet ${SHA} HEAD -- supabase/migrations`,
      "rev-parse --show-prefix",
      // the commit alone (run inside web/, git packs that folder); `<commit>:web` from there packs nothing
      expect.stringMatching(new RegExp(`^archive --format=tar\\.gz -o .*ripple-release-${ID}\\.tgz ${SHA}$`)),
    ]);
    const ssh = sshCalls(w);
    expect(ssh.map((c) => c.args.at(-1))).toEqual([`cat > /tmp/ripple-release-${ID}.tgz`, `sudo -n /usr/local/bin/node --input-type=module - release ${ID} /tmp/ripple-release-${ID}.tgz`]);
    expect(ssh[0].stdinFile).toMatch(new RegExp(`ripple-release-${ID}\\.tgz$`));
    expect(w.fetched).toEqual([`https://${APP_DOMAIN}/api/health`]);
    expect(res.text).toMatch(/release: 20261016T013000-d99d02f is running\. commit d99d02f[0-9a-f]+; build BUILD-NEW; built in 95 s; peak memory during the build 1800 MB/);
    expectNoLeak(res.text, f);
  });

  it("the branch is a parameter", async () => {
    const w = world();
    await go(w, fakeFiles(), ["--commit", SHA, "--branch", "web-app", "--yes"]);
    expect(gitCalls(w)).toContain(`merge-base --is-ancestor ${SHA} refs/remotes/origin/web-app`);
    expect(gitCalls(w)).toContain("fetch --quiet origin web-app");
    const bad = world();
    expect((await go(bad, fakeFiles(), ["--commit", SHA, "--branch", "x; rm -rf ~", "--yes"])).code).toBe(2);
    expect(bad.calls).toHaveLength(0);
  });

  it("refuses when a tracked file is modified", async () => {
    const w = world({ git: (a) => (a[0] === "status" ? { stdout: " M web/app/page.tsx\n" } : undefined) });
    const res = await go(w, fakeFiles(), ["--commit", SHA, "--yes"]);
    expect(res.code).toBe(2);
    expect(res.text).toMatch(/REFUSED: tracked files are modified in this checkout/);
    expect(sshCalls(w)).toHaveLength(0);
    expect(w.calls.filter((c) => c.bin === process.execPath)).toHaveLength(0);
  });

  it("refuses a commit that is not on origin/<branch>", async () => {
    const w = world({ git: (a) => (a[0] === "merge-base" ? { code: 1 } : undefined) });
    const res = await go(w, fakeFiles(), ["--commit", SHA, "--yes"]);
    expect(res.code).toBe(2);
    expect(res.text).toMatch(/REFUSED: the commit is not on origin\/c2-real: push it first/);
    expect(sshCalls(w)).toHaveLength(0);
  });

  it("refuses a commit this repository does not have", async () => {
    const w = world({ git: (a) => (a[0] === "rev-parse" && a[1] === "--verify" ? { code: 128, stderr: "fatal: Needed a single revision" } : undefined) });
    const res = await go(w, fakeFiles(), ["--commit", SHA, "--yes"]);
    expect(res.code).toBe(2);
    expect(res.text).toMatch(/that commit is not in this repository/);
    expect(sshCalls(w)).toHaveLength(0);
  });

  it("refuses when the commit's migration files are not this checkout's (the pending check would read the wrong files)", async () => {
    const w = world({ git: (a) => (a[0] === "diff" ? { code: 1 } : undefined) });
    const res = await go(w, fakeFiles(), ["--commit", SHA, "--yes"]);
    expect(res.code).toBe(2);
    expect(res.text).toMatch(/migration files differ from this checkout's/);
    expect(sshCalls(w)).toHaveLength(0);
  });

  it("stops at a pending migration and never applies one", async () => {
    const w = world({ status: { stdout: "  applied   0001_tables.sql\n  pending   0017_r_visit_audio_parts.sql\nstatus only; nothing changed\n" } });
    const res = await go(w, fakeFiles(), ["--commit", SHA, "--yes"]);
    expect(res.code).toBe(2);
    expect(res.text).toMatch(/REFUSED: the production database has 1 pending migration\(s\): 0017_r_visit_audio_parts\.sql\. Releases never apply migrations/);
    expect(sshCalls(w)).toHaveLength(0);
    expect(gitCalls(w).some((c) => c.startsWith("archive"))).toBe(false);
    // the only database command of a release, in every world of this file, is the status listing
    const db = w.calls.filter((c) => c.bin === process.execPath);
    expect(db.map((c) => c.args.join(" "))).toEqual(["scripts/db/migrate.mjs --status"]);
  });

  it("the database command of a good release is the status listing too, against the production project", async () => {
    const f = fakeFiles();
    const w = world();
    await go(w, f, ["--commit", SHA, "--yes"]);
    const db = w.calls.filter((c) => c.bin === process.execPath);
    expect(db.map((c) => c.args.join(" "))).toEqual(["scripts/db/migrate.mjs --status"]);
    expect(db[0].env?.SUPABASE_DB_URL).toBe(f.values.SUPABASE_DB_URL);
  });

  it("stops when the migration state cannot be read", async () => {
    const w = world({ status: { code: 1, stderr: "migrate: could not connect to the database" } });
    const res = await go(w, fakeFiles(), ["--commit", SHA, "--yes"]);
    expect(res.code).toBe(1);
    expect(sshCalls(w)).toHaveLength(0);
  });

  it("refuses the test project as the production database", async () => {
    const f = fakeFiles({ SUPABASE_DB_URL: null });
    const w = world();
    const res = await go(w, f, ["--commit", SHA, "--yes"]);
    expect(res.code).toBe(2);
    expect(w.calls).toHaveLength(0);
  });

  it("when the server switched back by itself: says so and exits 3, without asking the public name", async () => {
    const w = world({ remote: (op) => (op === "release" ? { code: 3, stdout: resultLine({ op, status: "switched_back", release: ID, current: "20261010T010101-aaaaaaa" }) } : undefined) });
    const res = await go(w, fakeFiles(), ["--commit", SHA, "--yes"]);
    expect(res.code).toBe(3);
    expect(res.text).toMatch(/the server switched back by itself to 20261010T010101-aaaaaaa/);
    expect(w.fetched).toHaveLength(0);
  });

  it("when the public name does not answer with the new build: switches the server back and exits 3", async () => {
    for (const health of [() => Response.json({ ok: true, build: "BUILD-OLD" }), () => new Response("bad gateway", { status: 502 }), () => Promise.reject(new Error("getaddrinfo ENOTFOUND"))]) {
      const w = world({ health });
      const res = await go(w, fakeFiles(), ["--commit", SHA, "--yes"]);
      expect(res.code).toBe(3);
      expect(sshCalls(w).map((c) => remoteOpOf(c)).filter(Boolean)).toEqual(["release", "rollback"]);
      expect(sshCalls(w).at(-1)!.args.at(-1)).toMatch(/- rollback 20261010T010101-aaaaaaa$/);
      expect(res.text).toMatch(/the public name did not pass its health check.*the server was switched back/);
    }
  });

  it("--skip-public-check leaves the public name out (the first release, before the edge rules exist)", async () => {
    const w = world({ health: () => new Response("", { status: 502 }) });
    const res = await go(w, fakeFiles(), ["--commit", SHA, "--skip-public-check", "--yes"]);
    expect(res.code).toBe(0);
    expect(w.fetched).toHaveLength(0);
    expect(res.text).toMatch(/health ok on the server \(the public name was not checked\)/);
  });
});

describe("rollback", () => {
  const go2 = async (argv: string[], answer?: Parameters<typeof fakeRunner>[0]) => {
    const f = fakeFiles();
    const out = quietOutput();
    const r = fakeRunner(answer);
    const code = await rollback([...argv, ...f.flags], out, r.run, WEB);
    return { code, text: out.text(), calls: r.calls, f };
  };

  it("does nothing without --yes; with it, one command on the server and nothing that touches the database", async () => {
    expect((await go2([])).calls).toHaveLength(0);
    expect((await go2(["--dry-run"])).calls).toHaveLength(0);
    const res = await go2(["--yes"], (cmd) => ({ stdout: resultLine({ op: remoteOpOf(cmd), status: "ok", release: "20261010T010101-aaaaaaa" }) }));
    expect(res.code).toBe(0);
    expect(res.calls.map((c) => [c.bin, c.args.at(-1)])).toEqual([["ssh", "sudo -n /usr/local/bin/node --input-type=module - rollback"]]);
    expect(res.text).toContain("the database is not touched");
    expect(res.text).toContain("rollback: running 20261010T010101-aaaaaaa.");
    expectNoLeak(res.text, res.f);
  });

  it("--to names a release and nothing else", async () => {
    const named = await go2(["--to", "20261010T010101-aaaaaaa", "--yes"]);
    expect(named.calls[0].args.at(-1)).toMatch(/- rollback 20261010T010101-aaaaaaa$/);
    const bad = await go2(["--to", "../../etc/passwd", "--yes"]);
    expect(bad.code).toBe(2);
    expect(bad.calls).toHaveLength(0);
  });

  it("when the older version does not pass: exit 3, the server is back where it was", async () => {
    const res = await go2(["--yes"], (cmd) => ({ code: 3, stdout: resultLine({ op: remoteOpOf(cmd), status: "switched_back" }) }));
    expect(res.code).toBe(3);
    expect(res.text).toMatch(/the server is back on the version it was running/);
  });
});

describe("status", () => {
  it("reads only: one command, no --yes needed, and the server's lines go through the same hiding", async () => {
    const f = fakeFiles();
    const out = quietOutput();
    const r = fakeRunner();
    expect(await status([...f.flags, "--dry-run"], out, r.run, WEB)).toBe(0);
    expect(r.calls).toHaveLength(0);
    expect(await status(f.flags, out, r.run, WEB)).toBe(0);
    expect(r.calls.map((c) => c.args.at(-1))).toEqual(["sudo -n /usr/local/bin/node --input-type=module - status"]);
    expect(r.calls[0].echo).toBe(true);
    expectNoLeak(out.text(), f);
  });

  it("fails clearly when the server cannot be reached", async () => {
    const f = fakeFiles();
    const out = quietOutput();
    expect(await status(f.flags, out, fakeRunner(() => ({ code: 255, stderr: "ssh: connect to host 203.0.113.77 port 22: Connection timed out" })).run, WEB)).toBe(1);
    expectNoLeak(out.text(), f);
  });
});
