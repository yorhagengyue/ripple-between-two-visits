/**
 * The care_link.* events (C2 track D; types registered by F1 in lib/bus.ts). Server-only.
 *
 * Every event goes on HIS scope's channel (an account's channel is its scope id, his user id): his open /p/family
 * follows them, and her stream, which reads his channel through her link, closes on care_link.revoked / care_link.left
 * for her own link (lib/family/events.ts). The data names the link and its new state only:
 *   { link: { id, status } }   status: the link's stored status after the change ("left" is a revoke by her)
 *   { link, account_gone: true }   care_link.revoked while his account is being deleted (lib/care/end.ts): her page
 *                              then says 「这个联系已经结束」, not that he stopped sharing (real-app 3.11 删除账号 step 5)
 * `say` is the backstage sentence; it never quotes him or her.
 */
import { publish, type BusEventType } from "@/lib/bus";
import type { FamilyGrantChangedData } from "@/lib/family/types";
import type { CareLinkStatus, FamilyGrantItems, FamilyGrantRow } from "@/lib/store/types";

export type CareEventType = Extract<BusEventType, `care_link.${string}`>;

export interface CareLinkEventData {
  link: { id: string; status: CareLinkStatus };
  /** his account is being deleted: the link ends because he is gone, not because he stopped sharing */
  account_gone?: true;
}

const SAY: Record<CareEventType, string> = {
  "care_link.invited": "He made a family invitation",
  "care_link.accepted": "A family member accepted his invitation; it waits for him to confirm",
  "care_link.confirmed": "He confirmed the family member",
  "care_link.declined": "He said the person who accepted is not his family member",
  "care_link.revoked": "He stopped sharing with a family member",
  "care_link.left": "A family member stopped looking at his Ripple",
};

/** Publish one care_link event on his scope's channel. */
export function publishCare(patientScopeId: string, type: CareEventType, link: { id: string; status: CareLinkStatus }, opts: { accountGone?: boolean } = {}): void {
  publish<CareLinkEventData>(patientScopeId, type, opts.accountGone ? "His account is being deleted: a family link ends" : SAY[type], { link: { id: link.id, status: link.status }, ...(opts.accountGone ? { account_gone: true as const } : {}) });
}

/**
 * family_grant.changed for one link (the demo's shape: { grant, changed }; grant.member is the link id). Her stream
 * takes it only when it is her link's (lib/family/events.ts); every other family member's stream drops it.
 */
export function publishGrantChange(patientScopeId: string, grant: FamilyGrantRow, changed: Partial<FamilyGrantItems>): void {
  const words = (Object.keys(changed) as (keyof FamilyGrantItems)[]).map((k) => `${k.replace(/_/g, " ")} ${changed[k] ? "on" : "off"}`).join(", ");
  publish<FamilyGrantChangedData>(patientScopeId, "family_grant.changed", `He changed what a family member can see: ${words}`, { grant, changed });
}
