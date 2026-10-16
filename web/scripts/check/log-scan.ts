/**
 * Log scan (docs/plan/real-app.md 8.9 「日志扫描：服务端日志里没有种子病人的原话」; C2 track H): reads server log files and
 * fails when any of the synthetic patient's own words, or the doctor's words from his visits, appear in them.
 *
 *   npx tsx scripts/check/log-scan.ts <log file> [<log file> ...] [--also "<words a run typed>"]...
 *
 * The words come from the repository, never from this file: fixtures/timeline.seed.json (Dr Lim's R1-R4, his notes, his
 * questions), fixtures/visits/*.utterances.json (every line of the four visits, the clinic counter's and his own
 * included) and eval/seed.jsonl (the questions he asks in the evaluation). --also adds words a journey typed. Short
 * lines that could occur by chance ("Sure, no problem.") are left out: English from 20 characters, Chinese from 5.
 *
 * Prints one JSON summary on stdout with the matches as { file, line, phrase } where phrase is an id
 * ("seed:R4", "visit:v2-u08", "eval:ex-02", "also:1"), never the words themselves. Exit code: 0 clean, 1 a match,
 * 2 bad usage or an unreadable file.
 * Run it after a journey or the e2e suite on the server's log (scripts/record/serve.mjs writes
 * D:/ripple-c2/rec/serve-<port>.log with --detach).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

interface Phrase {
  id: string;
  /** normalised for comparison */
  key: string;
}

const WEB = path.resolve(__dirname, "..", "..");

/** Lower case, one space between words, curly quotes straightened. */
export function normalise(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const HAN = /[\u3400-\u9fff]/;

/** Long enough not to occur by chance. */
export function distinctive(text: string): boolean {
  const t = text.trim();
  if (HAN.test(t)) return [...t.replace(/[\s，。？！、,.?!：:；;（）()「」]/g, "")].length >= 5;
  return t.length >= 20;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(WEB, file), "utf8")) as T;
}

/** Every distinctive patient or clinician line in the repository's synthetic data. */
export function phrases(also: readonly string[] = []): Phrase[] {
  const out = new Map<string, Phrase>();
  const add = (id: string, text: unknown) => {
    if (typeof text !== "string" || !distinctive(text)) return;
    const key = normalise(text);
    if (!out.has(key)) out.set(key, { id, key });
  };
  const seed = readJson<{
    required_doctor_lines: { id: string; text: string }[];
    notes: { day: number; text_zh?: string; text?: string }[];
    questions: { id: string; text_zh?: string; text?: string }[];
  }>("fixtures/timeline.seed.json");
  for (const r of seed.required_doctor_lines) add(`seed:${r.id}`, r.text);
  for (const n of seed.notes) add(`seed:note:d${n.day}`, n.text_zh ?? n.text);
  for (const q of seed.questions) add(`seed:${q.id}`, q.text_zh ?? q.text);
  const visits = path.join(WEB, "fixtures", "visits");
  for (const f of readdirSync(visits).filter((x) => x.endsWith(".utterances.json")).sort()) {
    const v = readJson<{ utterances: { id: string; text: string }[] }>(path.join("fixtures", "visits", f));
    for (const u of v.utterances) add(`visit:${u.id}`, u.text);
  }
  const evalFile = path.join(WEB, "eval", "seed.jsonl");
  if (existsSync(evalFile)) {
    for (const line of readFileSync(evalFile, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as { id: string; input?: string };
      add(`eval:${row.id}`, row.input);
    }
  }
  also.forEach((t, i) => add(`also:${i + 1}`, t));
  return [...out.values()];
}

export interface ScanHit {
  file: string;
  line: number;
  phrase: string;
}

/** The matches of the phrases in one log text (line numbers from 1). */
export function scanText(file: string, text: string, list: readonly Phrase[]): ScanHit[] {
  const hits: ScanHit[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (!raw) return;
    const line = normalise(raw);
    for (const p of list) if (line.includes(p.key)) hits.push({ file, line: i + 1, phrase: p.id });
  });
  return hits;
}

export function main(argv: string[]): number {
  const files: string[] = [];
  const also: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--also") {
      const t = argv[++i];
      if (!t) {
        process.stderr.write("--also needs the words\n");
        return 2;
      }
      also.push(t);
    } else files.push(argv[i]);
  }
  if (!files.length) {
    process.stderr.write("usage: npx tsx scripts/check/log-scan.ts <log file> [...] [--also \"<words>\"]\n");
    return 2;
  }
  const list = phrases(also);
  const hits: ScanHit[] = [];
  let lines = 0;
  for (const f of files) {
    let text: string;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      process.stderr.write(`cannot read ${f}\n`);
      return 2;
    }
    lines += text.split(/\r?\n/).length;
    hits.push(...scanText(f, text, list));
  }
  process.stdout.write(`${JSON.stringify({ files: files.length, lines, phrases: list.length, clean: hits.length === 0, hits }, null, 1)}\n`);
  return hits.length ? 1 : 0;
}

// run directly (npx tsx scripts/check/log-scan.ts ...), not when a test imports the pure parts
if (/[\\/]scripts[\\/]check[\\/]log-scan\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) process.exit(main(process.argv.slice(2)));
