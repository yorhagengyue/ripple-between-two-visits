/**
 * The director's story sheet (ux pass 10-13; lib/crew/story-edits.ts): the template's records with the crew's small
 * changes in, and the layout a filming account gets with them (lib/crew/filming-account.ts layoutAtMoment).
 *
 *   no sheet      the layout is the template's, record for record
 *   doses         a morning changed, left out, added after the story's last record; the slot's window still decides
 *                 when it shows
 *   readings      a reading changed, "not measured", left out, added on a day without one
 *   medicines     out of the story (its doses go with it); a bag that waits for his photograph; the bag the template
 *                 leaves waiting read from its prop
 *   notes, questions   one of the story's left out, one of his own added (a question added is open, unanswered)
 *   refusals      a medicine, note or question the story does not have; a reading with one number
 */
import { describe, expect, it } from "vitest";
import { FILMING_D0, layoutAtMoment } from "@/lib/crew/filming-account";
import { applyStoryEdits, countStoryEdits, StoryEditError, storyEditsSchema, storySheetBase, type StoryEdits } from "@/lib/crew/story-edits";
import { buildSeedTables } from "@/lib/story/seed";

const SCOPE = "scope-sheet-test";
const BASE = { session_id: SCOPE, created_at: "2026-08-24T00:00:00.000Z" };
const tables = () => buildSeedTables(SCOPE, BASE.created_at, "mr-tan");
const END = { day: 43, time: "12:00" };

describe("story sheet: the schema", () => {
  it("takes a sheet and refuses what it does not know", () => {
    expect(storyEditsSchema.safeParse({ v: 1 }).success).toBe(true);
    expect(storyEditsSchema.safeParse({ v: 1, doses: [{ med: "med-amlodipine", day: 15, state: "taken" }] }).success).toBe(true);
    expect(storyEditsSchema.safeParse({ v: 2 }).success).toBe(false);
    expect(storyEditsSchema.safeParse({ v: 1, doses: [{ med: "med-amlodipine", day: 99, state: "taken" }] }).success).toBe(false);
    expect(storyEditsSchema.safeParse({ v: 1, meds: [{ id: "med-amlodipine", label: "AMLODIPINE 10MG" }] }).success).toBe(false);
    expect(storyEditsSchema.safeParse({ v: 1, questions: { add: [{ day: 30, text: "x", answer: "yes" }] } }).success).toBe(false);
  });

  it("counts what it changes", () => {
    expect(countStoryEdits(null)).toBe(0);
    expect(countStoryEdits({ v: 1 })).toBe(0);
    expect(
      countStoryEdits({ v: 1, doses: [{ med: "med-amlodipine", day: 15, state: "taken" }], notes: { hide: ["note-d37-1"], add: [{ day: 30, text: "今天走了很久。" }] } }),
    ).toBe(3);
  });
});

