/**
 * What Ripple looked at when he held one of his records (owner's decision of 10-14, modelled on his iOS app's server:
 * ripple-core src/lib/explain.ts gathers in code, then one model call writes the sentence). Server-only.
 *
 * For one subject (lib/explain/subjects.ts) and nothing the screen sent but its name, read from his own records:
 *
 *   name      what the sheet's head says
 *   checked   3 to 6 short factual lines (lib/explain/copy.ts factWords): a number he typed, a date, a count, who said a
 *             line and when. The one comparison is with the doctor's own number, the way lib/summary/bp.ts counts it
 *   sources   the quotes that bear on it, word for word, as the Sentences /api/ask answers with: the doctor's (or the
 *             counter's, the pharmacist's) line with its visit date, time point and clip, the label as printed, the
 *             leaflet's reviewed restatement. They are lib/safety's candidates and nothing else, and each goes through
 *             the safety layer's own checks (verify.ts layers 1 and 2: a whole quote, never cut from the line that takes
 *             it back) before it is shown
 *   verdict   one or two sentences built from those facts, with `abstain` when the records do not say. It is what the
 *             sheet shows when no model writes one (lib/explain/verdict.ts)
 *   fixed     this thing never gets a model's words: a reading above the doctor's warning line (his own sentence and the
 *             995 template, lib/safety/threshold.ts, as the blood pressure page shows them), the warning line itself, a
 *             medicine nobody identified (the fixed sentence), a question Ripple refused to answer
 *
 * The same readers as the screens: lib/visit/doctor-numbers.ts (the doctor's numbers), lib/summary/bp.ts (counts and
 * "not below"), lib/daily/cells.ts and lib/summary/scope-doses.ts (the medicine day and its counts, real-app 4.4),
 * lib/safety/candidates.ts (the sources), lib/profile/questions.ts and lib/daily/questions.ts (his list). An account's
 * scope only (lib/daily/cells.ts is an account's): the route refuses anything else.
 *
 * WHO READS (`viewer`; owner's decision of 10-14: the long press is on the family side too).
 *
 *   self     he himself: everything above, in his own words. Nothing in this file changes what he gets.
 *   family   a family member through her care link, cut by HIS SWITCHES for that link (viewer.grants). The cut is made
 *            where each line and each source is produced: every one of them is tagged with the switch it belongs to
 *            (Fact.needs, Quote.needs), and only the tagged lines whose switch is on leave this file (buildEvidence's
 *            last step). Nothing is matched by its words afterwards.
 *
 *              dose_summary        what he answered for a medicine, when and the reason he gave; the reminder times; the
 *                                  7-day counts; where a medicine came from, its label's state and the label as printed;
 *                                  the times he takes it; the official leaflet's line about it; the medicines a visit
 *                                  prescribed, by name
 *              bp_summary          a reading and when it was recorded; a week's count and average; the doctor's number
 *                                  and warning line AS NUMBERS, and how his readings stand against them; the fixed 995
 *                                  line next to a reading of today above the warning line
 *              visit_transcripts   EVERY word a clinician said (a quoted source of any subject, the doctor's sentence
 *                                  that carries a number, the answer to a question), and only a line he confirmed a
 *                                  clinician said; that somebody spoke about a medicine; how many lines of a visit he
 *                                  confirmed; whether a line has a recording
 *              questions_count     a question's words and who it is for, whether it was answered and when, how many
 *                                  questions wait, the next visit's date
 *              either of the last two   the day and the place of a visit (as on her calendar)
 *              notes               his notes (nothing here reads them, for anyone)
 *
 *            and what she may hold at all is narrower than what he may: a medicine only when it is one of his daily
 *            medicines (the switch is 「每天吃药的情况」: a medicine he bought himself or one nobody identified is not in
 *            it), a visit only when it happened or is planned (as her calendar lists them), a line of a visit only when
 *            he confirmed a clinician said it, a question only while it is on his list (not one he set aside). Anything
 *            else is null, the same answer as a thing that does not exist. The sound of a quoted line is reached
 *            through her link (GET /api/family/clip) and only when that route would play it. The sentence built from
 *            the records is built from the lines that are left, in the family side's words (lib/explain/copy.ts): about
 *            him in the third person, never 「你」.
 *            tests/unit/explain/family-viewer.test.ts holds the cut.
 */
import { createHash } from "node:crypto";
import { familyClipUrl } from "@/lib/care/shared";
import { buildDoseDay, type DoseCell, type SlotDay } from "@/lib/daily/cells";
import { clipTime } from "@/lib/daily/i18n";
import { openQuestionCount } from "@/lib/daily/questions";
import { doseSlotsOf } from "@/lib/daily/slots";
import { mt } from "@/lib/meds/i18n";
import type { StoredLabel } from "@/lib/meds/types";
import { medFullName } from "@/lib/meds/write";
import { questionList, type ListQuestion } from "@/lib/profile/questions";
import { buildCandidates, type CandidateSet } from "@/lib/safety/candidates";
import { TEMPLATES } from "@/lib/safety/templates";
import { relayDoctorThreshold, warningLine, type ThresholdRelay } from "@/lib/safety/threshold";
import { UNIDENTIFIED_DRUG, type Candidate, type Sentence } from "@/lib/safety/types";
import { verifySentences } from "@/lib/safety/verify";
import { zhFromSlots } from "@/lib/safety/zh";
import { scopeD0, scopeTz } from "@/lib/store/scope";
import type { BpReadingRow, FamilyGrantItems, MedicationRow, SessionRow, Store, VisitItemRow, VisitRow } from "@/lib/store/types";
import { dayOfDate, storyDate } from "@/lib/story/clock";
import { notBelowTarget, summarizeBp, type BpSummary } from "@/lib/summary/bp";
import { scopeDoseSummary } from "@/lib/summary/scope-doses";
import { localHHMM } from "@/lib/time/clock";
import { zhLookup, type ZhLookup } from "@/lib/translate/shown";
import { doctorNumbers, type DoctorNumber, type DoctorNumbers } from "@/lib/visit/doctor-numbers";
import { happenedVisits, isReplayCopy } from "@/lib/visit/happened";
import { isSummaryItem } from "@/lib/visit/summary-item";
import { askAboutText, factWords, familyOriginWords, type Clinician, type FactWords } from "./copy";
import { parseDoseRef, type HoldLocale, type HoldRead, type HoldSubject, type HoldType, type WordsViewer } from "./subjects";

