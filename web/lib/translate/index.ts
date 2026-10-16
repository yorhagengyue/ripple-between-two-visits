/**
 * Translations of quoted words (C2 track S; architecture review 「医生的英文原话：看诊结束后翻译一次存下来，过两道检查……没过就只显示
 * 英文和原声」, overnight-loop 10-09, real-app 12 「他的原话照留，下面配英文翻译，标『翻译 · 以原话为准』」). Server-only.
 *
 *   translateDoctorLine(store, scopeId, text, deps)  a doctor's (or pharmacist's) English line in Chinese, for him
 *   translateOwnWords(store, scopeId, text, deps)    his own Chinese words in English, for the brief the doctor reads
 *   cachedTranslation(store, scopeId, text, dir)     what was already made: never calls a model (pages and answers)
 *
 * Once, checked twice, kept:
 *   1. the cache (store.getTranslation, one row per scope, direction and source text): a checked translation is returned
 *      as it is; a rejected one is null at once (a failed check is not paid for twice);
 *   2. no consent to AI processing (deps.aiAllowed false, lib/safety/consent.ts): null, no model call, nothing kept;
 *   3. the main model translates (JSON {"translation"}; faithful, every number and medicine name as written);
 *   4. check one, deterministic (facts.ts sameFacts): the same medicine names, dose units, frequencies, times and numbers
 *      on both sides, a negation kept, the right language, not padded;
 *   5. check two, the checker model (lib/llm createChecker): {"same": true} only, literally, when the meaning did not
 *      change; anything else is a no;
 *   6. kept: "checked" with the text, or "rejected" with the check codes (never the model's words).
 * His day's model spend (C2 round 2; real-app 3.5: US$0.20 a person a day, lib/llm/person-spend.ts): the two calls are
 * counted for him, and once the day's cap is used up nothing is sent: null, nothing kept, a later day tries again.
 * A model or checker that cannot be reached (an error, a timeout, no checker configured, the mock offline) gives null and
 * keeps nothing, so a later call tries again. Every failure is null: the screen then shows the original words (and the
 * recording) alone. The text shown is the translation only, under the original, labelled as a translation: never in
 * place of the original, never the model's word for what a source says.
 */
import { createHash } from "node:crypto";
import { createChecker, createMainLlm } from "@/lib/llm";
import { parseModelJson } from "@/lib/llm/json";
import type { PersonSpend } from "@/lib/llm/person-spend";
import type { LlmClient } from "@/lib/llm/types";
import { hasHan } from "@/lib/safety/text";
import type { Store, TranslationDirection, TranslationRow } from "@/lib/store/types";
import { personSpendFor } from "@/lib/subject/usage";
import { sameFacts, type FactCheck } from "./facts";

export { sameFacts, hasNegation, type FactCheck } from "./facts";
export type { TranslationDirection } from "@/lib/store/types";

export interface TranslateDeps {
  /** his consent to AI processing (lib/safety/consent.ts aiConsent): false means no model call and no translation */
  aiAllowed: boolean;
  /** the translating model; default the main model (createMainLlm) */
  llm?: LlmClient;
  /** the second check; default createChecker(); null: no checker configured, so nothing passes */
  checker?: LlmClient | null;
  /** the caller's deadline */
  signal?: AbortSignal;
  /** his model spend today; default: read and counted here (lib/subject/usage.ts personSpendFor); null: not counted (tests) */
  spend?: PersonSpend | null;
}

export interface Translation {
  direction: TranslationDirection;
  /** the original words */
  source: string;
  /** the translation (checked twice) */
  text: string;
  /** "cache": made before; "model": made by this call */
  from: "cache" | "model";
}

/** Longest text that is translated (a sentence or two of a doctor, a question of his). */
export const MAX_TRANSLATE_CHARS = 600;

export const SYSTEM_TRANSLATE = [
  "You translate one short text inside a medication-companion app for an older patient in Singapore.",
  "Rules:",
  '1. Output JSON only: {"translation": "..."}.',
  "2. Translate faithfully and completely: do not add, drop, soften, explain or summarise anything. Every negation (don't, not, never, no) stays a negation.",
  "3. Keep every number exactly as written (digits stay digits, number words stay number words), and every dose unit, how often and when (morning, at night, twice a week).",
  "4. Keep medicine names exactly as they are written in the source; do not translate or replace them.",
  "5. direction en>zh-Hans: Simplified Chinese in plain everyday words. direction zh-Hans>en: plain English.",
  '6. If you cannot translate it faithfully, answer {"translation": ""}.',
].join("\n");

export const SYSTEM_SAME_MEANING = [
  "You check one translation inside a medication-companion app for an older patient. You get the source text and its translation.",
  'Answer JSON only: {"same": true} only if the translation says exactly what the source says: the same instruction, the same negations, the same numbers, medicine names, doses, how often and when, nothing added and nothing left out.',
  'Otherwise answer {"same": false}. When you are unsure, answer {"same": false}.',
].join("\n");

/** The cache key of a text: sha256 of the trimmed, NFC-normalised words. */
export function translationKey(text: string): string {
  return createHash("sha256").update(text.normalize("NFC").trim(), "utf8").digest("hex");
}

function fromRow(row: TranslationRow, from: Translation["from"]): Translation | null {
  return row.status === "checked" && row.text ? { direction: row.direction, source: row.source_text, text: row.text, from } : null;
}

