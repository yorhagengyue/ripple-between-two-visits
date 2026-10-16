/**
 * The Web Push protocol, both ends (C2 track I; real-app 2.24). Server-only (node:crypto). No dependency.
 *
 *   RFC 8291  message encryption: one aes128gcm record (RFC 8188) keyed by ECDH P-256 between a fresh key pair of
 *             ours and the browser's p256dh key, salted with the browser's 16-byte auth secret.
 *   RFC 8292  VAPID: an ES256 JWT { aud: the push service's origin, exp, sub } in `Authorization: vapid t=…, k=…`, so
 *             the push service knows the message comes from the server whose public key the browser subscribed with.
 *
 * encryptPayload / vapidAuthorization are what the sender uses. decryptPayload / verifyVapidAuthorization are the
 * browser's and the push service's side: the unit tests and the journey's local push service use them to prove a
 * message would open on a real phone (tests/unit/push/crypto.test.ts pins both directions to RFC 8291 Appendix A).
 *
 * Keys travel as base64url (no padding), as browsers give them (PushSubscription.toJSON().keys) and as the VAPID
 * public key goes to PushManager.subscribe({ applicationServerKey }).
 */
import { createCipheriv, createDecipheriv, createECDH, createHmac, createPrivateKey, createPublicKey, randomBytes, sign, verify } from "node:crypto";

/** Bytes per record; one record carries the whole message (push services take at most 4096 bytes of body). */
export const RECORD_SIZE = 4096;
const TAG_LENGTH = 16;
const HEADER_FIXED = 21; // salt 16, rs 4, idlen 1

export const b64u = {
  encode: (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url"),
  decode: (text: string): Buffer => Buffer.from(text, "base64url"),
};

/** The browser's keys for one subscription (PushSubscription.toJSON().keys). */
export interface SubscriptionKeys {
  /** its P-256 public key, uncompressed (65 bytes), base64url */
  p256dh: string;
  /** its 16-byte auth secret, base64url */
  auth: string;
}

const hmac = (key: Uint8Array, data: Uint8Array): Buffer => createHmac("sha256", key).update(data).digest();
const ONE = Buffer.from([1]);

/** Is this a P-256 public key point (uncompressed, on the curve)? */
export function isP256PublicKey(bytes: Uint8Array): boolean {
  if (bytes.length !== 65 || bytes[0] !== 4) return false;
  try {
    // computing a secret with it fails for a point that is not on the curve
    const probe = createECDH("prime256v1");
    probe.generateKeys();
    probe.computeSecret(Buffer.from(bytes));
    return true;
  } catch {
    return false;
  }
}

/** The content key and nonce of RFC 8291 section 3.4 (with RFC 8188's HKDF for aes128gcm). */
function contentKeys(ecdhSecret: Buffer, authSecret: Buffer, uaPublic: Buffer, asPublic: Buffer, salt: Buffer): { cek: Buffer; nonce: Buffer } {
  // HKDF-Extract(auth_secret, ecdh_secret), HKDF-Expand(PRK_key, "WebPush: info" 0x00 ua_public as_public, 32)
  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0", "latin1"), uaPublic, asPublic]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, ONE]));
  // HKDF-Extract(salt, IKM); CEK and NONCE from it
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: aes128gcm\0", "latin1"), ONE])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: nonce\0", "latin1"), ONE])).subarray(0, 12);
  return { cek, nonce };
}

export interface EncryptOptions {
  /** test vectors only: a fixed salt (16 bytes); otherwise random */
  salt?: Uint8Array;
  /** test vectors only: our ECDH private key (32 bytes); otherwise a fresh key pair per message */
  asPrivateKey?: Uint8Array;
  /** zero bytes of padding after the delimiter (hides the length a little); default 0 */
  padding?: number;
}