export interface Evidence {
  subject: HoldSubject & { name: string };
  checked: string[];
  sources: Sentence[];
  /** the sentence built from his records */
  verdict: string;
  abstain: boolean;
  /** never a model's words for this thing (see the header) */
  fixed: boolean;
  /** the medicines named in the evidence (the guard reads "take <name>" as a dose directive) */
  meds: string[];
  ask: HoldRead["ask"];
  answerId: string;
  /**
   * only for a family member: the switches whose lines and sources this answer holds (her look is logged under them:
   * lib/care/access-log.ts). Never sent to the page
   */
  shared?: (keyof FamilyGrantItems)[];
}

/** Who reads (see the header). `linkId`: her care link, for the sound of a quoted line; without it she gets no sound. */
export type EvidenceViewer = { kind: "self" } | { kind: "family"; grants: FamilyGrantItems; dad: string; linkId?: string };

type Grant = keyof FamilyGrantItems;
/** The switch a line or a source belongs to for a family member; a list: any one of them is enough. */
type Needs = Grant | readonly Grant[];

const DOSE: Grant = "dose_summary";
const BP: Grant = "bp_summary";
const VISIT: Grant = "visit_transcripts";
const ASKS: Grant = "questions_count";
/** the day and the place of a visit ride on either switch, as on her calendar (lib/care/month.ts) */
const VISIT_DAY: readonly Grant[] = [ASKS, VISIT];

/** One line under 「Ripple 查看了什么」, with the switch it belongs to. */
interface Fact {
  text: string;
  needs: Needs;
}

/** One quoted source, with the switch it belongs to. */
interface Quote {
  sentence: Sentence;
  needs: Needs;
}

const fact = (needs: Needs, text: string): Fact => ({ needs, text });

interface Ctx {
  store: Store;
  scope: SessionRow;
  locale: HoldLocale;
  nowMs: number;
  aiAllowed: boolean;
  w: FactWords;
  d0: string;
  /** the scope's day now, and its date */
  day: number;
  today: string;
  /** lib/safety's candidates as of now (read once per topic set) */
  cands: (topics?: string[]) => Promise<CandidateSet>;
  zh: () => Promise<ZhLookup>;
  /** a family member reads, through her link */
  fam: boolean;
  /** her care link, when she reads and the caller gave it */
  linkId: string | null;
  /** may this reader be shown what belongs to this switch (one of these switches)? He himself: always */
  may: (needs: Needs) => boolean;
}

interface Built {
  name: string;
  checked: Fact[];
  /** at most this many lines are shown (counted after the cut) */
  limit?: number;
  sources: Quote[];
  verdict: string;
  abstain: boolean;
  fixed: boolean;
  meds?: string[];
  askFor?: "doctor" | "pharmacist";
  noAsk?: boolean;
}

const CLINICIANS = ["doctor", "dispenser", "pharmacist"] as const;
const clinician = (x: unknown): Clinician | null => ((CLINICIANS as readonly unknown[]).includes(x) ? (x as Clinician) : null);

const cut = (s: string, max: number) => {
  const chars = [...s.trim()];
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : chars.join("");
};

/** Two sentences as one text (华语 runs on; English takes a space). */
const two = (ctx: Ctx, a: string, b: string) => (b ? `${a}${ctx.locale === "zh-Hans" ? "" : " "}${b}` : a);

/** YYYY-MM-DD plus days (calendar arithmetic in UTC: a date has no zone). */
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The Monday of the week a date is in. */
function mondayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(iso, -((wd + 6) % 7));
}

// ---------------------------------------------------------------- sources

/** One candidate as the Sentence the screens draw: its own words, its own citation. Never a log line or a template. */
function quoteOf(c: Candidate): Sentence | null {
  const base = { speechAct: "restate" as const, sourceId: c.sourceId, span: c.span, slots: {}, cite: c.cite };
  if (c.kind === "visit") return { ...base, en: c.span, attribution: c.attribution, origin: "span" };
  if (c.kind === "label") {
    const zh = zhFromSlots(c.span, "label");
    return { ...base, en: c.span, ...(zh ? { zh } : {}), attribution: "label", origin: "span" };
  }
  if (c.kind === "patient_text" && c.restatement) return { ...base, en: c.restatement.en, zh: c.restatement.zh, attribution: "leaflet", origin: "patient_text" };
  return null;
}

/** The switch a candidate's words belong to: what was said at a visit is his visit record's; a label and a leaflet line go with his medicine. */
const needsOf = (c: Candidate): Needs => (c.kind === "visit" ? VISIT : DOSE);

/** A visit line she may read: a clinician's, and he confirmed who said it (what lib/care/shared.ts lists for her). */
const confirmedClinician = (c: Pick<Candidate, "attribution" | "cite">) => !!clinician(c.attribution) && c.cite?.roleState === "confirmed";

/**
 * Her link to a line's sound, or null: only a line with a clip of its own that he confirmed a clinician said, the rule
 * of the route that plays it (GET /api/family/clip). His own clip link (/api/visits/<id>/clip) is his account's.
 */
async function herClipUrl(ctx: Ctx, visitId: string | undefined, utteranceId: string | undefined): Promise<string | null> {
  if (!ctx.linkId || !visitId || !utteranceId) return null;
  const row = (await ctx.store.listUtterances(ctx.scope.id, visitId)).find((u) => u.id === utteranceId);
  if (!row || !row.clip_path || row.role_state !== "confirmed" || !clinician(row.role)) return null;
  return familyClipUrl(ctx.linkId, visitId, utteranceId);
}

/** A quoted visit line as she gets it: the same words and citation, the sound through her link or not at all. */
async function herQuote(ctx: Ctx, s: Sentence): Promise<Sentence> {
  if (!s.sourceId.startsWith("visit:") || !s.cite) return s;
  // his clip address, its path and its label stay on his side; whether the sound is a stand-in voice is said again below
  const cite = { ...s.cite };
  const standInVoice = cite.standInVoice;
  delete cite.clipUrl;
  delete cite.clipPath;
  delete cite.clipLabel;
  delete cite.standInVoice;
  const url = await herClipUrl(ctx, cite.visitId, cite.utteranceId);
  return { ...s, cite: url ? { ...cite, clipUrl: url, ...(standInVoice ? { standInVoice } : {}) } : cite };
}

