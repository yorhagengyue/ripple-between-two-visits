/**
 * Ripple's summary of a visit (the owner's decision of 2026-10-14: a recording should work like a meeting AI, a live
 * transcript, a live summary while it is recorded and a final summary at its end; "I speak, and it summarises").
 * Server-only.
 *
 * What it is: at most four short points of what was said, each naming the lines it rests on, attributed to a speaker
 * only where the transcript names one, in his language. ONE call to the main model writes them from the visit's lines
 * and from nothing else; the guards below drop a point that says what it must not. It is Ripple's notes, never the
 * record: wherever it is shown it is labelled as Ripple's and not confirmed (「Ripple 根据录到的话整理，未经确认」), the
 * doctor's own lines stay below it word for word, and it never becomes a source for an answer (it is not a line and not
 * an item he can confirm: lib/safety reads neither, see "Where it lives").
 *
 * Live (noteVisitLines, called by lib/visit/pipeline.ts processChunk after it stored a line): while the visit is
 * recording, at most every LIVE_SUMMARY_EVERY_MS (15 s) and only when new lines arrived since the last call, the model
 * is given the last 40 lines (and the lines the points on screen rest on) with those points, and keeps or changes them.
 * The points go out as the event visit.summary (stage "live") on his own stream, next to the captions. A call is never
 * made twice at once for a visit: lines that arrive while one runs are taken by the next. Nothing is kept: a reload
 * shows the next update.
 *
 * Final (writeFinalSummary, started by finalizeVisit once the whole-visit record is made, in the background): the same
 * call over the whole transcript (stage "final"); the points are kept with the visit and go out as visit.summary (stage
 * "final"), so a review page that is already open shows them as they arrive (components/visit/elder/AccountReview.tsx).
 *
 * The gates (all of them, in this order, the cheap ones first; skipped silently, the screens then show the captions and
 * the lines alone):
 *   not_account    a real account's visit only (the judges use accounts; a demo session never asks)
 *   no_model       a live model: never the offline mock, nor a replay client (it answers only recorded prompts)
 *   no_consent     his consent to AI processing (lib/safety/consent.ts): without it no model sees his visit
 *   spend_cap      his day's model spend (lib/llm/person-spend.ts): asked before every call, and the call is counted
 *
 * The guards (guardSummaryPoint; codes in the server log, never the model's words). A point that fails one is dropped;
 * the others stay:
 *   untied            it names no line among those it was given
 *   too_long          more than two sentences, or more than 90 characters of Chinese / 220 of English
 *   language          not in his language
 *   second_person     it speaks to him (你 / 您 / you): the notes are about what was said, never to him
 *   instruction       an instruction in Ripple's own voice: a directive (lib/safety/directive.ts), an opening such as
 *                     请 / 记得 / 不要 / 别, or a dose (an amount with a unit: 一粒, 5 mg) or how often, with no
 *                     clinician named as having said it
 *   attribution       it says a doctor, pharmacist or the counter said it, and none of its lines is that speaker's
 *   slot_*            a medicine, unit, frequency, time or number that its lines do not have (lib/safety/slots.ts)
 *   number            a number (digits or written out) that its lines do not have
 *   medicine          a medicine, supplement or other product its lines do not name
 *   diagnosis         an illness its lines do not name (verdict.ts's words, with the Chinese and English names of the
 *                     same illness taken as one); suggests_illness: pointing at one ("may indicate", 可能是 ...)
 *   judgement_*       reassurance or "not mentioned" always; any other judging word (high, good, safe, only ...) only
 *                     when its lines judge in the same way themselves (lib/safety/judgement.ts categories)
 *   negation          its lines say not / no / don't and it does not, or the other way round
 *   register          吃了 / 没吃 / 看诊 (the owner's professional words: 服药 / 未服药 / 就诊)
 *   crisis            995, A&E or an ambulance: the warning line is shown in the doctor's own words, never as Ripple's
 *   do_not_display_number  a number on referrals.json's B4-06 list (lib/safety/forbidden.ts)
 *
 * Where it lives: one visit_item row per visit (type "summary", id "<visit>-ripple-summary", a fixed neutral text, no
 * utterance ids, never confirmed), the points in slots.summary. No migration (visit_item.type is plain text), it goes
 * with the visit (its foreign key cascades) and it is in his export. Every reader of visit items leaves it out:
 * lib/visit/view.ts reads it apart from the cards, lib/visit/pipeline.ts refuses a verdict on it, lib/safety/candidates.ts
 * and lib/explain/evidence.ts skip its type, and a reader that lists items without filtering shows the neutral text,
 * never the points.
 */
