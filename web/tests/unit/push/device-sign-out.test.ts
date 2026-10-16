/**
 * 「退出这台」 takes that device's push subscription with it (C2 track D, round two; real-app 2.3 登录过的设备, 2.24; track
 * I's open item: 「在别的设备上点『退出这台』，那台设备的订阅还在」). The subscription now keeps the device it was made on
 * (push_subscription.device_hash, supabase/migrations/0015_d_push_device.sql: the same hash his sign-in sessions and
 * known devices hold), and signing a device out removes the rows that carry it. Through the real routes, against the
 * local push service:
 *   - subscribing from a browser with the rp_device cookie records its hash; without the cookie, none
 *   - signing out his OTHER phone from this one removes only that phone's subscription; the phone he is holding and a
 *     subscription with no device stay; the next notice reaches the phones that are left
 *   - the account event says how many subscriptions went (a count, no endpoint)
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as signOutPost } from "@/app/api/auth/devices/sign-out/route";
import { POST as subscribe } from "@/app/api/push/subscribe/route";
import { POST as testPost } from "@/app/api/push/test/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { deviceHash, deviceRef, newDeviceId } from "@/lib/auth/device";
import { removeDevicePushes } from "@/lib/auth/service";
import { getMemoryStore } from "@/lib/store/memory";
import { startPushService, type PushService } from "../../support/push-service";

const store = getMemoryStore();
let service: PushService;
let him: TestAccount;

function req(path: string, token: string, device: string | null, body: unknown): NextRequest {
  const cookie = [`rp_at=${token}`, device ? `rp_device=${device}` : ""].filter(Boolean).join("; ");
  return new NextRequest(`http://localhost${path}`, { method: "POST", headers: { cookie, "content-type": "application/json", "user-agent": "Mozilla/5.0 (Linux; Android 14) test phone" }, body: JSON.stringify(body) });
}

beforeAll(async () => {
  service = await startPushService();
  him = await createAccountWithSpace(store, getAuthProvider(), { login: `p${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
});
afterAll(async () => {
  await service.close();
});

describe("a push subscription and the device it was made on", () => {
  it("signing his other phone out removes that phone's subscription and no other", async () => {
    const t = him.tokens.access_token;
    const kitchen = newDeviceId(); // the phone he is holding
    const old = newDeviceId(); // the one he is signing out
    for (const d of [kitchen, old]) await store.touchKnownDevice(him.userId, deviceHash(d), "Android phone");
    const phones = { kitchen: service.newPhone({ label: "kitchen" }), old: service.newPhone({ label: "old" }), bare: service.newPhone({ label: "no cookie" }) };
    expect((await subscribe(req("/api/push/subscribe", t, kitchen, { endpoint: phones.kitchen.endpoint, keys: phones.kitchen.keys }))).status).toBe(201);
    expect((await subscribe(req("/api/push/subscribe", t, old, { endpoint: phones.old.endpoint, keys: phones.old.keys }))).status).toBe(201);
    expect((await subscribe(req("/api/push/subscribe", t, null, { endpoint: phones.bare.endpoint, keys: phones.bare.keys }))).status).toBe(201);
    const rows = async () => Object.fromEntries((await store.listPushSubscriptions(him.userId)).map((s) => [s.endpoint, s.device_hash ?? null]));
    expect(await rows()).toEqual({ [phones.kitchen.endpoint]: deviceHash(kitchen), [phones.old.endpoint]: deviceHash(old), [phones.bare.endpoint]: null });
    // the stored value is the hash, never the cookie
    expect(JSON.stringify(await store.listPushSubscriptions(him.userId))).not.toContain(old);

    // a device that is not his: nothing happens
    const stranger = await signOutPost(req("/api/auth/devices/sign-out", t, kitchen, { device: deviceRef(deviceHash(newDeviceId())) }));
    expect(stranger.status).toBe(404);
    expect(Object.keys(await rows())).toHaveLength(3);

    const res = await signOutPost(req("/api/auth/devices/sign-out", t, kitchen, { device: deviceRef(deviceHash(old)) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ current: false });
    expect(await rows()).toEqual({ [phones.kitchen.endpoint]: deviceHash(kitchen), [phones.bare.endpoint]: null });
    const event = (await store.listAccountEvents(him.userId)).filter((e) => e.kind === "device_signed_out").at(-1)!;
    expect(event.detail).toMatchObject({ device: deviceRef(deviceHash(old)), push_subscriptions: 1 });
    expect(JSON.stringify(event.detail)).not.toContain("push.example");

    // the next notice goes to the phones that are left, not to the one he signed out
    const from = service.messages.length;
    expect((await testPost(req("/api/push/test", t, kitchen, {}))).status).toBe(200);
    const reached = new Set(service.messages.slice(from).map((m) => m.phone));
    expect(reached.has(phones.old.id)).toBe(false);
    expect(reached.has(phones.kitchen.id)).toBe(true);
  });

  it("removeDevicePushes: only rows with that hash; a store that fails never fails the sign-out", async () => {
    const other = await createAccountWithSpace(store, getAuthProvider(), { login: `p${randomUUID().slice(0, 10)}`, password: "a long test password", space: "none" });
    const hash = deviceHash(newDeviceId());
    await store.savePushSubscription({ user_id: other.userId, endpoint: `https://push.example/${randomUUID()}`, p256dh: "k", auth: "a", device_hash: hash });
    await store.savePushSubscription({ user_id: other.userId, endpoint: `https://push.example/${randomUUID()}`, p256dh: "k", auth: "a", device_hash: hash });
    await store.savePushSubscription({ user_id: other.userId, endpoint: `https://push.example/${randomUUID()}`, p256dh: "k", auth: "a" });
    expect(await removeDevicePushes(store, other.userId, deviceHash(newDeviceId()))).toBe(0);
    expect(await removeDevicePushes(store, other.userId, hash)).toBe(2);
    expect(await store.listPushSubscriptions(other.userId)).toHaveLength(1);
    const broken = { listPushSubscriptions: async () => Promise.reject(new Error("down")), deleteOwnPushSubscription: async () => false };
    expect(await removeDevicePushes(broken, other.userId, hash)).toBe(0);
  });
});
