/**
 * The family links themselves (C2 track D; real-app 2.19-2.22, 3.10). Server-only. Each step runs on the store the
 * caller's subject was given, so the scoped store's link rules (lib/subject/scoped-store.ts) hold on top of these:
 *
 *   he (self mode, his own space)       createInviteFor, cancelInvite, confirmLinkAs, setLinkSwitches, revokeLinkAs,
 *                                       patientLinks, grantHistory
 *   she, before any link binds her      lookupInvite, acceptInviteAs (the care flow's narrow store, lib/subject/care.ts,
 *                                       for the cross-scope lookups; her own store for her consent record)
 *   she, her own side                   leaveLinkAs (her own link, found through the narrow store), familyLinks
 *
 * Every change is recorded: the link's status and times (care_link), each version of the switches (care_grant_history,
 * written by the store), a consent record (his family_share granted / withdrawn, her family_accept granted /
 * withdrawn), and an event on his channel (lib/care/events.ts). Switches start all off; a new invitation never copies
 * an old one's, and they change only on an active link (he confirmed her first). Nothing here returns the token's
 * hash; the token itself only from createInviteFor.
 *
 * The order of steps in a change she must see at once (a switch, the stop, her leaving): the store write, then the
 * event, then the consent record. With a database some tens of milliseconds away every call before the event is time
 * her screen still shows what he just switched off (10-11: the first run on the hosted database took 1.7 s for the
 * stop, eleven round trips in a row; tests/unit/care/one-second.test.ts counts them now).
 *
 * The consent records go through track H's one writer (lib/privacy/consents.ts recordConsent; real-app 3.11): the
 * version and sha256 of the family text in force, that text published to consent_text first, and `assisted` with its
 * note when someone is helping him on his device (what the request says, else what his sign-up recorded:
 * lib/visit/consent.ts helpedOnDevice). Her own records are hers alone: never assisted.
 */
import type { ConsentLocale } from "@/lib/privacy/consent-texts";
import type { CareLinkErrorCode, CareLinkRow, FamilyGrantItems, FamilyGrantRow, SessionRow, Store } from "@/lib/store/types";
import type { CareEntryStore } from "@/lib/subject/care";
import { NO_GRANTS } from "@/lib/family/types";
import { recordConsent } from "@/lib/privacy/consents";
import { helpedOnDevice } from "@/lib/visit/consent";
// line bind (round two): what his stop writes depends on whether he ever gave a consent for that link
import { acknowledgedIds, boundByFamilyIds, FAMILY_BOUND_REMOVED_EVENT } from "./ack";
import { publishCare } from "./events";
// C2 track I (only add): his phone is told when she accepts (real-app 2.20 step 4, 2.24 「家人接受了」)
import { notifyInviteAccepted } from "@/lib/push/accepted";
import { INVITE_MS, invitePath, newInviteToken, tokenLinkId, tokenMatches } from "./tokens";
import type { FamilyLinkView, GrantVersionView, LinkState, PatientLinkView } from "./types";

// ------------------------------------------------------------------ states and errors

export const OPEN_INVITES_MAX = 5;
export const LABEL_MAX = 40;

/** The state a person sees: an invitation past its date is expired even before a job marks it; a link she left is "left". */
export function linkState(link: Pick<CareLinkRow, "status" | "invite_expires_at" | "revoked_by">, nowMs: number): LinkState {
  if (link.status === "invited" && link.invite_expires_at && Date.parse(link.invite_expires_at) <= nowMs) return "expired";
  if (link.status === "revoked" && link.revoked_by === "family") return "left";
  return link.status;
}

export type CareFailure = { ok: false; status: 400 | 403 | 404 | 409 | 410 | 429; code: string };

const STATUS: Record<CareLinkErrorCode, CareFailure["status"]> = {
  invite_not_found: 404,
  invite_used: 409,
  invite_expired: 410,
  invite_self: 409,
  link_exists: 409,
  link_not_found: 404,
  link_not_accepted: 409,
  link_closed: 409,
};

