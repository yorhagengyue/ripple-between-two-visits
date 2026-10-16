/**
 * Who said a line, from its words (the content half of lib/visit/speakers.ts; scene 1 of the owner's video,
 * 2026-10-15: the doctor, the patient and his daughter speak, and the app shows who). Server-only by use.
 *
 *   ruleVote     fixed rules, deterministic, no network: the patient's and the clinician's cues of lib/visit/roles.ts,
 *                and the family member's own (she speaks to him as Dad / 爸, or of him as he / his / my father). Never
 *                surer than RULE_MAX: it stands in until the model answers, and it is the only vote offline (the mock
 *                model, or no consent to AI processing: no model sees the visit)
 *   nameSpeakers one call to the main model for one or a few new lines, with the conversation before them and who each
 *                earlier line was taken to be; it answers doctor / patient / family / unknown and how sure. Its words are
 *                never shown: it only votes. A failure answers nothing (the rules' votes stay), and never throws
 *
 * The model is asked with the same gates as Ripple's summary (lib/visit/ripple-summary.ts summaryGate: a real account,
 * a live model, his consent to AI processing, his day's spend): the caller passes the client the gate gave.
 */
import { parseModelJson } from "@/lib/llm/json";
import type { LlmClient } from "@/lib/llm/types";
import { scoreLine } from "./roles";
import type { SpeakerVote, SpeakerVoteRole } from "./speakers";
import { hasHan } from "./text";

/** The rules are never surer than this (the model's "very clear" is 0.9). */
export const RULE_MAX = 0.75;
/** One call for the new lines: a short answer, quickly. */
export const SPEAKER_TIMEOUT_MS = 8000;
/** Lines before the new ones the model reads. */
export const SPEAKER_CONTEXT_LINES = 12;
/** New lines in one call at most (more wait for the next). */
export const SPEAKER_BATCH = 6;

// ------------------------------------------------------------------ the rules

