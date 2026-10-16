/**
 * The hard rule of web-app.md section 8: a sentence about medicine shows as "inferred" (推断) until he confirms
 * it in the after-visit review or it agrees with a confirmed medicine label; never "Doctor said" before that.
 */
import { describe, expect, it } from "vitest";
import { chipText, cardPrefix, whoText } from "@/components/visit/labels";
import { getMemoryStore } from "@/lib/store/memory";
import { isMedicationText, matchingLabel } from "@/lib/visit/medication";
import { confirmVisit } from "@/lib/visit/pipeline";
import type { DocCardView, LineView, VisitView } from "@/lib/visit/types";
import { finalizeReplay, newSession, replayLive } from "./helpers";

const line = (v: VisitView, id: string): LineView => v.lines.find((l) => l.id === id)!;
const card = (v: VisitView, id: string): DocCardView => v.cards.find((c): c is DocCardView => c.kind === "doc" && c.anchor === id)!;

/** Everything the screen says about who said a line or card, in both languages. */
function shownLabels(display: LineView["display"], role: LineView["role"], medication: boolean): string[] {
  return (["zh-Hans", "en"] as const).flatMap((loc) => [chipText(loc, role, display), whoText(loc, role, display), cardPrefix(loc, role, display, medication)]);
}

describe("which sentences are about medicine", () => {
  it("drug names, dose units and medicine words, from the glossary", () => {
    expect(isMedicationText("Amlodipine, 5 milligrams, one tablet every morning.")).toBe(true);
    expect(isMedicationText("This tablet works quietly. You won't feel it.")).toBe(true);
    expect(isMedicationText("Please don't change the dose yourself.")).toBe(true);
    expect(isMedicationText("陈先生，这是 amlodipine，每天早上吃一粒，饭前饭后都可以。")).toBe(true);
    expect(isMedicationText("I want you to measure at home for one week, morning and evening.")).toBe(false);
    expect(isMedicationText("Take two readings each time and write down the average.")).toBe(false);
    expect(isMedicationText("这个我不认得，你拿去问药剂师。")).toBe(false);
  });

  it("a sentence agrees with a confirmed label only when every slot it says is on the label", async () => {
    const s = await newSession();
    const meds = await getMemoryStore().listMeds(s.id);
    expect(matchingLabel("Amlodipine, 5 milligrams, one tablet every morning.", meds)?.id).toBe("med-amlodipine");
    expect(matchingLabel("陈先生，这是 amlodipine，每天早上吃一粒，饭前饭后都可以。", meds)).toBeNull(); // with or without food: not on the label
    expect(matchingLabel("Please don't change the dose yourself.", meds)).toBeNull();
    expect(matchingLabel("I'll add losartan 50 milligrams, once in the morning.", meds)).toBeNull(); // no label yet
    // not yet dispensed on the visit day itself
    expect(matchingLabel("Amlodipine, 5 milligrams, one tablet every morning.", meds, { before: "2026-09-01" })).toBeNull();
  });
});