/**
 * The chosen candidates as checked quotes, in the order given: each passes the safety layer's rules for a quote (a
 * whole line, its numbers its own, never the half of a correction) or is left out. A clinician's English line gets its
 * checked Chinese under it on the Chinese sheet, when one is kept (lib/translate/shown.ts: his consent, both checks).
 * For a family member a candidate whose switch is off is not picked at all, and of a visit only a line he confirmed.
 */
async function quotes(ctx: Ctx, set: CandidateSet, picked: (Candidate | null | undefined)[]): Promise<Quote[]> {
  const seen = new Set<string>();
  const wanted: Sentence[] = [];
  const needs = new Map<string, Needs>();
  for (const c of picked) {
    if (!c || seen.has(c.sourceId)) continue;
    seen.add(c.sourceId);
    if (ctx.fam && (!ctx.may(needsOf(c)) || (c.kind === "visit" && !confirmedClinician(c)))) continue;
    const s = quoteOf(c);
    if (!s) continue;
    wanted.push(s);
    needs.set(s.sourceId, needsOf(c));
  }
  if (!wanted.length) return [];
  const { verdicts } = await verifySentences(wanted, { candidates: set.byId, checker: null, checkerReason: "explain: quotes and reviewed restatements need no checker" });
  let kept = verdicts.filter((v) => v.pass).map((v) => v.sentence);
  if (ctx.locale === "zh-Hans" && kept.some((s) => s.sourceId.startsWith("visit:"))) {
    const zh = await ctx.zh();
    kept = kept.map((s) => {
      const text = s.sourceId.startsWith("visit:") ? zh(s.en) : null;
      return text ? { ...s, translation: { lang: "zh-Hans" as const, text } } : s;
    });
  }
  if (ctx.fam) kept = await Promise.all(kept.map((s) => herQuote(ctx, s)));
  // a sentence whose switch is not known is a visit's (the narrowest): it cannot happen, and it must not slip through
  return kept.map((sentence) => ({ sentence, needs: needs.get(sentence.sourceId) ?? VISIT }));
}

/**
 * A doctor's number as a quote (the cite lib/safety/threshold.ts builds for it: date, time point, clip, who). The
 * number itself is a line of the blood pressure switch (weekLines); the doctor's SENTENCE is his visit record's, and
 * for her only one he confirmed.
 */
async function numberQuote(ctx: Ctx, n: DoctorNumber | null): Promise<Quote[]> {
  if (!n) return [];
  if (ctx.fam && (!ctx.may(VISIT) || n.state !== "confirmed" || n.disputed || !clinician(n.speaker))) return [];
  const { candidate, sentence } = warningLine(ctx.scope, n, ctx.locale);
  const { verdicts } = await verifySentences([sentence], { candidates: new Map([[candidate.sourceId, candidate]]), checker: null, checkerReason: "explain: a quote needs no checker" });
  if (!verdicts[0]?.pass) return [];
  const zh = ctx.locale === "zh-Hans" ? (await ctx.zh())(n.text) : null;
  const quoted: Sentence = zh ? { ...verdicts[0].sentence, translation: { lang: "zh-Hans", text: zh } } : verdicts[0].sentence;
  return [{ sentence: ctx.fam ? await herQuote(ctx, quoted) : quoted, needs: VISIT }];
}

/**
 * The doctor's own warning sentence next to a reading above it (lib/safety/threshold.ts relay.doctorLine). His: as the
 * relay gives it. Hers: only with his visit records shared and only a line he confirmed; the sound through her link;
 * the checked Chinese read here (the relay reads his consent through the caller's store, which hers cannot).
 */
async function relayQuote(ctx: Ctx, relay: ThresholdRelay): Promise<Quote[]> {
  if (!ctx.fam) return [{ sentence: relay.doctorLine, needs: VISIT }];
  if (!ctx.may(VISIT) || relay.threshold.state !== "confirmed" || relay.threshold.disputed || !clinician(relay.doctorLine.attribution)) return [];
  let line = relay.doctorLine;
  if (ctx.locale === "zh-Hans" && !line.translation) {
    const zh = (await ctx.zh())(line.en);
    if (zh) line = { ...line, translation: { lang: "zh-Hans", text: zh } };
  }
  return [{ sentence: await herQuote(ctx, line), needs: VISIT }];
}

const aboutDrug = (c: Candidate, drugId: string) => (c.drugs ?? []).includes(drugId) || (c.about ?? []).includes(drugId);
/** a spoken line by someone named (the doctor's first) */
const spoken = (c: Candidate) => c.kind === "visit" && !!c.attribution;
const doctorFirst = (a: Candidate, b: Candidate) => Number(b.attribution === "doctor") - Number(a.attribution === "doctor");
/** the spoken lines this reader may be told of at all: his, every one; hers, the ones he confirmed, with his visit records shared */
const told = (ctx: Ctx, c: Candidate) => spoken(c) && (!ctx.fam || (ctx.may(VISIT) && confirmedClinician(c)));

// ---------------------------------------------------------------- blood pressure

interface BpRead {
  rows: BpReadingRow[];
  numbers: DoctorNumbers;
}

async function readBp(ctx: Ctx): Promise<BpRead> {
  const [rows, numbers] = await Promise.all([
    ctx.store.listBp(ctx.scope.id, { toDay: ctx.day }),
    doctorNumbers(ctx.store, ctx.scope.id, { day: ctx.day, time: ctx.scope.story_time ?? null }),
  ]);
  return { rows, numbers };
}

interface Week {
  monday: string;
  sunday: string;
  current: boolean;
  sum: BpSummary;
}

/** The week a date is in, counted the way the brief counts (lib/summary/bp.ts): up to today, against the doctor's number. */
function weekOf(ctx: Ctx, date: string, bp: BpRead): Week {
  const monday = mondayOf(date);
  const sunday = addDays(monday, 6);
  const t = bp.numbers.target;
  const target = t && t.diastolic !== null ? { systolic: t.systolic, diastolic: t.diastolic } : null;
  const sum = summarizeBp(bp.rows, dayOfDate(ctx.d0, monday), Math.min(dayOfDate(ctx.d0, sunday), ctx.day), target);
  return { monday, sunday, current: monday === mondayOf(ctx.today), sum };
}

