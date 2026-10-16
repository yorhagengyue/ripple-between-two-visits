/**
 * Binding by account (line bind; the owner, 2026-10-11: 「如果是子女的话，他需要填入老人的账号，如果是老人的话，也可以填入
 * 子女的账号作为直接绑定，这两个行为都会直接绑定，不需要额外的动作」). Server-only.
 *
 * A family member types the elder's account, or the elder types the family member's, and the two are linked. The link
 * is an ordinary care_link in status `active`, made with the store's own three steps one after the other (createInvite,
 * acceptInvite, confirmLink) on binding's narrow store (lib/subject/bind.ts): no new store method, no migration. The
 * invitation's token is made, hashed and thrown away: nothing returns it. The invitation flow (lib/care/links.ts) is
 * the second way in and is not touched.
 *
 *   bindByAccount(deps, caller, input)
 *     1  the limits: 10 an hour per signed-in person, 30 an hour per IP (429 too_many, until)
 *     2  what was typed, as a login (lib/auth/login-name.ts); not a login, or no such account: 404 account_not_found,
 *        one answer for both
 *     3  his own account: 409 bind_self
 *     4  sides: the elder is the one with a space of his own, the family member the one with none; two of a kind:
 *        409 bind_wrong_kind, detail both_elder / both_family
 *     5  a link between the two that is in force: 200 with it, made false, nothing written. A family member whom he
 *        removed (see "After he removed her" below): 403 bind_removed. One she accepted from an invitation of his and
 *        he has not confirmed: this binding confirms it (when he is the one typing, or in direct mode), and it gets
 *        the direct switches
 *     6  otherwise the link is made. family_label is the family member's own name (see nameOnHisScreens),
 *        patient_label the `label` she chose (「爸爸」, 「妈妈」) or else the elder's own name, never empty; relation
 *        null; reset_helper stays false. A step that fails after createInvite ends the half-made link (revokeLink as
 *        the patient) and the failure is returned
 *     7  a directly bound link starts with DIRECT_GRANTS: the four counts and the alert on, his visit records and his
 *        notes off
 *     8  FAMILY_BIND_MODE: `direct` (default) or `confirm`. In `confirm` a link the family member started stops at
 *        `accepted` and waits for his 「是她」 exactly as an invitation does (every switch off, the existing card and
 *        notice); a link he started himself is in force at once in both modes
 *     9  then, in this order: the event on his channel (care_link.confirmed, or care_link.accepted when it waits), the
 *        records, the notice to his phone
 *
 * The mark. A link a family member starts is made in this order: createInvite, acceptInvite, the account event
 * `family_bound` { link_id, by: "family", items } on HIS account, and only then confirmLink. That event is the mark
 * that makes the link safe (lib/care/ack.ts: with it and without his own record of sharing, the link is unacknowledged
 * and nothing of hers reaches his phone). So it is written BEFORE the link can come into force, and when it cannot be
 * written the half-made link is ended and the binding fails: a link she started is never in force without its mark. In
 * confirm mode the same mark is written at the same place; his 「是她」 then writes his record, as for an invitation.
 *
 * After he removed her (the integrator, 2026-10-11, round two). Once he has ended a link with her, nothing she does
 * alone brings one into force again: her own binding is refused with 403 bind_removed, and her form tells her to ask
 * him. "Ended by him" is a link between the two that was in force and that he stopped (status revoked, revoked_by
 * patient, confirmed_at set), or one he answered 「不是」 to (status declined: what removing is while
 * FAMILY_BIND_MODE=confirm). A link that never came into force and was taken back is not his removing her: this
 * module's own undo of a half-made link is written the same way (revoked by the patient, never confirmed), and so is an
 * invitation he cancelled. The check comes before a waiting invitation is looked at, so an invitation of his that she
 * accepted still waits for his own 「是她」. What he can still do is untouched: bind her himself, or invite her and
 * confirm her. It is asked from the same read as step 5: no call more.
 *
 * The records say what happened and nothing more:
 *
 *   she typed his account   the mark on his account (above); then her family_accept granted (method direct_bind,
 *                           evidence { link_id }) and family_bound { link_id, by: "family" } on her own account. No
 *                           consent record in his name: he did nothing.
 *   he typed her account    his family_share granted (method direct_bind, evidence { link_id, version, items },
 *                           assisted as lib/visit/consent.ts helpedOnDevice says); account event family_bound on both,
 *                           { link_id, by: "patient" }. No record in her name.
 *   he acknowledges a link she made (acknowledgeLink; POST /api/family/bind/seen)
 *                           his family_share granted (method direct_bind_ack, evidence { link_id, version, items }),
 *                           once
 */
