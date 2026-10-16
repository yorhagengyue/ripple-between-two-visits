/**
 * Who a request is for (docs/plan/real-app.md 3.7; C2 architecture review 认人). Client-safe types only.
 *
 *   kind       "account": a person's own space (a verified JWT, or her active care link to his space);
 *              "demo": a judge sandbox or the crew's filming session (?session=, rp_session)
 *   relation   "self" his own account; "family" his space read through her link; "system" a scheduled job;
 *              "demo" a demo session, where the device's role (patient, family, judge...) is the member row's and is
 *              asked for when a route needs it (lib/family/role.ts), exactly as before
 *   scope      the scope's session row, "today" already computed (lib/store); for her, his row
 *   link       her care link (family)
 *   consent    her care link (family): has each of them agreed to the family text in force (lib/care/reconsent.ts);
 *              while either has not, `store` hands her switches out in the alert-only form
 *   store      the store bound to this scope (lib/subject/scoped-store.ts)
 */
import type { LinkConsent } from "@/lib/care/reconsent";
import type { CareLinkRow, SessionRow } from "@/lib/store/types";
import type { ScopedStore } from "./scoped-store";

export type SubjectKind = "account" | "demo";
export type SubjectRelation = "self" | "family" | "system" | "demo";

export interface Subject {
  kind: SubjectKind;
  relation: SubjectRelation;
  /** the signed-in person's user id (the JWT's sub); null for a demo session and the system */
  userId: string | null;
  scope: SessionRow;
  link: CareLinkRow | null;
  /** her care link only (family); absent everywhere else */
  consent?: LinkConsent | null;
  store: ScopedStore;
}
