/**
 * The account screens' calls to the account routes (track A), client-safe: JSON in, { status, body } out, never a
 * throw for a refusal (the screens word every refusal themselves, lib/auth/copy.ts errorWords). A network failure is
 * status 0 with error "unavailable".
 */
import type { AuthRouteError } from "./api";

export interface CallResult<T> {
  status: number;
  ok: boolean;
  body: T & { error?: AuthRouteError | string; until?: string };
}

export async function callAccount<T = Record<string, unknown>>(path: string, body?: unknown, method: "POST" | "GET" = "POST"): Promise<CallResult<T>> {
  try {
    const res = await fetch(path, {
      method,
      headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as CallResult<T>["body"];
    return { status: res.status, ok: res.ok, body: data };
  } catch {
    return { status: 0, ok: false, body: { error: "unavailable" } as CallResult<T>["body"] };
  }
}

/** Keep his language for the next page (the rp_lang cookie is read by every page; not a secret). */
export function rememberLanguage(locale: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `rp_lang=${encodeURIComponent(locale)}; path=/; max-age=${365 * 24 * 3600}; samesite=lax`;
}
