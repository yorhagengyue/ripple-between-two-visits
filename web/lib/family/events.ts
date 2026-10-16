/**
 * What Wei Ling's device may receive on the live event stream, GET /api/events (task M6, privacy). Server-only.
 *
 * The bus carries everything that happens in a session, with content: his notes word for word, his readings, what he
 * asked and every step of the safety checks, visit transcripts and cards, the director's cues, and which devices joined
 * (their roles, never their ids, since 10-10). Her phone needs none of that: /f is built on the server from what he
 * switched on (lib/family/view.ts) and only needs to know *when* to read it again. So, for the family role, every
 * event becomes one of four things, decided by its type and his switches at that point of the stream:
 *
 *   pass     family_grant.changed (his switches: about her own view, /f hides a section straight from it);
 *            clock.changed, session.reset, session.filming_mode with the session row only, cut to what /f uses
 *            (id, story day and time, filming mode: FAMILY_SESSION_FIELDS; never the join code); the director's beat
 *            is left out. The page's day label and story-day gating follow these.
 *   trimmed  dose.logged while he shares dose_summary: { dose: { medication_id, day, slot, state } }, which is all
 *            /f shows (this morning's state, live).
 *   hint     { id, type, session_id, at, say: "", data: {} }: "something /f shows changed, read it again". Only for a
 *            type whose section he shares (see HINT_WHEN); /f re-reads /api/family/view, which is trimmed on the
 *            server. reminder.clip_added (her own recording) is always a hint.
 *   dropped  everything else, and a data type whose section is off: nothing at all is sent, not even the SSE `id:`
 *            line, so her phone cannot tell when a hidden event happened. Her Last-Event-ID moves with the events she
 *            does receive; a reconnect from there runs the same filter over what follows again (dropped again, or a
 *            content-free hint if he has switched the section on since), so nothing new reaches her either way. The
 *            gap between the ids of two events she does receive still shows how many happened in between. Types this
 *            module does not know (added later) are dropped: fail closed.
 *
 * `say` (the backstage sentence, which quotes him) is never sent to her.
 *
 * His visit, live, on her real account's stream (scene 1 of the owner's video, 2026-10-15: while his phone records the
 * visit, hers shows it as it happens). Only on a stream through her care link (`linkId`); the demo's family phone is as
 * above:
 *   a recording starts or ends   (visit.changed of his own recording: recording, then transcribing or waiting for its
 *                                text) a content-free hint, whatever his switches: her home then says that his visit is
 *                                being recorded, and nothing more unless he shares his visit records (lib/care/home.ts)
 *   while he shares visit_transcripts:
 *     asr.final       trimmed to the lines' words, times, language and who said them (role, role_state): never the
 *                     visit's view (its cards, his question list)
 *     asr.partial     trimmed to the growing line's words and time (a Whisper server; Tencent sends whole lines only)
 *     utterance.role  trimmed to which line is now whose (id, role, state): the speaker labels follow on her screen
 *     visit.summary   trimmed to Ripple's points (their words) and their language and stage, never the lines they cite
 *   A content event with the switch off is dropped, as every other one.
 *
 * How GET /api/events uses it (app/api/events/route.ts, wired 10-09 wave B):
 *   const family = await familyStreamFor(req, session);          // null unless the caller is the family role;
 *                                                                // throws StreamDenied for a family phone outside
 *                                                                // its session or a stranger (the route: 403)
 *   ... send(family ? family.frame(event) : toSseFrame(event))   // at both send sites (memory replay + live, and
 *                                                                // the STORE=supabase tail's sendEvent, where the
 *                                                                // server-side cursor still advances on a dropped
 *                                                                // event); "" for a dropped one sends nothing
 */
