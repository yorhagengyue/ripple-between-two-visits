/**
 * The sentence index of the stand-in clips (owner, 10-14: 「我能不能多吃」 plays the doctor's 4-5 seconds that say it, not
 * his whole line): web/fixtures/visits/clips/sentences.json, read by lib/asr/sentences.ts.
 *
 *   cd web && npx tsx scripts/asr/clip-sentences.ts           measure every clip, print the table, write the index
 *   cd web && npx tsx scripts/asr/clip-sentences.ts --check   measure and print; write nothing; exit 1 if the index differs
 *
 * For every stand-in clip (web/fixtures/visits/clips/<visit>-uNN.wav) whose line (web/fixtures/visits/<visit>.utterances.json,
 * the utterance with the clip's id) has two or more sentences, split the way the safety layer quotes them (lib/safety/text.ts
 * sentenceSpans): ffmpeg's silencedetect lists the pauses; the n-1 longest pauses inside the speech are the sentence
 * boundaries of an n-sentence line. Each sentence runs from the end of the pause before it to the start of the pause after
 * it, with MARGIN_MS more on either side (inside the pause: never into a word).
 * A clip is left out of the index, and the reason printed, when:
 *   - the pauses do not give a clean split: a boundary pause shorter than MIN_BOUNDARY_MS, or a pause inside a sentence
 *     longer than CLEAN_RATIO of the shortest boundary pause (so which pause ends a sentence is not clear), or a different
 *     number of long pauses than the line has boundaries;
 *   - a cut point is not in silence (the loudest sample within CUT_WINDOW_MS of it above SILENT_DB);
 *   - a sentence's length does not fit its words: spoken words a second (a number counts a word per digit) outside
 *     RATE_HARD. The table marks a rate outside RATE_PLAUSIBLE (about 2.3-3.5 English words a second) with "!".
 * Nobody listens here: these checks are what stands for listening. Run it again whenever a clip is replaced (a real
 * recording under the same name): the times are this file's.
 *
 * Needs ffmpeg on PATH (or FFMPEG=<path>). Exit codes: 0 done; 1 --check found a difference; 2 setup (no ffmpeg, a clip
 * that is not PCM WAV, a line not found).
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { quoteKey, sentenceSpans } from "@/lib/safety/text";
import { parseWav } from "@/lib/visit/wav";

const WEB = path.resolve(__dirname, "..", "..");
const VISITS = path.join(WEB, "fixtures", "visits");
const CLIPS = path.join(VISITS, "clips");
const INDEX = path.join(CLIPS, "sentences.json");

/** silencedetect: quieter than this (dBFS) for at least MIN_SILENCE_S is a pause */
const NOISE_DB = -45;
const MIN_SILENCE_S = 0.12;
/** how much of the pause each sentence keeps on either side */
const MARGIN_MS = 120;
/** a pause between two sentences is at least this long (the stand-in voice pauses about 850-950 ms there, 400-500 at a comma) */
const MIN_BOUNDARY_MS = 600;
/** any other pause inside the speech is at most this share of the shortest boundary pause */
const CLEAN_RATIO = 0.7;
/** a cut point lies in silence: the loudest sample within CUT_WINDOW_MS of it is below SILENT_DB */
const CUT_WINDOW_MS = 15;
const SILENT_DB = -50;
/** spoken words a second */
const RATE_PLAUSIBLE: [number, number] = [2.3, 3.5];
const RATE_HARD: [number, number] = [1.8, 4.2];

interface Pause {
  start: number;
  end: number;
}
interface Cut {
  text: string;
  startMs: number;
  endMs: number;
}
interface Measured extends Cut {
  /** the speech inside the cut (from the end of the pause before it to the start of the pause after it) */
  speechMs: number;
}
interface Row extends Measured {
  clip: string;
  k: number;
  words: number;
}

function fail(code: number, message: string): never {
  console.error(message);
  process.exit(code);
}

