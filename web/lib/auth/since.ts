/**
 * rp_since (docs/plan/real-app.md 3.4): when this sign-in started and whether it is 「这不是我的手机」, signed with
 * AUTH_COOKIE_SECRET so the browser cannot move it. The proxy reads it before every refresh (lib/auth/refresh.ts):
 *
 *   an ordinary sign-in      refreshed for 180 days at most, then he logs in again
 *   「这不是我的手机」        12 hours at most; its cookies have no expiry, so closing the browser ends it sooner
 *
 * A refresh without a valid rp_since signs the browser out. The value is "<started ms>.<0|1>.<HMAC>"; nothing secret
 * is in it. Server-only.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Env } from "@/lib/dev/enabled";
import { EPHEMERAL_SIGN_IN_MAX_S, SIGN_IN_MAX_S } from "./provider";
import { authSecret } from "./secrets";

export const SINCE_COOKIE = "rp_since";

export interface SignInSince {
  /** when the sign-in started (real epoch ms) */
  atMs: number;
  /** 「这不是我的手机」 */
  ephemeral: boolean;
}

function mac(payload: string, env: Env): string {
  return createHmac("sha256", authSecret("AUTH_COOKIE_SECRET", env)).update(`rp_since:${payload}`, "utf8").digest("base64url");
}

export function encodeSince(since: SignInSince, env: Env = process.env): string {
  const payload = `${Math.floor(since.atMs)}.${since.ephemeral ? 1 : 0}`;
  return `${payload}.${mac(payload, env)}`;
}

/** The sign-in time in a cookie value, or null when it is missing, malformed or not signed by us. */
export function decodeSince(value: string | null | undefined, env: Env = process.env): SignInSince | null {
  const m = /^(\d{1,15})\.([01])\.([A-Za-z0-9_-]{43})$/.exec(value ?? "");
  if (!m) return null;
  const want = Buffer.from(mac(`${m[1]}.${m[2]}`, env));
  const got = Buffer.from(m[3]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return { atMs: Number(m[1]), ephemeral: m[2] === "1" };
}

/** Has this sign-in run out (12 hours for 「这不是我的手机」, 180 days otherwise; a start in the future counts as bad)? */
export function sinceExpired(since: SignInSince, nowMs: number): boolean {
  const age = nowMs - since.atMs;
  if (age < -5 * 60_000) return true;
  return age > (since.ephemeral ? EPHEMERAL_SIGN_IN_MAX_S : SIGN_IN_MAX_S) * 1000;
}