import type { NextRequest } from "next/server";
import { toSseFrame, type BusEvent } from "@/lib/bus";
import type { DaySlot, DoseState, FamilyGrantItems, SessionRow, Store } from "@/lib/store/types";
import { demoMembers } from "@/lib/subject/entry";
import { readGrants } from "./grants";
import { isFamily, isOutsider } from "./identity";
import type { MembersReader } from "./member-cache";
import { requesterIdentity, type RoleScope } from "./role";
import { GRANT_KEYS, NO_GRANTS } from "./types";

/** Events her device receives as they are (with `say` blanked and the data reduced to the session row). */
const SESSION_ROW_TYPES = new Set<string>(["clock.changed", "session.reset", "session.filming_mode"]);

/** Data events /f re-reads on, and the switch(es) under which she is told that one happened. */
export const HINT_WHEN: Readonly<Record<string, readonly (keyof FamilyGrantItems)[]>> = {
  // a tick (or the no-reply mark) changes this week's medicine days and the "no reply" card
  "dose.logged": ["dose_summary", "no_reply_alert"],
  // a new or changed medicine changes which doses are due
  "med.changed": ["dose_summary", "no_reply_alert"],
  "bp.logged": ["bp_summary"],
  "note.logged": ["notes"],
  // the questions count; recorded answers are shown with the visit transcripts
  "question.created": ["questions_count", "visit_transcripts"],
  "question.updated": ["questions_count", "visit_transcripts"],
  "visit.changed": ["visit_transcripts", "questions_count"],
};

/** Her own recording: /f shows which clip his phone will play. */
const ALWAYS_HINT = new Set<string>(["reminder.clip_added"]);

/**
 * The real app's event types (lib/bus.ts, C2 foundation F1), dropped for her device on purpose until the track that owns
 * each decides what /f needs from it: the family links (track D: on her real account's stream, care_link.revoked and
 * care_link.left for her own link close it, see familyEvent's linkId; every other care_link event stays dropped), consent,
 * push, his profile, prevention, watch, diet, chat, the late transcript, his account and the scheduled jobs. Listed
 * here so the choice is explicit; familyEvent drops them like any type it does not know (fail closed).
 */
export const FAMILY_DROPS: ReadonlySet<string> = new Set<string>([
  "care_link.invited",
  "care_link.accepted",
  "care_link.confirmed",
  "care_link.declined",
  "care_link.revoked",
  "care_link.left",
  "consent.recorded",
  "push.subscribed",
  "push.unsubscribed",
  "push.sent",
  "push.opened",
  "profile.fact_added",
  "profile.fact_confirmed",
  "profile.fact_changed",
  "prevent.done",
  "prevent.changed",
  "watch.synced",
  "diet.checked",
  "chat.message",
  "visit.transcribed",
  "account.created",
  "account.changed",
  "account.reseeded",
  "job.ran",
  "job.failed",
]);

/**
 * "close" (C2 track D, real accounts): her own link ended (care_link.revoked by him, care_link.left by her): the event
 * goes out as { link: { id, status, by } } and the stream ends right after it (real-app 2.22: within a second).
 * by: "patient" (he stopped sharing), "family" (she left), "gone" (his account is being deleted: real-app 3.11).
 */
export type FamilyEventKind = "pass" | "trimmed" | "hint" | "dropped" | "close";

/** The care_link events that end her stream when they are about her own link. */
export const CLOSING_TYPES: ReadonlySet<string> = new Set(["care_link.revoked", "care_link.left"]);

/** His visit as it is recorded (scene 1): what her live view follows while he shares his visit records (see the header). */
export const LIVE_VISIT_TYPES: ReadonlySet<string> = new Set(["asr.final", "asr.partial", "utterance.role", "visit.summary"]);

/**
 * His answer about a profile fact (C2 track D, round two; real-app 3.10 「他点『对』以后，她的 /f 出现『爸爸确认了』」). On
 * her real account's stream, and only when the fact was proposed through HER link (the event's `by_link`, which
 * lib/profile/facts.ts adds for a family member's fact), it goes out as a content-free hint: her page reads her own
 * proposals again. Every other profile event stays dropped (FAMILY_DROPS): his own facts, another family member's.
 */
