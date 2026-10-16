/**
 * Directive detection for layer 2 (web-app.md 6.3): imperative sentences aimed at the user about taking,
 * stopping, skipping or changing a medicine.
 *
 * Sources of patterns:
 * - web/kb/glossary.json directive_patterns (en and zh), matched as whole patterns, never single characters,
 *   so 这个药是早上吃的 and 可以问药剂师 are not directives.
 * - Two built-in English rules the glossary list does not cover, both limited to medication verbs:
 *   a sentence that starts with one of those verbs ("Take one tablet every morning.", "Please don't change
 *   the dose yourself.") and "you must/need to/have to <verb>". Questions (ending in ?) are never directives.
 *   There is no built-in Chinese rule: the glossary zh list is the whole Chinese vocabulary.
 */
import { getKb } from "@/lib/kb/load";

const MED_VERBS = "take|stop|skip|double|increase|reduce|halve|cut|change|split|crush|chew|swallow|miss";
const IMPERATIVE_START = new RegExp(`^(?:please\\s+)?(?:(?:do\\s+not|don't|dont|never)\\s+)?(?:${MED_VERBS})\\b`, "i");
const YOU_MUST = new RegExp(`\\byou\\s+(?:must|need\\s+to|have\\s+to|ought\\s+to)\\s+(?:${MED_VERBS})\\b`, "i");

let compiled: { en: RegExp[]; zh: RegExp[] } | null = null;

function patterns() {
  if (!compiled) {
    const d = getKb().glossary.directive_patterns;
    compiled = { en: d.en.map((p) => new RegExp(p, "i")), zh: d.zh.map((p) => new RegExp(p)) };
  }
  return compiled;
}

/** Split into sentences on . ! ? 。！？; (keeps the terminal mark on each piece). */
export function splitSentences(text: string): string[] {
  return (text.match(/[^.!?。！？;；]+[.!?。！？;；]?/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

export interface DirectiveHit {
  pattern: string;
  text: string;
}

/** Which directive patterns fire in this text (empty = not a directive). */
export function directiveHits(text: string): DirectiveHit[] {
  const { en, zh } = patterns();
  const hits: DirectiveHit[] = [];
  for (const piece of splitSentences(text.normalize("NFKC"))) {
    if (/[?？]$/.test(piece)) continue;
    // strip a leading attribution ("The leaflet says:", "药袋上写着：") before looking for an imperative start
    const body = piece.replace(/^[^:：]{1,40}[:：]\s*/, "");
    for (const re of en) if (re.test(piece)) hits.push({ pattern: re.source, text: piece });
    for (const re of zh) if (re.test(piece)) hits.push({ pattern: re.source, text: piece });
    if (IMPERATIVE_START.test(piece) || IMPERATIVE_START.test(body)) hits.push({ pattern: "builtin:imperative_start", text: piece });
    if (YOU_MUST.test(piece)) hits.push({ pattern: "builtin:you_must", text: piece });
  }
  return hits;
}

export function isDirective(text: string): boolean {
  return directiveHits(text).length > 0;
}