/** The body of one Web Push message to `keys` (Content-Encoding: aes128gcm). Throws when it would not fit. */
export function encryptPayload(plaintext: Uint8Array | string, keys: SubscriptionKeys, opts: EncryptOptions = {}): Buffer {
  const data = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : Buffer.from(plaintext);
  const uaPublic = b64u.decode(keys.p256dh);
  const authSecret = b64u.decode(keys.auth);
  if (!isP256PublicKey(uaPublic)) throw new Error("p256dh is not a P-256 public key");
  if (authSecret.length !== 16) throw new Error("auth is not 16 bytes");
  const ecdh = createECDH("prime256v1");
  if (opts.asPrivateKey) ecdh.setPrivateKey(Buffer.from(opts.asPrivateKey));
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const salt = opts.salt ? Buffer.from(opts.salt) : randomBytes(16);
  if (salt.length !== 16) throw new Error("salt must be 16 bytes");
  const { cek, nonce } = contentKeys(ecdh.computeSecret(uaPublic), authSecret, uaPublic, asPublic, salt);
  // one record, so it is the last one: the delimiter is 0x02, then optional zero padding
  const padded = Buffer.concat([data, Buffer.from([2]), Buffer.alloc(Math.max(0, opts.padding ?? 0))]);
  if (HEADER_FIXED + asPublic.length + padded.length + TAG_LENGTH > RECORD_SIZE) throw new Error("payload too large for a push message");
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const sealed = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(HEADER_FIXED);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, sealed]);
}

/** The browser's side of one subscription: what it needs to open a message. */
export interface SubscriberSecret {
  /** P-256 private key (32 bytes) */
  privateKey: Uint8Array;
  /** the matching public key, uncompressed (65 bytes) */
  publicKey: Uint8Array;
  /** the 16-byte auth secret */
  auth: Uint8Array;
}

/**
 * The 32-byte P-256 private key of an ECDH object. Node's getPrivateKey() drops leading zero bytes, so about one key in
 * 256 came out as 31 bytes (a 42-character base64url key that VAPID signing and the RFC 8291 test helpers then refuse).
 */
export function privateKey32(ecdh: { getPrivateKey(): Buffer }): Buffer {
  const d = ecdh.getPrivateKey();
  return d.length >= 32 ? d : Buffer.concat([Buffer.alloc(32 - d.length), d]);
}

/** A fresh subscriber key set (what a browser makes when it subscribes), for tests and the journey's push service. */
export function newSubscriber(): SubscriberSecret & { keys: SubscriptionKeys } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const publicKey = ecdh.getPublicKey();
  return { privateKey: privateKey32(ecdh), publicKey, auth, keys: { p256dh: b64u.encode(publicKey), auth: b64u.encode(auth) } };
}

/** Open a message body (aes128gcm, one record) with the subscriber's secret: the browser's side, for tests. */
export function decryptPayload(body: Uint8Array, secret: SubscriberSecret): Buffer {
  const buf = Buffer.from(body);
  if (buf.length < HEADER_FIXED) throw new Error("body too short");
  const salt = buf.subarray(0, 16);
  const rs = buf.readUInt32BE(16);
  const idlen = buf.readUInt8(20);
  const asPublic = buf.subarray(HEADER_FIXED, HEADER_FIXED + idlen);
  const record = buf.subarray(HEADER_FIXED + idlen);
  if (record.length > rs || record.length <= TAG_LENGTH) throw new Error("expected exactly one record");
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(secret.privateKey));
  const { cek, nonce } = contentKeys(ecdh.computeSecret(asPublic), Buffer.from(secret.auth), Buffer.from(secret.publicKey), asPublic, salt);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - TAG_LENGTH));
  const padded = Buffer.concat([decipher.update(record.subarray(0, record.length - TAG_LENGTH)), decipher.final()]);
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  if (end < 0 || padded[end] !== 2) throw new Error("no last-record delimiter");
  return padded.subarray(0, end);
}

// ---------------------------------------------------------------- VAPID (RFC 8292)

/** The application server's key pair, base64url: public 65 bytes uncompressed, private 32 bytes. */
export interface VapidKeyPair {
  publicKey: string;
  privateKey: string;
}

