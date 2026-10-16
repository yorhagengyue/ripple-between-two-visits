/**
 * M3 literal: the amlodipine card's purpose shows R3 (doctor, with visit date and time) first. This pins the text
 * the screen renders under R3 (CardLineView: chipKindText on the tag, chipDetailText under the words), built from
 * the real card view, on D8, D29 and D43 in both UI languages. e2e/m3-meds.spec.ts checks the same strings on
 * the rendered page.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildMedCardView } from "@/lib/meds/card";
import { chipDetailText, chipKindText } from "@/lib/meds/chips";
import { formatClipTime, formatDate } from "@/lib/meds/i18n";
import { setup } from "./helpers";

let blobDir: string;
beforeAll(() => {
  blobDir = mkdtempSync(path.join(tmpdir(), "ripple-m3-chip-"));
});
afterAll(() => rmSync(blobDir, { recursive: true, force: true }));

const R3 =
  "This tablet works quietly. You won't feel it, and you don't feel the high pressure either, but over the years high pressure damages the heart, the brain and the kidneys. So you take it every day, even when you feel fine.";
const SHOWN = {
  "zh-Hans": { tag: "医生说", detail: "2026年9月1日 · 0:20 处 · 代录音" },
  en: { tag: "Doctor said", detail: "1 Sep 2026 · at 0:20 · stand-in voice" },
} as const;

describe("R3 on the amlodipine card: who said it, the visit date and the time point, as rendered", () => {
  for (const day of [8, 29, 43]) {
    it(`D${day}`, async () => {
      const ctx = await setup(blobDir, day);
      const med = (await ctx.store.getMed(ctx.sessionId, "med-amlodipine"))!;
      for (const locale of ["zh-Hans", "en"] as const) {
        const view = await buildMedCardView(ctx.store, ctx.sessionId, med, { day, locale });
        const r3 = view.purpose[0];
        expect(r3.text).toBe(R3);
        expect(r3.sourceId).toBe("visit:v2:R3");
        expect(chipKindText(locale, r3.chip)).toBe(SHOWN[locale].tag);
        expect(chipDetailText(locale, r3.chip)).toBe(SHOWN[locale].detail);
        // then the leaflet, which carries no visit date or time point
        expect(view.purpose[1].chip.kind).toBe("leaflet");
        expect(chipDetailText(locale, view.purpose[1].chip)).not.toMatch(/0:20|2026/);
      }
    });
  }

  it("dates and recording times are formatted the same way everywhere", () => {
    expect(formatDate("zh-Hans", "2026-09-01")).toBe("2026年9月1日");
    expect(formatDate("en", "2026-09-01")).toBe("1 Sep 2026");
    expect(formatClipTime(20767)).toBe("0:20");
    expect(formatClipTime(125_000)).toBe("2:05");
  });
});