describe("live and after the visit", () => {
  it("v2: during the visit the prescription line and R3/R4 are inferred, never 'Doctor said'", async () => {
    // the second visit on its own day (Day 8): the replay is the visit itself, being recorded (on a later day it is a
    // re-watch in a copy, lib/visit/pipeline.ts seedConfirmedBefore, and the visit's own record is not touched)
    const s = await newSession({ story_day: 8 });
    const live = await replayLive(s, "v2");
    for (const id of ["v2-u04", "v2-u05", "v2-u06", "v2-u08", "v2-u12", "v2-u13"]) {
      const l = line(live, id);
      expect(l.medication, id).toBe(true);
      expect(l.display, id).toBe("inferred");
      const labels = shownLabels(l.display, l.role, true);
      expect(labels.join(" | "), id).not.toMatch(/医生说|Doctor said|医生交代|Doctor's note|柜台说|Clinic counter said/);
      expect(labels.join(" | "), id).toMatch(/推断/);
    }
    const c = card(live, "v2-u05");
    expect(c).toMatchObject({ display: "inferred", medication: true });
    expect(cardPrefix("zh-Hans", c.role, c.display, c.medication)).toBe("待确认");
    expect(cardPrefix("en", c.role, c.display, c.medication)).toBe("To confirm");
    // a non-medicine line keeps the v3 heading
    expect(cardPrefix("en", "doctor", line(live, "v2-u09").display, line(live, "v2-u09").medication)).toBe("Doctor's note");
    // a side effect of the tablet just prescribed ("... with this one. If you notice it, tell me.") names no drug,
    // but it is about that medicine: "To confirm", never "Doctor's note"
    const side = card(live, "v2-u07");
    expect(side.rows.map((r) => r.variant)).toContain("watch");
    expect(side).toMatchObject({ display: "inferred", medication: true });
    expect(cardPrefix("zh-Hans", side.role, side.display, side.medication)).toBe("待确认");
    expect(cardPrefix("en", side.role, side.display, side.medication)).toBe("To confirm");
    // the top counter: "Doctor's notes" counts only cards headed as a note; the "To confirm" ones separately
    const toConfirm = live.cards.filter((x) => x.kind === "doc" && x.medication && x.display === "inferred").length;
    expect(toConfirm).toBeGreaterThanOrEqual(4);
    expect(live.counts.toConfirm).toBe(toConfirm);
    expect(live.counts.doc).toBe(live.cards.filter((x) => x.kind === "doc").length - toConfirm);
  });

  it("after the visit the prescription line agrees with the confirmed label; R4 stays inferred until he confirms", async () => {
    const s = await newSession();
    await replayLive(s, "v2");
    const view = await finalizeReplay(s, "v2");
    expect(line(view, "v2-u05").display).toBe("label");
    expect(chipText("zh-Hans", "doctor", "label")).toBe("医生说 · 和药品标签一致");
    const r4 = line(view, "v2-u08");
    expect(r4.display).toBe("inferred");
    expect(chipText("zh-Hans", r4.role, r4.display)).toBe("推断：医生");

    const items = Object.fromEntries(card(view, "v2-u08").rows.map((r) => [r.itemId, "right" as const]));
    const after = await confirmVisit(getMemoryStore(), s, "v2", { mine: ["v2-u02", "v2-u03", "v2-u10", "v2-u14", "v2-u16"], items });
    expect(line(after, "v2-u08")).toMatchObject({ display: "confirmed", roleState: "confirmed", role: "doctor" });
    expect(chipText("zh-Hans", "doctor", "confirmed")).toBe("医生说");
    expect(chipText("en", "doctor", "confirmed")).toBe("Doctor said");
    // lines he did not confirm stay inferred
    expect(line(after, "v2-u06").display).toBe("inferred");
    // his own lines are confirmed as his
    expect(line(after, "v2-u02")).toMatchObject({ role: "patient", roleState: "confirmed" });
  });

  it("without a confirmed label the prescription line stays inferred after the visit", async () => {
    const s = await newSession();
    await getMemoryStore().updateMed(s.id, "med-amlodipine", { status: "awaiting_label" });
    await replayLive(s, "v2");
    const view = await finalizeReplay(s, "v2");
    expect(line(view, "v2-u05").display).toBe("inferred");
  });

  it("v3: the new medicine (no label yet) is inferred until he confirms the item", async () => {
    const s = await newSession({ story_day: 42 });
    await replayLive(s, "v3");
    const view = await finalizeReplay(s, "v3");
    const l = line(view, "v3-u07");
    expect(l).toMatchObject({ display: "inferred", medication: true });
    const c = card(view, "v3-u07");
    const after = await confirmVisit(getMemoryStore(), s, "v3", { mine: [], items: Object.fromEntries(c.rows.map((r) => [r.itemId, "right" as const])) });
    expect(line(after, "v3-u07").display).toBe("confirmed");
    // a line the app took for his but he did not mark becomes unknown
    expect(line(after, "v3-u02")).toMatchObject({ role: "unknown", roleState: "unknown", display: "unknown" });
  });

  it("an item he marks not right stays on the screen, flagged, never confirms the speaker, and asks the doctor (C2)", async () => {
    const s = await newSession();
    await replayLive(s, "v2");
    const view = await finalizeReplay(s, "v2");
    const c = card(view, "v2-u05");
    const after = await confirmVisit(getMemoryStore(), s, "v2", { mine: [], items: Object.fromEntries(c.rows.map((r) => [r.itemId, "wrong" as const])) });
    const kept = after.cards.find((x) => x.anchor === "v2-u05");
    expect(kept).toMatchObject({ kind: "doc", disputed: true, quote: "Amlodipine, 5 milligrams, one tablet every morning." });
    expect(line(after, "v2-u05").roleState).toBe("inferred");
    const asked = (await getMemoryStore().listQuestions(s.id)).filter((q) => q.evidence === "visit_disputed:v2:v2-u05");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ for: "doctor", origin: "own", status: "open", text: "看诊记下的这句，我觉得不对：“Amlodipine, 5 milligrams, one tablet every morning.”" });
  });
});
