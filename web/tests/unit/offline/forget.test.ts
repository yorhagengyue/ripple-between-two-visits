/**
 * What the phone forgets at logout (C2 track O; real-app 2.25, 3.11): lib/offline/forget.ts against a stand-in for the
 * browser's storage, IndexedDB and Cache Storage; and that every place that ends this phone's sign-in calls it before
 * it leaves for the login page.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetThisPhone, RECORDINGS_DB } from "@/lib/offline/forget";
import { allOfflineStrings, offlineCopy } from "@/lib/offline/copy";
import { judgementHits } from "@/lib/safety/judgement";

const WEB = path.resolve(__dirname, "../../..");
const source = (rel: string) => readFileSync(path.join(WEB, rel), "utf8");

class FakeStorage {
  m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, v);
  clear = () => this.m.clear();
}

interface DeleteRequest {
  onsuccess?: () => void;
  onerror?: () => void;
  onblocked?: () => void;
}

function browser(opts: { databases?: (string | undefined)[] | "unsupported" | "throws"; blocked?: string[]; stuck?: string[]; caches?: string[] | "unsupported" } = {}) {
  const local = new FakeStorage();
  const session = new FakeStorage();
  const deleted: string[] = [];
  const cacheNames = new Set(opts.caches === "unsupported" ? [] : (opts.caches ?? []));
  const indexedDB: Record<string, unknown> = {
    deleteDatabase: (name: string) => {
      const req: DeleteRequest = {};
      if (!(opts.stuck ?? []).includes(name)) {
        queueMicrotask(() => {
          if ((opts.blocked ?? []).includes(name)) req.onblocked?.();
          else {
            deleted.push(name);
            req.onsuccess?.();
          }
        });
      }
      return req;
    },
  };
  if (opts.databases === "throws") {
    indexedDB.databases = async () => {
      throw new Error("SecurityError");
    };
  } else if (opts.databases !== "unsupported") {
    const names = opts.databases ?? [];
    indexedDB.databases = async () => names.map((name) => ({ name, version: 1 }));
  }
  vi.stubGlobal("window", { localStorage: local, sessionStorage: session });
  vi.stubGlobal("indexedDB", indexedDB);
  if (opts.caches === "unsupported") vi.stubGlobal("caches", undefined);
  else vi.stubGlobal("caches", { keys: async () => [...cacheNames], delete: async (k: string) => cacheNames.delete(k) });
  return { local, session, deleted, cacheNames };
}

beforeEach(() => vi.useRealTimers());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("forgetThisPhone", () => {
  it("clears the to-send list, her per-link keys and everything else in storage, every database, every cache", async () => {
    const b = browser({ databases: ["ripple-recordings", "ripple-recordings-v2", undefined], caches: ["rp-shell-0123456789abcdef0123456789abcdef", "something-else"] });
    b.local.setItem("rp_outbox_v1", '[{"id":"x"}]');
    b.local.setItem("rp_outbox_owner", "o123");
    b.local.setItem("rp_outbox_clock", "-42");
    b.local.setItem("rp_f_phone_link-1", "+65 0000 0000");
    b.local.setItem("rp_f_welcomed_link-1", "1");
    b.local.setItem("rp_f_phone_link-2", "+65 0000 0001");
    b.session.setItem("draft", "x");
    await forgetThisPhone();
    expect(b.local.m.size).toBe(0);
    expect(b.session.m.size).toBe(0);
    expect(b.deleted.sort()).toEqual(["ripple-recordings", "ripple-recordings-v2"]);
    expect([...b.cacheNames]).toEqual([]);
  });

  it("a browser that cannot list its databases still deletes the recordings by name", async () => {
    for (const databases of ["unsupported", "throws"] as const) {
      const b = browser({ databases });
      await forgetThisPhone();
      expect(b.deleted, databases).toEqual([RECORDINGS_DB]);
      vi.unstubAllGlobals();
    }
  });

  it("the recordings' database name here is the one components/visit/elder/recording-store.ts opens", () => {
    // one constant for both (track V's lib/visit/recordings-db.ts): the store opens it, the logout deletes it
    for (const file of ["components/visit/elder/recording-store.ts", "lib/offline/forget.ts"]) {
      expect(source(file), file).toMatch(/import \{ RECORDINGS_DB \} from "@\/lib\/visit\/recordings-db"/);
      // neither spells the name out in code again (a comment may)
      expect(source(file), file).not.toMatch(/=\s*"ripple-recordings"/);
    }
    expect(RECORDINGS_DB).toBe("ripple-recordings");
  });

  it("a database another tab holds open does not hold up the logout, nor does one that never answers (3 s at most)", async () => {
    const blocked = browser({ databases: ["ripple-recordings"], blocked: ["ripple-recordings"], caches: ["rp-shell-a"] });
    blocked.local.setItem("rp_outbox_v1", "[]");
    await forgetThisPhone();
    expect(blocked.local.m.size).toBe(0);
    expect([...blocked.cacheNames]).toEqual([]);
    vi.unstubAllGlobals();

    vi.useFakeTimers();
    const stuck = browser({ databases: ["ripple-recordings"], stuck: ["ripple-recordings"], caches: ["rp-shell-a"] });
    stuck.local.setItem("rp_outbox_v1", "[]");
    let done = false;
    const p = forgetThisPhone().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(2900);
    expect(done).toBe(false);
    // storage and caches are already gone while the database is still being waited for
    expect(stuck.local.m.size).toBe(0);
    await vi.advanceTimersByTimeAsync(200);
    await p;
    expect(done).toBe(true);
  });

  it("works where there is no IndexedDB or Cache Storage at all, and storage that throws", async () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("SecurityError");
      },
      get sessionStorage(): Storage {
        throw new Error("SecurityError");
      },
    });
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("caches", undefined);
    await expect(forgetThisPhone()).resolves.toBeUndefined();
  });
});

describe("every place that ends this phone's sign-in forgets first", () => {
  /** In `src`, every `window.location.assign(` that follows `after` must be preceded by `await forgetThisPhone()`. */
  function leavesClean(src: string, body: RegExp): void {
    const block = body.exec(src)?.[0];
    expect(block, String(body)).toBeTruthy();
    const assigns = [...block!.matchAll(/window\.location\.assign\(/g)].map((m) => m.index!);
    expect(assigns.length).toBeGreaterThan(0);
    for (const at of assigns) {
      const before = block!.slice(0, at);
      const lastForget = before.lastIndexOf("await forgetThisPhone()");
      expect(lastForget, "forgetThisPhone before leaving").toBeGreaterThan(-1);
      // nothing leaves between the clearing and the navigation
      expect(before.slice(lastForget)).not.toMatch(/window\.location\.assign\(/);
    }
  }

  it("his 「退出登录」, 「退出所有设备」 and 「退出这台」 on this very device (app/p/me/devices/DevicesScreen.tsx)", () => {
    const src = source("app/p/me/devices/DevicesScreen.tsx");
    leavesClean(src, /async function logout\([\s\S]*?\n {2}}\n/);
    leavesClean(src, /async function signOutDevice\([\s\S]*?\n {2}}\n/);
    // only after the server ended the sign-in: a failed logout keeps what the phone holds
    const logout = /async function logout\([\s\S]*?\n {2}}\n/.exec(src)![0];
    expect(logout.indexOf("if (!r.ok)")).toBeLessThan(logout.indexOf("await forgetThisPhone()"));
  });

  it("her 「退出登录」 (components/family/HerBits.tsx)", () => {
    leavesClean(source("components/family/HerBits.tsx"), /export function LogoutButton\([\s\S]*?\n}\n/);
  });

  // the fe-d track: her own devices screen (/f/me/devices) ends sign-ins the way his does
  it("her 「退出所有设备」 and 「退出这台」 on this very device (components/family/HerSecurity.tsx)", () => {
    const src = source("components/family/HerSecurity.tsx");
    leavesClean(src, /async function logoutEverywhere\([\s\S]*?\n {2}}\n/);
    leavesClean(src, /async function signOutDevice\([\s\S]*?\n {2}}\n/);
    // only after the server ended the sign-in: a failed logout keeps what the phone holds
    const logout = /async function logoutEverywhere\([\s\S]*?\n {2}}\n/.exec(src)![0];
    expect(logout.indexOf("if (!r.ok)")).toBeLessThan(logout.indexOf("await forgetThisPhone()"));
  });
});

describe("the fixed words", () => {
  it("use the design's own two sentences, and judge nothing", () => {
    expect(offlineCopy("zh-Hans").waiting).toBe("已记录（等连网）");
    expect(offlineCopy("zh-Hans").askNeedsNetwork).toBe("要连上网才能问。");
    for (const s of allOfflineStrings()) expect(judgementHits(s), s).toEqual([]);
  });
});
