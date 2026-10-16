/**
 * A session member as the other devices may see it (M6 privacy, 10-10): its role, its label and when it joined.
 * Never the row's id: that id is the device's rp_member cookie, its credential, and a device that has it can act as
 * that phone. GET /api/session lists the members this way and the session.member_joined event carries one; only the
 * device itself gets its own row with the id (its cookies and the bodies of POST /api/session and POST
 * /api/session/join). Client-safe.
 */
import type { SessionMemberRow } from "@/lib/store/types";

/** The fields of a member row other devices may have (the backstage feed and the director's counts use `role`). */
export const MEMBER_VIEW_FIELDS = ["role", "device_label", "created_at"] as const;
export type MemberView = Pick<SessionMemberRow, (typeof MEMBER_VIEW_FIELDS)[number]>;

/** The row without its id (and without anything else not in MEMBER_VIEW_FIELDS). */
export function memberView(row: MemberView): MemberView {
  return { role: row.role, device_label: row.device_label, created_at: row.created_at };
}
