/**
 * How often to measure, as the doctor said (C2 track B; real-app 2.9, e2e-chains 2.1 and 序 4). Pure, plus bpPlanFor
 * which reads the store.
 *
 * Only from the doctor's own words in a visit that happened, in a measuring instruction (the visit extraction's
 * measure_home item: "I want you to measure at home for one week, morning and evening.", "Keep measuring, twice a week
 * is enough now.") that he confirmed in the after-visit review (confirmed_by "patient", not marked "not right"). The
 * latest such instruction wins (the D8 visit's "twice a week" replaces the D0 "one week, morning and evening"). No such
 * instruction, or words this closed list does not read: no reminder, and nothing is ever recorded as "not measured"
 * (real-app 2.9: 看诊里没说过就不提醒，服务端也不记「该量没量」).
 *
 * The closed list (English and Mandarin, case-insensitive):
 *   parts of the day   "morning and evening" / "morning and night" / 早晚 -> morning + evening; "every morning" /
 *                      "in the morning" / 早上 -> morning; "every evening" / "at night" / 晚上 -> evening
 *   how often          "twice a week" / "two times a week" / 一周两次 / 每周两次 -> 2 a week; "once a week" / 每周一次 ->
 *                      1; "three times a week" / 每周三次 -> 3; "every day" / "daily" / 每天 -> every day
 *   for how long       "for one week" / "for a week" / 量一周 -> 7 days; "for two weeks" / 量两周 -> 14 days
 *   parts without "how often" ("morning and evening" alone) means every day.
 *
 * Which days, for "N times a week" (the doctor did not name the days; Ripple only spreads them, it decides nothing
 * clinical): counted from the day after the visit, the 1st and 4th day of every 7 for twice a week, the 1st, 3rd and
 * 5th for three times, the 1st for once. Mornings unless the doctor named a part of the day.
 */
import { clipUrlFor } from "@/lib/safety/candidates";
import { itemLineState, liveTranscript } from "@/lib/safety/line-state";
import type { SessionRow, Store, UtteranceRow, VisitItemRow, VisitRow } from "@/lib/store/types";
import { parseClockTime } from "@/lib/story/clock";
import { happenedVisits } from "@/lib/visit/happened";
import { slotAnchor, type RoutineEntry } from "./schedule";

export type BpPart = "morning" | "evening";

export interface BpPlanWords {
  /** the doctor's sentence as said */
  text: string;
  itemId: string;
  visitId: string;
  visitDay: number;
  visitDate: string;
  utteranceId: string | null;
  tStartMs: number | null;
  /** a playable clip of the line, when there is one */
  clipUrl: string | null;
  standIn: boolean;
  /** when the line was written into his record (the visit's end): nothing before it is ever "not measured" */
  recordedAt: string;
}

export interface BpPlan {
  words: BpPlanWords;
  kind: "daily" | "weekly";
  /** times a week (weekly) */
  perWeek: number | null;
  parts: BpPart[];
  /** the first story day it applies to: the day after the visit */
  fromDay: number;
  /** the last story day (inclusive), or null: until a later visit says otherwise */
  toDay: number | null;
}

export interface BpFrequency {
  kind: "daily" | "weekly";
  perWeek: number | null;
  parts: BpPart[];
  /** days it lasts from the day after the visit, or null */
  days: number | null;
}

const WORD_NUM: Record<string, number> = { one: 1, a: 1, "1": 1, two: 2, "2": 2, three: 3, "3": 3 };

/** The frequency the words say (the closed list in the header), or null when they say none. */
export function parseBpFrequency(text: string): BpFrequency | null {
  const t = text.normalize("NFKC").toLowerCase();
  let parts: BpPart[] = [];
  if (/\bmorning and (?:evening|night)\b|\b(?:evening|night) and morning\b|早晚/.test(t)) parts = ["morning", "evening"];
  else if (/\b(?:every|in the) morning\b|早上量|每天早上/.test(t)) parts = ["morning"];
  else if (/\bevery (?:evening|night)\b|\b(?:in the evening|at night)\b|晚上量|每天晚上/.test(t)) parts = ["evening"];

  let perWeek: number | null = null;
  const week = /\b(once|twice|one time|two times|three times|[123] times?) a week\b/.exec(t);
  if (week) {
    const w = week[1];
    perWeek = w === "once" || w.startsWith("one") || w.startsWith("1") ? 1 : w === "twice" || w.startsWith("two") || w.startsWith("2") ? 2 : 3;
  } else {
    const zh = /(?:一周|每周|一个星期|每个星期)(一|两|二|三)次/.exec(t);
    if (zh) perWeek = zh[1] === "一" ? 1 : zh[1] === "三" ? 3 : 2;
  }
  const daily = /\bevery day\b|\bdaily\b|\beach day\b|每天/.test(t);

  let days: number | null = null;
  const forWeeks = /\bfor (one|a|1|two|2|three|3) weeks?\b/.exec(t);
  if (forWeeks) days = 7 * (WORD_NUM[forWeeks[1]] ?? 1);
  else if (/量一周|量一个星期/.test(t)) days = 7;
  else if (/量两周|量两个星期/.test(t)) days = 14;

  if (perWeek !== null) return { kind: "weekly", perWeek, parts: parts.length ? parts : ["morning"], days };
  if (daily || parts.length) return { kind: "daily", perWeek: null, parts: parts.length ? parts : ["morning"], days };
  return null;
}

