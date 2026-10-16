/**
 * The small parts of the account layer (track A): the password rule, recovery codes, the device cookie, where he goes
 * after signing in, the per-IP limits, the secrets and the deployment check.
 */
import { describe, expect, it } from "vitest";
import { authDeployProblems } from "@/lib/auth/boot";
import { isCommonPassword } from "@/lib/auth/common-passwords";
import { deviceHash, deviceLabel, deviceRef, isDeviceId, newDeviceId } from "@/lib/auth/device";
import { bucketKey, clientIp, DEV_LIMIT_FACTOR, hitLimit } from "@/lib/auth/limits";
import { parseLoginName } from "@/lib/auth/login-name";
import { destinationAfterSignIn, homeAfterSignIn, loginUrl, safeNext } from "@/lib/auth/next";
import { passwordProblem } from "@/lib/auth/passwords";
import { formatRecoveryCode, hashRecoveryCode, newRecoveryCode, normalizeRecoveryCode, RECOVERY_ALPHABET, recoveryCodeMatches } from "@/lib/auth/recovery";
import { authSecret, secretProblems } from "@/lib/auth/secrets";
import { MemoryStore } from "@/lib/store/memory";

describe("the password rule", () => {
  const login = (s: string) => {
    const p = parseLoginName(s);
    if (!p.ok) throw new Error(s);
    return p.login;
  };

  it("8 characters at least (a Chinese character is one), 72 bytes at most", () => {
    expect(passwordProblem("1234567")).toBe("password_short");
    expect(passwordProblem("七个中文字不够")).toBe("password_short");
    expect(passwordProblem("八个中文字就可以了")).toBeNull();
    expect(passwordProblem("a".repeat(73))).toBe("password_long");
    const han = (n: number) => Array.from({ length: n }, (_, i) => String.fromCodePoint(0x4e00 + i * 7)).join("");
    expect(passwordProblem(han(25))).toBe("password_long"); // 75 bytes
    expect(passwordProblem(han(24))).toBeNull(); // 72 bytes
    expect(passwordProblem("宽".repeat(24))).toBe("password_common"); // one character over and over
  });

  it("no composition rules, but not a common one, not a run, not the login", () => {
    expect(passwordProblem("plum blossom tea")).toBeNull();
    expect(passwordProblem("alllowercaseletters")).toBeNull();
    for (const p of ["12345678", "PASSWORD1", "woaini1314", "88888888", "abcdefgh", "87654321", "abababab", "ripple2026"]) expect(passwordProblem(p), p).toBe("password_common");
    expect(passwordProblem("chen.tan88", login("chen.tan88"))).toBe("password_like_login");
    expect(passwordProblem("CHEN.TAN88", login("chen.tan88"))).toBe("password_like_login");
    expect(passwordProblem("chen.tan@example.com", login("chen.tan@example.com"))).toBe("password_like_login");
    expect(passwordProblem("chen.tan", login("chen.tan@example.com"))).toBe("password_like_login");
    expect(passwordProblem("ｗｏａｉｎｉ１３１４")).toBe("password_common"); // full width is the same
    expect(isCommonPassword("a perfectly fine phrase")).toBe(false);
  });
});

