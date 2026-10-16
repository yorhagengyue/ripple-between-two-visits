/**
 * AUTH_PROVIDER=memory: an in-process identity provider shaped like Supabase Auth, for offline tests, the e2e and the
 * journey recordings (docs/plan/real-app.md 3.4). Server-only.
 *
 *   users      e-mail, scrypt password hash (salted, constant-time comparison), app_metadata
 *   tokens     ES256 JWTs signed with a key pair generated when the process starts (its public half is the JWKS),
 *              the same claims as Supabase's (iss, aud "authenticated", role, sub, email, session_id, is_anonymous,
 *              aal, amr, app_metadata, iat, exp); access 15 minutes, refresh tokens opaque and rotated on use
 *              (a reuse within 10 s gets the same answer, a later reuse signs the whole session out)
 *   sign-out   per session, every session of the user, or every other one
 *   registry   every session with its device, 「这不是我的手机」 and when it ended (track A): the same answers the
 *              Supabase provider gives from public.account_session, so his devices page and signing one device out
 *              behave alike offline
 *
 * All state is on globalThis, so the proxy bundle (which refreshes tokens) and the route handlers (which verify them)
 * share one provider, and `next dev` hot reload keeps it. Data is lost when the process exits. Real time throughout
 * (lib/time/now.ts realNowMs), like a real provider. A real deployment refuses to start with it
 * (lib/dev/enabled.ts assertDeployable).
 */
import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { createLocalJWKSet, decodeJwt, exportJWK, generateKeyPair, SignJWT, type JWK, type JWTVerifyGetKey } from "jose";
import { realNowMs } from "@/lib/time/now";
import {
  ACCESS_TOKEN_TTL_S,
  AuthError,
  REFRESH_TOKEN_TTL_S,
  type AuthProvider,
  type AuthSessionInfo,
  type AuthTokens,
  type AuthUser,
  type CreateUserInput,
  type EndSessions,
  type SignInContext,
} from "./provider";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;

export const MEMORY_ISSUER = "https://auth.ripple.invalid/memory";
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 32;
/** a refresh token used again within this long gets the same answer (two tabs refreshing at once) */
const REUSE_GRACE_MS = 10_000;

interface MemoryUser {
  id: string;
  email: string;
  passwordHash: string;
  app_metadata: Record<string, unknown>;
  created_at: string;
}

interface RefreshEntry {
  userId: string;
  sessionId: string;
  expiresAtMs: number;
  /** when it was traded for new tokens, and what it got */
  usedAtMs: number | null;
  answer: AuthTokens | null;
}

interface MemoryAuthState {
  keys: Promise<{ privateKey: CryptoKey; publicJwk: JWK; kid: string }>;
  users: Map<string, MemoryUser>;
  byEmail: Map<string, string>;
  /** session id -> user id, while the session is signed in */
  sessions: Map<string, string>;
  refresh: Map<string, RefreshEntry>;
  /** every session ever opened, with its device and when it ended (track A's registry) */
  registry: Map<string, AuthSessionInfo>;
}

type GlobalWithAuth = typeof globalThis & { __rippleMemoryAuth?: MemoryAuthState };

function state(): MemoryAuthState {
  const g = globalThis as GlobalWithAuth;
  g.__rippleMemoryAuth ??= {
    keys: (async () => {
      const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
      const kid = `memory-${randomUUID().slice(0, 8)}`;
      const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: "ES256", use: "sig" };
      return { privateKey, publicJwk, kid };
    })(),
    users: new Map(),
    byEmail: new Map(),
    sessions: new Map(),
    refresh: new Map(),
    registry: new Map(),
  };
  g.__rippleMemoryAuth.registry ??= new Map(); // a state made before the registry existed (hot reload)
  return g.__rippleMemoryAuth;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, KEY_LEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64url");
  const got = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64url"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** A hash that never matches, compared against when the address is unknown (no timing hint about which accounts exist). */
let dummyHash: Promise<string> | null = null;

export class MemoryAuthProvider implements AuthProvider {
  readonly name = "memory" as const;