export function failure(code: CareLinkErrorCode): CareFailure {
  return { ok: false, status: STATUS[code], code };
}

const cleanLabel = (v: string | null | undefined): string | null => {
  const t = (v ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, LABEL_MAX) : null;
};

const endedAt = (l: CareLinkRow): string | null => (l.status === "revoked" ? l.revoked_at : l.status === "declined" || l.status === "expired" ? l.updated_at : null);

// ------------------------------------------------------------------ his side

export interface InviteInput {
  /** how he names her ("Wei Ling") */
  familyLabel: string;
  /** "daughter", "son", ... */
  relation?: string | null;
  /** how she calls him ("爸爸") */
  patientLabel?: string | null;
}

export interface MadeInvite {
  link: PatientLinkView;
  /** the one-time token: shown to him once, inside the link he sends */
  token: string;
  /** /invite/<token> */
  path: string;
}

type SelfStore = Pick<Store, "createInvite" | "listCareLinks" | "getCareLink" | "confirmLink" | "revokeLink" | "getFamilyGrant" | "setFamilyGrant" | "listGrantHistory" | "addConsentRecord" | "listConsentRecords">;
/** What his stop needs besides: his own account events (line bind: a link a family member bound and he never acknowledged). */
type StopStore = SelfStore & Pick<Store, "listAccountEvents" | "addAccountEvent">;

/** What a step that writes a consent record needs besides the caller's own store. */
export interface ConsentWriting {
  /** publishes the words the record points at (consent_text is one table for everyone: lib/subject/care.ts careEntryStore) */
  texts: Pick<Store, "putConsentText">;
  /** someone is helping him on his device right now (the tap is still his); absent: what his sign-up recorded */
  assisted?: boolean;
}

function patientView(link: CareLinkRow, grant: FamilyGrantRow | null, her: { displayName: string | null; username: string | null } | null, nowMs: number): PatientLinkView {
  const state = linkState(link, nowMs);
  return {
    id: link.id,
    state,
    familyLabel: link.family_label,
    relation: link.relation,
    patientLabel: link.patient_label,
    invitedAt: link.created_at,
    expiresAt: link.status === "invited" ? link.invite_expires_at : null,
    acceptedAt: link.accepted_at,
    confirmedAt: link.confirmed_at,
    endedAt: endedAt(link),
    her: link.family_id && (state === "accepted" || state === "active") ? her : null,
    items: { ...NO_GRANTS, ...(grant?.items ?? {}) },
    version: grant?.version ?? 1,
  };
}

/** He invites someone: a link (invited, 7 days), every switch off, the token once. */
export async function createInviteFor(store: SelfStore, scope: Pick<SessionRow, "id">, userId: string, input: InviteInput, nowMs: number): Promise<MadeInvite | CareFailure> {
  const familyLabel = cleanLabel(input.familyLabel);
  if (!familyLabel) return { ok: false, status: 400, code: "label_missing" };
  const open = (await store.listCareLinks({ patient_id: userId, status: ["invited"] })).filter((l) => linkState(l, nowMs) === "invited");
  if (open.length >= OPEN_INVITES_MAX) return { ok: false, status: 429, code: "too_many_invites" };
  const t = newInviteToken();
  const made = await store.createInvite(
    {
      id: t.linkId,
      patient_id: userId,
      relation: cleanLabel(input.relation),
      family_label: familyLabel,
      patient_label: cleanLabel(input.patientLabel),
      invite_token_hash: t.hash,
      invite_expires_at: new Date(nowMs + INVITE_MS).toISOString(),
    },
    {},
  );
  if (!made.ok) return failure(made.code);
  publishCare(scope.id, "care_link.invited", made.link);
  const grant = await store.getFamilyGrant(scope.id, made.link.id);
  return { link: patientView(made.link, grant, null, nowMs), token: t.token, path: invitePath(t.token) };
}

/**
 * His link, found among his own links: one read. (Asking the scoped store for a single link costs two, because it reads
 * the row to check he is a party and then the call reads it again; on a hosted database every read is a round trip, and
 * this one is on the way to her screen: see the note on the order of steps below.)
 */
