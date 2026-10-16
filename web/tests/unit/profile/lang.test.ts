/**
 * The 「中/EN」 link of track C's screens (GET /api/profile/lang): sets rp_lang and goes back to the same screen; never
 * anywhere off this site. Owner's decision of 2026-10-14: for someone signed in it also keeps the choice on the account
 * (and on his own space), and the redirect never fails with that write.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/profile/lang/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { langHref, safeNext } from "@/lib/profile/copy";
import { getMemoryStore } from "@/lib/store/memory";

describe("the language switch", () => {
  it("sets the cookie and returns to the screen", async () => {
    const res = await GET(new NextRequest("http://localhost/api/profile/lang?to=en&next=%2Fp%2Fquestions%2Fanswered"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost/p/questions/answered");
    expect(res.headers.get("set-cookie")).toMatch(/^rp_lang=en;/);
  });

  it("only goes to a path on this site", async () => {
    for (const bad of ["https://evil.example/", "//evil.example/x", "/\\evil", "javascript:alert(1)", "", null]) expect(safeNext(bad)).toBe("/p/today");
    expect(safeNext("/onboard/habits?return=/p/profile")).toBe("/onboard/habits?return=/p/profile");
    const res = await GET(new NextRequest("http://localhost/api/profile/lang?to=zh-Hans&next=https%3A%2F%2Fevil.example"));
    expect(res.headers.get("location")).toBe("http://localhost/p/today");
    expect(res.headers.get("set-cookie")).toMatch(/^rp_lang=zh-Hans;/);
  });

  it("the link names the other language", () => {
    expect(langHref("zh-Hans", "/p/me")).toBe("/api/profile/lang?to=en&next=%2Fp%2Fme");
    expect(langHref("en", "/p/me")).toBe("/api/profile/lang?to=zh-Hans&next=%2Fp%2Fme");
  });
});

describe("the language switch keeps the choice for someone signed in", () => {
  const store = getMemoryStore();
  const PASSWORD = "a long test password";
  const make = (space: "blank" | "none") => createAccountWithSpace(store, getAuthProvider(), { login: `lg${randomUUID().slice(0, 9)}`, password: PASSWORD, space, locale: "zh-Hans" });
  const tap = (to: string, cookie: string, headers: Record<string, string> = {}) =>
    GET(new NextRequest(`http://localhost/api/profile/lang?to=${to}&next=%2Fp%2Fbp%3Fwhen%3Dmorning`, { headers: { cookie, ...headers } }));
  const went = (res: Response, to: string) => {
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost/p/bp?when=morning");
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`^rp_lang=${to};`));
  };

  afterEach(() => vi.restoreAllMocks());

  it("an elder: his account and his own space, as 「我 › 语言」 writes them; and back again", async () => {
    const him = await make("blank");
    const cookie = `rp_at=${him.tokens.access_token}`;
    went(await tap("en", cookie), "en");
    expect((await store.getAccount(him.userId))?.locale).toBe("en");
    expect((await store.getSession(him.userId))?.settings?.locale).toBe("en");
    went(await tap("zh-Hans", cookie), "zh-Hans");
    expect((await store.getAccount(him.userId))?.locale).toBe("zh-Hans");
    expect((await store.getSession(him.userId))?.settings?.locale).toBe("zh-Hans");
  });

  it("a family member has no space: her account alone", async () => {
    const her = await make("none");
    went(await tap("en", `rp_at=${her.tokens.access_token}`), "en");
    expect((await store.getAccount(her.userId))?.locale).toBe("en");
    expect(await store.getSession(her.userId)).toBeNull();
  });

  it("nothing is written without a sign-in, for a link from another site, or when no language is named", async () => {
    const him = await make("blank");
    const cookie = `rp_at=${him.tokens.access_token}`;
    const unchanged = async () => {
      expect((await store.getAccount(him.userId))?.locale).toBe("zh-Hans");
      expect((await store.getSession(him.userId))?.settings?.locale).not.toBe("en");
    };
    // a token that is nobody's: the cookie only, as for a stranger
    went(await tap("en", "rp_at=not-a-token"), "en");
    await unchanged();
    // another site sent the browser here: this browser's cookie changes (as it always did), his account does not
    went(await tap("en", cookie, { "sec-fetch-site": "cross-site" }), "en");
    await unchanged();
    // no language named (every signed-in GET scan calls the route like this): 华语 in the cookie, nothing kept
    const res = await GET(new NextRequest("http://localhost/api/profile/lang?locale=en", { headers: { cookie } }));
    expect(res.status).toBe(303);
    expect(res.headers.get("set-cookie")).toMatch(/^rp_lang=zh-Hans;/);
    await unchanged();
  });

  it("a write that fails does not fail the redirect: the cookie stands", async () => {
    const him = await make("blank");
    vi.spyOn(store, "updateAccount").mockRejectedValue(new Error("the store is away"));
    const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    went(await tap("en", `rp_at=${him.tokens.access_token}`), "en");
    expect(warned).toHaveBeenCalled();
    vi.restoreAllMocks();
    expect((await store.getAccount(him.userId))?.locale).toBe("zh-Hans");
  });
});
