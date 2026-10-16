/**
 * Has he acknowledged a family link? (Line bind; the safety rule of binding by account.) Server-only; reads only.
 *
 * A family member can bind his account by typing its name (lib/care/bind.ts): the link is in force at once, and he has
 * done nothing. Anyone who knows his account name can do that. So one rule stands between such a link and his phone
 * (the integrator's corrected rule, 2026-10-11):
 *
 *   a link is UNACKNOWLEDGED only when both hold:
 *     1  his account has an account event `family_bound` with `by: "family"` that names it: the mark that a family
 *        member bound it by her own act (lib/care/bind.ts writes the mark before the link comes into force)
 *     2  he has no `family_share` granted record that names it
 *   every other link is acknowledged, as before this rule existed: one he invited her to and confirmed, one he bound
 *   himself, one made straight through the store.
 *
 *   a link she bound gets his record when he taps 「知道了」 (method direct_bind_ack), changes a switch (the existing
 *   record of a switch change, method family_switches) or, in confirm mode, taps 「是她」 (method family_confirm)
 *
 * While a link is unacknowledged she may read what the four default switches show, and nothing she does may reach his
 * phone: her voice reminder (POST /api/reminders, POST /api/reminders/[id]/use) and a fact she proposes (POST
 * /api/profile/facts) are refused with 409 link_not_acknowledged. Nobody but him can make that record.
 *
 * His events and records are his own rows: his pages read them through his own store. Her routes cannot (the scoped
 * store hands a person only her own rows), so they ask through binding's narrow store (lib/subject/bind.ts).
 */
import type { AccountEventRow, CareLinkRow, ConsentRecordRow, Store } from "@/lib/store/types";
import type { PatientLinkView } from "./types";

/** What her writes are refused with while his answer is missing. */
export const LINK_NOT_ACKNOWLEDGED = "link_not_acknowledged";

/** The account event both accounts get when a link is bound by account (detail: { link_id, by }; his with `items` when she bound). */
export const FAMILY_BOUND_EVENT = "family_bound";

/**
 * The account event on HIS account when he removes a link a family member bound and he never acknowledged (detail:
 * { link_id }). It stands in the place of a consent withdrawal: he never gave a consent for that link, so there is none
 * to withdraw (lib/care/links.ts revokeLinkAs).
 */
export const FAMILY_BOUND_REMOVED_EVENT = "family_bound_removed";

/** The links his account events mark as bound by a family member's own act. */
export function boundByFamilyIds(events: readonly Pick<AccountEventRow, "kind" | "detail">[]): Set<string> {
  const out = new Set<string>();
  for (const e of events) {
    if (e.kind !== FAMILY_BOUND_EVENT || e.detail?.by !== "family") continue;
    const id = e.detail.link_id;
    if (typeof id === "string" && id) out.add(id);
  }
  return out;
}

/** The links his `family_share` granted records name. */
export function acknowledgedIds(records: readonly Pick<ConsentRecordRow, "kind" | "decision" | "evidence">[]): Set<string> {
  const out = new Set<string>();
  for (const r of records) {
    if (r.kind !== "family_share" || r.decision !== "granted") continue;
    const id = (r.evidence as { link_id?: unknown } | null)?.link_id;
    if (typeof id === "string" && id) out.add(id);
  }
  return out;
}

type AckReads = Pick<Store, "listAccountEvents" | "listConsentRecords">;

/**
 * Has he acknowledged this link? `store` must be able to read HIS account events and consent records (his own store,
 * or binding's narrow one). A link without the mark costs one read; a marked one two.
 */
export async function linkAcknowledged(store: AckReads, link: Pick<CareLinkRow, "id" | "patient_id">): Promise<boolean> {
  if (!boundByFamilyIds(await store.listAccountEvents(link.patient_id)).has(link.id)) return true;
  return acknowledgedIds(await store.listConsentRecords(link.patient_id, { kind: "family_share" })).has(link.id);
}

/**
 * His links in force that he has not acknowledged, in the order given (his pages list the newest first): a family
 * member bound each of them by typing his account, and his Today shows the card for the first. Nothing is read when no
 * link of his is in force; his records only when one of them carries the mark.
 */
export async function unacknowledgedLinks(store: AckReads, userId: string, links: readonly PatientLinkView[]): Promise<PatientLinkView[]> {
  const active = links.filter((l) => l.state === "active");
  if (!active.length) return [];
  const marked = boundByFamilyIds(await store.listAccountEvents(userId));
  const waiting = active.filter((l) => marked.has(l.id));
  if (!waiting.length) return [];
  const seen = acknowledgedIds(await store.listConsentRecords(userId, { kind: "family_share" }));
  return waiting.filter((l) => !seen.has(l.id));
}