import { publish } from "@/lib/bus";
import { illnessWords, SECOND_PERSON, SUGGESTS_ILLNESS, sentenceCount } from "@/lib/explain/verdict";
import { mentionedDrugIds } from "@/lib/kb/match";
import { createMainLlm } from "@/lib/llm";
import { parseModelJson } from "@/lib/llm/json";
import type { SummaryPayload } from "@/lib/llm/protocol";
import type { LlmClient } from "@/lib/llm/types";
import { unknownDrugName } from "@/lib/safety/classify";
import { aiConsent } from "@/lib/safety/consent";
import { isDirective } from "@/lib/safety/directive";
import { findForbiddenNumbers } from "@/lib/safety/forbidden";
import { modelWordingHits, type JudgementCategory } from "@/lib/safety/judgement";
import { extractSlots, missingSlots } from "@/lib/safety/slots";
import { otherSubstances } from "@/lib/safety/substances";
import { hasHan } from "@/lib/safety/text";
import { isAccount } from "@/lib/store/scope";
import type { SessionRow, Store, UtteranceRole, UtteranceRow } from "@/lib/store/types";
import { personSpendFor } from "@/lib/subject/usage";
import { hasNegation } from "@/lib/translate/facts";
import { SUPERSEDED_LANG } from "./state";
import { SUMMARY_ITEM_TEXT, SUMMARY_ITEM_TYPE, summaryItemId } from "./summary-item";
import type { VisitSummaryView } from "./types";

export { SUMMARY_ITEM_TEXT, SUMMARY_ITEM_TYPE, summaryItemId, storedSummary, isSummaryItem } from "./summary-item";

export type SummaryLocale = "zh-Hans" | "en";

/** At most one live call per visit in this time (and only when new lines arrived). */
export const LIVE_SUMMARY_EVERY_MS = 15_000;
export const MAX_POINTS = 4;
/** the live call, and the final one over the whole transcript */
export const LIVE_SUMMARY_TIMEOUT_MS = 15_000;
export const FINAL_SUMMARY_TIMEOUT_MS = 30_000;
/** the live call reads at most this many of the latest lines (and the lines the points on screen rest on) */
export const LIVE_WINDOW_LINES = 40;
/** what the model is given at most, in characters of the lines' words (the latest lines are kept) */
const LIVE_MAX_CHARS = 6000;
const FINAL_MAX_CHARS = 40_000;

/** A summary as the screens draw it (lib/visit/types.ts). */
export type SummaryView = VisitSummaryView;
/** One point: its words and the ids of the lines it rests on. */
export type SummaryPoint = VisitSummaryView["points"][number];

export const SYSTEM_SUMMARY = [
  "You take notes for an elderly patient at his visit to a doctor or a pharmacist. You are given LINES of the visit as a speech recogniser heard them, in order: each with an id, who said it when the transcript names the speaker (doctor, pharmacist, clinic counter, the patient, family member; null when it does not), and the words.",
  "Rules:",
  "1. Write at most 4 short points (never more) of what was said, the most important first, in the language `locale` names (zh-Hans: Simplified Chinese; en: English). One short sentence each (at most 30 words in English, 50 characters in Chinese), in plain and professional words (zh-Hans: 已服药 / 未服药 / 就诊 / 测量血压, never 吃了 / 没吃 / 看诊).",
  "2. Each point says what one or more LINES say and lists their ids in `lines`. Never write a point that no line says.",
  "3. Say who said it only when its lines name the speaker (医生说… / The doctor said …). For a line without a speaker, say what was said, never who said it.",
  "4. Use only the words of the lines: add no number, dose, time, date, medicine name or fact that is not in them, and keep every not, no and don't they have.",
  "5. Write about him in the third person or with no pronoun (本人 / he), never 你 / 您 / you. Never tell him to do anything: what a speaker asked him to do is reported as that speaker's (医生请他每天早上服用… / The doctor asked him to …).",
  "6. Never name or suggest an illness, a cause or a diagnosis that the lines do not name. Never reassure or alarm (no 不用担心 / nothing to worry about / it is fine / it is dangerous), and never judge a reading or a medicine yourself.",
  "7. Leave out greetings, small talk and words the recogniser clearly misheard. If nothing of substance was said yet, write no point.",
  '8. `stage` "live": the visit is still going on, and PREVIOUS are the points shown now: keep a point that still holds in the same words, and change or add only what the new lines change. `stage` "final": the whole visit.',
  '9. Output JSON only: {"points": [{"text": string, "lines": [string]}]}.',
].join("\n");

const BY: Partial<Record<UtteranceRole, string>> = { doctor: "doctor", pharmacist: "pharmacist", dispenser: "clinic counter", patient: "the patient", family: "family member" };

const liveLines = (rows: readonly UtteranceRow[]): UtteranceRow[] => rows.filter((u) => u.lang !== SUPERSEDED_LANG && u.text.trim()).sort((a, b) => a.t_start_ms - b.t_start_ms);

