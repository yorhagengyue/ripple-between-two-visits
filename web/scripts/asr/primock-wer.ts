/**
 * Whisper's word error rate on real voices (plan item 4, acceptance 4.2): the five PriMock57 consultations
 * (github.com/babylonhealth/primock57, CC BY 4.0; mock primary-care consultations, Babylon clinicians and staff
 * playing patients, not real patients) through the REAL Whisper service's whole-recording path (/v1/file, the
 * large-v3 model the app uses for the formal record), scored against the dataset's human transcripts.
 *
 *   cd web && npx tsx scripts/asr/primock-wer.ts                      transcribe the five, score, write the results
 *   options: --out <file>              (default eval/results/primock-wer.json)
 *            --ids a,b                 (default: the five in fixtures/real/primock57.manifest.json)
 *            --rescore                 (score the transcripts saved by an earlier run; no GPU, no service needed)
 *            --with-default-hotwords   (keep the service's built-in hotwords: the sample story's names. Off by
 *                                       default: they are another patient's names and would only pull these
 *                                       consultations' words toward those spellings)
 *
 * Input: web/.data/real/primock57/ (gitignored; `node scripts/data/fetch_primock57.mjs` downloads it), every file
 * checked against the manifest's sha256 first. The mixed mono track (doctor and patient channels summed, as a phone
 * in the room would hear them) is the audio; the reference is both speakers' human utterances in time order.
 * Whisper's segments in time order are the hypothesis. The whole consultation is compared as one word sequence
 * (no per-sentence assignment: in a mixed track overlapping speech makes that noisy).
 *
 * Scoring (lib/asr/wer-normalise.ts), each reported on its own: raw (lib/asr/wer.ts tokens as they are); numbers
 * (written numbers spelled out on both sides: the transcripts write "twenty second", Whisper "22nd"); full (numbers,
 * plus hesitation sounds dropped and "okay" written "ok": the transcripts keep every "um" and "uh"). Per
 * consultation and on average, word-weighted (all errors / all reference words) and the simple mean.
 *
 * Output: the results JSON (no transcript text: counts, rates, timings, the model, and the most frequent error
 * pairs, which are a few words each) and Whisper's segments per consultation in
 * web/.data/real/primock57/whisper/ (gitignored, for --rescore). WHISPER_URL / WHISPER_TOKEN come from the
 * environment or web/.env and are never printed (only "set" / "not set"). Runs the consultations one at a time
 * and waits for the service's whole-recording queue to be empty before each (the GPU is shared with the app).
 *
 * Exit codes: 0 done; 1 the service failed a consultation (the others are still written); 2 setup (data missing,
 * service not configured / not ready, bad arguments).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { WhisperClient, whisperConfig, type WhisperSegment } from "@/lib/asr/whisper";
import { alignWords, averageScores, NORMALISATIONS, scoreAll, topErrors, wordsFor, type Normalisation, type WerScore } from "@/lib/asr/wer-normalise";

export const WEB = path.resolve(__dirname, "..", "..");
const MANIFEST = path.join(WEB, "fixtures", "real", "primock57.manifest.json");
const DEFAULT_OUT = path.join(WEB, "eval", "results", "primock-wer.json");

// ------------------------------------------------------------------ pure pieces (unit-tested)

export interface RefUtterance {
  t_start_ms: number;
  t_end_ms: number;
  speaker: string;
  text: string;
}

/** The human transcript of a consultation as one text: every utterance of both speakers in time order. */
export function referenceText(utterances: RefUtterance[]): string {
  return utterances
    .slice()
    .sort((a, b) => a.t_start_ms - b.t_start_ms || a.t_end_ms - b.t_end_ms)
    .map((u) => u.text.trim())
    .filter(Boolean)
    .join(" ");
}

/** Whisper's transcript as one text: its segments in time order. */
export function hypothesisText(segments: Pick<WhisperSegment, "start_ms" | "end_ms" | "text">[]): string {
  return segments
    .slice()
    .sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms)
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join(" ");
}

const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

