/**
 * Ending every family link a person is party to, before the account goes (C2 track D for track H; real-app 3.11 删除账号
 * 「她那边：链接没了，她的 /f 显示『这个联系已经结束』」). Server-only.
 *
 *   endLinksOf(userId)   his side (he is the patient): every invited, accepted or active link is revoked by him, and
 *                        care_link.revoked goes on his channel marked account_gone, so a family member's open page and
 *                        stream end at once and her page says 「这个联系已经结束」 (not 「爸爸已经停止分享」);
 *                        her side (she is the family member): every accepted or active link is left by her, and
 *                        care_link.left goes on that patient's channel.
 * Call it before store.deleteAccount (which then deletes the links themselves, keeping her reminder clips in his space
 * with by_user_id cleared and her label kept in his access log). Links already closed are left as they are. Her page
 * for a link that no longer exists says the connection has ended (app/f).
 *
 * Track H's delete route is bound to his own space (self mode), where leaving a link as the family member is not
 * allowed; this goes through the care flow's own narrow store (lib/subject/care.ts) unless one is passed in.
 */
import type { CareLinkRow } from "@/lib/store/types";
import { careEntryStore, type CareEntryStore } from "@/lib/subject/care";
import { publishCare } from "./events";

const OPEN_AS_PATIENT: CareLinkRow["status"][] = ["invited", "accepted", "active"];
const OPEN_AS_FAMILY: CareLinkRow["status"][] = ["accepted", "active"];

export interface EndedLinks {
  /** links where he was the patient, now revoked */
  revoked: number;
  /** links where she was the family member, now left */
  left: number;
}

export async function endLinksOf(userId: string, deps: { store?: CareEntryStore } = {}): Promise<EndedLinks> {
  const store = deps.store ?? careEntryStore();
  const out: EndedLinks = { revoked: 0, left: 0 };
  for (const link of await store.listCareLinks({ patient_id: userId, status: OPEN_AS_PATIENT })) {
    const r = await store.revokeLink(link.id, userId, "patient");
    if (!r.ok) continue;
    out.revoked += 1;
    publishCare(link.patient_id, "care_link.revoked", r.link, { accountGone: true });
  }
  for (const link of await store.listCareLinks({ family_id: userId, status: OPEN_AS_FAMILY })) {
    const r = await store.revokeLink(link.id, userId, "family");
    if (!r.ok) continue;
    out.left += 1;
    publishCare(link.patient_id, "care_link.left", r.link);
  }
  return out;
}
