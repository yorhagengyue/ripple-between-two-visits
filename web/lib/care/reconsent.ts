/**
 * The family texts asked again (the owner, 2026-10-14: before real users, links bound under an older text are asked
 * again). Server-only; reads only (the two cards' writes are ./reconsent-agree.ts). Kept light: lib/subject imports it.
 *
 * The texts of 2026-10-14 (lib/care/consent.ts) widened what each switch shows her: the reason of a dose he did not
 * take in his words, each reading, the questions' words, a suggested question she can add to his list, Ripple's read of
 * a record she holds. A link that came about under an earlier version (2026-10-10, 2026-10-10.2, 2026-10-11) was agreed
 * to under narrower words. Until each of them has agreed to the text in force, her view of him is the alert-only form:
 * every switch read as off except no_reply_alert. His switches are not changed in the store.
 *
 *   linkConsent(store, link)         { his, hers }: has he agreed to the family_share text in force for this link,
 *                                    has she to the family_accept one. Two reads, side by side; `store` must be able to
 *                                    read both people's records (the process-wide store in lib/subject/resolve.ts,
 *                                    binding's narrow store elsewhere: lib/subject/bind.ts)
 *   consentOf(linkId, his, hers)     the rule itself, pure, from the two lists of records
 *   isHeld(consent)                  either has not agreed: her view is cut
 *   alertOnly(items)                 the switches as she may use them meanwhile
 *   waitingForHim(store, links)      his links in force whose text he has not agreed to (the card on his Today and on
 *                                    his family page)
 *
 * How a record names its link: evidence.link_id, on every record the links write (lib/care/links.ts, lib/care/bind.ts).
 * His are family_share records on his user id (the link's patient_id), hers family_accept records on hers (family_id).
 * The latest record of a side is the last one in the store's order (insertion order; the database's seq).
 *
 * The rule, for each side:
 *   it has records for this link    agreed when the latest is granted under FAMILY_CONSENT_VERSION (any of his records
 *                                   says so: his confirmation, his 「知道了」, a change of her switches, his card)
 *   it has none                     agreed when the other side has some. A link bound by account carries a record of
 *                                   the one who typed the account and none in the name of the one who did nothing
 *                                   (lib/care/bind.ts): that side never agreed to any words, so it has none to renew.
 *                                   A link bound under the version in force is therefore not affected at all, and one
 *                                   she bound that he has not answered yet stays under lib/care/ack.ts (the four
 *                                   default items until his 「知道了」), with its own card on his Today
 *   no record on either side        neither has agreed (a link made straight through the store: old test data)
 *
 * Where the cut is applied: lib/subject/resolve.ts reads linkConsent once per request of hers, in the round that reads
 * his scope row, and binds alertOnly into her scoped store; every reader of her switches goes through that store's
 * getFamilyGrant (lib/subject/scoped-store.ts). Her live stream takes the same function from that store for the switches
 * its events carry (lib/family/events.ts createFamilyStream).
 */
import { NO_GRANTS } from "@/lib/family/types";
import type { CareLinkRow, ConsentRecordRow, FamilyGrantItems, Store } from "@/lib/store/types";
import { FAMILY_CONSENT_VERSION } from "./consent";

/** Has each of them agreed to the family text in force for one link? */
export interface LinkConsent {
  /** he, to the family_share text in force */
  his: boolean;
  /** she, to the family_accept text in force */
  hers: boolean;
}

type Rec = Pick<ConsentRecordRow, "decision" | "version" | "evidence">;

/** The record names this link (evidence.link_id). */
export const namesLink = (r: Pick<ConsentRecordRow, "evidence">, linkId: string): boolean => (r.evidence as { link_id?: unknown } | null)?.link_id === linkId;

/** The latest of a side's records for one link is granted under the version in force. */
export const agreedNow = (mine: readonly Rec[]): boolean => {
  const last = mine.at(-1);
  return !!last && last.decision === "granted" && last.version === FAMILY_CONSENT_VERSION;
};

/** The rule (see the top of this file), from his family_share records and her family_accept records. Pure. */
export function consentOf(linkId: string, his: readonly Rec[], hers: readonly Rec[]): LinkConsent {
  const h = his.filter((r) => namesLink(r, linkId));
  const s = hers.filter((r) => namesLink(r, linkId));
  return { his: h.length ? agreedNow(h) : s.length > 0, hers: s.length ? agreedNow(s) : h.length > 0 };
}

/** Either of them has not agreed to the text in force: her view of him is the alert-only form. */
export function isHeld(consent: LinkConsent | null | undefined): boolean {
  return !!consent && !(consent.his && consent.hers);
}

/** The switches as she may use them while her link waits for both: every one off except the no-reply alert. */
export function alertOnly(items: FamilyGrantItems): FamilyGrantItems {
  return { ...NO_GRANTS, no_reply_alert: items.no_reply_alert === true };
}

/** One link's answer. A link without a family member yet has nobody to agree. */
export async function linkConsent(store: Pick<Store, "listConsentRecords">, link: Pick<CareLinkRow, "id" | "patient_id" | "family_id">): Promise<LinkConsent> {
  if (!link.family_id) return { his: false, hers: false };
  const [his, hers] = await Promise.all([store.listConsentRecords(link.patient_id, { kind: "family_share" }), store.listConsentRecords(link.family_id, { kind: "family_accept" })]);
  return consentOf(link.id, his, hers);
}

/**
 * His links in force (`links`, his rows) whose family_share text he has not agreed to. His records are read once, hers
 * once per family member; nothing is read when none is in force.
 */
export async function waitingForHim(store: Pick<Store, "listConsentRecords">, links: readonly Pick<CareLinkRow, "id" | "patient_id" | "family_id" | "status">[]): Promise<Set<string>> {
  const active = links.filter((l) => l.status === "active" && l.family_id);
  if (!active.length) return new Set();
  const people = [...new Set(active.map((l) => l.family_id as string))];
  const [his, ...theirs] = await Promise.all([
    store.listConsentRecords(active[0].patient_id, { kind: "family_share" }),
    ...people.map((id) => store.listConsentRecords(id, { kind: "family_accept" })),
  ]);
  const hers = new Map(people.map((id, i) => [id, theirs[i]]));
  return new Set(active.filter((l) => !consentOf(l.id, his, hers.get(l.family_id as string) ?? []).his).map((l) => l.id));
}

/**
 * For his pages: the first of `views` (his links as his screens list them) that is in force and whose text he has not
 * agreed to, or null. His link rows are read through his own store `own`; the records through `reader` (binding's narrow
 * store: hers are not his to read). Nothing is read when none of `views` is in force.
 */
export async function linkWaitingForHim<V extends { id: string; state: string }>(
  own: Pick<Store, "listCareLinks">,
  reader: Pick<Store, "listConsentRecords">,
  userId: string,
  views: readonly V[],
): Promise<V | null> {
  if (!views.some((v) => v.state === "active")) return null;
  const ids = await waitingForHim(reader, await own.listCareLinks({ patient_id: userId, status: ["active"] }));
  return views.find((v) => v.state === "active" && ids.has(v.id)) ?? null;
}
