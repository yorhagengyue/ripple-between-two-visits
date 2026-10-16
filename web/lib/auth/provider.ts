/**
 * The identity provider (docs/plan/real-app.md 3.4): who a person is, their password, their session tokens. Two
 * implementations behind one interface, chosen by AUTH_PROVIDER (lib/dev/enabled.ts effectiveAuthProvider):
 *
 *   supabase   Supabase Auth (GoTrue) over fetch, no SDK (lib/auth/gotrue.ts). Accounts are created by the server
 *              with the admin API (the address marked confirmed, no mail sent); sign-in and refresh use the
 *              publishable key; tokens are ES256 JWTs verified against the project's JWKS.
 *   memory     an in-process stand-in (lib/auth/memory.ts): scrypt password hashes and ES256 JWTs signed with a key
 *              generated at start, shaped like Supabase's. Offline tests and the e2e run on it; a real deployment
 *              refuses to start with it (lib/dev/enabled.ts assertDeployable).
 *
 * Tokens live in httpOnly cookies (lib/auth/cookies.ts); the server checks them on every request (lib/auth/jwt.ts,
 * lib/subject). Errors never carry a key, the project URL or a response body. Server-only.
 */
import type { JWTVerifyGetKey } from "jose";

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  /** seconds the access token lives */
  expires_in: number;
  /** epoch seconds when the access token expires */
  expires_at: number;
  user_id: string;
}

export interface AuthUser {
  id: string;
  email: string;
  app_metadata: Record<string, unknown>;
}

export type AuthErrorCode =
  /** wrong address or password (never says which) */
  | "invalid_credentials"
  /** the address is taken */
  | "user_exists"
  /** the refresh token is unknown, used, expired or its session was signed out */
  | "invalid_refresh"
  /** the password was refused by the provider's own rules */
  | "weak_password"
  | "invalid"
  | "not_found"
  | "not_configured"
  /** the provider did not answer, or answered with an error of its own */
  | "unavailable";

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "AuthError";
  }
}

export interface CreateUserInput {
  email: string;
  password: string;
  /** server-written metadata ({ login_kind, username }); only the server key can set it */
  app_metadata?: Record<string, unknown>;
}

/** Where a password sign-in happens; the session registry keeps it (his devices page, signing one device out). */
export interface SignInContext {
  /** the rp_device cookie's sha256 (lib/auth/device.ts); null when the request had none */
  deviceHash?: string | null;
  /** "iPhone · Safari" (lib/auth/device.ts deviceLabel) */
  deviceLabel?: string | null;
  /** 「这不是我的手机」: ends when the browser closes, 12 hours at most (lib/auth/since.ts) */
  ephemeral?: boolean;
}

/**
 * One sign-in session as the registry keeps it (track A): Supabase's in public.account_session
 * (supabase/migrations 0012_a_sessions.sql), the in-memory provider's in its own state. A session is signed in while
 * ended_at is null; its id is the access token's session_id claim, the same across refreshes.
 */
export interface AuthSessionInfo {
  session_id: string;
  user_id: string;
  device_hash: string | null;
  device_label: string | null;
  ephemeral: boolean;
  created_at: string;
  last_seen_at: string;
  ended_at: string | null;
  ended_reason: string | null;
}

/** Which of a user's open sessions to end (endSessions). Without sessionIds or deviceHash: all of them. */
export interface EndSessions {
  sessionIds?: string[];
  /** every open session on this device */
  deviceHash?: string;
  /** keep this one open (the device asking) */
  exceptSessionId?: string | null;
  /** kept on the row: "logout", "logout_everywhere", "password_changed", "recovery", "device_signed_out", ... */
  reason: string;
}

export interface AuthProvider {
  readonly name: "supabase" | "memory";
  /** The `iss` its access tokens carry. */
  issuer(): string;
  /** The key set its access tokens verify against (JWKS). */
  keySet(): Promise<JWTVerifyGetKey>;
  /** Create a user server-side, its address already confirmed (no mail is sent). */
  createUser(input: CreateUserInput): Promise<AuthUser>;
  /** Sign in; the new session is entered in the registry with `ctx` (device, 「这不是我的手机」). */
  signInWithPassword(email: string, password: string, ctx?: SignInContext): Promise<AuthTokens>;
  /** Trade a refresh token for new tokens (the old refresh token is used up). The session id stays the same. */
  refresh(refreshToken: string): Promise<AuthTokens>;
  /** End this session (local), every session of the user (global) or every other one (others). */
  signOut(accessToken: string, scope?: "local" | "global" | "others"): Promise<void>;
  updatePassword(userId: string, password: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  /**
   * Is the session behind a token still signed in (lib/subject asks before trusting a token)? Both providers answer
   * from the session registry: a session is alive while its entry is open. Supabase answers are cached 30 s per process.
   */
  sessionAlive?(sessionId: string | null): boolean | Promise<boolean>;
  /** The user's sessions in the registry, oldest first (open and ended). */
  listSessions(userId: string): Promise<AuthSessionInfo[]>;
  /** End some of the user's open sessions; returns how many. Their tokens stop working at once (sessionAlive). */
  endSessions(userId: string, which: EndSessions): Promise<number>;
  /** The user id behind an address (his login), or null. Server-side lookup; never tells a browser. */
  findUserIdByEmail(email: string): Promise<string | null>;
  /** Is this the user's password? No session is left behind. */
  checkPassword(email: string, password: string): Promise<boolean>;
}

/** Access tokens the in-memory provider issues live 15 minutes. Supabase's own setting is the owner's (3600 s on 10-10). */
export const ACCESS_TOKEN_TTL_S = 15 * 60;
/**
 * However long the provider's token lives, the app keeps an access token for 15 minutes (real-app 3.4): the rp_at
 * cookie's life, and the proxy refreshes before a token is this old (lib/auth/refresh.ts).
 */
export const ACCESS_COOKIE_MAX_S = 15 * 60;
/** Refresh tokens: 30 days, renewed at each use. */
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 3600;
/** A sign-in is refreshed for 180 days at most; then he logs in again (rp_since). */
export const SIGN_IN_MAX_S = 180 * 24 * 3600;
/** 「这不是我的手机」: 12 hours at most, and the cookies end with the browser. */
export const EPHEMERAL_SIGN_IN_MAX_S = 12 * 3600;