import { bucketKey, hitLimit, LIMITS } from "@/lib/auth/limits";
import { parseLoginName } from "@/lib/auth/login-name";
import type { AuthProvider } from "@/lib/auth/provider";
import type { Env } from "@/lib/dev/enabled";
import { NO_GRANTS } from "@/lib/family/types";
import type { ConsentLocale } from "@/lib/privacy/consent-texts";
import { recordConsent } from "@/lib/privacy/consents";
import { notifyInviteAccepted } from "@/lib/push/accepted";
import { notifyFamilyBound } from "@/lib/push/bound";
import type { AccountRow, CareLinkErrorCode, CareLinkRow, FamilyGrantItems, SessionRow, Store } from "@/lib/store/types";
import type { BindEntryStore } from "@/lib/subject/bind";
import { nowMs as appNowMs } from "@/lib/time/now";
import { helpedOnDevice } from "@/lib/visit/consent";
import { FAMILY_BOUND_EVENT, linkAcknowledged } from "./ack";
import { publishCare } from "./events";
import { failure, LABEL_MAX, type CareFailure, type ConsentWriting } from "./links";
import { INVITE_MS, newInviteToken } from "./tokens";

export { FAMILY_BOUND_EVENT };

// ------------------------------------------------------------------ the mode and the switches

export type BindMode = "direct" | "confirm";

/** FAMILY_BIND_MODE: `confirm` makes a link the family member started wait for his 「是她」; anything else is `direct`. */
export function bindMode(env: Env = process.env): BindMode {
  return (env.FAMILY_BIND_MODE ?? "").trim().toLowerCase() === "confirm" ? "confirm" : "direct";
}

/** What a directly bound link starts with, in both directions: the four counts and the alert on, his words off. */
export const DIRECT_GRANTS: FamilyGrantItems = {
  dose_summary: true,
  bp_summary: true,
  questions_count: true,
  no_reply_alert: true,
  visit_transcripts: false,
  notes: false,
};

// ------------------------------------------------------------------ names

const cleanLabel = (v: string | null | undefined): string | null => {
  const t = (v ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, LABEL_MAX) : null;
};

/** Letters of any script, with the spaces and marks a name carries; 24 at most. No digits, no sentence punctuation. */
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .·'’-]{0,23}$/u;

/**
 * A person's own name as it may stand on the OTHER person's screens. When she binds him, her name goes on his lock
 * screen and his Today card, and she chose it herself: only what reads as a name is taken (a number, an address or a
 * line of punctuation is not), else her account name stands there, which he sees on the card anyway. null: neither.
 */
export function nameOnHisScreens(account: Pick<AccountRow, "display_name" | "username">): string | null {
  const name = cleanLabel(account.display_name);
  if (name && NAME_RE.test(name)) return name;
  return account.username?.trim() || null;
}

// ------------------------------------------------------------------ the binding

export interface BindCaller {
  userId: string;
  /** the caller's own account row (the route has it from the sign-in) */
  account: AccountRow;
  /** the client's address (hashed before it names a bucket) */
  ip: string;
  /** the caller's screen language: the consent text a record points at, and the fallback word for an elder without a name */
  locale: ConsentLocale;
  /** someone is helping him on his device right now (his record keeps it); absent: what his sign-up recorded */
  assisted?: boolean;
}

export interface BindInput {
  /** what was typed in the account field: a username or an e-mail address */
  account: string;
  /** how she calls him (「爸爸」, 「妈妈」); only her side sends one */
  label?: string | null;
}