async function hisLink(store: SelfStore, userId: string, linkId: string): Promise<CareLinkRow | null> {
  const links = await store.listCareLinks({ patient_id: userId });
  return links.find((l) => l.id === linkId) ?? null;
}

/** He takes back an invitation nobody accepted yet. */
export async function cancelInvite(store: SelfStore, scope: Pick<SessionRow, "id">, userId: string, linkId: string): Promise<{ ok: true; link: CareLinkRow } | CareFailure> {
  const link = await hisLink(store, userId, linkId);
  if (!link) return failure("link_not_found");
  if (link.status !== "invited") return failure("link_closed");
  const r = await store.revokeLink(linkId, userId, "patient");
  if (!r.ok) return failure(r.code);
  publishCare(scope.id, "care_link.revoked", r.link);
  return { ok: true, link: r.link };
}

/** One consent record of the links, through track H's writer (stamped, its text published, assisted with its note). */
async function record(
  store: Pick<Store, "addConsentRecord">,
  texts: Pick<Store, "putConsentText">,
  rec: { userId: string; scopeId: string | null; kind: "family_share" | "family_accept"; decision: "granted" | "withdrawn"; locale: ConsentLocale; evidence: Record<string, unknown>; method: string; assisted: boolean },
): Promise<void> {
  await recordConsent(
    { records: store, texts },
    { user_id: rec.userId, scope_id: rec.scopeId, kind: rec.kind, decision: rec.decision, locale: rec.locale, method: rec.method, evidence: rec.evidence, assisted: rec.assisted },
  );
}

/** He says whether the person who accepted is her: yes, the link is active (still every switch off); no, it is void. */
export async function confirmLinkAs(
  store: SelfStore,
  scope: Pick<SessionRow, "id">,
  userId: string,
  linkId: string,
  yes: boolean,
  locale: ConsentLocale,
  consent: ConsentWriting,
): Promise<{ ok: true; link: CareLinkRow } | CareFailure> {
  if (!(await hisLink(store, userId, linkId))) return failure("link_not_found");
  const r = await store.confirmLink(linkId, userId, yes);
  if (!r.ok) return failure(r.code);
  if (yes) {
    const grant = await store.getFamilyGrant(scope.id, linkId);
    const assisted = await helpedOnDevice(store, userId, consent.assisted);
    await record(store, consent.texts, { userId, scopeId: scope.id, kind: "family_share", decision: "granted", locale, method: "family_confirm", evidence: { link_id: linkId, version: grant?.version ?? 1, items: grant?.items ?? NO_GRANTS }, assisted });
  }
  publishCare(scope.id, yes ? "care_link.confirmed" : "care_link.declined", r.link);
  return { ok: true, link: r.link };
}

/**
 * Someone is helping him on his device (his sign-up says so: lib/visit/consent.ts helpedOnDevice): his name, for the
 * line 「请陈先生本人点」 beside the buttons that give a consent of his (real-app 2.2 step 5, 3.11 「家人代操作时，同意必须由他
 * 本人点」). null: he acts alone, no line. "": helped, but the account has no name.
 */
export async function helpedName(store: Pick<Store, "listConsentRecords" | "getAccount">, userId: string): Promise<string | null> {
  if (!(await helpedOnDevice(store, userId))) return null;
  const account = await store.getAccount(userId).catch(() => null);
  return account?.display_name?.trim() ?? "";
}

/**
 * He changes what she sees: a new version of the link's switches, a consent record, family_grant.changed on his channel.
 * Only on an active link: the switches are set after he confirmed her (409 link_not_active before that), so no
 * family_share record says "granted" for someone he has not confirmed.
 */
