/**
 * Browser calls of track C's screens. An account's pages name nothing: the sign-in cookie says whose they are
 * (lib/subject). A call that finds the sign-in ended is refreshed and tried once more, and if he is still signed out
 * the page goes to /login?next=<this page> (lib/session/client.ts fetchSignedIn; real-app 2.25). Client-safe.
 */
import { fetchSignedIn } from "@/lib/session/client";

export interface Sent<T> {
  ok: boolean;
  status: number;
  data: T & { error?: string };
}

export async function sendJson<T = Record<string, unknown>>(method: "POST" | "PATCH", path: string, body: unknown): Promise<Sent<T>> {
  try {
    const res = await fetchSignedIn(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "offline" } as T & { error?: string } };
  }
}
