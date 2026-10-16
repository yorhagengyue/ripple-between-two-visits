/**
 * Making a test account in one call (C2 foundation): the identity, the app's account row, a space (blank, Mr Tan's
 * example data on today's dates, or none for a family member), the usual consents, and a signed-in token pair. For
 * unit tests, the e2e and the journey recordings (POST /api/dev/accounts, lib/subject/dev.ts), never for real sign-up:
 * that is track A's route, with its rate limits, recovery code and consent screens. Server-only.
 *
 * A step that fails after the identity was created removes it again, so no half account is left behind.
 */
import { seedAccount } from "@/lib/story/example";
import { DEFAULT_TZ, localDate } from "@/lib/time/clock";
import { nowMs as appNowMs } from "@/lib/time/now";
import type { AccountRow, ConsentKind, OnboardingState, SessionRow, Store } from "@/lib/store/types";
import { parseLoginName, type LoginName } from "./login-name";
import { AuthError, type AuthProvider, type AuthTokens } from "./provider";

export type TestSpace = "blank" | "example" | "none";

export interface NewTestAccount {
  /** a username ("mr.tan") or an e-mail address */
  login: string;
  password: string;
  display_name?: string | null;
  locale?: string | null;
  /** default "blank" */
  space?: TestSpace;
  /** default "done" when a space is made (the onboarding screens are skipped); null: not started */
  onboarding?: OnboardingState | null;
  /** his "today" (YYYY-MM-DD in Singapore) for day 0 / the example's dates; default: today by the app's clock */
  today?: string;
  /** consents recorded as granted (method "dev_helper"); default terms_privacy and ai_processing, plus example_data */
  consents?: ConsentKind[];
  /** C2 track C: sign-up's 「家人帮我操作」 (the consents are recorded with assisted = true, as track A's sign-up does) */
  assisted?: boolean;
}

export interface TestAccount {
  userId: string;
  login: LoginName;
  account: AccountRow;
  /** his space; null for space "none" */
  scope: SessionRow | null;
  tokens: AuthTokens;
}

export async function createAccountWithSpace(store: Store, auth: AuthProvider, input: NewTestAccount, opts: { nowMs?: number } = {}): Promise<TestAccount> {
  const parsed = parseLoginName(input.login);
  if (!parsed.ok) throw new AuthError("invalid", parsed.error);
  const login = parsed.login;
  const space = input.space ?? "blank";
  const now = opts.nowMs ?? appNowMs();
  const today = input.today ?? localDate(now, DEFAULT_TZ);

  const user = await auth.createUser({
    email: login.email,
    password: input.password,
    app_metadata: { login_kind: login.kind, ...(login.kind === "username" ? { username: login.username } : {}) },
  });
  try {
    const account = await store.createAccount({
      user_id: user.id,
      login_kind: login.kind,
      username: login.kind === "username" ? login.username : null,
      display_name: input.display_name ?? null,
      locale: input.locale ?? null,
    });
    let scope: SessionRow | null = null;
    const onboarding = input.onboarding === undefined ? "done" : input.onboarding;
    // C2 track C: both spaces are laid out by seedAccount (lib/story/example.ts), the same call as track A's sign-up,
    // so a test account's example data (profile facts, pattern question) is exactly a signed-up one's
    if (space === "blank" || space === "example") {
      scope = await seedAccount(store, { userId: user.id, space, nowMs: now, today, onboarding });
    }
    const kinds = input.consents ?? (["terms_privacy", "ai_processing", ...(space === "example" ? (["example_data"] as const) : [])] as ConsentKind[]);
    for (const kind of kinds) {
      await store.addConsentRecord({ user_id: user.id, scope_id: scope?.id ?? null, kind, decision: "granted", version: "dev", method: "dev_helper", assisted: input.assisted === true });
    }
    const tokens = await auth.signInWithPassword(login.email, input.password);
    return { userId: user.id, login, account, scope, tokens };
  } catch (err) {
    await store.deleteAccount(user.id).catch(() => {});
    await auth.deleteUser(user.id).catch(() => {});
    throw err;
  }
}
