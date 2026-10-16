/**
 * The consent records a care link gets when the app makes it (lib/care/links.ts, lib/care/bind.ts), for a link a test
 * made straight through the store (createInvite, acceptInvite, confirmLink): his family_share and her family_accept
 * under the family text in force, through track H's writer. A link with no record at all counts as never agreed to
 * (lib/care/reconsent.ts: old test data), and her view of him is then the alert-only form.
 *
 *   await agreedLink(store, link);                  as an invitation he confirmed: both records
 *   await agreedLink(store, link, { his: false });  as a link she bound by typing his account: hers only (he has done
 *                                                   nothing; lib/care/ack.ts can still call it unacknowledged)
 */
import { recordConsent } from "@/lib/privacy/consents";
import type { CareLinkRow, Store } from "@/lib/store/types";

export async function agreedLink(store: Store, link: Pick<CareLinkRow, "id" | "patient_id" | "family_id">, sides: { his?: boolean; hers?: boolean } = {}): Promise<void> {
  const stores = { records: store, texts: store };
  if (sides.his !== false) {
    await recordConsent(stores, { user_id: link.patient_id, scope_id: link.patient_id, kind: "family_share", decision: "granted", locale: "zh-Hans", method: "family_confirm", evidence: { link_id: link.id } });
  }
  if (sides.hers !== false && link.family_id) {
    await recordConsent(stores, { user_id: link.family_id, scope_id: null, kind: "family_accept", decision: "granted", locale: "zh-Hans", method: "invite_screen", evidence: { link_id: link.id } });
  }
}
