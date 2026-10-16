/**
 * The visit tab's first screen on his account (owner's decision of 10-14: the visit page and the question list are one
 * tab, and short; components/visit/elder/VisitHub.tsx draws it). What the server hands that screen:
 *
 *   visitRecord    an earlier visit's lines he confirmed as a clinician's: his 「是」 in the review, or, where he never
 *                  answered, a line the record holds as confirmed (lib/safety/line-state.ts itemLineState: the example
 *                  account's story visits, whose lines are matched to their items by the same words). One entry per
 *                  line, word for word with its clip, its kept Chinese and the record's own name for it, grouped as the
 *                  record classifies its items: what to watch for (the warning line, 「留意」, a missed dose, a line that
 *                  sends him to 995 or A&E) and the rest. A line he said is not right, or does not remember, is not here.
 *   hubSignals     what Ripple noted for the doctor since the last visit (lib/daily/signals.ts), newest first, at most
 *                  five, with the date and the time in his zone
 *   hubQuestions   his list (lib/profile/questions.ts) as one list: still to ask, the doctor's and the pharmacist's
 *                  together in the list's order, at most five (a second row with the same words left out), and how
 *                  many there are in all
 *
 * Nothing here words a clinical sentence: the lines are the record's, the signals and the questions his. Server-only
 * (a medicine's name comes from the knowledge base).
 */
import { isStandInClip } from "@/lib/asr";
import { lineRef } from "@/lib/explain/subjects";
import type { Locale } from "@/lib/i18n";
import { getDrug } from "@/lib/kb/load";
import type { QuestionList } from "@/lib/profile/questions";
import { itemLineState } from "@/lib/safety/line-state";
import type { SessionRow, Store, UtteranceRow, VisitItemRow, VisitRow } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { localDate, localHHMM } from "@/lib/time/clock";
import { clockLabel, reviewSpeaker, shortDate } from "./account-copy";
import { DOC_CARD_TYPES, variantOf } from "./extract";
import { isClinician } from "./roles";
import { vt, type VisitKey } from "./strings";
import { keptTranslations } from "./translate";
import type { DocVariant } from "./types";
import { emergencyItem, verdictOf } from "./verdict";
import { clipUrl } from "./view";

/** One line of an earlier visit, as its record shows it (the review's own entry, without 「改一下」). */
export interface HubLine {
  /** the line's id in the visit's transcript */
  id: string;
  /** the speaker's words, as said */
  text: string;
  lang: string | null;
  speaker: "doctor" | "dispenser" | "pharmacist";
  /** where in the recording, ms */
  tStartMs: number;
  /** the record's own name for it: 「目标」, 「警示线」, 「Amlodipine 5 mg · 为什么服用这个药」 */
  title: string | null;
  clip: { url: string; standIn: boolean } | null;
  /** the kept Chinese of a clinician's English line (lib/visit/translate.ts); null: the English alone */
  translation: string | null;
  /** what holding the line opens Ripple's read of (lib/explain/subjects.ts lineRef: the visit and one of its items) */
  hold: string;
}

/** An earlier visit's record: what to watch for, and everything else the clinicians said that he confirmed. */
export interface VisitRecordLines {
  told: HubLine[];
  watch: HubLine[];
}

/** Something Ripple noted for the doctor, as the screen says it. */
export interface HubSignal {
  id: string;
  /** 「10月13日」 */
  date: string;
  /** 「晚上 8:10」; null when the note has no time */
  time: string | null;
  /** his words */
  text: string;
  lang: string | null;
}

/** A question still to ask, for the screen's short list. */
export interface HubQuestion {
  id: string;
  text: string;
  lang: string | null;
  /** for the pharmacist (the row carries a small tag) */
  pharmacist: boolean;
}

/** What the visit tab's first screen shows besides the rows of the visits themselves. */
export interface VisitHubData {
  /** each earlier visit's record, by its id (a visit missing here could not be read: its row opens to the link alone) */
  records: Record<string, VisitRecordLines>;
  /** at most five, newest first; none: the screen leaves the section out */
  signals: HubSignal[];
  /** null: the list could not be read (the screen keeps the way to it) */
  questions: { shown: HubQuestion[]; total: number } | null;
}

/** The record's names for what to watch for: the warning line, 「留意」, what to do when a dose is missed. */
const WATCH: readonly DocVariant[] = ["threshold", "watch", "missed_dose"];

/** The rows a doctor's-note card has (lib/visit/view.ts), and only those: a consent or a question is not a record line. */
const RECORD_TYPES = new Set(DOC_CARD_TYPES);

const cap = (x: string) => (x ? x[0].toUpperCase() + x.slice(1) : x);

/** The record's own names for one line's items (as the review's entry title): 「目标」, 「Amlodipine 5 mg」. */
function titleOf(items: readonly VisitItemRow[], locale: Locale): string | null {
  const names: string[] = [];
  for (const it of items) {
    const variant = variantOf(it);
    const drug = typeof it.slots?.drug === "string" ? getDrug(it.slots.drug)?.display_name ?? it.slots.drug : null;
    const strength = typeof it.slots?.strength === "string" ? ` ${it.slots.strength}` : "";
    const name = (variant === "new_med" || variant === "med") && drug ? `${cap(drug)}${strength}` : vt(locale, `variant.${variant}` as VisitKey);
    if (!names.includes(name)) names.push(name);
  }
  return names.length ? names.join(" · ") : null;
}

/**
 * One earlier visit's record lines (see the top of the file). `transcript`: the visit's live lines; `items`: its items
 * (any others are ignored); `translations`: the kept Chinese by line id.
 */
