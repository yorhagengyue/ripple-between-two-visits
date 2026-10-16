/**
 * The developer tools' way to make and sign in test accounts (C2 foundation): POST /api/dev/accounts and
 * POST /api/dev/login. Off unless the developer tools are on (lib/dev/enabled.ts): every call throws otherwise.
 * Server-only. Real sign-up and log-in are track A's routes.
 */
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type NewTestAccount, type TestAccount } from "@/lib/auth/dev-accounts";
import { parseLoginName } from "@/lib/auth/login-name";
import { AuthError, type AuthTokens } from "@/lib/auth/provider";
import { assertDevTools } from "@/lib/dev/enabled";
import { getStore } from "@/lib/store";

export type { NewTestAccount, TestAccount };

export async function createDevAccount(input: NewTestAccount): Promise<TestAccount> {
  assertDevTools("Test accounts");
  return createAccountWithSpace(getStore(), getAuthProvider(), input);
}

/** Sign an existing test account in; null when the login or password is wrong. */
export async function devSignIn(login: string, password: string): Promise<AuthTokens | null> {
  assertDevTools("Test sign-in");
  const parsed = parseLoginName(login);
  if (!parsed.ok) return null;
  try {
    return await getAuthProvider().signInWithPassword(parsed.login.email, password);
  } catch (err) {
    if (err instanceof AuthError && err.code === "invalid_credentials") return null;
    throw err;
  }
}
