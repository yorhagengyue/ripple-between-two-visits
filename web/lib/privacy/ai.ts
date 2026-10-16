/**
 * His AI-processing consent, read and changed from 「我 → AI 处理」 (docs/plan/real-app.md 3.11, 2.23; C2 架构审核 信任边界:
 * 「没同意 AI 处理时，不调 DeepSeek」, the model since 10-16 being Hunyuan; C2 track H). Server-only.
 *
 *   aiState(store, userId)          the latest ai_processing decision (records are append-only, oldest first): on only
 *                                   when the last one is "granted", the same rule lib/safety/consent.ts aiConsent uses
 *   setAiConsent(store, input)      appends a new record: "granted" (on) or "withdrawn" (off), with the version and the
 *                                   sha256 of the text his screen showed (track A's CONSENT_TEXTS), method "me_screen";
 *                                   the text itself is published once (consent_text, insert only). Asking for the state
 *                                   he is already in writes nothing. When someone is helping him on his device the
 *                                   record says so (assisted = true and the note; ./consents.ts recordConsent).
 *
 * From the next request on, aiConsent reads the new record: off means no model of any kind sees his ask, the visit's
 * points come from the rules, his label is typed, the doctor's English is not translated.
 */
import type { ConsentLocale } from "@/lib/privacy/consent-texts";
import type { ConsentDecision, ConsentRecordRow, Store } from "@/lib/store/types";
import { recordConsent } from "./consents";

export interface AiState {
  on: boolean;
  /** the latest decision, null when he never made one */
  decision: ConsentDecision | null;
  at: string | null;
  version: string | null;
}

export function aiStateOf(records: readonly ConsentRecordRow[]): AiState {
  const last = [...records].filter((r) => r.kind === "ai_processing").at(-1) ?? null;
  return { on: last?.decision === "granted", decision: last?.decision ?? null, at: last?.created_at ?? null, version: last?.version ?? null };
}

export async function aiState(store: Pick<Store, "listConsentRecords">, userId: string): Promise<AiState> {
  return aiStateOf(await store.listConsentRecords(userId, { kind: "ai_processing" }));
}

export interface SetAiConsent {
  userId: string;
  /** his own scope (the record names it), null for an account without one */
  scopeId: string | null;
  on: boolean;
  /** the language of the text his screen showed */
  locale: ConsentLocale;
  /** someone is helping him on his device (the tap is still his) */
  assisted?: boolean;
}

/**
 * Record his new decision. `store` writes the record (his own account rows); `texts` publishes the consent text once
 * (a global table: the process-wide store). Returns the state now in force and whether a record was written.
 */
export async function setAiConsent(
  stores: { store: Pick<Store, "listConsentRecords" | "addConsentRecord">; texts: Pick<Store, "putConsentText"> },
  input: SetAiConsent,
): Promise<{ state: AiState; changed: boolean }> {
  const before = await aiState(stores.store, input.userId);
  if (before.on === input.on && before.decision !== null) return { state: before, changed: false };
  // off after a yes is a withdrawal; off when he never chose is a no
  const decision: ConsentDecision = input.on ? "granted" : before.decision === null ? "declined" : "withdrawn";
  const row = await recordConsent(
    { records: stores.store, texts: stores.texts },
    {
      user_id: input.userId,
      scope_id: input.scopeId,
      kind: "ai_processing",
      decision,
      locale: input.locale,
      method: "me_screen",
      evidence: { screen: "/p/me/ai" },
      assisted: input.assisted,
    },
  );
  return { state: { on: input.on, decision: row.decision, at: row.created_at, version: row.version }, changed: true };
}