export const HER_FACT_TYPES: ReadonlySet<string> = new Set(["profile.fact_confirmed", "profile.fact_changed"]);

export interface FamilyEventResult {
  kind: FamilyEventKind;
  /** what is sent to her device; null when dropped (nothing at all is sent, not even the SSE `id:` line) */
  event: BusEvent | null;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function hint(event: BusEvent): BusEvent {
  return { id: event.id, type: event.type, session_id: event.session_id, at: event.at, say: "", data: {} };
}

/** The fields of the session row /f uses: whose session, the story day and time (its day label), filming mode. */
export const FAMILY_SESSION_FIELDS = ["id", "story_day", "story_time", "filming_mode"] as const;
export type FamilySessionRow = Pick<SessionRow, (typeof FAMILY_SESSION_FIELDS)[number]>;

/**
 * The session row as her phone may have it: only FAMILY_SESSION_FIELDS. Never the join code (with it a device can
 * join), and nothing else /f does not use (when the sandbox expires, when it was made, its template).
 */
export function familySessionRow(row: Record<string, unknown> | Pick<SessionRow, (typeof FAMILY_SESSION_FIELDS)[number]>): FamilySessionRow {
  const r = row as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of FAMILY_SESSION_FIELDS) if (k in r) out[k] = r[k];
  return out as unknown as FamilySessionRow;
}

function sessionRowOnly(event: BusEvent): BusEvent {
  const data = isObj(event.data) ? event.data : {};
  const row = isObj(data.session) && data.session.id === event.session_id ? familySessionRow(data.session) : null;
  const out: Record<string, unknown> = row ? { session: row } : {};
  if (event.type === "clock.changed") out.beat = null; // ClockChangedData shape; the beat's label is the director's
  return { ...hint(event), data: out };
}

function trimmedDose(event: BusEvent): BusEvent | null {
  const dose = isObj(event.data) && isObj(event.data.dose) ? event.data.dose : null;
  if (!dose || typeof dose.medication_id !== "string" || typeof dose.day !== "number" || typeof dose.slot !== "string" || typeof dose.state !== "string") return null;
  const kept: { medication_id: string; day: number; slot: DaySlot; state: DoseState } = {
    medication_id: dose.medication_id,
    day: dose.day,
    slot: dose.slot as DaySlot,
    state: dose.state as DoseState,
  };
  return { ...hint(event), data: { dose: kept } };
}

function grantChanged(event: BusEvent): { event: BusEvent; items: FamilyGrantItems } | null {
  const data = isObj(event.data) ? event.data : null;
  const grant = data && isObj(data.grant) ? data.grant : null;
  const items = grant && isObj(grant.items) ? grant.items : null;
  if (!data || !grant || !items) return null;
  const clean: FamilyGrantItems = { ...NO_GRANTS };
  for (const k of GRANT_KEYS) clean[k] = items[k] === true;
  const changed: Partial<FamilyGrantItems> = {};
  const was = isObj(data.changed) ? data.changed : {};
  for (const k of GRANT_KEYS) if (typeof was[k] === "boolean") changed[k] = was[k] as boolean;
  const row = {
    session_id: event.session_id,
    member: typeof grant.member === "string" ? grant.member : "",
    items: clean,
    created_at: typeof grant.created_at === "string" ? grant.created_at : event.at,
    updated_at: typeof grant.updated_at === "string" ? grant.updated_at : event.at,
    // C2 track D: a care link's switches count their changes (the demo's row has no version: nothing is added). Her
    // stream and her page order changes by it, so one that arrives twice or late never moves the switches back.
    ...(typeof grant.version === "number" ? { version: grant.version } : {}),
  };
  return { event: { ...hint(event), data: { grant: row, changed } }, items: clean };
}

