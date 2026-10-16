/**
 * Every consent text in one place, and the one way to write a consent record (docs/plan/real-app.md 3.11: 「每条带 kind、
 * decision、version、text_sha256、method、evidence、assisted、at」, 「同意文字的定稿……版本加文字……写进 consent_text，只插不改；测试
 * 核对代码里的哈希和库里的一致」, 「家人代操作时……assisted = true，注明『在他的设备上，有人协助』」). C2 track H. Server-only.
 *
 * The words themselves stay where their screens are, and this module gathers them:
 *   terms_privacy, ai_processing, example_data     track A's sign-up texts   ./consent-texts.ts CONSENT_TEXTS
 *   family_accept, family_share                    track D's family texts    lib/care/consent.ts FAMILY_CONSENT_TEXTS
 *   visit_recording                                track F's card for the doctor (English only; the record's hash is
 *                                                  the sha256 of that one sentence)   lib/visit/consent.ts
 *   retention_keep_forever, family_reset_helper    ./consent-texts-more.ts
 *
 *   ALL_CONSENT_TEXTS                  every published text (every version, every locale)
 *   currentConsent(kind, locale)       the text in force now (a kind with one language gives that one)
 *   consentStamp(kind, locale)         { version, text_sha256 } for a record: any writer can stamp, no store needed
 *   assistedEvidence(assisted)         the note a record keeps when someone helped him on his device
 *   publishConsentTexts(store)         writes every text to consent_text (insert only, so it can run any number of
 *                                      times): the hourly job and this module's own writer call it, so a hash a record
 *                                      carries always has its text row, whoever wrote the record
 *   recordConsent(stores, input)       a consent record with its stamp, its assisted note and its text published first
 *   unpublishedConsents(store, rows)   the records whose hash has no text row (the check behind the tests)
 */
import { createHash } from "node:crypto";
import { FAMILY_CONSENT_TEXTS } from "@/lib/care/consent";
import type { ConsentDecision, ConsentKind, ConsentRecordRow, Store } from "@/lib/store/types";
import { CONSENT_CARD_EN, CONSENT_CARD_VERSION } from "@/lib/visit/consent";
import { CONSENT_TEXTS, CURRENT_CONSENT_VERSIONS, type ConsentLocale, type ConsentText } from "./consent-texts";
import { MORE_CONSENT_TEXTS, MORE_CONSENT_VERSIONS } from "./consent-texts-more";

/** Every consent kind there is (the type check below fails when lib/store/types.ts gains one that is missing here). */
export const CONSENT_KINDS = [
  "terms_privacy",
  "ai_processing",
  "visit_recording",
  "family_share",
  "family_accept",
  "family_reset_helper",
  "retention_keep_forever",
  "example_data",
] as const satisfies readonly ConsentKind[];
type Missing = Exclude<ConsentKind, (typeof CONSENT_KINDS)[number]>;
const allKindsListed: Missing extends never ? true : never = true;
void allKindsListed;

/** The card he shows the doctor: one English sentence, hashed as it is (lib/visit/pipeline.ts consentCardSha). */
const VISIT_CARD: ConsentText = {
  kind: "visit_recording",
  version: CONSENT_CARD_VERSION,
  locale: "en",
  title: "",
  paragraphs: [CONSENT_CARD_EN],
  text: CONSENT_CARD_EN,
  sha256: createHash("sha256").update(CONSENT_CARD_EN, "utf8").digest("hex"),
};

/** Every published consent text: all kinds, all versions, all locales. */
export const ALL_CONSENT_TEXTS: readonly ConsentText[] = [...CONSENT_TEXTS, ...FAMILY_CONSENT_TEXTS, VISIT_CARD, ...MORE_CONSENT_TEXTS];

/** The version each kind's text is at now. */
export function currentConsentVersion(kind: ConsentKind): string {
  switch (kind) {
    case "terms_privacy":
    case "ai_processing":
    case "example_data":
      return CURRENT_CONSENT_VERSIONS[kind];
    case "retention_keep_forever":
    case "family_reset_helper":
      return MORE_CONSENT_VERSIONS[kind];
    case "visit_recording":
      return CONSENT_CARD_VERSION;
    case "family_accept":
    case "family_share": {
      // track D keeps one version for both of its texts; the newest published entry of the kind is the current one
      const mine = FAMILY_CONSENT_TEXTS.filter((t) => t.kind === kind);
      return mine[mine.length - 1].version;
    }
  }
}

/** One published text, or null (an unknown kind, version or locale). */
export function consentTextOf(kind: ConsentKind, version: string, locale: string): ConsentText | null {
  return ALL_CONSENT_TEXTS.find((t) => t.kind === kind && t.version === version && t.locale === locale) ?? null;
}

