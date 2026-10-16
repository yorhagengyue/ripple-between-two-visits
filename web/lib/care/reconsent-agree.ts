/**
 * The two cards of the family texts asked again (lib/care/reconsent.ts has the why and the rule): each person agrees to
 * the text in force for their own link, through track H's writer (lib/privacy/consents.ts recordConsent: the version
 * and hash in force, the words published to consent_text first). POST /api/family/links/[id]/agree calls one of them.
 * Server-only.
 *
 *   agreeAsHim   「同意」 on his card (his Today, his family page): his family_share granted, as his confirmation writes
 *                it (method family_confirm, evidence { link_id, version, items }, assisted as lib/visit/consent.ts
 *                helpedOnDevice says), with `renews`: the version of the record it replaces
 *   agreeAsHer   「同意新的说明」 on her home: her family_accept granted, with the method of her acceptance of this link
 *                (invite_screen, or direct_bind for a link she bound; invite_screen when none is found), never assisted,
 *                with `renews` as his
 * Both: only the person's own link in force; written once (a second tap, or a person who agreed already, writes
 * nothing: `written` false).
 */
import { NO_GRANTS } from "@/lib/family/types";
import type { ConsentLocale } from "@/lib/privacy/consent-texts";
import { recordConsent } from "@/lib/privacy/consents";
import type { CareLinkRow, ConsentRecordRow, SessionRow, Store } from "@/lib/store/types";
import type { CareEntryStore } from "@/lib/subject/care";
import { helpedOnDevice } from "@/lib/visit/consent";
import { publishCare } from "./events";
import { failure, type CareFailure, type ConsentWriting } from "./links";
import { agreedNow, namesLink } from "./reconsent";

/** What the tap answers: written, or agreed under the version in force already (nothing written). */
export type Agreed = { ok: true; link: CareLinkRow; written: boolean };

/** The version a side's latest record for the link was made under (the one a new record renews), or null. */
const lastVersion = (mine: readonly Pick<ConsentRecordRow, "version">[]): string | null => mine.at(-1)?.version ?? null;

/** 「同意」 on his card. `store` is his own store (self mode); his own link in force only. */
export async function agreeAsHim(
  store: Pick<Store, "listCareLinks" | "getFamilyGrant" | "listConsentRecords" | "addConsentRecord">,
  scope: Pick<SessionRow, "id">,
  userId: string,
  linkId: string,
  locale: ConsentLocale,
  consent: ConsentWriting,
): Promise<Agreed | CareFailure> {
  const link = (await store.listCareLinks({ patient_id: userId })).find((l) => l.id === linkId);
  if (!link) return failure("link_not_found");
  if (link.status === "invited" || link.status === "accepted") return { ok: false, status: 409, code: "link_not_active" };
  if (link.status !== "active") return failure("link_closed");
  const mine = (await store.listConsentRecords(userId, { kind: "family_share" })).filter((r) => namesLink(r, linkId));
  if (agreedNow(mine)) return { ok: true, link, written: false };
  const [grant, assisted] = await Promise.all([store.getFamilyGrant(scope.id, linkId), helpedOnDevice(store, userId, consent.assisted)]);
  await recordConsent(
    { records: store, texts: consent.texts },
    {
      user_id: userId,
      scope_id: scope.id,
      kind: "family_share",
      decision: "granted",
      locale,
      method: "family_confirm",
      evidence: { link_id: linkId, version: grant?.version ?? 1, items: grant?.items ?? NO_GRANTS, renews: lastVersion(mine) },
      assisted,
    },
  );
  // his other open pages (Today on another phone of his) read themselves again and put the card away
  publishCare(scope.id, "care_link.confirmed", link);
  return { ok: true, link, written: true };
}

/** 「同意新的说明」 on her card. `entry` finds the link and publishes the words; `own` is her own store. */
export async function agreeAsHer(
  entry: Pick<CareEntryStore, "getCareLink" | "putConsentText">,
  own: Pick<Store, "listConsentRecords" | "addConsentRecord">,
  userId: string,
  linkId: string,
  locale: ConsentLocale,
): Promise<Agreed | CareFailure> {
  const link = await entry.getCareLink(linkId).catch(() => null);
  if (!link || link.family_id !== userId) return failure("link_not_found");
  if (link.status === "accepted") return { ok: false, status: 409, code: "link_not_active" };
  if (link.status !== "active") return failure("link_closed");
  const mine = (await own.listConsentRecords(userId, { kind: "family_accept" })).filter((r) => namesLink(r, linkId));
  if (agreedNow(mine)) return { ok: true, link, written: false };
  const accepted = [...mine].reverse().find((r) => r.decision === "granted" && r.method)?.method ?? "invite_screen";
  await recordConsent(
    { records: own, texts: entry },
    { user_id: userId, scope_id: null, kind: "family_accept", decision: "granted", locale, method: accepted, evidence: { link_id: linkId, renews: lastVersion(mine) }, assisted: false },
  );
  return { ok: true, link, written: true };
}
