/**
 * His family as his own space sees it, on an account (C2 track S, round 2; real-app 3.10 line 747 「写死的 "wei-ling" 在账号上
 * 换成链接编号……界面上的『女儿 Wei Ling』『女儿说』改成链接上的关系加称呼」, 6.16 line 1268). Server-only.
 *
 * The demo has one built-in family member ("wei-ling") and one row of switches. An account has care links: none, one or
 * several, each with its own relation, the name he gave her, and its own six switches (family_grant by link id). The
 * demo's default member row does not exist there, so anything that read it found nothing: an ask about sharing the visit
 * recordings always answered "off".
 *
 *   hisCareLinks(store, scope)        his active links with each one's switches, in the order they were made; [] on the
 *                                     demo, on an account with no active link, and for a store that may not read his links
 *                                     (her view, a scheduled job): never throws
 *   sharedWith(links, switch, locale) the links whose switch is on, each as the link words it (「女儿 Wei Ling」 /
 *                                     "Wei Ling (daughter)": lib/care/copy.ts whoWords: relation first, then the name)
 *   clipRelation(store, scope, clip)  the relation of the link a reminder clip was recorded through, or null
 *
 * Read through the subject's own store: in self mode he may list the links where he is the patient and read each link's
 * switches of his own scope (lib/subject/scoped-store.ts).
 */
import { whoWords } from "@/lib/care/copy";
import type { Locale } from "@/lib/i18n";
import type { CareLinkRow, FamilyGrantItems, SessionRow, Store } from "@/lib/store/types";

export interface HisLink {
  link: Pick<CareLinkRow, "id" | "relation" | "family_label" | "status">;
  /** this link's switches; null when the link has no row of them (all off) */
  items: FamilyGrantItems | null;
}

type Scope = Pick<SessionRow, "id" | "kind" | "owner_user_id">;

/** His active care links and their switches (see the header). */
export async function hisCareLinks(store: Pick<Store, "listCareLinks" | "getFamilyGrant">, scope: Scope): Promise<HisLink[]> {
  if (scope.kind !== "account" || !scope.owner_user_id) return [];
  try {
    const links = (await store.listCareLinks({ patient_id: scope.owner_user_id, status: ["active"] })).sort((a, b) => a.created_at.localeCompare(b.created_at));
    return await Promise.all(links.map(async (link) => ({ link, items: (await store.getFamilyGrant(scope.id, link.id))?.items ?? null })));
  } catch {
    // a store that may not read his links (family mode, system mode): as if there were none to name
    return [];
  }
}

/** The links whose `item` switch is on, worded from each link's relation and name. */
export function sharedWith(links: readonly HisLink[], item: keyof FamilyGrantItems, locale: Locale): string[] {
  return links.filter((l) => l.items?.[item] === true).map((l) => whoWords(l.link.family_label, l.link.relation, locale));
}

/** The relation on the care link a reminder clip came through ("daughter", "son" ...), or null (the demo, the example's clip). */
export async function clipRelation(store: Pick<Store, "listReminderClips" | "getCareLink">, scope: Scope, clipId: string): Promise<string | null> {
  if (scope.kind !== "account") return null;
  try {
    const clip = (await store.listReminderClips(scope.id)).find((c) => c.id === clipId);
    if (!clip?.link_id) return null;
    return (await store.getCareLink(clip.link_id))?.relation ?? null;
  } catch {
    return null;
  }
}
