/**
 * A local push service for tests (C2 track I): what FCM, Mozilla's or Apple's push service does with a Web Push
 * request, on 127.0.0.1. The unit tests (tests/unit/push) and the journey recording (e2e/journeys/02-push) use it.
 *
 *   const service = await startPushService();
 *   const phone = service.newPhone();            // a browser's subscription: { endpoint, keys } (+ its secret)
 *   ... the server sends to phone.endpoint ...
 *   service.messages                             // every request, checked and opened: { phone, status, payload, ttl, ... }
 *   service.onMessage((m) => ...)                // e.g. hand the opened payload to a real service worker (the journey)
 *   phone.answer = 410                           // the next requests to this phone get 410 (a phone that unsubscribed)
 *   await service.close()
 *
 * Each request is checked like a real push service would: Content-Encoding aes128gcm, a TTL, a valid VAPID header
 * (ES256, aud = this service's origin, exp within 24 h, sub mailto:/https:) and, when the phone subscribed with a key,
 * that same key; then the body is opened with the phone's secret (RFC 8291). A request that fails a check gets 400/401/403
 * and is recorded with `problem`. Imports lib/push/crypto.ts relatively (Playwright and vitest both load it).
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { decryptPayload, newSubscriber, verifyVapidAuthorization, type SubscriberSecret, type SubscriptionKeys } from "../../lib/push/crypto";

export interface TestPhone {
  id: string;
  endpoint: string;
  keys: SubscriptionKeys;
  secret: SubscriberSecret;
  /** the application server key it subscribed with (base64url); null: not checked */
  serverKey: string | null;
  /** what this phone's push service answers next (201 by default) */
  answer: number;
  label: string;
}

export interface PushMessage {
  phone: string;
  label: string;
  status: number;
  /** why it was refused */
  problem: string | null;
  /** the opened payload, parsed (null when it could not be opened) */
  payload: Record<string, unknown> | null;
  /** the raw text that was opened */
  text: string | null;
  ttl: number | null;
  urgency: string | null;
  topic: string | null;
  vapidKey: string | null;
  at: number;
}

export interface PushService {
  origin: string;
  messages: PushMessage[];
  newPhone(opts?: { label?: string; serverKey?: string | null }): TestPhone;
  /** a phone whose subscription was made elsewhere (the browser in the journey: keys from the stub it was given) */
  phone(id: string): TestPhone | undefined;
  onMessage(fn: (m: PushMessage, phone: TestPhone) => void | Promise<void>): void;
  /** resolves with the next accepted message for `phoneId` (or rejects after timeoutMs) */
  next(phoneId: string, timeoutMs?: number): Promise<PushMessage>;
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function startPushService(opts: { host?: string } = {}): Promise<PushService> {
  const host = opts.host ?? "127.0.0.1";
  const phones = new Map<string, TestPhone>();
  const messages: PushMessage[] = [];
  const listeners: ((m: PushMessage, phone: TestPhone) => void | Promise<void>)[] = [];
  const waiters: { phone: string; resolve: (m: PushMessage) => void }[] = [];
  let origin = "";

  const server: Server = createServer((req, res) => {
    void (async () => {
      const id = /^\/push\/([\w-]+)$/.exec(req.url ?? "")?.[1];
      const phone = id ? phones.get(id) : undefined;
      if (req.method !== "POST" || !phone) {
        res.writeHead(404).end();
        return;
      }
      const body = await readBody(req);
      const m: PushMessage = {
        phone: phone.id,
        label: phone.label,
        status: 201,
        problem: null,
        payload: null,
        text: null,
        ttl: req.headers.ttl === undefined ? null : Number(req.headers.ttl),
        urgency: (req.headers.urgency as string | undefined) ?? null,
        topic: (req.headers.topic as string | undefined) ?? null,
        vapidKey: null,
        at: Date.now(),
      };
      const vapid = verifyVapidAuthorization(req.headers.authorization, phone.endpoint);
      if (req.headers["content-encoding"] !== "aes128gcm") {
        m.status = 400;
        m.problem = "content-encoding is not aes128gcm";
      } else if (m.ttl === null || !Number.isFinite(m.ttl)) {
        m.status = 400;
        m.problem = "no TTL";
      } else if (!vapid.ok) {
        m.status = 401;
        m.problem = `vapid: ${vapid.why}`;
      } else if (phone.serverKey && vapid.publicKey !== phone.serverKey) {
        m.status = 403;
        m.problem = "vapid key is not the one the phone subscribed with";
      } else {
        m.vapidKey = vapid.publicKey;
        try {
          m.text = decryptPayload(body, phone.secret).toString("utf8");
          m.payload = JSON.parse(m.text) as Record<string, unknown>;
        } catch (err) {
          m.status = 400;
          m.problem = `could not open: ${err instanceof Error ? err.message : String(err)}`;
        }
        if (!m.problem && phone.answer !== 201) m.status = phone.answer;
      }
      messages.push(m);
      res.writeHead(m.status, { "content-type": "text/plain" }).end(m.problem ?? "");
      if (m.status === 201) {
        for (const w of waiters.filter((x) => x.phone === phone.id)) w.resolve(m);
        waiters.splice(0, waiters.length, ...waiters.filter((x) => x.phone !== phone.id));
        for (const fn of listeners) await Promise.resolve(fn(m, phone)).catch(() => undefined);
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  origin = `http://${host}:${(server.address() as AddressInfo).port}`;

  return {
    origin,
    messages,
    newPhone(o = {}) {
      const sub = newSubscriber();
      const id = randomUUID();
      const phone: TestPhone = {
        id,
        endpoint: `${origin}/push/${id}`,
        keys: sub.keys,
        secret: sub,
        serverKey: o.serverKey ?? null,
        answer: 201,
        label: o.label ?? id.slice(0, 8),
      };
      phones.set(id, phone);
      return phone;
    },
    phone: (id) => phones.get(id),
    onMessage(fn) {
      listeners.push(fn);
    },
    next(phoneId, timeoutMs = 10_000) {
      return new Promise<PushMessage>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no push reached ${phones.get(phoneId)?.label ?? phoneId} within ${timeoutMs} ms`)), timeoutMs);
        waiters.push({
          phone: phoneId,
          resolve: (m) => {
            clearTimeout(timer);
            resolve(m);
          },
        });
      });
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