export interface BindDeps {
  /** binding's narrow store over the process-wide one (lib/subject/bind.ts) */
  entry: BindEntryStore;
  /** the caller's own store: the consent record is in the caller's own name */
  own: Pick<Store, "addConsentRecord" | "listConsentRecords">;
  /** the identity provider: an e-mail address is looked up there */
  auth: Pick<AuthProvider, "findUserIdByEmail">;
  /** the store the rate limits count in (the account routes': lib/subject/account.ts accountDeps) */
  limits: Store;
  env?: Env;
  /** the app's clock in epoch ms; the tests pass their own */
  now?: () => number;
  /** the two notices to his phone; the tests pass their own */
  notifyBound?: typeof notifyFamilyBound;
  notifyAccepted?: typeof notifyInviteAccepted;
}

export interface BindRefusal {
  ok: false;
  status: 400 | 403 | 404 | 409 | 410 | 429;
  error: "too_many" | "account_not_found" | "bind_self" | "bind_wrong_kind" | "bind_removed" | CareLinkErrorCode;
  /** bind_wrong_kind: which kind both accounts are */
  detail?: "both_elder" | "both_family";
  /** too_many: when the limit opens again (ISO) */
  until?: string;
}

export interface Bound {
  ok: true;
  link: CareLinkRow;
  /** which side the caller is on */
  role: "patient" | "family";
  /** this request made the link (false: it was there already; one that waited may have been confirmed by this request) */
  made: boolean;
  /** in force, or (confirm mode, started by the family member) waiting for his 「是她」 */
  state: "active" | "accepted";
  /** where the caller goes: her page for this link, or his switches for her */
  next: string;
}

/** His own space, read the way the sign-in reads it (lib/auth/service.ts ownScope): the row of his own id, an account's. */
async function spaceOf(entry: Pick<Store, "getSession">, userId: string): Promise<SessionRow | null> {
  const row = await entry.getSession(userId);
  return row && row.kind === "account" ? row : null;
}

/** The account behind what was typed, or null (not a login, or nobody's). */
async function accountTyped(deps: Pick<BindDeps, "entry" | "auth">, typed: string, env: Env): Promise<AccountRow | null> {
  const parsed = parseLoginName(typed, env);
  if (!parsed.ok) return null;
  if (parsed.login.kind === "username") return deps.entry.getAccountByUsername(parsed.login.username);
  const id = await deps.auth.findUserIdByEmail(parsed.login.email);
  return id ? deps.entry.getAccount(id) : null;
}

const refused = (code: CareLinkErrorCode): BindRefusal => ({ ok: false, status: failure(code).status, error: code });

/**
 * He ended this link with her himself: one that was in force and that he stopped, or one he answered 「不是」 to. A link
 * that never came into force and was taken back (a half-made binding undone, an invitation cancelled) is not that.
 */
export function endedByHim(link: Pick<CareLinkRow, "status" | "revoked_by" | "confirmed_at">): boolean {
  if (link.status === "declined") return true;
  return link.status === "revoked" && link.revoked_by === "patient" && !!link.confirmed_at;
}

