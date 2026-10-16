/**
 * Chinese generic names next to the English names on his medicine list and cards (C2 track F; real-app 12 「药单和药卡在
 * 英文药名旁边加中文通用名，取自人核过的固定对照，不现翻」). A fixed table, never a model and never made up: each name is
 * one of the kb's own aliases for that drug (kb/drugs.json, kb/glossary.json; tests/unit/meds/zh-names.test.ts holds every
 * entry to that), the generic name a Singapore pharmacy label or HealthHub's Chinese page uses.
 *
 * Status: matched against the kb on 2026-10-10; a pharmacist's review is still to come (as kb/patient_text.json's drafts).
 * A medicine without an entry shows its English name only. Client-safe.
 */
export const ZH_GENERIC: Readonly<Record<string, string>> = {
  amlodipine: "氨氯地平",
  losartan: "氯沙坦",
  metformin: "二甲双胍",
  atorvastatin: "阿托伐他汀",
  aspirin: "阿司匹林",
  paracetamol: "扑热息痛",
  ibuprofen: "布洛芬",
};

/** The Chinese generic name of a kb drug, or null. */
export function zhGenericName(drugId: string | null | undefined): string | null {
  return drugId ? (ZH_GENERIC[drugId] ?? null) : null;
}

export const ZH_GENERIC_REVIEW = { matchedAgainst: "kb/drugs.json aliases", on: "2026-10-10", reviewedBy: null as string | null };
