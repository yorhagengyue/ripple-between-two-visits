/** The synthetic label photos a judge can use instead of a real label (web/fixtures/labels). Client-safe. */
export const SAMPLE_LABELS = ["amlodipine", "ibuprofen", "relative_box"] as const;
export type SampleLabel = (typeof SAMPLE_LABELS)[number];

/** Where each sample would come from, to preselect on the add screen. */
export const SAMPLE_ORIGIN: Record<SampleLabel, "prescription" | "self_bought" | "relative"> = {
  amlodipine: "prescription",
  ibuprofen: "self_bought",
  relative_box: "relative",
};

/**
 * C2 (real-app 4.6): the example account's own sample, the label of the medicine its sample visit prescribes (losartan;
 * track C's fixtures/labels/losartan.png with its fields and cassette). Offered on an account that may use samples (the
 * example account; a filming account on a crew phone), never in the demo, whose three samples stay as they are.
 */
export const ACCOUNT_ONLY_SAMPLES = ["losartan"] as const;
export const ACCOUNT_SAMPLE_LABELS = [...SAMPLE_LABELS, ...ACCOUNT_ONLY_SAMPLES] as const;
export type AccountSampleLabel = (typeof ACCOUNT_SAMPLE_LABELS)[number];

/** The kb medicine a sample label is of (null: a box nobody identifies). */
export const SAMPLE_DRUG: Record<AccountSampleLabel, string | null> = { amlodipine: "amlodipine", ibuprofen: "ibuprofen", relative_box: null, losartan: "losartan" };

/** The samples an account's add screen offers: the one for the medicine he is photographing first. */
export function accountSamples(forDrug: string | null | undefined): AccountSampleLabel[] {
  const all = [...ACCOUNT_SAMPLE_LABELS];
  return forDrug ? [...all.filter((x) => SAMPLE_DRUG[x] === forDrug), ...all.filter((x) => SAMPLE_DRUG[x] !== forDrug)] : all;
}
