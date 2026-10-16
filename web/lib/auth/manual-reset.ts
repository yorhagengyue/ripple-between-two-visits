/**
 * The team's manual password reset (docs/plan/real-app.md 3.6 「人工重设第一期不对外提供。scripts/auth/reset-password.ts 只给
 * 团队自己的测试账号和拍摄账号用，留 account_event」; track A). Server-only; the script is the only caller. It is not a
 * support channel: nobody outside the team can ask for it, and no route reaches it.
 *
 * Which accounts: a filming account (its space has filming_mode on), or a login the operator names in
 * RIPPLE_MANUAL_RESET_LOGINS (comma-separated, exact logins: the team's own test accounts). Anything else is refused
 * with not_allowed. What it does: the new password (the same rules as everywhere), every session of that account
 * ended, and an account event password_reset { method: "manual" } (his Today page says the team reset it).
 */
import type { Env } from "@/lib/dev/enabled";
import type { Store } from "@/lib/store/types";
import { parseLoginName } from "./login-name";
import { normalizePassword, passwordProblem } from "./passwords";
import type { AuthProvider } from "./provider";

export type ManualResetResult = { ok: true; login: string; sessionsEnded: number } | { ok: false; error: "bad_login" | "not_found" | "not_allowed" | "password_short" | "password_long" | "password_common" | "password_like_login" };

/** The logins the operator allowed by name (lower case). */
export function allowedLogins(env: Env = process.env): string[] {
  return (env.RIPPLE_MANUAL_RESET_LOGINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function manualPasswordReset(d: { store: Store; auth: AuthProvider; env?: Env }, input: { login: string; password: string }): Promise<ManualResetResult> {
  const env = d.env ?? process.env;
  const parsed = parseLoginName(input.login, env);
  if (!parsed.ok) return { ok: false, error: "bad_login" };
  const shown = parsed.login.kind === "username" ? parsed.login.username : parsed.login.email;
  const userId = parsed.login.kind === "username" ? ((await d.store.getAccountByUsername(parsed.login.username))?.user_id ?? null) : await d.auth.findUserIdByEmail(parsed.login.email);
  const account = userId ? await d.store.getAccount(userId) : null;
  if (!account) return { ok: false, error: "not_found" };
  const scope = await d.store.getSession(account.user_id).catch(() => null);
  const filming = !!scope && scope.kind === "account" && scope.filming === true;
  if (!filming && !allowedLogins(env).includes(shown)) return { ok: false, error: "not_allowed" };
  const password = normalizePassword(input.password);
  const problem = passwordProblem(password, parsed.login);
  if (problem) return { ok: false, error: problem };
  await d.auth.updatePassword(account.user_id, password);
  const sessionsEnded = await d.auth.endSessions(account.user_id, { reason: "manual_reset" });
  await d.store.addAccountEvent(account.user_id, "password_reset", { method: "manual", by: "team" });
  return { ok: true, login: shown, sessionsEnded };
}
