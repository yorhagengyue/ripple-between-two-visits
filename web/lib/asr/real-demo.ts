/**
 * "Try a real recording" (plan item 4, part 2, acceptance 4.3): one of the five PriMock57 mock consultations
 * (CC BY 4.0, fixtures/real/primock57.manifest.json; Babylon clinicians and staff playing patients, not real
 * patients) goes through the same steps a recorded visit does, for real:
 *
 *   1. the mixed recording (doctor and patient channels summed, as a phone on the desk hears them) -> the REAL Whisper
 *      service's whole-recording path (/v1/file, large-v3), without the service's built-in hotwords (they are the
 *      sample story's names);
 *   2. Whisper's segments become the lines, each with its time points. Who said a line comes from the dataset itself,
 *      not from Ripple: its human annotators' per-speaker turn times (the two TextGrids; only when each person talks,
 *      none of their words) must cover the line with one speaker, AND for the doctor the doctor's own channel file must
 *      carry most of the line's energy. Anything else is "unknown" and never gets a card. (Measured on the five
 *      consultations' real Whisper segments: no segment the annotations give to the patient has the doctor's channel
 *      dominant, but about one in six segments the energy alone would call the doctor's spans a turn change; requiring
 *      both keeps those out.) The page says so;
 *   3. items: the deterministic rules (lib/visit/extract.ts), plus the main model's labels (lib/visit/model-extract.ts:
 *      Hunyuan with LLM_PROVIDER=hunyuan, nothing with mock) checked in code, on the doctor's lines only;
 *   4. the safety layer: every card's text is the doctor's whole sentence as Whisper heard it, run through layers 1
 *      and 2 (lib/safety/verify.ts) as a verbatim restatement of that line; a card that does not pass is withheld and
 *      counted. never_cross = cards shown whose text is not, byte for byte, a transcript line (always 0: such a card
 *      is never shown).
 *
 * Nothing is stored: no visit, no utterance, no event, no session data. The demo lives in process memory (the last
 * DEMO_KEEP runs, an hour at most) and never reaches Mr Tan's story (acceptance 4.4). One run at a time per server
 * (it holds the GPU for about a minute). The recordings are read from web/.data/real/primock57 (gitignored; downloaded
 * by scripts/data/fetch_primock57.mjs) and checked against the manifest's sizes first.
 *
 * Server-only (node:fs).
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import manifestJson from "@/fixtures/real/primock57.manifest.json";
import { createMainLlm, mainProviderKind } from "@/lib/llm";
import type { LlmClient } from "@/lib/llm/types";
import { verifySentences } from "@/lib/safety/verify";
import type { Candidate, Sentence } from "@/lib/safety/types";
import type { UtteranceRole } from "@/lib/store/types";
import { findDrugMentions } from "@/lib/kb/match";
import { DOC_CARD_TYPES, extractItems, variantOf, type ExtractContext, type ExtractLine, type ItemDraft } from "@/lib/visit/extract";
import { extractWithModel, mergeDrafts } from "@/lib/visit/model-extract";
import { looksLikeQuestion } from "@/lib/visit/text";
import { parseWav } from "@/lib/visit/wav";
import { WhisperClient, whisperConfig, WhisperSpeechProvider, WhisperUnavailable, type WhisperSegment } from "./whisper";

// ------------------------------------------------------------------ the dataset (from the committed manifest)

interface ManifestFile {
  role: string;
  path: string;
  bytes: number;
  sha256: string;
}
interface ManifestConsultation {
  id: string;
  day: number;
  consultation: number;
  presenting_complaint: string;
  duration_s: number;
  files: ManifestFile[];
}
const MANIFEST = manifestJson as unknown as {
  dataset: { name: string; title: string; repository: string; commit: string; nature: string };
  licence: { id: string; name: string; url: string };
  credit: { short_citation: string; source_url: string; licence_name: string; licence_url: string; en: string; zh: string };
  local_root: string;
  consultations: ManifestConsultation[];
};

/** The credit line every screen of the demo shows (manifest `credit`, CC BY 4.0 section 3(a)(1)). */
export const DEMO_CREDIT = MANIFEST.credit;
export const DEMO_DATASET = { name: MANIFEST.dataset.name, title: MANIFEST.dataset.title, repository: MANIFEST.dataset.repository, commit: MANIFEST.dataset.commit, nature: MANIFEST.dataset.nature, licence: MANIFEST.licence };

export const CONSULTATION_ID = /^day[1-5]_consultation(0[1-9]|1[0-5])$/;

/** Where the downloaded recordings are (RP_REAL_DATA_DIR overrides, for tests). */
export function dataRoot(env: Record<string, string | undefined> = process.env): string {
  const override = (env.RP_REAL_DATA_DIR ?? "").trim();
  return override ? path.resolve(override) : path.join(process.cwd(), ...MANIFEST.local_root.split("/"));
}

export interface DemoConsultation {
  id: string;
  day: number;
  consultation: number;
  presenting_complaint: string;
  duration_s: number;
  /** the three files the demo reads are on this machine with the manifest's sizes */
  available: boolean;
}

const fileOf = (c: ManifestConsultation, role: string): ManifestFile => {
  const f = c.files.find((x) => x.role === role);
  if (!f) throw new Error(`manifest: ${c.id} has no ${role}`);
  return f;
};
const DEMO_ROLES = ["audio_mixed", "audio_doctor", "audio_patient", "utterances"] as const;

function localPath(root: string, f: ManifestFile): string {
  const p = path.join(root, ...f.path.split("/"));
  // the manifest is committed and checked by tests, but a path never leaves the data folder
  if (!path.resolve(p).startsWith(path.resolve(root) + path.sep)) throw new Error("manifest path escapes the data folder");
  return p;
}