/** A visit.changed that starts or ends a recording of his own (not the example's sample, not a replay). */
export function recordingEdge(event: BusEvent): boolean {
  if (event.type !== "visit.changed" || !isObj(event.data)) return false;
  const data = event.data;
  const visit = isObj(data.visit) ? data.visit : null;
  if (!visit || data.sample === true || typeof visit.status !== "string") return false;
  if (visit.status === "recording") return data.mode === "record";
  // the end of a recording: the full transcript is being made, or the recording waits for its text
  return (visit.status === "transcribing" && typeof data.job_id === "string") || (visit.status === "awaiting_transcript" && data.awaiting_transcript === true);
}

const ROLES = new Set(["doctor", "dispenser", "pharmacist", "patient", "family", "unknown"]);
const STATES = new Set(["confirmed", "inferred", "unknown"]);
const str = (x: unknown): x is string => typeof x === "string";
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** One live line as her screen may have it: words, times, language and who said it (nothing else of the row). */
function liveLine(u: unknown): Record<string, unknown> | null {
  if (!isObj(u) || !str(u.id) || !str(u.text)) return null;
  return {
    id: u.id,
    text: u.text,
    lang: str(u.lang) ? u.lang : null,
    t_start_ms: num(u.t_start_ms) ? u.t_start_ms : 0,
    t_end_ms: num(u.t_end_ms) ? u.t_end_ms : 0,
    role: str(u.role) && ROLES.has(u.role) ? u.role : "unknown",
    role_state: str(u.role_state) && STATES.has(u.role_state) ? u.role_state : "unknown",
  };
}

/** His visit, live (scene 1): the event cut to what her live view shows, or null when it does not read. */
function trimmedLive(event: BusEvent): BusEvent | null {
  const data = isObj(event.data) ? event.data : null;
  if (!data || !str(data.visit_id)) return null;
  const visit_id = data.visit_id;
  if (event.type === "asr.final") {
    const utterances = (Array.isArray(data.utterances) ? data.utterances : []).map(liveLine).filter((u): u is Record<string, unknown> => !!u);
    return { ...hint(event), data: { visit_id, utterances } };
  }
  if (event.type === "asr.partial") {
    const u = isObj(data.utterance) && str(data.utterance.id) && str(data.utterance.text) ? data.utterance : null;
    if (!u) return null;
    return { ...hint(event), data: { visit_id, utterance: { id: u.id, text: u.text, lang: str(u.lang) ? u.lang : null, t_start_ms: num(u.t_start_ms) ? u.t_start_ms : 0 } } };
  }
  if (event.type === "utterance.role") {
    const changes = (Array.isArray(data.changes) ? data.changes : [])
      .filter((c): c is Record<string, unknown> => isObj(c) && str(c.id) && str(c.role) && ROLES.has(c.role))
      .map((c) => ({ id: c.id, role: c.role, state: str(c.state) && STATES.has(c.state) ? c.state : "unknown" }));
    return { ...hint(event), data: { visit_id, changes } };
  }
  if (event.type === "visit.summary") {
    const points = (Array.isArray(data.points) ? data.points : []).filter((p): p is Record<string, unknown> => isObj(p) && str(p.text)).map((p) => ({ text: p.text }));
    return { ...hint(event), data: { visit_id, stage: data.stage === "final" ? "final" : "live", lang: data.lang === "en" ? "en" : "zh-Hans", points, at: str(data.at) ? data.at : event.at } };
  }
  return null;
}

/** The link an event names ({ link: { id } }), or null. */
function eventLinkId(event: BusEvent): string | null {
  const data = isObj(event.data) ? event.data : null;
  const link = data && isObj(data.link) ? data.link : null;
  return link && typeof link.id === "string" ? link.id : null;
}

/**
 * One event as her device may see it, given his switches at this point of the stream. Pure.
 * A family_grant.changed event that cannot be read is dropped (its switches are not trusted).
 * `linkId` (a real account: her care link): his switches for another family member's link are dropped, never taken as
 * hers, and her own link's end closes the stream.
 */
