/**
 * The scheduled notices' way to a person's phones (C2 track I; real-app 2.24). Server-only.
 *
 * A job's store is bound to his scope in system mode (lib/jobs/runner.ts forEachAccountScope), which has no user: it
 * cannot read push subscriptions (keyed by user id), neither his for his reminders nor hers for her "no reply" alert,
 * and it cannot delete the one a push service answered 410 for. Only the web push sender uses this narrow store, for
 * exactly that:
 *
 *   listPushSubscriptions(userId)      the phones of the person a notice is for
 *   deletePushSubscription(endpoint)   the push service no longer knows this phone (404, 410)
 *
 * Everything else throws ScopeViolation. Routes never use it: a person's own subscribe, unsubscribe and test go through
 * their own scoped store (requireUser). Built like the care flow's way in (lib/subject/care.ts).
 */
import { getStore } from "@/lib/store";
import { isAccount } from "@/lib/store/scope";
import type { SessionRow, Store } from "@/lib/store/types";
import { systemSubject } from "./resolve";
import { ScopeViolation, type ScopedStore } from "./scoped-store";

/** The methods the web push sender may use outside a scope binding. */
export type PushEntryStore = Pick<Store, "kind" | "listPushSubscriptions" | "deletePushSubscription">;

const ALLOWED = new Set(["listPushSubscriptions", "deletePushSubscription"]);

/** The narrow push store over a given store (tests) or the process-wide one. */
export function pushEntryStore(base: Store = getStore()): PushEntryStore {
  return new Proxy(base, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || typeof value !== "function") return value;
      if (!ALLOWED.has(prop)) {
        return () => {
          throw new ScopeViolation(prop, "is not part of the push sender's way in");
        };
      }
      return (...args: unknown[]) => (value as (...a: unknown[]) => unknown).apply(target, args);
    },
  }) as PushEntryStore;
}

/**
 * His space for a notice that no scheduled job raises (C2 track I, follow-up; real-app 2.24 「家人接受了」): she accepts
 * his invitation in her own request, where no store reaches his space (her link is not active yet). The notice needs
 * what a job gets for him (lib/jobs/runner.ts forEachAccountScope, lib/jobs/daily.ts patientLocale) and nothing more:
 *
 *   scope    his scope row, "today" computed (the delivery row's day)
 *   store    bound to his scope in system mode: the delivery row is written through it, and the sender reads his
 *            medicine names through it for the lock-screen rule
 *   locale   his language (his account's, else his scope's setting, else 华语)
 *
 * null when the id is not an account's own space.
 */
export interface NoticeScope {
  scope: SessionRow;
  store: ScopedStore;
  locale: "zh-Hans" | "en";
}

export async function noticeScope(scopeId: string, base: Store = getStore()): Promise<NoticeScope | null> {
  const scope = await base.getSession(scopeId).catch(() => null);
  if (!scope || !isAccount(scope) || !scope.owner_user_id) return null;
  const account = await base.getAccount(scope.owner_user_id).catch(() => null);
  const said = account?.locale ?? (typeof scope.settings?.locale === "string" ? scope.settings.locale : null);
  return { scope, store: systemSubject(base, scope).store, locale: said === "en" ? "en" : "zh-Hans" };
}

/**
 * Whether any phone of this person has notifications on (C2 track I, follow-up; real-app 3.10: on his switches screen,
 * 「她还没打开通知，收不到」). One yes or no about a family member whose link is his, asked by his own page after it has
 * checked the link (components/push/HerPushLine.tsx); never an endpoint, a count or a time.
 */
export async function hasPushSubscription(userId: string, base: Store = getStore()): Promise<boolean> {
  try {
    return (await base.listPushSubscriptions(userId)).length > 0;
  } catch {
    // unknown: say nothing rather than claim she cannot be reached
    return true;
  }
}
