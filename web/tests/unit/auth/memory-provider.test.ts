/**
 * AUTH_PROVIDER=memory (lib/auth/memory.ts; C2 F1 item F): scrypt password hashes, ES256 tokens shaped like Supabase's,
 * refresh tokens rotated on use (a reuse within 10 s gets the same answer, a later one ends the session), sign-out per
 * session, for every session, or for every other one.
 */
import { randomUUID } from "node:crypto";
import { decodeJwt } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCESS_TOKEN_TTL_S, AuthError, hashPassword, MemoryAuthProvider, verifyPassword } from "@/lib/auth";
import { verifyAccessToken } from "@/lib/auth/jwt";

const auth = new MemoryAuthProvider();
const PASSWORD = "correct horse battery staple";
const email = () => `u${randomUUID().slice(0, 10)}@example.test`;

async function user(): Promise<{ id: string; email: string }> {
  const e = email();
  const u = await auth.createUser({ email: e, password: PASSWORD });
  return { id: u.id, email: e };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (err) {
    return err instanceof AuthError ? err.code : `not an AuthError: ${String(err)}`;
  }
}

const valid = async (accessToken: string) => (await verifyAccessToken(accessToken, { keys: await auth.keySet(), issuer: auth.issuer() })).ok;

afterEach(() => vi.restoreAllMocks());

describe("passwords", () => {
  it("scrypt, salted: the same password hashes differently each time and only the right one matches", async () => {
    const a = await hashPassword(PASSWORD);
    const b = await hashPassword(PASSWORD);
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, a)).toBe(true);
    expect(await verifyPassword(PASSWORD, b)).toBe(true);
    expect(await verifyPassword("correct horse battery stapler", a)).toBe(false);
    expect(await verifyPassword(PASSWORD, "plain text")).toBe(false);
  });

  it("full-width input is the same password (NFKC), as it is the same login name", async () => {
    const h = await hashPassword("ripple123");
    expect(await verifyPassword("ｒｉｐｐｌｅ１２３", h)).toBe(true);
  });
});

describe("users and sign-in", () => {
  it("an address is taken once (any case); a user needs an address and a password", async () => {
    const e = email();
    await auth.createUser({ email: e, password: PASSWORD });
    expect(await code(auth.createUser({ email: e.toUpperCase(), password: PASSWORD }))).toBe("user_exists");
    expect(await code(auth.createUser({ email: "no-at-sign", password: PASSWORD }))).toBe("invalid");
    expect(await code(auth.createUser({ email: email(), password: "" }))).toBe("weak_password");
  });

  it("the right password gives 15-minute tokens shaped like Supabase's; a wrong password or address is the same refusal", async () => {
    const u = await user();
    const t = await auth.signInWithPassword(u.email.toUpperCase(), PASSWORD);
    expect(t.user_id).toBe(u.id);
    expect(t.expires_in).toBe(ACCESS_TOKEN_TTL_S);
    expect(t.expires_in).toBe(900);
    const c = decodeJwt(t.access_token);
    expect(c).toMatchObject({ sub: u.id, aud: "authenticated", role: "authenticated", email: u.email, is_anonymous: false, iss: auth.issuer() });
    expect(typeof c.session_id).toBe("string");
    expect(Number(c.exp) - Number(c.iat)).toBe(900);
    expect(await valid(t.access_token)).toBe(true);
    expect(t.refresh_token).not.toContain(".");

    const wrong = await auth.signInWithPassword(u.email, "wrong").catch((e: AuthError) => e);
    const nobody = await auth.signInWithPassword(email(), PASSWORD).catch((e: AuthError) => e);
    expect(wrong).toBeInstanceOf(AuthError);
    expect(nobody).toBeInstanceOf(AuthError);
    expect([(wrong as AuthError).code, (wrong as AuthError).message]).toEqual([(nobody as AuthError).code, (nobody as AuthError).message]);
    expect((wrong as AuthError).code).toBe("invalid_credentials");
  });

  it("the public key set has one ES256 key and no private part", async () => {
    const { keys } = await auth.jwks();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ kty: "EC", crv: "P-256", alg: "ES256", use: "sig" });
    expect(keys[0].kid).toBeTruthy();
    expect(keys[0]).not.toHaveProperty("d");
  });
});