export async function bindByAccount(deps: BindDeps, caller: BindCaller, input: BindInput): Promise<Bound | BindRefusal> {
  const env = deps.env ?? process.env;
  const { entry } = deps;

  // 1. the limits, counted before anything is looked up
  for (const [bucket, limit] of [
    [`a:bu:${bucketKey("user", caller.userId, env)}`, LIMITS.bindPerUser],
    [`a:bi:${bucketKey("ip", caller.ip, env)}`, LIMITS.bindPerIp],
  ] as const) {
    const hit = await hitLimit(deps.limits, bucket, limit, env);
    if (!hit.ok) return { ok: false, status: 429, error: "too_many", until: hit.until };
  }

  // 2, 3. the account that was typed
  const other = await accountTyped(deps, input.account, env);
  if (!other) return { ok: false, status: 404, error: "account_not_found" };
  if (other.user_id === caller.userId) return { ok: false, status: 409, error: "bind_self" };

  // 4. sides
  const [mine, theirs] = await Promise.all([spaceOf(entry, caller.userId), spaceOf(entry, other.user_id)]);
  if (mine && theirs) return { ok: false, status: 409, error: "bind_wrong_kind", detail: "both_elder" };
  if (!mine && !theirs) return { ok: false, status: 409, error: "bind_wrong_kind", detail: "both_family" };
  const role: Bound["role"] = mine ? "patient" : "family";
  const byFamily = role === "family";
  const scope = (mine ?? theirs) as SessionRow;
  const patient = mine ? caller.account : other;
  const family = mine ? other : caller.account;
  const done = (link: CareLinkRow, made: boolean): Bound => ({
    ok: true,
    link,
    role,
    made,
    state: link.status === "active" ? "active" : "accepted",
    next: byFamily ? `/f?link=${encodeURIComponent(link.id)}` : `/p/family/${encodeURIComponent(link.id)}`,
  });

  // 5. the links between the two: one in force, one that waits, and the ones that are over (one read)
  const between = await entry.listCareLinks({ patient_id: patient.user_id, family_id: family.user_id, status: ["accepted", "active", "revoked", "declined"] });
  const inForce = between.find((l) => l.status === "active");
  if (inForce) return done(inForce, false);
  // he removed her: she does not come back by her own act (he can bind her, or invite her and confirm her)
  if (byFamily && between.some(endedByHim)) return { ok: false, status: 403, error: "bind_removed" };
  // he binds at once whatever the mode; she does in direct mode
  const direct = !byFamily || bindMode(env) === "direct";
  const waiting = between.find((l) => l.status === "accepted");
  if (waiting && !direct) return done(waiting, false);

  /** The mark on HIS account that she bound this link by her own act; written before the link can come into force. */
  const mark = (linkId: string, items: FamilyGrantItems) => entry.addAccountEvent(patient.user_id, FAMILY_BOUND_EVENT, { link_id: linkId, by: "family", items });

  let link: CareLinkRow;
  let made = false;
  if (waiting) {
    // an invitation he sent and she took: this binding is the confirmation, and the link starts as a bound one does.
    // When she is the one binding, the mark comes first; if it cannot be written the link simply goes on waiting.
    if (byFamily) await mark(waiting.id, DIRECT_GRANTS);
    const confirmed = await entry.confirmLink(waiting.id, patient.user_id, true);
    if (!confirmed.ok) return refused(confirmed.code);
    await entry.setFamilyGrant(scope.id, waiting.id, DIRECT_GRANTS);
    link = confirmed.link;
  } else {
    // 6. the link, in the store's own three steps. The token is made, hashed and thrown away: nothing returns it.
    const t = newInviteToken();
    const familyLabel = nameOnHisScreens(family);
    const patientLabel = cleanLabel(input.label) ?? cleanLabel(patient.display_name) ?? (patient.username?.trim() || (caller.locale === "en" ? "Family" : "家人"));
    // 7, 8. the direct switches; a link that waits for his 「是她」 starts as an invitation does, every switch off
    const items = direct ? DIRECT_GRANTS : NO_GRANTS;
    const invited = await entry.createInvite(
      {
        id: t.linkId,
        patient_id: patient.user_id,
        relation: null,
        family_label: familyLabel,
        patient_label: patientLabel,
        invite_token_hash: t.hash,
        invite_expires_at: new Date((deps.now ?? appNowMs)() + INVITE_MS).toISOString(),
      },
      items,
    );
    if (!invited.ok) return refused(invited.code);
    const undo = () => entry.revokeLink(t.linkId, patient.user_id, "patient").then(() => undefined, () => undefined);
    try {
      const accepted = await entry.acceptInvite(t.hash, family.user_id, familyLabel);
      if (!accepted.ok) {
        await undo();
        return refused(accepted.code);
      }
      link = accepted.link;
      // the mark, before the link can come into force (a failure here ends the half-made link below)
      if (byFamily) await mark(t.linkId, items);
      if (direct) {
        const confirmed = await entry.confirmLink(t.linkId, patient.user_id, true);
        if (!confirmed.ok) {
          await undo();
          return refused(confirmed.code);
        }
        link = confirmed.link;
      }
    } catch (err) {
      await undo();
      throw err;
    }
    made = true;
  }
  const active = link.status === "active";

  // 9. the event on his channel: his open pages read themselves again
  publishCare(scope.id, active ? "care_link.confirmed" : "care_link.accepted", link);

  // the records
  if (byFamily) {
    await recordConsent(
      { records: deps.own, texts: entry },
      { user_id: caller.userId, scope_id: null, kind: "family_accept", decision: "granted", locale: caller.locale, method: "direct_bind", evidence: { link_id: link.id }, assisted: false },
    );
    await entry.addAccountEvent(family.user_id, FAMILY_BOUND_EVENT, { link_id: link.id, by: "family" });
  } else {
    const grant = await entry.getFamilyGrant(scope.id, link.id);
    const assisted = await helpedOnDevice(deps.own, caller.userId, caller.assisted);
    await recordConsent(
      { records: deps.own, texts: entry },
      {
        user_id: caller.userId,
        scope_id: scope.id,
        kind: "family_share",
        decision: "granted",
        locale: caller.locale,
        method: "direct_bind",
        evidence: { link_id: link.id, version: grant?.version ?? 1, items: grant?.items ?? NO_GRANTS },
        assisted,
      },
    );
    await entry.addAccountEvent(patient.user_id, FAMILY_BOUND_EVENT, { link_id: link.id, by: "patient" });
    await entry.addAccountEvent(family.user_id, FAMILY_BOUND_EVENT, { link_id: link.id, by: "patient" });
  }

  // the notice to his phone: she did something he should know of (never fails the binding). He needs none for his own act.
  if (byFamily) await (active ? (deps.notifyBound ?? notifyFamilyBound)(link) : (deps.notifyAccepted ?? notifyInviteAccepted)(link));

  return done(link, made);
}