describe("recovery codes", () => {
  it("12 symbols in three groups, no 0 O 1 I; every code different", () => {
    const codes = new Set(Array.from({ length: 200 }, () => newRecoveryCode()));
    expect(codes.size).toBe(200);
    for (const c of codes) {
      expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
      expect(c).not.toMatch(/[01OI]/);
    }
    expect(RECOVERY_ALPHABET).toHaveLength(32); // 5 bits a symbol, 60 bits a code
    expect(formatRecoveryCode("ABCDEFGHJKLM")).toBe("ABCD-EFGH-JKLM");
  });

  it("what he types: case, spaces and dashes do not matter; anything else is not a code", () => {
    expect(normalizeRecoveryCode("abcd efgh jklm")).toBe("ABCDEFGHJKLM");
    expect(normalizeRecoveryCode(" ABCD-EFGH-JKLM ")).toBe("ABCDEFGHJKLM");
    expect(normalizeRecoveryCode("ＡＢＣＤ－ＥＦＧＨ－ＪＫＬＭ")).toBe("ABCDEFGHJKLM");
    for (const bad of ["", "ABCD-EFGH-JKL", "ABCD-EFGH-JKLMN", "0BCD-EFGH-JKLM", "IBCD-EFGH-JKLM"]) expect(normalizeRecoveryCode(bad), bad).toBeNull();
  });

  it("only a salted, peppered hash is kept; it matches the code and nothing else", async () => {
    const env = { RECOVERY_PEPPER: "pepper-one-pepper-one-pepper-one-1" };
    const code = newRecoveryCode();
    const h1 = await hashRecoveryCode(code, env);
    const h2 = await hashRecoveryCode(code, env);
    expect(h1).not.toBe(h2); // salted
    expect(h1).not.toContain(code.replace(/-/g, ""));
    expect(await recoveryCodeMatches(code.toLowerCase(), h1, env)).toBe(true);
    expect(await recoveryCodeMatches(newRecoveryCode(), h1, env)).toBe(false);
    expect(await recoveryCodeMatches(code, h1, { RECOVERY_PEPPER: "another-pepper-another-pepper-xx" })).toBe(false);
    expect(await recoveryCodeMatches("not a code", h1, env)).toBe(false);
    expect(await recoveryCodeMatches(code, null, env)).toBe(false);
  });
});

describe("the device cookie", () => {
  it("a random id, kept only as a hash; the page names it by a short prefix", () => {
    const id = newDeviceId();
    expect(isDeviceId(id)).toBe(true);
    expect(isDeviceId("short")).toBe(false);
    expect(isDeviceId(`${id.slice(0, -1)}!`)).toBe(false);
    expect(deviceHash(id)).toMatch(/^[0-9a-f]{64}$/);
    expect(deviceHash(id)).not.toContain(id);
    expect(deviceRef(deviceHash(id))).toHaveLength(16);
  });

  it("a plain name from the User-Agent", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("iPhone · Safari");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36")).toBe("Android · Chrome");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0")).toBe("Windows · Edge");
    expect(deviceLabel("Mozilla/5.0 (iPhone) AppleWebKit Mobile MicroMessenger/8.0")).toBe("iPhone · WeChat");
    expect(deviceLabel("curl/8.4")).toBeNull();
    expect(deviceLabel(null)).toBeNull();
  });
});

describe("where he goes after signing in", () => {
  it("only a path on this site, never the sign-in pages or an API", () => {
    expect(safeNext("/p/today")).toBe("/p/today");
    expect(safeNext("/p/bp?remind=bp")).toBe("/p/bp?remind=bp");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil", "p/today", "/login", "/login?next=/p", "/signup", "/recover", "/api/me", "/p/\u0007", 42, null])
      expect(safeNext(bad), String(bad)).toBeNull();
  });

  it("home: today, the onboarding, or (no space of his own) the family page; a /p page needs a finished space", () => {
    expect(homeAfterSignIn({ onboarding: "done" })).toBe("/p/today");
    expect(homeAfterSignIn({ onboarding: "started" })).toBe("/onboard");
    expect(homeAfterSignIn({ onboarding: null })).toBe("/onboard");
    expect(homeAfterSignIn(null)).toBe("/f");
    expect(destinationAfterSignIn("/p/bp", { onboarding: "done" })).toBe("/p/bp");
    expect(destinationAfterSignIn("/p/bp", { onboarding: "started" })).toBe("/onboard");
    expect(destinationAfterSignIn("/p/bp", null)).toBe("/f");
    expect(destinationAfterSignIn("/invite/abc", null)).toBe("/invite/abc");
    expect(loginUrl("/p/today")).toBe("/login?next=%2Fp%2Ftoday");
    expect(loginUrl("https://evil.example")).toBe("/login");
  });
});