describe("refresh", () => {
  it("rotates: new tokens, the same session, and the old refresh token is used up", async () => {
    const u = await user();
    const first = await auth.signInWithPassword(u.email, PASSWORD);
    const second = await auth.refresh(first.refresh_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(decodeJwt(second.access_token).session_id).toBe(decodeJwt(first.access_token).session_id);
    expect(await valid(second.access_token)).toBe(true);
    // the next refresh uses the new token
    const third = await auth.refresh(second.refresh_token);
    expect(third.refresh_token).not.toBe(second.refresh_token);
  });

  it("two tabs refreshing at once (the same token within 10 s) get the same answer", async () => {
    const u = await user();
    const t = await auth.signInWithPassword(u.email, PASSWORD);
    const a = await auth.refresh(t.refresh_token);
    const b = await auth.refresh(t.refresh_token);
    expect(b).toEqual(a);
  });

  it("a used refresh token coming back later ends the whole session (someone else may hold it)", async () => {
    const u = await user();
    const t = await auth.signInWithPassword(u.email, PASSWORD);
    const sessionId = decodeJwt(t.access_token).session_id as string;
    const next = await auth.refresh(t.refresh_token);
    const later = Date.now() + 11_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    expect(await code(auth.refresh(t.refresh_token))).toBe("invalid_refresh");
    expect(auth.sessionAlive(sessionId)).toBe(false);
    // the rightful holder's newer token is gone with it
    expect(await code(auth.refresh(next.refresh_token))).toBe("invalid_refresh");
  });

  it("an unknown or expired refresh token is refused", async () => {
    expect(await code(auth.refresh("not-a-token"))).toBe("invalid_refresh");
    expect(await code(auth.refresh(""))).toBe("invalid_refresh");
    const u = await user();
    const t = await auth.signInWithPassword(u.email, PASSWORD);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 24 * 3600 * 1000);
    expect(await code(auth.refresh(t.refresh_token))).toBe("invalid_refresh");
  });
});

describe("sign-out", () => {
  async function three() {
    const u = await user();
    const a = await auth.signInWithPassword(u.email, PASSWORD);
    const b = await auth.signInWithPassword(u.email, PASSWORD);
    const c = await auth.signInWithPassword(u.email, PASSWORD);
    const sid = (t: { access_token: string }) => decodeJwt(t.access_token).session_id as string;
    return { u, a, b, c, sid };
  }

  it("local: this session only", async () => {
    const { a, b, sid } = await three();
    await auth.signOut(a.access_token, "local");
    expect(auth.sessionAlive(sid(a))).toBe(false);
    expect(auth.sessionAlive(sid(b))).toBe(true);
    expect(await code(auth.refresh(a.refresh_token))).toBe("invalid_refresh");
    expect(await code(auth.refresh(b.refresh_token))).toBe("ok");
  });

  it("others: every session but this one", async () => {
    const { a, b, c, sid } = await three();
    await auth.signOut(a.access_token, "others");
    expect([auth.sessionAlive(sid(a)), auth.sessionAlive(sid(b)), auth.sessionAlive(sid(c))]).toEqual([true, false, false]);
  });

  it("global: every session of the user, and nobody else's", async () => {
    const { a, b, c, sid } = await three();
    const someoneElse = await user();
    const theirs = await auth.signInWithPassword(someoneElse.email, PASSWORD);
    await auth.signOut(b.access_token, "global");
    expect([auth.sessionAlive(sid(a)), auth.sessionAlive(sid(b)), auth.sessionAlive(sid(c))]).toEqual([false, false, false]);
    expect(auth.sessionAlive(sid(theirs))).toBe(true);
    await auth.signOut("not a token", "global"); // nothing happens
    expect(auth.sessionAlive(sid(theirs))).toBe(true);
  });

  it("a new password replaces the old one; a deleted user can no longer sign in and their sessions end", async () => {
    const u = await user();
    const t = await auth.signInWithPassword(u.email, PASSWORD);
    await auth.updatePassword(u.id, "a brand new passphrase");
    expect(await code(auth.signInWithPassword(u.email, PASSWORD))).toBe("invalid_credentials");
    expect(await code(auth.signInWithPassword(u.email, "a brand new passphrase"))).toBe("ok");
    await auth.deleteUser(u.id);
    expect(await code(auth.signInWithPassword(u.email, "a brand new passphrase"))).toBe("invalid_credentials");
    expect(auth.sessionAlive(decodeJwt(t.access_token).session_id as string)).toBe(false);
    expect(await code(auth.updatePassword(u.id, "x"))).toBe("not_found");
  });
});
