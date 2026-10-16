/**
 * One "account" field (docs/plan/real-app.md 3.4): an address with an @ is an e-mail login, anything else a username.
 * An old man without an e-mail address signs in with a username; the identity service still needs an address, so a
 * username maps to <username>@AUTH_USERNAME_DOMAIN, a domain that never receives mail. Pure; client-safe.
 *
 *   email      trimmed, lower case, one @, a dot in the domain; never on the internal username domain
 *   username   NFKC (full-width letters become plain ones), lower case, ^[a-z0-9][a-z0-9._-]{2,31}$, not reserved;
 *              digits only are allowed (a phone number), but never used to reach him
 */

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const RESERVED_USERNAMES: readonly string[] = ["admin", "crew", "demo", "director", "support", "ripple", "system", "root"];
/** Default internal domain for usernames: ".invalid" can never be a real address (RFC 2606). */
export const DEFAULT_USERNAME_DOMAIN = "users.ripple.invalid";

export type LoginName = { kind: "email"; email: string } | { kind: "username"; username: string; email: string };

export type LoginNameError = "login_empty" | "username_invalid" | "username_reserved" | "email_invalid" | "email_reserved_domain";

/** The internal domain usernames map to (AUTH_USERNAME_DOMAIN, lower case). */
export function usernameDomain(env: Record<string, string | undefined> = process.env): string {
  const d = (env.AUTH_USERNAME_DOMAIN ?? "").trim().toLowerCase().replace(/^@/, "");
  return d || DEFAULT_USERNAME_DOMAIN;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What he typed in the account field, as a login (or why it is not one). */
export function parseLoginName(input: string, env: Record<string, string | undefined> = process.env): { ok: true; login: LoginName } | { ok: false; error: LoginNameError } {
  const raw = (input ?? "").normalize("NFKC").trim();
  if (!raw) return { ok: false, error: "login_empty" };
  const domain = usernameDomain(env);
  if (raw.includes("@")) {
    const email = raw.toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) return { ok: false, error: "email_invalid" };
    const at = email.slice(email.lastIndexOf("@") + 1);
    if (at === domain || at.endsWith(`.${domain}`)) return { ok: false, error: "email_reserved_domain" };
    return { ok: true, login: { kind: "email", email } };
  }
  const username = raw.toLowerCase();
  if (!USERNAME_RE.test(username)) return { ok: false, error: "username_invalid" };
  if (RESERVED_USERNAMES.includes(username)) return { ok: false, error: "username_reserved" };
  return { ok: true, login: { kind: "username", username, email: `${username}@${domain}` } };
}

/** The username behind an internal address, or null for a real e-mail address. */
export function usernameOfEmail(email: string, env: Record<string, string | undefined> = process.env): string | null {
  const domain = usernameDomain(env);
  const e = email.trim().toLowerCase();
  return e.endsWith(`@${domain}`) ? e.slice(0, -domain.length - 1) : null;
}