describe("per-IP limits", () => {
  it("count in a window and refuse once over; 100 times looser with the developer tools on; keys never show the IP", async () => {
    const store = new MemoryStore();
    const prod = { NODE_ENV: "production" };
    for (let i = 0; i < 3; i++) expect(await hitLimit(store, "a:x:prod", { windowS: 60, limit: 3 }, prod)).toEqual({ ok: true });
    expect(await hitLimit(store, "a:x:prod", { windowS: 60, limit: 3 }, prod)).toMatchObject({ ok: false });
    for (let i = 0; i < 3 * DEV_LIMIT_FACTOR; i++) expect((await hitLimit(store, "a:x:dev", { windowS: 60, limit: 3 }, { NODE_ENV: "test" })).ok).toBe(true);
    expect((await hitLimit(store, "a:x:dev", { windowS: 60, limit: 3 }, { NODE_ENV: "test" })).ok).toBe(false);
    const key = bucketKey("ip", "203.0.113.9");
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain("203");
    expect(bucketKey("ip", "203.0.113.9", { RATE_LIMIT_SALT: "s".repeat(40) })).not.toBe(key);
  });

  it("the client address: nothing a client sends is believed by itself (track L, lib/guard/client-ip.ts)", () => {
    // was: the first forwarded hop, then X-Real-IP. Now only what our own proxy saw (tests/unit/guard/client-ip.test.ts)
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("local");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.4" }))).toBe("local");
    expect(clientIp(new Headers())).toBe("local");
  });
});

describe("secrets and the deployment check", () => {
  const good = { AUTH_COOKIE_SECRET: "c".repeat(40), RATE_LIMIT_SALT: "s".repeat(40), RECOVERY_PEPPER: "p".repeat(40) };
  const supa = { AUTH_PROVIDER: "supabase", SUPABASE_URL: "https://x.example.test", SUPABASE_SERVICE_KEY: "k", SUPABASE_ANON_KEY: "a" };

  it("off a deployment a development value stands in, and nothing is a problem", () => {
    expect(authSecret("AUTH_COOKIE_SECRET", {})).toMatch(/dev-only/);
    expect(authSecret("AUTH_COOKIE_SECRET", { AUTH_COOKIE_SECRET: " mine " })).toBe("mine");
    expect(secretProblems({})).toEqual([]);
    expect(authDeployProblems({ AUTH_PROVIDER: "memory", RIPPLE_DEV_TOOLS: "1" })).toEqual([]);
  });

  it("a deployment needs all three secrets, long and not the development value; no test clock; Supabase complete", () => {
    expect(authDeployProblems({ RIPPLE_DEPLOYED: "1", ...supa, ...good })).toEqual([]);
    expect(authDeployProblems({ RIPPLE_DEPLOYED: "1", ...supa })).toEqual(["AUTH_COOKIE_SECRET is not set", "RATE_LIMIT_SALT is not set", "RECOVERY_PEPPER is not set"]);
    expect(authDeployProblems({ RIPPLE_DEPLOYED: "1", ...supa, ...good, RATE_LIMIT_SALT: "short" })).toEqual(["RATE_LIMIT_SALT is shorter than 32 characters"]);
    expect(authDeployProblems({ RIPPLE_DEPLOYED: "1", ...supa, ...good, RECOVERY_PEPPER: authSecret("RECOVERY_PEPPER", {}) })).toEqual(["RECOVERY_PEPPER is the development value"]);
    expect(authDeployProblems({ RIPPLE_DEPLOYED: "1", ...supa, ...good, RIPPLE_TEST_CLOCK: "1" })).toEqual(["RIPPLE_TEST_CLOCK is set (the test clock is a developer tool)"]);
    expect(authDeployProblems({ RIPPLE_DEPLOYED: "1", AUTH_PROVIDER: "supabase", ...good })).toEqual([
      "SUPABASE_URL is not set (AUTH_PROVIDER=supabase)",
      "SUPABASE_SERVICE_KEY is not set (AUTH_PROVIDER=supabase)",
      "SUPABASE_ANON_KEY is not set (AUTH_PROVIDER=supabase)",
    ]);
    // the foundation's rules come along: memory and the developer tools are refused
    const mem = authDeployProblems({ RIPPLE_DEPLOYED: "1", AUTH_PROVIDER: "memory", RIPPLE_DEV_TOOLS: "1", ...good });
    expect(mem.join(" ")).toMatch(/RIPPLE_DEV_TOOLS=1/);
    expect(mem.join(" ")).toMatch(/AUTH_PROVIDER=memory/);
  });
});