export function demoConsultations(env: Record<string, string | undefined> = process.env): DemoConsultation[] {
  const root = dataRoot(env);
  return MANIFEST.consultations.map((c) => ({
    id: c.id,
    day: c.day,
    consultation: c.consultation,
    presenting_complaint: c.presenting_complaint,
    duration_s: c.duration_s,
    available: DEMO_ROLES.every((r) => {
      const f = fileOf(c, r);
      const p = localPath(root, f);
      return existsSync(p) && statSync(p).size === f.bytes;
    }),
  }));
}

/** sha256 of the files already checked this process (a 20 MB file is hashed once, not on every run) */
const g = globalThis as unknown as { __rippleRealDemo?: { jobs: Map<string, DemoJob>; verified: Set<string> } };
function registry() {
  g.__rippleRealDemo ??= { jobs: new Map(), verified: new Set() };
  return g.__rippleRealDemo;
}

export class DemoDataError extends Error {}

/** A demo file, checked against the manifest (size, sha256 once per process). */
function readDemoFile(root: string, f: ManifestFile): Uint8Array {
  const p = localPath(root, f);
  if (!existsSync(p)) throw new DemoDataError(`${f.path} is not on this machine: run node scripts/data/fetch_primock57.mjs in web/`);
  const bytes = new Uint8Array(readFileSync(p));
  if (bytes.byteLength !== f.bytes) throw new DemoDataError(`${f.path} has the wrong size: run node scripts/data/fetch_primock57.mjs in web/`);
  const key = `${p}|${f.sha256}`;
  if (!registry().verified.has(key)) {
    if (createHash("sha256").update(bytes).digest("hex") !== f.sha256) throw new DemoDataError(`${f.path} does not match the manifest: run node scripts/data/fetch_primock57.mjs in web/`);
    registry().verified.add(key);
  }
  return bytes;
}

/** The per-speaker turn times of the dataset's utterances file (its words are not read). */
export function speakerTurns(bytes: Uint8Array): SpeakerTurn[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new DemoDataError("the utterances file is not JSON");
  }
  const list = (parsed as { utterances?: unknown })?.utterances;
  if (!Array.isArray(list)) throw new DemoDataError("the utterances file has no utterances");
  const out: SpeakerTurn[] = [];
  for (const u of list as Record<string, unknown>[]) {
    const st = u?.t_start_ms;
    const en = u?.t_end_ms;
    const who = u?.speaker;
    if (typeof st === "number" && typeof en === "number" && en >= st && (who === "doctor" || who === "patient")) out.push({ t_start_ms: st, t_end_ms: en, speaker: who });
  }
  return out;
}

// ------------------------------------------------------------------ pure steps (unit-tested)

export type DemoSpeaker = "doctor" | "patient" | "unknown";

export interface DemoLine {
  id: string;
  t_start_ms: number;
  t_end_ms: number;
  /** the words as Whisper wrote them, joined (a run of its transcript, nothing added) */
  text: string;
  lang: string | null;
  speaker: DemoSpeaker;
  /** share of the line's energy on the doctor's channel (0-1), null when the line is silent on both */
  doctor_share: number | null;
  /** share of the line's time the dataset's annotations give to each speaker (0-1) */
  turns: { doctor: number; patient: number };
  /** how many of Whisper's words it has (a segment without word times counts as one) */
  words: number;
  /**
   * the same speaker went straight on from the line before: no pause of LINE_GAP_MS, no turn of the other person's in
   * between (the line before only ended a sentence, or was cut for length)
   */
  continues: boolean;
}

/** When a speaker talks, from the dataset's per-speaker annotations (times only). */
export interface SpeakerTurn {
  t_start_ms: number;
  t_end_ms: number;
  speaker: "doctor" | "patient";
}

/** One word as Whisper heard it: its token as written (leading space included), its time, its segment. */
export interface HeardWord {
  start_ms: number;
  end_ms: number;
  token: string;
  lang: string;
  /** index of its Whisper segment (time order) */
  seg: number;
  /** a whole segment that came without word times (an older service): one block, attributed as a whole */
  block: boolean;
}

export interface AttributedWord extends HeardWord {
  speaker: DemoSpeaker;
  doctor_share: number | null;
}

const squash = (s: string) => s.replace(/\s+/g, "");
const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Whisper's words in time order. A segment whose words do not join back into its text (whitespace aside) is kept as
 * one block instead: a line is always a run of what Whisper wrote, never a re-spelling of it.
 */
export function wordsFromSegments(segments: Pick<WhisperSegment, "start_ms" | "end_ms" | "text" | "lang" | "words">[]): HeardWord[] {
  const out: HeardWord[] = [];
  segments
    .filter((s) => s.text.trim())
    .slice()
    .sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms)
    .forEach((s, seg) => {
      const words = (s.words ?? []).filter((w) => w.word.trim());
      const lang = s.lang || "";
      if (words.length && squash(words.map((w) => w.word).join("")) === squash(s.text)) {
        for (const w of words) out.push({ start_ms: w.start_ms, end_ms: Math.max(w.start_ms, w.end_ms), token: w.word, lang, seg, block: false });
      } else {
        out.push({ start_ms: s.start_ms, end_ms: Math.max(s.start_ms, s.end_ms), token: s.text, lang, seg, block: true });
      }
    });
  return out;
}

/** 16-bit PCM samples of a mono WAV (PCM only: lib/visit/wav.ts parseWav). */
export function pcm16(bytes: Uint8Array): { samples: Int16Array; sampleRate: number } {
  const info = parseWav(bytes);
  if (!info || info.channels !== 1 || info.bitsPerSample !== 16) throw new DemoDataError("a channel file is not a mono 16-bit PCM WAV");
  const n = Math.floor(info.dataLength / 2);
  const copy = bytes.slice(info.dataOffset, info.dataOffset + n * 2);
  return { samples: new Int16Array(copy.buffer, copy.byteOffset, n), sampleRate: info.sampleRate };
}

function energy(samples: Int16Array, from: number, to: number): number {
  let e = 0;
  for (let i = Math.max(0, from); i < Math.min(samples.length, to); i++) e += samples[i] * samples[i];
  return e;
}

