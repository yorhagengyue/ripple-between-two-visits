/**
 * How the app addresses him and in which language (real-app 2.23 「我」: 称呼、语言). Track C. Server-only.
 *
 *   称呼   what he answered at sign-up 「怎么称呼你」 (account.display_name). Changing it on 「我」 writes the account row
 *          and, like every fact about him, a profile fact (kind name, source patient). On an account that runs on the
 *          example data the profile is Mr Tan's (「陈先生（示例）」): its facts are left alone, only his own account's
 *          name changes.
 *   语言   华语 or English: the account's language (what his reminders are sent in, lib/jobs/daily.ts), his space's
 *          settings.locale, and this browser's rp_lang cookie (set by the route).
 * The store is his own scoped store: it lets a subject change only his own account row.
 */
import type { Locale } from "@/lib/i18n";
import type { SessionRow, Store } from "@/lib/store/types";
import { addFact, cleanFactText, isShown, ProfileInputError } from "./facts";

export const NAME_MAX = 40;

/** 称呼 as typed: trimmed, 1 to 40 characters (the sign-up screen's rule). */
export function cleanName(name: string): string {
  const t = cleanFactText(name);
  if ([...t].length > NAME_MAX) throw new ProfileInputError("text_too_long");
  return t;
}

/** How the app addresses him: his account's name; without one, the name in his profile; else null. */
export async function hisName(store: Store, scope: SessionRow): Promise<string | null> {
  const account = await store.getAccount(scope.id).catch(() => null);
  const own = account?.display_name?.trim();
  if (own) return own;
  if (scope.example_data) return null;
  return (await store.listProfileFacts(scope.id)).find((f) => f.kind === "name" && isShown(f))?.text ?? null;
}

/** Change 称呼: the account row, and the name fact of his own profile (not the example's). Returns the name saved. */
export async function saveHisName(store: Store, scope: SessionRow, name: string): Promise<string> {
  const clean = cleanName(name);
  await store.updateAccount(scope.id, { display_name: clean });
  if (!scope.example_data) {
    // one shown name fact: one that already says this stays (whoever wrote it); otherwise his own row carries the new
    // words and a family member's earlier one is put away
    const shown = (await store.listProfileFacts(scope.id)).filter((f) => f.kind === "name" && isShown(f));
    const keep = shown.find((f) => f.text === clean) ?? shown.find((f) => f.source === "patient");
    for (const f of shown) if (f !== keep) await store.updateProfileFact(scope.id, f.id, { hidden: true });
    if (!keep) await addFact(store, scope, { kind: "name", text: clean }, { kind: "patient" });
    else if (keep.text !== clean) await store.updateProfileFact(scope.id, keep.id, { text: clean });
  }
  return clean;
}

/** Change 语言: the account's language and his space's. The caller sets the browser's cookie. */
export async function saveHisLanguage(store: Store, scope: SessionRow, locale: Locale): Promise<SessionRow> {
  await store.updateAccount(scope.id, { locale });
  return store.updateScope(scope.id, { settings: { locale } });
}
