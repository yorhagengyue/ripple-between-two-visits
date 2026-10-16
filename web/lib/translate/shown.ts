/**
 * The checked Chinese under a doctor's or pharmacist's English line, for any page that shows such a line (C2 track S,
 * round 2; real-app 12 「英文原话下面配中文翻译，过数字、药名、单位、频次的确定性检查和核对模型，不过就只显示英文加听原声」; audit
 * au4 row 29: shown on the visit review, on Ask and in chat, missing on the medicine card, the blood pressure page and its
 * relay, the question list's answers). Server-only.
 *
 *   zhLookup(store, scope, { locale })   one read of the scope's kept translations, then a function a page calls for
 *                                        every English line it shows: the Chinese, or null
 *   ensureExampleTranslations(...)       an example account: the checked-in set's lines kept as rows of his own (what
 *                                        every other reader of the cache reads), and with a live model the sample visits'
 *                                        remaining lines translated once in the background
 *
 * A translation is shown only when all of these hold:
 *   - the page is in Chinese (zh-Hans): the English page shows the words as they were said;
 *   - he agreed to AI processing (lib/safety/consent.ts), as it is now: withdrawn means no translation on the page;
 *   - the line has a translation that passed both checks: a "checked" row of his own (lib/translate), or, on an example
 *     account, a line of the checked-in set that holds both checks (example-set.ts). A rejected translation is never
 *     shown, and nothing here calls a model.
 * The translation goes UNDER the original, labelled TRANSLATION_LABEL (「中文翻译，以英文原话为准」): the English words stay
 * the authority, with their source and their recording.
 */
import { mainProviderKind } from "@/lib/llm";
import { aiConsent } from "@/lib/safety/consent";
import { hasHan } from "@/lib/safety/text";
import type { SessionRow, Store } from "@/lib/store/types";
import { checkedExampleLines, EXAMPLE_SET_VERSION, exampleZh, type ExampleLine } from "./example-set";
import { translationKey } from "./index";

export { TRANSLATION_LABEL } from "./label";

/** The Chinese of an English line, or null (see the header). */
export type ZhLookup = (english: string | null | undefined) => string | null;

const NONE: ZhLookup = () => null;

type Scope = Pick<SessionRow, "id" | "kind" | "owner_user_id"> & Partial<Pick<SessionRow, "example_data">>;

export interface ZhOptions {
  locale: string;
  /** his consent to AI processing, when the caller already read it; default: read here */
  aiAllowed?: boolean;
  /** tests: the example set's checked lines (default: the committed file's) */
  exampleLines?: ReadonlyMap<string, ExampleLine>;
}

/** A lookup for one page (see the header). Never throws: a store that cannot be read gives no translations. */
export async function zhLookup(store: Pick<Store, "listTranslations" | "listConsentRecords">, scope: Scope, opts: ZhOptions): Promise<ZhLookup> {
  if (opts.locale !== "zh-Hans") return NONE;
  try {
    const allowed = opts.aiAllowed ?? (await aiConsent(store as Store, scope));
    if (!allowed) return NONE;
    const rows = await store.listTranslations(scope.id);
    const kept = new Map<string, string>();
    for (const r of rows) if (r.direction === "en>zh-Hans" && r.status === "checked" && r.text) kept.set(r.source_sha256, r.text);
    const example = scope.example_data === true;
    return (english) => {
      const text = english?.normalize("NFC").trim();
      if (!text || hasHan(text)) return null;
      const own = kept.get(translationKey(text));
      if (own) return own;
      if (!example) return null;
      return opts.exampleLines ? (opts.exampleLines.get(text)?.zh ?? null) : exampleZh(text);
    };
  } catch {
    return NONE;
  }
}

/** Scopes whose sample visits were handed to the model once by this process (never again: a failure is not retried here). */
const warmed = new Set<string>();

export interface EnsureOptions {
  /** tests: the set's checked lines */
  exampleLines?: ReadonlyMap<string, ExampleLine>;
  /**
   * with a live model and his consent: translate one visit's remaining clinician lines (lib/visit/translate.ts
   * translateVisitLines; passed in so this module does not import the visit module). Left out: nothing is sent.
   */
  translateVisit?: (visitId: string) => Promise<unknown>;
  env?: Record<string, string | undefined>;
}

/**
 * An example account's translations, made to exist before he opens the pages that show them. Safe to repeat; never throws.
 *   1. every line of the checked-in set that holds both checks and is not among his rows yet is kept as a "checked" row
 *      of his own (its checks say where it came from), so the visit review, an ask and his family's view read it like any
 *      other kept translation;
 *   2. with a live model and his consent to AI processing, the sample visits' clinician lines that still have no row
 *      are translated and checked in the background, once per process for this scope.
 * Returns how many rows step 1 wrote.
 */
export async function ensureExampleTranslations(store: Store, scope: Scope & Pick<SessionRow, "example_data">, opts: EnsureOptions = {}): Promise<number> {
  if (!scope.example_data) return 0;
  try {
    const lines = opts.exampleLines ?? checkedExampleLines();
    let wrote = 0;
    if (lines.size) {
      const have = new Set((await store.listTranslations(scope.id)).filter((r) => r.direction === "en>zh-Hans").map((r) => r.source_sha256));
      const missing = [...lines.values()].filter((l) => !have.has(translationKey(l.en)));
      const batch = 6;
      for (let i = 0; i < missing.length; i += batch) {
        await Promise.all(
          missing.slice(i, i + batch).map(async (l) => {
            await store.putTranslation(scope.id, {
              direction: "en>zh-Hans",
              source_sha256: translationKey(l.en),
              source_text: l.en.normalize("NFC").trim(),
              text: l.zh,
              status: "checked",
              checks: {
                facts: { pass: true },
                meaning: { pass: true, checker: l.meaning?.checker ?? null, checkerModel: l.meaning?.model ?? null, at: l.meaning?.at ?? null },
                model: `set:example.zh.json@${EXAMPLE_SET_VERSION}`,
              },
            });
            wrote++;
          }),
        );
      }
    }
    if (opts.translateVisit && !warmed.has(scope.id) && mainProviderKind(opts.env) !== "mock" && (await aiConsent(store, scope))) {
      warmed.add(scope.id);
      const visits = (await store.listVisits(scope.id)).filter((v) => v.status !== "planned" && v.status !== "recording");
      void (async () => {
        for (const v of visits) await opts.translateVisit!(v.id).catch(() => undefined);
      })();
    }
    return wrote;
  } catch {
    return 0;
  }
}