/**
 * The model's input: the lines under short ids (L1, L2 ...) and who said each one as the transcript has it now (the
 * screens say the notes are not confirmed), and `ids`, short id -> line id.
 */
export function summaryPayload(lines: readonly UtteranceRow[], locale: SummaryLocale, stage: "live" | "final", previous: readonly string[] = []): { payload: SummaryPayload; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  const out = lines.map((u, i) => {
    const id = `L${i + 1}`;
    ids.set(id, u.id);
    return { id, by: BY[u.role] ?? null, text: u.text.trim() };
  });
  return { payload: { task: "summary", stage, locale, lines: out, ...(stage === "live" && previous.length ? { previous: [...previous] } : {}) }, ids };
}

/** The points as written: { points: [{ text, lines }] } (a bare array is read the same way); null when it does not read. */
export function readSummaryAnswer(content: string): { text: string; lines: string[] }[] | null {
  let body: unknown;
  try {
    body = parseModelJson(content);
  } catch {
    return null;
  }
  const list = Array.isArray(body) ? body : body && typeof body === "object" ? (body as { points?: unknown }).points : null;
  if (!Array.isArray(list)) return null;
  const out: { text: string; lines: string[] }[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const { text, lines } = item as { text?: unknown; lines?: unknown };
    if (typeof text !== "string" || !text.trim()) continue;
    const ids = Array.isArray(lines) ? lines : [lines];
    out.push({ text: text.trim(), lines: [...new Set(ids.filter((x): x is string => typeof x === "string"))] });
  }
  return out;
}

// ---------------------------------------------------------------- the guards

const REGISTER_ZH = /吃了|没吃|沒吃|看诊|看診/u;
const CRISIS = /(?<!\d)995(?!\d)|\bA\s*&\s*E\b|急诊|急診|急症室|救护车|救護車|\bambulance\b/i;
/** Ripple's own instruction: an opening that tells him to do something (the directive patterns catch the rest). */
const COMMAND_ZH = /^(?:请|請|记得|記得|务必|務必|一定要|千万|千萬|不要|别|別|要|应该|應該|需要)/u;
const COMMAND_EN = /^(?:please\s+|remember\s+to\b|make\s+sure\b|be\s+sure\b|do\s+not\b|don't\b|never\b|always\b|keep\b|avoid\b)/i;

/** What a clinician is reported to have said or done: a verb right after their name, in either language. */
const SAID_ZH = "(?:说|說|提到|表示|建议|建議|请|請|嘱|囑|要求|让|讓|叮嘱|叮囑|提醒|告知|解释|解釋|认为|認為|指出|开|開|问|問|安排|希望|确认|確認|给|給|换|換|停|加|减|減|保持|调整|調整|测|測|检查|檢查)";
const SAID_EN =
  "(?:said|says|told|tells|asked|asks|advised|advises|recommended|recommends|mentioned|explained|suggested|prescribed|prescribes|noted|wants|will|would|reminded|confirmed|started|starts|gave|gives|put|changed|stopped|increased|reduced|lowered|raised|switched|added|kept|planned|plans|ordered|arranged|checked|measured)";
const reportedBy = (zh: string, en: string): RegExp =>
  new RegExp(String.raw`(?:${zh})[^，,。.；;]{0,6}?${SAID_ZH}|\b(?:the\s+)?(?:${en})(?:\s+[A-Z][a-z]+)?\s+(?:\w+\s+){0,2}?${SAID_EN}\b`, "i");

/** A clinician named as the one who said it, with the role the transcript must hold for one of the point's lines. */
const SAID_BY: { role: UtteranceRole; re: RegExp }[] = [
  { role: "doctor", re: reportedBy("医生|醫生|大夫|医师|醫師", String.raw`doctor|dr\.?|gp`) },
  { role: "pharmacist", re: reportedBy("药剂师|藥劑師", "pharmacist") },
  { role: "dispenser", re: reportedBy("柜台|櫃檯|配药处|配藥處", String.raw`clinic\s+counter|counter`) },
];

/** A dose: an amount with a unit (一粒, 5 mg, one tablet), read as lib/safety/gloss.ts reads one. */
const DOSE_ZH = /(?:\d+(?:\.\d+)?|[一二两兩三四五六七八九十百半几幾])\s*(?:粒|片|颗|顆|毫克|毫升|微克|克|mg|mcg|ml|胶囊|膠囊|袋|包|支|滴|剂|劑)/iu;
const DOSE_EN = /\b(?:\d+(?:\.\d+)?|one|two|three|four|five|six|half|a|an|another|extra|single|double)\s*-?\s*(?:tablets?|pills?|capsules?|caps|mg|mcg|ml|milligrams?|doses?|puffs?|drops?|sachets?)\b|\d(?:\.\d+)?\s*(?:mg|mcg|ml)\b/i;

/** The same illness in either language: a word the point uses counts as named when its lines name it in the other. */
const SAME_ILLNESS: [RegExp, RegExp][] = [
  [/高血压|高血壓/u, /hypertension|high blood pressure|high pressure/i],
  [/低血压|低血壓/u, /hypotension|low blood pressure/i],
  [/糖尿病/u, /diabet/i],
  [/中风|中風/u, /stroke/i],
  [/心脏病|心臟病/u, /heart disease/i],
  [/心梗/u, /heart attack/i],
  [/心衰/u, /heart failure/i],
  [/心绞痛|心絞痛/u, /angina/i],
  [/肾病|腎病/u, /kidney disease/i],
  [/肾衰|腎衰/u, /kidney failure/i],
  [/癌/u, /cancer/i],
  [/肿瘤|腫瘤/u, /tumou?r/i],
  [/感染/u, /infection/i],
  [/症状|症狀/u, /symptom/i],
  [/诊断|診斷/u, /diagnos/i],
];

function illnessNamed(word: string, given: string): boolean {
  if (given.toLowerCase().includes(word.toLowerCase())) return true;
  for (const [zh, en] of SAME_ILLNESS) {
    if (zh.test(word) && en.test(given)) return true;
    if (en.test(word) && zh.test(given)) return true;
  }
  return false;
}

const ZH_DIGIT: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const ZH_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000, 萬: 10000 };

