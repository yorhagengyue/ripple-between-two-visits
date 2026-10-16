/**
 * The project's signing key changes and nobody restarts the server (docs/plan/real-app.md 8.2 「单元 auth/jwt」, line 1384:
 * 「JWKS 换了 kid 自动刷新一次」; 3.4 验签). This file guards the key set the Supabase provider verifies against
 * (lib/auth/gotrue.ts keySet, used by lib/auth/jwt.ts verifyAccessToken for every request: lib/subject/resolve.ts,
 * proxy.ts), with a stand-in for GoTrue's <SUPABASE_URL>/auth/v1/.well-known/jwks.json that counts every fetch:
 *
 *   - a token signed with the project's key verifies, and the key set is fetched once, not once per request;
 *   - after a rotation (kid a -> kid b) the first token with the new kid refreshes the key set exactly once and
 *     verifies; later tokens with kid b fetch nothing;
 *   - a token signed with the old key after it left the key set is refused;
 *   - a token with a kid the project never had (kid c) is refused, and such tokens cannot make the server fetch without
 *     bound: at most one refresh per cool-down, however many arrive, one after another or at once.
 *
 * The recorded rule this follows (the code, lib/auth/gotrue.ts keySet; web/progress/a.md records nothing about it):
 * jose's createRemoteJWKSet with cooldownDuration 30 s and cacheMaxAge 10 min. An unknown kid refreshes the key set only
 * when the last fetch is at least 30 s old. That is what bounds the fetches, and it has another side, asserted in the
 * last test as the code's behaviour: a key published less than 30 s after the server last fetched the set is not seen
 * until those 30 s are over, so a token signed with it is refused ("bad_signature", which the app treats as not signed
 * in) for up to 30 s and then verifies. The design's sentence does not say how soon the one refresh happens.
 *
 * Time: jose and verifyAccessToken both read Date.now() (lib/time/now.ts realNowMs), so the tests move a faked Date.
 * No network: global fetch is stubbed. tests/unit/auth/gotrue.test.ts has the one-key case (verifies, one fetch).
 */
import { randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GoTrueAuthProvider } from "@/lib/auth";
import { verifyAccessToken } from "@/lib/auth/jwt";

/** lib/auth/gotrue.ts keySet: an unknown kid refetches only when the last fetch is this old. */
const COOL_DOWN_MS = 30_000;
/** lib/auth/gotrue.ts keySet: the key set is fetched again after this long whatever the kid. */
const CACHE_MAX_AGE_MS = 10 * 60_000;
const T0 = Date.parse("2026-10-10T02:00:00.000Z");

interface Key {
  kid: string;
  privateKey: CryptoKey;
  jwk: JWK;
}
async function makeKey(kid: string): Promise<Key> {
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  return { kid, privateKey, jwk: { ...(await exportJWK(publicKey)), kid, alg: "ES256", use: "sig" } };
}

let A: Key;
let B: Key;
/** a key the project never published, under a kid it does not have */
let C: Key;
/** a stranger's key that claims the project's kid a */
let forgedA: Key;

beforeAll(async () => {
  [A, B, C, forgedA] = await Promise.all([makeKey("kid-a"), makeKey("kid-b"), makeKey("kid-c"), makeKey("kid-a")]);
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: T0 });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