export async function setLinkSwitches(
  store: SelfStore,
  scope: Pick<SessionRow, "id">,
  userId: string,
  linkId: string,
  items: Partial<FamilyGrantItems>,
  locale: ConsentLocale,
  publishChange: (grant: FamilyGrantRow, changed: Partial<FamilyGrantItems>) => void,
  consent: ConsentWriting,
): Promise<{ ok: true; grant: FamilyGrantRow } | CareFailure> {
  const link = await hisLink(store, userId, linkId);
  if (!link) return failure("link_not_found");
  if (link.status === "invited" || link.status === "accepted") return { ok: false, status: 409, code: "link_not_active" };
  if (link.status !== "active") return failure("link_closed");
  const grant = await store.setFamilyGrant(scope.id, linkId, items);
  // her open page first (real-app 2.22: within a second): the switches are stored, so say so now. The consent record is
  // bookkeeping about a change that has already happened; it follows, still before he gets his answer.
  publishChange(grant, items);
  const assisted = await helpedOnDevice(store, userId, consent.assisted);
  await record(store, consent.texts, { userId, scopeId: scope.id, kind: "family_share", decision: "granted", locale, method: "family_switches", evidence: { link_id: linkId, version: grant.version ?? 1, items: grant.items }, assisted });
  return { ok: true, grant };
}

/**
 * He stops sharing with her: at once, for good (he can invite again).
 *
 * One store call, then the event: the store itself refuses a link that is not his (rp_link_revoke matches the actor
 * against the link's patient), so nothing is read first, and her open page is told before the consent record is
 * written (real-app 2.22: 「她开着的页面 1 秒内显示『爸爸已经停止分享』」). Whether the link was in force is on the row that
 * comes back: only a link that came into force has confirmed_at.
 *
 * What is written after the event (line bind, round two): a consent is withdrawn only where one was given. One read of
 * his own consent records says whether a granted family_share record of his names this link (and, from the same rows,
 * whether someone helps him on his device: no call more than before, tests/unit/care/one-second.test.ts counts them):
 *   it does                      his family_share withdrawn, method family_stop, as before
 *   it does not, and his account carries the mark that a family member bound this link herself (lib/care/ack.ts): he
 *   removes someone he never acknowledged. There is no consent of his to withdraw, so the account event
 *   family_bound_removed { link_id } is written on his account instead
 *   neither                      nothing (a link made straight through the store, which no screen makes)
 * If his records cannot be read the withdrawal is written as before: a stop is never left without its record.
 */
export async function revokeLinkAs(store: StopStore, scope: Pick<SessionRow, "id">, userId: string, linkId: string, locale: ConsentLocale, consent: ConsentWriting): Promise<{ ok: true; link: CareLinkRow } | CareFailure> {
  const r = await store.revokeLink(linkId, userId, "patient");
  if (!r.ok) return failure(r.code);
  publishCare(scope.id, "care_link.revoked", r.link);
  if (r.link.confirmed_at) {
    const mine = await store.listConsentRecords(userId).catch(() => null);
    if (mine === null || acknowledgedIds(mine).has(linkId)) {
      // who was tapping: what the request says, else his sign-up's record, taken from the rows just read
      const signUp = { listConsentRecords: async () => (mine ?? []).filter((c) => c.kind === "terms_privacy") };
      const assisted = await helpedOnDevice(mine === null ? store : signUp, userId, consent.assisted);
      await record(store, consent.texts, { userId, scopeId: scope.id, kind: "family_share", decision: "withdrawn", locale, method: "family_stop", evidence: { link_id: linkId }, assisted });
    } else if (boundByFamilyIds(await store.listAccountEvents(userId)).has(linkId)) {
      await store.addAccountEvent(userId, FAMILY_BOUND_REMOVED_EVENT, { link_id: linkId });
    }
  }
  return { ok: true, link: r.link };
}