export function familyEvent(event: BusEvent, grants: FamilyGrantItems, linkId?: string | null): FamilyEventResult {
  if (linkId && CLOSING_TYPES.has(event.type)) {
    if (eventLinkId(event) !== linkId) return { kind: "dropped", event: null };
    // her page says who ended it: 「爸爸已经停止分享」 (he), 「你已经不再看」 (she), 「这个联系已经结束」 (his account is going)
    const gone = isObj(event.data) && event.data.account_gone === true;
    return { kind: "close", event: { ...hint(event), data: { link: { id: linkId, status: "revoked", by: event.type === "care_link.left" ? "family" : gone ? "gone" : "patient" } } } };
  }
  if (linkId && HER_FACT_TYPES.has(event.type) && isObj(event.data) && event.data.by_link === linkId) return { kind: "hint", event: hint(event) };
  // owner 10-16 (lib/care/told.ts): she was told he said something to Ripple that may need attention. The baseline: under
  // no switch. Her own link's stream gets a content-free hint (her 「留意」 and home read themselves again); another
  // link's, and the demo's, drop it
  if (event.type === "family.told") return linkId && eventLinkId(event) === linkId ? { kind: "hint", event: hint(event) } : { kind: "dropped", event: null };
  if (FAMILY_DROPS.has(event.type)) return { kind: "dropped", event: null };
  if (event.type === "family_grant.changed") {
    const g = grantChanged(event);
    if (g && linkId && (g.event.data as { grant: { member: string } }).grant.member !== linkId) return { kind: "dropped", event: null };
    return g ? { kind: "pass", event: g.event } : { kind: "dropped", event: null };
  }
  if (SESSION_ROW_TYPES.has(event.type)) return { kind: "pass", event: sessionRowOnly(event) };
  // scene 1 (10-15), her real account only: his visit as it is recorded (see the header)
  if (linkId) {
    if (LIVE_VISIT_TYPES.has(event.type)) {
      const t = grants.visit_transcripts ? trimmedLive(event) : null;
      return t ? { kind: "trimmed", event: t } : { kind: "dropped", event: null };
    }
    if (recordingEdge(event)) return { kind: "hint", event: hint(event) };
  }
  if (event.type === "dose.logged" && grants.dose_summary) {
    const t = trimmedDose(event);
    return t ? { kind: "trimmed", event: t } : { kind: "hint", event: hint(event) };
  }
  if (ALWAYS_HINT.has(event.type)) return { kind: "hint", event: hint(event) };
  const when = HINT_WHEN[event.type];
  if (when && when.some((k) => grants[k] === true)) return { kind: "hint", event: hint(event) };
  return { kind: "dropped", event: null };
}

/** The switches as a stream sees them: starts from the stored row, follows family_grant.changed in stream order. */
export interface FamilyStream {
  grants(): FamilyGrantItems;
  /** what to send for this event (and, for family_grant.changed, take the new switches) */
  view(event: BusEvent): FamilyEventResult;
  /** the SSE frame for this event: the event as she may see it, or "" (send nothing) when it is dropped */
  frame(event: BusEvent): string;
  /** her link ended on this stream (a "close" event went out): the route ends the stream */
  closed(): boolean;
  /** C2 track D: which change of her link's switches this stream is at (0: the demo, or a row without a count) */
  version(): number;
  /**
   * C2 track D: take switches read from the store (the stream's own re-read of her link). True when they are newer than
   * what the stream had; older or the same: nothing changes.
   */
  adopt(items: FamilyGrantItems, version: number): boolean;
}

/**
 * `opts.linkId`: a real account's stream through her care link (see familyEvent). `opts.version`: the change her
 * link's switches were at when the stream read them. On such a stream a switch change is taken once and in order: the
 * same change can reach it twice (told by this instance's publish before the event is stored, lib/bus.ts
 * subscribeEarly, and again as the stored event) or late (another instance's event read from the table after a newer
 * one), and the second or older copy is dropped: it is not sent again and never moves the switches back.
 * `opts.switches`: the cut her store applies to her switches (lib/subject/scoped-store.ts `switches`; the family texts
 * asked again, lib/care/reconsent.ts). The switches an event carries come from his side, not from her store, so they
 * pass through it here: what the stream follows, what it sends her and what its filter lets through are all cut.
 */
