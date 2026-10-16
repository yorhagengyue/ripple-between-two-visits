/**
 * Wei Ling's reminder recorder (components/family/ReminderRecorder.tsx): what its error line says. Client-safe, pure.
 *
 * Most failures are worth another tap on 「存下来给爸爸」 (the recording stays on the screen). Two are not, and say
 * so: POST /api/reminders refusing a clip from a device that is not hers (403 family_only), and a clip with no sound
 * after the WAV header (422 audio_empty: record again). Codes from lib/family/reminders.ts.
 */
import type { FamilyKey } from "./i18n";

export type SaveError = "retry" | "family_only" | "empty";

/** status and code: POST /api/reminders' answer (none for a network failure or a timeout). */
export function saveErrorFor(status: number | undefined, code: string | undefined): SaveError {
  if (status === 403 && code === "family_only") return "family_only";
  if (status === 422 && code === "audio_empty") return "empty";
  return "retry";
}

export function saveErrorKey(e: SaveError): FamilyKey {
  return e === "family_only" ? "rec.error.familyOnly" : e === "empty" ? "rec.error.empty" : "rec.error";
}
