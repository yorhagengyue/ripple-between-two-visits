/**
 * Sending to a person's phones (C2 track I; real-app 2.24). Server-only.
 *
 *   pushToUser(port, userId, built, opts)   every subscription of that person (or one endpoint): send, delete the
 *                                           ones the push service says are gone (404, 410), count. Routes use it with
 *                                           the person's own scoped store (requireUser): 「发一条试试」, the welcome push.
 *   createWebPushSender({ port })           the sender of the scheduled jobs' notices (lib/jobs/notify.ts
 *                                           registerNoticeSender, done in lib/push/register.ts): his reminders and her
 *                                           "no reply" alert, with the lock-screen rule (lib/push/payload.ts), her
 *                                           link and his switch checked again at send time (track D's mayNotifyFamily),
 *                                           and a push.sent event (counts only).
 *
 * Where the subscriptions come from is the caller's: a SubscriptionPort. The jobs give the push sender's narrow store
 * (lib/subject/push.ts: a job reaches his and her phones, which its system-mode store does not hand out); a route gives
 * the signed-in person's own rows only (ownSubscriptions). Each endpoint is checked again before sending
 * (lib/push/endpoint.ts), so a row stored under other rules is never called. Logs carry counts and status codes, never
 * words, endpoints or ids.
 */
import { publish } from "@/lib/bus";
import { mayNotifyFamily, mayTellFamily } from "@/lib/care/recipients";
// C2 track A (only add): the check for 「爸爸在重设密码」 (real-app 2.24)
import { mayHelpReset as mayHelpResetNow } from "@/lib/auth/family-reset-notice";
import { devToolsEnabled } from "@/lib/dev/enabled";
import type { Notice, NoticeSender } from "@/lib/jobs/notify";
import { medName } from "@/lib/session/today";
import type { PushSubscriptionRow, Store } from "@/lib/store/types";
import { checkEndpoint } from "./endpoint";
import { payloadFromNotice, type BuiltPayload } from "./payload";
import { sendPush, type PushResult } from "./send";
import { vapidConfig, type VapidConfig } from "./vapid";

/**
 * How long a push service may hold any notice (s): real-app 2.24 「推送有效期 1 小时」. A reminder, her alert or
 * 「Wei Ling 已经接受」 that could not reach the phone within the hour is dropped by the push service; what it was
 * about is still on the page when the app is opened. A notice may ask for less, never for more.
 */
export const MAX_HOLD_S = 3600;

/** Where a person's subscriptions are read and removed. */
export interface SubscriptionPort {
  list(userId: string): Promise<PushSubscriptionRow[]>;
  remove(userId: string, endpoint: string): Promise<void>;
}

/** Subscriptions from a store that reaches anyone's (the scheduled jobs: lib/subject/push.ts pushEntryStore). */
export function storeSubscriptions(store: Pick<Store, "listPushSubscriptions" | "deletePushSubscription">): SubscriptionPort {
  return {
    list: (userId) => store.listPushSubscriptions(userId),
    remove: (_userId, endpoint) => store.deletePushSubscription(endpoint),
  };
}

/** The signed-in person's own subscriptions, through their scoped store (requireUser): nobody else's. */
export function ownSubscriptions(store: Store, userId: string): SubscriptionPort {
  return {
    list: async (id) => (id === userId ? store.listPushSubscriptions(userId) : []),
    remove: async (id, endpoint) => {
      if (id === userId) await store.deleteOwnPushSubscription(userId, endpoint);
    },
  };
}

export interface PushDeps {
  vapid?: () => VapidConfig | null;
  fetchImpl?: typeof fetch;
  devTools?: () => boolean;
  timeoutMs?: number;
}

export interface PushCounts {
  /** subscriptions the push service took */
  sent: number;
  /** subscriptions removed because the push service no longer knows them */
  gone: number;
  /** subscriptions that failed this time (kept) */
  failed: number;
  /** endpoints refused by the allow-list (kept untouched, never called) */
  refused: number;
  /** push is off here (no VAPID keys) */
  off: boolean;
}