describe("story sheet: applied to the template", () => {
  it("no sheet, or an empty one, is the template itself", () => {
    const t = tables();
    expect(applyStoryEdits(t, null, BASE)).toBe(t);
    expect(applyStoryEdits(t, { v: 1 }, BASE)).toBe(t);
    expect(layoutAtMoment(SCOPE, END, { edits: { v: 1 } }).tables).toEqual(layoutAtMoment(SCOPE, END).tables);
  });

  it("changes a morning, leaves one out and adds one after the story's last record", () => {
    const edits: StoryEdits = {
      v: 1,
      doses: [
        { med: "med-amlodipine", day: 15, state: "taken" },
        { med: "med-amlodipine", day: 16, state: "missed", reason: "forgot" },
        { med: "med-amlodipine", day: 17, state: "none" },
        { med: "med-amlodipine", day: 18, state: "no_reply" },
        { med: "med-amlodipine", day: 42, state: "missed", reason: "tai_chi_morning" },
      ],
    };
    const before = tables();
    const t = applyStoryEdits(before, edits, BASE);
    const on = (d: number) => t.dose_logs.find((x) => x.medication_id === "med-amlodipine" && x.day === d);
    expect(on(15)).toMatchObject({ state: "taken", reason: null, reason_text: null, id: before.dose_logs.find((x) => x.day === 15)!.id });
    expect(on(16)).toMatchObject({ state: "missed", reason: "forgot", reason_text: null });
    expect(on(17)).toBeUndefined();
    expect(on(18)).toMatchObject({ state: "unconfirmed", reason: "no_reply" });
    // the reason's own words are the template's
    expect(on(42)).toMatchObject({ state: "missed", reason: "tai_chi_morning", reason_text: "打太极，忘了", slot: "morning" });
    expect(t.dose_logs.length).toBe(before.dose_logs.length); // one out, one in
    expect(before.dose_logs.find((x) => x.day === 15)!.state).toBe("missed"); // the template is not touched
  });

  it("a changed morning shows once its window has closed, like the story's own", () => {
    const edits: StoryEdits = { v: 1, doses: [{ med: "med-amlodipine", day: 29, state: "missed", reason: "forgot" }] };
    const has = (time: string) => layoutAtMoment(SCOPE, { day: 29, time }, { edits }).tables.dose_logs.find((d) => d.day === 29);
    expect(has("09:00")).toBeUndefined();
    expect(has("20:15")).toMatchObject({ state: "missed", reason: "forgot", pre_tracking: true });
  });

  it("changes a reading, marks one not measured, leaves one out and adds one", () => {
    const edits: StoryEdits = {
      v: 1,
      bp: [
        { day: 29, slot: "evening", state: "recorded", systolic: 162, diastolic: 98 },
        { day: 28, slot: "morning", state: "not_measured" },
        { day: 25, slot: "morning", state: "none" },
        { day: 30, slot: "evening", state: "recorded", systolic: 139, diastolic: 84 },
      ],
    };
    const lay = layoutAtMoment(SCOPE, END, { edits }).tables.bp_readings;
    const on = (d: number, slot: string) => lay.find((b) => b.day === d && b.slot === slot);
    expect(on(29, "evening")).toMatchObject({ systolic: 162, diastolic: 98, state: "recorded" });
    expect(on(28, "morning")).toMatchObject({ systolic: null, diastolic: null, state: "unconfirmed" });
    expect(on(25, "morning")).toBeUndefined();
    expect(on(30, "evening")).toMatchObject({ systolic: 139, diastolic: 84, state: "recorded", id: "bp-d30-evening" });
    // the hero's evening reading is there at 8:15pm with the sheet's numbers
    const hero = layoutAtMoment(SCOPE, { day: 29, time: "20:15" }, { edits }).tables.bp_readings.find((b) => b.day === 29 && b.slot === "evening");
    expect(hero).toMatchObject({ systolic: 162, diastolic: 98 });
  });

  it("takes a medicine out of the story with its doses, and sets whether a bag is read", () => {
    const out = layoutAtMoment(SCOPE, END, { edits: { v: 1, meds: [{ id: "med-relative-box", present: false }] } }).tables;
    expect(out.medications.map((m) => m.id)).not.toContain("med-relative-box");

    const gone = layoutAtMoment(SCOPE, END, { edits: { v: 1, meds: [{ id: "med-amlodipine", present: false }] } }).tables;
    expect(gone.medications.map((m) => m.id)).not.toContain("med-amlodipine");
    expect(gone.dose_logs.filter((d) => d.medication_id === "med-amlodipine")).toEqual([]);

    // the scene where he photographs the bag: the tablets were handed over, the bag is not read yet
    const waiting = layoutAtMoment(SCOPE, { day: 8, time: "20:00" }, { edits: { v: 1, meds: [{ id: "med-amlodipine", label: "awaiting" }] } }).tables;
    expect(waiting.medications.find((m) => m.id === "med-amlodipine")).toMatchObject({ label: null, status: "awaiting_label" });

    // the bag the template leaves waiting, read: the words are the prop bag's, nothing typed
    const read = layoutAtMoment(SCOPE, END, { edits: { v: 1, meds: [{ id: "med-losartan", label: "confirmed" }] } }).tables;
    expect(read.medications.find((m) => m.id === "med-losartan")).toMatchObject({
      status: "label_confirmed",
      label: { text: "LOSARTAN 50MG TABLET\nTake ONE tablet every MORNING", drug: "losartan", strength: "50 mg", directions: "Take ONE tablet every MORNING", photo_fixture: "labels/losartan.png" },
    });
  });

  it("leaves out a note and a question of the story, and adds his own", () => {
    const edits: StoryEdits = {
      v: 1,
      notes: { hide: ["note-d37-1"], add: [{ day: 30, text: "今天走了很久，有点喘。" }] },
      questions: { hide: ["q-knee-2"], add: [{ day: 31, text: "量血压前可以喝咖啡吗？" }, { day: 32, text: "Can I cut the tablet?", for: "pharmacist" }] },
    };
    const lay = layoutAtMoment(SCOPE, END, { edits }).tables;
    expect(lay.notes.map((n) => n.id)).not.toContain("note-d37-1");
    expect(lay.notes.find((n) => n.day === 30)).toMatchObject({ text: "今天走了很久，有点喘。", source: "typed", lang: "zh-Hans", app_reply: null });
    expect(lay.questions.map((q) => q.id)).not.toContain("q-knee-2");
    expect(lay.questions.find((q) => q.id === "q-sheet-1")).toMatchObject({
      text: "量血压前可以喝咖啡吗？",
      for: "doctor",
      origin: "own",
      status: "open",
      answer_text: null,
      answer_visit_id: null,
      created_day: 31,
    });
    expect(lay.questions.find((q) => q.id === "q-sheet-2")).toMatchObject({ for: "pharmacist", lang: "en", status: "open" });
    // his own question is there from 8:15pm of its day
    const early = layoutAtMoment(SCOPE, { day: 31, time: "12:00" }, { edits }).tables.questions;
    expect(early.map((q) => q.id)).not.toContain("q-sheet-1");
  });

  it("refuses a sheet the story cannot take, whole", () => {
    const refuse = (edits: StoryEdits) => expect(() => applyStoryEdits(tables(), edits, BASE)).toThrow(StoryEditError);
    refuse({ v: 1, meds: [{ id: "med-nothing", present: false }] });
    refuse({ v: 1, meds: [{ id: "med-ibuprofen", label: "awaiting" }] }); // not a prescription: no bag to photograph
    refuse({ v: 1, doses: [{ med: "med-ibuprofen", day: 20, state: "taken" }] });
    refuse({ v: 1, doses: [{ med: "med-amlodipine", day: 3, state: "taken" }] }); // before he had it
    refuse({ v: 1, bp: [{ day: 20, slot: "morning", state: "recorded", systolic: 140 }] });
    refuse({ v: 1, bp: [{ day: 20, slot: "morning", state: "recorded", systolic: 90, diastolic: 95 }] });
    refuse({ v: 1, notes: { hide: ["note-nothing"] } });
    refuse({ v: 1, questions: { hide: ["q-nothing"] } });
  });
});