/** She speaks to him (Dad, at the start or after a comma) or of him (Dad, my father, his ...). */
const FAMILY_CUES: { re: RegExp; w: number }[] = [
  { re: /^\s*(?:dad|daddy|papa|pa|father)\b\s*[,，!！?？.]/i, w: 3 },
  { re: /[,，]\s*(?:dad|daddy|papa)\b/i, w: 3 },
  { re: /\b(?:dad|daddy|papa)\b/i, w: 2 },
  { re: /\bmy (?:father|dad|mother|mum|mom)\b|\bi'?m (?:his|her) (?:daughter|son)\b|\bhe (?:has|had|is|was|keeps|forgets|takes|took|missed|went)\b/i, w: 2 },
  { re: /^\s*(?:爸|爸爸|老爸|阿爸|爹)[，,！!？?。\s]/u, w: 3 },
  { re: /我爸|我爸爸|我父亲|我老爸|他(?:最近|每天|一直|常常|老是)/u, w: 2 },
  { re: /\b(?:him|his)\b/i, w: 1 },
];

/** The clinician beyond lib/visit/roles.ts's cues: checking, reading out a measurement, changing a dose, asking to come back. */
const CLINICIAN_MORE: { re: RegExp; w: number }[] = [
  { re: /\blet me (?:check|see|look|listen|take)\b|\bhave a seat\b|\bsit down\b/i, w: 2 },
  { re: /\b(?:we will|we'll|i will|i'll) (?:increase|reduce|lower|raise|start|stop|change|add|switch|keep|give|prescribe)\b/i, w: 2 },
  { re: /\bplease (?:measure|take|keep|come|bring|write|check|record)\b/i, w: 2 },
  { re: /\b\d{2,3}\s*(?:over|\/)\s*\d{2,3}\b|\bhundred (?:and )?\w+ over\b/i, w: 1 },
  { re: /\bbring (?:him|her) back\b|\bcome back in\b/i, w: 2 },
];

const score = (text: string, cues: readonly { re: RegExp; w: number }[]) => cues.reduce((n, c) => n + (c.re.test(text) ? c.w : 0), 0);

/** The rules' vote for one line (see the header). */
export function ruleVote(text: string): SpeakerVote {
  const t = text.normalize("NFKC").trim();
  const base = scoreLine(t, { requiredLines: [] });
  const scores: Record<SpeakerVoteRole, number> = {
    doctor: base.clinician + score(t, CLINICIAN_MORE),
    patient: base.patient,
    family: score(t, FAMILY_CUES),
  };
  // "Dad" in the doctor's mouth is rare; "your daughter" is the doctor's, "my daughter" the patient's (roles.ts)
  if (/\byour (?:daughter|son|father|dad)\b/i.test(t)) scores.doctor += 1;
  const ranked = (Object.entries(scores) as [SpeakerVoteRole, number][]).sort((a, b) => b[1] - a[1]);
  const [[top, s], [, next]] = ranked;
  if (s >= 2 && s - next >= 1) {
    const sure = Math.min(RULE_MAX, (s - next >= 2 ? 0.5 : 0.4) + 0.06 * s);
    return { role: top, sure: Math.round(sure * 100) / 100, by: "rules" };
  }
  // a line in Chinese with no other cue: the patient, barely (he may speak Mandarin at a visit in English)
  if (s === 0 && hasHan(t) && !/[A-Za-z]{4,}.*[A-Za-z]{4,}/.test(t)) return { role: "patient", sure: 0.5, by: "rules" };
  return { role: "unknown", sure: 0, by: "rules" };
}

// ------------------------------------------------------------------ the model

export const SYSTEM_SPEAKERS = [
  "You tell who said each NEW line of a visit to a doctor or a pharmacist, recorded on the patient's phone. In the room: the doctor (or pharmacist), the patient (an older person, who may speak Mandarin, a dialect, Singlish or English), and a family member who came with the patient.",
  "LINES are in order as a speech recogniser heard them (words may be misheard). `by` is who an earlier line was taken to be: it may be wrong, and null when nobody could tell.",
  "For each id in NEW answer who said it: \"doctor\" (the doctor, pharmacist or other clinic staff), \"patient\", \"family\", or \"unknown\" when neither the words nor the turn order can tell.",
  "Read the words: who is spoken to (Dad / 爸 / Papa is the family member speaking to the patient; Mr or Mrs + name, \"your blood pressure\", an instruction or a dose is usually the doctor; \"Doctor,\" / 医生， with the speaker's own body or medicine is usually the patient), who is spoken of (the family member speaks of the patient as he / his / Dad), and the turn order (an answer follows a question by someone else; \"…, right?\" / 对吗？ checking what was just said is usually the patient).",
  "`sure` is 0..1: 0.9 or more only when the words alone leave no doubt; 0.5 to 0.8 when the turn order points to someone; lower when it is a guess.",
  'Output JSON only: {"lines": [{"id": "L5", "speaker": "doctor" | "patient" | "family" | "unknown", "sure": number}]}.',
].join("\n");

export interface SpeakerLine {
  id: string;
  text: string;
  /** who the line is taken to be now (null: nobody) */
  by: SpeakerVoteRole | null;
}

export interface SpeakerPeople {
  /** how the patient is called, when known ("Mr Tan"); null: not said */
  patient?: string | null;
  /** the family member's name and relation, when known ("Wei Ling, his daughter"); null: not said */
  family?: string | null;
}

/** The model's input: the lines under short ids, the new ones named, and `ids` (short id -> line id). */
export function speakerPayload(context: readonly SpeakerLine[], fresh: readonly SpeakerLine[], people: SpeakerPeople = {}): { payload: Record<string, unknown>; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  const all = [...context, ...fresh];
  const lines = all.map((l, i) => {
    const id = `L${i + 1}`;
    ids.set(id, l.id);
    return { id, by: fresh.includes(l) ? null : l.by, text: l.text.trim() };
  });
  const newIds = lines.slice(context.length).map((l) => l.id);
  const room: Record<string, string> = {};
  if (people.patient) room.patient = people.patient;
  if (people.family) room.family = people.family;
  return { payload: { task: "speakers", ...(Object.keys(room).length ? { people: room } : {}), lines, new: newIds }, ids };
}

/** The votes as answered: { lines: [{ id, speaker, sure }] }; null when the answer does not read. */
export function readSpeakerAnswer(content: string, ids: ReadonlyMap<string, string>, fresh: ReadonlySet<string>): Map<string, SpeakerVote> | null {
  let body: unknown;
  try {
    body = parseModelJson(content);
  } catch {
    return null;
  }
  const list = Array.isArray(body) ? body : body && typeof body === "object" ? (body as { lines?: unknown }).lines : null;
  if (!Array.isArray(list)) return null;
  const out = new Map<string, SpeakerVote>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const { id, speaker, sure } = item as { id?: unknown; speaker?: unknown; sure?: unknown };
    const lineId = typeof id === "string" ? ids.get(id) : undefined;
    if (!lineId || !fresh.has(lineId)) continue;
    const role = speaker === "doctor" || speaker === "patient" || speaker === "family" ? speaker : "unknown";
    const p = typeof sure === "number" && Number.isFinite(sure) ? Math.max(0, Math.min(1, sure)) : 0.6;
    out.set(lineId, { role, sure: role === "unknown" ? 0 : Math.round(p * 100) / 100, by: "model" });
  }
  return out;
}

/** A short code for an error, never its message (a vendor's message can echo the prompt). */
function errorCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[a-z_]{1,32}$/.test(code)) return code;
  const name = (e as { name?: unknown } | null)?.name;
  return name === "AbortError" || name === "TimeoutError" ? "deadline" : "error";
}

/** One call: the model's votes for the `fresh` lines (empty when it failed or answered nothing usable). Never throws. */
export async function nameSpeakers(
  llm: LlmClient,
  context: readonly SpeakerLine[],
  fresh: readonly SpeakerLine[],
  opts: { people?: SpeakerPeople; timeoutMs?: number } = {},
): Promise<{ votes: Map<string, SpeakerVote>; error: string | null; ms: number }> {
  const started = Date.now();
  if (!fresh.length) return { votes: new Map(), error: null, ms: 0 };
  const timeoutMs = opts.timeoutMs ?? SPEAKER_TIMEOUT_MS;
  const { payload, ids } = speakerPayload(context.slice(-SPEAKER_CONTEXT_LINES), fresh, opts.people);
  try {
    const res = await llm.chat({
      system: SYSTEM_SPEAKERS,
      user: JSON.stringify(payload),
      json: true,
      temperature: 0,
      maxTokens: 60 + 40 * fresh.length,
      timeoutMs,
      purpose: "classify",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const votes = readSpeakerAnswer(res.content, ids, new Set(fresh.map((l) => l.id)));
    return votes ? { votes, error: null, ms: Date.now() - started } : { votes: new Map(), error: "bad_response", ms: Date.now() - started };
  } catch (e) {
    return { votes: new Map(), error: errorCode(e), ms: Date.now() - started };
  }
}