/** One project: its base URL (a new one each time: the key sets are kept per project URL for the whole process), its JWKS endpoint, its provider. */
function project(keys: Key[]) {
  const base = `https://p${randomUUID().slice(0, 8)}.example.test`;
  const state = { keys, fetched: [] as string[] };
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    state.fetched.push(String(input instanceof Request ? input.url : input));
    return new Response(JSON.stringify({ keys: state.keys.map((k) => k.jwk) }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const provider = () => new GoTrueAuthProvider({ url: base, serviceKey: "service-key", anonKey: "anon-key" });
  const p = provider();
  /** An access token of this project signed with `key`, issued now, good for 15 minutes. */
  const token = (key: Key): Promise<string> => {
    const s = Math.floor(Date.now() / 1000);
    return new SignJWT({ aud: "authenticated", role: "authenticated", session_id: randomUUID(), is_anonymous: false, email: "tan@users.ripple.invalid" })
      .setProtectedHeader({ alg: "ES256", kid: key.kid, typ: "JWT" })
      .setIssuer(`${base}/auth/v1`)
      .setSubject(randomUUID())
      .setIssuedAt(s)
      .setExpirationTime(s + 900)
      .sign(key.privateKey);
  };
  /** What a request does with its token (lib/subject/resolve.ts signedInUser): "ok" or the reason it is refused. */
  const check = async (t: string, by: GoTrueAuthProvider = p): Promise<string> => {
    const r = await verifyAccessToken(t, { keys: await by.keySet(), issuer: by.issuer() });
    return r.ok ? "ok" : r.reason;
  };
  return { base, state, provider, token, check, url: `${base}/auth/v1/.well-known/jwks.json` };
}

describe("the key set is fetched once, not once per request", () => {
  it("six tokens signed with the project's key: all verify, one fetch of <url>/auth/v1/.well-known/jwks.json", async () => {
    const w = project([A]);
    expect(await w.check(await w.token(A))).toBe("ok");
    expect(w.state.fetched).toEqual([w.url]);
    for (let i = 0; i < 5; i++) {
      advance(1000);
      expect(await w.check(await w.token(A)), String(i)).toBe("ok");
    }
    // another provider object for the same project in the same process shares the key set
    expect(await w.check(await w.token(A), w.provider())).toBe("ok");
    expect(w.state.fetched).toEqual([w.url]);
    // a stranger's key under the project's own kid is refused without a fetch (the kid is known, the signature is not)
    expect(await w.check(await w.token(forgedA))).toBe("bad_signature");
    expect(w.state.fetched).toHaveLength(1);
  });

  it("the cached set is good for ten minutes, then the next request fetches it again (once)", async () => {
    const w = project([A]);
    expect(await w.check(await w.token(A))).toBe("ok");
    advance(CACHE_MAX_AGE_MS - 1);
    expect(await w.check(await w.token(A))).toBe("ok");
    expect(w.state.fetched).toHaveLength(1);
    advance(1);
    expect(await w.check(await w.token(A))).toBe("ok");
    expect(await w.check(await w.token(A))).toBe("ok");
    expect(w.state.fetched).toEqual([w.url, w.url]);
  });
});

describe("the project rotates its key: kid a, then kid b", () => {
  it("the first token with the new kid refreshes the key set exactly once and verifies; later ones fetch nothing", async () => {
    const w = project([A]);
    const old = await w.token(A);
    expect(await w.check(old)).toBe("ok");
    expect(w.state.fetched).toHaveLength(1);

    advance(COOL_DOWN_MS + 1000);
    w.state.keys = [B]; // the rotation: the endpoint now serves key B only
    expect(await w.check(await w.token(B))).toBe("ok");
    expect(w.state.fetched).toEqual([w.url, w.url]); // one refresh
    for (let i = 0; i < 5; i++) {
      advance(1000);
      expect(await w.check(await w.token(B)), String(i)).toBe("ok");
    }
    expect(await w.check(await w.token(B), w.provider())).toBe("ok");
    expect(w.state.fetched).toHaveLength(2); // not one per request

    // a token signed with A after A left the key set: refused, the one issued before the rotation and a new one alike
    expect(await w.check(old)).toBe("bad_signature");
    expect(await w.check(await w.token(A))).toBe("bad_signature");
    expect(w.state.fetched).toHaveLength(2);
    // still refused once the server looks again (one more fetch: A is really gone)
    advance(COOL_DOWN_MS);
    expect(await w.check(await w.token(A))).toBe("bad_signature");
    expect(w.state.fetched).toHaveLength(3);
    expect(await w.check(await w.token(B))).toBe("ok");
    expect(w.state.fetched).toHaveLength(3);
  });

  it("while both keys are published, tokens of both verify; the old one stops when it leaves the set", async () => {
    const w = project([A]);
    expect(await w.check(await w.token(A))).toBe("ok");
    advance(COOL_DOWN_MS);
    w.state.keys = [A, B];
    expect(await w.check(await w.token(B))).toBe("ok");
    expect(await w.check(await w.token(A))).toBe("ok");
    expect(w.state.fetched).toHaveLength(2);
    // A is withdrawn; the server learns it with its next fetch (the ten-minute cache)
    w.state.keys = [B];
    advance(CACHE_MAX_AGE_MS);
    expect(await w.check(await w.token(A))).toBe("bad_signature");
    expect(await w.check(await w.token(B))).toBe("ok");
    expect(w.state.fetched).toHaveLength(3);
  });
});

describe("a kid the project never had (kid c)", () => {
  it("is refused, and sixty such tokens within 30 s cause two refreshes (one per cool-down), not sixty", async () => {
    const w = project([A]);
    expect(await w.check(await w.token(A))).toBe("ok");
    expect(w.state.fetched).toHaveLength(1);
    advance(COOL_DOWN_MS);
    const started = Date.now();
    // twenty one after another: the first one refreshes (the last fetch is 30 s old), the others are refused from the cache
    for (let i = 0; i < 20; i++) expect(await w.check(await w.token(C)), String(i)).toBe("bad_signature");
    expect(w.state.fetched).toHaveLength(2);
    // twenty more over the next 29 s: nothing is fetched
    for (let i = 0; i < 20; i++) {
      advance(1450);
      expect(await w.check(await w.token(C)), String(i)).toBe("bad_signature");
    }
    expect(Date.now() - started).toBe(29_000);
    expect(w.state.fetched).toHaveLength(2);
    // the project's own tokens are not disturbed by them
    expect(await w.check(await w.token(A))).toBe("ok");
    // the cool-down ends: twenty at once share one refresh
    advance(1000);
    const tokens = await Promise.all(Array.from({ length: 20 }, () => w.token(C)));
    expect(await Promise.all(tokens.map((t) => w.check(t)))).toEqual(Array.from({ length: 20 }, () => "bad_signature"));
    expect(w.state.fetched).toHaveLength(3);
    // sixty unknown-kid tokens in 30 s: two fetches because of them (one per cool-down), every one to the JWKS URL
    expect(w.state.fetched.every((u) => u === w.url)).toBe(true);
    expect(await w.check(await w.token(A))).toBe("ok");
    expect(w.state.fetched).toHaveLength(3);
  });
});

describe("the cool-down's other side (the code's rule: an unknown kid refreshes only when the last fetch is 30 s old)", () => {
  it("a key published 10 s after the last fetch: its tokens are refused without a fetch until the 30 s are over, then one refresh and they verify", async () => {
    const w = project([A]);
    expect(await w.check(await w.token(A))).toBe("ok");
    advance(10_000);
    w.state.keys = [A, B];
    const early = await w.token(B);
    expect(await w.check(early)).toBe("bad_signature");
    advance(COOL_DOWN_MS - 10_000 - 1); // 29.999 s after the fetch
    expect(await w.check(early)).toBe("bad_signature");
    expect(w.state.fetched).toHaveLength(1);
    advance(1); // 30 s after the fetch
    expect(await w.check(early)).toBe("ok");
    expect(w.state.fetched).toHaveLength(2);
    expect(await w.check(await w.token(B))).toBe("ok");
    expect(w.state.fetched).toHaveLength(2);
  });
});