/** A Chinese numeral written out (一百四十 -> 140, 十五 -> 15, 一四零 -> 140), or null. */
function zhNumber(run: string): number | null {
  if ([...run].every((c) => c in ZH_DIGIT)) return Number([...run].map((c) => ZH_DIGIT[c]).join(""));
  let total = 0;
  let digit = 0;
  for (const c of run) {
    if (c in ZH_DIGIT) digit = ZH_DIGIT[c];
    else if (c in ZH_UNIT) {
      total += (digit || 1) * ZH_UNIT[c];
      digit = 0;
    } else return null;
  }
  return total + digit;
}

const EN_NUMBERS: Record<string, number> = {
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
};

/** Numbers written out: two or more Chinese numerals in a row, and English number words from eleven up. */
function spelledNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/[零〇一二两兩三四五六七八九十百千万萬]{2,}/gu)) {
    const n = zhNumber(m[0]);
    if (n !== null) out.push(n);
  }
  for (const m of text.toLowerCase().matchAll(/\b[a-z]+\b/g)) if (m[0] in EN_NUMBERS) out.push(EN_NUMBERS[m[0]]);
  return out;
}

/** A text's numbers in every form: digits, numbers written out, and layer 1's number slots. */
function numbersOf(text: string): Set<string> {
  const out = new Set<string>(extractSlots(text).numbers);
  for (const d of text.match(/\d+(?:\.\d+)?/g) ?? []) out.add(String(Number(d)));
  for (const n of spelledNumbers(text)) out.add(String(n));
  return out;
}

/** Judging words the point may use only when its lines judge in the same way (reassurance and absence: never). */
const NEVER: ReadonlySet<JudgementCategory> = new Set<JudgementCategory>(["reassurance", "absence"]);

export interface GuardLine {
  text: string;
  role: UtteranceRole;
}

/**
 * Why one point may not be shown (codes; empty: it may), given the lines it rests on. Over-blocks on purpose: a point
 * dropped leaves the others, and the doctor's own lines are always on the screen.
 */