/** A new VAPID key pair (to put in VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, or for a dev process). */
export function generateVapidKeys(): VapidKeyPair {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64u.encode(ecdh.getPublicKey()), privateKey: b64u.encode(privateKey32(ecdh)) };
}

/** Does this private key belong to this public key (both base64url)? */
export function vapidPairMatches(pair: VapidKeyPair): boolean {
  try {
    const priv = b64u.decode(pair.privateKey);
    if (priv.length !== 32) return false;
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(priv);
    return ecdh.getPublicKey().equals(b64u.decode(pair.publicKey));
  } catch {
    return false;
  }
}

function jwkOf(publicKey: Buffer, privateKey?: Buffer) {
  return {
    kty: "EC",
    crv: "P-256",
    x: b64u.encode(publicKey.subarray(1, 33)),
    y: b64u.encode(publicKey.subarray(33, 65)),
    ...(privateKey ? { d: b64u.encode(privateKey) } : {}),
  };
}

/** How long a VAPID token lives (RFC 8292 allows at most 24 h; push services check it against real time). */
export const VAPID_TOKEN_S = 12 * 3600;

/**
 * The Authorization header for one request to `endpoint`: `vapid t=<ES256 JWT>, k=<public key>`. `realNowMs` must be
 * real time (Date.now()), never the developer test clock: the push service compares exp with its own clock.
 */
export function vapidAuthorization(endpoint: string, pair: VapidKeyPair, subject: string, realNowMs: number = Date.now()): string {
  const aud = new URL(endpoint).origin;
  const header = b64u.encode(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u.encode(Buffer.from(JSON.stringify({ aud, exp: Math.floor(realNowMs / 1000) + VAPID_TOKEN_S, sub: subject })));
  const input = `${header}.${claims}`;
  const key = createPrivateKey({ key: jwkOf(b64u.decode(pair.publicKey), b64u.decode(pair.privateKey)), format: "jwk" });
  const signature = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${input}.${b64u.encode(signature)}, k=${pair.publicKey}`;
}

export type VapidCheck = { ok: true; publicKey: string; claims: { aud: string; exp: number; sub: string } } | { ok: false; why: string };

/** The push service's check of a VAPID header (tests and the journey's local push service). */
export function verifyVapidAuthorization(header: string | null | undefined, endpoint: string, realNowMs: number = Date.now()): VapidCheck {
  const m = /^vapid\s+t=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\s*,\s*k=([A-Za-z0-9_-]+)\s*$/.exec(header ?? "");
  if (!m) return { ok: false, why: "not a vapid header" };
  const [, token, publicKey] = m;
  const [h, c, s] = token.split(".");
  let claims: { aud?: unknown; exp?: unknown; sub?: unknown };
  try {
    const head = JSON.parse(b64u.decode(h).toString("utf8")) as { alg?: unknown };
    if (head.alg !== "ES256") return { ok: false, why: "alg is not ES256" };
    claims = JSON.parse(b64u.decode(c).toString("utf8"));
  } catch {
    return { ok: false, why: "unreadable token" };
  }
  const pub = b64u.decode(publicKey);
  if (!isP256PublicKey(pub)) return { ok: false, why: "k is not a P-256 key" };
  const key = createPublicKey({ key: jwkOf(pub), format: "jwk" });
  if (!verify("sha256", Buffer.from(`${h}.${c}`), { key, dsaEncoding: "ieee-p1363" }, b64u.decode(s))) return { ok: false, why: "bad signature" };
  if (claims.aud !== new URL(endpoint).origin) return { ok: false, why: "aud is not the push service's origin" };
  const now = Math.floor(realNowMs / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= now || claims.exp > now + 24 * 3600) return { ok: false, why: "exp missing, past, or more than 24 h away" };
  if (typeof claims.sub !== "string" || !/^(mailto:|https:)/.test(claims.sub)) return { ok: false, why: "sub is not mailto: or https:" };
  return { ok: true, publicKey, claims: { aud: claims.aud, exp: claims.exp, sub: claims.sub } };
}