/**
 * The week's lines: how many and their average, what was not measured, the doctor's number, how many were not below it.
 * All of the blood pressure switch: his readings, and the doctor's number as a number.
 */
function weekLines(ctx: Ctx, week: Week, bp: BpRead): Fact[] {
  const { w } = ctx;
  const { sum } = week;
  const out: string[] = [];
  out.push(sum.count > 0 ? w.weekReadings(week.current, week.monday, week.sunday, sum.count, sum.avgSystolic ?? 0, sum.avgDiastolic ?? 0) : w.weekNone(week.current, week.monday, week.sunday));
  if (sum.unconfirmed > 0) out.push(w.weekSkipped(sum.unconfirmed));
  const t = bp.numbers.target;
  out.push(t && t.diastolic !== null ? w.doctorTarget(t.systolic, t.diastolic, t.visitDate) : w.noTarget);
  if (sum.notBelow !== null && sum.count > 0) out.push(w.notBelow(sum.notBelow));
  return out.map((text) => fact(BP, text));
}

async function bpReading(ctx: Ctx, ref: string): Promise<Built | null> {
  const { w } = ctx;
  const bp = await readBp(ctx);
  const r = bp.rows.find((x) => x.id === ref);
  if (!r) return null;
  const date = storyDate(ctx.d0, r.day);
  const week = weekOf(ctx, date, bp);
  const t = bp.numbers.target;
  const target = t && t.diastolic !== null ? { systolic: t.systolic, diastolic: t.diastolic } : null;
  if (r.state !== "recorded" || r.systolic === null || r.diastolic === null) {
    return {
      name: w.bpNoneName(date, r.slot),
      checked: [fact(BP, w.bpNotMeasured(date, r.slot)), ...weekLines(ctx, week, bp)],
      sources: await numberQuote(ctx, t),
      verdict: w.vBpNotMeasured(date, r.slot),
      abstain: false,
      fixed: true,
    };
  }
  const reading = { systolic: r.systolic, diastolic: r.diastolic };
  const time = r.day === ctx.day ? localHHMM(Date.parse(r.created_at), scopeTz(ctx.scope)) : null;
  const checked = [fact(BP, w.bpReading(reading.systolic, reading.diastolic, date, r.slot, time))];
  // above the doctor's warning line: his own sentence first, and for a reading of today the 995 template after it, in
  // the order the blood pressure page shows them (lib/safety/threshold.ts relay.lines). No model writes about such a reading.
  const relay = await relayDoctorThreshold(ctx.store, ctx.scope, reading, { locale: ctx.locale });
  if (relay) {
    checked.push(fact(BP, w.doctorWarning(relay.threshold.systolic, relay.threshold.visitDate)), ...weekLines(ctx, week, bp));
    const doctor = await relayQuote(ctx, relay);
    // the fixed 995 line is Ripple's own, said because of the reading and the doctor's number: the blood pressure switch
    const template: Quote[] = r.day === ctx.day ? [{ sentence: relay.template, needs: BP }] : [];
    return {
      name: w.bpName(reading.systolic, reading.diastolic, date),
      checked,
      limit: 6,
      sources: [...doctor, ...template, ...(await numberQuote(ctx, t))],
      // hers says 「原话见下方」 only when the doctor's sentence is there (it is his visit record's)
      verdict: ctx.fam ? two(ctx, w.vBpAboveWarning(reading.systolic, relay.threshold.systolic), doctor.length ? w.quotedBelow : "") : w.vBpAboveWarning(reading.systolic, relay.threshold.systolic),
      abstain: false,
      fixed: true,
    };
  }
  checked.push(...weekLines(ctx, week, bp));
  return {
    name: w.bpName(reading.systolic, reading.diastolic, date),
    checked,
    limit: 6,
    sources: await numberQuote(ctx, t),
    verdict: target
      ? notBelowTarget(reading, target)
        ? w.vBpNotBelow(reading.systolic, reading.diastolic, target.systolic, target.diastolic)
        : w.vBpBelow(reading.systolic, reading.diastolic, target.systolic, target.diastolic)
      : w.vBpNoTarget(reading.systolic, reading.diastolic),
    abstain: !target,
    fixed: false,
  };
}

async function bpWeek(ctx: Ctx, ref: string): Promise<Built | null> {
  const { w } = ctx;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(ref) ? ref : ctx.today;
  if (date > ctx.today) return null;
  const bp = await readBp(ctx);
  const week = weekOf(ctx, date, bp);
  const { sum } = week;
  const t = sum.target;
  return {
    name: w.bpName_week(week.monday, week.sunday),
    checked: weekLines(ctx, week, bp),
    sources: await numberQuote(ctx, bp.numbers.target),
    verdict:
      sum.count === 0
        ? w.vWeekNone(week.current)
        : t && sum.notBelow !== null
          ? w.vWeekTarget(week.current, sum.count, sum.avgSystolic ?? 0, sum.avgDiastolic ?? 0, sum.notBelow, t.systolic, t.diastolic)
          : w.vWeekNoTarget(week.current, sum.count, sum.avgSystolic ?? 0, sum.avgDiastolic ?? 0),
    abstain: false,
    fixed: sum.count === 0,
  };
}

// ---------------------------------------------------------------- medicines and their doses

interface Counts {
  due: number;
  taken: number;
  missed: number;
  unconfirmed: number;
}

/** One medicine's cells over the last 7 days, by the one counting rule (lib/summary/scope-doses.ts; real-app 4.4). */
function medCounts(ctx: Ctx, meds: MedicationRow[], doses: Parameters<typeof buildDoseDay>[3], medId: string): Counts {
  const c: Counts = { due: 0, taken: 0, missed: 0, unconfirmed: 0 };
  for (let day = Math.max(0, ctx.day - 6); day <= ctx.day; day++) {
    for (const slotDay of buildDoseDay(ctx.scope, day, meds, doses, ctx.nowMs)) {
      for (const cell of slotDay.cells) {
        if (cell.medicationId !== medId) continue;
        if (cell.state === null && (slotDay.phase !== "closed" || !cell.tracked)) continue;
        if (!cell.counted) continue;
        c.due += 1;
        if (cell.state === "taken") c.taken += 1;
        else if (cell.state === "missed") c.missed += 1;
        else c.unconfirmed += 1;
      }
    }
  }
  return c;
}