/** The pauses ffmpeg's silencedetect finds (seconds). */
function pausesOf(file: string): Pause[] {
  const ffmpeg = process.env.FFMPEG || "ffmpeg";
  const run = spawnSync(ffmpeg, ["-hide_banner", "-nostats", "-i", file, "-af", `silencedetect=noise=${NOISE_DB}dB:d=${MIN_SILENCE_S}`, "-f", "null", "-"], { encoding: "utf8" });
  if (run.error || run.status !== 0) fail(2, `ffmpeg failed on ${path.basename(file)}: ${run.error?.message ?? run.stderr.slice(-400)}`);
  const out: Pause[] = [];
  let start: number | null = null;
  for (const line of run.stderr.split(/\r?\n/)) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s) start = Math.max(0, Number(s[1]));
    const e = /silence_end:\s*([\d.]+)/.exec(line);
    if (e && start !== null) {
      out.push({ start, end: Number(e[1]) });
      start = null;
    }
  }
  return out;
}

/** Spoken words: a word of letters counts one, a number one a digit ("180" is said as about three words). */
function spokenWords(text: string): number {
  return text
    .split(/\s+/)
    .filter((t) => /[\p{L}\p{N}]/u.test(t))
    .reduce((n, t) => n + (/^\D*\d+\D*$/.test(t) ? t.replace(/\D/g, "").length : 1), 0);
}

/** The loudest sample within `windowMs` of `atMs`, in dBFS (16-bit PCM). */
function peakDbNear(bytes: Uint8Array, atMs: number, windowMs: number): number {
  const w = parseWav(bytes)!;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frame = w.channels * 2;
  const frames = Math.floor(w.dataLength / frame);
  const from = Math.max(0, Math.floor(((atMs - windowMs) * w.sampleRate) / 1000));
  const to = Math.min(frames, Math.ceil(((atMs + windowMs) * w.sampleRate) / 1000));
  let peak = 0;
  for (let f = from; f < to; f++) {
    for (let c = 0; c < w.channels; c++) peak = Math.max(peak, Math.abs(view.getInt16(w.dataOffset + f * frame + c * 2, true)));
  }
  return peak === 0 ? -120 : 20 * Math.log10(peak / 32768);
}

/** The line a clip says: the utterance with the clip's id in its visit's replay file. */
function lineOf(clip: string): string {
  const visit = clip.slice(0, clip.indexOf("-u"));
  const file = path.join(VISITS, `${visit}.utterances.json`);
  const json = JSON.parse(readFileSync(file, "utf8")) as { utterances: { id: string; text: string }[] };
  const u = json.utterances.find((x) => x.id === clip);
  if (!u) fail(2, `${clip}: no utterance with this id in ${path.relative(WEB, file)}`);
  return u.text;
}

/** The cuts of one clip, or why it is left out. */
function measure(clip: string, sentences: string[], bytes: Uint8Array): { cuts: Measured[] } | { leftOut: string } {
  const w = parseWav(bytes);
  if (!w || w.bitsPerSample !== 16) fail(2, `${clip}: not 16-bit PCM WAV`);
  const duration = w.durationMs / 1000;
  const pauses = pausesOf(path.join(CLIPS, `${clip}.wav`));
  // speech runs from the end of a leading pause to the start of a trailing one
  const lead = pauses.find((p) => p.start <= 0.001);
  const trail = pauses.find((p) => p.end >= duration - 0.002);
  const speechStart = lead ? lead.end : 0;
  const speechEnd = trail ? trail.start : duration;
  const inside = pauses.filter((p) => p !== lead && p !== trail && p.start > speechStart && p.end < speechEnd);
  const n = sentences.length;
  if (inside.length < n - 1) return { leftOut: `${inside.length} pauses inside the speech for ${n} sentences` };
  const byLength = [...inside].sort((a, b) => b.end - b.start - (a.end - a.start));
  const bounds = byLength.slice(0, n - 1).sort((a, b) => a.start - b.start);
  const others = byLength.slice(n - 1);
  const shortest = Math.min(...bounds.map((p) => p.end - p.start));
  const longestOther = others.length ? Math.max(...others.map((p) => p.end - p.start)) : 0;
  const longPauses = inside.filter((p) => (p.end - p.start) * 1000 >= MIN_BOUNDARY_MS).length;
  if (shortest * 1000 < MIN_BOUNDARY_MS) return { leftOut: `a boundary pause of ${Math.round(shortest * 1000)} ms (under ${MIN_BOUNDARY_MS})` };
  if (longestOther > CLEAN_RATIO * shortest) return { leftOut: `a pause inside a sentence of ${Math.round(longestOther * 1000)} ms against a boundary pause of ${Math.round(shortest * 1000)} ms` };
  if (longPauses !== n - 1) return { leftOut: `${longPauses} long pauses for ${n - 1} sentence boundaries` };

  const edges = [speechStart, ...bounds.flatMap((p) => [p.start, p.end]), speechEnd];
  const cuts: Measured[] = sentences.map((text, k) => ({
    text,
    startMs: Math.max(0, Math.round(edges[2 * k] * 1000) - MARGIN_MS),
    endMs: Math.min(Math.floor(w.durationMs), Math.round(edges[2 * k + 1] * 1000) + MARGIN_MS),
    speechMs: Math.round((edges[2 * k + 1] - edges[2 * k]) * 1000),
  }));
  for (const c of cuts) {
    for (const at of [c.startMs, c.endMs]) {
      if (at <= 0 || at >= Math.floor(w.durationMs)) continue; // the file's own start and end
      const db = peakDbNear(bytes, at, CUT_WINDOW_MS);
      if (db > SILENT_DB) return { leftOut: `the cut at ${at} ms is not in silence (${db.toFixed(1)} dBFS)` };
    }
    for (const ms of [c.endMs - c.startMs, c.speechMs]) {
      const rate = spokenWords(c.text) / (ms / 1000);
      if (rate < RATE_HARD[0] || rate > RATE_HARD[1]) return { leftOut: `"${c.text}" at ${rate.toFixed(2)} words a second` };
    }
  }
  return { cuts };
}