export function guardSummaryPoint(point: string, rests: readonly GuardLine[], locale: SummaryLocale): string[] {
  const text = point.normalize("NFKC").trim();
  if (!text) return ["empty"];
  if (rests.length === 0) return ["untied"];
  const given = rests.map((r) => r.text).join("\n");
  const reasons = new Set<string>();
  const zh = hasHan(text);
  if (sentenceCount(text) > 2 || [...text].length > (zh ? 90 : 220)) reasons.add("too_long");
  if (zh !== (locale === "zh-Hans")) reasons.add("language");
  if (SECOND_PERSON.test(text)) reasons.add("second_person");
  // who said it: a clinician named as the speaker must be the speaker of one of its lines
  const roles = new Set(rests.map((r) => r.role));
  const named = SAID_BY.filter((s) => s.re.test(text));
  if (named.some((s) => !roles.has(s.role))) reasons.add("attribution");
  // an instruction, a dose or how often is only ever reported as a clinician's (named, and the speaker of one of its
  // lines): never in Ripple's own voice
  const reported = named.length > 0 && named.every((s) => roles.has(s.role));
  const own = extractSlots(text);
  const dosing = DOSE_ZH.test(text) || DOSE_EN.test(text) || own.frequencies.length > 0;
  if (!reported && (isDirective(text) || COMMAND_ZH.test(text) || COMMAND_EN.test(text) || dosing)) reasons.add("instruction");
  // nothing its lines do not have
  const givenSlots = extractSlots(given);
  // 饭前饭后都可以 put in other words (饭前饭后均可, "before or after food") reads as one of the two: the lines' "with or
  // without food" covers it, as long as the point itself still says both (饭后 alone would say less than the lines)
  const eitherWayFood = givenSlots.times.includes("with_or_without_food") && /饭前[^。.]{0,4}饭后|饭后[^。.]{0,4}饭前|before\s+or\s+after|with\s+or\s+without/i.test(text);
  for (const m of missingSlots(own, givenSlots)) {
    if (m.category === "times" && eitherWayFood && /^(?:before|after)_(?:food|meals?)$/.test(m.value)) continue;
    reasons.add(`slot_${m.category}`);
  }
  const known = numbersOf(given);
  for (const n of numbersOf(text)) if (!known.has(n)) reasons.add("number");
  const theirs = new Set(mentionedDrugIds(given));
  const products = otherSubstances(given);
  const others = new Set([...products.medicines, ...products.foods]);
  // 此药 / 该药 / 本药 ("this medicine") read as 这个药: the substance check takes the character before 药 for a kind of
  // medicine (降压药), and these are the medicine the lines speak of
  const mine = otherSubstances(text.replace(/(?:此|该|該|本|其)(?=[药藥])/gu, "这个"));
  const unknown = unknownDrugName(text);
  if (
    mentionedDrugIds(text).some((d) => !theirs.has(d)) ||
    (unknown !== null && !given.toLowerCase().includes(unknown.toLowerCase())) ||
    [...mine.medicines, ...mine.foods].some((x) => !others.has(x) && !given.toLowerCase().includes(x))
  ) {
    reasons.add("medicine");
  }
  const illnesses = illnessWords(text);
  if (illnesses.some((w) => !illnessNamed(w, given))) reasons.add("diagnosis");
  if (SUGGESTS_ILLNESS.test(text)) reasons.add("suggests_illness");
  // judging words: read without the illness names (so "high blood pressure" is not "high")
  let plain = text;
  for (const w of illnesses) plain = plain.split(w).join(" ");
  const said = new Set(modelWordingHits(given).map((h) => h.category));
  for (const h of modelWordingHits(plain)) if (NEVER.has(h.category) || !said.has(h.category)) reasons.add(`judgement_${h.category}`);
  if (hasNegation(text) !== rests.some((r) => hasNegation(r.text))) reasons.add("negation");
  if (REGISTER_ZH.test(text)) reasons.add("register");
  if (CRISIS.test(text)) reasons.add("crisis");
  if (findForbiddenNumbers(text).length > 0) reasons.add("do_not_display_number");
  return [...reasons];
}

// ---------------------------------------------------------------- the call

/** What one call did (the server log; codes and counts, never the model's words). */
export interface SummaryRecord {
  /** points the model wrote, points shown */
  written: number;
  kept: number;
  /** the guard codes of the points dropped */
  dropped: string[][];
  error?: string;
  tokens: number;
  ms: number;
}

/** A short code for an error, never its message (a vendor's message can echo the prompt). */
function errorCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[a-z_]{1,32}$/.test(code)) return code;
  const name = (e as { name?: unknown } | null)?.name;
  return name === "AbortError" || name === "TimeoutError" ? "deadline" : "error";
}

export interface WriteSummaryInput {
  /** the lines the model may read, in order */
  lines: readonly UtteranceRow[];
  locale: SummaryLocale;
  stage: "live" | "final";
  /** live: the points on screen now */
  previous?: readonly SummaryPoint[];
  llm: LlmClient;
  timeoutMs?: number;
}