/** His links with their switches and, once she accepted, who she is (her name and login, for the confirm card). */
export async function patientLinks(store: SelfStore, accounts: Pick<CareEntryStore, "getAccount">, scope: Pick<SessionRow, "id">, userId: string, nowMs: number): Promise<PatientLinkView[]> {
  const links = await store.listCareLinks({ patient_id: userId });
  const out: PatientLinkView[] = [];
  for (const link of links) {
    const grant = await store.getFamilyGrant(scope.id, link.id);
    let her: PatientLinkView["her"] = null;
    if (link.family_id && (link.status === "accepted" || link.status === "active")) {
      const a = await accounts.getAccount(link.family_id).catch(() => null);
      her = { displayName: a?.display_name ?? null, username: a?.username ?? null };
    }
    out.push(patientView(link, grant, her, nowMs));
  }
  const rank: Record<LinkState, number> = { accepted: 0, active: 1, invited: 2, expired: 3, declined: 4, revoked: 5, left: 5 };
  return out.sort((a, b) => rank[a.state] - rank[b.state] || b.invitedAt.localeCompare(a.invitedAt));
}

/** One link's versions, oldest first, each with what it turned on and off. */
export async function grantHistory(store: Pick<Store, "listGrantHistory">, linkId: string): Promise<GrantVersionView[]> {
  const rows = await store.listGrantHistory(linkId);
  const keys = Object.keys(NO_GRANTS) as (keyof FamilyGrantItems)[];
  return rows.map((h, i) => {
    const prev = i > 0 ? rows[i - 1].items : null;
    return {
      version: h.version,
      at: h.created_at,
      items: { ...NO_GRANTS, ...h.items },
      turnedOn: prev ? keys.filter((k) => h.items[k] && !prev[k]) : [],
      turnedOff: prev ? keys.filter((k) => !h.items[k] && prev[k]) : [],
    };
  });
}

// ------------------------------------------------------------------ her side

export type InviteState = "open" | "expired" | "used" | "self" | "yours_waiting" | "yours_active" | "invalid";

export interface InviteLookup {
  state: InviteState;
  /** only for a valid invitation (or her own link): what her page may say about it */
  link: { id: string; patientLabel: string | null; relation: string | null; familyLabel: string | null; expiresAt: string | null } | null;
}

/** What her invitation page shows for this token (signed in or not): nothing about a link unless the token matches. */
export async function lookupInvite(entry: Pick<CareEntryStore, "getCareLink">, token: string, viewerUserId: string | null, nowMs: number): Promise<InviteLookup> {
  const id = tokenLinkId(token);
  if (!id) return { state: "invalid", link: null };
  const link = await entry.getCareLink(id).catch(() => null);
  if (!link) return { state: "invalid", link: null };
  const safe = { id: link.id, patientLabel: link.patient_label, relation: link.relation, familyLabel: link.family_label, expiresAt: link.invite_expires_at };
  // her own link: the hash is cleared once he confirms, so she is recognised as its family member instead
  if (viewerUserId && link.family_id === viewerUserId) {
    if (link.status === "accepted") return { state: "yours_waiting", link: safe };
    if (link.status === "active") return { state: "yours_active", link: safe };
  }
  if (!tokenMatches(token, link.invite_token_hash)) return { state: link.family_id && link.family_id === viewerUserId ? "used" : "invalid", link: null };
  if (viewerUserId && link.patient_id === viewerUserId) return { state: "self", link: safe };
  const state = linkState(link, nowMs);
  if (state === "invited") return { state: "open", link: safe };
  if (state === "expired") return { state: "expired", link: null };
  return { state: "used", link: null };
}

/** She accepts while signed in: the link waits for him to confirm; her consent record; care_link.accepted on his channel. */
export async function acceptInviteAs(
  entry: Pick<CareEntryStore, "getCareLink" | "acceptInvite" | "putConsentText">,
  own: Pick<Store, "addConsentRecord">,
  token: string,
  userId: string,
  locale: ConsentLocale,
  nowMs: number,
): Promise<{ ok: true; link: CareLinkRow } | CareFailure> {
  const id = tokenLinkId(token);
  if (!id) return failure("invite_not_found");
  const link = await entry.getCareLink(id).catch(() => null);
  if (!link || !tokenMatches(token, link.invite_token_hash)) return failure("invite_not_found");
  if (link.patient_id === userId) return failure("invite_self");
  if (linkState(link, nowMs) === "expired") return failure("invite_expired");
  const r = await entry.acceptInvite(link.invite_token_hash!, userId);
  if (!r.ok) return failure(r.code);
  await record(own, entry, { userId, scopeId: null, kind: "family_accept", decision: "granted", locale, method: "invite_screen", evidence: { link_id: r.link.id }, assisted: false });
  publishCare(r.link.patient_id, "care_link.accepted", r.link);
  // C2 track I (only add): 「Wei Ling 已经接受」 to his phone, once per link; never fails her acceptance
  await notifyInviteAccepted(r.link);
  return { ok: true, link: r.link };
}