/** Words a second over `ms`, marked "!" outside RATE_PLAUSIBLE. */
function rateCell(words: number, ms: number): string {
  const rate = words / (ms / 1000);
  return `${rate.toFixed(2)}${rate < RATE_PLAUSIBLE[0] || rate > RATE_PLAUSIBLE[1] ? "!" : " "}`;
}

function main(): void {
  const check = process.argv.includes("--check");
  const clips = readdirSync(CLIPS)
    .filter((f) => /^[a-z0-9]+-u\d{2,3}\.wav$/.test(f))
    .map((f) => f.slice(0, -4))
    .sort();
  const index: Record<string, Cut[]> = {};
  const rows: Row[] = [];
  const notes: string[] = [];
  for (const clip of clips) {
    const sentences = sentenceSpans(lineOf(clip))
      .filter((s) => quoteKey(s.text))
      .map((s) => s.text);
    if (sentences.length < 2) {
      notes.push(`${clip}: one sentence, nothing to cut`);
      continue;
    }
    const got = measure(clip, sentences, new Uint8Array(readFileSync(path.join(CLIPS, `${clip}.wav`))));
    if ("leftOut" in got) {
      notes.push(`${clip}: LEFT OUT (${got.leftOut})`);
      continue;
    }
    index[clip] = got.cuts.map(({ text, startMs, endMs }) => ({ text, startMs, endMs }));
    got.cuts.forEach((c, k) => rows.push({ ...c, clip, k, words: spokenWords(c.text) }));
  }

  // w/s cut: spoken words over the whole cut (what is played, the margins included); w/s speech: over the speech in it
  console.log("clip    s  start ms  end ms  dur ms  speech ms  words  w/s cut  w/s speech  sentence");
  for (const r of rows) {
    console.log(
      `${r.clip.padEnd(7)} ${r.k}  ${String(r.startMs).padStart(8)}  ${String(r.endMs).padStart(6)}  ${String(r.endMs - r.startMs).padStart(6)}  ${String(r.speechMs).padStart(9)}  ${String(r.words).padStart(5)}  ${rateCell(r.words, r.endMs - r.startMs).padStart(7)}  ${rateCell(r.words, r.speechMs).padStart(10)}  ${r.text}`,
    );
  }
  for (const n of notes) console.log(n);

  const json = `${JSON.stringify(index, null, 2)}\n`;
  if (check) {
    let had = "";
    try {
      had = readFileSync(INDEX, "utf8");
    } catch {
      // no index yet
    }
    if (had.replace(/\r\n/g, "\n") !== json) fail(1, `${path.relative(WEB, INDEX)} differs from this measurement (run without --check to write it)`);
    console.log(`${path.relative(WEB, INDEX)} is up to date`);
    return;
  }
  writeFileSync(INDEX, json);
  console.log(`wrote ${path.relative(WEB, INDEX)}: ${Object.keys(index).length} clips`);
}

main();
