/**
 * The example's sample label photos on an account, and their dates (C2 track F, fix round; real-app 4.2, 4.6;
 * web/progress/g.md 「旅程查到的」 4). Server-only (node:fs, node:crypto).
 *
 * The sample photos (web/fixtures/labels/*.png: Mr Tan's amlodipine, ibuprofen, the relative's box, and the losartan
 * the sample visit prescribes) are fixed pictures printed with the template's own dates: losartan 5 Oct 2026 (the
 * template's day 42), amlodipine 1 Sep 2026 (its day 8). Everything else of the example is laid out from the
 * account's own today (lib/story/example.ts: every visit's date, and the seeded labels' dispensed date moved by the
 * same number of days). A label read from a sample photo kept the printed date, so on any account whose today is not
 * the template's the check screen and the medicine card showed a date of the story, earlier than the visit that
 * prescribed the medicine.
 *
 * Now the date read from a sample photo is moved by the same shift as the rest of the example: the account's day 0
 * minus the template's. The losartan sample then says the day the example was laid out for (its sample visit's day),
 * and the amlodipine sample the same day as the example's own seeded amlodipine label.
 *
 * A sample is recognised by its bytes (the sha256 of the fixture file; the add screen uploads the sample's bytes as
 * they are), never by anything the browser says. Only on an account that may use samples (the example account; a
 * filming account): a blank account's photo, and the demo's samples on the template's own dates, are read as printed.
 * The picture itself is not redrawn: its pixels still print the template's date; every word the app shows about the
 * label comes from the fields read here.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { isAccount, samplesAllowed, scopeD0 } from "@/lib/store/scope";
import type { SessionRow } from "@/lib/store/types";
import { loadTemplate } from "@/lib/story/seed";
import { sha256Hex } from "@/lib/vision";
import { ACCOUNT_SAMPLE_LABELS, type AccountSampleLabel } from "./samples";

let known: Map<string, AccountSampleLabel> | null = null;

function sampleHashes(): Map<string, AccountSampleLabel> {
  if (known) return known;
  const out = new Map<string, AccountSampleLabel>();
  for (const name of ACCOUNT_SAMPLE_LABELS) {
    try {
      out.set(sha256Hex(new Uint8Array(readFileSync(path.join(process.cwd(), "fixtures", "labels", `${name}.png`)))), name);
    } catch {
      // a build without that picture simply has no such sample
    }
  }
  known = out;
  return out;
}

/** The sample label these photo bytes are, or null (any photo of his own). */
export function sampleLabelOf(bytes: Uint8Array): AccountSampleLabel | null {
  return sampleHashes().get(sha256Hex(bytes)) ?? null;
}

const DAY_MS = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/**
 * How many days the example's dates are moved on this scope: its day 0 minus the template's (lib/story/example.ts).
 * 0 for a scope that does not use the example's samples as its own (the demo, a blank account).
 */
export function sampleDateShift(scope: SessionRow): number {
  if (!isAccount(scope) || !samplesAllowed(scope, true)) return 0;
  const days = Math.round((utc(scopeD0(scope)) - utc(loadTemplate("mr-tan").meta.d0)) / DAY_MS);
  return Number.isFinite(days) ? days : 0;
}

/** A date printed on a sample label (ISO), as this scope's own day. */
export function sampleDate(scope: SessionRow, printedIso: string): string {
  const shift = sampleDateShift(scope);
  if (!shift || !/^\d{4}-\d{2}-\d{2}$/.test(printedIso)) return printedIso;
  return new Date(utc(printedIso) + shift * DAY_MS).toISOString().slice(0, 10);
}
