/**
 * Browser-side calls to the app's APIs. Client-safe.
 *
 * The demo: every call names the session explicitly (`?session=<id>`), so a page keeps talking to the session it was
 * rendered for (withSession).
 *
 * An account (track A, docs/plan/real-app.md 3.4 续期): the proxy refreshes the sign-in on the way in, so an API
 * answers 401 not_signed_in only when the sign-in really ended (signed out elsewhere, past its limit) or a refresh
 * raced another tab. Then fetchSignedIn asks POST /api/auth/refresh once (several calls failing together share that
 * one request), tries the call again once, and if he is still not signed in sends the page to /login?next=<this page>.
 * When the sign-in cookies are gone altogether the server finds nobody and answers 400 no_session instead: on a phone
 * that has an account (the owner tag the account's pages keep, lib/offline/client.ts OWNER_KEY; signing out clears it),
 * for a call that names no session, that is the same ended sign-in and is handled the same way (real-app 2.25: 登录过期
 * 跳 /login?next=). A judge's sandbox phone has no such tag, and the demo's calls name their session: both stay as
 * they were.
 */
import { SESSION_QUERY } from "@/lib/session-cookie";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
    this.name = "ApiError";
  }
}

export function withSession(path: string, sessionId: string | null | undefined): string {
  if (!sessionId) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${SESSION_QUERY}=${encodeURIComponent(sessionId)}`;
}

let refreshing: Promise<boolean> | null = null;

/** One shared POST /api/auth/refresh for every call that just got 401: true while he is signed in. */
export function refreshSignIn(): Promise<boolean> {
  refreshing ??= fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    credentials: "same-origin",
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      setTimeout(() => {
        refreshing = null;
      }, 0);
    });
  return refreshing;
}

/** Send the page to the login, coming back here afterwards. */
export function sendToLogin(): void {
  if (typeof window === "undefined") return;
  const here = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?next=${encodeURIComponent(here)}`);
}

/** lib/offline/client.ts OWNER_KEY (not imported: that module imports this one); a unit test keeps the two equal */
export const ACCOUNT_ON_THIS_PHONE_KEY = "rp_outbox_owner";

/** An account's pages were open on this phone and nobody signed out since. */
function accountOnThisPhone(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage.getItem(ACCOUNT_ON_THIS_PHONE_KEY);
  } catch {
    return false;
  }
}

const NAMES_SESSION = new RegExp(`[?&]${SESSION_QUERY}=`);

async function signedOut(res: Response, input: string): Promise<boolean> {
  const cookiesGone = res.status === 400 && !NAMES_SESSION.test(input) && accountOnThisPhone();
  if (res.status !== 401 && !cookiesGone) return false;
  const code = await res
    .clone()
    .json()
    .then((b: { error?: unknown }) => b?.error)
    .catch(() => null);
  return res.status === 401 ? code === "not_signed_in" : code === "no_session";
}

/**
 * fetch(), plus the account's sign-in: on 401 not_signed_in (or 400 no_session on a phone that has an account), one
 * shared refresh and one retry; still signed out, the page goes to the login (the answer is returned as well, for the
 * caller's own error state).
 */
export async function fetchSignedIn(input: string, init: RequestInit = {}): Promise<Response> {
  const opts: RequestInit = { credentials: "same-origin", ...init };
  const res = await fetch(input, opts);
  if (!(await signedOut(res, input))) return res;
  if (await refreshSignIn()) {
    const again = await fetch(input, opts);
    if (!(await signedOut(again, input))) return again;
  }
  sendToLogin();
  return res;
}

export async function postJson<T = unknown>(path: string, sessionId: string | null, body: unknown = {}): Promise<T> {
  const res = await fetchSignedIn(withSession(path, sessionId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? "request_failed");
  return data as T;
}

export async function getJson<T = unknown>(path: string, sessionId: string | null = null): Promise<T> {
  const res = await fetchSignedIn(withSession(path, sessionId), { method: "GET" });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? "request_failed");
  return data as T;
}