// ------------------------------------------------------------------ his acknowledgement

type AckStore = Pick<Store, "listCareLinks" | "getFamilyGrant" | "listAccountEvents" | "listConsentRecords" | "addConsentRecord">;

/**
 * 「知道了」: he acknowledges a link a family member bound (POST /api/family/bind/seen). His family_share granted record,
 * method direct_bind_ack, with the switches as they stand; written once, and only for a link that is unacknowledged
 * (lib/care/ack.ts): one he has acknowledged in any other way, or that never needed it, gets no record. Only his own
 * link, and only while it is in force. `store` is his own store.
 */
export async function acknowledgeLink(
  store: AckStore,
  scope: Pick<SessionRow, "id">,
  userId: string,
  linkId: string,
  locale: ConsentLocale,
  consent: ConsentWriting,
): Promise<{ ok: true; link: CareLinkRow; written: boolean } | CareFailure> {
  const link = (await store.listCareLinks({ patient_id: userId })).find((l) => l.id === linkId);
  if (!link) return failure("link_not_found");
  if (link.status === "invited" || link.status === "accepted") return { ok: false, status: 409, code: "link_not_active" };
  if (link.status !== "active") return failure("link_closed");
  if (await linkAcknowledged(store, link)) return { ok: true, link, written: false };
  const grant = await store.getFamilyGrant(scope.id, linkId);
  const assisted = await helpedOnDevice(store, userId, consent.assisted);
  await recordConsent(
    { records: store, texts: consent.texts },
    {
      user_id: userId,
      scope_id: scope.id,
      kind: "family_share",
      decision: "granted",
      locale,
      method: "direct_bind_ack",
      evidence: { link_id: linkId, version: grant?.version ?? 1, items: grant?.items ?? NO_GRANTS },
      assisted,
    },
  );
  // his other open pages (Today on another phone of his) put the card away
  publishCare(scope.id, "care_link.confirmed", link);
  return { ok: true, link, written: true };
}