async function medicine(ctx: Ctx, ref: string): Promise<Built | null> {
  const { w, store, scope } = ctx;
  const med = await store.getMed(scope.id, ref);
  if (!med) return null;
  // hers: only one of his daily medicines (a prescription he has started), the medicines her screens name. One he
  // bought himself, a relative's box or one that has not started is not part of 「每天吃药的情况」
  if (ctx.fam && (med.origin !== "prescription" || med.start_day === null || med.start_day > ctx.day)) return null;
  const name = medFullName(med, ctx.locale);
  const set = await ctx.cands();
  const askFor = med.origin === "prescription" ? "doctor" : "pharmacist";
  /** where it came from, in the medicine list's own words (「医生开的」, 「亲戚带的」) */
  const origin = ctx.fam ? familyOriginWords(ctx.locale, med.origin) : `${mt(ctx.locale, `origin.${med.origin}`)}${ctx.locale === "zh-Hans" ? "。" : "."}`;
  // that a clinician spoke about it, and when, is his visit record's. Hers with that switch off: not said either way
  // (「没有人说过」 would be a statement about a record she is not shown)
  const spokeLine = (c: Candidate | undefined) => {
    const by = clinician(c?.attribution);
    return fact(VISIT, c && by && c.cite?.date ? w.spokeAbout(by, c.cite.date) : w.nobodySpoke);
  };
  if (!med.drug_id || med.status === "unidentified") {
    // nobody identified it: the fixed sentence, and the pharmacist's recorded answer about it when there is one
    const answer = set.list.filter((c) => told(ctx, c) && (c.about ?? []).includes(UNIDENTIFIED_DRUG)).slice(-1);
    return {
      name,
      checked: [fact(DOSE, origin), fact(DOSE, w.medUnknown), spokeLine(answer[0])],
      sources: await quotes(ctx, set, answer),
      verdict: ctx.locale === "zh-Hans" ? TEMPLATES.unknown_med.zh : TEMPLATES.unknown_med.en,
      abstain: true,
      fixed: true,
      askFor: "pharmacist",
    };
  }
  const drugId = med.drug_id;
  const [meds, doses] = await Promise.all([store.listMeds(scope.id), store.listDoses(scope.id, { fromDay: Math.max(0, ctx.day - 6), toDay: ctx.day })]);
  const slots = doseSlotsOf(scope, med);
  const lines = set.list.filter((c) => told(ctx, c) && aboutDrug(c, drugId)).sort(doctorFirst);
  const labelOk = med.status === "label_confirmed" || med.status === "pharmacist_checked";
  const typed = (med.label as StoredLabel | null)?.typed === true;
  const counts = med.origin === "prescription" ? medCounts(ctx, meds, doses, med.id) : null;
  const checked = [
    fact(DOSE, origin),
    fact(DOSE, med.status === "awaiting_label" || !med.label ? w.labelNone : typed ? w.labelTyped : !labelOk ? w.labelUnchecked : med.label.dispensed ? w.labelDispensed(med.label.dispensed) : w.labelChecked),
    fact(DOSE, slots.slots.length ? w.medSlots(slots.slots, slots.source === "label") : w.medNoSlots),
    spokeLine(lines[0]),
    ...(counts ? [fact(DOSE, w.doses7(counts, false))] : []),
  ];
  const purpose = set.list.find((c) => c.kind === "patient_text" && (c.drugs ?? []).includes(drugId) && (c.topics ?? []).includes("purpose"));
  const sources = await quotes(ctx, set, [...lines.slice(0, 2), set.byId.get(`label:${med.id}`), purpose]);
  const said: string[] = [];
  if (slots.slots.length) said.push(w.vMedSlots(name, slots.slots, slots.source === "label"));
  if (counts && counts.due > 0) said.push(w.vMedDoses(counts));
  return {
    name,
    checked,
    sources,
    verdict: said.length ? said.join(ctx.locale === "zh-Hans" ? "" : " ") : w.vMedThin(name),
    abstain: said.length === 0,
    fixed: false,
    meds: [name],
    askFor,
  };
}

const answered = (c: DoseCell) => c.state === "taken" || c.state === "missed";
const noReply = (c: DoseCell, s: SlotDay) => (c.state === "unconfirmed" && c.reason === "no_reply") || (c.state === null && s.phase === "closed" && c.tracked);
const later = (c: DoseCell) => c.state === "unconfirmed" && c.reason === "later";

async function dose(ctx: Ctx, ref: string): Promise<Built | null> {
  const { w, store, scope } = ctx;
  const at = parseDoseRef(ref);
  if (!at) return null;
  const day = dayOfDate(ctx.d0, at.date);
  if (day < 0 || day > ctx.day) return null;
  const [meds, doses, set] = await Promise.all([store.listMeds(scope.id), store.listDoses(scope.id, { fromDay: day, toDay: day }), ctx.cands()]);
  const slot = buildDoseDay(scope, day, meds, doses, ctx.nowMs).find((s) => s.slot === at.slot);
  if (!slot) return null;
  const tz = scopeTz(scope);
  const timeOf = (c: DoseCell) => (c.answeredAt ? localHHMM(Date.parse(c.answeredAt), tz) : null);
  const full = (c: DoseCell) => `${c.name}${c.strength ? ` ${c.strength}` : ""}`;
  const cellLine = (c: DoseCell) =>
    c.state === "taken"
      ? w.cellTaken(full(c), timeOf(c))
      : c.state === "missed"
        ? w.cellMissed(full(c), c.reasonText)
        : later(c)
          ? w.cellLater(full(c))
          : noReply(c, slot)
            ? w.cellNoReply(full(c), slot.schedule.closes)
            : w.cellOpen(full(c));
  const week = await scopeDoseSummary(store, scope, { fromDay: Math.max(0, ctx.day - 6), toDay: ctx.day, nowMs: ctx.nowMs });
  const checked = [...slot.cells.slice(0, 3).map(cellLine), w.reminders(slot.schedule.first, slot.schedule.second, slot.schedule.closes), w.doses7(week, true)].map((text) => fact(DOSE, text));
  const cells = slot.cells;
  const taken = cells.filter((c) => c.state === "taken");
  const missed = cells.filter((c) => c.state === "missed");
  const open = cells.length - taken.length - missed.length;
  const verdict =
    taken.length === cells.length
      ? w.vDoseTaken(at.date, at.slot, cells.length === 1 ? timeOf(cells[0]) : null)
      : missed.length === cells.length
        ? w.vDoseMissed(at.date, at.slot, cells.length === 1 ? cells[0].reasonText : null)
        : !cells.some(answered)
          ? cells.every((c) => noReply(c, slot))
            ? w.vDoseNoReply(at.date, at.slot, slot.schedule.closes)
            : w.vDoseOpen(at.date, at.slot)
          : w.vDoseMixed(at.date, at.slot, cells.length, taken.length, missed.length, open);
  // the labels of what is in this part of the day, and what the doctor said about those medicines
  const inSlot = cells.slice(0, 2).map((c) => meds.find((m) => m.id === c.medicationId));
  const drugIds = inSlot.map((m) => m?.drug_id).filter((id): id is string => !!id);
  const doctor = set.list.filter((c) => told(ctx, c) && c.attribution === "doctor" && drugIds.some((id) => aboutDrug(c, id))).slice(0, 1);
  return {
    name: w.doseName(at.date, at.slot),
    checked,
    sources: await quotes(ctx, set, [...inSlot.map((m) => (m ? set.byId.get(`label:${m.id}`) : null)), ...doctor]),
    verdict,
    abstain: false,
    fixed: false,
    meds: cells.map(full),
  };
}

