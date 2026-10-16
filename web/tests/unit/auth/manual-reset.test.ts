/**
 * The team's manual password reset (lib/auth/manual-reset.ts, scripts/auth/reset-password.ts; track A; real-app 3.6
 * 「人工重设第一期不对外提供……只给团队自己的测试账号和拍摄账号用，留 account_event」): only a filming account or a login the
 * operator named; the usual password rules; every session ended; an account event; the Today line says the team did it.
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { allowedLogins, manualPasswordReset } from "@/lib/auth/manual-reset";
import { MemoryAuthProvider } from "@/lib/auth/memory";
import { passwordResetNotice } from "@/lib/auth/notices";
import { MemoryStore } from "@/lib/store/memory";

const PASSWORD = "a long test password";
const NEW_PASSWORD = "harbour lights 77";

async function world() {
  const store = new MemoryStore();
  const auth = new MemoryAuthProvider();
  const login = `m${randomUUID().slice(0, 10)}`;
  const a = await createAccountWithSpace(store, auth, { login, password: PASSWORD, space: "example" });
  return { store, auth, login, a };
}

describe("the team's manual reset", () => {
  it("an ordinary account is refused: this is not a way in for anyone who asks", async () => {
    const w = await world();
    expect(await manualPasswordReset({ store: w.store, auth: w.auth, env: {} }, { login: w.login, password: NEW_PASSWORD })).toEqual({ ok: false, error: "not_allowed" });
    expect(await w.auth.checkPassword(`${w.login}@users.ripple.invalid`, PASSWORD)).toBe(true);
    expect((await w.store.listAccountEvents(w.a.userId)).some((e) => e.kind === "password_reset")).toBe(false);
    expect(await manualPasswordReset({ store: w.store, auth: w.auth, env: {} }, { login: "nobody-here-9", password: NEW_PASSWORD })).toEqual({ ok: false, error: "not_found" });
    expect(await manualPasswordReset({ store: w.store, auth: w.auth, env: {} }, { login: "not a login!", password: NEW_PASSWORD })).toEqual({ ok: false, error: "bad_login" });
  });

  it("a login the operator named: the new password, every session ended, an event, and the Today line", async () => {
    const w = await world();
    const env = { RIPPLE_MANUAL_RESET_LOGINS: ` other.one , ${w.login.toUpperCase()} ` };
    expect(allowedLogins(env)).toEqual(["other.one", w.login]);
    expect(await manualPasswordReset({ store: w.store, auth: w.auth, env }, { login: w.login, password: "12345678" })).toEqual({ ok: false, error: "password_common" });
    expect(await manualPasswordReset({ store: w.store, auth: w.auth, env }, { login: w.login, password: w.login })).toMatchObject({ ok: false });
    const r = await manualPasswordReset({ store: w.store, auth: w.auth, env }, { login: w.login, password: NEW_PASSWORD });
    expect(r).toEqual({ ok: true, login: w.login, sessionsEnded: 1 });
    expect(await w.auth.checkPassword(`${w.login}@users.ripple.invalid`, NEW_PASSWORD)).toBe(true);
    expect(await w.auth.checkPassword(`${w.login}@users.ripple.invalid`, PASSWORD)).toBe(false);
    expect((await w.auth.listSessions(w.a.userId)).every((s) => !!s.ended_at)).toBe(true);
    const events = await w.store.listAccountEvents(w.a.userId);
    expect(events.filter((e) => e.kind === "password_reset").map((e) => e.detail)).toEqual([{ method: "manual", by: "team" }]);
    expect(JSON.stringify(events)).not.toContain(NEW_PASSWORD);
    expect(passwordResetNotice(events, Date.now(), "zh-Hans")).toMatchObject({ method: "manual", text: expect.stringMatching(/^你的密码在 .+ 由 Ripple 团队重设。$/) });
    expect(passwordResetNotice(events, Date.now(), "en")?.text).toMatch(/^Your password was reset by the Ripple team on /);
  });

  it("a filming account needs no naming", async () => {
    const w = await world();
    const scope = (await w.store.getSession(w.a.userId))!;
    expect(scope.filming).toBe(false);
    await w.store.setFilmingAccount(w.a.userId, true);
    expect((await w.store.getSession(w.a.userId))!.filming).toBe(true);
    expect(await manualPasswordReset({ store: w.store, auth: w.auth, env: {} }, { login: w.login, password: NEW_PASSWORD })).toMatchObject({ ok: true });
  });

  it("the script takes the password from the environment and never prints it", () => {
    const script = readFileSync(path.join(process.cwd(), "scripts", "auth", "reset-password.ts"), "utf8");
    expect(script).toContain("process.env.RIPPLE_NEW_PASSWORD");
    expect(script).not.toMatch(/process\.argv\[3\]/);
    // the password variable is handed to the reset and to nothing else: never written out, never logged
    const code = script.slice(script.indexOf("*/") + 2);
    expect(code.match(/[^\w-]password\b/g)).toHaveLength(3); // its declaration, the usage check, the call
    expect(code).not.toMatch(/\$\{[^}]*\bpassword\b/);
    expect(code).not.toMatch(/console\./);
  });

  it("nothing a browser can reach imports it: only the script does", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (/\.(ts|tsx)$/.test(entry.name) && /manual-reset/.test(readFileSync(file, "utf8"))) hits.push(path.relative(process.cwd(), file).split(path.sep).join("/"));
      }
    };
    // every route and page lives under app/, every client piece under components/
    for (const root of ["app", "components"]) walk(path.join(process.cwd(), root));
    expect(hits).toEqual([]);
  }, 30_000);
});