export function visitRecord(input: {
  scope: Pick<SessionRow, "id" | "kind">;
  visit: Pick<VisitRow, "id" | "status">;
  transcript: readonly UtteranceRow[];
  items: readonly VisitItemRow[];
  translations: ReadonlyMap<string, string>;
  locale: Locale;
}): VisitRecordLines {
  const { scope, visit, locale } = input;
  const transcript = [...input.transcript];
  const byLine = new Map<string, { line: UtteranceRow; items: VisitItemRow[] }>();
  for (const it of input.items) {
    if (it.visit_id !== visit.id || !RECORD_TYPES.has(it.type) || it.slots?.superseded === true || it.slots?.rejected === true) continue;
    const verdict = verdictOf(it);
    if (verdict === "wrong" || verdict === "unsure") continue;
    const state = itemLineState(visit, it, transcript);
    const line = state.utterance;
    // a line of the transcript, a clinician's, that he confirmed (or that the record holds as confirmed)
    if (!line || !isClinician(line.role)) continue;
    if (verdict !== "right" && state.state !== "confirmed") continue;
    const group = byLine.get(line.id) ?? { line, items: [] };
    group.items.push(it);
    byLine.set(line.id, group);
  }
  const out: VisitRecordLines = { told: [], watch: [] };
  for (const { line, items } of [...byLine.values()].sort((a, b) => a.line.t_start_ms - b.line.t_start_ms)) {
    const entry: HubLine = {
      id: line.id,
      text: line.text,
      lang: line.lang,
      speaker: reviewSpeaker(line.role),
      tStartMs: line.t_start_ms,
      title: titleOf(items, locale),
      clip: line.clip_path ? { url: clipUrl(scope, visit.id, line.id), standIn: isStandInClip(line.clip_path) } : null,
      translation: input.translations.get(line.id) ?? null,
      hold: lineRef(visit.id, items[0].id),
    };
    const watch = items.some((it) => WATCH.includes(variantOf(it)) || emergencyItem(it)) || emergencyItem({ type: "instruction", text: line.text });
    (watch ? out.watch : out.told).push(entry);
  }
  return out;
}

/**
 * The records of the earlier visits the screen lists: their items read once, then the kept Chinese of the lines that
 * are shown (only those). `store`: the page's (a readOnce store answers every kept translation from one list).
 */
export async function pastRecords(
  store: Store,
  scope: Pick<SessionRow, "id" | "kind">,
  past: readonly { visit: Pick<VisitRow, "id" | "status">; transcript: readonly UtteranceRow[] }[],
  locale: Locale,
): Promise<Record<string, VisitRecordLines>> {
  if (!past.length) return {};
  const items = await store.listVisitItems(scope.id);
  const out: Record<string, VisitRecordLines> = {};
  for (const p of past) out[p.visit.id] = visitRecord({ scope, visit: p.visit, transcript: p.transcript, items: items.filter((it) => it.visit_id === p.visit.id), translations: new Map(), locale });
  const shown = Object.values(out).flatMap((r) => [...r.told, ...r.watch]);
  const kept = await keptTranslations(store, scope.id, shown);
  for (const line of shown) line.translation = kept.get(line.id) ?? null;
  return out;
}

/** A note for the doctor as lib/daily/signals.ts lists it. */
export interface SignalRow {
  id: string;
  /** when he said it: an instant (ISO), or the time of day ("HH:MM") */
  at: string;
  /** the day: a date ("YYYY-MM-DD"), or his story day as a number */
  day: string;
  text: string;
  lang: string | null;
}

export const HUB_SIGNALS_MAX = 5;
export const HUB_QUESTIONS_MAX = 5;

/** The notes for the doctor, newest first, at most five, with the date and the time in his zone (`d0`: his first day). */
export function hubSignals(rows: readonly SignalRow[], opts: { d0: string; tz: string; locale: Locale }): HubSignal[] {
  const when = (r: SignalRow): { date: string | null; hhmm: string | null } => {
    const ms = Date.parse(r.at);
    const clock = /^\d{1,2}:\d{2}$/.test(r.at.trim()) ? r.at.trim().padStart(5, "0") : null;
    const instant = !clock && /\d{4}-\d{2}-\d{2}T/.test(r.at) && Number.isFinite(ms) ? ms : null;
    const day = r.day.trim();
    const date = /^\d{4}-\d{2}-\d{2}/.test(day) ? day.slice(0, 10) : /^\d+$/.test(day) ? storyDate(opts.d0, Number(day)) : instant !== null ? localDate(instant, opts.tz) : null;
    return { date, hhmm: clock ?? (instant !== null ? localHHMM(instant, opts.tz) : null) };
  };
  return rows
    .map((r) => ({ r, ...when(r) }))
    .sort((a, b) => `${b.date ?? ""} ${b.hhmm ?? ""}`.localeCompare(`${a.date ?? ""} ${a.hhmm ?? ""}`))
    .slice(0, HUB_SIGNALS_MAX)
    .map(({ r, date, hhmm }) => ({ id: r.id, date: date ? shortDate(date, opts.locale) : "", time: hhmm ? clockLabel(hhmm, opts.locale) : null, text: r.text, lang: r.lang }));
}

/** His list as the screen's one short list: the first five still to ask (doctor's and pharmacist's together), and how many in all. */
export function hubQuestions(list: QuestionList): { shown: HubQuestion[]; total: number } {
  const shown = list.open
    .filter((q) => !q.duplicateOf)
    .slice(0, HUB_QUESTIONS_MAX)
    .map((q) => ({ id: q.id, text: q.text, lang: q.lang, pharmacist: q.for === "pharmacist" }));
  return { shown, total: list.counts.open };
}
