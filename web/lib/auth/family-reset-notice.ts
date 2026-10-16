/**
 * 「爸爸在重设密码」: the notice a family member gets when he asks her to help him reset his password (docs/plan/real-app.md
 * 2.24 通知一览 last row, 2.4 step 3; track A). Built the way the scheduled jobs' notices are (lib/jobs/notify.ts):
 *
 *   who      every family member of his whose link is active and whose helper switch he turned on
 *   once     a reminder_delivery row in his scope (kind family_reset_help, ref = her link id, slot = the request id):
 *            the same request never notifies the same person twice, whatever retries
 *   words    the lock screen says 「爸爸在重设密码」 (how she calls him; 「家人」 without a name) and 「打开 Ripple 看看」:
 *            no code, no account name, nothing about his records. Her label for him still goes through the
 *            lock-screen rule (lib/push/payload.ts): a name that looks like a medicine or a dose is replaced by the
 *            plain fallback words.
 *   tap      /f?link=<her link>, where her page asks 「爸爸在重设密码，要帮他吗？」
 *   checked  again right before sending (mayHelpReset: the link is still active, his and hers, the switch still on),
 *            like her "no reply" alert (track I's sender calls it)
 *
 * The 6-digit code is never in a notice: she gets it only by tapping 「帮」 on her own signed-in page.
 * Sending is best effort: asking for help works without it (she can simply open Ripple).
 */
import { sendNotice, type Notice } from "@/lib/jobs/notify";
import type { CareLinkRow, ResetRequestRow, SessionRow, Store } from "@/lib/store/types";
import { careEntryStore, type CareEntryStore } from "@/lib/subject/care";

/** The reminder_delivery kind (and the notice kind). */
export const RESET_HELP_KIND = "family_reset_help";

const WORDS = {
  "zh-Hans": { title: (who: string) => `${who}在重设密码`, body: "打开 Ripple 看看", who: "家人" },
  en: { title: (who: string) => `${who} is resetting their password`, body: "Open Ripple to see it", who: "Your family member" },
} as const;

/** The lock-screen words for one helper, in her language. */
export function resetHelpWords(patientLabel: string | null | undefined, locale: "zh-Hans" | "en"): { title: string; body: string } {
  const w = WORDS[locale];
  return { title: w.title(patientLabel?.trim() || w.who), body: w.body };
}

/** The notice for one helper. */
export function resetHelpNotice(input: { scopeId: string; link: Pick<CareLinkRow, "id" | "family_id" | "patient_label">; request: Pick<ResetRequestRow, "id">; deliveryId: string; locale: "zh-Hans" | "en"; ttlS: number }): Notice {
  const words = resetHelpWords(input.link.patient_label, input.locale);
  return {
    kind: RESET_HELP_KIND,
    to: { role: "family", userId: input.link.family_id ?? "", linkId: input.link.id },
    title: words.title,
    body: words.body,
    url: `/f?link=${encodeURIComponent(input.link.id)}`,
    tag: `reset-help-${input.request.id}`,
    ttlS: input.ttlS,
    deliveryId: input.deliveryId,
    scopeId: input.scopeId,
    locale: input.locale,
  };
}

/** May this notice go to her through this link now? (active, his and hers, his helper switch on). Never throws: false. */
export async function mayHelpReset(to: { scopeId: string; userId: string; linkId: string }, deps: { store?: CareEntryStore } = {}): Promise<boolean> {
  try {
    const link = await (deps.store ?? careEntryStore()).getCareLink(to.linkId);
    return !!link && link.status === "active" && link.patient_id === to.scopeId && link.family_id === to.userId && link.reset_helper === true;
  } catch {
    return false;
  }
}

export type NoticeSend = (notice: Notice, store: Store) => Promise<{ sent: number }>;

/**
 * Tell his helpers he is asking: one delivery row and one notice per helper, once per request. Returns how many notices
 * were handed to the sender. Never throws (a failure here must not stop him from asking).
 */
export async function announceFamilyHelp(store: Store, scope: SessionRow | null, helpers: readonly CareLinkRow[], request: ResetRequestRow, ttlS: number, send: NoticeSend = sendNotice): Promise<number> {
  if (!scope) return 0;
  let handed = 0;
  for (const link of helpers) {
    if (!link.family_id) continue;
    try {
      const { created, delivery } = await store.recordDelivery(scope.id, { kind: RESET_HELP_KIND, ref: link.id, day: scope.story_day, slot: request.id });
      if (!created) continue;
      const locale = (await store.getAccount(link.family_id).catch(() => null))?.locale === "en" ? "en" : "zh-Hans";
      await send(resetHelpNotice({ scopeId: scope.id, link, request, deliveryId: delivery.id, locale, ttlS }), store);
      handed += 1;
    } catch (err) {
      console.warn(`[auth] a family reset notice could not be sent: ${err instanceof Error ? err.message.slice(0, 120) : "error"}`);
    }
  }
  return handed;
}