describe("the line after a password reset (for his today page)", () => {
  const ev = (kind: string, at: string, detail: Record<string, unknown> = {}) => ({ id: `evt-${kind}-${at}`, user_id: "u", kind, detail, created_at: at });
  const NOW = Date.parse("2026-10-10T02:00:00Z");

  it("after a recovery-code reset: the day and time of the latest reset, for three days at most", async () => {
    const { passwordResetNotice } = await import("@/lib/auth/notices");
    const reset = ev("password_reset", "2026-10-09T12:15:00.000Z", { method: "recovery_code" });
    const events = [ev("signup", "2026-10-01T02:00:00.000Z"), reset, ev("logout_everywhere", "2026-10-09T12:20:00.000Z")];
    expect(passwordResetNotice(events, NOW, "zh-Hans")).toEqual({
      event: reset.id,
      method: "recovery_code",
      text: "你的密码在 10月9日 20:15 用恢复码重设过。",
      hint: "如果不是你自己做的，请到「我」里改密码。",
      ok: "知道了",
    });
    expect(passwordResetNotice(events, NOW, "en")?.text).toBe("Your password was reset with the recovery code on 9 Oct 20:15.");
    expect(passwordResetNotice(events, Date.parse("2026-10-13T02:00:00Z"), "zh-Hans")).toBeNull();
    expect(passwordResetNotice([ev("signup", "2026-10-09T12:15:00.000Z")], NOW, "zh-Hans")).toBeNull();
  });

  it("after a family-assisted reset it names who helped (the name he gave her; 「家人」 without one)", async () => {
    const { passwordResetNotice } = await import("@/lib/auth/notices");
    const reset = ev("password_reset", "2026-10-09T12:15:00.000Z", { method: "family_assisted", link_id: "l1", helper: "Wei Ling" });
    expect(passwordResetNotice([reset], NOW, "zh-Hans")).toMatchObject({ method: "family_assisted", text: "你的密码在 10月9日 20:15 由 Wei Ling 协助重设。" });
    expect(passwordResetNotice([reset], NOW, "en")?.text).toBe("Your password was reset on 9 Oct 20:15 with help from Wei Ling.");
    const unnamed = ev("password_reset", "2026-10-09T12:15:00.000Z", { method: "family_assisted", link_id: "l1", helper: null });
    expect(passwordResetNotice([unnamed], NOW, "zh-Hans")?.text).toBe("你的密码在 10月9日 20:15 由 家人 协助重设。");
    expect(passwordResetNotice([unnamed], NOW, "en")?.text).toBe("Your password was reset on 9 Oct 20:15 with help from a family member.");
  });

  it("is said once: gone after 「知道了」 for that reset; a later reset is a new line", async () => {
    const { passwordResetNotice, RESET_NOTICE_SEEN } = await import("@/lib/auth/notices");
    const first = ev("password_reset", "2026-10-09T12:15:00.000Z", { method: "recovery_code" });
    const seen = ev(RESET_NOTICE_SEEN, "2026-10-09T13:00:00.000Z", { event: first.id });
    expect(passwordResetNotice([first, seen], NOW, "zh-Hans")).toBeNull();
    // acknowledging another reset does not hide this one
    expect(passwordResetNotice([first, ev(RESET_NOTICE_SEEN, "2026-10-09T13:00:00.000Z", { event: "evt-other" })], NOW, "zh-Hans")).not.toBeNull();
    const second = ev("password_reset", "2026-10-09T23:30:00.000Z", { method: "family_assisted", helper: "Wei Ling" });
    expect(passwordResetNotice([first, seen, second], NOW, "zh-Hans")).toMatchObject({ event: second.id, method: "family_assisted" });
  });
});