/** For a whole block: the doctor's channel must carry this share of its energy ... */
export const SPEAKER_SHARE = 0.75;
/** ... the annotations must give it to one speaker for this share of its time ... */
export const TURN_SHARE = 0.6;
/** ... and to the other for none of it (a block cannot be trimmed: any of the other speaker's time and it is "?"). */
export const OTHER_TURN_MAX = 0;
/** A word annotated to one speaker only: the channels must not say the other one (doctor share at least / at most this). */
export const WORD_SHARE = 0.5;
/**
 * A word where both are annotated (overlap): the channel must clearly say who (this share, or 1 minus it). Measured on
 * the five consultations: a patient's word at a turn handover can carry 0.75 of its sound on the doctor's microphone
 * (the doctor's last word still ringing); the doctor's own words in crosstalk are mostly above 0.85.
 */
export const OVERLAP_SHARE = 0.85;
/** Below this mean square on both channels a stretch is silence (no energy share). */
const SILENT_MS = 100;

function doctorShare(doctor: Int16Array, patient: Int16Array, sampleRate: number, fromMs: number, toMs: number): number | null {
  const from = Math.floor((fromMs / 1000) * sampleRate);
  const to = Math.ceil((toMs / 1000) * sampleRate);
  const ed = energy(doctor, from, to);
  const ep = energy(patient, from, to);
  return (ed + ep) / Math.max(1, to - from) < SILENT_MS ? null : ed / (ed + ep);
}

/** Milliseconds of [from, to] the annotations give to `who` (overlapping turns of one speaker counted once). */
export function turnOverlapMs(turns: SpeakerTurn[], who: SpeakerTurn["speaker"], from: number, to: number): number {
  const spans = turns
    .filter((t) => t.speaker === who && t.t_end_ms > from && t.t_start_ms < to)
    .map((t) => [Math.max(from, t.t_start_ms), Math.min(to, t.t_end_ms)] as const)
    .sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let reach = from;
  for (const [s, e] of spans) {
    const lo = Math.max(s, reach);
    if (e > lo) covered += e - lo;
    reach = Math.max(reach, e);
  }
  return covered;
}