// ---------------------------------------------------------------- visits

/** The follow-up's date is still worked out from the doctor's words (lib/daily/account-today.ts nextVisitForToday). */
const approxDate = (v: Pick<VisitRow, "script_section">) => (v.script_section ?? "").startsWith("planned:") && !(v.script_section ?? "").endsWith(":booked");

async function lastVisitDate(ctx: Ctx, visits: VisitRow[], before: string): Promise<string | null> {
  const happened = (await happenedVisits(ctx.store, ctx.scope.id, visits)).filter((v) => v.date <= ctx.today && v.date < before);
  return happened.sort((a, b) => b.date.localeCompare(a.date))[0]?.date ?? null;
}

/**
 * A planned visit: when, where, what waits for it, and the doctor's own words about coming back. Hers: its day and
 * place ride on either of the two switches a visit shows under; how many questions wait is the questions switch's (a
 * planned visit held with only his visit records shared says nothing of his questions).
 */
async function plannedVisit(ctx: Ctx, v: VisitRow, visits: VisitRow[], as: "visit" | "next"): Promise<Built> {
  const { w } = ctx;
  const [waiting, last, set] = await Promise.all([openQuestionCount(ctx.store, ctx.scope), lastVisitDate(ctx, visits, v.date), ctx.cands()]);
  const days = dayOfDate(ctx.d0, v.date) - ctx.day;
  const approx = approxDate(v);
  const comeBack = set.list.filter((c) => told(ctx, c) && (c.topics ?? []).includes("appointment")).slice(-1);
  return {
    name: as === "next" ? w.nextName(v.date, approx) : ctx.fam && v.kind === "pharmacy" ? w.pharmacyName(v.date, true) : w.visitName(v.date, true),
    checked: [fact(VISIT_DAY, w.plannedWhen(v.date, days, approx)), ...(v.place ? [fact(VISIT_DAY, w.visitPlace(v.place))] : []), fact(ASKS, w.questionsWaiting(waiting)), fact(VISIT_DAY, w.lastVisit(last))],
    sources: await quotes(ctx, set, comeBack),
    verdict: as === "next" ? w.vNext(v.date, days, approx, waiting) : ctx.may(ASKS) ? w.vVisitPlanned(v.date, days, approx, waiting) : w.vVisitPlannedBare(v.date, days, approx),
    abstain: false,
    fixed: false,
    askFor: v.kind === "pharmacy" ? "pharmacist" : "doctor",
  };
}

// (Ripple's own summary of a visit is never a line of the record: lib/visit/summary-item.ts)
const liveItem = (i: VisitItemRow) => i.type !== "consent" && !isSummaryItem(i) && i.slots?.superseded !== true && i.slots?.rejected !== true;

async function visit(ctx: Ctx, ref: string): Promise<Built | null> {
  const { w, store, scope } = ctx;
  const visits = await store.listVisits(scope.id);
  const v = visits.find((x) => x.id === ref);
  if (!v) return null;
  // hers: a visit her screens list (lib/care/month.ts, lib/care/shared.ts): one planned for today or later, or one that
  // happened. Never a copy watched again, a plan that passed, or a recording that left no record
  if (ctx.fam) {
    if (isReplayCopy(v)) return null;
    if (v.status === "planned" ? v.date < ctx.today : !(await happenedVisits(store, scope.id, visits)).some((x) => x.id === v.id)) return null;
  }
  if (v.status === "planned") return plannedVisit(ctx, v, visits, "visit");
  const [meds, questions, set] = await Promise.all([store.listMeds(scope.id), store.listQuestions(scope.id, { status: "answered" }), ctx.cands()]);
  // the lines of this visit that count as sources: what the doctor, the counter or the pharmacist said and he (or the
  // example's record) confirmed. The ones that say something about a medicine, a number or coming back come first
  const said = set.list.filter((c) => told(ctx, c) && c.cite?.visitId === v.id);
  const kept = said.length;
  const weighty = (c: Candidate) => !!c.instruction || (c.topics?.length ?? 0) > 0;
  const shown = [...said.filter(weighty), ...said.filter((c) => !weighty(c) && c.span.length >= 30)].slice(0, 3);
  const prescribed = meds.filter((m) => m.prescribed_visit_id === v.id).map((m) => medFullName(m, ctx.locale));
  const answers = questions.filter((q) => q.answer_visit_id === v.id && !!q.answer_text).length;
  const checked = [fact(VISIT_DAY, w.visitWhere(v.date, v.place ?? ""))];
  if (v.status === "awaiting_transcript" || v.status === "transcribing" || v.status === "recording") checked.push(fact(VISIT, w.visitWaiting));
  else checked.push(fact(VISIT, w.visitLines(kept)));
  if (v.status === "review") checked.push(fact(VISIT, w.visitReview));
  // which medicines it prescribed is his medicine's; how many of his questions it answered is his questions'
  if (prescribed.length) checked.push(fact(DOSE, w.visitMeds(prescribed)));
  if (answers) checked.push(fact(ASKS, w.visitAnswered(answers)));
  if (v.audio_deleted_at) checked.push(fact(VISIT, w.recordingDeleted));
  else if (v.audio_path || v.audio_parts?.length) checked.push(fact(VISIT, w.recordingKept));
  return {
    // hers: a visit to the pharmacy counter is named as one (药房取药); his head says 看诊 for every visit, as before
    name: ctx.fam && v.kind === "pharmacy" ? w.pharmacyName(v.date, false) : w.visitName(v.date, false),
    checked,
    limit: 6,
    sources: await quotes(ctx, set, shown),
    verdict: kept > 0 ? w.vVisit(v.date, kept) : w.vVisitEmpty(v.date),
    abstain: kept === 0,
    fixed: false,
    meds: ctx.may(DOSE) ? prescribed : [],
    askFor: v.kind === "pharmacy" ? "pharmacist" : "doctor",
  };
}

