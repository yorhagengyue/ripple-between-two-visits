/**
 * Which endpoints the server sends to, which keys it accepts, and which VAPID keys it signs with (C2 track I;
 * lib/push/endpoint.ts, lib/push/vapid.ts).
 */
import { describe, expect, it } from "vitest";
import { generateVapidKeys, newSubscriber } from "@/lib/push/crypto";
import { checkEndpoint, checkKeys } from "@/lib/push/endpoint";
import { DEFAULT_VAPID_SUBJECT, vapidConfig } from "@/lib/push/vapid";

describe("endpoints: only the browsers' push services", () => {
  const ok = (u: string, devTools = false, env: Record<string, string> = {}) => checkEndpoint(u, { devTools, env }).ok;

  it("FCM, Mozilla, Windows and Apple over https", () => {
    for (const u of [
      "https://fcm.googleapis.com/fcm/send/abc:APA91b",
      "https://fcm.googleapis.com/wp/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
      "https://wns2-sg2p.notify.windows.com/w/?token=BQYAAA",
      "https://web.push.apple.com/QGuQyavXutnMH",
    ]) {
      expect(ok(u), u).toBe(true);
    }
  });

  it("refused: other hosts, http, look-alike hosts, odd ports, credentials, garbage", () => {
    for (const u of [
      "https://evil.example/push",
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com.evil.example/x",
      "https://notfcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
      "https://user:pw@fcm.googleapis.com/x",
      "https://169.254.169.254/latest/meta-data",
      "not a url",
      "",
      `https://fcm.googleapis.com/${"x".repeat(2100)}`,
    ]) {
      expect(ok(u), u).toBe(false);
    }
  });

  it("localhost only with the developer tools on; more hosts through PUSH_ALLOWED_HOSTS", () => {
    expect(ok("http://127.0.0.1:4100/push/a")).toBe(false);
    expect(ok("http://127.0.0.1:4100/push/a", true)).toBe(true);
    expect(ok("http://localhost:4100/push/a", true)).toBe(true);
    expect(ok("http://[::1]:4100/push/a", true)).toBe(true);
    expect(ok("http://10.0.0.5/push/a", true)).toBe(false);
    expect(ok("https://push.example.com/x", false, { PUSH_ALLOWED_HOSTS: "push.example.com" })).toBe(true);
    expect(ok("https://a.push.example.org/x", false, { PUSH_ALLOWED_HOSTS: ".push.example.org" })).toBe(true);
    expect(ok("https://push.example.org/x", false, { PUSH_ALLOWED_HOSTS: ".push.example.org" })).toBe(false);
  });

  it("keys: a P-256 point and a 16-byte secret", () => {
    const sub = newSubscriber();
    expect(checkKeys(sub.keys)).toBe(true);
    expect(checkKeys({ p256dh: sub.keys.p256dh, auth: "AAAA" })).toBe(false);
    expect(checkKeys({ p256dh: "BAAAA", auth: sub.keys.auth })).toBe(false);
    expect(checkKeys({ p256dh: 5, auth: sub.keys.auth })).toBe(false);
    expect(checkKeys(null)).toBe(false);
  });
});

describe("VAPID keys", () => {
  it("a matching pair from the environment is used, with its subject", () => {
    const pair = generateVapidKeys();
    expect(vapidConfig({ VAPID_PUBLIC_KEY: pair.publicKey, VAPID_PRIVATE_KEY: pair.privateKey, VAPID_SUBJECT: "mailto:team@example.org", NODE_ENV: "production" })).toEqual({
      ...pair,
      subject: "mailto:team@example.org",
      dev: false,
    });
  });

  it("no pair, developer tools off: push is off; a pair whose halves do not match counts as none", () => {
    expect(vapidConfig({ NODE_ENV: "production" })).toBeNull();
    const a = generateVapidKeys();
    const b = generateVapidKeys();
    expect(vapidConfig({ NODE_ENV: "production", VAPID_PUBLIC_KEY: a.publicKey, VAPID_PRIVATE_KEY: b.privateKey })).toBeNull();
  });

  it("no pair, developer tools on: one dev pair for the whole process; a bad subject falls back to the default", () => {
    const one = vapidConfig({ NODE_ENV: "production", RIPPLE_DEV_TOOLS: "1", VAPID_SUBJECT: "nobody" });
    const two = vapidConfig({ NODE_ENV: "development" });
    expect(one).toMatchObject({ dev: true, subject: DEFAULT_VAPID_SUBJECT });
    expect(two?.publicKey).toBe(one?.publicKey);
  });
});
