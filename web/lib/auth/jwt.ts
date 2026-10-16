/**
 * Checking an access token (docs/plan/real-app.md 3.4, 验签). Server-only; the only JWT library is jose.
 *
 *   alg        ES256 only: "none", HS256 (a shared-secret token anyone with the secret could mint) and every other
 *              algorithm are refused before any key is looked at
 *   key        the provider's JWKS (Supabase: <SUPABASE_URL>/auth/v1/.well-known/jwks.json, refetched once for a kid
 *              it does not know; memory: its own generated key)
 *   claims     iss = the provider's issuer, aud = "authenticated", role = "authenticated", exp and nbf with 30 s of
 *              slack, sub a uuid, not an anonymous user
 *
 * Time is the real clock (lib/time/now.ts realNowMs), never the developer test clock: a token's life is about the
 * person's session, not the story day, and a test clock moved days ahead must not sign everyone out.
 */
import { decodeJwt, decodeProtectedHeader, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { USER_ID_RE } from "@/lib/store/rows";
import { realNowMs } from "@/lib/time/now";
import { ACCESS_COOKIE_MAX_S } from "./provider";

export const JWT_ALGORITHMS = ["ES256"] as const;
export const JWT_AUDIENCE = "authenticated";
export const CLOCK_TOLERANCE_S = 30;

export interface VerifiedToken {
  /** the user id */
  sub: string;
  /** the provider's session id (signs out per session) */
  sessionId: string | null;
  email: string | null;
  /** epoch seconds */
  exp: number;
  claims: JWTPayload;
}

export type VerifyFailure =
  | "missing"
  | "malformed"
  | "bad_alg"
  | "bad_signature"
  | "expired"
  | "not_yet_valid"
  | "bad_issuer"
  | "bad_audience"
  | "bad_role"
  | "bad_subject"
  | "anonymous"
  | "no_keys";

export type VerifyResult = { ok: true; token: VerifiedToken } | { ok: false; reason: VerifyFailure };

export interface VerifyOptions {
  keys: JWTVerifyGetKey;
  issuer: string;
  /** epoch ms; default the real clock */
  nowMs?: number;
}

/**
 * jose's own code for an error ("ERR_JWKS_NO_MATCHING_KEY", ...), read off the object. The key set is made by the
 * provider (lib/auth/memory.ts, lib/auth/gotrue.ts) and a Next.js build can give that module another copy of jose than
 * this one, so an error thrown inside the key set is not an `instanceof` this copy's classes. Seen on 2026-10-12: a
 * token signed with a key the provider no longer has (the memory provider after a restart; any provider after its keys
 * were rotated) was sorted as "no_keys", and the door and the log-in pages answered 500 instead of signed out.
 */
function codeOf(err: unknown): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

function failure(err: unknown): VerifyFailure {
  const code = codeOf(err);
  if (err instanceof errors.JWTExpired || code === "ERR_JWT_EXPIRED") return "expired";
  if (err instanceof errors.JWTClaimValidationFailed || code === "ERR_JWT_CLAIM_VALIDATION_FAILED") {
    const claim = (err as { claim?: unknown }).claim;
    if (claim === "nbf") return "not_yet_valid";
    if (claim === "iss") return "bad_issuer";
    if (claim === "aud") return "bad_audience";
    if (claim === "sub") return "bad_subject";
    return "malformed";
  }
  if (err instanceof errors.JOSEAlgNotAllowed || code === "ERR_JOSE_ALG_NOT_ALLOWED") return "bad_alg";
  if (
    err instanceof errors.JWSSignatureVerificationFailed ||
    err instanceof errors.JWKSNoMatchingKey ||
    err instanceof errors.JWKSMultipleMatchingKeys ||
    code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" ||
    code === "ERR_JWKS_NO_MATCHING_KEY" ||
    code === "ERR_JWKS_MULTIPLE_MATCHING_KEYS"
  ) {
    return "bad_signature";
  }
  if (err instanceof errors.JWKSTimeout || err instanceof errors.JWKSInvalid || code === "ERR_JWKS_TIMEOUT" || code === "ERR_JWKS_INVALID") return "no_keys";
  // the key set could not be fetched at all (the network failed, or the provider answered with an error): jose throws
  // the fetch's own error, or a plain JOSEError naming the key set's HTTP response. Not a statement about the token.
  const fromJose = err instanceof errors.JOSEError || (code !== null && /^ERR_(JOSE|JW[TSEK])/.test(code));
  if (!fromJose) return "no_keys";
  if (/JSON Web Key Set/i.test(err instanceof Error ? err.message : String((err as { message?: unknown }).message ?? ""))) return "no_keys";
  return "malformed";
}

/** Verify an access token. Never throws: a bad token is a reason, never an exception. */
export async function verifyAccessToken(token: string | null | undefined, opts: VerifyOptions): Promise<VerifyResult> {
  if (!token || typeof token !== "string") return { ok: false, reason: "missing" };
  let alg: string | undefined;
  try {
    alg = decodeProtectedHeader(token).alg;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!alg || !(JWT_ALGORITHMS as readonly string[]).includes(alg)) return { ok: false, reason: "bad_alg" };
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, opts.keys, {
      algorithms: [...JWT_ALGORITHMS],
      issuer: opts.issuer,
      audience: JWT_AUDIENCE,
      clockTolerance: CLOCK_TOLERANCE_S,
      currentDate: new Date(opts.nowMs ?? realNowMs()),
      requiredClaims: ["exp", "sub"],
    }));
  } catch (err) {
    return { ok: false, reason: failure(err) };
  }
  if (payload.role !== "authenticated") return { ok: false, reason: "bad_role" };
  if (typeof payload.sub !== "string" || !USER_ID_RE.test(payload.sub)) return { ok: false, reason: "bad_subject" };
  if (payload.is_anonymous === true) return { ok: false, reason: "anonymous" };
  return {
    ok: true,
    token: {
      sub: payload.sub,
      sessionId: typeof payload.session_id === "string" ? payload.session_id : null,
      email: typeof payload.email === "string" ? payload.email : null,
      exp: Number(payload.exp),
      claims: payload,
    },
  };
}