async function visitLine(ctx: Ctx, ref: string): Promise<Built | null> {
  const { w, store, scope } = ctx;
  const item = (await store.listVisitItems(scope.id)).find((i) => `${i.visit_id}:${i.id}` === ref);
  if (!item || !liveItem(item)) return null;
  const v = await store.getVisit(scope.id, item.visit_id);
  if (!v) return null;
  // the doctor's warning line is a source only when asked for by name (lib/safety/candidates.ts)
  const set = await ctx.cands(item.type === "threshold" ? ["threshold"] : []);
  const cand = set.byId.get(`visit:${v.id}:${item.required_line ?? item.id}`) ?? set.list.find((c) => c.kind === "visit" && c.cite?.visitId === v.id && c.span.trim() === item.text.trim());
  const by = clinician(cand?.cite?.role) ?? clinician(item.speaker);
  const disputed = item.slots?.disputed === true;
  // confirmed: he said 「是」 to it, or the record holds it as confirmed (the example's visits), as the screens label it
  const his = (item.confirmed_by === "patient" || cand?.cite?.roleState === "confirmed") && !disputed;
  // hers: only a line he confirmed a clinician said, the lines her visit record lists (lib/care/shared.ts). A line
  // Ripple only inferred, one he has not looked at and one he marked 「不是」 are not hers to read
  if (ctx.fam && !(his && cand && confirmedClinician(cand))) return null;
  const s = Number(item.slots?.systolic);
  const d = Number(item.slots?.diastolic);
  // the sound: his own clip link, or hers through her link (only when that route would play it)
  const hasClip = ctx.fam ? !!(await herClipUrl(ctx, cand?.cite?.visitId, cand?.cite?.utteranceId)) : !!cand?.cite?.clipUrl;
  const checked = [
    fact(VISIT, w.lineWhen(v.date, clipTime(cand?.cite?.tStartMs))),
    fact(VISIT, disputed ? w.lineDisputed : his ? w.lineConfirmed : w.lineUnconfirmed),
    fact(VISIT, hasClip ? w.lineClip : w.lineNoClip),
  ];
  if (item.type === "target" && Number.isFinite(s) && Number.isFinite(d)) {
    checked.push(fact(VISIT, w.lineIsTarget(s, d)));
    // his readings this week next to the number, when it is the one the screens compare with (his readings: the blood
    // pressure switch)
    const bp = await readBp(ctx);
    const t = bp.numbers.target;
    if (t && t.itemId === item.id) checked.push(...weekLines(ctx, weekOf(ctx, ctx.today, bp), bp).filter((l) => l.text !== w.doctorTarget(t.systolic, t.diastolic ?? d, t.visitDate)));
  }
  if (item.type === "threshold" && Number.isFinite(s)) checked.push(fact(VISIT, w.lineIsWarning(s)));
  return {
    name: w.lineName(his ? by : null, v.date),
    checked,
    limit: 6,
    sources: await quotes(ctx, set, [cand]),
    verdict: his && cand ? w.vLineConfirmed(by, v.date) : w.vLineUnconfirmed(v.date),
    abstain: false,
    // the warning line says when to call 995: his doctor's own sentence stands alone
    fixed: item.type === "threshold" || !cand,
    askFor: v.kind === "pharmacy" || by === "pharmacist" ? "pharmacist" : "doctor",
  };
}

async function nextVisit(ctx: Ctx): Promise<Built> {
  const { w } = ctx;
  const visits = await ctx.store.listVisits(ctx.scope.id);
  const v = visits.filter((x) => x.status === "planned" && x.date >= ctx.today).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (v) return plannedVisit(ctx, v, visits, "next");
  const [waiting, last] = await Promise.all([openQuestionCount(ctx.store, ctx.scope), lastVisitDate(ctx, visits, "9999-12-31")]);
  return {
    name: w.nextName(null, false),
    checked: [fact(ASKS, w.nextVisit(null, false)), fact(ASKS, w.questionsWaiting(waiting)), fact(VISIT_DAY, w.lastVisit(last))],
    sources: [],
    verdict: w.vNextNone,
    abstain: true,
    fixed: true,
  };
}

// ---------------------------------------------------------------- his question list

