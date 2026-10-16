/**
 * The example's sample label for the new medicine of today's planned visit (real-app 4.6; track C):
 * fixtures/labels/losartan.png, its expected fields and its mock vision cassette. Read offline from the cassette, the
 * app's own label parser gives the fields in losartan.expected.json (read here only), the same way as the three
 * labels before it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseLabelText } from "@/lib/meds/parse-label";
import { readLabelText } from "@/lib/vision";

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const png = new Uint8Array(readFileSync(path.join(FIXTURES, "labels", "losartan.png")));
const want = JSON.parse(readFileSync(path.join(FIXTURES, "labels", "losartan.expected.json"), "utf8"));

describe("losartan.png, the sample label of the example's follow-up", () => {
  it("reads offline from its cassette and parses to the expected fields", async () => {
    const out = await readLabelText({ bytes: png, mime: "image/png" }, { env: { LLM_PROVIDER: "mock" } });
    expect(out.provider).toBe("mock:vision-cassette");
    const lines = out.text.split("\n");
    expect(lines).toContain("LOSARTAN 50MG TABLET");
    expect(lines).toContain("Take ONE tablet every MORNING");
    expect(lines).toContain("SYNTHETIC DEMO LABEL - NOT A REAL PRESCRIPTION");
    const fields = parseLabelText(out.text, { knownClinics: ["Blossom Family Clinic (fictional)"] });
    for (const k of ["drug_text", "drug_id", "strength", "directions", "slots", "dispensed", "clinic"] as const) expect(fields[k], k).toEqual(want[k]);
    expect(fields.match).toBe("exact");
    expect(fields.indication).toBe(want.indication_on_label);
  });
});
