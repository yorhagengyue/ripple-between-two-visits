/**
 * Step 2 of /api/ask (spec section 5): the candidate sources a sentence may cite. Only what is in this list can
 * be said (the whitelist idea from ripple-core verdict.ts, with this app's source ids):
 *
 *   visit:<visit>:R1..R4         required doctor lines (store visit_item rows item-R1..R4; one the model found on a
 *                                transcript only once he confirmed it), with visit date,
 *                                transcript time and the stand-in clip when one exists
 *   visit:<visit>:<utterance>    other visit lines whose speaker role was confirmed (doctor/dispenser/pharmacist)
 *   visit:<visit>:<question>     a recorded answer to one of his questions
 *   label:<medId>                confirmed label directions
 *   <kbSource>:<patientTextId>   a patient_text.json restatement; the span is its drugs.json evidence field
 *   log:bp, log:dose             counts and averages of his own records
 *   referral:<row>, tpl:<id>     fixed referral rows and templates (lib/safety/templates.ts)
 *
 * Story time: only visits, labels and answers that exist on the session's story day are included. On a visit's own day
 * the story clock counts too (gap 7.5, 10-10; line-state.ts visitHappened): a seeded visit nobody has replayed is not a
 * source before this session holds its record, unless the clock has no time of day (the whole day); and a recorded
 * answer the seed carries for a visit this session has replayed or is recording is a source only once its line is in
 * that record (never quoted ahead of the doctor saying it).
 * Who said a visit line follows this session's transcript (line-state.ts, M4): after a replay he has not
 * confirmed, R1-R4 and recorded answers carry cite.roleState "inferred" (推断：医生), as on the visit screen; a
 * line the recording has not reached yet is not a source at all. Cited lines with a clip carry cite.clipUrl.
 * R1 and R2 (the doctor's numbers) are left out of refuse_route answers, R2 only appears for emergencies or
 * when the input mentions A&E / 995, and both are left out when the caller says there is no doctor target yet.
 * A transcript line other than R1-R4 carries the same speaker's line just before and after it (Candidate.context, fix
 * round 3), so verify.ts never shows it cut from a refusal or a correction Whisper put on the next line.
 */
import { isReplayCopy } from "@/lib/visit/happened";
import { existsSync } from "node:fs";
import path from "node:path";
import p1Utterances from "@/fixtures/visits/p1.utterances.json";
import v1Utterances from "@/fixtures/visits/v1.utterances.json";
import v2Utterances from "@/fixtures/visits/v2.utterances.json";
import v3Utterances from "@/fixtures/visits/v3.utterances.json";
import { evidenceFor, getKb, getReferral, getSource, plainReferralText } from "@/lib/kb/load";
import { mentionedDrugIds } from "@/lib/kb/match";
import type { MedicationRow, QuestionRow, Store, UtteranceRole, UtteranceRow, VisitRow } from "@/lib/store/types";
import { isDirective } from "./directive";
import { answerSaid, clinicianAttribution, itemLineState, liveTranscript, visitHappened, type StoryMoment } from "./line-state";
import { ALL_TEMPLATES, type Template } from "./templates";
import { normalizeForCompare, sameQuote } from "./text";
import { detectTopics, isQuestion, mentionsBpMedicine, mentionsPainkiller, refersToMedicine } from "./topics";
import { UNIDENTIFIED_DRUG, type Attribution, type Candidate, type Citation, type Route } from "./types";
import type { SessionRow } from "@/lib/store/types";
import { medsOnDayAt } from "@/lib/meds/on-day";
import { scopedUrl } from "@/lib/subject/url";
import { storyDate } from "@/lib/story/clock";
import { isSummaryItem } from "@/lib/visit/summary-item";

interface FixtureUtterance {
  id: string;
  t_start_ms: number;
  t_end_ms: number;
  speaker_cluster: number | null;
  lang: string;
  text: string;
}

/** web/fixtures/visits/<visit>.utterances.json (the mock speech replay input; roles are NOT in these files). */
export const FIXTURE_UTTERANCES: Record<string, FixtureUtterance[]> = {
  v1: v1Utterances.utterances,
  v2: v2Utterances.utterances,
  p1: p1Utterances.utterances,
  v3: v3Utterances.utterances,
};

const CLINICIAN_ROLES: UtteranceRole[] = ["doctor", "dispenser", "pharmacist"];

function attributionOf(role: UtteranceRole | null | undefined): Attribution | undefined {
  return role === "doctor" || role === "dispenser" || role === "pharmacist" ? role : undefined;
}

