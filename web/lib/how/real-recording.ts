/**
 * The /how entry for the real-recording demo (plan item 4, acceptance 4.3): where it is, what it shows, and the
 * dataset credit line exactly as the manifest gives it (CC BY 4.0 section 3(a)(1): creator, source link, licence
 * link, that it was changed). The credit is read from fixtures/real/primock57.manifest.json, never retyped, so the
 * page, the demo and the attribution file cannot drift apart (tests/unit/real checks the three are the same).
 */
import manifest from "@/fixtures/real/primock57.manifest.json";

export const REAL_RECORDING = {
  href: "/backstage/real",
  title: "Try a real recording",
  titleZh: "用真录音试一次",
  lines: [
    "A real recorded conversation instead of the scripted visits: a mock GP consultation from a public research dataset (doctors and staff playing patients, not real patients) through the real Whisper service on the filming laptop, the labelling of the doctor's sentences and the safety checks.",
    "Every card is the doctor's own sentence as Whisper heard it, with its time point; who said it comes from the dataset itself (its annotated speaker turns and its separate doctor and patient channels), not from a guess. Nothing is saved to a session, and the recordings never appear in Mr Tan's story.",
    "It runs on the filming laptop, for the film crew (it needs the speech service there); the dataset's credit is here for everyone.",
  ],
  credit: { en: manifest.credit.en, zh: manifest.credit.zh, sourceUrl: manifest.credit.source_url, licenceUrl: manifest.credit.licence_url, licenceName: manifest.credit.licence_name },
} as const;