/** One call and its guards: the points that may be shown (at most four, in the model's order), and what happened. */
export async function writeSummary(input: WriteSummaryInput): Promise<{ points: SummaryPoint[]; record: SummaryRecord }> {
  const started = Date.now();
  const timeoutMs = input.timeoutMs ?? (input.stage === "live" ? LIVE_SUMMARY_TIMEOUT_MS : FINAL_SUMMARY_TIMEOUT_MS);
  const { payload, ids } = summaryPayload(input.lines, input.locale, input.stage, (input.previous ?? []).map((p) => p.text));
  const record: SummaryRecord = { written: 0, kept: 0, dropped: [], tokens: 0, ms: 0 };
  let content: string;
  try {
    const res = await input.llm.chat({
      system: SYSTEM_SUMMARY,
      user: JSON.stringify(payload),
      json: true,
      temperature: 0.2,
      // four short points; the whole visit gets a little more room, so an answer is never cut off half way through its JSON
      maxTokens: input.stage === "live" ? 600 : 900,
      timeoutMs,
      purpose: "summary",
      signal: AbortSignal.timeout(timeoutMs),
    });
    record.tokens = res.tokens;
    content = res.content;
  } catch (e) {
    return { points: [], record: { ...record, error: errorCode(e), ms: Date.now() - started } };
  }
  const written = readSummaryAnswer(content);
  if (!written) return { points: [], record: { ...record, error: "bad_response", ms: Date.now() - started } };
  record.written = written.length;
  const byId = new Map(input.lines.map((u) => [u.id, u]));
  const points: SummaryPoint[] = [];
  for (const w of written) {
    const lines = w.lines.map((short) => ids.get(short)).filter((id): id is string => !!id && byId.has(id));
    const rests = lines.map((id) => byId.get(id)!).map((u) => ({ text: u.text, role: u.role }));
    const reasons = lines.length === 0 ? ["untied"] : guardSummaryPoint(w.text, rests, input.locale);
    if (reasons.length) {
      record.dropped.push(reasons);
      continue;
    }
    if (points.length < MAX_POINTS) points.push({ text: w.text, lines });
  }
  record.kept = points.length;
  record.ms = Date.now() - started;
  if (record.dropped.length) console.warn(`[summary] ${record.dropped.length} point(s) dropped (${[...new Set(record.dropped.flat())].join(", ")})`);
  return { points, record };
}

// ---------------------------------------------------------------- the gates

/** What the calls of one visit need besides the store; tests hand their own (setSummaryTestDeps for the routes). */
export interface SummaryDeps {
  /** the model (null: none may be asked); default the main model */
  llm?: LlmClient | null;
  /** his consent to AI processing, already read (default: read through the store) */
  aiAllowed?: boolean;
  /** his language (default: his account's, else his settings', else zh-Hans) */
  locale?: SummaryLocale;
  /** where his account row is read from for his language (a scheduled job's store is bound to his scope only) */
  accountStore?: Pick<Store, "getAccount">;
  /** his day's model spend (null: not counted); default lib/llm/person-spend.ts for his scope */
  spend?: { capped(): Promise<boolean>; wrap<T extends LlmClient | null>(client: T): T; settle(): Promise<void> } | null;
  /** live: the time between two calls, and the clock */
  everyMs?: number;
  now?: () => number;
}

type GlobalWithSummary = typeof globalThis & { __rippleSummaryTestDeps?: SummaryDeps | null; __rippleLiveSummaries?: Map<string, LiveState> };

/** Tests of the routes: what every summary of this process uses unless the caller hands its own. null clears it. */
export function setSummaryTestDeps(deps: SummaryDeps | null): void {
  (globalThis as GlobalWithSummary).__rippleSummaryTestDeps = deps;
}

/**
 * The caller's own over the tests' (setSummaryTestDeps), over the defaults. Exported for the other live model step of a
 * recording, who is speaking (lib/visit/pipeline.ts labelLinesLater): it asks with the same gates and the same test deps.
 */
export function depsOr(deps: SummaryDeps | undefined): SummaryDeps {
  return { ...((globalThis as GlobalWithSummary).__rippleSummaryTestDeps ?? {}), ...(deps ?? {}) };
}

const offline = (c: LlmClient | null): boolean => !c || c.provider === "mock" || c.provider.startsWith("replay");

export type SummaryGate = { ok: true; llm: LlmClient; settle: () => Promise<void> } | { ok: false; why: "not_account" | "no_consent" | "no_model" | "spend_cap" };

/** May a model write his visit's notes now (see the header)? With the client to ask, counted in his day's spend. */
export async function summaryGate(store: Store, session: SessionRow, deps: SummaryDeps): Promise<SummaryGate> {
  if (!isAccount(session)) return { ok: false, why: "not_account" };
  const llm = deps.llm !== undefined ? deps.llm : createMainLlm();
  if (offline(llm)) return { ok: false, why: "no_model" };
  const allowed = deps.aiAllowed ?? (await aiConsent(store, session).catch(() => false));
  if (!allowed) return { ok: false, why: "no_consent" };
  const spend = deps.spend !== undefined ? deps.spend : personSpendFor(session);
  if (spend && (await spend.capped())) return { ok: false, why: "spend_cap" };
  return { ok: true, llm: spend ? spend.wrap(llm!) : llm!, settle: () => spend?.settle() ?? Promise.resolve() };
}

/** His language: his account's, else his settings', else zh-Hans. */
async function localeOf(store: Pick<Store, "getAccount">, session: SessionRow): Promise<SummaryLocale> {
  const read = typeof store.getAccount === "function" && session.owner_user_id ? store.getAccount(session.owner_user_id) : null;
  const account = read ? await read.catch(() => null) : null;
  const raw = account?.locale ?? (typeof session.settings?.locale === "string" ? session.settings.locale : null);
  return raw === "en" ? "en" : "zh-Hans";
}