/**
 * When each part of the day is asked about, and when it passes: the morning reminder half an hour before his breakfast
 * (08:00 by default) until noon, the evening one an hour and a half after his dinner (20:00 by default) until 23:00. A
 * reading's part is morning before noon and evening from noon on (real-app 2.9; lib/daily/bp-changes.ts): a reading
 * at 14:00 is that day's evening reading, and no evening reminder follows it.
 */
export function bpPartTimes(routine: RoutineEntry[], part: BpPart): { remind: string; closes: string } {
  if (part === "morning") return { remind: shift(slotAnchor(routine, "morning").time, -30), closes: "12:00" };
  return { remind: shift(slotAnchor(routine, "evening").time, 90), closes: "23:00" };
}

function shift(hhmm: string, min: number): string {
  const t = Math.max(0, Math.min(23 * 60 + 59, parseClockTime(hhmm) + min));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** Days of every 7 (counted from the plan's first day) on which a weekly plan is due. */
export function weeklyOffsets(perWeek: number): number[] {
  return perWeek >= 3 ? [0, 2, 4] : perWeek === 2 ? [0, 3] : [0];
}

/** The parts of the day the plan asks for on this story day ([] when none). */
export function bpDueParts(plan: Pick<BpPlan, "kind" | "perWeek" | "parts" | "fromDay" | "toDay">, day: number): BpPart[] {
  if (day < plan.fromDay || (plan.toDay !== null && day > plan.toDay)) return [];
  if (plan.kind === "daily") return [...plan.parts];
  const offset = (((day - plan.fromDay) % 7) + 7) % 7;
  return weeklyOffsets(plan.perWeek ?? 1).includes(offset) ? [...plan.parts] : [];
}

/** A measuring instruction of the doctor's that he confirmed, said at a visit that happened. */
export function isConfirmedMeasuringLine(item: Pick<VisitItemRow, "type" | "slots" | "confirmed_by">): boolean {
  if (item.type !== "instruction") return false;
  const variant = String(item.slots?.variant ?? "");
  if (variant !== "measure_home") return false;
  if (item.slots?.superseded === true || item.slots?.rejected === true || item.slots?.disputed === true) return false;
  return item.confirmed_by === "patient";
}

export interface BpPlanRows {
  /** visits that happened (lib/visit/happened.ts) */
  visits: readonly VisitRow[];
  items: readonly VisitItemRow[];
  transcripts: ReadonlyMap<string, readonly UtteranceRow[]>;
}

/** Pure: the plan from rows already read (the latest confirmed measuring instruction with words the list reads). */
export function bpPlanFrom(rows: BpPlanRows): BpPlan | null {
  const byId = new Map(rows.visits.map((v) => [v.id, v]));
  const found: { plan: BpPlan; order: number }[] = [];
  for (const item of rows.items) {
    if (!isConfirmedMeasuringLine(item)) continue;
    const visit = byId.get(item.visit_id);
    if (!visit) continue;
    const transcript = liveTranscript([...(rows.transcripts.get(visit.id) ?? [])]);
    const line = itemLineState(visit, item, transcript);
    if (!line.said || line.role !== "doctor") continue;
    const text = line.utterance?.text ?? item.text;
    const f = parseBpFrequency(text);
    if (!f) continue;
    const fromDay = visit.day + 1;
    found.push({
      order: visit.day * 1e7 + (line.utterance?.t_start_ms ?? 0) / 1000,
      plan: {
        words: {
          text,
          itemId: item.id,
          visitId: visit.id,
          visitDay: visit.day,
          visitDate: visit.date,
          utteranceId: line.utterance?.id ?? null,
          tStartMs: line.utterance?.t_start_ms ?? null,
          clipUrl: null,
          standIn: false,
          recordedAt: item.created_at,
        },
        kind: f.kind,
        perWeek: f.perWeek,
        parts: f.parts,
        fromDay,
        toDay: f.days !== null ? fromDay + f.days - 1 : null,
      },
    });
  }
  found.sort((a, b) => b.order - a.order);
  return found[0]?.plan ?? null;
}

/** The scope's plan now (null: the doctor gave no frequency he confirmed), with the line's clip when there is one. */
export async function bpPlanFor(store: Store, scope: SessionRow): Promise<BpPlan | null> {
  const [visitsAll, items] = await Promise.all([store.listVisits(scope.id), store.listVisitItems(scope.id, { type: "instruction" })]);
  const visits = await happenedVisits(store, scope.id, visitsAll);
  const wanted = new Set(items.filter(isConfirmedMeasuringLine).map((i) => i.visit_id));
  const transcripts = new Map<string, UtteranceRow[]>();
  for (const id of wanted) transcripts.set(id, liveTranscript(await store.listUtterances(scope.id, id)));
  const plan = bpPlanFrom({ visits: visits.filter((v) => v.day <= scope.story_day), items, transcripts });
  if (!plan) return null;
  // the line's clip when the recording has one (the way lib/daily/bp.ts quotes the doctor's measuring words)
  const u = plan.words.utteranceId ? (transcripts.get(plan.words.visitId) ?? []).find((x) => x.id === plan.words.utteranceId) : undefined;
  if (u?.clip_path) plan.words = { ...plan.words, clipUrl: clipUrlFor(scope, plan.words.visitId, u.id), standIn: u.clip_path.includes("visits/clips/") };
  return plan;
}