export function createFamilyStream(initial: FamilyGrantItems, opts: { linkId?: string | null; version?: number; switches?: ((items: FamilyGrantItems) => FamilyGrantItems) | null } = {}): FamilyStream {
  const cut = (items: FamilyGrantItems): FamilyGrantItems => (opts.switches ? { ...NO_GRANTS, ...opts.switches({ ...NO_GRANTS, ...items }) } : { ...NO_GRANTS, ...items });
  let grants: FamilyGrantItems = cut(initial);
  let version = opts.version ?? 0;
  let ended = false;
  const view = (event: BusEvent): FamilyEventResult => {
    if (ended) return { kind: "dropped", event: null };
    let r = familyEvent(event, grants, opts.linkId ?? null);
    if (r.kind === "close") ended = true;
    if (event.type === "family_grant.changed" && r.event && isObj(r.event.data) && isObj(r.event.data.grant)) {
      const v = r.event.data.grant.version;
      if (opts.linkId && typeof v === "number") {
        if (v <= version) return { kind: "dropped", event: null };
        version = v;
      }
      grants = cut(r.event.data.grant.items as FamilyGrantItems);
      if (opts.switches) {
        // what goes to her says the switches as cut, and names as changed only what the cut lets through
        const was = isObj(r.event.data.changed) ? (r.event.data.changed as Partial<FamilyGrantItems>) : {};
        const changed = Object.fromEntries((Object.keys(was) as (keyof FamilyGrantItems)[]).filter((k) => cut({ ...NO_GRANTS, [k]: true })[k]).map((k) => [k, was[k]]));
        r = { ...r, event: { ...r.event, data: { ...r.event.data, grant: { ...r.event.data.grant, items: { ...grants } }, changed } } };
      }
    }
    return r;
  };
  return {
    grants: () => ({ ...grants }),
    view,
    frame(event) {
      const r = view(event);
      return r.event ? toSseFrame(r.event) : "";
    },
    closed: () => ended,
    version: () => version,
    adopt(items, v) {
      if (ended || v <= version) return false;
      grants = cut(items);
      version = v;
      return true;
    },
  };
}

/** A device that gets no stream of this session at all (lib/family/identity.ts): the route answers 403 `code`. */
export class StreamDenied extends Error {
  constructor(readonly code: "patient_only" | "member_required") {
    super(code === "member_required" ? "this device has not joined this session" : "a family phone outside its own session");
    this.name = "StreamDenied";
  }
}

/**
 * The filter for this request: null unless the caller is Wei Ling's phone in her own session (lib/family/identity.ts);
 * a family phone naming another session, or a device with no row in a session she has joined, gets no stream at all
 * (throws StreamDenied). Member rows that cannot be read throw as they are (the route: an empty retry stream). When
 * his switches cannot be read, she starts with every switch off (fail closed) and the next family_grant.changed
 * brings the real ones.
 */
export async function familyStreamFor(
  req: NextRequest,
  session: RoleScope,
  store: Pick<Store, "getFamilyGrant">,
  members: MembersReader = demoMembers(),
): Promise<FamilyStream | null> {
  // the demo's family phone only: an account's stream is decided by its subject (her care link, lib/subject)
  if (session.kind === "account") return null;
  const id = await requesterIdentity(req, session, members);
  if (isOutsider(id)) throw new StreamDenied(id.kind === "stranger" ? "member_required" : "patient_only");
  if (!isFamily(id)) return null;
  try {
    return createFamilyStream((await readGrants(store, session)).items);
  } catch (err) {
    console.warn("[family/events] switches unavailable; streaming with every switch off", err instanceof Error ? err.message.slice(0, 160) : "");
    return createFamilyStream({ ...NO_GRANTS });
  }
}