// ---------------------------------------------------------------- live

interface LiveState {
  sessionId: string;
  visitId: string;
  store: Store;
  session: SessionRow;
  deps: SummaryDeps;
  /** a new recording of the visit starts a new generation: an older call's answer is dropped */
  generation: number;
  lastStartAt: number | null;
  /** lines read by the last call */
  linesAtLastCall: number;
  running: Promise<void> | null;
  /** lines arrived while a call ran: the next one takes them */
  dirty: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  points: SummaryPoint[];
  locale: SummaryLocale | null;
  /** why the last tick did not call (tests and the server log) */
  skipped: string | null;
}

function registry(): Map<string, LiveState> {
  const g = globalThis as GlobalWithSummary;
  return (g.__rippleLiveSummaries ??= new Map());
}

const keyOf = (sessionId: string, visitId: string) => `${sessionId}|${visitId}`;

/** A new recording of the visit (or its end): its live notes start again. */
export function resetLiveSummary(sessionId: string, visitId: string): void {
  const st = registry().get(keyOf(sessionId, visitId));
  if (!st) return;
  if (st.timer) clearTimeout(st.timer);
  registry().delete(keyOf(sessionId, visitId));
  st.generation += 1;
}

/** The live notes of a visit as they stand (tests; and her live view as it opens, lib/care/live-visit.ts: scene 1, 10-15). */
export function liveSummaryOf(sessionId: string, visitId: string): { points: SummaryPoint[]; skipped: string | null; lastStartAt: number | null; locale: SummaryLocale | null } | null {
  const st = registry().get(keyOf(sessionId, visitId));
  return st ? { points: st.points, skipped: st.skipped, lastStartAt: st.lastStartAt, locale: st.locale } : null;
}

/** Resolves once no call for the visit is running (tests). */
export async function liveSummaryIdle(sessionId: string, visitId: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const running = registry().get(keyOf(sessionId, visitId))?.running;
    if (!running) return;
    await running;
  }
}

/** The lines the live call reads: the latest LIVE_WINDOW_LINES, the lines the points on screen rest on, in order. */
function liveWindow(lines: readonly UtteranceRow[], points: readonly SummaryPoint[]): UtteranceRow[] {
  const cited = new Set(points.flatMap((p) => p.lines));
  const keep = new Set(lines.slice(-LIVE_WINDOW_LINES).map((u) => u.id));
  let picked = lines.filter((u) => keep.has(u.id) || cited.has(u.id));
  // the latest are kept when it is too much to read
  while (picked.reduce((n, u) => n + u.text.length, 0) > LIVE_MAX_CHARS && picked.length > 1) picked = picked.slice(1);
  return picked;
}

const samePoints = (a: readonly SummaryPoint[], b: readonly SummaryPoint[]) => a.length === b.length && a.every((p, i) => p.text === b[i].text);

/**
 * New lines of a recording were stored (lib/visit/pipeline.ts processChunk): the live notes are written again now, or at
 * the end of the 15 s since the last call, or by the call that runs now. Never throws, never waits for the model.
 */
export function noteVisitLines(store: Store, session: SessionRow, visitId: string, deps?: SummaryDeps): void {
  if (!isAccount(session)) return;
  const d = depsOr(deps);
  const key = keyOf(session.id, visitId);
  let st = registry().get(key);
  if (!st) {
    st = { sessionId: session.id, visitId, store, session, deps: d, generation: 0, lastStartAt: null, linesAtLastCall: 0, running: null, dirty: false, timer: null, points: [], locale: null, skipped: null };
    registry().set(key, st);
  }
  // the latest request's store and scope row (a scoped store stays usable after its request)
  st.store = store;
  st.session = session;
  st.deps = d;
  schedule(st);
}

function schedule(st: LiveState): void {
  if (st.running) {
    st.dirty = true;
    return;
  }
  const now = (st.deps.now ?? Date.now)();
  const every = st.deps.everyMs ?? LIVE_SUMMARY_EVERY_MS;
  if (st.lastStartAt === null || now - st.lastStartAt >= every) {
    if (st.timer) {
      clearTimeout(st.timer);
      st.timer = null;
    }
    st.running = tick(st).finally(() => {
      st.running = null;
      if (st.dirty && registry().get(keyOf(st.sessionId, st.visitId)) === st) {
        st.dirty = false;
        schedule(st);
      }
    });
    return;
  }
  st.timer ??= setTimeout(() => {
    st.timer = null;
    if (registry().get(keyOf(st.sessionId, st.visitId)) === st) schedule(st);
  }, st.lastStartAt + every - now);
}

