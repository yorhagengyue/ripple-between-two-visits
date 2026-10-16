/**
 * What runs on the server (scripts/deploy/server/remote.mjs, C2 track P): putting an environment file in place and
 * taking it back, the origin lock, a release that switches back by itself, keeping five versions, rollback, status.
 * The machine is a fake: a temporary folder stands in for /, commands are recorded, the app's health is scripted.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cli, compareHealth, envApply, envRestore, paths, realSys, release, rollback, rollbackTarget, secretsApply, secretsRestore, status, toPrune, waitHealthy } from "@/scripts/deploy/server/remote.mjs";

type Health = { status: number; body: Record<string, unknown> | null } | null;

const EXPECT = { store: "supabase", llm: "deepseek", checker: "deepseek", speech: "mock", deployed: true };
const healthy = (build?: string): Health => ({ status: 200, body: { ok: true, ...EXPECT, ...(build ? { build } : {}) } });

interface Machine {
  root: string;
  P: ReturnType<typeof paths>;
  sys: ReturnType<typeof realSys>;
  calls: string[];
  said: string[];
  reads: string[];
  /** what the app answers on its port, call after call (the last one repeats) */
  health: Health[];
  /** exit codes for commands whose text matches */
  failing: Array<[RegExp, number]>;
  link: { target: string | null };
  /** the build id `next build` leaves behind */
  buildId: string;
  caddy: string;
}