  issuer(): string {
    return MEMORY_ISSUER;
  }

  async keySet(): Promise<JWTVerifyGetKey> {
    const { publicJwk } = await state().keys;
    return createLocalJWKSet({ keys: [publicJwk] });
  }

  /** The public JWKS document ({ keys: [...] }), as Supabase serves it at /auth/v1/.well-known/jwks.json. */
  async jwks(): Promise<{ keys: JWK[] }> {
    const { publicJwk } = await state().keys;
    return { keys: [{ ...publicJwk }] };
  }

  async createUser(input: CreateUserInput): Promise<AuthUser> {
    const email = input.email.trim().toLowerCase();
    if (!email.includes("@")) throw new AuthError("invalid", "not an e-mail address");
    if (!input.password) throw new AuthError("weak_password", "a password is required");
    const s = state();
    if (s.byEmail.has(email)) throw new AuthError("user_exists", "that address is taken");
    const user: MemoryUser = {
      id: randomUUID(),
      email,
      passwordHash: await hashPassword(input.password),
      app_metadata: { provider: "email", ...(input.app_metadata ?? {}) },
      created_at: new Date(realNowMs()).toISOString(),
    };
    if (s.byEmail.has(email)) throw new AuthError("user_exists", "that address is taken"); // raced while hashing
    s.users.set(user.id, user);
    s.byEmail.set(email, user.id);
    return { id: user.id, email: user.email, app_metadata: { ...user.app_metadata } };
  }

  private async issue(user: MemoryUser, sessionId: string): Promise<AuthTokens> {
    const { privateKey, kid } = await state().keys;
    const iat = Math.floor(realNowMs() / 1000);
    const exp = iat + ACCESS_TOKEN_TTL_S;
    const access_token = await new SignJWT({
      aud: "authenticated",
      role: "authenticated",
      email: user.email,
      phone: "",
      app_metadata: user.app_metadata,
      user_metadata: {},
      session_id: sessionId,
      is_anonymous: false,
      aal: "aal1",
      amr: [{ method: "password", timestamp: iat }],
    })
      .setProtectedHeader({ alg: "ES256", kid, typ: "JWT" })
      .setIssuer(MEMORY_ISSUER)
      .setSubject(user.id)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(privateKey);
    const refresh_token = randomBytes(24).toString("base64url");
    state().refresh.set(refresh_token, { userId: user.id, sessionId, expiresAtMs: realNowMs() + REFRESH_TOKEN_TTL_S * 1000, usedAtMs: null, answer: null });
    return { access_token, refresh_token, expires_in: ACCESS_TOKEN_TTL_S, expires_at: exp, user_id: user.id };
  }

  /** The user if the password is right (a hash is compared either way: no timing hint about which accounts exist). */
  private async passwordUser(email: string, password: string): Promise<MemoryUser | null> {
    const s = state();
    const id = s.byEmail.get((email ?? "").trim().toLowerCase());
    const user = id ? s.users.get(id) : undefined;
    dummyHash ??= hashPassword(randomUUID());
    const ok = await verifyPassword(password ?? "", user ? user.passwordHash : await dummyHash);
    return user && ok ? user : null;
  }

  async signInWithPassword(email: string, password: string, ctx: SignInContext = {}): Promise<AuthTokens> {
    const user = await this.passwordUser(email, password);
    if (!user) throw new AuthError("invalid_credentials", "wrong address or password");
    const s = state();
    const sessionId = randomUUID();
    s.sessions.set(sessionId, user.id);
    const at = new Date(realNowMs()).toISOString();
    s.registry.set(sessionId, {
      session_id: sessionId,
      user_id: user.id,
      device_hash: ctx.deviceHash ?? null,
      device_label: ctx.deviceLabel ?? null,
      ephemeral: ctx.ephemeral === true,
      created_at: at,
      last_seen_at: at,
      ended_at: null,
      ended_reason: null,
    });
    return this.issue(user, sessionId);
  }

  async checkPassword(email: string, password: string): Promise<boolean> {
    return (await this.passwordUser(email, password)) !== null;
  }