/** The annotated turns of `who` inside [from, to], merged into disjoint intervals. */
function turnIntervals(turns: SpeakerTurn[], who: SpeakerTurn["speaker"], from: number, to: number): [number, number][] {
  const spans = turns
    .filter((t) => t.speaker === who && t.t_end_ms > from && t.t_start_ms < to)
    .map((t) => [Math.max(from, t.t_start_ms), Math.min(to, t.t_end_ms)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [a, b] of spans) {
    const last = out.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * Milliseconds of [from, to] in which the annotations have `who` talking and the other person not (`who` alone: a
 * turn of theirs, not crosstalk over the other).
 */
export function aloneMs(turns: SpeakerTurn[], who: SpeakerTurn["speaker"], from: number, to: number): number {
  if (to <= from) return 0;
  const mine = turnIntervals(turns, who, from, to);
  const theirs = turnIntervals(turns, who === "doctor" ? "patient" : "doctor", from, to);
  let alone = 0;
  for (const [a, b] of mine) {
    let covered = 0;
    for (const [c, d] of theirs) covered += Math.max(0, Math.min(b, d) - Math.max(a, c));
    alone += b - a - covered;
  }
  return alone;
}

function turnShare(turns: SpeakerTurn[], who: SpeakerTurn["speaker"], from: number, to: number): number {
  return Math.min(1, turnOverlapMs(turns, who, from, to) / Math.max(1, to - from));
}

const talking = (turns: SpeakerTurn[], who: SpeakerTurn["speaker"], at: number) => turns.some((t) => t.speaker === who && t.t_start_ms <= at && at <= t.t_end_ms);

/**
 * Who said each word, from the dataset itself, never from the words (see the header):
 *   - a word whose middle the annotations give to one speaker only: that speaker, unless the channels contradict it
 *     (the doctor's channel carries less than WORD_SHARE of its sound for the doctor, more for the patient): "?";
 *   - both annotated (overlapping speech): the channel decides, only when clear (OVERLAP_SHARE either way), else "?";
 *   - neither annotated: "?";
 *   - a block (a segment without word times): the doctor only when the annotations give it to the doctor (TURN_SHARE
 *     of its time) and none of it to the patient, and the doctor's channel carries SPEAKER_SHARE of its sound; the
 *     patient the same way; else "?".
 * "?" never makes a card.
 */
export function attributeWords(words: HeardWord[], doctor: Int16Array, patient: Int16Array, sampleRate: number, turns: SpeakerTurn[]): AttributedWord[] {
  return words.map((w) => {
    const share = doctorShare(doctor, patient, sampleRate, w.start_ms, w.end_ms);
    let speaker: DemoSpeaker = "unknown";
    if (w.block) {
      const td = turnShare(turns, "doctor", w.start_ms, w.end_ms);
      const tp = turnShare(turns, "patient", w.start_ms, w.end_ms);
      if (td >= TURN_SHARE && tp <= OTHER_TURN_MAX && share !== null && share >= SPEAKER_SHARE) speaker = "doctor";
      else if (tp >= TURN_SHARE && td <= OTHER_TURN_MAX && (share === null || share <= 1 - SPEAKER_SHARE)) speaker = "patient";
    } else {
      const mid = (w.start_ms + w.end_ms) / 2;
      const d = talking(turns, "doctor", mid);
      const p = talking(turns, "patient", mid);
      if (d && !p) speaker = share === null || share >= WORD_SHARE ? "doctor" : "unknown";
      else if (p && !d) speaker = share === null || share <= WORD_SHARE ? "patient" : "unknown";
      else if (d && p && share !== null) speaker = share >= OVERLAP_SHARE ? "doctor" : share <= 1 - OVERLAP_SHARE ? "patient" : "unknown";
    }
    return { ...w, speaker, doctor_share: share === null ? null : Math.round(share * 1000) / 1000 };
  });
}

/** A pause this long between two words ends a line. */
export const LINE_GAP_MS = 1500;
/** The other person talking alone this long between two words (a turn Whisper did not write down) ends a line too. */
export const TURN_BETWEEN_MS = 150;
/** A line running this many words without a sentence end is cut at a Whisper segment boundary. */
export const MAX_LINE_WORDS = 40;
const SENTENCE_END = /[.?!。？！…][”"'’)\]]*$/;

/**
 * Lines: one speaker's sentence each. Consecutive words of one speaker, up to the end of a sentence (Whisper's own
 * full stop, question mark ...), a pause of LINE_GAP_MS, a change of speaker or language, or a turn of the other
 * person's between two words (TURN_BETWEEN_MS of them talking alone: Whisper may not have written it down); a block is
 * a line of its own. Whisper does not always punctuate: a run longer than MAX_LINE_WORDS without a sentence end is cut at its
 * segment boundaries. The text is the words exactly as Whisper wrote them, joined.
 */
export function linesFromWords(id: string, words: AttributedWord[], doctor: Int16Array, patient: Int16Array, sampleRate: number, turns: SpeakerTurn[]): DemoLine[] {
  // groups of words; `goesOn`: the group's speaker went straight on from the group before (it only ended a sentence)
  const groups: { words: AttributedWord[]; goesOn: boolean }[] = [];
  for (const w of words) {
    const cur = groups.at(-1);
    const prev = cur?.words.at(-1);
    const sameStretch =
      !!prev &&
      !prev.block &&
      !w.block &&
      prev.speaker === w.speaker &&
      prev.lang === w.lang &&
      w.start_ms - prev.end_ms < LINE_GAP_MS &&
      !(prev.speaker !== "unknown" && aloneMs(turns, prev.speaker === "doctor" ? "patient" : "doctor", prev.end_ms, w.start_ms) >= TURN_BETWEEN_MS);
    if (cur && prev && sameStretch && !SENTENCE_END.test(prev.token.trim())) cur.words.push(w);
    else groups.push({ words: [w], goesOn: sameStretch });
  }
  const cut: { words: AttributedWord[]; goesOn: boolean }[] = [];
  for (const g of groups) {
    if (g.words.length <= MAX_LINE_WORDS) {
      cut.push(g);
      continue;
    }
    // whole segments' worth of words, greedily, at most MAX_LINE_WORDS each (one long segment stays whole)
    let piece: AttributedWord[] = [];
    let first = true;
    let i = 0;
    while (i < g.words.length) {
      let j = i;
      while (j < g.words.length && g.words[j].seg === g.words[i].seg) j++;
      const seg = g.words.slice(i, j);
      if (piece.length && piece.length + seg.length > MAX_LINE_WORDS) {
        cut.push({ words: piece, goesOn: first ? g.goesOn : true });
        first = false;
        piece = [];
      }
      piece.push(...seg);
      i = j;
    }
    if (piece.length) cut.push({ words: piece, goesOn: first ? g.goesOn : true });
  }
  return cut.map(({ words: g, goesOn }, i) => {
    const from = g[0].start_ms;
    const to = Math.max(...g.map((w) => w.end_ms));
    const share = doctorShare(doctor, patient, sampleRate, from, to);
    const r3 = (x: number) => Math.round(x * 1000) / 1000;
    return {
      id: `${id}-l${String(i + 1).padStart(3, "0")}`,
      t_start_ms: from,
      t_end_ms: to,
      text: tidy(g.map((w) => w.token).join(g[0].block ? " " : "")),
      lang: g[0].lang || null,
      speaker: g[0].speaker,
      doctor_share: share === null ? null : r3(share),
      turns: { doctor: r3(turnShare(turns, "doctor", from, to)), patient: r3(turnShare(turns, "patient", from, to)) },
      words: g.length,
      continues: goesOn,
    };
  });
}

/** Whisper's whole transcript as it wrote it (for the verbatim check: every card is a run of it). */
export function transcriptOf(segments: Pick<WhisperSegment, "start_ms" | "end_ms" | "text">[]): string {
  return tidy(
    segments
      .slice()
      .sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms)
      .map((s) => s.text)
      .join(" "),
  );
}

export interface DemoCard {
  id: string;
  type: string;
  /** doc-card variant (lib/visit/extract.ts variantOf): the label the visit screen uses */
  variant: string;
  /** the doctor's words exactly as Whisper heard them: the card's line, or (a dose card) the line before it too */
  quote: string;
  /** the line the item is on */
  line_id: string;
  /** every line the quote is made of, in order (two when the dose card carries the sentence that names the medicine) */
  line_ids: string[];
  t_start_ms: number;
  t_end_ms: number;
  speaker: "doctor";
  by: "rules" | "model";
}

const SPOKEN_ROLE: Record<DemoSpeaker, UtteranceRole> = { doctor: "doctor", patient: "patient", unknown: "unknown" };

export function extractLines(lines: DemoLine[]): ExtractLine[] {
  return lines.map((l) => ({ id: l.id, text: l.text, role: SPOKEN_ROLE[l.speaker], t_start_ms: l.t_start_ms, t_end_ms: l.t_end_ms }));
}

export function demoContext(id: string): ExtractContext {
  // not Mr Tan's: none of his required lines, none of his medicines
  return { visit: { id: `real-${id}`, day: 0, kind: "gp_consultation" }, requiredLines: [], priorPrescriptions: [] };
}

/** "do you ...", "are you ...", "can I ...", "is it ...": a question by its word order, with or without a question mark. */
const QUESTION_ORDER = [
  /\b(?:can|could|may|shall|should|would|will)\s+(?:i|we)\b/i,
  /\b(?:do|does|did|have|has|had)\s+(?:you|i|we|they|he|she)\b/i,
  /\b(?:are|is|was|were|am)\s+(?:you|i|we|they|he|she|it|there)\b/i,
  /\b(?:can|could|would|will)\s+you\b/i,
];
/** Taking details, not giving care: name, birth date, contact details, "tell me the names". */
const ADMIN_TALK = /\b(?:your (?:full |first |last )?name|names? please|date of birth|e-?mail|(?:home |postal )?address|(?:phone|mobile|telephone) number|post ?code|nhs number|confirm (?:your|who|that i'?m)|spell (?:that|it)|tell me the names?)\b/i;

/**
 * Why a doctor's line is not a note to keep, or null: a question (a question mark, or a question's word order: Whisper
 * often leaves the mark out) or taking details (admin talk). Such lines never make a card. Dropping one never adds
 * anything of the app's own; it only shows less.
 */
export function notANote(text: string): "question" | "admin" | null {
  if (looksLikeQuestion(text) || QUESTION_ORDER.some((re) => re.test(text))) return "question";
  if (ADMIN_TALK.test(text)) return "admin";
  return null;
}

/** Generic medicine names by their endings (furosemide, salbutamol, simvastatin, lisinopril, bisoprolol ...) and a few brands. */
const MEDICINE_NAME =
  /\b[a-z]{3,}(?:olol|pril|sartan|statin|semide|thiazide|dipine|amol|terol|cillin|mycin|cycline|floxacin|azole|prazole|tidine|profen|fenac|xaban|gliptin|formin|lukast|olone|isone|tropium|caine|codeine|morphine|amadol|oxetine|zepam|zolam|parin)\b|\b(?:ventolin|nurofen|calpol|lasix|seretide|symbicort|codeine|morphine)\b/i;

/** The quote names a medicine: one the app's medicine list knows (kb), or a generic name by its ending. */
export function namesMedicine(text: string): boolean {
  return findDrugMentions(text).length > 0 || MEDICINE_NAME.test(text);
}

/** Card variants about one medicine: without its name the card would say "take it twice a day" about nothing. */
export const MEDICINE_VARIANTS = new Set(["med", "new_med", "how_to_take", "dose_rule", "missed_dose"]);

export type HeldReason = "question" | "admin" | "no_medicine_name" | "same_sentence";

const endsSentence = (l: DemoLine) => SENTENCE_END.test(l.text.trim());

/**
 * The doctor's whole sentence around line i, as [first, last] line indexes: back to the end of the doctor's previous
 * sentence and on to the end of this one (Whisper's own full stop, question mark ...), never past a line that is not
 * the doctor's, a pause of LINE_GAP_MS or a turn of the patient's (DemoLine.continues). When Whisper did not
 * punctuate, that is the doctor's whole stretch of talk between the patient's turns.
 */
export function sentenceSpan(lines: DemoLine[], i: number): [number, number] {
  const together = (a: number, b: number) => lines[a].speaker === "doctor" && lines[b].speaker === "doctor" && lines[b].continues;
  let from = i;
  while (from > 0 && together(from - 1, from) && !endsSentence(lines[from - 1])) from--;
  let to = i;
  while (to < lines.length - 1 && !endsSentence(lines[to]) && together(to, to + 1)) to++;
  return [from, to];
}

/**
 * Doctor's-note cards from item drafts. Only the doctor's lines and doc-card types. A card quotes the doctor's whole
 * sentence (sentenceSpan), never a piece of it: Whisper's segments and lines can stop mid-sentence. One card per
 * sentence (the rules' item first: they come first in the drafts; another label on the same sentence is dropped). Not
 * from a question or from taking details (notANote on the whole sentence). A card about one medicine
 * (MEDICINE_VARIANTS) must name it: when its sentence does not, the doctor's sentence just before it, in the same
 * stretch of talk, is quoted with it when that one does; otherwise no card. Everything held back is counted, with why.
 */
export function cardsFromDrafts(lines: DemoLine[], drafts: ItemDraft[]): { cards: DemoCard[]; held: { draft_id: string; line_id: string; why: HeldReason }[] } {
  const index = new Map(lines.map((l, i) => [l.id, i]));
  const cards: DemoCard[] = [];
  const held: { draft_id: string; line_id: string; why: HeldReason }[] = [];
  const taken: [number, number][] = [];
  const textOf = (a: number, b: number) => lines.slice(a, b + 1).map((l) => l.text).join(" ");
  for (const d of drafts) {
    if (!DOC_CARD_TYPES.includes(d.type)) continue;
    const at = index.get(d.utterance_ids[0] ?? "");
    const line = at === undefined ? undefined : lines[at];
    if (at === undefined || !line || line.speaker !== "doctor") continue;
    let [from, to] = sentenceSpan(lines, at);
    if (taken.some(([a, b]) => from <= b && to >= a)) {
      held.push({ draft_id: d.id, line_id: line.id, why: "same_sentence" });
      continue;
    }
    const not = notANote(textOf(from, to));
    if (not) {
      held.push({ draft_id: d.id, line_id: line.id, why: not });
      continue;
    }
    const variant = variantOf(d);
    if (MEDICINE_VARIANTS.has(variant) && !namesMedicine(textOf(from, to))) {
      const prev = from > 0 && lines[from - 1].speaker === "doctor" && lines[from].continues ? sentenceSpan(lines, from - 1) : null;
      if (prev && namesMedicine(textOf(prev[0], prev[1])) && !notANote(textOf(prev[0], prev[1]))) from = prev[0];
      else {
        held.push({ draft_id: d.id, line_id: line.id, why: "no_medicine_name" });
        continue;
      }
      if (taken.some(([a, b]) => from <= b && to >= a)) {
        held.push({ draft_id: d.id, line_id: line.id, why: "same_sentence" });
        continue;
      }
    }
    taken.push([from, to]);
    cards.push({
      id: d.id,
      type: d.type,
      variant,
      quote: textOf(from, to),
      line_id: line.id,
      line_ids: lines.slice(from, to + 1).map((l) => l.id),
      t_start_ms: lines[from].t_start_ms,
      t_end_ms: Math.max(...lines.slice(from, to + 1).map((l) => l.t_end_ms)),
      speaker: "doctor",
      by: d.slots?.extracted_by === "model" ? "model" : "rules",
    });
  }
  return { cards: cards.sort((a, b) => a.t_start_ms - b.t_start_ms || a.id.localeCompare(b.id)), held };
}

/**
 * Whisper's word times are good to a few hundred milliseconds: the last word of a stretch often runs on into the
 * silence after it (measured on the five consultations: 37 of 380 doctor sentences reach up to 300 ms into the
 * patient's next turn, none further except where the patient really talked in between). The speaker check leaves
 * this much at each end of a card's time out.
 */
export const WORD_TIME_SLACK_MS = 300;

/** Milliseconds the annotations have the patient talking alone inside a card's time, its ends' slack left out. */
export function patientAloneInside(turns: SpeakerTurn[], from: number, to: number): number {
  const a = from + WORD_TIME_SLACK_MS;
  const b = to - WORD_TIME_SLACK_MS;
  if (b <= a) {
    const mid = (from + to) / 2;
    return aloneMs(turns, "patient", mid - 1, mid + 1) > 0 ? 1 : 0;
  }
  return aloneMs(turns, "patient", a, b);
}

/**
 * The speaker check, against the dataset's own annotations and Whisper's own transcript (not the steps above):
 *   - patient_time: inside the card's time (its first word to its last, WORD_TIME_SLACK_MS left out at each end) the
 *     dataset marks the patient talking while the doctor is not, even for a millisecond (crosstalk, where both are
 *     marked, is the doctor's microphone's call in attributeWords);
 *   - not_verbatim: the quote is not a run of Whisper's transcript (whitespace aside);
 *   - not_doctor: a line of the quote is not the doctor's.
 * A card with any of these is withheld. The e2e test makes the same check again from the dataset's file.
 */
export function speakerCheck(card: Pick<DemoCard, "quote" | "line_ids" | "t_start_ms" | "t_end_ms">, lines: DemoLine[], turns: SpeakerTurn[], transcript: string): string[] {
  const out: string[] = [];
  if (patientAloneInside(turns, card.t_start_ms, card.t_end_ms) > 0) out.push("patient_time");
  if (!squash(transcript).includes(squash(card.quote))) out.push("not_verbatim");
  const byId = new Map(lines.map((l) => [l.id, l]));
  if (card.line_ids.some((id) => byId.get(id)?.speaker !== "doctor")) out.push("not_doctor");
  return out;
}

export interface SafetyReport {
  /** cards that reached the safety step */
  checked: number;
  passed: number;
  /** withheld by layers 1-2 (layer 1 or 2) or by the speaker check ("speaker", with its reasons) */
  blocked: { card_id: string; line_id: string; layer: 1 | 2 | 3 | "speaker"; reasons: string[] }[];
  /** labels that made no card, by why (a question, taking details, no medicine named, a second label on one line) */
  held: Record<HeldReason, number>;
  /**
   * Cards shown that fail the speaker check (patient_time, not_verbatim, not_doctor), counted on what is shown after
   * every step. 0 unless a step above let one through; the e2e test checks the shown cards again from the dataset.
   */
  never_cross: number;
}

/**
 * Every card through layers 1 and 2 as a verbatim restatement of the doctor's own words, attributed to the doctor
 * (layer 3 is not needed for a verbatim quote, and no checker is given: anything that is not one fails closed), then
 * the speaker check. A card that fails either is withheld and listed with why.
 */
export async function checkCards(
  cards: DemoCard[],
  lines: DemoLine[],
  turns: SpeakerTurn[],
  transcript: string,
  held: { why: HeldReason }[] = [],
): Promise<{ shown: DemoCard[]; report: SafetyReport }> {
  const candidates = new Map<string, Candidate>();
  const sentences: Sentence[] = [];
  for (const c of cards) {
    const span = lines.filter((l) => c.line_ids.includes(l.id)).map((l) => l.text).join(" ");
    candidates.set(c.id, { sourceId: c.id, span, kind: "visit", attribution: "doctor", instruction: true, cite: { utteranceId: c.line_id, tStartMs: c.t_start_ms, tEndMs: c.t_end_ms, role: "doctor", roleState: "inferred" } });
    sentences.push({ speechAct: "restate", sourceId: c.id, span, slots: {}, en: c.quote, attribution: "doctor" });
  }
  const { verdicts } = await verifySentences(sentences, { candidates, checker: null, checkerReason: "the demo shows verbatim quotes only" });
  const shown: DemoCard[] = [];
  const blocked: SafetyReport["blocked"] = [];
  verdicts.forEach((v, i) => {
    const c = cards[i];
    if (!v.pass) {
      blocked.push({ card_id: c.id, line_id: c.line_id, layer: (v.blockedBy ?? 1) as 1 | 2 | 3, reasons: [...(v.layer1.reasons ?? []), ...(v.layer2?.reasons ?? []), ...(v.layer3?.reasons ?? [])] });
      return;
    }
    const crossing = speakerCheck(c, lines, turns, transcript);
    if (crossing.length) blocked.push({ card_id: c.id, line_id: c.line_id, layer: "speaker", reasons: crossing });
    else shown.push(c);
  });
  const heldCounts: Record<HeldReason, number> = { question: 0, admin: 0, no_medicine_name: 0, same_sentence: 0 };
  for (const h of held) heldCounts[h.why] += 1;
  const neverCross = shown.filter((c) => speakerCheck(c, lines, turns, transcript).length > 0).length;
  return { shown, report: { checked: cards.length, passed: shown.length, blocked, held: heldCounts, never_cross: neverCross } };
}

// ------------------------------------------------------------------ the run

export type DemoState = "starting" | "transcribing" | "extracting" | "checking" | "done" | "failed";

export interface DemoResult {
  consultation: Omit<DemoConsultation, "available">;
  whisper: { model: string | null; transcribe_ms: number; segments: number; words: number; segments_without_word_times: number; built_in_hotwords: false };
  lines: DemoLine[];
  speakers: { doctor: number; patient: number; unknown: number; method: string };
  cards: DemoCard[];
  extraction: { source: "rules" | "rules+model"; provider: string | null; model: string | null; added: number; rejected: number; error: string | null; latency_ms: number };
  safety: SafetyReport;
}

export interface DemoJob {
  id: string;
  consultation: string;
  owner: string;
  state: DemoState;
  progress: { done: number | null; total: number | null } | null;
  started_at: number;
  finished_at: number | null;
  /** short, safe to show: why the run failed */
  error: string | null;
  result: DemoResult | null;
  cancel: AbortController;
}

export const DEMO_KEEP = 20;
const DEMO_TTL_MS = 3_600_000;

function jobs(): Map<string, DemoJob> {
  const m = registry().jobs;
  const cutoff = Date.now() - DEMO_TTL_MS;
  for (const [id, j] of m) if (j.finished_at !== null && j.finished_at < cutoff) m.delete(id);
  while (m.size > DEMO_KEEP) {
    const oldest = [...m.values()].filter((j) => j.finished_at !== null).sort((a, b) => a.started_at - b.started_at)[0];
    if (!oldest) break;
    m.delete(oldest.id);
  }
  return m;
}

export function runningDemo(): DemoJob | null {
  return [...jobs().values()].find((j) => j.finished_at === null) ?? null;
}

export function getDemo(id: string): DemoJob | null {
  return jobs().get(id) ?? null;
}

/** What the API returns for a job (no AbortController, no owner). */
export function publicJob(j: DemoJob) {
  return { job_id: j.id, consultation: j.consultation, state: j.state, progress: j.progress, started_at: j.started_at, finished_at: j.finished_at, error: j.error, result: j.result };
}

export interface DemoDeps {
  client?: WhisperClient;
  /** the main model for the labels; null = rules only. Default: the main model unless LLM_PROVIDER is mock */
  llm?: LlmClient | null;
  env?: Record<string, string | undefined>;
}

function newJob(consultation: string, owner: string, state: DemoState): DemoJob {
  return { id: `real-${randomUUID()}`, consultation, owner, state, progress: null, started_at: Date.now(), finished_at: null, error: null, result: null, cancel: new AbortController() };
}

/**
 * Hold the one run slot, atomically: the check that nothing runs and the registration happen with no await between
 * them, so two requests at the same moment cannot both get it (the GPU is booked once). The slot is a job in state
 * "starting" until launchDemo() or releaseDemo().
 */
export function reserveDemo(consultation: string, owner: string): { job: DemoJob } | { busy: DemoJob } {
  const running = runningDemo();
  if (running) return { busy: running };
  const job = newJob(consultation, owner, "starting");
  jobs().set(job.id, job);
  return { job };
}

/** Give a reserved slot back without running (the service turned out to be unusable): it leaves no trace. */
export function releaseDemo(job: DemoJob): void {
  if (job.state !== "starting") return;
  job.finished_at = Date.now();
  jobs().delete(job.id);
}

/** Run a reserved slot. */
export function launchDemo(job: DemoJob, deps: DemoDeps = {}): DemoJob {
  job.state = "transcribing";
  void runDemo(job, deps).catch((err) => {
    job.state = "failed";
    job.error = "internal_error";
    job.finished_at = Date.now();
    console.warn(`[real-demo] run crashed: ${(err as Error)?.name ?? "error"}`);
  });
  return job;
}

/** Start a run without the slot check (tests; the API uses reserveDemo + launchDemo). */
export function startDemo(consultation: string, owner: string, deps: DemoDeps = {}): DemoJob {
  const job = newJob(consultation, owner, "transcribing");
  jobs().set(job.id, job);
  return launchDemo(job, deps);
}

export function cancelDemo(job: DemoJob): boolean {
  if (job.finished_at !== null) return false;
  job.cancel.abort();
  return true;
}

/** How long a "Whisper usable?" answer is reused for the public GET (one /health probe per window, not per request). */
export const PROBE_CACHE_MS = 5000;
const probeCache = globalThis as unknown as { __rippleRealDemoProbe?: { at: number; problem: Promise<string | null> } };

/**
 * Is the Whisper service usable now? null = yes, else why not (no address or token in it). `fresh` probes now (the
 * POST, before the GPU is booked); otherwise an answer up to PROBE_CACHE_MS old is reused, and concurrent callers
 * share one probe in flight (the public GET cannot make this server hammer the service).
 */
export function demoWhisperProblem(opts: { fresh?: boolean; env?: Record<string, string | undefined> } = {}): Promise<string | null> {
  const now = Date.now();
  const c = probeCache.__rippleRealDemoProbe;
  if (!opts.fresh && c && now - c.at < PROBE_CACHE_MS) return c.problem;
  const problem = new WhisperSpeechProvider({ config: whisperConfig(opts.env ?? process.env) }).probe();
  probeCache.__rippleRealDemoProbe = { at: now, problem };
  return problem;
}

/** Tests: forget the cached probe. */
export function forgetDemoProbe(): void {
  delete probeCache.__rippleRealDemoProbe;
}

export type DemoAnalysis = Pick<DemoResult, "lines" | "speakers" | "cards" | "extraction" | "safety"> & { words: number; blocks: number };

/** Everything after Whisper: who said what, lines, items, cards, the safety step. Exported for tests and offline runs. */
export async function demoFromTranscript(
  c: { id: string },
  segments: WhisperSegment[],
  channels: { doctor: Int16Array; patient: Int16Array; sampleRate: number },
  turns: SpeakerTurn[],
  opts: { llm: LlmClient | null; env?: Record<string, string | undefined>; onState?: (s: DemoState) => void; cancelled?: () => boolean },
): Promise<DemoAnalysis | null> {
  const env = opts.env ?? process.env;
  // 1. who said each word, from the dataset (its annotated turns and its separate channels), never guessed; then lines
  const heard = wordsFromSegments(segments);
  const words = attributeWords(heard, channels.doctor, channels.patient, channels.sampleRate, turns);
  const lines = linesFromWords(c.id, words, channels.doctor, channels.patient, channels.sampleRate, turns);

  // 2. items: rules, plus the main model's checked labels when a real model is configured
  opts.onState?.("extracting");
  const xl = extractLines(lines);
  const ctx = demoContext(c.id);
  const rules = extractItems(xl, 0, ctx);
  let drafts = rules;
  let extraction: DemoResult["extraction"] = { source: "rules", provider: null, model: null, added: 0, rejected: 0, error: null, latency_ms: 0 };
  if (opts.llm) {
    const timeoutMs = Number(env.LLM_EXTRACT_TIMEOUT_MS) > 0 ? Number(env.LLM_EXTRACT_TIMEOUT_MS) : 30_000;
    const res = await extractWithModel(opts.llm, xl, 0, ctx, { timeoutMs });
    extraction = { source: "rules", provider: res.provider, model: res.model, added: 0, rejected: res.rejected.length, error: res.error ? res.error.split(":")[0] : null, latency_ms: res.latencyMs };
    if (!res.error) {
      const merged = mergeDrafts(rules, res.drafts);
      drafts = merged.drafts;
      extraction = { ...extraction, source: "rules+model", added: merged.added.length };
    }
  }
  if (opts.cancelled?.()) return null;

  // 3. cards (one per line, notes only, medicine cards name their medicine), then the safety step
  opts.onState?.("checking");
  const { cards, held } = cardsFromDrafts(lines, drafts);
  const { shown, report } = await checkCards(cards, lines, turns, transcriptOf(segments), held);
  return {
    lines,
    speakers: {
      doctor: lines.filter((l) => l.speaker === "doctor").length,
      patient: lines.filter((l) => l.speaker === "patient").length,
      unknown: lines.filter((l) => l.speaker === "unknown").length,
      method:
        "the dataset itself, word by word: its annotators' per-speaker turn times say who was talking when Whisper heard each word " +
        `(where both were, the speaker's own microphone decides, only when it carries at least ${Math.round(OVERLAP_SHARE * 100)}% of the sound), ` +
        "and the speaker's own microphone must not say otherwise; a word nobody, or both, was clearly saying is marked ?",
    },
    cards: shown,
    extraction,
    safety: report,
    words: heard.filter((w) => !w.block).length,
    blocks: heard.filter((w) => w.block).length,
  };
}

async function runDemo(job: DemoJob, deps: DemoDeps): Promise<void> {
  const env = deps.env ?? process.env;
  const fail = (error: string) => {
    job.state = "failed";
    job.error = error;
    job.finished_at = Date.now();
  };
  const c = MANIFEST.consultations.find((x) => x.id === job.consultation);
  if (!c) return fail("unknown_consultation");
  const root = dataRoot(env);
  let mixed: Uint8Array;
  let doctor: ReturnType<typeof pcm16>;
  let patient: ReturnType<typeof pcm16>;
  let turns: SpeakerTurn[];
  try {
    mixed = readDemoFile(root, fileOf(c, "audio_mixed"));
    doctor = pcm16(readDemoFile(root, fileOf(c, "audio_doctor")));
    patient = pcm16(readDemoFile(root, fileOf(c, "audio_patient")));
    turns = speakerTurns(readDemoFile(root, fileOf(c, "utterances")));
  } catch (e) {
    return fail(e instanceof DemoDataError ? "data_missing" : "data_unreadable");
  }

  // 1. the real Whisper service, whole-recording path (with word timestamps), without the story's hotwords
  const client = deps.client ?? new WhisperClient(whisperConfig(env));
  const t0 = Date.now();
  let segments: WhisperSegment[];
  let model: string | null;
  try {
    const t = await client.transcribeFile(mixed, {
      cancel: job.cancel.signal,
      deadlineMs: Math.max(180_000, 2 * c.duration_s * 1000 + 60_000),
      stallMs: 120_000,
      pollEveryMs: 1000,
      defaultHotwords: false,
      onProgress: (p) => {
        job.progress = { done: p.done, total: p.total };
      },
    });
    segments = t.segments;
    model = t.model;
  } catch (e) {
    return fail(e instanceof WhisperUnavailable ? `whisper_${e.reason}` : "whisper_failed");
  }
  const transcribeMs = Date.now() - t0;
  if (job.cancel.signal.aborted) return fail("whisper_cancelled");
  job.progress = null;

  const llm = deps.llm === undefined ? (mainProviderKind(env) === "mock" ? null : createMainLlm(env)) : deps.llm;
  const out = await demoFromTranscript(c, segments, { doctor: doctor.samples, patient: patient.samples, sampleRate: doctor.sampleRate }, turns, {
    llm,
    env,
    onState: (s) => {
      job.state = s;
    },
    cancelled: () => job.cancel.signal.aborted,
  });
  if (!out) return fail("cancelled");

  job.result = {
    consultation: { id: c.id, day: c.day, consultation: c.consultation, presenting_complaint: c.presenting_complaint, duration_s: c.duration_s },
    whisper: { model, transcribe_ms: transcribeMs, segments: segments.length, words: out.words, segments_without_word_times: out.blocks, built_in_hotwords: false },
    lines: out.lines,
    speakers: out.speakers,
    cards: out.cards,
    extraction: out.extraction,
    safety: out.safety,
  };
  job.state = "done";
  job.finished_at = Date.now();
  const heldN = Object.values(out.safety.held).reduce((a, b) => a + b, 0);
  console.log(`[real-demo] ${c.id}: ${out.lines.length} lines, ${out.cards.length} cards (${out.safety.blocked.length} withheld, ${heldN} labels held), extraction ${out.extraction.source}, ${transcribeMs} ms`);
}