export interface ConsultationScore {
  id: string;
  duration_s: number;
  reference_words: number;
  scores: Record<Normalisation, { wer: number; substitutions: number; deletions: number; insertions: number; ref_words: number; hyp_words: number }>;
  /** the most frequent errors under "full" (substitution "ref -> hyp", deletion "-ref", insertion "+hyp") */
  top_errors_full: { error: string; count: number }[];
}

export function scoreConsultation(id: string, durationS: number, utterances: RefUtterance[], segments: Pick<WhisperSegment, "start_ms" | "end_ms" | "text">[]): ConsultationScore & { raw: Record<Normalisation, WerScore> } {
  const ref = referenceText(utterances);
  const hyp = hypothesisText(segments);
  const all = scoreAll(ref, hyp);
  const scores = {} as ConsultationScore["scores"];
  for (const how of NORMALISATIONS) {
    const s = all[how];
    scores[how] = { wer: round(s.wer), substitutions: s.substitutions, deletions: s.deletions, insertions: s.insertions, ref_words: s.refTokens, hyp_words: s.hypTokens };
  }
  return {
    id,
    duration_s: durationS,
    reference_words: all.raw.refTokens,
    scores,
    top_errors_full: topErrors(alignWords(wordsFor(ref, "full"), wordsFor(hyp, "full")), 12),
    raw: all,
  };
}

export function summarise(rows: { raw: Record<Normalisation, WerScore> }[]) {
  const out = {} as Record<Normalisation, { pooled_wer: number; mean_wer: number; substitutions: number; deletions: number; insertions: number; ref_words: number }>;
  for (const how of NORMALISATIONS) {
    const a = averageScores(rows.map((r) => r.raw[how]));
    out[how] = {
      pooled_wer: round(a.pooled.wer),
      mean_wer: round(a.mean_wer),
      substitutions: a.pooled.substitutions,
      deletions: a.pooled.deletions,
      insertions: a.pooled.insertions,
      ref_words: a.pooled.refTokens,
    };
  }
  return out;
}

