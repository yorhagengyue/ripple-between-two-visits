/**
 * The checked-in Chinese of the sample visits' fixed English lines, for example accounts (C2 track S, round 2; real-app 12
 * 「医生和药剂师的话只有英文 → 中文翻译过两道检查，不过就只显示英文加『听原声』」). Server-only (node:crypto).
 *
 * Every example account holds the same four sample visits (web/fixtures/visits: v1, v2, p1, and v3 once he plays it), so
 * the doctor's and the pharmacist's English lines are the same fixed sentences for all of them. Translating them again
 * for each account, lazily, the first time an ask happened to quote one, left his visit review, medicine card, blood
 * pressure page and question list in English until then. web/fixtures/translations/example.zh.json holds one translation
 * per line instead, and a line is shown only when BOTH checks of lib/translate hold for it, exactly as for a translation
 * made at run time:
 *
 *   check one (facts)     recomputed here from the two texts every time the file is loaded (facts.ts sameFacts): the same
 *                         numbers, medicine names, dose units, frequencies and times on both sides, a negation kept
 *   check two (meaning)   the checker model's {"same": true} (lib/translate checkMeaning), run once over the file by
 *                         scripts/translate/check-example-set.ts and stamped into the line: who checked, when, and a
 *                         hash of the exact pair of texts it saw, so an edit to either text voids the stamp
 *
 * A line with no stamp, a failed stamp, a stamp for other words, or a failed facts check is not in the set at all: the
 * screen then shows the English and the recording alone, and the run-time path (translateDoctorLine) may still make and
 * check its own. The file as committed has no stamps: it was written offline, and the checker model has not seen it.
 */
import { createHash } from "node:crypto";
import set from "@/fixtures/translations/example.zh.json";
import { sameFacts } from "./facts";

export interface MeaningStamp {
  pass: boolean;
  /** the checker's provider and model, as lib/llm names them */
  checker: string;
  model: string;
  /** when it was checked (ISO) */
  at: string;
  /** pairHash(en, zh) of the texts the checker saw */
  pair: string;
}

export interface ExampleLine {
  id: string;
  visit: string;
  en: string;
  zh: string;
  meaning: MeaningStamp | null;
}

/** The hash a stamp binds to: both texts, trimmed and NFC, in order. */
export function pairHash(en: string, zh: string): string {
  return createHash("sha256").update(`${en.normalize("NFC").trim()}\n${zh.normalize("NFC").trim()}`, "utf8").digest("hex");
}

/** Every line of the file, checked or not (the stamping script and the tests). */
export function exampleSetLines(): ExampleLine[] {
  return (set.lines as unknown as ExampleLine[]).map((l) => ({ ...l, meaning: l.meaning ?? null }));
}

export const EXAMPLE_SET_VERSION: string = set.version;

/** Does this line hold both checks? (see the header) */
export function lineChecked(l: ExampleLine): boolean {
  if (!l.meaning || l.meaning.pass !== true || l.meaning.pair !== pairHash(l.en, l.zh)) return false;
  return sameFacts(l.en, l.zh, "en>zh-Hans").pass;
}

const key = (text: string) => text.normalize("NFC").trim();

/** The lines that hold both checks, by their English words. */
export function checkedExampleLines(lines: readonly ExampleLine[] = exampleSetLines()): Map<string, ExampleLine> {
  const out = new Map<string, ExampleLine>();
  for (const l of lines) if (lineChecked(l)) out.set(key(l.en), l);
  return out;
}

let loaded: Map<string, ExampleLine> | null = null;

/** The checked Chinese of one of the sample visits' English lines, or null (not in the set, or not checked). */
export function exampleZh(text: string): string | null {
  loaded ??= checkedExampleLines();
  return loaded.get(key(text))?.zh ?? null;
}

/** How many lines the committed set has, and how many of them hold both checks (the operator's look, tests). */
export function exampleSetSummary(): { lines: number; checked: number; version: string } {
  loaded ??= checkedExampleLines();
  return { lines: set.lines.length, checked: loaded.size, version: set.version };
}