  async findUserIdByEmail(email: string): Promise<string | null> {
    return state().byEmail.get((email ?? "").trim().toLowerCase()) ?? null;
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const s = state();
    const entry = refreshToken ? s.refresh.get(refreshToken) : undefined;
    const now = realNowMs();
    if (!entry || entry.expiresAtMs <= now || !s.sessions.has(entry.sessionId)) throw new AuthError("invalid_refresh", "sign in again");
    if (entry.usedAtMs !== null) {
      if (now - entry.usedAtMs <= REUSE_GRACE_MS && entry.answer) return { ...entry.answer };
      // a refresh token used again later: someone else may hold it; the whole session ends
      this.endSession(entry.sessionId, "refresh_reused");
      throw new AuthError("invalid_refresh", "sign in again");
    }
    const user = s.users.get(entry.userId);
    if (!user) throw new AuthError("invalid_refresh", "sign in again");
    const tokens = await this.issue(user, entry.sessionId);
    entry.usedAtMs = now;
    entry.answer = tokens;
    const info = s.registry.get(entry.sessionId);
    if (info) info.last_seen_at = new Date(now).toISOString();
    return { ...tokens };
  }

  private endSession(sessionId: string, reason = "signed_out"): void {
    const s = state();
    s.sessions.delete(sessionId);
    for (const [token, e] of s.refresh) if (e.sessionId === sessionId) s.refresh.delete(token);
    const info = s.registry.get(sessionId);
    if (info && !info.ended_at) {
      info.ended_at = new Date(realNowMs()).toISOString();
      info.ended_reason = reason;
    }
  }

  /** Is this provider session still signed in (lib/subject asks before trusting a token)? */
  sessionAlive(sessionId: string | null): boolean {
    return !!sessionId && state().sessions.has(sessionId);
  }

  async signOut(accessToken: string, scope: "local" | "global" | "others" = "local"): Promise<void> {
    let claims: { sub?: unknown; session_id?: unknown };
    try {
      claims = decodeJwt(accessToken);
    } catch {
      return;
    }
    const s = state();
    const sessionId = typeof claims.session_id === "string" ? claims.session_id : null;
    const userId = typeof claims.sub === "string" ? claims.sub : null;
    if (scope === "local") {
      if (sessionId) this.endSession(sessionId, "logout");
      return;
    }
    for (const [sid, uid] of [...s.sessions]) {
      if (uid !== userId) continue;
      if (scope === "others" && sid === sessionId) continue;
      this.endSession(sid, scope === "global" ? "logout_everywhere" : "logout_others");
    }
  }

  async listSessions(userId: string): Promise<AuthSessionInfo[]> {
    return [...state().registry.values()]
      .filter((r) => r.user_id === userId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((r) => ({ ...r }));
  }

  async endSessions(userId: string, which: EndSessions): Promise<number> {
    const s = state();
    const ids = which.sessionIds ? new Set(which.sessionIds) : null;
    let n = 0;
    for (const [sid, uid] of [...s.sessions]) {
      if (uid !== userId) continue;
      if (ids && !ids.has(sid)) continue;
      if (which.deviceHash !== undefined && s.registry.get(sid)?.device_hash !== which.deviceHash) continue;
      if (which.exceptSessionId && sid === which.exceptSessionId) continue;
      this.endSession(sid, which.reason);
      n++;
    }
    return n;
  }

  async updatePassword(userId: string, password: string): Promise<void> {
    const user = state().users.get(userId);
    if (!user) throw new AuthError("not_found", "no such user");
    if (!password) throw new AuthError("weak_password", "a password is required");
    user.passwordHash = await hashPassword(password);
  }

  async deleteUser(userId: string): Promise<void> {
    const s = state();
    const user = s.users.get(userId);
    if (!user) return;
    for (const [sid, uid] of [...s.sessions]) if (uid === userId) this.endSession(sid, "user_deleted");
    for (const [sid, info] of [...s.registry]) if (info.user_id === userId) s.registry.delete(sid);
    s.users.delete(userId);
    s.byEmail.delete(user.email);
  }
}