/** The translation already made for `text` (checked), or null; never calls a model. */
export async function cachedTranslation(store: Store, scopeId: string, text: string, direction: TranslationDirection): Promise<Translation | null> {
  const row = await store.getTranslation(scopeId, direction, translationKey(text));
  return row ? fromRow(row, "cache") : null;
}

/** The text this direction translates: English (no Chinese characters) for en>zh-Hans, Chinese for zh-Hans>en. */
function translatable(text: string, direction: TranslationDirection): boolean {
  const t = text.trim();
  if (!t || t.length > MAX_TRANSLATE_CHARS) return false;
  return direction === "en>zh-Hans" ? !hasHan(t) && /[A-Za-z]/.test(t) : hasHan(t);
}

/** A short code for an error (never its message: a vendor message can echo the text). */
function errorCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[a-z_]{1,32}$/.test(code)) return code;
  const name = (e as { name?: unknown } | null)?.name;
  return name === "AbortError" || name === "TimeoutError" ? "deadline" : "error";
}

async function askModel(llm: LlmClient, direction: TranslationDirection, text: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await llm.chat({
      system: SYSTEM_TRANSLATE,
      user: JSON.stringify({ task: "translate", direction, text }),
      json: true,
      temperature: 0,
      maxTokens: 700,
      purpose: "other",
      signal,
    });
    const body = parseModelJson(res.content) as { translation?: unknown } | null;
    return typeof body?.translation === "string" ? body.translation.trim() : null;
  } catch (e) {
    console.warn(`[translate] the model could not translate (${errorCode(e)})`);
    return null;
  }
}

/**
 * Check two on its own (the run-time path below, and scripts/translate/check-example-set.ts for the checked-in set).
 * true: the checker said the meaning is the same, literally; false: it said no (or anything else); null: unreachable.
 */
export async function checkMeaning(checker: LlmClient, direction: TranslationDirection, source: string, translation: string, signal?: AbortSignal): Promise<boolean | null> {
  try {
    const res = await checker.chat({
      system: SYSTEM_SAME_MEANING,
      user: JSON.stringify({ task: "same_meaning", direction, source, translation }),
      json: true,
      temperature: 0,
      maxTokens: 60,
      purpose: "support",
      signal,
    });
    const body = parseModelJson(res.content) as { same?: unknown } | null;
    if (body && typeof body === "object" && "same" in body) return body.same === true;
    return null;
  } catch (e) {
    console.warn(`[translate] the checker could not be reached (${errorCode(e)})`);
    return null;
  }
}

async function translate(store: Store, scopeId: string, text: string, direction: TranslationDirection, deps: TranslateDeps): Promise<Translation | null> {
  const source = text.normalize("NFC").trim();
  if (!translatable(source, direction)) return null;
  const key = translationKey(source);
  const cached = await store.getTranslation(scopeId, direction, key);
  if (cached) return fromRow(cached, "cache");
  if (!deps.aiAllowed) return null;

  const main = deps.llm ?? createMainLlm();
  // his day's model spend: counted for him; at the cap nothing is sent today (the mock costs nothing and is not counted)
  const spend = deps.spend !== undefined ? deps.spend : main.provider === "mock" ? null : personSpendFor((await store.getSession(scopeId).catch(() => null)) ?? { id: scopeId });
  if (spend && (await spend.capped())) return null;
  try {
    return await translateWith(store, scopeId, source, key, direction, deps, spend ? spend.wrap(main) : main, spend);
  } finally {
    void spend?.settle();
  }
}

async function translateWith(
  store: Store,
  scopeId: string,
  source: string,
  key: string,
  direction: TranslationDirection,
  deps: TranslateDeps,
  llm: LlmClient,
  spend: PersonSpend | null,
): Promise<Translation | null> {
  const out = await askModel(llm, direction, source, deps.signal);
  if (out === null) return null; // not reached: try again another time
  const facts: FactCheck = sameFacts(source, out, direction);
  const keep = async (row: Omit<TranslationRow, "id" | "session_id" | "created_at" | "direction" | "source_sha256" | "source_text">) => {
    const saved = await store.putTranslation(scopeId, { direction, source_sha256: key, source_text: source, ...row });
    return fromRow(saved, "model");
  };
  if (!facts.pass) {
    return keep({ text: null, status: "rejected", checks: { facts: { pass: false, reasons: facts.reasons }, model: llm.provider } });
  }
  const second = deps.checker !== undefined ? deps.checker : createChecker().client;
  const checker = spend ? spend.wrap(second) : second;
  if (!checker) return null; // no second check configured: never shown, nothing kept
  const same = await checkMeaning(checker, direction, source, out, deps.signal);
  if (same === null) return null;
  if (!same) {
    return keep({ text: null, status: "rejected", checks: { facts: { pass: true }, meaning: { pass: false, checker: checker.provider }, model: llm.provider } });
  }
  return keep({ text: out, status: "checked", checks: { facts: { pass: true }, meaning: { pass: true, checker: checker.provider, checkerModel: checker.model }, model: llm.provider } });
}

/** A doctor's (or pharmacist's) English line in Chinese for him (see the header). null: show the English and the recording. */
export function translateDoctorLine(store: Store, scopeId: string, text: string, deps: TranslateDeps): Promise<Translation | null> {
  return translate(store, scopeId, text, "en>zh-Hans", deps);
}

/** His own Chinese words in English for the brief (see the header). null: the brief shows his words untranslated. */
export function translateOwnWords(store: Store, scopeId: string, text: string, deps: TranslateDeps): Promise<Translation | null> {
  return translate(store, scopeId, text, "zh-Hans>en", deps);
}
