/**
 * Blood pressure screen data (task M4 item 3). Server-only.
 *
 *   readings   his own records up to the story day; a reading that was not taken is "unconfirmed" (未确认)
 *   target     the doctor's own number, R1, only once it was said at a visit before today (the D0 visit: from D1);
 *              it comes from lib/safety's candidates, so it is word for word, with its visit date, its time point in
 *              the recording, its clip, and the speaker state of this session (医生说 or 推断：医生). Before that
 *              there is no comparison line at all, only the readings. No other number is ever a line (no 140, 130).
 *   measuring  the doctor's own words about how to measure, when this session's transcript holds them (an M2 replay
 *              or recording), with their speaker state; lines with judgement words are left out (this screen never
 *              says high / normal / good, 偏高 / 正常)
 *
 * Nothing here judges a reading: readings are listed and drawn next to R1, never coloured or counted as above or
 * below it.
 */
import type { Locale } from "@/lib/i18n";
import { buildCandidates } from "@/lib/safety";
import { judgementHits } from "@/lib/safety/judgement";
import { itemLineState, liveTranscript } from "@/lib/safety/line-state";
import { clipUrlFor } from "@/lib/safety/candidates";
import { relayDoctorThreshold, warningLine, type ThresholdRelay } from "@/lib/safety/threshold";
import { scopeD0, scopeNow, scopeTz } from "@/lib/store/scope";
import type { BpReadingRow, SessionRow, Store } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { localHHMM } from "@/lib/time/clock";
import { nowMs as appNowMs } from "@/lib/time/now";
import { doctorNumbers, type DoctorNumber } from "@/lib/visit/doctor-numbers";
import { isReplayCopy } from "@/lib/visit/happened";
import { partOfReading, bpWindows } from "./bp-run";
import { bpPlanFor, type BpPart, type BpPlan, type BpPlanWords } from "./bp-schedule";
import { d0Of } from "./doses";
import { chipFromCandidate } from "./lines";
import type { BpReadingView, BpView, DoctorTarget, QuotedLine } from "./types";

const MEASURING_VARIANTS = new Set(["how_to_measure"]);

export async function bpView(store: Store, session: SessionRow): Promise<BpView> {
  const day = session.story_day;
  const d0 = d0Of(session);
  const rows = await store.listBp(session.id, { toDay: day });
  const readings: BpReadingView[] = rows.map((r) => ({
    id: r.id,
    day: r.day,
    date: storyDate(d0, r.day),
    slot: r.slot,
    systolic: r.state === "recorded" ? r.systolic : null,
    diastolic: r.state === "recorded" ? r.diastolic : null,
    state: r.state === "recorded" && r.systolic !== null && r.diastolic !== null ? "recorded" : "unconfirmed",
  }));

  // R1 through lib/safety: word for word, with the session's speaker state
  const cands = await buildCandidates(store, session.id, { day, route: "explain", topics: ["target"], scope: session });
  const r1 = cands.list.find((c) => c.kind === "visit" && c.cite?.requiredLine === "R1") ?? null;
  let target: DoctorTarget | null = null;
  if (r1 && r1.cite?.day !== undefined && r1.cite.day < day) {
    const item = (await store.listVisitItems(session.id, { required_only: true })).find((i) => i.required_line === "R1");
    const s = Number(item?.slots?.systolic);
    const d = Number(item?.slots?.diastolic);
    if (Number.isFinite(s) && Number.isFinite(d)) {
      target = {
        sourceId: r1.sourceId,
        text: r1.span,
        systolic: s,
        diastolic: d,
        visitId: r1.cite.visitId ?? "",
        date: r1.cite.date ?? "",
        day: r1.cite.day,
        tStartMs: r1.cite.tStartMs ?? null,
        clipUrl: r1.cite.clipUrl ?? null,
        standInVoice: !!r1.cite.standInVoice,
        chip: chipFromCandidate(r1),
      };
    }
  }

  // the doctor's measuring words, only from this session's transcript (M2), with the line's speaker state
  const measuring: QuotedLine[] = [];
  // (C2 track E: a replay copy is a re-watch, not a visit: its lines are not quoted here)
  const visits = (await store.listVisits(session.id)).filter((v) => !isReplayCopy(v) && (v.day < day || (v.day === day && v.status !== "recording")));
  for (const v of visits) {
    const items = (await store.listVisitItems(session.id, { visit_id: v.id })).filter(
      (it) => MEASURING_VARIANTS.has(String(it.slots?.variant ?? "")) && it.slots?.superseded !== true && it.slots?.rejected !== true,
    );
    if (items.length === 0) continue;
    const transcript = liveTranscript(await store.listUtterances(session.id, v.id));
    for (const it of items) {
      const line = itemLineState(v, it, transcript);
      if (!line.said || !line.utterance) continue;
      if (line.role !== "doctor" && line.role !== "dispenser" && line.role !== "pharmacist") continue;
      if (judgementHits(it.text).length > 0) continue;
      const u = line.utterance;
      const clip = u.clip_path ? clipUrlFor(session, v.id, u.id) : null;
      measuring.push({
        sourceId: `visit:${v.id}:${u.id}`,
        text: it.text,
        chip: chipFromCandidate({
          attribution: line.role,
          kind: "visit",
          cite: { date: v.date, tStartMs: u.t_start_ms, roleState: line.state, standInVoice: !!u.clip_path?.includes("visits/clips/") },
        }),
        visitId: v.id,
        date: v.date,
        tStartMs: u.t_start_ms,
        clipUrl: clip,
      });
    }
  }
  return { day, readings, target, measuring };
}