const madeRoots: string[] = [];
afterAll(() => {
  for (const dir of madeRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function machine(): Machine {
  const root = mkdtempSync(path.join(os.tmpdir(), "ripple-remote-test-")).replace(/\\/g, "/");
  madeRoots.push(root);
  const P = paths(root);
  for (const dir of [`${root}/etc/ripple`, `${root}/etc/caddy`, P.releases, P.shared, P.backupState, `${root}/tmp`]) mkdirSync(dir, { recursive: true });
  const real = realSys();
  const m: Machine = { root, P, sys: real, calls: [], said: [], reads: [], health: [healthy()], failing: [], link: { target: null }, buildId: "BUILD-NEW", caddy: "active" };
  let clock = 1_000_000;
  const codeFor = (text: string) => m.failing.find(([re]) => re.test(text))?.[1] ?? 0;
  m.sys = {
    ...real,
    run(bin: string, args: string[]) {
      const text = `${bin} ${args.join(" ")}`;
      m.calls.push(text);
      if (bin === "install" && args[0] === "-d") mkdirSync(args[args.length - 1], { recursive: true });
      // unpacking: the web folder's two package files appear, unless the test's archive says it is empty
      if (bin === "runuser" && args.includes("tar") && real.read(args[args.indexOf("-xzf") + 1]) !== "empty") {
        const into = args[args.indexOf("-C") + 1];
        writeFileSync(`${into}/package.json`, "{}");
        writeFileSync(`${into}/package-lock.json`, "{}");
      }
      if (bin === "systemctl" && args[0] === "is-active") return { code: 0, stdout: `${args[1] === "caddy" ? m.caddy : "active"}\n`, stderr: "" };
      return { code: codeFor(text), stdout: "", stderr: "" };
    },
    async runLong(bin: string, args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
      const text = `${bin} ${args.join(" ")}`;
      m.calls.push(`${text} [NODE_ENV=${opts.env?.NODE_ENV ?? "unset"} HOME=${(opts.env?.HOME ?? "").replace(root, "")}]`);
      const code = codeFor(text);
      if (code === 0 && /next build$/.test(text) && opts.cwd) {
        mkdirSync(`${opts.cwd}/.next`, { recursive: true });
        writeFileSync(`${opts.cwd}/.next/BUILD_ID`, m.buildId);
      }
      return { code, tail: code ? "the build's last lines" : "" };
    },
    read(p: string) {
      m.reads.push(p);
      return real.read(p);
    },
    linkTarget: (p: string) => (p === P.current ? m.link.target : null),
    pointLink(link: string, target: string) {
      m.calls.push(`link ${path.basename(link)} -> ${path.basename(target)}`);
      m.link.target = target;
    },
    memUsedMb: () => ({ ram: 1234, swap: 56 }),
    sleep: async (ms: number) => void (clock += ms),
    now: () => clock,
    getHealth: async () => (m.health.length > 1 ? m.health.shift()! : m.health[0]),
    say: (line: string) => void m.said.push(line),
  } as Machine["sys"];
  return m;
}

/** A version folder on the fake server, as a finished release leaves it. */
function addRelease(m: Machine, id: string, build = `BUILD-${id.slice(-7)}`): string {
  const dir = `${m.P.releases}/${id}`;
  mkdirSync(`${dir}/.next`, { recursive: true });
  writeFileSync(`${dir}/.next/BUILD_ID`, build);
  return dir;
}

const text = (m: Machine) => m.said.join("\n");
const systemctl = (m: Machine) => m.calls.filter((c) => c.startsWith("systemctl ") && !c.includes("is-active"));

describe("comparing the running app with what was pushed", () => {
  it("lists each field that differs, by provider name", () => {
    expect(compareHealth({ ok: true, ...EXPECT }, EXPECT)).toEqual([]);
    expect(compareHealth({ ok: true, ...EXPECT, llm: "mock", deployed: false }, EXPECT)).toEqual(["llm: pushed deepseek, running mock", "deployed: pushed true, running false"]);
    expect(compareHealth({ ok: false, ...EXPECT }, EXPECT)).toEqual(["ok is not true"]);
    expect(compareHealth({ ok: true, build: "OLD" }, null, "NEW")).toEqual(["build: the server is not running the build that was just made"]);
    expect(compareHealth(null, EXPECT)[0]).toBe("ok is not true");
  });

  it("waits while nothing answers, and takes the first answer as final", async () => {
    const m = machine();
    m.health = [null, null, healthy()];
    expect(await waitHealthy(m.sys, { expect: EXPECT })).toMatchObject({ ok: true, diffs: [] });
    m.health = [null, { status: 200, body: { ok: true, ...EXPECT, llm: "mock" } }, healthy()];
    expect(await waitHealthy(m.sys, { expect: EXPECT })).toMatchObject({ ok: false, diffs: ["llm: pushed deepseek, running mock"] });
    m.health = [null];
    const never = await waitHealthy(m.sys, { expect: EXPECT, timeoutMs: 60_000 });
    expect(never.ok).toBe(false);
    expect(never.diffs[0]).toMatch(/nothing answered on the app's port within 60 s/);
  });
});

describe("env-apply", () => {
  const stage = (m: Machine, content = "NEW=1\n", expectation: Record<string, unknown> = EXPECT) => {
    writeFileSync(`${m.P.webEnv}.new`, content);
    writeFileSync(`${m.P.webExpect}.new`, JSON.stringify(expectation));
  };

  it("refuses when nothing is staged", async () => {
    const m = machine();
    await expect(envApply(m.sys, m.P)).rejects.toThrow(/no staged environment file/);
  });

  it("before the first release: puts the file in place, restarts nothing, compares nothing", async () => {
    const m = machine();
    stage(m);
    const res = await envApply(m.sys, m.P);
    expect(res).toMatchObject({ code: 0, result: { status: "staged", restarted: false } });
    expect(readFileSync(m.P.webEnv, "utf8")).toBe("NEW=1\n");
    expect(existsSync(`${m.P.webEnv}.new`)).toBe(false);
    expect(existsSync(`${m.P.webEnv}.prev`)).toBe(false);
    expect(systemctl(m)).toEqual([]);
  });

  it("keeps the previous copy, restarts, and is done when the running app reports what was pushed", async () => {
    const m = machine();
    m.link.target = addRelease(m, "20261010T010101-aaaaaaa");
    writeFileSync(m.P.webEnv, "OLD=1\n");
    writeFileSync(m.P.webExpect, JSON.stringify({ ...EXPECT, speech: "whisper" }));
    stage(m);
    const res = await envApply(m.sys, m.P);
    expect(res).toMatchObject({ code: 0, result: { status: "ok", restarted: true } });
    expect(readFileSync(m.P.webEnv, "utf8")).toBe("NEW=1\n");
    expect(readFileSync(`${m.P.webEnv}.prev`, "utf8")).toBe("OLD=1\n");
    expect(JSON.parse(readFileSync(`${m.P.webExpect}.prev`, "utf8")).speech).toBe("whisper");
    expect(systemctl(m)).toEqual(["systemctl restart ripple-web"]);
  });

  it("when the running app reports something else: puts the previous file back, restarts again, exit 3", async () => {
    const m = machine();
    m.link.target = addRelease(m, "20261010T010101-aaaaaaa");
    writeFileSync(m.P.webEnv, "OLD=1\n");
    writeFileSync(m.P.webExpect, JSON.stringify(EXPECT));
    stage(m, "NEW=1\n", { ...EXPECT, llm: "deepseek" });
    m.health = [{ status: 200, body: { ok: true, ...EXPECT, llm: "mock" } }, healthy()];
    const res = await envApply(m.sys, m.P);
    expect(res.code).toBe(3);
    expect(res.result).toMatchObject({ status: "restored", restored_healthy: true });
    expect(readFileSync(m.P.webEnv, "utf8")).toBe("OLD=1\n");
    expect(existsSync(`${m.P.webEnv}.prev`)).toBe(false);
    expect(existsSync(`${m.P.webEnv}.new`)).toBe(false);
    expect(systemctl(m)).toEqual(["systemctl restart ripple-web", "systemctl restart ripple-web"]);
    expect(text(m)).toContain("DIFFERS  llm: pushed deepseek, running mock");
  });

  it("when the app never comes up with the new file: the same way back", async () => {
    const m = machine();
    m.link.target = addRelease(m, "20261010T010101-aaaaaaa");
    writeFileSync(m.P.webEnv, "OLD=1\n");
    stage(m);
    m.health = [null];
    const res = await envApply(m.sys, m.P, { timeoutMs: 10_000 });
    expect(res.code).toBe(3);
    expect(readFileSync(m.P.webEnv, "utf8")).toBe("OLD=1\n");
    // the expectation that came with the rejected file is gone with it
    expect(existsSync(m.P.webExpect)).toBe(false);
  });

  it("with no previous file to go back to: says so, exit 4", async () => {
    const m = machine();
    m.link.target = addRelease(m, "20261010T010101-aaaaaaa");
    stage(m);
    m.health = [{ status: 200, body: { ok: true, ...EXPECT, deployed: false } }];
    const res = await envApply(m.sys, m.P);
    expect(res).toMatchObject({ code: 4, result: { status: "failed_no_previous" } });
    expect(readFileSync(m.P.webEnv, "utf8")).toBe("NEW=1\n");
  });

  it("env-restore swaps the two files, so restoring twice is where it started", async () => {
    const m = machine();
    writeFileSync(m.P.webEnv, "NOW=1\n");
    writeFileSync(`${m.P.webEnv}.prev`, "BEFORE=1\n");
    expect((await envRestore(m.sys, m.P)).code).toBe(0);
    expect(readFileSync(m.P.webEnv, "utf8")).toBe("BEFORE=1\n");
    expect(readFileSync(`${m.P.webEnv}.prev`, "utf8")).toBe("NOW=1\n");
    await envRestore(m.sys, m.P);
    expect(readFileSync(m.P.webEnv, "utf8")).toBe("NOW=1\n");
    const none = machine();
    await expect(envRestore(none.sys, none.P)).rejects.toThrow(/nothing to restore/);
  });
});

describe("secrets-apply", () => {
  it("refuses a part that is not staged, before changing anything", async () => {
    const m = machine();
    writeFileSync(`${m.P.edgeEnv}.new`, "EDGE_SECRET=new\n");
    await expect(secretsApply(m.sys, m.P, ["edge", "backup"])).rejects.toThrow(/not staged on the server: backup\.env\.new, backup\.age\.pub\.new/);
    expect(existsSync(m.P.edgeEnv)).toBe(false);
    await expect(secretsApply(m.sys, m.P, ["everything"])).rejects.toThrow(/edge, backup or both/);
  });

  it("puts the origin lock in place, keeps the one before, restarts Caddy and checks it runs", async () => {
    const m = machine();
    writeFileSync(m.P.edgeEnv, "EDGE_SECRET=old\n");
    writeFileSync(`${m.P.edgeEnv}.new`, "EDGE_SECRET=new\n");
    const res = await secretsApply(m.sys, m.P, ["edge"]);
    expect(res).toMatchObject({ code: 0, result: { status: "ok", caddy: "active" } });
    expect(readFileSync(m.P.edgeEnv, "utf8")).toBe("EDGE_SECRET=new\n");
    expect(readFileSync(`${m.P.edgeEnv}.prev`, "utf8")).toBe("EDGE_SECRET=old\n");
    expect(systemctl(m)).toEqual(["systemctl restart caddy"]);
    expect(text(m)).not.toMatch(/old|new\b.*EDGE_SECRET=/);
  });

  it("when Caddy does not come up: the previous lock goes back, exit 3", async () => {
    const m = machine();
    m.caddy = "failed";
    writeFileSync(m.P.edgeEnv, "EDGE_SECRET=old\n");
    writeFileSync(`${m.P.edgeEnv}.new`, "EDGE_SECRET=new\n");
    const res = await secretsApply(m.sys, m.P, ["edge"]);
    expect(res.code).toBe(3);
    expect(readFileSync(m.P.edgeEnv, "utf8")).toBe("EDGE_SECRET=old\n");
    expect(systemctl(m)).toEqual(["systemctl restart caddy", "systemctl restart caddy"]);
  });

  it("the backup files need no restart; restore swaps them back", async () => {
    const m = machine();
    writeFileSync(m.P.backupEnv, "OLD=1\n");
    writeFileSync(`${m.P.backupEnv}.new`, "NEW=1\n");
    writeFileSync(`${m.P.backupPub}.new`, "age1new\n");
    expect((await secretsApply(m.sys, m.P, ["backup"])).code).toBe(0);
    expect(systemctl(m)).toEqual([]);
    expect(readFileSync(m.P.backupPub, "utf8")).toBe("age1new\n");
    const back = await secretsRestore(m.sys, m.P, ["backup"]);
    expect(back.result).toMatchObject({ restored: ["backup.env"] });
    expect(readFileSync(m.P.backupEnv, "utf8")).toBe("OLD=1\n");
    await expect(secretsRestore(m.sys, m.P, ["edge"])).rejects.toThrow(/nothing to restore/);
  });
});

describe("release", () => {
  const ID = "20261016T093000-d99d02f";
  const ready = (m: Machine) => {
    writeFileSync(m.P.webEnv, "X=1\n");
    writeFileSync(m.P.webExpect, JSON.stringify(EXPECT));
    const tarball = `${m.root}/tmp/ripple-release-${ID}.tgz`;
    writeFileSync(tarball, "archive");
    return tarball;
  };

  it("refuses a bad name, a missing archive, a name already there, and a server without its environment file", async () => {
    const m = machine();
    const tarball = ready(m);
    await expect(release(m.sys, m.P, ["../../etc", tarball])).rejects.toThrow(/release name must look like/);
    await expect(release(m.sys, m.P, [ID, `${m.root}/tmp/none.tgz`])).rejects.toThrow(/archive is not on the server/);
    addRelease(m, ID);
    await expect(release(m.sys, m.P, [ID, tarball])).rejects.toThrow(/already on the server/);
    const bare = machine();
    writeFileSync(`${bare.root}/tmp/a.tgz`, "x");
    await expect(release(bare.sys, bare.P, [ID, `${bare.root}/tmp/a.tgz`])).rejects.toThrow(/run push-env first/);
    expect(m.calls).toEqual([]);
  });

  it("an archive without the web folder's package files stops at the unpack step, before npm (the first real release sent an empty one)", async () => {
    const m = machine();
    const tarball = ready(m);
    writeFileSync(tarball, "empty");
    const res = await release(m.sys, m.P, [ID, tarball], { noSampling: true });
    expect(res.code).toBe(4);
    expect(res.result).toMatchObject({ status: "failed", stage: "unpack" });
    expect(text(m)).toMatch(/no package\.json and package-lock\.json/);
    expect(m.calls.some((c) => c.includes("npm ci"))).toBe(false);
    expect(m.link.target).toBe(null);
  });

  it("unpacks and builds as the service user without NODE_ENV, switches, restarts, checks health and the build id", async () => {
    const m = machine();
    const tarball = ready(m);
    const previous = addRelease(m, "20261010T010101-aaaaaaa");
    m.link.target = previous;
    m.health = [null, healthy("BUILD-NEW")];
    const res = await release(m.sys, m.P, [ID, tarball], { noSampling: true });
    expect(res.code).toBe(0);
    expect(res.result).toMatchObject({ status: "ok", release: ID, previous: "20261010T010101-aaaaaaa", build: "BUILD-NEW", peak_ram_mb: 1234, peak_swap_mb: 56, removed: [] });
    const dir = `${m.P.releases}/${ID}`;
    expect(m.calls).toEqual([
      `install -d -o ripple -g ripple -m 0755 ${dir}`,
      `runuser -u ripple -- tar -xzf ${tarball} -C ${dir}`,
      "runuser -u ripple -- npm ci --no-audit --no-fund [NODE_ENV=unset HOME=/srv/ripple/shared]",
      "runuser -u ripple -- /usr/local/bin/node node_modules/next/dist/bin/next build [NODE_ENV=unset HOME=/srv/ripple/shared]",
      `link current -> ${ID}`,
      "systemctl restart ripple-web",
    ]);
    expect(m.link.target).toBe(dir);
    expect(existsSync(tarball)).toBe(false);
    expect(text(m)).toMatch(/peak memory in use during the build 1234 MB, swap 56 MB/);
  });

  it("when npm ci or the build fails: the running version is not touched and the new folder is removed", async () => {
    for (const failing of [/npm ci/, /next build/]) {
      const m = machine();
      const tarball = ready(m);
      m.link.target = addRelease(m, "20261010T010101-aaaaaaa");
      m.failing = [[failing, 1]];
      const res = await release(m.sys, m.P, [ID, tarball], { noSampling: true });
      expect(res.code).toBe(4);
      expect(res.result).toMatchObject({ status: "failed" });
      expect(path.basename(m.link.target!)).toBe("20261010T010101-aaaaaaa");
      expect(existsSync(`${m.P.releases}/${ID}`)).toBe(false);
      expect(systemctl(m)).toEqual([]);
      expect(text(m)).toMatch(/the running version was not touched/);
    }
  });

  it("when the new version does not report what was pushed: switches back by itself, restarts, removes the new folder, exit 3", async () => {
    const m = machine();
    const tarball = ready(m);
    m.link.target = addRelease(m, "20261010T010101-aaaaaaa", "BUILD-OLD");
    m.health = [{ status: 200, body: { ok: true, ...EXPECT, llm: "mock", build: "BUILD-NEW" } }, healthy("BUILD-OLD")];
    const res = await release(m.sys, m.P, [ID, tarball], { noSampling: true });
    expect(res.code).toBe(3);
    expect(res.result).toMatchObject({ status: "switched_back", current: "20261010T010101-aaaaaaa", previous_healthy: true });
    expect(path.basename(m.link.target!)).toBe("20261010T010101-aaaaaaa");
    expect(existsSync(`${m.P.releases}/${ID}`)).toBe(false);
    expect(m.calls.slice(-4)).toEqual([`link current -> ${ID}`, "systemctl restart ripple-web", "link current -> 20261010T010101-aaaaaaa", "systemctl restart ripple-web"]);
  });

  it("an old process still answering is not taken for the new version (the build id differs): switches back", async () => {
    const m = machine();
    const tarball = ready(m);
    m.link.target = addRelease(m, "20261010T010101-aaaaaaa", "BUILD-OLD");
    m.health = [healthy("BUILD-OLD")];
    const res = await release(m.sys, m.P, [ID, tarball], { noSampling: true });
    expect(res.code).toBe(3);
    expect(text(m)).toContain("DIFFERS  build: the server is not running the build that was just made");
  });

  it("when nothing answers after the restart, or the restart itself fails: switches back", async () => {
    for (const setup of [(m: Machine) => void (m.health = [null]), (m: Machine) => void (m.failing = [[/systemctl restart ripple-web/, 1]])]) {
      const m = machine();
      const tarball = ready(m);
      m.link.target = addRelease(m, "20261010T010101-aaaaaaa", "BUILD-OLD");
      setup(m);
      const res = await release(m.sys, m.P, [ID, tarball], { noSampling: true, timeoutMs: 6000 });
      expect(res.code).toBe(3);
      expect(path.basename(m.link.target!)).toBe("20261010T010101-aaaaaaa");
    }
  });

  it("the first version failing its check: nothing to switch back to, the app is stopped, exit 4", async () => {
    const m = machine();
    const tarball = ready(m);
    m.health = [{ status: 200, body: { ok: true, ...EXPECT, deployed: false, build: "BUILD-NEW" } }];
    const res = await release(m.sys, m.P, [ID, tarball], { noSampling: true });
    expect(res).toMatchObject({ code: 4, result: { status: "failed_no_previous" } });
    expect(systemctl(m)).toEqual(["systemctl restart ripple-web", "systemctl stop ripple-web"]);
  });

  it("keeps the newest five versions and never removes the one in use", async () => {
    expect(toPrune(["a1", "a2", "a3", "a4", "a5", "a6", "a7"], "a7")).toEqual(["a1", "a2"]);
    expect(toPrune(["a1", "a2", "a3", "a4", "a5", "a6", "a7"], "a1")).toEqual(["a2"]);
    expect(toPrune(["a1", "a2"], "a2")).toEqual([]);
    const m = machine();
    const tarball = ready(m);
    for (let day = 1; day <= 6; day++) addRelease(m, `2026100${day}T000000-aaaaaaa`);
    m.link.target = `${m.P.releases}/20261006T000000-aaaaaaa`;
    m.health = [healthy("BUILD-NEW")];
    const res = await release(m.sys, m.P, [ID, tarball], { noSampling: true });
    expect((res.result as { removed?: string[] }).removed).toEqual(["20261001T000000-aaaaaaa", "20261002T000000-aaaaaaa"]);
    expect(readdirSync(m.P.releases).sort()).toEqual(["20261003T000000-aaaaaaa", "20261004T000000-aaaaaaa", "20261005T000000-aaaaaaa", "20261006T000000-aaaaaaa", ID]);
  });

  it("never runs anything against the database", async () => {
    const m = machine();
    const tarball = ready(m);
    m.health = [healthy("BUILD-NEW")];
    await release(m.sys, m.P, [ID, tarball], { noSampling: true });
    expect(m.calls.filter((c) => /migrat|psql|pg_|supabase/i.test(c))).toEqual([]);
  });
});

describe("rollback", () => {
  it("goes to the version before the current one, or to the named one", () => {
    const ids = ["20261001T000000-aaaaaaa", "20261002T000000-bbbbbbb", "20261003T000000-ccccccc"];
    expect(rollbackTarget(ids, ids[2])).toBe(ids[1]);
    expect(rollbackTarget(ids, ids[1])).toBe(ids[0]);
    expect(rollbackTarget(ids, ids[0])).toBeNull();
    expect(rollbackTarget(ids, ids[0], ids[2])).toBe(ids[2]);
    expect(rollbackTarget(ids, ids[2], ids[2])).toBeNull();
    expect(rollbackTarget(ids, ids[2], "20260101T000000-fffffff")).toBeNull();
  });

  it("switches, restarts, checks; touches only the link and the service", async () => {
    const m = machine();
    addRelease(m, "20261001T000000-aaaaaaa", "BUILD-A");
    m.link.target = addRelease(m, "20261002T000000-bbbbbbb", "BUILD-B");
    m.health = [healthy("BUILD-A")];
    const res = await rollback(m.sys, m.P, []);
    expect(res).toMatchObject({ code: 0, result: { status: "ok", release: "20261001T000000-aaaaaaa", previous: "20261002T000000-bbbbbbb" } });
    expect(m.calls).toEqual(["link current -> 20261001T000000-aaaaaaa", "systemctl restart ripple-web"]);
    expect(text(m)).toContain("the database was not touched");
  });

  it("refuses when there is no older version or the named one is not there", async () => {
    const m = machine();
    m.link.target = addRelease(m, "20261002T000000-bbbbbbb");
    await expect(rollback(m.sys, m.P, [])).rejects.toThrow(/no older version/);
    await expect(rollback(m.sys, m.P, ["20260101T000000-fffffff"])).rejects.toThrow(/not on the server/);
    await expect(rollback(m.sys, m.P, ["; rm -rf /"])).rejects.toThrow(/not a release name/);
    expect(m.calls).toEqual([]);
  });

  it("when the older version does not pass its check: back to where it was, exit 3", async () => {
    const m = machine();
    addRelease(m, "20261001T000000-aaaaaaa", "BUILD-A");
    m.link.target = addRelease(m, "20261002T000000-bbbbbbb", "BUILD-B");
    m.health = [null, null, null, null, null, healthy("BUILD-B")];
    const res = await rollback(m.sys, m.P, [], { timeoutMs: 6000 });
    expect(res.code).toBe(3);
    expect(path.basename(m.link.target!)).toBe("20261002T000000-bbbbbbb");
  });
});

describe("status", () => {
  it("reads state and never opens an environment file", async () => {
    const m = machine();
    m.link.target = addRelease(m, "20261002T000000-bbbbbbb", "BUILD-B");
    writeFileSync(m.P.webEnv, "RIPPLE_DEEPSEEK_API_KEY=sk-on-the-server-zz\n");
    writeFileSync(m.P.edgeEnv, "EDGE_SECRET=the-lock-on-the-server-zz\n");
    writeFileSync(m.P.backupEnv, "BACKUP_COS_SECRET_KEY=cos-key-on-the-server-zz\n");
    writeFileSync(m.P.webExpect, JSON.stringify(EXPECT));
    writeFileSync(`${m.P.backupState}/last.json`, JSON.stringify({ kind: "backup", status: "not_configured", at: "2026-10-16T19:00:00.000Z", missing: ["BACKUP_COS_BUCKET"] }));
    m.health = [{ status: 200, body: { ok: true, ...EXPECT, llm: "mock" } }];
    const res = await status(m.sys, m.P);
    expect(res.code).toBe(0);
    expect(m.reads.filter((p) => /\.env(\.prev)?$/.test(p))).toEqual([]);
    const said = text(m);
    expect(said).not.toMatch(/on-the-server-zz/);
    expect(said).toContain("version: 20261002T000000-bbbbbbb (build BUILD-B)");
    expect(said).toContain("DIFFERS  llm: pushed deepseek, running mock");
    expect(said).toMatch(/file web\.env: mode \d{4}, written 20/);
    expect(said).toContain("file web.env.prev: not there");
    expect(said).toContain("last backup: not_configured | 2026-10-16T19:00:00.000Z | missing: BACKUP_COS_BUCKET");
    expect(said).toContain("last backup check: never ran");
    // read-only: no command that changes anything
    expect(m.calls.filter((c) => /restart|stop|start |enable|rm |mv |install/.test(c))).toEqual([]);
  });
});

describe("the entry point", () => {
  it("ends every operation with one RIPPLE_RESULT line, and refuses an operation it does not know", async () => {
    const m = machine();
    expect(await cli(["drop-database"], m.sys, m.P)).toBe(2);
    expect(m.said.at(-1)).toBe('RIPPLE_RESULT {"op":"drop-database","status":"refused"}');
    m.said.length = 0;
    expect(await cli(["env-apply"], m.sys, m.P)).toBe(2);
    expect(m.said[0]).toMatch(/^REFUSED: no staged environment file/);
    m.said.length = 0;
    expect(await cli(["status"], m.sys, m.P)).toBe(0);
    expect(m.said.at(-1)).toMatch(/^RIPPLE_RESULT \{"op":"status"/);
  });
});
