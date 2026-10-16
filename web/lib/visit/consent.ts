/**
 * The card he shows the doctor before recording (real-app 2.12; tone v2 ③: 「FOR THE DOCTOR」, ink ground, white
 * English), and what the record of the doctor's answer keeps on an account (consent_record kind visit_recording:
 * granted or declined, method "tap", the card's version and its sha256 (lib/visit/pipeline.ts), the wall clock). The
 * demo keeps its consent item only.
 *
 * The card's words are fixed text, versioned: changing a word means a new version (the hash in every record says which
 * text the doctor saw). Client-safe.
 */

export const CONSENT_CARD_VERSION = "visit-card-2026-10-10";

/** What the doctor reads (English, as the clinic speaks it). */
export const CONSENT_CARD_EN = "May I record our talk today? It is only for me and my family, so we remember what you said.";

/** How long a visit recording is kept unless he chooses to keep it (real-app 2.12, journey 15). */
export const RETAIN_DAYS = 90;

/**
 * Is someone helping him on his device? (real-app 3.11: 「家人代操作时，同意必须由他本人点。记录里 assisted = true」.) What the
 * request says when it says anything (`asked`: the screen's own answer); otherwise what sign-up recorded about who was
 * tapping (track A's terms_privacy record, the one place every account was asked). `records` is a store that may read
 * his account rows.
 */
export async function helpedOnDevice(
  records: { listConsentRecords(userId: string, filter?: { kind?: "terms_privacy" }): Promise<{ assisted: boolean }[]> },
  userId: string,
  asked?: boolean,
): Promise<boolean> {
  if (typeof asked === "boolean") return asked;
  const signUp = await records.listConsentRecords(userId, { kind: "terms_privacy" }).catch(() => []);
  return signUp.at(-1)?.assisted === true;
}
