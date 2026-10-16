/**
 * One Web Push request (C2 track I; RFC 8030 with RFC 8291 and RFC 8292). Server-only.
 *
 *   POST <endpoint>
 *   Content-Encoding: aes128gcm          the body is lib/push/crypto.ts encryptPayload
 *   Authorization: vapid t=…, k=…        signed with this server's key (lib/push/vapid.ts)
 *   TTL: <s>                             how long the push service may hold it while the phone is offline
 *   Urgency: high                        reminders are time-bound
 *   Topic: <32 chars>                    a later message with the same topic replaces one still waiting at the push
 *                                        service (the second reminder replaces an undelivered first), from the tag
 *
 * Answers: 201 / 202 / 200 sent; 404 or 410 the subscription is gone (the caller deletes it); anything else, a timeout
 * or a network error is a failure for this time only. Redirects are not followed. Nothing about the content is logged.
 */
import { createHash } from "node:crypto";
import { encryptPayload, vapidAuthorization, type SubscriptionKeys } from "./crypto";
import type { VapidConfig } from "./vapid";

export interface PushTarget extends SubscriptionKeys {
  endpoint: string;
}

export interface PushRequestOptions {
  ttlS: number;
  urgency?: "very-low" | "low" | "normal" | "high";
  /** replaces a message with the same topic still waiting at the push service (any string; hashed to 32 chars) */
  topic?: string;
  vapid: VapidConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** real time (VAPID exp); never the test clock */
  realNowMs?: number;
}

export interface PushResult {
  status: number;
  sent: boolean;
  /** the push service no longer knows this subscription (404, 410) */
  gone: boolean;
  error?: string;
}

/** RFC 8030 topic: at most 32 characters of the base64url alphabet. */
export function topicOf(tag: string): string {
  return createHash("sha256").update(tag).digest("base64url").slice(0, 32);
}

export async function sendPush(target: PushTarget, payload: string, opts: PushRequestOptions): Promise<PushResult> {
  let body: Buffer;
  try {
    body = encryptPayload(payload, { p256dh: target.p256dh, auth: target.auth });
  } catch (err) {
    return { status: 0, sent: false, gone: false, error: err instanceof Error ? err.message.slice(0, 80) : "encrypt failed" };
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    "Content-Encoding": "aes128gcm",
    TTL: String(Math.max(0, Math.round(opts.ttlS))),
    Urgency: opts.urgency ?? "high",
    Authorization: vapidAuthorization(target.endpoint, opts.vapid, opts.vapid.subject, opts.realNowMs ?? Date.now()),
  };
  if (opts.topic) headers.Topic = topicOf(opts.topic);
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(target.endpoint, {
      method: "POST",
      headers,
      body: new Uint8Array(body),
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
    // drain the answer so the connection is freed (push services answer with a short text, or nothing)
    await res.arrayBuffer().catch(() => undefined);
    const status = res.status;
    if (status === 200 || status === 201 || status === 202) return { status, sent: true, gone: false };
    if (status === 404 || status === 410) return { status, sent: false, gone: true };
    return { status, sent: false, gone: false, error: `push service answered ${status}` };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return { status: 0, sent: false, gone: false, error: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network error" };
  }
}