// ---------------------------------------------------------------- C2 track B: an account's blood pressure page

/** The doctor's own sentence with a number, as an account's page quotes it (verbatim, date, time point, clip, state). */
export interface DoctorLineView {
  kind: "target" | "threshold";
  /** the whole sentence, as said */
  text: string;
  systolic: number;
  diastolic: number | null;
  visitId: string;
  /** YYYY-MM-DD of the visit */
  date: string;
  /** the visit's story day (owner 10-15: a reading is compared with the target only from that day on) */
  visitDay: number;
  tStartMs: number | null;
  clipUrl: string | null;
  /** the clip is a stand-in voice (代录音), not his recording */
  standIn: boolean;
  /** 医生说 when he confirmed it; 推断：医生 otherwise */
  state: "confirmed" | "inferred";
  utteranceId: string | null;
}

export interface AccountBpReading {
  id: string;
  day: number;
  date: string;
  slot: BpReadingRow["slot"];
  /** the part of the day it counts for: morning before noon, evening from noon on (real-app 2.9) */
  part: BpPart;
  /** local HH:MM it was recorded */
  time: string;
  systolic: number | null;
  diastolic: number | null;
  pulse: number | null;
  state: "recorded" | "unconfirmed";
  /** today's readings can be changed or deleted */
  editable: boolean;
}

/**
 * A part of the day the doctor's plan asks for, as the screens say it: measured (a reading in it), not measured (「这次没
 * 量」 or the job's record once the part passed, or the part passed and the job has not run yet), due now, or later.
 */
export type BpPartState = "measured" | "not_measured" | "due" | "later";

export interface AccountBpPlanView {
  words: BpPlanWords;
  kind: BpPlan["kind"];
  perWeek: number | null;
  parts: BpPart[];
  /** the parts the doctor's plan asks for today, each with its reminder time and whether a reading is in it */
  today: { part: BpPart; remind: string; closes: string; done: boolean; dueNow: boolean; state: BpPartState }[];
  /** the plan ended (the doctor's "for one week" is over) */
  ended: boolean;
}

export interface AccountBpView {
  day: number;
  date: string;
  readings: AccountBpReading[];
  /** the target he confirmed (the comparison line); null: only recording, no comparison */
  target: DoctorLineView | null;
  /** how often, as the doctor said (his confirmed instruction); null: no reminders */
  plan: AccountBpPlanView | null;
  measuring: QuotedLine[];
  /** today's readings above the doctor's warning line: the 995 template and the doctor's words (track S) */
  relays: { readingId: string; relay: ThresholdRelay }[];
}