/** web/fixtures-relative clip path when the clip file exists (stand-in voices for R1-R4 today). */
export function clipFor(utteranceId: string): string | undefined {
  const rel = path.join("visits", "clips", `${utteranceId}.wav`);
  try {
    return existsSync(path.join(process.cwd(), "fixtures", rel)) ? rel.split(path.sep).join("/") : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Same-origin URL that plays one line's clip (stand-in or cut from the recording): GET /api/visits/[id]/clip. A demo
 * session's id rides along as &session=; an account's never does (lib/subject/url.ts scopedUrl). A bare id string is
 * a demo session (the callers from before C2).
 */
export function clipUrlFor(scope: string | ScopeRef, visitId: string, utteranceId: string): string {
  const s: ScopeRef = typeof scope === "string" ? { id: scope } : scope;
  return scopedUrl(s, `/api/visits/${encodeURIComponent(visitId)}/clip?u=${encodeURIComponent(utteranceId)}`);
}

type ScopeRef = Pick<SessionRow, "id"> & Partial<Pick<SessionRow, "kind">>;

/** Visit and time of a quoted line: the store's transcript first (M2), then the replay fixture. */
export function locateLine(visitId: string, text: string, stored: UtteranceRow[]): Pick<Citation, "utteranceId" | "tStartMs" | "tEndMs" | "clipPath" | "standInVoice"> {
  const s = stored.find((u) => u.text.trim() === text.trim());
  if (s) {
    const clip = s.clip_path ?? clipFor(s.id);
    // every clip under visits/clips/ is a synthetic stand-in until real recordings replace them
    return { utteranceId: s.id, tStartMs: s.t_start_ms, tEndMs: s.t_end_ms, clipPath: clip ?? undefined, standInVoice: clip ? clip.includes("visits/clips/") : undefined };
  }
  const f = (FIXTURE_UTTERANCES[visitId] ?? []).find((u) => u.text.trim() === text.trim());
  if (!f) return {};
  const clip = clipFor(f.id);
  return { utteranceId: f.id, tStartMs: f.t_start_ms, tEndMs: f.t_end_ms, clipPath: clip, standInVoice: clip ? true : undefined };
}

/**
 * Where a recorded answer was said (C2 track S): the line he linked it to (answer_utterance_id) in this scope's record, else
 * the line with the same words (the record, then the replay fixture). The linked id is kept even when no line is found.
 */
function answerWhere(visitId: string, q: Pick<QuestionRow, "answer_text" | "answer_utterance_id">, transcript: UtteranceRow[]): Pick<Citation, "utteranceId" | "tStartMs" | "tEndMs" | "clipPath" | "standInVoice"> {
  const linked = q.answer_utterance_id ? transcript.find((u) => u.id === q.answer_utterance_id) : undefined;
  if (linked) {
    const clip = linked.clip_path ?? clipFor(linked.id);
    return { utteranceId: linked.id, tStartMs: linked.t_start_ms, tEndMs: linked.t_end_ms, clipPath: clip ?? undefined, standInVoice: clip ? clip.includes("visits/clips/") : undefined };
  }
  const found = q.answer_text ? locateLine(visitId, q.answer_text, transcript) : {};
  if (q.answer_utterance_id && found.utteranceId !== q.answer_utterance_id) return { utteranceId: q.answer_utterance_id };
  return found;
}

const NO_LINES: ReadonlyMap<string, number> = new Map();

/**
 * His medicines on a whole story day. C2 round 2 (real-app 12 「medsOnDay 按看诊时刻算」): no rule of its own any more, the
 * one rule of lib/meds/on-day.ts medsOnDayAt with no time of day (a medicine prescribed at a visit is his once that visit
 * happened: it left a record, and the story clock reached it). `lines`: the live transcript length of each prescribing
 * visit in this scope (on-day.ts prescribingLines); the demo seed's confirmed visits need none. A caller that knows the
 * time of day calls medsOnDayAt itself (pipeline.ts, buildCandidates below).
 */
export function medsOnDay(meds: readonly MedicationRow[], visits: readonly VisitRow[], day: number, lines: ReadonlyMap<string, number> = NO_LINES): MedicationRow[] {
  return medsOnDayAt(meds, visits, { day, time: null }, lines);
}

const PATIENT_TEXT_TOPIC: Record<string, string> = {
  purpose: "purpose",
  food: "food",
  stopping: "stopping",
  missed: "missed",
  common_side_effects: "side_effects",
  grapefruit: "grapefruit",
  tell_other_meds: "combination",
  allergy: "allergy",
  monitoring: "blood_test",
  tell_first: "combination",
  long_use: "long_use",
  no_second_nsaid: "combination",
  no_double: "combination",
};
const INSTRUCTION_FIELDS = new Set(["how_to_take", "missed_dose", "stop_or_see_doctor"]);

/** The story's medicine nobody could identify (the relative's box): words that point at it. */
const UNIDENTIFIED_MED_WORDS = /\brelatives?\b|\bfrom china\b|亲戚|親戚|中国带|中國帶|从中国|從中國/i;

interface MedContext {
  /** his prescriptions on the visit's day */
  prescriptions: string[];
  /** medicines he bought himself (the knee painkiller) */
  selfBought: string[];
}

/** The medicines a line points at: named ones, the painkiller, the BP pill, the unidentified box; or only "it / the pills". */
function pointedMedicines(text: string, ctx: MedContext): { drugs: string[]; generic: boolean; unidentified: boolean } {
  const drugs = new Set(mentionedDrugIds(text));
  if (mentionsPainkiller(text)) for (const d of ctx.selfBought) drugs.add(d);
  if (mentionsBpMedicine(text)) for (const d of ctx.prescriptions) drugs.add(d);
  // asking whether one medicine goes "together" with something: with his prescriptions (v2: "这个可以一起吃吗？")
  if (drugs.size > 0 && drugs.size < 2 && detectTopics(text).includes("combination")) for (const d of ctx.prescriptions) drugs.add(d);
  return { drugs: [...drugs].sort(), generic: refersToMedicine(text), unidentified: UNIDENTIFIED_MED_WORDS.test(text) };
}

/**
 * Candidate.about of a transcript line (fix round 1): the medicines it names; else the medicines of the conversation
 * it is part of, walking back at most six lines to the nearest line that names or points at one (a question of his
 * about "the two pills" is about his prescriptions; one about his relative's box is about an unidentified medicine);
 * else the prescriptions he had on that visit's day (none at the first visit). "Yes, both together after breakfast is
 * fine." (v3) is about amlodipine and losartan; "For now, try not to take it every day." (v2) is about the painkiller.
 */
export function lineAbout(lines: Pick<UtteranceRow, "text" | "role">[], index: number, ctx: MedContext): string[] {
  for (let k = index; k >= Math.max(0, index - 6); k--) {
    const l = lines[k];
    const p = pointedMedicines(l.text, ctx);
    if (p.unidentified) return [UNIDENTIFIED_DRUG];
    if (p.drugs.length) return p.drugs;
    if (k < index && (l.role === "patient" || l.role === "family") && p.generic) return [...ctx.prescriptions].sort();
  }
  return [...ctx.prescriptions].sort();
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** At most this long a pause between two lines of one speaker for them to count as one stretch of speech (Candidate.context). */
const NEIGHBOUR_GAP_MS = 5000;

/** Two transcript lines by the same speaker: both roles known and equal, else the same diarisation cluster. */
function sameSpeaker(a: Pick<UtteranceRow, "role" | "speaker_cluster">, b: Pick<UtteranceRow, "role" | "speaker_cluster">): boolean {
  if (a.role !== "unknown" && b.role !== "unknown") return a.role === b.role;
  return a.speaker_cluster !== null && a.speaker_cluster === b.speaker_cluster;
}

/**
 * Candidate.context of transcript lines [first, last] (fix round 3): the line just before and the line just after, when
 * the same speaker said them without a long pause. Whisper can split "Please don't. | Change the dose yourself." or "Take
 * two tablets. | No, one." into two lines; verify.ts wholeSourceBlock then never shows the one without the other.
 */
export function lineContext(lines: Pick<UtteranceRow, "text" | "role" | "speaker_cluster" | "t_start_ms" | "t_end_ms">[], first: number, last = first): Candidate["context"] {
  const near = (a: { t_end_ms: number }, b: { t_start_ms: number }) => !(Number.isFinite(a.t_end_ms) && Number.isFinite(b.t_start_ms)) || b.t_start_ms - a.t_end_ms <= NEIGHBOUR_GAP_MS;
  const prev = lines[first - 1];
  const next = lines[last + 1];
  const before = prev && sameSpeaker(prev, lines[first]) && near(prev, lines[first]) ? prev.text : undefined;
  const after = next && sameSpeaker(next, lines[last]) && near(lines[last], next) ? next.text : undefined;
  return before || after ? { ...(before ? { before } : {}), ...(after ? { after } : {}) } : undefined;
}

/** Candidate.answers of a transcript line: the topics of his question right before it, when it answers one. */
export function lineAnswers(lines: Pick<UtteranceRow, "text" | "role">[], index: number): string[] | undefined {
  const prev = lines[index - 1];
  if (!prev || !(prev.role === "patient" || prev.role === "family") || !isQuestion(prev.text)) return undefined;
  const topics = detectTopics(prev.text);
  return topics.length ? topics : undefined;
}

/** C2: the words of the question a transcript line answers (his line just before it), when lineAnswers finds one. */
export function lineAnsweredQuestion(lines: Pick<UtteranceRow, "text" | "role">[], index: number): string | undefined {
  return lineAnswers(lines, index) ? lines[index - 1].text : undefined;
}

/** Candidate.about of a recorded answer: from the question it answers (an unidentified medicine's question: that box). */
function questionAbout(q: Pick<QuestionRow, "text" | "origin">, answer: string, ctx: MedContext): string[] {
  if (q.origin === "unidentified_medicine") return [UNIDENTIFIED_DRUG];
  const p = pointedMedicines(`${q.text} ${answer}`, ctx);
  if (p.unidentified) return [UNIDENTIFIED_DRUG];
  return p.drugs.length ? p.drugs : [...ctx.prescriptions].sort();
}

/** A line that states a warning number and where to go (lib/visit/extract.ts threshold: "above 180 ... A&E / 995"). */
export function statesWarningLine(text: string): boolean {
  return /\babove\s+\d{2,3}\b|超过\s*\d{2,3}/i.test(text) && /\bA&E\b|\b995\b|\bemergency\b|急诊|救护车/i.test(text);
}

function utteranceTopics(text: string): string[] {
  const t: string[] = [];
  if (/\bcome back\b|\bsee me in\b|复诊/i.test(text)) t.push("appointment");
  if (/\bblood test\b|验血|抽血/i.test(text)) t.push("blood_test");
  if (/\bchange the dose\b|\bdose yourself\b/i.test(text)) t.push("dose_change");
  // taking things together ("both together after breakfast", "take it together with ..."), not "I look at all your
  // readings together" (Dr Lim's D42 answer about an extra tablet, 10-10)
  if (/\b(?:both|take|taking|took|eat|eating|have|swallow|tablets?|pills?|medicines?|medications?|them|it)\b[^.?!;]{0,30}\btogether\b|\btogether with\b|一起吃/i.test(text)) t.push("combination");
  if (/\bfood\b|\bbreakfast\b|饭前|饭后/i.test(text)) t.push("food");
  if (/忘了吃|\bforget\b|\bforgot\b/i.test(text)) t.push("missed");
  return t;
}

/**
 * C2 track S (real-app 12: 问脚肿不引医生第 8 天的「脚肿就告诉我」): a clinician's line about a side effect ("Some people get
 * ankle swelling with this one. If you notice it, tell me."). The pipeline adds such a line, word for word, to a side-effect
 * question about the same symptom (topics.ts sameFacet). Not a candidate topic on purpose: the candidates' topics go into the
 * model's prompt, and the recorded cassettes hold that prompt as it is.
 */
export function aboutSideEffect(text: string): boolean {
  return /\bswelling\b|\bswollen\b|\bside[- ]?effects?\b|\brash\b|\bdizz(?:y|iness)\b|\bheadaches?\b|副作用|肿|腫|头晕|頭暈|皮疹/i.test(text);
}

export interface CandidateOptions {
  day: number;
  /**
   * the story clock's time of day on `day` ("HH:MM"); null = the whole day. Omitted: the session's own clock when `day`
   * is its story day, else null (gap 7.5: on a visit's day the visit counts once it has happened, line-state.ts)
   */
  time?: string | null;
  route: Route;
  topics: string[];
  /** leave out the doctor's numbers (R1 target, R2 warning line) */
  noDoctorTarget?: boolean;
  /** the scope row, for the clip links (an account's carry no session id); default: the id as a demo session */
  scope?: ScopeRef;
}

/**
 * A visit's transcript rows in this session. A planned visit has none (recording one makes it "recording" first:
 * lib/visit/pipeline.ts), so it is not read: no round trip for an empty list (C2 latency pass).
 */
export function transcriptOf(store: Store, sessionId: string, visit: Pick<VisitRow, "id" | "status">): Promise<UtteranceRow[]> {
  return visit.status === "planned" ? Promise.resolve([]) : store.listUtterances(sessionId, visit.id);
}

/**
 * The visits that have happened by the story moment (line-state.ts visitHappened) and the live transcript this session
 * holds for each visit up to the story day (empty when it was never replayed or recorded here).
 */
export async function visitsByMoment(
  store: Store,
  sessionId: string,
  visitsAll: VisitRow[],
  at: StoryMoment,
): Promise<{ happened: VisitRow[]; records: Map<string, UtteranceRow[]> }> {
  const records = new Map<string, UtteranceRow[]>();
  // C2 track E: a replay copy (a confirmed visit watched again, lib/visit/happened.ts) is a re-watch, never a visit
  // that happened: its lines are not sources, so the visit's own lines keep their labels (real-app 12)
  const own = visitsAll.filter((v) => !isReplayCopy(v));
  for (const v of own) if (v.day <= at.day) records.set(v.id, liveTranscript(await transcriptOf(store, sessionId, v)));
  const happened = own.filter((v) => visitHappened(v, at, (records.get(v.id) ?? []).length > 0));
  return { happened, records };
}

/**
 * The ids of the visits that have happened by the story moment, reading a transcript only where it decides: a visit on
 * the story day itself when the clock has a time of day and the visit is not being recorded (ask()'s step 1 needs no
 * more than this; a story day with no visit reads nothing).
 */
export async function happenedVisitIds(store: Store, sessionId: string, visitsAll: VisitRow[], at: StoryMoment): Promise<Set<string>> {
  const out = new Set<string>();
  for (const v of visitsAll) {
    if (isReplayCopy(v)) continue; // a re-watch, never a visit that happened (see visitsByMoment)
    const undecided = v.day === at.day && at.time !== null && v.status !== "recording";
    const hasRecord = undecided ? liveTranscript(await transcriptOf(store, sessionId, v)).length > 0 : false;
    if (visitHappened(v, at, hasRecord)) out.add(v.id);
  }
  return out;
}

/** The session's clock time when `day` is its story day, else null (another day than the session's: the whole day). */
export async function storyTimeOn(store: Store, sessionId: string, day: number): Promise<string | null> {
  const s = await store.getSession(sessionId);
  return s && s.story_day === day ? (s.story_time ?? null) : null;
}

/**
 * Gap 3.9 (10-10): an ask about a test alone (a blood test, perhaps when it is) is answered by what was said about the test
 * and by leaflet lines about tests (topic blood_test), never by a label's or a leaflet's lines on how to take the tablets:
 * those are left out of its candidates, so no generator can put "with a meal or on an empty stomach" under 「验血要空腹吗？」.
 */
const TEST_ONLY_TOPICS = ["blood_test", "appointment"];
export function asksAboutTestOnly(topics: string[]): boolean {
  return topics.includes("blood_test") && topics.every((t) => TEST_ONLY_TOPICS.includes(t));
}

export interface CandidateSet {
  list: Candidate[];
  byId: Map<string, Candidate>;
  /** medicines visible on the day */
  meds: MedicationRow[];
  visits: VisitRow[];
  /**
   * C2 track S: his questions answered at a visit that has happened, whose recorded answer is a candidate here (said by the
   * story moment): the question and the candidate that carries the answer, latest visit first (pipeline.ts matches a new
   * ask against them: a question the doctor already answered gets that answer first, and no new question)
   */
  answered: { question: QuestionRow; sourceId: string; visitDay: number }[];
}

export function referralCandidate(referralId: string): Candidate | null {
  const row = getReferral(referralId);
  if (!row) return null;
  return {
    sourceId: `referral:${row.id}`,
    kind: "referral",
    span: plainReferralText(`${row.refer_to} — ${row.singapore_contact}`),
    instruction: true,
    topics: ["referral"],
    cite: { referralId: row.id },
  };
}

export function templateCandidate(t: Template): Candidate {
  if (t.referralId) {
    const c = referralCandidate(t.referralId);
    if (c) return c;
  }
  return {
    sourceId: `tpl:${t.id}`,
    kind: t.speechAct === "referral" ? "referral" : t.speechAct === "question" ? "log" : "kb",
    span: t.en,
    spanZh: t.zh,
    topics: ["template"],
  };
}

/**
 * Everything the candidates read before the transcripts, side by side (pipeline.ts prefetchAsk starts the same reads
 * early, on the request's read-once store, so these calls find them there).
 */
export function candidateReads(store: Store, sessionId: string, day: number) {
  return Promise.all([
    store.listVisits(sessionId),
    store.listVisitItems(sessionId),
    store.listMeds(sessionId),
    store.listQuestions(sessionId, { status: "answered" }),
    store.listBp(sessionId, { fromDay: Math.max(0, day - 6), toDay: day }),
    store.listDoses(sessionId, { toDay: day }),
  ]);
}

export async function buildCandidates(store: Store, sessionId: string, opts: CandidateOptions): Promise<CandidateSet> {
  const { day } = opts;
  const [visitsAll, items, medsAll, questions, bp, doses] = await candidateReads(store, sessionId, day);
  // gap 7.5: on a visit's own day the visit counts once it has happened (line-state.ts visitHappened)
  const at: StoryMoment = { day, time: opts.time !== undefined ? opts.time : await storyTimeOn(store, sessionId, day) };
  const { happened: visits, records } = await visitsByMoment(store, sessionId, visitsAll, at);
  const visitById = new Map(visits.map((v) => [v.id, v]));
  // his medicines at the story moment (the one rule: lib/meds/on-day.ts): before the day's visit, not what it prescribes
  const recordLines = new Map([...records].map(([id, r]) => [id, r.length] as const));
  const meds = medsOnDayAt(medsAll, visitsAll, at, recordLines);
  const utterancesByVisit = new Map<string, UtteranceRow[]>();
  for (const v of visits) utterancesByVisit.set(v.id, records.get(v.id) ?? []);
  // a playable clip URL next to the fixtures-relative path, for every cited line that has a clip (an account's links
  // carry no session id: the scope row says which it is)
  const scopeRef: ScopeRef = opts.scope ?? (await store.getSession(sessionId)) ?? { id: sessionId };
  const withClipUrl = (visitId: string, cite: Citation): Citation =>
    cite.clipPath && cite.utteranceId ? { ...cite, clipUrl: clipUrlFor(scopeRef, visitId, cite.utteranceId) } : cite;
  // the medicines a spoken line can be about, as of its visit (Candidate.about, the layer-1 relevance rule)
  const selfBought = meds.filter((m) => m.origin === "self_bought" && m.drug_id).map((m) => m.drug_id!);
  const medContext = (visitDay: number): MedContext => ({
    prescriptions: [...new Set(medsOnDay(medsAll, visitsAll, visitDay, recordLines).filter((m) => m.origin === "prescription" && m.drug_id).map((m) => m.drug_id!))],
    selfBought,
  });

  const list: Candidate[] = [];
  const seenText = new Set<string>();
  const answered: CandidateSet["answered"] = [];
  const push = (c: Candidate) => {
    if (list.some((x) => x.sourceId === c.sourceId)) return;
    list.push(c);
    seenText.add(c.span.trim());
  };

  const includeTargets = !opts.noDoctorTarget && opts.route !== "refuse_route";
  const includeThreshold = !opts.noDoctorTarget && (opts.route === "emergency" || opts.topics.includes("threshold"));
  // the words of a target / threshold line left out above are left out everywhere: the same sentence must not come
  // back in as a plain transcript line (a real model finds it there; the offline composer never looked)
  const withheld = new Set<string>();

  // required doctor lines and other confirmed visit items. Who said it follows this session's transcript
  // (line-state.ts): a replayed visit he has not confirmed yet gives "inferred", never the seed's "doctor said".
  for (const item of items) {
    // Ripple's own summary of a visit (lib/visit/summary-item.ts) is never a source, whatever its row says
    if (isSummaryItem(item)) continue;
    const visit = visitById.get(item.visit_id);
    if (!visit) continue;
    if ((item.type === "target" && !includeTargets) || (item.type === "threshold" && !includeThreshold)) {
      withheld.add(normalizeForCompare(item.text));
      continue;
    }
    // M2 items count once confirmed. A required line the model found on a transcript (lib/visit/model-extract.ts,
    // slots.extracted_by "model") is the transcript's sentence, not the seed's identical words: it waits for his
    // confirmation too; the rules' identical-words R lines count at once.
    const modelFound = item.slots?.extracted_by === "model";
    if ((!item.required_line || modelFound) && item.confirmed_by === null) continue;
    if (item.slots?.superseded === true || item.slots?.rejected === true) continue;
    const line = itemLineState(visit, item, utterancesByVisit.get(visit.id) ?? []);
    if (!line.said) continue; // a recording that has not reached this line yet
    const prescribedHere = meds.filter((m) => m.prescribed_visit_id === visit.id && m.drug_id).map((m) => m.drug_id!);
    // A required line the model found counts as R1-R4 only when it is the rules' R line sentence for sentence (text.ts
    // sameQuote: punctuation and sentence boundaries count). lib/visit/model-extract.ts matches by words, so "Please
    // don't. Change the dose yourself. If ..." passes there; here it is an ordinary confirmed line, never visit:v2:R4,
    // and it gets the relevance rule and the stand-alone rule like any other line (fix round 1).
    let requiredLine = item.required_line ?? undefined;
    if (modelFound && requiredLine) {
      const rule = items.find((r) => r.required_line === requiredLine && r.slots?.extracted_by !== "model");
      if (rule && !sameQuote(rule.text, item.text)) requiredLine = undefined;
    }
    const topics =
      item.type === "target"
        ? ["target"]
        : item.type === "threshold"
          ? ["threshold"]
          : item.type === "purpose"
            ? ["why_take"]
            : /\bdose\b/i.test(item.text)
              ? ["dose_change"]
              : [item.type];
    const where = locateLine(visit.id, item.text, utterancesByVisit.get(visit.id) ?? []);
    const role = line.role ?? undefined;
    const itemDrugs = item.type === "purpose" || item.type === "instruction" || item.type === "medication" ? prescribedHere : [];
    // what the item's line is about: its place in the transcript when it has one, else its own words, else the visit's
    const transcript = utterancesByVisit.get(visit.id) ?? [];
    const at = transcript.findIndex((u) => item.utterance_ids?.includes(u.id));
    let lastAt = at;
    for (let k = at + 1; at >= 0 && k < transcript.length && item.utterance_ids?.includes(transcript[k].id); k++) lastAt = k;
    const ownMeds = pointedMedicines(item.text, medContext(visit.day));
    const about =
      at >= 0
        ? lineAbout(transcript, at, medContext(visit.day))
        : ownMeds.unidentified
          ? [UNIDENTIFIED_DRUG]
          : ownMeds.drugs.length
            ? ownMeds.drugs
            : itemDrugs.length
              ? itemDrugs
              : medContext(visit.day).prescriptions;
    push({
      sourceId: `visit:${visit.id}:${requiredLine ?? item.id}`,
      kind: "visit",
      span: item.text,
      attribution: clinicianAttribution(line.role),
      drugs: itemDrugs,
      about,
      ...(at >= 0 && !requiredLine ? { answers: lineAnswers(transcript, at), answersQuestion: lineAnsweredQuestion(transcript, at) } : {}),
      // the same speaker's lines around it (an R line is the doctor's fixed sentence, word for word: no neighbours)
      ...(at >= 0 && !requiredLine ? { context: lineContext(transcript, at, lastAt) } : {}),
      topics,
      instruction: ["instruction", "target", "threshold"].includes(item.type) || isDirective(item.text),
      cite: withClipUrl(visit.id, {
        visitId: visit.id,
        day: visit.day,
        date: visit.date,
        requiredLine,
        ...where,
        role,
        roleState: line.state,
      }),
    });
  }

  // other visit lines whose speaker was confirmed in the post-visit review
  for (const v of visits) {
    const transcript = utterancesByVisit.get(v.id) ?? [];
    for (const [index, u] of transcript.entries()) {
      if (!CLINICIAN_ROLES.includes(u.role) || u.role_state !== "confirmed") continue;
      if (seenText.has(u.text.trim()) || withheld.has(normalizeForCompare(u.text))) continue;
      // a warning line the doctor restates at a later visit (D42, v3-u20: "If it's above 180 on top, ... call 995.") is his
      // number like R2: only for an emergency or an ask about A&E / 995, whether or not it was extracted as a threshold item
      if (!includeThreshold && statesWarningLine(u.text)) continue;
      const clip = u.clip_path ?? clipFor(u.id);
      const answers = lineAnswers(transcript, index);
      push({
        sourceId: `visit:${v.id}:${u.id}`,
        kind: "visit",
        span: u.text,
        attribution: attributionOf(u.role),
        drugs: mentionedDrugIds(u.text),
        about: lineAbout(transcript, index, medContext(v.day)),
        ...(answers ? { answers, answersQuestion: lineAnsweredQuestion(transcript, index) } : {}),
        context: lineContext(transcript, index),
        topics: utteranceTopics(u.text),
        instruction: isDirective(u.text),
        cite: withClipUrl(v.id, {
          visitId: v.id,
          day: v.day,
          date: v.date,
          utteranceId: u.id,
          tStartMs: u.t_start_ms,
          tEndMs: u.t_end_ms,
          clipPath: clip ?? undefined,
          role: u.role,
          roleState: "confirmed",
        }),
      });
    }
  }

  // recorded answers to his questions
  for (const q of questions) {
    if (!q.answer_text || !q.answer_visit_id) continue;
    const visit = visitById.get(q.answer_visit_id);
    if (!visit) continue;
    // an answer the seed records (no line linked yet) for a visit this session holds the record of, or is recording: said
    // only once its line is in that record (the D42 replay reaches Dr Lim's answer at 1:34, not before; gap 7.5). The same
    // rule decides the question list, Today's count and the brief (line-state.ts answerSaid, lib/daily/questions.ts).
    if (!answerSaid(q, visit, at, utterancesByVisit.get(visit.id) ?? [])) continue;
    const drugs = new Set(mentionedDrugIds(`${q.text} ${q.answer_text}`));
    if (mentionsPainkiller(q.text)) for (const m of meds) if (m.origin === "self_bought" && m.drug_id) drugs.add(m.drug_id);
    const topics = q.origin === "unidentified_medicine" ? ["unknown_med_answer"] : utteranceTopics(`${q.text} ${q.answer_text}`);
    if (/一起吃|together/i.test(q.text) && !topics.includes("combination")) topics.push("combination");
    // what the answer is about and which question it answers: the recorded question says it (fix round 1)
    const about = questionAbout(q, q.answer_text, medContext(visit.day));
    const qTopics = detectTopics(q.text);
    const same = list.find((c) => c.kind === "visit" && c.span.trim() === q.answer_text!.trim());
    if (same) {
      // the answer is already a transcript line: the question tells us what it is about
      same.topics = [...new Set([...(same.topics ?? []), ...topics])];
      same.drugs = [...new Set([...(same.drugs ?? []), ...drugs])];
      same.about = about;
      const answers = [...new Set([...(same.answers ?? []), ...qTopics])];
      if (answers.length) same.answers = answers;
      // the question on his list says what the line answers (C2: sameFacet)
      same.answersQuestion = q.text;
      answered.push({ question: q, sourceId: same.sourceId, visitDay: visit.day });
      continue;
    }
    // Who answered: the speaker he named when he linked the answer (answer_utterance_id set by M2's review or
    // M3's picker), else the seed's record; but when this session replayed that visit and he has not confirmed
    // the line, the transcript's state wins (inferred), the same as the visit screen.
    let attribution = attributionOf(q.answer_speaker);
    let role: Citation["role"] = q.answer_speaker ?? undefined;
    let roleState: Citation["roleState"] = attribution ? "confirmed" : undefined;
    const transcript = utterancesByVisit.get(visit.id) ?? [];
    if (!q.answer_utterance_id && transcript.length > 0) {
      const u = transcript.find((x) => x.text.trim() === q.answer_text!.trim());
      if (u && u.role_state !== "confirmed") {
        attribution = clinicianAttribution(u.role);
        role = u.role;
        roleState = u.role_state;
      }
    }
    push({
      sourceId: `visit:${visit.id}:${q.id}`,
      kind: "visit",
      span: q.answer_text,
      attribution,
      drugs: [...drugs],
      about,
      ...(qTopics.length ? { answers: qTopics } : {}),
      answersQuestion: q.text,
      topics,
      instruction: isDirective(q.answer_text),
      // C2 track S: where it was said (the linked line, else the same words in this scope's record or the replay fixture),
      // so the answer carries its time point and, when there is one, its clip, like every other quoted line
      cite: withClipUrl(visit.id, {
        visitId: visit.id,
        day: visit.day,
        date: visit.date,
        ...answerWhere(visit.id, q, transcript),
        role,
        roleState,
      }),
    });
    answered.push({ question: q, sourceId: `visit:${visit.id}:${q.id}`, visitDay: visit.day });
  }

  // a test-only ask (gap 3.9): no label, and only the leaflet lines about tests (below)
  const testOnly = asksAboutTestOnly(opts.topics);

  // confirmed medicine labels (the label is the authority for dose and time)
  for (const m of testOnly ? [] : meds) {
    if (!m.label || !(m.status === "label_confirmed" || m.status === "pharmacist_checked")) continue;
    const span = m.label.directions ?? m.label.text;
    if (!span) continue;
    push({
      sourceId: `label:${m.id}`,
      kind: "label",
      span,
      attribution: "label",
      drugs: m.drug_id ? [m.drug_id] : [],
      about: m.drug_id ? [m.drug_id] : [UNIDENTIFIED_DRUG],
      topics: ["label"],
      instruction: true,
      cite: { medId: m.id, date: m.label.dispensed ?? undefined },
    });
  }

  // leaflet restatements (patient_text.json); the evidence field is what layer 1 checks against
  for (const e of getKb().patientText) {
    const ev = evidenceFor(e);
    if (!ev) continue;
    const src = getSource(e.source_id);
    const suffix = e.id.split(".").slice(1).join(".");
    if (testOnly && (PATIENT_TEXT_TOPIC[suffix] ?? suffix) !== "blood_test") continue;
    push({
      sourceId: `${e.source_id}:${e.id}`,
      kind: "patient_text",
      span: ev.en,
      attribution: "leaflet",
      drugs: [e.drug],
      topics: [PATIENT_TEXT_TOPIC[suffix] ?? suffix],
      instruction: INSTRUCTION_FIELDS.has(ev.field.split(":")[0]),
      restatement: { id: e.id, en: e.en, zh: e.zh, status: e.status },
      cite: { kbSourceId: e.source_id, url: src?.url, title: src?.title, pageDate: src?.page_date, reviewStatus: e.status },
    });
  }

  // his own records: blood pressure in the last 7 days, doses so far. A story day is "Day 12" on the demo (these fixed
  // sentences go into the model's prompt, and the recorded cassettes hold them as they are); an account's is its real
  // date, "2 Oct" / 「10月2日」 (real-app 6.11: no 第 N 天 on an account)
  const accountRow = scopeRef.kind === "account" ? ("d0" in scopeRef && scopeRef.d0 ? (scopeRef as SessionRow) : await store.getSession(sessionId)) : null;
  const accountD0 = accountRow?.d0 ?? null;
  const dayWords = (n: number): { en: string; zh: string } => {
    if (!accountD0) return { en: `Day ${n}`, zh: `第${n}天` };
    const [, m, dd] = storyDate(accountD0, n).split("-").map(Number);
    return { en: `${dd} ${MONTHS_EN[m - 1]}`, zh: `${m}月${dd}日` };
  };
  const recorded = bp.filter((r) => r.state === "recorded" && r.systolic !== null && r.diastolic !== null);
  if (recorded.length > 0) {
    const fromDay = Math.min(...bp.map((r) => r.day));
    const toDay = Math.max(...bp.map((r) => r.day));
    const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
    const s = avg(recorded.map((r) => r.systolic!));
    const d = avg(recorded.map((r) => r.diastolic!));
    const unconfirmed = bp.length - recorded.length;
    const from = dayWords(fromDay);
    const to = dayWords(toDay);
    const en =
      `From ${from.en} to ${to.en} you recorded ${recorded.length} readings, average ${s}/${d}.` +
      (unconfirmed ? ` ${unconfirmed} ${unconfirmed === 1 ? "reading is" : "readings are"} marked unconfirmed.` : "");
    const zh = `${from.zh}到${to.zh}，你记了${recorded.length}次血压，平均 ${s}/${d}。` + (unconfirmed ? `有${unconfirmed}次未确认。` : "");
    push({ sourceId: "log:bp", kind: "log", span: en, spanZh: zh, topics: ["readings_summary"], cite: { day } });
  }
  const medDoses = new Map<string, { taken: number; missed: number; unconfirmed: number; from: number; to: number }>();
  for (const dl of doses) {
    const agg = medDoses.get(dl.medication_id) ?? { taken: 0, missed: 0, unconfirmed: 0, from: dl.day, to: dl.day };
    agg[dl.state]++;
    agg.from = Math.min(agg.from, dl.day);
    agg.to = Math.max(agg.to, dl.day);
    medDoses.set(dl.medication_id, agg);
  }
  for (const [medId, a] of medDoses) {
    const med = meds.find((m) => m.id === medId);
    push({
      sourceId: `log:dose:${medId}`,
      kind: "log",
      span: `From ${dayWords(a.from).en} to ${dayWords(a.to).en}: ${a.taken} taken, ${a.missed} missed, ${a.unconfirmed} unconfirmed.`,
      spanZh: `${dayWords(a.from).zh}到${dayWords(a.to).zh}：吃了${a.taken}次，没吃${a.missed}次，未确认${a.unconfirmed}次。`,
      drugs: med?.drug_id ? [med.drug_id] : [],
      topics: ["dose_log"],
      cite: { medId, day },
    });
  }

  // fixed texts
  for (const t of ALL_TEMPLATES) push(templateCandidate(t));

  // latest visit first (a later answer to the same question is the doctor's latest word on it)
  answered.sort((a, b) => b.visitDay - a.visitDay);
  return { list, byId: new Map(list.map((c) => [c.sourceId, c])), meds, visits, answered };
}