export function parseArgs(argv: string[]): { out: string; ids: string[] | null; rescore: boolean; defaultHotwords: boolean } {
  const o = { out: DEFAULT_OUT, ids: null as string[] | null, rescore: false, defaultHotwords: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--out") o.out = path.resolve(val());
    else if (a === "--ids") {
      o.ids = val().split(",").map((s) => s.trim()).filter(Boolean);
      for (const id of o.ids) if (!/^day[1-5]_consultation(0[1-9]|1[0-5])$/.test(id)) throw new Error(`not a PriMock57 consultation id: ${id.slice(0, 40)}`);
    } else if (a === "--rescore") o.rescore = true;
    else if (a === "--with-default-hotwords") o.defaultHotwords = true;
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

// ------------------------------------------------------------------ I/O

interface ManifestFile {
  role: string;
  path: string;
  sha256: string;
  bytes: number;
}
interface Manifest {
  dataset: { name: string; commit: string; repository: string };
  licence: { id: string; url: string };
  credit: { en: string };
  local_root: string;
  consultations: { id: string; duration_s: number; files: ManifestFile[] }[];
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function readChecked(root: string, f: ManifestFile): Uint8Array {
  const p = path.join(root, ...f.path.split("/"));
  if (!existsSync(p)) throw new SetupError(`${f.path} is missing under ${path.relative(WEB, root)}: run node scripts/data/fetch_primock57.mjs`);
  const b = new Uint8Array(readFileSync(p));
  if (b.byteLength !== f.bytes || sha256(b) !== f.sha256) throw new SetupError(`${f.path} does not match the manifest (size or sha256): run node scripts/data/fetch_primock57.mjs`);
  return b;
}

class SetupError extends Error {}

/** The service's whole-recording queue is empty (another job would only make this one wait, or be refused). */
async function waitIdle(url: string, maxMs = 600_000): Promise<void> {
  const until = Date.now() + maxMs;
  let said = false;
  for (;;) {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000), cache: "no-store" });
      const h = (await res.json()) as { queue?: { file?: number } };
      if ((h.queue?.file ?? 0) === 0) return;
    } catch {
      /* not answering: the transcription call will say so */
      return;
    }
    if (!said) {
      console.log("  waiting for the service's whole-recording queue to empty (another job is running)");
      said = true;
    }
    if (Date.now() > until) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function main(): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    return 2;
  }
  const envFile = path.join(WEB, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;
  const root = path.join(WEB, ...manifest.local_root.split("/"));
  const cacheDir = path.join(root, "whisper");
  const wanted = args.ids ?? manifest.consultations.map((c) => c.id);
  const chosen = manifest.consultations.filter((c) => wanted.includes(c.id));
  if (chosen.length !== wanted.length) {
    console.error(`error: not in the manifest: ${wanted.filter((id) => !chosen.some((c) => c.id === id)).join(", ")}`);
    return 2;
  }

  const config = whisperConfig(process.env);
  console.log(`WHISPER_URL ${config.url ? "set" : "not set"}, WHISPER_TOKEN ${config.token ? "set" : "not set"}`);
  const client = new WhisperClient(config);
  let health: Awaited<ReturnType<WhisperClient["health"]>> | null = null;
  if (!args.rescore) {
    if (config.problem) {
      console.error(`error: the Whisper service is not configured (${config.problem}); set WHISPER_URL and WHISPER_TOKEN in web/.env`);
      return 2;
    }
    try {
      health = await client.health({ auth: true, timeoutMs: 5000 });
    } catch (e) {
      console.error(`error: the Whisper service does not answer (${(e as { reason?: string }).reason ?? "unreachable"}); start it with services/whisper/start.ps1`);
      return 2;
    }
    if (!health.ready || health.healthy === false || health.tokenOk === false) {
      console.error(`error: the Whisper service is not usable now (status ${health.status}, token ${health.tokenOk === false ? "refused" : "ok"})`);
      return 2;
    }
    console.log(`service: ${health.status}, device ${health.device}, file model ${health.models.file}, built-in hotwords ${args.defaultHotwords ? "on" : "off (default_hotwords=0)"}`);
  }

  const hw = args.defaultHotwords ? "hw-default" : "hw-off";
  const rows: (ReturnType<typeof scoreConsultation> & { transcribe_ms: number | null; model: string | null; segments: number; cached: boolean })[] = [];
  let failures = 0;
  for (const c of chosen) {
    let audio: Uint8Array;
    let utterances: RefUtterance[];
    try {
      audio = readChecked(root, c.files.find((f) => f.role === "audio_mixed")!);
      utterances = (JSON.parse(Buffer.from(readChecked(root, c.files.find((f) => f.role === "utterances")!)).toString("utf8")) as { utterances: RefUtterance[] }).utterances;
    } catch (e) {
      console.error(`error: ${(e as Error).message}`);
      return 2;
    }
    const cacheFile = path.join(cacheDir, `${c.id}.${hw}.json`);
    let segments: WhisperSegment[];
    let model: string | null = null;
    let ms: number | null = null;
    let cached = false;
    if (args.rescore) {
      if (!existsSync(cacheFile)) {
        console.error(`error: no saved transcript for ${c.id} (${path.relative(WEB, cacheFile)}); run without --rescore first`);
        return 2;
      }
      const saved = JSON.parse(readFileSync(cacheFile, "utf8")) as { audio_sha256: string; model: string | null; transcribe_ms: number; segments: WhisperSegment[] };
      if (saved.audio_sha256 !== sha256(audio)) {
        console.error(`error: ${path.relative(WEB, cacheFile)} was made from other audio; run without --rescore`);
        return 2;
      }
      segments = saved.segments;
      model = saved.model;
      ms = saved.transcribe_ms;
      cached = true;
    } else {
      await waitIdle(config.url!);
      console.log(`${c.id}: ${c.duration_s.toFixed(0)} s of audio -> /v1/file`);
      const t0 = Date.now();
      let last = "";
      try {
        const t = await client.transcribeFile(audio, {
          deadlineMs: Math.max(180_000, 2 * c.duration_s * 1000 + 60_000),
          stallMs: 120_000,
          pollEveryMs: 1000,
          defaultHotwords: args.defaultHotwords,
          onProgress: (p) => {
            const now = `${p.status} ${p.done ?? "-"}/${p.total ?? "-"}`;
            if (now !== last && (p.done === null || p.done % 10 === 0 || p.status !== "running")) console.log(`  ${now}`);
            last = now;
          },
        });
        ms = Date.now() - t0;
        segments = t.segments;
        model = t.model;
        mkdirSync(cacheDir, { recursive: true });
        writeFileSync(cacheFile, `${JSON.stringify({ consultation: c.id, audio_sha256: sha256(audio), model, default_hotwords: args.defaultHotwords, transcribe_ms: ms, made_at: new Date().toISOString(), segments }, null, 1)}\n`, "utf8");
      } catch (e) {
        failures += 1;
        console.error(`  ${c.id}: the service did not make the transcript (${(e as { reason?: string }).reason ?? (e as Error).message})`);
        continue;
      }
    }
    const row = scoreConsultation(c.id, c.duration_s, utterances, segments);
    rows.push({ ...row, transcribe_ms: ms, model, segments: segments.length, cached });
    const f = (how: Normalisation) => `${(row.scores[how].wer * 100).toFixed(1)}%`;
    console.log(`  ${row.reference_words} reference words: WER raw ${f("raw")}, numbers ${f("numbers")}, full ${f("full")}${ms ? `; ${(ms / 1000).toFixed(1)} s (${((c.duration_s * 1000) / ms).toFixed(1)}x real time)` : ""}`);
  }

  const summary = summarise(rows);
  const result = {
    schema: "ripple/primock-wer@1",
    made_at: new Date().toISOString(),
    command: `npx tsx scripts/asr/primock-wer.ts${args.rescore ? " --rescore" : ""}${args.defaultHotwords ? " --with-default-hotwords" : ""}`,
    dataset: {
      name: manifest.dataset.name,
      repository: manifest.dataset.repository,
      commit: manifest.dataset.commit,
      licence: manifest.licence.id,
      credit: manifest.credit.en,
      audio: "the mixed mono track of each consultation (doctor + patient channels summed, 16 kHz 16-bit)",
      reference: "the dataset's human transcripts of both speakers, utterances in time order, transcriber tags removed",
    },
    whisper: {
      endpoint: "/v1/file (the app's whole-recording path)",
      model: rows.find((r) => r.model)?.model ?? health?.models.file ?? null,
      device: health?.device ?? null,
      built_in_hotwords: args.defaultHotwords,
      no_diarisation: true,
    },
    scoring: {
      unit: "words of the whole consultation as one sequence (lib/asr/wer.ts tokensEn: lower case, punctuation is a word break)",
      raw: "tokens as they are",
      numbers: "raw + written numbers spelled out on both sides (22nd -> twenty second, 1990 -> nineteen ninety, 2.5 -> two point five)",
      full: "numbers + hesitation sounds dropped on both sides (um, uh, er, erm, hmm, mm, mmm, mhm) + okay written ok",
      pooled_wer: "all errors / all reference words over the consultations",
      mean_wer: "simple mean of the per-consultation WERs",
    },
    consultations: rows.map((r) => ({
      id: r.id,
      duration_s: r.duration_s,
      reference_words: r.reference_words,
      whisper_segments: r.segments,
      transcribe_s: r.transcribe_ms === null ? null : round(r.transcribe_ms / 1000, 1),
      real_time_factor: r.transcribe_ms ? round((r.duration_s * 1000) / r.transcribe_ms, 1) : null,
      from_saved_transcript: r.cached,
      wer: r.scores,
      top_errors_full: r.top_errors_full,
    })),
    average: summary,
    failed: failures,
  };
  mkdirSync(path.dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`\n${rows.length} consultations (${failures} failed) -> ${path.relative(WEB, args.out)}`);
  for (const how of NORMALISATIONS) {
    console.log(`  ${how.padEnd(8)} pooled ${(summary[how].pooled_wer * 100).toFixed(2)}%  mean ${(summary[how].mean_wer * 100).toFixed(2)}%  (S ${summary[how].substitutions}, D ${summary[how].deletions}, I ${summary[how].insertions} / ${summary[how].ref_words} words)`);
  }
  return failures ? 1 : 0;
}

if (/[\\/]scripts[\\/]asr[\\/]primock-wer\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`error: ${(e as Error)?.message ?? e}`);
      process.exit(e instanceof SetupError ? 2 : 1);
    },
  );
}