/** Send one payload to every subscription of `userId` (or only `opts.endpoint`). */
export async function pushToUser(
  port: SubscriptionPort,
  userId: string,
  built: BuiltPayload,
  opts: { ttlS: number; topic?: string; endpoint?: string; urgency?: "normal" | "high" },
  deps: PushDeps = {},
): Promise<PushCounts> {
  const counts: PushCounts = { sent: 0, gone: 0, failed: 0, refused: 0, off: false };
  const vapid = (deps.vapid ?? vapidConfig)();
  if (!vapid) return { ...counts, off: true };
  const devTools = (deps.devTools ?? devToolsEnabled)();
  const subs = (await port.list(userId)).filter((s) => !opts.endpoint || s.endpoint === opts.endpoint);
  const text = JSON.stringify(built.payload);
  const results = await Promise.all(
    subs.map(async (s): Promise<PushResult | "refused"> => {
      if (!checkEndpoint(s.endpoint, { devTools }).ok) return "refused";
      return sendPush(s, text, { ttlS: opts.ttlS, topic: opts.topic, urgency: opts.urgency ?? "high", vapid, fetchImpl: deps.fetchImpl, timeoutMs: deps.timeoutMs });
    }),
  );
  for (let i = 0; i < subs.length; i++) {
    const r = results[i];
    if (r === "refused") counts.refused += 1;
    else if (r.sent) counts.sent += 1;
    else if (r.gone) {
      counts.gone += 1;
      await port.remove(userId, subs[i].endpoint).catch(() => undefined);
    } else counts.failed += 1;
  }
  if (counts.failed || counts.refused) console.warn(`[push] ${built.payload.kind}: ${counts.sent} sent, ${counts.failed} failed, ${counts.refused} refused`);
  return counts;
}

/** His medicine names (the lock-screen rule checks against them too); [] when they cannot be read. */
async function namesOnHisList(store: Store, scopeId: string): Promise<string[]> {
  try {
    const meds = await store.listMeds(scopeId);
    const names = new Set<string>();
    for (const m of meds) {
      names.add(medName(m));
      if (m.label?.drug) names.add(m.label.drug);
      if (m.drug_id) names.add(m.drug_id);
    }
    return [...names];
  } catch {
    return [];
  }
}

export interface SenderOptions {
  port: () => SubscriptionPort;
  deps?: PushDeps;
  /** her link and his switch, checked right before her alert goes (default track D's mayNotifyFamily) */
  mayNotify?: (to: { scopeId: string; userId: string; linkId: string }, kind: "family_no_reply") => Promise<boolean>;
  /** C2 track A (only add): her link and his helper switch, checked right before 「爸爸在重设密码」 goes */
  mayHelpReset?: (to: { scopeId: string; userId: string; linkId: string }) => Promise<boolean>;
  /** owner 10-16 (only add): her link only, no switch (the baseline), checked right before 「爸爸跟 Ripple 说了…」 goes */
  mayTell?: (to: { scopeId: string; userId: string; linkId: string }) => Promise<boolean>;
}

/**
 * The scheduled jobs' sender. `store` is the one the job hands over (bound to his scope: his medicine names are read
 * through it); the subscriptions come from `port`, his for his reminders, hers for her alert.
 */
export function createWebPushSender(opts: SenderOptions): NoticeSender {
  const mayNotify = opts.mayNotify ?? ((to, kind) => mayNotifyFamily(to, kind));
  const mayHelpReset = opts.mayHelpReset ?? ((to) => mayHelpResetNow(to));
  const mayTell = opts.mayTell ?? ((to) => mayTellFamily(to));
  return async (notice: Notice, store: Store) => {
    if (notice.to.role === "family") {
      const to = { scopeId: notice.scopeId, userId: notice.to.userId, linkId: notice.to.linkId };
      // the switch may have gone off, or the link ended, since the job recorded the delivery
      const ok =
        (notice.kind === "family_no_reply" && (await mayNotify(to, "family_no_reply"))) ||
        // C2 track A (only add): his helper switch for her link, the same way
        (notice.kind === "family_reset_help" && (await mayHelpReset(to))) ||
        // owner 10-16 (only add): what he told Ripple that may need attention: her link still his and hers, no switch
        (notice.kind === "family_told" && (await mayTell(to)));
      if (!ok) return { sent: 0 };
    }
    const built = payloadFromNotice(notice, { medicineNames: await namesOnHisList(store, notice.scopeId) });
    if (built.replaced) console.warn(`[push] ${notice.kind}: words failed the lock-screen rule; the plain fallback was sent instead`);
    const counts = await pushToUser(opts.port(), notice.to.userId, built, { ttlS: Math.min(notice.ttlS, MAX_HOLD_S), topic: notice.tag }, opts.deps);
    if (counts.sent > 0 || counts.gone > 0) {
      try {
        // the backstage line (counts only); her phone's stream drops push.* events (lib/family/events.ts)
        publish(notice.scopeId, "push.sent", `A ${notice.kind.replace(/_/g, " ")} notification went to ${counts.sent} device(s).`, {
          kind: notice.kind,
          count: counts.sent,
          to: notice.to.role,
        });
      } catch {
        // the bus is best effort here: the delivery row is the record
      }
    }
    return { sent: counts.sent };
  };
}
