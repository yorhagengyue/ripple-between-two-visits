/**
 * Read label photos with Tencent Cloud OCR the way the app does (lib/vision/ocr.ts, lib/vision/index.ts OCR mode), and say
 * per photo: the lines each engine read with their confidence, the transcription, the fields the parser takes from it,
 * the second read, whether lib/vision/check.ts accepts the pair, and how long each engine took. For checking the reader
 * by hand on synthetic labels only (the fixtures, the printed demo labels): it prints what it read. Every run sends real,
 * billed requests (two per photo; Tencent allows 10 a second, so the photos go one after another).
 *
 *   from web/:
 *   npx tsx scripts/ocr/read-labels.ts --keys-from <deploy file> [--out <dir>] [--today 2026-10-16] <image> ...
 *
 * --keys-from reads only TENCENT_SECRET_ID and TENCENT_SECRET_KEY from that NAME=value file (nothing else of it is kept);
 * without it they come from the environment. A key is never printed. Exit 0: every photo was read (accepted or not);
 * 1: a request failed (the code is printed); 2: no key pair, nothing sent.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseLabelText } from "@/lib/meds/parse-label";
import { secondReadFromOcr } from "@/lib/vision";
import { assessLabelReading } from "@/lib/vision/check";
import { OCR_ACCURATE, OCR_BASIC, OCR_MIN_CONFIDENCE, OcrError, ocrKeys, ocrTranscript, readingOrder, recogniseText, type OcrKeys, type OcrResult } from "@/lib/vision/ocr";

const KNOWN_CLINICS = ["Blossom Family Clinic (fictional)"];

function keysFrom(file: string): OcrKeys | null {
  const env: Record<string, string> = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(TENCENT_SECRET_ID|TENCENT_SECRET_KEY)\s*=\s*(.*)$/.exec(raw);
    if (m) env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return ocrKeys(env);
}

/** --keys-from, --out and --today take a value; everything else is a photo. */
function parseArgs(argv: string[]): { flags: Record<string, string>; images: string[] } {
  const flags: Record<string, string> = {};
  const images: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (["--keys-from", "--out", "--today"].includes(argv[i])) flags[argv[i]] = argv[++i] ?? "";
    else images.push(argv[i]);
  }
  return { flags, images };
}

interface EngineRun {
  ms: number;
  error: string | null;
  angle: number | null;
  lines: Array<{ text: string; confidence: number }>;
  transcript: string;
}

async function run(action: typeof OCR_ACCURATE | typeof OCR_BASIC, base64: string, keys: OcrKeys): Promise<{ run: EngineRun; result: OcrResult | null }> {
  const t0 = performance.now();
  try {
    const result = await recogniseText(action, base64, keys);
    const ms = Math.round(performance.now() - t0);
    const ordered = readingOrder(result.detections, result.angle);
    return { result, run: { ms, error: null, angle: result.angle, lines: ordered.map((d) => ({ text: d.DetectedText, confidence: d.Confidence })), transcript: ocrTranscript(result) } };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    const code = e instanceof OcrError ? `${e.code}${e.vendorCode ? ` (${e.vendorCode})` : ""}` : "error";
    return { result: null, run: { ms, error: code, angle: null, lines: [], transcript: "" } };
  }
}

export async function main(argv: string[]): Promise<number> {
  const { flags, images } = parseArgs(argv);
  const keysFile = flags["--keys-from"];
  const keys = keysFile ? keysFrom(keysFile) : ocrKeys(process.env);
  if (!keys) {
    console.error("TENCENT_SECRET_ID and TENCENT_SECRET_KEY are not set (or not in the --keys-from file): nothing sent");
    return 2;
  }
  const outDir = flags["--out"] || path.join(tmpdir(), "ripple-ocr");
  const today = flags["--today"] || new Date().toISOString().slice(0, 10);
  mkdirSync(outDir, { recursive: true });
  const report: unknown[] = [];
  let failed = false;
  for (const file of images) {
    const bytes = readFileSync(file);
    const base64 = bytes.toString("base64");
    const sha8 = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
    const t0 = performance.now();
    const [a, b] = await Promise.all([run(OCR_ACCURATE, base64, keys), run(OCR_BASIC, base64, keys)]);
    const wallMs = Math.round(performance.now() - t0);
    const fields = a.result ? parseLabelText(a.run.transcript, { knownClinics: KNOWN_CLINICS }) : null;
    const second = b.result && a.result ? secondReadFromOcr(b.run.transcript, a.run.transcript) : null;
    const check = fields ? assessLabelReading(fields, second, { today, knownClinics: KNOWN_CLINICS, secondBy: "ocr" }) : null;
    if (a.run.error || b.run.error) failed = true;
    const entry = { file: path.basename(file), bytes: bytes.length, sha8, wallMs, minConfidence: OCR_MIN_CONFIDENCE, accurate: a.run, basic: b.run, fields, second, check };
    report.push(entry);
    console.log(`\n== ${path.basename(file)} (${bytes.length} bytes, ${sha8}) both engines ${wallMs} ms`);
    for (const [name, r] of [["Accurate", a.run], ["Basic", b.run]] as const) {
      console.log(`  ${name}: ${r.ms} ms${r.error ? `  ERROR ${r.error}` : `  angle ${r.angle}`}`);
      for (const l of r.lines) console.log(`    ${String(l.confidence).padStart(3)}  ${l.text}`);
    }
    if (fields) console.log(`  fields: ${JSON.stringify({ drug_text: fields.drug_text, drug_id: fields.drug_id, strength: fields.strength, directions: fields.directions, dispensed: fields.dispensed, clinic: fields.clinic, indication: fields.indication })}`);
    if (second) console.log(`  second: ${JSON.stringify(second)}`);
    if (check) console.log(`  check: ${check.reject ? `REJECT ${check.reject}` : "accepted"}; warnings ${JSON.stringify(check.warnings)}; kept ${JSON.stringify({ directions: check.fields.directions, dispensed: check.fields.dispensed, clinic: check.fields.clinic })}`);
    // one photo after another (Tencent: 10 requests a second)
    await new Promise((r) => setTimeout(r, 300));
  }
  const out = path.join(outDir, `ocr-labels-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nwritten: ${out}`);
  return failed ? 1 : 0;
}

if (process.argv[1] && /read-labels\.ts$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
