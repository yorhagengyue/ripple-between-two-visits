/**
 * The push routes (C2 track I; real-app 2.6, 2.23, 2.24, 8.10 push/subscribe): subscribe (one row per endpoint, the
 * welcome push to that phone only), unsubscribe (only one's own), the test push, the tap's opened_at (his own
 * reminders only), the status, the public key. Him (his space) and her (no space of her own) alike. Against the local
 * push service, which checks and opens every message.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as keyGet } from "@/app/api/push/key/route";
import { POST as openedPost } from "@/app/api/push/opened/route";
import { GET as statusGet } from "@/app/api/push/route";
import { DELETE as unsubscribe, POST as subscribe } from "@/app/api/push/subscribe/route";
import { POST as testPost } from "@/app/api/push/test/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { getMemoryStore } from "@/lib/store/memory";
import { setTestClock } from "@/lib/time/now";
import { startPushService, type PushService } from "../../support/push-service";

const store = getMemoryStore();
let service: PushService;
let him: TestAccount;
let her: TestAccount;

function req(path: string, method: string, token: string | null, body?: unknown): NextRequest {
  const headers: Record<string, string> = { "user-agent": "Mozilla/5.0 (Linux; Android 14) test phone" };
  if (token) headers.cookie = `rp_at=${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

beforeAll(async () => {
  service = await startPushService();
  setTestClock({ at: "2026-10-13T08:40:00+08:00", frozen: true });
  him = await createAccountWithSpace(store, getAuthProvider(), { login: `p${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  her = await createAccountWithSpace(store, getAuthProvider(), { login: `q${randomUUID().slice(0, 10)}`, password: "a long test password", space: "none", locale: "en" });
});
afterAll(async () => {
  setTestClock(null);
  await service.close();
});

describe("GET /api/push/key", () => {
  it("the public key a browser subscribes with (the developer tools make one for this process)", async () => {
    const res = keyGet();
    expect(res.status).toBe(200);
    const { publicKey } = (await res.json()) as { publicKey: string };
    expect(Buffer.from(publicKey, "base64url")).toHaveLength(65);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("POST / DELETE /api/push/subscribe", () => {
  it("signed out: 401; an endpoint that is not a push service: 400; keys that are not a browser's: 400", async () => {
    const phone = service.newPhone();
    expect((await subscribe(req("/api/push/subscribe", "POST", null, { endpoint: phone.endpoint, keys: phone.keys }))).status).toBe(401);
    const t = him.tokens.access_token;
    const bad = await subscribe(req("/api/push/subscribe", "POST", t, { endpoint: "https://evil.example/x", keys: phone.keys }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "endpoint_not_allowed" });
    const keys = await subscribe(req("/api/push/subscribe", "POST", t, { endpoint: phone.endpoint, keys: { p256dh: phone.keys.p256dh, auth: "AAAA" } }));
    expect(await keys.json()).toEqual({ error: "keys_invalid" });
    expect(await store.listPushSubscriptions(him.userId)).toEqual([]);
  });

  it("his phone: kept once however often it subscribes; 「提醒已经开好了」 reaches that phone only", async () => {
    const t = him.tokens.access_token;
    const phone = service.newPhone({ label: "his" });
    const other = service.newPhone({ label: "his other" });
    await store.savePushSubscription({ user_id: him.userId, endpoint: other.endpoint, ...other.keys });
    const from = service.messages.length;
    const res = await subscribe(req("/api/push/subscribe", "POST", t, { endpoint: phone.endpoint, keys: phone.keys, expirationTime: null }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ subscribed: true, sent: 1 });
    const again = await subscribe(req("/api/push/subscribe", "POST", t, { endpoint: phone.endpoint, keys: phone.keys, welcome: false }));
    expect(await again.json()).toEqual({ subscribed: true, sent: 0 });
    const rows = await store.listPushSubscriptions(him.userId);
    expect(rows.filter((r) => r.endpoint === phone.endpoint)).toHaveLength(1);
    expect(rows.find((r) => r.endpoint === phone.endpoint)?.user_agent).toContain("Android");
    const seen = service.messages.slice(from);
    expect(seen.map((m) => m.label)).toEqual(["his"]);
    expect(seen[0].payload).toMatchObject({ kind: "welcome", title: "提醒已经开好了", url: "/p/me/notifications", lang: "zh-Hans" });

    const status = await statusGet(req(`/api/push?endpoint=${encodeURIComponent(phone.endpoint)}`, "GET", t));
    expect(await status.json()).toEqual({ configured: true, subscribed: true, devices: 2, recent: [] });

    // her DELETE of his phone removes nothing; his own does, once
    expect(await (await unsubscribe(req("/api/push/subscribe", "DELETE", her.tokens.access_token, { endpoint: phone.endpoint }))).json()).toEqual({ removed: false });
    expect(await (await unsubscribe(req("/api/push/subscribe", "DELETE", t, { endpoint: phone.endpoint }))).json()).toEqual({ removed: true });
    expect(await (await unsubscribe(req("/api/push/subscribe", "DELETE", t, { endpoint: phone.endpoint }))).json()).toEqual({ removed: false });
    expect((await store.listPushSubscriptions(him.userId)).map((r) => r.endpoint)).toEqual([other.endpoint]);
    await store.deleteOwnPushSubscription(him.userId, other.endpoint);
  });

  it("a push service that answers the welcome with 410 does not know the phone: the row goes again and the answer says so", async () => {
    const t = him.tokens.access_token;
    const phone = service.newPhone({ label: "dead" });
    phone.answer = 410;
    const res = await subscribe(req("/api/push/subscribe", "POST", t, { endpoint: phone.endpoint, keys: phone.keys }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ subscribed: false, sent: 0 });
    expect((await store.listPushSubscriptions(him.userId)).map((r) => r.endpoint)).not.toContain(phone.endpoint);
    // without a welcome nothing is sent, so nothing is known yet: kept
    const quiet = await subscribe(req("/api/push/subscribe", "POST", t, { endpoint: phone.endpoint, keys: phone.keys, welcome: false }));
    expect(await quiet.json()).toEqual({ subscribed: true, sent: 0 });
    await store.deleteOwnPushSubscription(him.userId, phone.endpoint);
  });

  it("a welcome the push service did not take (500): reminders are not on, no row is left; the next try can succeed", async () => {
    const t = him.tokens.access_token;
    const phone = service.newPhone({ label: "flaky" });
    phone.answer = 500;
    const res = await subscribe(req("/api/push/subscribe", "POST", t, { endpoint: phone.endpoint, keys: phone.keys }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ subscribed: false, sent: 0 });
    expect((await store.listPushSubscriptions(him.userId)).map((r) => r.endpoint)).not.toContain(phone.endpoint);
    const status = await statusGet(req(`/api/push?endpoint=${encodeURIComponent(phone.endpoint)}`, "GET", t));
    expect(await status.json()).toMatchObject({ subscribed: false });
    phone.answer = 201;
    const again = await subscribe(req("/api/push/subscribe", "POST", t, { endpoint: phone.endpoint, keys: phone.keys }));
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual({ subscribed: true, sent: 1 });
    await store.deleteOwnPushSubscription(him.userId, phone.endpoint);
  });

  it("her phone (no space of her own): subscribes too; her welcome is in her language and lands on her page", async () => {
    const phone = service.newPhone({ label: "hers" });
    const from = service.messages.length;
    const res = await subscribe(req("/api/push/subscribe", "POST", her.tokens.access_token, { endpoint: phone.endpoint, keys: phone.keys }));
    expect(res.status).toBe(201);
    expect(service.messages.slice(from)[0].payload).toMatchObject({ kind: "welcome", title: "Notifications are on", url: "/f", lang: "en" });
    const status = await statusGet(req("/api/push", "GET", her.tokens.access_token));
    expect(await status.json()).toEqual({ configured: true, subscribed: false, devices: 1, recent: [] });
  });

  it("DELETE { all: true } (「退出所有设备」): every phone of his goes, nobody else's; a body with neither field: 400", async () => {
    const t = him.tokens.access_token;
    const a = service.newPhone({ label: "all a" });
    const b = service.newPhone({ label: "all b" });
    for (const p of [a, b]) await store.savePushSubscription({ user_id: him.userId, endpoint: p.endpoint, ...p.keys });
    const hers = (await store.listPushSubscriptions(her.userId)).map((r) => r.endpoint);
    expect(hers.length).toBeGreaterThan(0);
    const res = await unsubscribe(req("/api/push/subscribe", "DELETE", t, { all: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: true, count: 2 });
    expect(await store.listPushSubscriptions(him.userId)).toEqual([]);
    expect((await store.listPushSubscriptions(her.userId)).map((r) => r.endpoint)).toEqual(hers);
    expect(await (await unsubscribe(req("/api/push/subscribe", "DELETE", t, { all: true }))).json()).toEqual({ removed: false, count: 0 });
    expect((await unsubscribe(req("/api/push/subscribe", "DELETE", t, {}))).status).toBe(400);
    expect((await unsubscribe(req("/api/push/subscribe", "DELETE", t, { all: false }))).status).toBe(400);
    expect((await unsubscribe(req("/api/push/subscribe", "DELETE", null, { all: true }))).status).toBe(401);
  });
});

describe("POST /api/push/test", () => {
  it("「发一条试试」 to his phones (or one); a phone the push service forgot is removed", async () => {
    const t = him.tokens.access_token;
    const a = service.newPhone({ label: "a" });
    const b = service.newPhone({ label: "b" });
    b.answer = 410;
    await store.savePushSubscription({ user_id: him.userId, endpoint: a.endpoint, ...a.keys });
    await store.savePushSubscription({ user_id: him.userId, endpoint: b.endpoint, ...b.keys });
    const from = service.messages.length;
    const res = await testPost(req("/api/push/test", "POST", t, {}));
    expect(await res.json()).toEqual({ sent: 1, devices: 1 });
    expect(service.messages.slice(from).find((m) => m.label === "a")?.payload).toMatchObject({ kind: "test", title: "这是一条试试的提醒" });
    const one = await testPost(req("/api/push/test", "POST", t, { endpoint: a.endpoint }));
    expect(await one.json()).toEqual({ sent: 1, devices: 1 });
    expect((await testPost(req("/api/push/test", "POST", null, {}))).status).toBe(401);
  });
});

describe("POST /api/push/opened: he tapped his reminder", () => {
  it("marks his own delivery (the first tap's time stays); her alert, an unknown id: 404; signed out: nothing", async () => {
    const t = him.tokens.access_token;
    const today = (await store.getSession(him.userId))!.story_day;
    const { delivery } = await store.recordDelivery(him.userId, { kind: "dose_first", ref: "dose", day: today, slot: "morning" });
    const alert = await store.recordDelivery(him.userId, { kind: "family_no_reply", ref: "link-x", day: today, slot: "morning" });
    setTestClock({ at: "2026-10-13T08:46:00+08:00", frozen: true });
    const res = await openedPost(req("/api/push/opened", "POST", t, { delivery: delivery.id }));
    expect(await res.json()).toEqual({ recorded: true, opened_at: "2026-10-13T00:46:00.000Z" });
    setTestClock({ at: "2026-10-13T08:50:00+08:00", frozen: true });
    expect(await (await openedPost(req("/api/push/opened", "POST", t, { delivery: delivery.id }))).json()).toEqual({ recorded: true, opened_at: "2026-10-13T00:46:00.000Z" });
    expect((await openedPost(req("/api/push/opened", "POST", t, { delivery: alert.delivery.id }))).status).toBe(404);
    expect((await openedPost(req("/api/push/opened", "POST", t, { delivery: "delivery-nope" }))).status).toBe(404);
    expect((await openedPost(req("/api/push/opened", "POST", null, { delivery: delivery.id }))).status).toBe(400);

    const status = await statusGet(req("/api/push", "GET", t));
    const body = (await status.json()) as { recent: unknown[] };
    expect(body.recent).toEqual([{ kind: "dose_first", slot: "morning", date: "2026-10-13", sent_at: delivery.sent_at, opened_at: "2026-10-13T00:46:00.000Z" }]);
    expect(JSON.stringify(body)).not.toContain(him.userId);
  });
});
