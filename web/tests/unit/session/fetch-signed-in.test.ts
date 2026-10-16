/**
 * fetchSignedIn and a sign-in whose cookies are gone (real-app 2.25 「登录过期、刷新失败：跳 /login?next=」).
 *
 * With no cookie at all the server finds nobody and answers 400 no_session, not 401 not_signed_in. On a phone that has
 * an account (the owner tag its pages keep) that is an ended sign-in: one refresh, then the login page, coming back to
 * the same page. A judge's sandbox phone has no tag and the demo's calls name their session: both keep the plain answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OWNER_KEY } from "@/lib/offline/client";
import { ACCOUNT_ON_THIS_PHONE_KEY, fetchSignedIn, withSession } from "@/lib/session/client";

const answer = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } });

let stored: Record<string, string>;
let assign: ReturnType<typeof vi.fn>;
let calls: string[];

function serve(byPath: Record<string, () => Response>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      calls.push(input);
      const path = input.split("?")[0];
      return (byPath[path] ?? (() => answer(404, "not_found")))();
    }),
  );
}

/** the shared refresh is forgotten on the next timer turn: let it pass, so one test never reuses another's */
const settle = () => new Promise((r) => setTimeout(r, 5));

beforeEach(() => {
  stored = {};
  calls = [];
  assign = vi.fn();
  vi.stubGlobal("window", {
    location: { pathname: "/p/bp", search: "?part=evening", assign },
    localStorage: { getItem: (k: string) => stored[k] ?? null },
  });
});

afterEach(async () => {
  await settle();
  vi.unstubAllGlobals();
});

describe("a call whose sign-in cookies are gone", () => {
  it("the key read here is the one the account's pages write", () => {
    expect(ACCOUNT_ON_THIS_PHONE_KEY).toBe(OWNER_KEY);
  });

  it("on a phone that has an account: one refresh, then the login page with the way back", async () => {
    stored[OWNER_KEY] = "tag-of-his-account";
    serve({ "/api/bp": () => answer(400, "no_session"), "/api/auth/refresh": () => answer(401, "not_signed_in") });
    const res = await fetchSignedIn("/api/bp", { method: "POST", body: "{}" });
    expect(res.status).toBe(400); // the answer still reaches the caller's own error state
    expect(calls).toEqual(["/api/bp", "/api/auth/refresh"]);
    expect(assign).toHaveBeenCalledWith(`/login?next=${encodeURIComponent("/p/bp?part=evening")}`);
  });

  it("the refresh brought the sign-in back: the call is tried once more and nothing leaves the page", async () => {
    stored[OWNER_KEY] = "tag-of-his-account";
    let n = 0;
    serve({ "/api/bp": () => (n++ === 0 ? answer(400, "no_session") : new Response("{}", { status: 200 })), "/api/auth/refresh": () => new Response("{}", { status: 200 }) });
    const res = await fetchSignedIn("/api/bp", { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["/api/bp", "/api/auth/refresh", "/api/bp"]);
    expect(assign).not.toHaveBeenCalled();
  });

  it("a sandbox phone (no account was ever on it) keeps the plain answer", async () => {
    serve({ "/api/ask": () => answer(400, "no_session") });
    const res = await fetchSignedIn("/api/ask", { method: "POST", body: "{}" });
    expect(res.status).toBe(400);
    expect(calls).toEqual(["/api/ask"]);
    expect(assign).not.toHaveBeenCalled();
  });

  it("a call that names its session is the demo's: never sent to the login, account on the phone or not", async () => {
    stored[OWNER_KEY] = "tag-of-his-account";
    serve({ "/api/ask": () => answer(400, "no_session") });
    const res = await fetchSignedIn(withSession("/api/ask", "sandbox-1"), { method: "POST", body: "{}" });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it("another 400 is the page's ordinary refusal", async () => {
    stored[OWNER_KEY] = "tag-of-his-account";
    serve({ "/api/bp": () => answer(400, "bad_reading") });
    const res = await fetchSignedIn("/api/bp", { method: "POST", body: "{}" });
    expect(res.status).toBe(400);
    expect(calls).toEqual(["/api/bp"]);
    expect(assign).not.toHaveBeenCalled();
  });

  it("401 not_signed_in is handled as before, with or without the tag", async () => {
    serve({ "/api/bp": () => answer(401, "not_signed_in"), "/api/auth/refresh": () => answer(401, "not_signed_in") });
    await fetchSignedIn("/api/bp", { method: "POST", body: "{}" });
    expect(calls).toEqual(["/api/bp", "/api/auth/refresh"]);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("a browser that refuses storage is treated as a phone without an account", async () => {
    vi.stubGlobal("window", {
      location: { pathname: "/p/bp", search: "", assign },
      get localStorage(): Storage {
        throw new Error("storage refused");
      },
    });
    serve({ "/api/bp": () => answer(400, "no_session") });
    const res = await fetchSignedIn("/api/bp", { method: "POST", body: "{}" });
    expect(res.status).toBe(400);
    expect(assign).not.toHaveBeenCalled();
  });
});
