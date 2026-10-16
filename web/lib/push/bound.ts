/**
 * 「Wei Ling 绑定了你的账号」: his phone is told when a family member binds his account by typing it (line bind; direct
 * mode of lib/care/bind.ts). Server-only. Built the way 「Wei Ling 已经接受」 is (lib/push/accepted.ts):
 *
 *   once        a reminder_delivery row in his space (kind family_bound, ref = the link, slot "bind"): a link is bound
 *               once, and a second call for the same link sends nothing
 *   the words   the name on the link (her own name as she gave it when she signed up: lib/care/bind.ts keeps it only
 *               when it reads as a name, else her account name; without one, 「有人」) and 「绑定了你的账号」; then
 *               what to do: open it, and remove the person if he does not know them. No clinical word; the lock-screen
 *               rule (lib/push/payload.ts) still checks them, because the name is free text someone else typed
 *   the tap     /p/today?confirm=1: his Today page, on the card 「Wei Ling 绑定了你的账号」 with 「知道了」 and
 *               「不认识这个人，解除」 (components/his-family/BoundCard.tsx); `confirm` puts that card first even while
 *               a medicine slot is waiting for him
 *   his phones  only the ones he turned reminders on for (his own push subscriptions)
 *   how long    the push service may hold it for an hour; after that the card on Today still says it
 *
 * The notice goes out under the family notice kind that exists (the payload's `kind` is family_accepted: a new notice
 * kind would have to be added to lib/jobs/notify.ts, the notifications page and the lock-screen inventory, which are
 * other lines'). What happened is on the delivery row, which has its own kind. That kind is not one of the kinds his
 * notifications page lists (lib/push/deliveries.ts HIS_KINDS), so the tap does not mark it opened and the page does not
 * list it under words that would be wrong for it.
 *
 * Never throws: the binding stands whether or not his phone could be told.
 */
import { sendNotice, type Notice } from "@/lib/jobs/notify";
import type { CareLinkRow, Store } from "@/lib/store/types";
import { noticeScope, type NoticeScope } from "@/lib/subject/push";
import { ACCEPTED_URL, FAMILY_ACCEPTED } from "./accepted";

/** Where the tap lands: Today, with the card first (the address 「已经接受」 uses; Today finds the link that waits). */
export const BOUND_URL = ACCEPTED_URL;

/** reminder_delivery kind and slot of this notice (ref = the link's id). */
export const FAMILY_BOUND = "family_bound";
export const BIND_SLOT = "bind";

const WORDS = {
  "zh-Hans": {
    title: (name: string) => `${name} 绑定了你的账号`,
    body: "点开看看对方能看到什么。不认识就解除。",
    someone: "有人",
  },
  en: {
    title: (name: string) => `${name} linked to your account`,
    body: "Open to see what they can see. Remove them if you do not know them.",
    someone: "Someone",
  },
} as const;

/** The lock-screen words (the name on the link; without one, 「有人」). */
export function boundWords(familyLabel: string | null | undefined, locale: "zh-Hans" | "en"): { title: string; body: string } {
  const w = WORDS[locale];
  const name = (familyLabel ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || w.someone;
  return { title: w.title(name), body: w.body };
}

export interface BoundDeps {
  /** his space, a store bound to it and his language (default lib/subject/push.ts noticeScope) */
  scopeFor?: (scopeId: string) => Promise<NoticeScope | null>;
  /** where the notice goes (default lib/jobs/notify.ts sendNotice: the registered web push sender) */
  send?: (notice: Notice, store: Store) => Promise<{ sent: number }>;
}

export type BoundResult = { recorded: boolean; sent: number };

/** Tell him, once, that the person behind `link` bound his account. `link` is the row once it is in force (status active). */
export async function notifyFamilyBound(link: Pick<CareLinkRow, "id" | "patient_id" | "family_label" | "status">, deps: BoundDeps = {}): Promise<BoundResult> {
  try {
    if (link.status !== "active") return { recorded: false, sent: 0 };
    const his = await (deps.scopeFor ?? noticeScope)(link.patient_id);
    const owner = his?.scope.owner_user_id;
    if (!his || !owner) return { recorded: false, sent: 0 };
    const { scope, store, locale } = his;
    const { created, delivery } = await store.recordDelivery(scope.id, { kind: FAMILY_BOUND, ref: link.id, day: scope.story_day, slot: BIND_SLOT });
    if (!created) return { recorded: false, sent: 0 };
    const words = boundWords(link.family_label, locale);
    const notice: Notice = {
      kind: FAMILY_ACCEPTED,
      to: { role: "patient", userId: owner },
      title: words.title,
      body: words.body,
      url: BOUND_URL,
      tag: `family-bound-${link.id}`,
      ttlS: 3600,
      deliveryId: delivery.id,
      scopeId: scope.id,
      locale,
    };
    const { sent } = await (deps.send ?? sendNotice)(notice, store);
    return { recorded: true, sent };
  } catch (err) {
    console.warn(`[push] family_bound: not sent (${err instanceof Error ? err.name : "error"})`);
    return { recorded: false, sent: 0 };
  }
}
