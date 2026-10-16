/**
 * The example's sample label photos carry the account's own dates (C2 track F, fix round; real-app 4.2, 4.6, 4.8 rule 2;
 * web/progress/g.md 「旅程查到的」 4; e2e/real/story-leak.spec.ts had it as an expected failure).
 *
 * The pictures are fixed and print the template's dates (losartan 5 Oct 2026, amlodipine 1 Sep 2026). On an example
 * account the date read from one is moved like every other date of the example: the losartan sample says the day the
 * example was laid out for (the day of the sample visit that prescribes it), the amlodipine sample the same day as the
 * example's own seeded amlodipine label (d0 + 8). For three different todays, none of them the template's.
 * A blank account's photo with the same bytes and the demo's samples are read as printed.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { blobPrefix, getBlobStore } from "@/lib/blob";
import { sampleDate, sampleDateShift, sampleLabelOf } from "@/lib/meds/sample-label";
import { ACCOUNT_SAMPLE_LABELS } from "@/lib/meds/samples";
import type { StoredLabel } from "@/lib/meds/types";
import { confirmLabel, readLabel, type MedsDeps } from "@/lib/meds/write";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { setTestClock } from "@/lib/time/now";
import { newSession } from "../visit/helpers";

const store = getMemoryStore();
const FIXTURES = path.join(process.cwd(), "fixtures", "labels");
const png = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, `${name}.png`)));
/** what the pictures print (the template's own dates) */
const PRINTED = { losartan: "2026-10-05", amlodipine: "2026-09-01" };
const saved = { ...process.env };
let deps: MedsDeps;

beforeAll(() => {
  process.env.BLOB_LOCAL_DIR = mkdtempSync(path.join(os.tmpdir(), "ripple-sample-label-"));
  delete process.env.BLOB_DRIVER;
  deps = { store, blob: getBlobStore(), vision: { env: { LLM_PROVIDER: "mock" } }, ask: { costGuard: null, checker: null, checkerReason: "unit test" } };
});
afterAll(() => {
  process.env = saved;
  setTestClock(null);
});

async function account(today: string, space: "example" | "blank"): Promise<SessionRow> {
  setTestClock({ at: `${today}T10:00:00+08:00`, frozen: true });
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `sl${randomUUID().slice(0, 10)}`, password: "a long test password", space });
  return (await store.getSession(a.scope!.id))!;
}

async function read(scope: SessionRow, name: string) {
  const p = `${blobPrefix(scope)}/labels/${name}-${randomUUID().slice(0, 8)}.png`;
  await deps.blob!.putObject("labels", p, png(name), "image/png");
  return readLabel({ sessionId: scope.id, path: p }, deps);
}

describe("a sample photo is known by its bytes", () => {
  it("each sample picture is recognised; any other bytes are not", () => {
    for (const name of ACCOUNT_SAMPLE_LABELS) expect(sampleLabelOf(png(name)), name).toBe(name);
    const other = png("losartan");
    other[other.length - 1] ^= 1;
    expect(sampleLabelOf(other)).toBeNull();
    expect(sampleLabelOf(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("on an example account the sample label's date is the account's own", () => {
  for (const today of ["2026-10-12", "2027-03-15", "2026-12-31"]) {
    it(`today ${today}: the losartan sample says today, the amlodipine sample the day of the example's own amlodipine label`, async () => {
      const scope = await account(today, "example");
      expect(storyDate(scope.d0!, scope.story_day)).toBe(today);

      const losartan = await read(scope, "losartan");
      expect(losartan.fields).toMatchObject({ drug_id: "losartan", strength: "50 mg", directions: "Take ONE tablet every MORNING", dispensed: today });
      expect(losartan.warnings ?? []).not.toContain("date_in_future");
      expect(losartan.warnings ?? []).not.toContain("date_too_old");

      const seeded = (await store.listMeds(scope.id)).find((m) => m.drug_id === "amlodipine")!;
      const seededDate = (seeded.label as StoredLabel).dispensed;
      expect(seededDate).toBe(storyDate(scope.d0!, 8));
      const amlodipine = await read(scope, "amlodipine");
      expect(amlodipine.fields.dispensed).toBe(seededDate);

      // nothing of the template's own dates is left in what the read hands out
      for (const out of [losartan, amlodipine]) {
        const json = JSON.stringify({ fields: out.fields, display_name: out.display_name, warnings: out.warnings, dose_slots: out.dose_slots });
        expect(json).not.toContain(PRINTED.losartan);
        expect(json).not.toContain(PRINTED.amlodipine);
      }
      // the samples without a printed date have none
      expect((await read(scope, "ibuprofen")).fields.dispensed).toBeNull();

      // confirmed, the medicine's label keeps that date
      const done = await confirmLabel({ sessionId: scope.id, readToken: losartan.read_token, origin: "prescription", confirmed: ["drug_text", "strength", "directions", "dispensed", "clinic"], locale: "zh-Hans" }, deps);
      expect((done.med.label as StoredLabel).dispensed).toBe(today);
    });
  }

  it("the shift is the example's own: day 0 minus the template's; none for a blank account or the demo", async () => {
    const example = await account("2027-03-15", "example");
    expect(sampleDate(example, PRINTED.losartan)).toBe("2027-03-15");
    expect(sampleDate(example, PRINTED.amlodipine)).toBe(storyDate(example.d0!, 8));
    const blank = await account("2027-03-15", "blank");
    expect(sampleDateShift(blank)).toBe(0);
    expect(sampleDate(blank, PRINTED.losartan)).toBe(PRINTED.losartan);
    const demo = await newSession({ story_day: 42 });
    expect(sampleDateShift(demo)).toBe(0);
  });
});

describe("read as printed everywhere else", () => {
  it("a blank account's own photo (the same picture, taken with his camera): the printed date", async () => {
    const scope = await account("2026-10-12", "blank");
    expect((await read(scope, "losartan")).fields.dispensed).toBe(PRINTED.losartan);
    expect((await read(scope, "amlodipine")).fields.dispensed).toBe(PRINTED.amlodipine);
  });

  it("the demo, on the template's own days: the printed date", async () => {
    setTestClock(null);
    const demo = await newSession({ story_day: 42 });
    expect((await read(demo, "amlodipine")).fields.dispensed).toBe(PRINTED.amlodipine);
  });
});
