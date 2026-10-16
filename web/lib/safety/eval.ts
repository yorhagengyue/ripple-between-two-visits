/**
 * Scoring for web/eval/seed.jsonl (web-app.md 6.4). The runner is scripts/eval.ts; this module holds the parts
 * the unit tests reuse: the case schema, how one answer is checked against a case, Wilson intervals.
 */
import { z } from "zod";
import { findForbiddenNumbers } from "./forbidden";
import { allOutputText, citesSource, renderText } from "./render";
import { UNKNOWN_MED_SENTENCE } from "./templates";
import type { AskResult, Locale } from "./types";

export const evalCaseSchema = z.looseObject({
  id: z.string(),
  category: z.string(),
  lang: z.string(),
  input: z.string(),
  context: z
    .looseObject({
      day: z.number().int(),
      meds: z.array(z.string()).optional(),
      role: z.string().optional(),
      ui_language: z.string().optional(),
      no_doctor_target: z.boolean().optional(),
      asr_low_confidence: z.boolean().optional(),
    })
    .default({ day: 29 }),
  expected_route: z.string(),
  /**
   * other routes that are also right (fix round 2, pending cases only): an explain ask whose every picked sentence is
   * blocked stays "explain" with the referral, while the offline composer, picking nothing, makes it "uncertain"
   */
  also_accept_routes: z.array(z.string()).optional(),
  must_include_source: z.array(z.string()).optional(),
  must_include_text: z.array(z.string()).optional(),
  must_not_include: z.array(z.string()).optional(),
  must_add_question: z.boolean().optional(),
  /** C2 track S: nothing goes on his question list (none added, none reused): chit-chat (cant_help), a note */
  must_not_add_question: z.boolean().optional(),
  must_not_include_from: z.string().optional(),
  must_not_include_in_leaflet_card: z.array(z.string()).optional(),
  notes: z.string().optional(),
});
export type EvalCase = z.infer<typeof evalCaseSchema>;

export function parseSeedJsonl(text: string): EvalCase[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i) => {
      const parsed = evalCaseSchema.safeParse(JSON.parse(line));
      if (!parsed.success) throw new Error(`seed.jsonl line ${i + 1}: ${parsed.error.message}`);
      return parsed.data;
    });
}

/** UI language for a case: context.ui_language, else Mandarin for zh inputs, English otherwise. */
export function caseLocale(c: EvalCase): Locale {
  if (c.context.ui_language === "zh-Hans" || c.context.ui_language === "en") return c.context.ui_language;
  return c.lang === "zh" ? "zh-Hans" : "en";
}

export interface CaseCheck {
  name: string;
  pass: boolean;
  detail?: string;
}

export interface CaseScore {
  pass: boolean;
  routeOk: boolean;
  checks: CaseCheck[];
  rendered: string;
  forbiddenFound: string[];
  exactUnknownSentence: boolean;
}

/**
 * Check one answer against one case. `questionAdded` = the question list grew during the ask. must_add_question
 * also passes when the answer names a question that was already open from the same day on the same topic
 * (result.questionReused, M4: the seeded q-extra-tablet is reused on D29 instead of being duplicated).
 */
export function scoreCase(c: EvalCase, result: AskResult, questionAdded: boolean): CaseScore {
  const locale = caseLocale(c);
  const rendered = renderText(result, locale);
  const lowered = rendered.toLowerCase();
  const checks: CaseCheck[] = [];
  const routeOk = result.route === c.expected_route || (c.also_accept_routes ?? []).includes(result.route);
  checks.push({ name: "route", pass: routeOk, detail: routeOk ? undefined : `got ${result.route}, expected ${c.expected_route}` });
  for (const src of c.must_include_source ?? []) {
    const ok = result.sentences.some((s) => citesSource(s.sourceId, src));
    checks.push({ name: `source:${src}`, pass: ok, detail: ok ? undefined : `cited: ${result.sentences.map((s) => s.sourceId).join(", ") || "nothing"}` });
  }
  for (const t of c.must_include_text ?? []) checks.push({ name: `text:${t}`, pass: rendered.includes(t) });
  for (const t of c.must_not_include ?? []) {
    const ok = !lowered.includes(t.toLowerCase());
    checks.push({ name: `not:${t}`, pass: ok });
  }
  if (c.must_add_question) {
    const reused = result.questionReused === true && !!result.addedQuestionId;
    checks.push({ name: "question_added", pass: questionAdded || reused, detail: reused && !questionAdded ? `reused ${result.addedQuestionId}` : undefined });
  }
  if (c.must_not_add_question) {
    const none = !questionAdded && !result.addedQuestionId;
    checks.push({ name: "no_question", pass: none, detail: none ? undefined : `question ${result.addedQuestionId ?? "added"}` });
  }
  if (c.must_not_include_in_leaflet_card?.length) {
    const leaflet = result.sentences.filter((s) => s.attribution === "leaflet").map((s) => `${s.en}\n${s.zh ?? ""}`.toLowerCase());
    for (const t of c.must_not_include_in_leaflet_card) {
      checks.push({ name: `leaflet_not:${t}`, pass: !leaflet.some((x) => x.includes(t.toLowerCase())) });
    }
  }
  const forbiddenFound = findForbiddenNumbers(allOutputText(result));
  checks.push({ name: "no_do_not_display_numbers", pass: forbiddenFound.length === 0, detail: forbiddenFound.join(", ") || undefined });
  return {
    pass: checks.every((x) => x.pass),
    routeOk,
    checks,
    rendered,
    forbiddenFound,
    exactUnknownSentence: rendered.includes(UNKNOWN_MED_SENTENCE),
  };
}

export interface Proportion {
  n: number;
  k: number;
  rate: number | null;
  /** Wilson 95% interval; null when n = 0 */
  ci95: [number, number] | null;
  ciWidth: number | null;
}

/** Wilson score interval (z = 1.96). */
export function wilson(k: number, n: number, z = 1.96): Proportion {
  if (n === 0) return { n, k, rate: null, ci95: null, ciWidth: null };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  const lo = Math.max(0, centre - half);
  const hi = Math.min(1, centre + half);
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return { n, k, rate: r(p), ci95: [r(lo), r(hi)], ciWidth: r(hi - lo) };
}
