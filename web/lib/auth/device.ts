/**
 * The device cookie (docs/plan/real-app.md 3.4, 3.5): rp_device is a random id the account routes give a browser the
 * first time it signs up, logs in or recovers, kept 400 days. The server stores only its sha256 (known_device, the
 * session registry), never the id itself. It is what the lockout counts per ("账号 × 设备") and what his devices page
 * groups by. Server-only.
 */
import { createHash, randomBytes } from "node:crypto";

export const DEVICE_COOKIE = "rp_device";
/** 400 days: the longest a browser keeps a cookie. */
export const DEVICE_COOKIE_MAX_S = 400 * 24 * 3600;

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{32}$/;

/** A new random device id (24 bytes, base64url: 32 characters). */
export function newDeviceId(): string {
  return randomBytes(24).toString("base64url");
}

/** A cookie value that is one of ours (anything else is ignored and replaced). */
export function isDeviceId(value: string | null | undefined): value is string {
  return typeof value === "string" && DEVICE_ID_RE.test(value);
}

/** What the server stores for a device: hex sha256 of its id. */
export function deviceHash(deviceId: string): string {
  return createHash("sha256").update(`rp_device:${deviceId}`, "utf8").digest("hex");
}

/** The short, opaque name a page uses for one of his devices (a prefix of the hash; never the cookie). */
export function deviceRef(hash: string): string {
  return hash.slice(0, 16);
}

/**
 * A plain name for the device from its User-Agent: "iPhone · Safari", "Android · Chrome", "Windows · Edge". Product
 * names only (the same in both languages); null when nothing is recognised. Never shown as proof of anything.
 */
export function deviceLabel(userAgent: string | null | undefined): string | null {
  const ua = userAgent ?? "";
  if (!ua) return null;
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS X/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  const browser = /MicroMessenger/.test(ua)
    ? "WeChat"
    : /Edg\//.test(ua)
      ? "Edge"
      : /Firefox\//.test(ua) || /FxiOS\//.test(ua)
        ? "Firefox"
        : /SamsungBrowser\//.test(ua)
          ? "Samsung Internet"
          : /CriOS\//.test(ua) || /Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : null;
  if (!os && !browser) return null;
  return [os, browser].filter(Boolean).join(" · ");
}
