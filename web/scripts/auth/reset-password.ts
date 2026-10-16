/**
 * The team's manual password reset (docs/plan/real-app.md 3.6; track A). For the team's own test accounts and the
 * filming accounts only: it is not offered to anyone outside, and no route reaches it (lib/auth/manual-reset.ts has the
 * rule and the test).
 *
 *   cd web && RIPPLE_NEW_PASSWORD='...' npx tsx scripts/auth/reset-password.ts <login>
 *
 *   <login>                       the account's login (a username or an e-mail address)
 *   RIPPLE_NEW_PASSWORD           the new password, from the environment so it is never in the shell history's
 *                                 argument list or in a process listing; never printed
 *   RIPPLE_MANUAL_RESET_LOGINS    logins that may be reset although they are not filming accounts (comma-separated,
 *                                 exact): name the team's test account here on purpose
 *
 * It uses the store and identity provider this environment is configured for (web/.env: STORE, AUTH_PROVIDER, the
 * Supabase keys). It sets the password, ends every session of that account and writes an account event
 * password_reset { method: "manual" }; the account's Today page then says the team reset it.
 * Exit codes: 0 done; 1 refused (the reason is printed, never the password); 2 usage.
 */
import { getAuthProvider } from "@/lib/auth";
import { manualPasswordReset } from "@/lib/auth/manual-reset";
import { getStore } from "@/lib/store";

async function main(): Promise<number> {
  const login = process.argv[2]?.trim();
  const password = process.env.RIPPLE_NEW_PASSWORD ?? "";
  if (!login || login.startsWith("-") || !password) {
    process.stderr.write("usage: RIPPLE_NEW_PASSWORD='...' npx tsx scripts/auth/reset-password.ts <login>\n");
    return 2;
  }
  const r = await manualPasswordReset({ store: getStore(), auth: getAuthProvider() }, { login, password });
  if (!r.ok) {
    process.stderr.write(`refused: ${r.error}\n`);
    return 1;
  }
  process.stdout.write(`${JSON.stringify({ ok: true, login: r.login, sessions_ended: r.sessionsEnded })}\n`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`failed: ${err instanceof Error ? err.message.slice(0, 160) : "error"}\n`);
    process.exit(1);
  },
);
