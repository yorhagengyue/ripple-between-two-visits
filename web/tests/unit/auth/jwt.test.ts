/**
 * Checking an access token (lib/auth/jwt.ts; C2 F1 item F, real-app 3.4 验签): ES256 against the provider's keys, the
 * issuer, aud "authenticated", exp and nbf with 30 s of slack, role "authenticated", a uuid subject, never an anonymous
 * user. "none", HS256 and every other algorithm are refused before a key is looked at. A bad token is a reason, never
 * an exception.
 */
import { randomUUID } from "node:crypto";
import { base64url, createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { MEMORY_ISSUER, MemoryAuthProvider } from "@/lib/auth";
import { CLOCK_TOLERANCE_S, secondsLeft, verifyAccessToken } from "@/lib/auth/jwt";
import { setTestClock } from "@/lib/time/now";

const ISS = "https://project.example.test/auth/v1";
const KID = "key-1";
let privateKey: CryptoKey;
let strangerKey: CryptoKey;
let keys: JWTVerifyGetKey;
const sub = randomUUID();
const nowS = () => Math.floor(Date.now() / 1000);

beforeAll(async () => {
  const mine = await generateKeyPair("ES256", { extractable: true });
  privateKey = mine.privateKey;
  strangerKey = (await generateKeyPair("ES256")).privateKey;
  keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(mine.publicKey)), kid: KID, alg: "ES256", use: "sig" }] });
});
afterEach(() => setTestClock(null));

function claims(over: JWTPayload = {}, omit: string[] = []): JWTPayload {
  const c: JWTPayload = {
    iss: ISS,
    aud: "authenticated",
    role: "authenticated",
    sub,
    email: "him@example.test",
    session_id: randomUUID(),
    is_anonymous: false,
    iat: nowS(),
    exp: nowS() + 900,
    ...over,
  };
  for (const k of omit) delete c[k];
  return c;
}

async function es256(over: JWTPayload = {}, opts: { omit?: string[]; key?: CryptoKey; kid?: string } = {}): Promise<string> {
  return new SignJWT(claims(over, opts.omit)).setProtectedHeader({ alg: "ES256", kid: opts.kid ?? KID, typ: "JWT" }).sign(opts.key ?? privateKey);
}

const verify = (token: string | null | undefined) => verifyAccessToken(token, { keys, issuer: ISS });
const reason = async (token: string | null | undefined) => {
  const r = await verify(token);
  return r.ok ? "ok" : r.reason;
};