/** The text in force now for a kind, in `locale` when the kind has it, else in the language it exists in. */
export function currentConsent(kind: ConsentKind, locale: ConsentLocale): ConsentText {
  const version = currentConsentVersion(kind);
  const t = consentTextOf(kind, version, locale) ?? ALL_CONSENT_TEXTS.find((x) => x.kind === kind && x.version === version);
  if (!t) throw new Error(`no ${kind} consent text ${version}`);
  return t;
}

export interface ConsentStamp {
  version: string;
  text_sha256: string;
  /** the language of the text that was hashed */
  locale: ConsentLocale;
}

/** What a consent record must carry about the words he saw. Pure: any writer can call it. */
export function consentStamp(kind: ConsentKind, locale: ConsentLocale): ConsentStamp {
  const t = currentConsent(kind, locale);
  return { version: t.version, text_sha256: t.sha256, locale: t.locale };
}

/** The note on a record made while someone helped him on his own device (real-app 3.11, in the design's words). */
export const ASSISTED_NOTE = "在他的设备上，有人协助";

/** The evidence fields for a record: nothing when he acted alone, the note when he was helped (assisted = true goes with it). */
export function assistedEvidence(assisted: boolean | undefined): { assisted_note?: string } {
  return assisted === true ? { assisted_note: ASSISTED_NOTE } : {};
}

/**
 * Write every consent text to consent_text. Insert only: a text already there with the same hash is left alone, so this
 * can run at any time; a text that changed without a new version is refused by the store and counted as failed.
 */
export async function publishConsentTexts(store: Pick<Store, "putConsentText">): Promise<{ texts: number; failed: number }> {
  const out = { texts: 0, failed: 0 };
  for (const t of ALL_CONSENT_TEXTS) {
    try {
      await store.putConsentText({ kind: t.kind, version: t.version, locale: t.locale, sha256: t.sha256, text: t.text });
      out.texts += 1;
    } catch {
      out.failed += 1;
    }
  }
  return out;
}

export interface ConsentInput {
  user_id: string;
  /** his own scope (the record names it), null for an account without one */
  scope_id?: string | null;
  kind: ConsentKind;
  decision: ConsentDecision;
  /** the language of the text his screen showed */
  locale: ConsentLocale;
  /** how he said it: "me_screen", "tap", ... */
  method: string;
  evidence?: Record<string, unknown>;
  /** someone was helping him on his device; the tap was still his */
  assisted?: boolean;
}

/**
 * One consent record, complete: the version and sha256 of the text in force, the text itself published first, the
 * assisted flag with its note. `records` is the store that may write his rows (his own scoped store, or the process-wide
 * one); `texts` publishes to consent_text, a global table (the process-wide store).
 */
export async function recordConsent(
  stores: { records: Pick<Store, "addConsentRecord">; texts: Pick<Store, "putConsentText"> },
  input: ConsentInput,
): Promise<ConsentRecordRow> {
  const text = currentConsent(input.kind, input.locale);
  await stores.texts.putConsentText({ kind: text.kind, version: text.version, locale: text.locale, sha256: text.sha256, text: text.text });
  return stores.records.addConsentRecord({
    user_id: input.user_id,
    scope_id: input.scope_id ?? null,
    kind: input.kind,
    decision: input.decision,
    version: text.version,
    text_sha256: text.sha256,
    method: input.method,
    evidence: { ...(input.evidence ?? {}), locale: text.locale, ...assistedEvidence(input.assisted) },
    assisted: input.assisted === true,
  });
}

/**
 * The records whose words cannot be shown again: no version or hash at all, or a hash with no row in consent_text
 * (consent_record has no locale column, so the row is looked for in every language of that kind and version).
 */
export async function unpublishedConsents(
  store: Pick<Store, "getConsentText">,
  records: readonly Pick<ConsentRecordRow, "id" | "kind" | "version" | "text_sha256">[],
): Promise<{ id: string; kind: ConsentKind; why: "no_stamp" | "no_text_row" }[]> {
  const out: { id: string; kind: ConsentKind; why: "no_stamp" | "no_text_row" }[] = [];
  for (const r of records) {
    if (!r.version || !r.text_sha256) {
      out.push({ id: r.id, kind: r.kind, why: "no_stamp" });
      continue;
    }
    let found = false;
    for (const locale of ["zh-Hans", "en"]) {
      const row = await store.getConsentText(r.kind, r.version, locale);
      if (row && row.sha256 === r.text_sha256) {
        found = true;
        break;
      }
    }
    if (!found) out.push({ id: r.id, kind: r.kind, why: "no_text_row" });
  }
  return out;
}
