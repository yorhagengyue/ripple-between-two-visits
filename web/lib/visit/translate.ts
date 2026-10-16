/**
 * The doctor's English lines in Chinese, once, at the end of his visit (C2 track F; architecture review 「医生的英文原话：
 * 看诊结束后翻译一次存下来，过两道检查……没过就只显示英文和原声」). Through track S's lib/translate: the main model translates,
 * two checks (the same facts on both sides, then the checker model), and the result is kept per scope and text, so a
 * page never translates: it reads what was kept (cachedTranslation). Without his consent to AI processing nothing is
 * sent. A line that is not translated, or failed a check, shows in English with its recording. Server-only.
 */
import { aiConsent } from "@/lib/safety/consent";
import type { SessionRow, Store, UtteranceRow } from "@/lib/store/types";
import { cachedTranslation, translateDoctorLine, type TranslateDeps } from "@/lib/translate";
import { SUPERSEDED_LANG } from "./state";

const CLINICIANS = new Set(["doctor", "dispenser", "pharmacist"]);

/** The lines worth translating: a clinician's words (as the record has them now) in English. */
export function translatableLines(lines: readonly UtteranceRow[]): UtteranceRow[] {
  return lines.filter((u) => u.lang !== SUPERSEDED_LANG && CLINICIANS.has(u.role) && !/\p{Script=Han}/u.test(u.text) && /[A-Za-z]/.test(u.text));
}

/**
 * Translate the visit's clinician lines once (each text once per scope: lib/translate's cache). Returns how many now have
 * a checked translation. `deps` overrides the models (tests); `aiAllowed` defaults to his consent.
 */
export async function translateVisitLines(store: Store, session: Pick<SessionRow, "id" | "kind" | "owner_user_id">, visitId: string, deps: Partial<TranslateDeps> = {}): Promise<number> {
  const aiAllowed = deps.aiAllowed ?? (await aiConsent(store, session));
  if (!aiAllowed) return 0;
  let done = 0;
  for (const u of translatableLines(await store.listUtterances(session.id, visitId))) {
    const t = await translateDoctorLine(store, session.id, u.text, { ...deps, aiAllowed }).catch(() => null);
    if (t) done++;
  }
  return done;
}

/** The kept Chinese of each line that has one (pages: never calls a model). */
export async function keptTranslations(store: Store, scopeId: string, lines: readonly Pick<UtteranceRow, "id" | "text">[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const english = lines.filter((l) => !/\p{Script=Han}/u.test(l.text));
  // side by side: one round trip for all the lines, not one per line (a page's store answers them from one list,
  // lib/visit/read-once.ts)
  const kept = await Promise.all(english.map((l) => cachedTranslation(store, scopeId, l.text, "en>zh-Hans").catch(() => null)));
  english.forEach((l, i) => {
    const t = kept[i];
    if (t) out.set(l.id, t.text);
  });
  return out;
}
