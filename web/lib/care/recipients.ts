/**
 * Who may get a notice about him (C2 track D for track I's web push; real-app 3.10 「两次没回」推送). Server-only.
 *
 *   familyRecipients(scopeId)                     every active link of his: her user id, the link, her label, how she
 *                                                 calls him, her language and whether his no-reply switch is on for
 *                                                 that link
 *   mayNotifyFamily({ scopeId, userId, linkId }, "family_no_reply")
 *                                                 the check right before sending: the link is active, it is his and
 *                                                 hers, and his switch for that notice is on now. Call it at send time
 *                                                 (the switch may have gone off since the job recorded the delivery).
 *   recipientsFrom(links, switches, locales)      the rule itself, pure (what the two above apply)
 *
 * The scheduled job's store is bound to his scope in system mode, which has no user and so cannot read care links;
 * these read links through the care flow's own narrow store (lib/subject/care.ts) unless one is passed in. Nothing
 * here returns a scope id, a token or anything about his health.
 */
import type { CareLinkRow, FamilyGrantItems } from "@/lib/store/types";
import { careEntryStore, type CareEntryStore } from "@/lib/subject/care";
import type { FamilyRecipient } from "./types";

/** Which of his switches allows which notice to her. */
export const NOTICE_SWITCH = { family_no_reply: "no_reply_alert" } as const satisfies Record<string, keyof FamilyGrantItems>;
export type FamilyNoticeKind = keyof typeof NOTICE_SWITCH;

const asLocale = (v: string | null | undefined): "zh-Hans" | "en" => (v === "en" ? "en" : "zh-Hans");

/** The recipients among `links` (only active links with a family member), in link order. Pure. */
export function recipientsFrom(
  links: readonly Pick<CareLinkRow, "id" | "status" | "family_id" | "family_label" | "patient_label" | "confirmed_at">[],
  switches: ReadonlyMap<string, Partial<FamilyGrantItems> | null | undefined>,
  locales: ReadonlyMap<string, string | null | undefined>,
): FamilyRecipient[] {
  const out: FamilyRecipient[] = [];
  for (const l of links) {
    if (l.status !== "active" || !l.family_id) continue;
    out.push({
      userId: l.family_id,
      linkId: l.id,
      label: l.family_label,
      patientLabel: l.patient_label,
      locale: asLocale(locales.get(l.family_id)),
      noReplyAlert: switches.get(l.id)?.no_reply_alert === true,
      confirmedAt: l.confirmed_at,
    });
  }
  return out;
}

/** Every active link of the patient whose account scope this is (an account's scope id is his user id). */
export async function familyRecipients(scopeId: string, deps: { store?: CareEntryStore } = {}): Promise<FamilyRecipient[]> {
  const store = deps.store ?? careEntryStore();
  const links = await store.listCareLinks({ patient_id: scopeId, status: ["active"] });
  const switches = new Map<string, FamilyGrantItems | null>();
  const locales = new Map<string, string | null>();
  for (const l of links) {
    switches.set(l.id, (await store.getFamilyGrant(scopeId, l.id))?.items ?? null);
    if (l.family_id && !locales.has(l.family_id)) locales.set(l.family_id, (await store.getAccount(l.family_id).catch(() => null))?.locale ?? null);
  }
  return recipientsFrom(links, switches, locales);
}

/**
 * May 「爸爸跟 Ripple 说了一件可能要留意的事」 (lib/care/told.ts) go to her through this link now? The link is active, his and
 * hers. BASELINE (owner 10-16): no switch of his is read; this notice reaches every family member bound to him. Never
 * throws: false.
 */
export async function mayTellFamily(to: { scopeId: string; userId: string; linkId: string }, deps: { store?: CareEntryStore } = {}): Promise<boolean> {
  try {
    const store = deps.store ?? careEntryStore();
    const link = await store.getCareLink(to.linkId);
    return !!link && link.status === "active" && link.patient_id === to.scopeId && link.family_id === to.userId;
  } catch {
    return false;
  }
}

/** May this notice go to her through this link now? (active, his and hers, his switch for it on). Never throws: false. */
export async function mayNotifyFamily(
  to: { scopeId: string; userId: string; linkId: string },
  kind: FamilyNoticeKind,
  deps: { store?: CareEntryStore } = {},
): Promise<boolean> {
  try {
    const store = deps.store ?? careEntryStore();
    const link = await store.getCareLink(to.linkId);
    if (!link || link.status !== "active" || link.patient_id !== to.scopeId || link.family_id !== to.userId) return false;
    const grant = await store.getFamilyGrant(to.scopeId, link.id);
    return grant?.items[NOTICE_SWITCH[kind]] === true;
  } catch {
    return false;
  }
}
