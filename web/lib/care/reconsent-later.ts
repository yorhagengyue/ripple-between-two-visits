/**
 * 「先不」 on his card of the family texts asked again (components/his-family/ReconsentAnswer; lib/care/reconsent.ts):
 * the card is closed for the rest of his day, on that phone. A cookie, not a record: nothing of it is written anywhere,
 * and his pages read it before they draw the card (on Today the card is the whole screen while it is there). Client-safe,
 * no imports.
 */
export const RECONSENT_LATER_COOKIE = "rp_rc_later";

/** He closed the card on this phone today: the cookie holds his date (YYYY-MM-DD) and it is `today`. */
export function closedToday(cookie: string | null | undefined, today: string): boolean {
  if (!cookie) return false;
  try {
    return decodeURIComponent(cookie) === today;
  } catch {
    return false;
  }
}
