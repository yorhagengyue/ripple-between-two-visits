/**
 * The recovery code's shape (track A; docs/plan/real-app.md 3.6), client-safe: the page checks what he typed before it
 * is sent, the server (lib/auth/recovery.ts) makes and hashes codes.
 *
 *   12 symbols from 32 (no 0, O, 1 or I: nothing to confuse), shown as XXXX-XXXX-XXXX; spaces, dashes, dots, lower
 *   case and full-width letters are fine when he types it.
 */

export const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const RECOVERY_CODE_LENGTH = 12;

/** "ABCDEFGHJKLM" -> "ABCD-EFGH-JKLM" */
export function formatRecoveryCode(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/** What he typed, as the 12 symbols, or null when it cannot be a code. */
export function normalizeRecoveryCode(input: string | null | undefined): string | null {
  const s = (input ?? "").normalize("NFKC").toUpperCase().replace(/[\s\-_.·・]/g, "");
  if (s.length !== RECOVERY_CODE_LENGTH) return null;
  for (const ch of s) if (!RECOVERY_ALPHABET.includes(ch)) return null;
  return s;
}