describe("a good token", () => {
  it("verifies and gives the user id, the provider session and the address", async () => {
    const r = await verify(await es256({ session_id: "s-1" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.token).toMatchObject({ sub, sessionId: "s-1", email: "him@example.test" });
  });

  it("exp and nbf get 30 s of slack, no more", async () => {
    expect(CLOCK_TOLERANCE_S).toBe(30);
    expect(await reason(await es256({ exp: nowS() - 20 }))).toBe("ok");
    expect(await reason(await es256({ nbf: nowS() + 20 }))).toBe("ok");
    expect(await reason(await es256({ exp: nowS() - 45 }))).toBe("expired");
    expect(await reason(await es256({ nbf: nowS() + 45 }))).toBe("not_yet_valid");
  });

  it("is checked against the real clock, never the developer test clock (moving the story days ahead signs nobody out)", async () => {
    const token = await es256();
    setTestClock({ offsetMs: 3 * 24 * 3600 * 1000 });
    expect(await reason(token)).toBe("ok");
    setTestClock({ offsetMs: -3600 * 1000 });
    expect(await reason(token)).toBe("ok");
  });
});

describe("refused tokens", () => {
  it("nothing, or not a JWT", async () => {
    expect(await reason(undefined)).toBe("missing");
    expect(await reason(null)).toBe("missing");
    expect(await reason("")).toBe("missing");
    expect(await reason("not-a-token")).toBe("malformed");
    expect(await reason("a.b.c")).toBe("malformed");
    const good = await es256();
    expect(await reason(good.split(".").slice(0, 2).join("."))).toBe("malformed");
  });

  it('alg "none" (an unsigned token) is refused before any key is looked at', async () => {
    const enc = (o: object) => base64url.encode(new TextEncoder().encode(JSON.stringify(o)));
    for (const header of [{ alg: "none", typ: "JWT" }, { alg: "None" }, { alg: "NONE" }, { typ: "JWT" }]) {
      expect(await reason(`${enc(header)}.${enc(claims())}.`), JSON.stringify(header)).toBe("bad_alg");
    }
  });

  it("HS256 (a shared secret anyone holding it could mint with) and every algorithm but ES256", async () => {
    const secret = new TextEncoder().encode("the project's legacy JWT secret, long enough for HS256");
    const hs = await new SignJWT(claims()).setProtectedHeader({ alg: "HS256", typ: "JWT" }).sign(secret);
    expect(await reason(hs)).toBe("bad_alg");
    const es384 = await new SignJWT(claims()).setProtectedHeader({ alg: "ES384", kid: KID }).sign((await generateKeyPair("ES384")).privateKey);
    expect(await reason(es384)).toBe("bad_alg");
    const rs = await new SignJWT(claims()).setProtectedHeader({ alg: "RS256", kid: KID }).sign((await generateKeyPair("RS256")).privateKey);
    expect(await reason(rs)).toBe("bad_alg");
  });

  it("ES256 signed by a key that is not the provider's, or a key id it does not have", async () => {
    expect(await reason(await es256({}, { key: strangerKey }))).toBe("bad_signature");
    expect(await reason(await es256({}, { key: strangerKey, kid: "other-key" }))).toBe("bad_signature");
    const good = await es256();
    const [h, , s] = good.split(".");
    const tampered = `${h}.${base64url.encode(new TextEncoder().encode(JSON.stringify(claims({ sub: randomUUID() }))))}.${s}`;
    expect(await reason(tampered)).toBe("bad_signature");
  });

  it("an error thrown by another copy of jose is sorted by its code: a key the key set does not have means signed out, not an outage", async () => {
    // a Next.js build can give the provider's module (which makes the key set) another copy of jose than lib/auth/jwt.ts:
    // what the key set throws then carries jose's code but is not an instance of this copy's classes
    const foreign = (code: string | null, message: string) =>
      (async () => {
        throw code ? Object.assign(new Error(message), { code }) : new Error(message);
      }) as unknown as Parameters<typeof verifyAccessToken>[1]["keys"];
    const token = await es256();
    const sorted = async (code: string | null, message: string) => {
      const r = await verifyAccessToken(token, { keys: foreign(code, message), issuer: ISS });
      return r.ok ? "ok" : r.reason;
    };
    expect(await sorted("ERR_JWKS_NO_MATCHING_KEY", "no applicable key found in the JSON Web Key Set")).toBe("bad_signature");
    expect(await sorted("ERR_JWKS_MULTIPLE_MATCHING_KEYS", "multiple matching keys found in the JSON Web Key Set")).toBe("bad_signature");
    expect(await sorted("ERR_JWS_SIGNATURE_VERIFICATION_FAILED", "signature verification failed")).toBe("bad_signature");
    // the key service itself failing is still "could not tell"
    expect(await sorted("ERR_JWKS_TIMEOUT", "request timed out")).toBe("no_keys");
    expect(await sorted("ERR_JOSE_GENERIC", "Expected 200 OK from the JSON Web Key Set HTTP response")).toBe("no_keys");
    expect(await sorted(null, "fetch failed")).toBe("no_keys");
  });

  it("another issuer, another audience", async () => {
    expect(await reason(await es256({ iss: "https://evil.example.test/auth/v1" }))).toBe("bad_issuer");
    expect(await reason(await es256({}, { omit: ["iss"] }))).toBe("bad_issuer");
    expect(await reason(await es256({ aud: "anon" }))).toBe("bad_audience");
    expect(await reason(await es256({ aud: ["something-else"] }))).toBe("bad_audience");
    expect(await reason(await es256({}, { omit: ["aud"] }))).toBe("bad_audience");
  });

  it("a role other than authenticated (the anon or service key's token is not a person)", async () => {
    for (const role of ["anon", "service_role", "", undefined]) {
      expect(await reason(await es256({ role }, { omit: role === undefined ? ["role"] : [] })), String(role)).toBe("bad_role");
    }
  });

  it("a subject that is not a user id, or none", async () => {
    for (const s of ["", "admin", "123", `${sub}x`, "00000000-0000-0000-0000-00000000000g"]) {
      expect(await reason(await es256({ sub: s })), s).toBe("bad_subject");
    }
    expect(await reason(await es256({}, { omit: ["sub"] }))).toBe("bad_subject");
  });

  it("an anonymous user", async () => {
    expect(await reason(await es256({ is_anonymous: true }))).toBe("anonymous");
  });

  it("no expiry at all", async () => {
    expect(await reason(await es256({}, { omit: ["exp"] }))).toBe("malformed");
  });
});

describe("the in-memory provider's tokens", () => {
  it("verify against its own key set and issuer, and nowhere else", async () => {
    const auth = new MemoryAuthProvider();
    const email = `t${randomUUID().slice(0, 8)}@example.test`;
    const user = await auth.createUser({ email, password: "a long test password" });
    const tokens = await auth.signInWithPassword(email, "a long test password");
    const r = await verifyAccessToken(tokens.access_token, { keys: await auth.keySet(), issuer: auth.issuer() });
    expect(r.ok && r.token.sub).toBe(user.id);
    expect(auth.issuer()).toBe(MEMORY_ISSUER);
    // the same token against another project's keys, or claiming to be from another issuer
    expect((await verifyAccessToken(tokens.access_token, { keys, issuer: MEMORY_ISSUER })).ok).toBe(false);
    expect(await verifyAccessToken(tokens.access_token, { keys: await auth.keySet(), issuer: ISS })).toEqual({ ok: false, reason: "bad_issuer" });
  });
});

describe("secondsLeft (the proxy's refresh decision; no verification)", () => {
  it("reads exp, and is null for anything that is not a token", async () => {
    const left = secondsLeft(await es256({ exp: nowS() + 600 }));
    expect(left).toBeGreaterThanOrEqual(598);
    expect(left).toBeLessThanOrEqual(600);
    expect(secondsLeft(await es256({ exp: nowS() - 5 }))).toBeLessThan(0);
    expect(secondsLeft(null)).toBeNull();
    expect(secondsLeft("garbage")).toBeNull();
  });
});