async function question(ctx: Ctx, ref: string): Promise<Built | null> {
  const { w, store, scope } = ctx;
  const list = await questionList(store, scope, ctx.locale);
  // hers: a question on his list, waiting or answered. One he set aside is not shown on her screens
  const q: ListQuestion | undefined = [...list.open, ...list.answered, ...(ctx.fam ? [] : list.skipped)].find((x) => x.id === ref);
  if (!q) return null;
  const visits = await store.listVisits(scope.id);
  const next = visits.filter((x) => x.status === "planned" && x.date >= ctx.today).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  const a = q.status === "answered" ? q.answer : null;
  const by = clinician(a?.speaker);
  const checked = [fact(ASKS, w.questionAdded(q.createdDate, q.for))];
  // that Ripple refused to answer it is about what he asked Ripple, which no switch shares: his sheet only
  if (q.origin === "refused_question" && !ctx.fam) checked.push(fact(ASKS, w.questionRefused));
  if (q.wording === "pattern") checked.push(fact(ASKS, w.questionPattern));
  checked.push(fact(ASKS, a ? w.questionAnswered(by, a.date) : q.status === "skipped" ? w.questionSkipped : w.questionOpen));
  let sources: Quote[] = [];
  let said: Candidate | undefined;
  if (a) {
    const set = await ctx.cands();
    said = set.list.find((c) => c.kind === "visit" && c.cite?.visitId === a.visitId && c.span.trim() === a.text.trim()) ?? set.list.find((c) => c.kind === "visit" && c.span.trim() === a.text.trim());
    sources = await quotes(ctx, set, [said]);
  }
  // the answer's words and their sound are his visit record's; the next visit's date is the questions switch's
  if (a) {
    const hasClip = ctx.fam ? !!(await herClipUrl(ctx, said?.cite?.visitId, said?.cite?.utteranceId)) : !!a.clipUrl;
    checked.push(fact(VISIT, hasClip ? w.lineClip : w.lineNoClip));
  } else checked.push(fact(ASKS, w.nextVisit(next?.date ?? null, next ? approxDate(next) : false)));
  return {
    name: cut(q.text, 48),
    checked,
    sources,
    verdict: a
      ? ctx.fam
        ? two(ctx, w.vQuestionAnswered(by, a.date), sources.length ? w.quotedBelow : "")
        : w.vQuestionAnswered(by, a.date)
      : q.status === "skipped"
        ? w.vQuestionSkipped
        : w.vQuestionOpen(q.for, next?.date ?? null),
    abstain: false,
    // a question Ripple could not answer stays unanswered here too; so does one with nothing but itself to go on
    fixed: q.origin === "refused_question" || !a,
    noAsk: true,
  };
}

// ---------------------------------------------------------------- one subject

export interface EvidenceInput {
  store: Store;
  scope: SessionRow;
  subject: HoldSubject;
  locale: HoldLocale;
  nowMs: number;
  /** his consent to AI processing (the checked translations under English words need it) */
  aiAllowed: boolean;
  /** who reads (default: he himself). A family member gets only what his switches for her link share (see the header) */
  viewer?: EvidenceViewer;
}

/** The evidence for one subject, or null when his records hold no such thing (or it is not this reader's to hold). */
/** What a family member's sheet may put on his list a question about (see `ask` below). */
const HER_ASKS: ReadonlySet<HoldType> = new Set<HoldType>(["med", "visit_line"]);

export async function buildEvidence(input: EvidenceInput): Promise<Evidence | null> {
  const { store, scope, subject, locale } = input;
  const viewer: EvidenceViewer = input.viewer ?? { kind: "self" };
  const grants = viewer.kind === "family" ? viewer.grants : null;
  const words: WordsViewer = viewer.kind === "family" ? { kind: "family", dad: viewer.dad } : { kind: "self" };
  const one = (g: Grant) => !grants || grants[g] === true;
  const d0 = scopeD0(scope);
  const sets = new Map<string, Promise<CandidateSet>>();
  let zh: Promise<ZhLookup> | null = null;
  const ctx: Ctx = {
    store,
    scope,
    locale,
    nowMs: input.nowMs,
    aiAllowed: input.aiAllowed,
    w: factWords(locale, words),
    d0,
    day: scope.story_day,
    today: storyDate(d0, scope.story_day),
    cands: (topics = []) => {
      const key = topics.join(",");
      let set = sets.get(key);
      if (!set) sets.set(key, (set = buildCandidates(store, scope.id, { day: scope.story_day, route: "explain", topics, scope })));
      return set;
    },
    zh: () => (zh ??= zhLookup(store, scope, { locale, aiAllowed: input.aiAllowed })),
    fam: viewer.kind === "family",
    linkId: viewer.kind === "family" ? (viewer.linkId ?? null) : null,
    may: (needs) => (typeof needs === "string" ? one(needs) : needs.some(one)),
  };
  const ref = subject.ref.trim();
  let built: Built | null;
  switch (subject.type) {
    case "med":
      built = await medicine(ctx, ref);
      break;
    case "dose":
      built = await dose(ctx, ref);
      break;
    case "bp":
      built = await bpReading(ctx, ref);
      break;
    case "bp_week":
      built = await bpWeek(ctx, ref);
      break;
    case "visit":
      built = await visit(ctx, ref);
      break;
    case "visit_line":
      built = await visitLine(ctx, ref);
      break;
    case "question":
      built = await question(ctx, ref);
      break;
    case "next_visit":
      built = await nextVisit(ctx);
      break;
  }
  if (!built) return null;
  // THE CUT: only the lines and the sources whose switch this reader has leave here (he himself has them all)
  const facts = built.checked.filter((f) => ctx.may(f.needs));
  const kept = built.limit ? facts.slice(0, built.limit) : facts;
  const quoted = built.sources.filter((q) => ctx.may(q.needs));
  const checked = kept.map((f) => f.text);
  const sources = quoted.map((q) => q.sentence);
  // hers: which of his switches the answer draws on (of a line that rides on either of two, the ones that are on)
  const shared = grants ? [...new Set([...kept, ...quoted].flatMap((x) => (typeof x.needs === "string" ? [x.needs] : x.needs.filter(one))))] : undefined;
  const { name, askFor, noAsk, meds, verdict, abstain, fixed } = built;
  const answerId = createHash("sha256")
    // a family member's read is another answer than his, also when the same lines are left
    .update([scope.id, subject.type, ref, locale, verdict, ...checked, ...sources.map((s) => `${s.sourceId}|${s.en}`), ...(viewer.kind === "family" ? ["family", viewer.dad] : [])].join("\n"))
    .digest("hex")
    .slice(0, 32);
  return {
    checked,
    sources,
    verdict,
    abstain,
    fixed,
    subject: { type: subject.type, ref, name },
    meds: meds ?? [],
    // she may put a question on his list only while he shares his questions with her
    // For her only about a medicine or a line of a visit. A visit as such has nothing to ask (the question would only
    // name it), and a dose or a reading that needs a question has one on her 「留意」, worded from what happened
    // (lib/care/record.ts): a second, vaguer one from here would put the same thing on his list twice
    ask: noAsk || !ctx.may(ASKS) || (viewer.kind === "family" && !HER_ASKS.has(subject.type)) ? null : { text: askAboutText(locale, name, words, askFor ?? "doctor"), for: askFor ?? "doctor" },
    answerId,
    ...(shared ? { shared } : {}),
  };
}