/** Seconds until the token expires by its own claim, without verifying it (the proxy decides when to refresh). */
export function secondsLeft(token: string | null | undefined, nowMs: number = realNowMs()): number | null {
  if (!token) return null;
  try {
    const exp = decodeJwt(token).exp;
    return typeof exp === "number" ? exp - Math.floor(nowMs / 1000) : null;
  } catch {
    return null;
  }
}

/**
 * Seconds the app still keeps this access token (no verification): until its own exp, but never past 15 minutes after
 * it was issued (ACCESS_COOKIE_MAX_S): Supabase's tokens live an hour, the app's sign-in refreshes every 15 minutes.
 */
export function accessSecondsLeft(token: string | null | undefined, nowMs: number = realNowMs()): number | null {
  if (!token) return null;
  try {
    const { exp, iat } = decodeJwt(token);
    if (typeof exp !== "number") return null;
    const end = typeof iat === "number" ? Math.min(exp, iat + ACCESS_COOKIE_MAX_S) : exp;
    return end - Math.floor(nowMs / 1000);
  } catch {
    return null;
  }
}

/** The provider session and user a token names, read without verifying it (only to end what we already trust). */
export function tokenClaims(token: string | null | undefined): { sessionId: string | null; userId: string | null; email: string | null } {
  if (!token) return { sessionId: null, userId: null, email: null };
  try {
    const c = decodeJwt(token);
    return {
      sessionId: typeof c.session_id === "string" ? c.session_id : null,
      userId: typeof c.sub === "string" ? c.sub : null,
      email: typeof c.email === "string" ? c.email : null,
    };
  } catch {
    return { sessionId: null, userId: null, email: null };
  }
}