/** A doctor's number as an account's page quotes it (the cite S's warning line builds: clip, time point, stand-in). */
export function doctorLineView(scope: Pick<SessionRow, "id" | "kind">, n: DoctorNumber, locale: Locale): DoctorLineView {
  const cite = warningLine(scope, n, locale).sentence.cite ?? {};
  return {
    kind: n.kind,
    text: n.text,
    systolic: n.systolic,
    diastolic: n.diastolic,
    visitId: n.visitId,
    date: n.visitDate,
    visitDay: n.visitDay,
    tStartMs: cite.tStartMs ?? n.tStartMs ?? null,
    clipUrl: cite.clipUrl ?? null,
    standIn: !!cite.standInVoice,
    state: n.state,
    utteranceId: cite.utteranceId ?? n.utteranceId ?? null,
  };
}

/** Local HH:MM of an instant in the scope's zone. */
function localTime(scope: SessionRow, iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? localHHMM(ms, scopeTz(scope)) : "";
}

/** S's relay for one reading (null: not above the doctor's warning line, or no line yet). */
export async function relayFor(store: Store, scope: SessionRow, r: Pick<BpReadingRow, "systolic" | "diastolic" | "state">, locale: Locale): Promise<ThresholdRelay | null> {
  if (r.state !== "recorded" || r.systolic === null) return null;
  return relayDoctorThreshold(store, scope, { systolic: r.systolic, diastolic: r.diastolic }, { locale });
}

export async function accountBpView(store: Store, scope: SessionRow, locale: Locale, nowMs: number = appNowMs()): Promise<AccountBpView> {
  const day = scope.story_day;
  const d0 = scopeD0(scope);
  const [rows, numbers, plan] = await Promise.all([
    store.listBp(scope.id, { toDay: day }),
    doctorNumbers(store, scope.id, { day, time: scope.story_time ?? null }),
    bpPlanFor(store, scope),
  ]);
  const readings: AccountBpReading[] = rows.map((r) => ({
    id: r.id,
    day: r.day,
    date: storyDate(d0, r.day),
    slot: r.slot,
    part: partOfReading(r),
    time: localTime(scope, r.created_at),
    systolic: r.state === "recorded" ? r.systolic : null,
    diastolic: r.state === "recorded" ? r.diastolic : null,
    pulse: r.pulse ?? null,
    state: r.state === "recorded" && r.systolic !== null && r.diastolic !== null ? "recorded" : "unconfirmed",
    editable: r.day === day,
  }));
  let planView: AccountBpPlanView | null = null;
  if (plan) {
    // C2 track J: the parts of the day are on the scope's own dates, so they are read at its own "now" (scopeNow)
    const at = scopeNow(scope, nowMs);
    const windows = bpWindows(scope, plan, day);
    planView = {
      words: plan.words,
      kind: plan.kind,
      perWeek: plan.perWeek,
      parts: plan.parts,
      today: windows.map((w) => {
        const inPart = rows.filter((r) => r.day === day && partOfReading(r) === w.part);
        const done = inPart.length > 0;
        const state: BpPartState = inPart.some((r) => r.state === "recorded" && r.systolic !== null)
          ? "measured"
          : done || at >= w.closeMs
            ? "not_measured"
            : at >= w.remindMs
              ? "due"
              : "later";
        return { part: w.part, remind: w.remind, closes: w.closes, done, dueNow: state === "due", state };
      }),
      ended: plan.toDay !== null && day > plan.toDay,
    };
  }
  const todays = rows.filter((r) => r.day === day && r.state === "recorded");
  const relays: AccountBpView["relays"] = [];
  for (const r of todays) {
    const relay = await relayFor(store, scope, r, locale);
    if (relay) relays.push({ readingId: r.id, relay });
  }
  // the doctor's measuring words (how to measure), from his confirmed visits, the way the demo page quotes them
  const measuring = (await bpView(store, scope)).measuring;
  return {
    day,
    date: storyDate(d0, day),
    readings,
    target: numbers.target ? doctorLineView(scope, numbers.target, locale) : null,
    plan: planView,
    measuring,
    relays,
  };
}
