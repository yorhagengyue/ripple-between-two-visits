/**
 * The pushes a person asks for themselves (C2 track I; real-app 2.6, 2.23). Server-only.
 *
 *   welcome   right after a phone subscribes: 「提醒已经开好了」, so he sees one arrive (only that phone)
 *   test      「发一条试试」 on his notifications page (his phones, or one)
 *
 * Both go through the person's own scoped store (requireUser): their own subscriptions, nobody else's. Where a tap
 * lands: his notifications page; hers, her family page.
 */
import { LOCALE_COOKIE, toLocale } from "@/lib/i18n";
import type { AccountRow, Store } from "@/lib/store/types";
import { buildPayload, OWN_WORDS, type PushLocale } from "./payload";
import { ownSubscriptions, pushToUser, type PushCounts, type PushDeps } from "./sender";

/** The language of a push for this person: their account's, else the page language cookie, else 华语. */
export function pushLocaleFor(account: Pick<AccountRow, "locale"> | null, cookies: { get(name: string): { value: string } | undefined }): PushLocale {
  const fromAccount = account?.locale === "en" ? "en" : account?.locale === "zh-Hans" ? "zh-Hans" : null;
  return fromAccount ?? toLocale(cookies.get(LOCALE_COOKIE)?.value, "zh-Hans");
}

export async function sendOwnPush(
  store: Store,
  userId: string,
  kind: "welcome" | "test",
  opts: { locale: PushLocale; patient: boolean; endpoint?: string },
  deps: PushDeps = {},
): Promise<PushCounts> {
  const words = OWN_WORDS[opts.patient ? "patient" : "family"][opts.locale][kind];
  const built = buildPayload({
    kind,
    title: words.title,
    body: words.body,
    url: opts.patient ? "/p/me/notifications" : "/f",
    tag: `ripple-${kind}`,
    locale: opts.locale,
    renotify: true,
  });
  return pushToUser(ownSubscriptions(store, userId), userId, built, { ttlS: 600, topic: `ripple-${kind}`, endpoint: opts.endpoint, urgency: "normal" }, deps);
}