/**
 * She stops looking at his Ripple: her own action on her own link (real-app 3.10 「她自己的动作」), so it needs no way into
 * his space. The link is found through the care flow's narrow store and must be hers and still open (active, or accepted
 * and waiting for him); her family_accept consent is withdrawn on her own store; care_link.left goes on his channel.
 */
export async function leaveLinkAs(
  entry: Pick<CareEntryStore, "getCareLink" | "revokeLink" | "putConsentText">,
  own: Pick<Store, "addConsentRecord">,
  userId: string,
  linkId: string,
  locale: ConsentLocale,
): Promise<{ ok: true; link: CareLinkRow } | CareFailure> {
  const link = await entry.getCareLink(linkId).catch(() => null);
  if (!link || link.family_id !== userId) return failure("link_not_found");
  if (link.status !== "active" && link.status !== "accepted") return failure("link_closed");
  const r = await entry.revokeLink(linkId, userId, "family");
  if (!r.ok) return failure(r.code);
  // her other open pages (another phone of hers) and his family page first; the consent record follows
  publishCare(r.link.patient_id, "care_link.left", r.link);
  await record(own, entry, { userId, scopeId: null, kind: "family_accept", decision: "withdrawn", locale, method: "family_leave", evidence: { link_id: linkId }, assisted: false });
  return { ok: true, link: r.link };
}

/** Her links, newest first (her own side only). */
export async function familyLinks(store: Pick<Store, "listCareLinks">, userId: string, nowMs: number): Promise<FamilyLinkView[]> {
  const links = await store.listCareLinks({ family_id: userId });
  return links
    .map((l) => ({
      id: l.id,
      state: linkState(l, nowMs),
      patientLabel: l.patient_label,
      relation: l.relation,
      acceptedAt: l.accepted_at,
      confirmedAt: l.confirmed_at,
      endedAt: endedAt(l),
    }))
    .sort((a, b) => (b.acceptedAt ?? "").localeCompare(a.acceptedAt ?? ""));
}

/**
 * Links she accepted and never left whose rows no longer exist: the other person's account was deleted and took the
 * link with it (real-app 3.11 删除账号 step 5). Her own family_accept records are the only trace left on her side, so
 * her page can still say 「这个联系已经结束」 when she opens it with no link in the address. Returns those link ids.
 */
export async function vanishedLinks(own: Pick<Store, "listConsentRecords">, userId: string, existing: readonly Pick<FamilyLinkView, "id">[]): Promise<string[]> {
  const records = await own.listConsentRecords(userId, { kind: "family_accept" }).catch(() => []);
  const last = new Map<string, string>();
  for (const r of records) {
    const id = (r.evidence as { link_id?: unknown } | null)?.link_id;
    if (typeof id === "string" && id) last.set(id, r.decision);
  }
  const here = new Set(existing.map((l) => l.id));
  return [...last].filter(([id, decision]) => decision === "granted" && !here.has(id)).map(([id]) => id);
}

/** The link her page should open: the one named, else her only active (or waiting) link; null when there is none. */
export function pickLink(links: readonly FamilyLinkView[], named: string | null): FamilyLinkView | null {
  if (named) return links.find((l) => l.id === named) ?? null;
  const open = links.filter((l) => l.state === "active" || l.state === "accepted");
  if (open.length === 1) return open[0];
  if (open.length === 0) return links[0] ?? null;
  return null;
}
