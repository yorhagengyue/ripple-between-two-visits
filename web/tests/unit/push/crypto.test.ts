/**
 * The Web Push protocol (C2 track I; lib/push/crypto.ts): RFC 8291 message encryption pinned to the RFC's own example
 * (Appendix A) in both directions, a round trip with fresh keys, and RFC 8292 VAPID headers a push service accepts.
 */
import { describe, expect, it } from "vitest";
import {
  b64u,
  decryptPayload,
  encryptPayload,
  generateVapidKeys,
  isP256PublicKey,
  newSubscriber,
  vapidAuthorization,
  vapidPairMatches,
  verifyVapidAuthorization,
} from "@/lib/push/crypto";

// RFC 8291 Appendix A: the example's own values, printed in the RFC for everyone (public test vectors, not secrets of
// this app; no real key of Ripple is in the repository: VAPID keys live only in web/.env).
const A = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

describe("RFC 8291 message encryption", () => {
  it("produces the RFC's own example byte for byte (fixed salt and server key)", () => {
    const body = encryptPayload(A.plaintext, { p256dh: A.uaPublic, auth: A.auth }, { salt: b64u.decode(A.salt), asPrivateKey: b64u.decode(A.asPrivate) });
    expect(b64u.encode(body)).toBe(A.body);
  });

  it("opens the RFC's example with the browser's secret", () => {
    const text = decryptPayload(b64u.decode(A.body), { privateKey: b64u.decode(A.uaPrivate), publicKey: b64u.decode(A.uaPublic), auth: b64u.decode(A.auth) });
    expect(text.toString("utf8")).toBe(A.plaintext);
  });

  it("round-trips Chinese text with fresh keys; every message has its own salt and server key", () => {
    const ua = newSubscriber();
    const words = JSON.stringify({ title: "早上的药", body: "还没记" });
    const one = encryptPayload(words, ua.keys);
    const two = encryptPayload(words, ua.keys, { padding: 30 });
    expect(one.equals(two)).toBe(false);
    expect(one.subarray(0, 16).equals(two.subarray(0, 16))).toBe(false);
    expect(one.readUInt32BE(16)).toBe(4096);
    expect(one.readUInt8(20)).toBe(65);
    expect(decryptPayload(one, ua).toString("utf8")).toBe(words);
    expect(decryptPayload(two, ua).toString("utf8")).toBe(words);
  });

  it("another browser's secret cannot open it, and a changed byte is refused", () => {
    const ua = newSubscriber();
    const other = newSubscriber();
    const body = encryptPayload("hello", ua.keys);
    expect(() => decryptPayload(body, other)).toThrow();
    const broken = Buffer.from(body);
    broken[broken.length - 1] ^= 1;
    expect(() => decryptPayload(broken, ua)).toThrow();
  });

  it("refuses keys that are not a browser's: a point off the curve, a short auth secret, too much text", () => {
    const ua = newSubscriber();
    const offCurve = Buffer.alloc(65, 1);
    offCurve[0] = 4;
    expect(isP256PublicKey(offCurve)).toBe(false);
    expect(isP256PublicKey(b64u.decode(ua.keys.p256dh))).toBe(true);
    expect(() => encryptPayload("x", { p256dh: b64u.encode(offCurve), auth: ua.keys.auth })).toThrow(/P-256/);
    expect(() => encryptPayload("x", { p256dh: ua.keys.p256dh, auth: b64u.encode(Buffer.alloc(8)) })).toThrow(/16 bytes/);
    expect(() => encryptPayload("x".repeat(4000), ua.keys)).toThrow(/too large/);
  });
});

describe("RFC 8292 VAPID", () => {
  const endpoint = "https://fcm.googleapis.com/fcm/send/abc:def";
  const now = Date.parse("2026-10-10T01:00:00Z");

  it("a header the push service accepts: ES256 signed, aud is the service's origin, exp within 24 h, sub mailto", () => {
    const pair = generateVapidKeys();
    expect(vapidPairMatches(pair)).toBe(true);
    const header = vapidAuthorization(endpoint, pair, "mailto:ripple@example.invalid", now);
    expect(header).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    const check = verifyVapidAuthorization(header, endpoint, now + 60_000);
    expect(check).toEqual({ ok: true, publicKey: pair.publicKey, claims: { aud: "https://fcm.googleapis.com", exp: Math.floor(now / 1000) + 12 * 3600, sub: "mailto:ripple@example.invalid" } });
  });

  it("refused: another server's key, another push service, an expired token, a key pair that does not match", () => {
    const pair = generateVapidKeys();
    const other = generateVapidKeys();
    const header = vapidAuthorization(endpoint, pair, "mailto:ripple@example.invalid", now);
    const swapped = header.replace(`k=${pair.publicKey}`, `k=${other.publicKey}`);
    expect(verifyVapidAuthorization(swapped, endpoint, now)).toEqual({ ok: false, why: "bad signature" });
    expect(verifyVapidAuthorization(header, "https://updates.push.services.mozilla.com/wpush/v2/x", now)).toMatchObject({ ok: false, why: expect.stringMatching(/aud/) });
    expect(verifyVapidAuthorization(header, endpoint, now + 13 * 3600 * 1000)).toMatchObject({ ok: false, why: expect.stringMatching(/exp/) });
    expect(verifyVapidAuthorization("WebPush abc", endpoint, now)).toMatchObject({ ok: false });
    expect(vapidPairMatches({ publicKey: pair.publicKey, privateKey: other.privateKey })).toBe(false);
    expect(vapidPairMatches({ publicKey: pair.publicKey, privateKey: "short" })).toBe(false);
  });
});
