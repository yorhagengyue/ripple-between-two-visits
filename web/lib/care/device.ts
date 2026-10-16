/**
 * What her phone keeps for her, on her phone only (C2 track D; real-app 2.21 「『打电话给爸爸』的号码由她自己存一次，存在
 * 她这边」): Dad's number per link, and whether she has been through the first-visit steps. Never sent to the server.
 * Client-safe; every access is wrapped (private windows and blocked storage simply keep nothing).
 */

const PHONE = (linkId: string) => `rp_f_phone_${linkId}`;
const WELCOMED = (linkId: string) => `rp_f_welcomed_${linkId}`;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // storage blocked: nothing kept
  }
}

/** A phone number as she typed it, when it looks like one: 6 to 15 digits, with +, spaces, dashes or brackets. */
export function cleanPhone(raw: string): string | null {
  const t = raw.normalize("NFKC").trim();
  if (!/^[+\d][\d\s\-()]*$/.test(t)) return null;
  const digits = t.replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 15 ? t.replace(/\s+/g, " ") : null;
}

export const savedPhone = (linkId: string) => read(PHONE(linkId));
export const savePhone = (linkId: string, phone: string | null) => write(PHONE(linkId), phone);
export const welcomed = (linkId: string) => read(WELCOMED(linkId)) === "1";
export const markWelcomed = (linkId: string) => write(WELCOMED(linkId), "1");
