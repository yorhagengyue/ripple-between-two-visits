/**
 * The password rule (docs/plan/real-app.md 3.4): 8 to 72, no composition rules, not a common password, not the login
 * itself. Client-safe and pure: the sign-up page checks as he types, the server checks again.
 *
 *   NFKC first     full-width letters and digits from a Chinese keyboard are the plain ones (the in-memory provider
 *                  hashes the NFKC form; the routes send the NFKC form to Supabase as well, so both agree)
 *   8 characters   counted as he sees them (a Chinese character is one)
 *   72 bytes       bcrypt's limit (Supabase Auth): counted in UTF-8, so 24 Chinese characters is the most
 */
import { isCommonPassword } from "./common-passwords";
import type { LoginName } from "./login-name";

export const PASSWORD_MIN_CHARS = 8;
export const PASSWORD_MAX_BYTES = 72;

export type PasswordProblem = "password_short" | "password_long" | "password_common" | "password_like_login";

/** The password as it is stored and checked. */
export function normalizePassword(password: string): string {
  return (password ?? "").normalize("NFKC");
}

function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/** Why this new password is refused, or null when it is fine. `login`: the login it is for (not allowed as the password). */
export function passwordProblem(password: string, login?: LoginName | null): PasswordProblem | null {
  const p = normalizePassword(password);
  if ([...p].length < PASSWORD_MIN_CHARS) return "password_short";
  if (utf8Length(p) > PASSWORD_MAX_BYTES) return "password_long";
  if (login) {
    const lower = p.toLowerCase();
    const name = login.kind === "username" ? login.username : login.email;
    const local = login.email.slice(0, login.email.indexOf("@"));
    if (lower === name || lower === local || lower === login.email) return "password_like_login";
  }
  if (isCommonPassword(p)) return "password_common";
  return null;
}
