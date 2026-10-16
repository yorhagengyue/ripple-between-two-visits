/**
 * Mr Tan's switches for what Wei Ling can see (task M6 item 2). Server-only.
 *
 * Defaults come from the seed's family_grants (dose summary, blood pressure, question count and the no-reply alert
 * on; visit transcripts and his notes off). A change is merged into the stored row (store.setFamilyGrant is an
 * atomic merge) and published as family_grant.changed with the whole row, so an open /f hides a section from the
 * event itself, without waiting for a refetch.
 */
import { publish } from "@/lib/bus";
import type { FamilyGrantItems, FamilyGrantRow, SessionRow, Store } from "@/lib/store/types";
import { FAMILY_MEMBER, GRANT_KEYS, NO_GRANTS, type FamilyGrantChangedData, type GrantsResponse } from "./types";

/** His switches for one family member: the demo's "wei-ling", or on an account the member's care link id. */
export async function readGrants(store: Pick<Store, "getFamilyGrant">, session: Pick<SessionRow, "id">, member: string = FAMILY_MEMBER): Promise<GrantsResponse> {
  const row = await store.getFamilyGrant(session.id, member);
  return { member, items: { ...NO_GRANTS, ...(row?.items ?? {}) }, updated_at: row?.updated_at ?? null };
}

function describe(changed: Partial<FamilyGrantItems>): string {
  return GRANT_KEYS.filter((k) => k in changed)
    .map((k) => `${k.replace(/_/g, " ")} ${changed[k] ? "on" : "off"}`)
    .join(", ");
}

export async function setGrants(store: Store, session: Pick<SessionRow, "id">, changed: Partial<FamilyGrantItems>): Promise<FamilyGrantRow> {
  const grant = await store.setFamilyGrant(session.id, FAMILY_MEMBER, changed);
  publish<FamilyGrantChangedData>(session.id, "family_grant.changed", `Mr Tan changed what Wei Ling can see: ${describe(changed)}`, { grant, changed });
  return grant;
}
