/**
 * This server's VAPID keys (C2 track I; RFC 8292). Server-only.
 *
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY   the key pair, base64url (public 65 bytes uncompressed, private 32 bytes).
 *                                         Make one with:
 *                                           node -e "const c=require('crypto').createECDH('prime256v1');c.generateKeys();
 *                                             console.log('VAPID_PUBLIC_KEY='+c.getPublicKey('base64url'));
 *                                             console.log('VAPID_PRIVATE_KEY='+c.getPrivateKey('base64url'))"
 *                                         and put both in web/.env (never in git). A browser's subscription is bound to
 *                                         the public key it subscribed with: changing the pair ends every subscription
 *                                         (the push service answers 403 until the phone subscribes again).
 *   VAPID_SUBJECT                         who to contact about this sender: "mailto:…" or "https://…" (Apple's push
 *                                         service requires one); default mailto:ripple@users.ripple.invalid.
 *
 * Without the pair:
 *   - developer tools on (next dev, tests, the recording build with RIPPLE_DEV_TOOLS=1): one key pair is made for this
 *     process and logged once as dev keys; subscriptions made against it end when the process ends (so do the
 *     in-memory store's rows);
 *   - otherwise push is off: GET /api/push/key answers 503 push_unavailable, the sender sends nothing and warns once.
 * A pair that is set but malformed, or whose halves do not belong together, is treated as missing (warned once).
 */
import { devToolsEnabled } from "@/lib/dev/enabled";
import { generateVapidKeys, vapidPairMatches, type VapidKeyPair } from "./crypto";

export const DEFAULT_VAPID_SUBJECT = "mailto:ripple@users.ripple.invalid";

export interface VapidConfig extends VapidKeyPair {
  subject: string;
  /** made for this process because none was set (developer tools only) */
  dev: boolean;
}

type GlobalWithVapid = typeof globalThis & { __rippleVapidDev?: VapidKeyPair; __rippleVapidWarned?: Set<string> };

function warnOnce(key: string, message: string): void {
  const g = globalThis as GlobalWithVapid;
  g.__rippleVapidWarned ??= new Set();
  if (g.__rippleVapidWarned.has(key)) return;
  g.__rippleVapidWarned.add(key);
  console.warn(`[push] ${message}`);
}

function subjectOf(env: Record<string, string | undefined>): string {
  const s = (env.VAPID_SUBJECT ?? "").trim();
  if (/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(s)) return s;
  if (s) warnOnce("subject", "VAPID_SUBJECT must start with mailto: or https:// (using the default)");
  return DEFAULT_VAPID_SUBJECT;
}

/** The keys to sign with and to hand browsers, or null when push is off here. */
export function vapidConfig(env: Record<string, string | undefined> = process.env): VapidConfig | null {
  const publicKey = (env.VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = (env.VAPID_PRIVATE_KEY ?? "").trim();
  if (publicKey || privateKey) {
    if (vapidPairMatches({ publicKey, privateKey })) return { publicKey, privateKey, subject: subjectOf(env), dev: false };
    warnOnce("pair", "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not a matching P-256 pair (base64url): treated as not set");
  }
  if (!devToolsEnabled(env)) {
    warnOnce("off", "VAPID keys are not set: web push is off (reminders show only when the app is open)");
    return null;
  }
  const g = globalThis as GlobalWithVapid;
  if (!g.__rippleVapidDev) {
    g.__rippleVapidDev = generateVapidKeys();
    console.log("[push] dev VAPID keys made for this process (set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY for real ones)");
  }
  return { ...g.__rippleVapidDev, subject: subjectOf(env), dev: true };
}