async function tick(st: LiveState): Promise<void> {
  const generation = st.generation;
  st.lastStartAt = (st.deps.now ?? Date.now)();
  const { store, session, visitId } = st;
  /** lines read by this tick (-1: none yet): a tick that fails after reading them does not try the same lines again */
  let read = -1;
  try {
    // no live model here (the offline mock): nothing to read either
    const llm = st.deps.llm !== undefined ? st.deps.llm : createMainLlm();
    if (offline(llm)) {
      st.skipped = "no_model";
      return;
    }
    const visit = await store.getVisit(session.id, visitId);
    // the recording has ended (or the visit is gone): no more live notes
    if (!visit || visit.status !== "recording") {
      st.skipped = "not_recording";
      return;
    }
    const lines = liveLines(await store.listUtterances(session.id, visitId));
    read = lines.length;
    if (lines.length === 0 || lines.length === st.linesAtLastCall) {
      st.skipped = "no_new_lines";
      return;
    }
    const gate = await summaryGate(store, session, { ...st.deps, llm });
    if (!gate.ok) {
      st.skipped = gate.why;
      st.linesAtLastCall = lines.length;
      return;
    }
    st.locale ??= st.deps.locale ?? (await localeOf(st.deps.accountStore ?? store, session));
    const out = await writeSummary({ lines: liveWindow(lines, st.points), locale: st.locale, stage: "live", previous: st.points, llm: gate.llm });
    void gate.settle();
    if (st.generation !== generation || registry().get(keyOf(session.id, visitId)) !== st) return;
    st.linesAtLastCall = lines.length;
    st.skipped = out.record.error ? `model_failed:${out.record.error}` : out.points.length ? null : "nothing_said";
    if (!out.points.length || samePoints(out.points, st.points)) return;
    st.points = out.points;
    publish(session.id, "visit.summary", `Ripple's live notes of visit ${visitId}: ${out.points.length} point${out.points.length === 1 ? "" : "s"}`, {
      visit_id: visitId,
      stage: "live",
      lang: st.locale,
      points: out.points,
      at: new Date().toISOString(),
    });
  } catch (err) {
    // (a failure that repeats, a store or a gate that keeps throwing, is tried again only when new lines come)
    if (read >= 0) st.linesAtLastCall = read;
    st.skipped = `error:${errorCode(err)}`;
    console.warn(`[summary] live notes skipped: ${errorCode(err)}`);
  }
}

// ---------------------------------------------------------------- final

/**
 * The visit's final summary from its whole transcript, kept with the visit and announced (visit.summary, stage final).
 * null when a gate says no, nothing of substance was said, or the call failed (the review then shows the lines alone).
 * Never throws.
 */
export async function writeFinalSummary(store: Store, session: SessionRow, visitId: string, deps?: SummaryDeps): Promise<SummaryView | null> {
  const d = depsOr(deps);
  resetLiveSummary(session.id, visitId);
  try {
    const gate = await summaryGate(store, session, d);
    if (!gate.ok) return null;
    const all = liveLines(await store.listUtterances(session.id, visitId));
    if (all.length === 0) return null;
    let lines = all;
    while (lines.reduce((n, u) => n + u.text.length, 0) > FINAL_MAX_CHARS && lines.length > 1) lines = lines.slice(0, -1);
    const locale = d.locale ?? (await localeOf(d.accountStore ?? store, session));
    const out = await writeSummary({ lines, locale, stage: "final", llm: gate.llm });
    void gate.settle();
    if (!out.points.length) {
      if (out.record.error) console.warn(`[summary] no final summary: ${out.record.error}`);
      return null;
    }
    const madeAt = new Date().toISOString();
    await store.addVisitItems(session.id, visitId, [
      {
        id: summaryItemId(visitId),
        type: SUMMARY_ITEM_TYPE,
        text: SUMMARY_ITEM_TEXT,
        utterance_ids: [],
        slots: { variant: "ripple_summary", summary: { stage: "final", lang: locale, points: out.points, made_at: madeAt, model: gate.llm.model, from_lines: lines.length, ...(lines.length < all.length ? { partial: true } : {}) } },
        confirmed_by: null,
        speaker: null,
      },
    ]);
    const view: SummaryView = { stage: "final", lang: locale, points: out.points, madeAt };
    publish(session.id, "visit.summary", `Ripple's summary of visit ${visitId}: ${out.points.length} point${out.points.length === 1 ? "" : "s"}`, {
      visit_id: visitId,
      stage: "final",
      lang: locale,
      points: out.points,
      at: madeAt,
    });
    return view;
  } catch (err) {
    console.warn(`[summary] no final summary: ${errorCode(err)}`);
    return null;
  }
}