describe("story sheet: the story as the sheet lists it", () => {
  it("lists the story's own medicines, mornings, readings, notes and questions", () => {
    const base = storySheetBase(tables(), FILMING_D0);
    expect(base.d0).toBe("2026-08-24");
    expect(base.meds.find((m) => m.id === "med-amlodipine")).toMatchObject({ name: "Amlodipine", label: "confirmed", canAwait: true, canConfirm: true, startDay: 9 });
    expect(base.meds.find((m) => m.id === "med-losartan")).toMatchObject({ label: "awaiting", canAwait: true, canConfirm: true });
    expect(base.meds.find((m) => m.id === "med-ibuprofen")).toMatchObject({ label: null, canAwait: false, canConfirm: false });
    expect(base.doses.find((d) => d.day === 15)).toMatchObject({ med: "med-amlodipine", state: "missed", reason: "tai_chi_morning" });
    expect(base.bp.find((b) => b.day === 29 && b.slot === "evening")).toMatchObject({ state: "recorded", systolic: 150, diastolic: 95 });
    expect(base.bp.find((b) => b.day === 3 && b.slot === "evening")).toMatchObject({ state: "not_measured" });
    expect(base.notes.map((n) => n.id)).toContain("note-d37-1");
    expect(base.questions.find((q) => q.id === "q-extra-tablet")).toMatchObject({ answered: true, for: "doctor" });
  });
});
