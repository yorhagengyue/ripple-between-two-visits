/**
 * 「Wei Ling 已经接受」: his phone is told when she accepts his invitation (C2 track I, follow-up; real-app 2.20 step 4
 * and the 2.24 table's row 「家人接受了」). Server-only. Built the way the scheduled notices are (lib/daily/dose-run.ts):
 *
 *   once        a reminder_delivery row in his space (kind family_accepted, ref = the link, slot "accept"): an
 *               invitation is accepted once, and a second call for the same link sends nothing
 *   the words   his own name for her and 「已经接受」, in his language. No clinical word; the lock-screen rule
 *               (lib/push/payload.ts) still checks them, because the name is free text he typed
 *   the tap     /p/today?confirm=1: his Today page, on the card 「Wei Ling 接受了邀请，是她吗？」 (real-app 2.20 step 4
 *               「点开落在这张卡上」; C2 track D, round two: it used to be /p/family). `confirm` puts that card first
 *               even while a medicine slot is waiting for him (app/p/today). The tap marks the row opened
 *               (POST /api/push/opened: one of his own kinds, lib/push/deliveries.ts)
 *   his phones  only the ones he turned reminders on for: the sender goes to his own push subscriptions, and a phone he
 *               turned them off on has none. There is no other notification setting of his.
 *   how long    the push service may hold it for an hour (real-app 2.24: 推送有效期 1 小时); after that the card on
 *               「家人」 and the line on 「我」 still say she accepted
 *
 * Never throws: her acceptance stands whether or not his phone could be told.
 */
import { sendNotice, type Notice } from "@/lib/jobs/notify";
import type { CareLinkRow, Store } from "@/lib/store/types";
import { noticeScope, type NoticeScope } from "@/lib/subject/push";

/** Where the tap lands (C2 track D): Today, with the confirm card first. No link id in the address: Today finds the one that waits. */
export const ACCEPTED_URL = "/p/today?confirm=1";

/** reminder_delivery kind and slot of this notice (ref = the link's id). */
export const FAMILY_ACCEPTED = "family_accepted";
export const ACCEPT_SLOT = "accept";

const WORDS = {
  "zh-Hans": {
    title: (name: string) => `${name} 已经接受`,
    body: "点开确认一下：你确认以前，对方什么都看不到。",
    someone: "家人",
  },
  en: {
    title: (name: string) => `${name} has accepted`,
    body: "Open to confirm. Until you do, they see nothing.",
    someone: "Your family member",
  },
} as const;

/** The lock-screen words (his name for her; without one, 「家人」). */
export function acceptedWords(familyLabel: string | null | undefined, locale: "zh-Hans" | "en"): { title: string; body: string } {
  const w = WORDS[locale];
  const name = (familyLabel ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || w.someone;
  return { title: w.title(name), body: w.body };
}

export interface AcceptedDeps {
  /** his space, a store bound to it and his language (default lib/subject/push.ts noticeScope) */
  scopeFor?: (scopeId: string) => Promise<NoticeScope | null>;
  /** where the notice goes (default lib/jobs/notify.ts sendNotice: the registered web push sender) */
  send?: (notice: Notice, store: Store) => Promise<{ sent: number }>;
}

export type AcceptedResult = { recorded: boolean; sent: number };

/** Tell him, once, that the person behind `link` accepted. `link` is the row after acceptInvite (status accepted). */
export async function notifyInviteAccepted(link: Pick<CareLinkRow, "id" | "patient_id" | "family_label" | "status">, deps: AcceptedDeps = {}): Promise<AcceptedResult> {
  try {
    if (link.status !== "accepted") return { recorded: false, sent: 0 };
    const his = await (deps.scopeFor ?? noticeScope)(link.patient_id);
    const owner = his?.scope.owner_user_id;
    if (!his || !owner) return { recorded: false, sent: 0 };
    const { scope, store, locale } = his;
    const { created, delivery } = await store.recordDelivery(scope.id, { kind: FAMILY_ACCEPTED, ref: link.id, day: scope.story_day, slot: ACCEPT_SLOT });
    if (!created) return { recorded: false, sent: 0 };
    const words = acceptedWords(link.family_label, locale);
    const notice: Notice = {
      kind: FAMILY_ACCEPTED,
      to: { role: "patient", userId: owner },
      title: words.title,
      body: words.body,
      url: ACCEPTED_URL,
      tag: `family-accepted-${link.id}`,
      ttlS: 3600,
      deliveryId: delivery.id,
      scopeId: scope.id,
      locale,
    };
    const { sent } = await (deps.send ?? sendNotice)(notice, store);
    return { recorded: true, sent };
  } catch (err) {
    console.warn(`[push] family_accepted: not sent (${err instanceof Error ? err.name : "error"})`);
    return { recorded: false, sent: 0 };
  }
}
