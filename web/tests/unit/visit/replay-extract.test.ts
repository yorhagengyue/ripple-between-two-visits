/**
 * M2 acceptance at the pipeline level: replaying each sample visit through the real pipeline (live, one
 * sentence per chunk; then the whole-visit pass) gives the items, roles, check cards and question list of
 * docs/plan/visits-script.md. The app derives everything from the utterance text, kb/glossary.json and the
 * session's required lines; the answers below come from the answer files, read only here in the test.
 */
import { describe, expect, it } from "vitest";
import { fixtureUtterances } from "@/lib/asr";
import { rowDesc } from "@/components/visit/labels";
import type { CardView, CheckCardView, DocCardView, VisitView } from "@/lib/visit/types";
import { assertAgainstAnswers, checksOn, finalizeReplay, newSession, replayLive, visitItems } from "./helpers";

const R_LINES = {
  R1: "At home, we want it below 135 over 85.",
  R2: "If your reading at home is above 180 on top, or you get chest pain, weakness on one side, or your speech becomes slurred, go to A&E or call 995.",
  R3: "This tablet works quietly. You won't feel it, and you don't feel the high pressure either, but over the years high pressure damages the heart, the brain and the kidneys. So you take it every day, even when you feel fine.",
  R4: "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.",
};

function rCard(view: VisitView, id: string): DocCardView {
  const card = view.cards.find((c): c is DocCardView => c.kind === "doc" && c.anchor === id);
  expect(card, `card for ${id}`).toBeTruthy();
  return card!;
}

describe("replay v1 (D0): every item of the D0 table", () => {
  it("live replay, then the whole-visit pass, match the answer file; R1 and R2 verbatim with their time", async () => {
    const s = await newSession();
    const live = await replayLive(s, "v1");
    await assertAgainstAnswers("v1", live, s.id);
    const view = await finalizeReplay(s, "v1");
    await assertAgainstAnswers("v1", view, s.id);
    expect(view.visit.status).toBe("review");

    const items = await visitItems(s.id, "v1");
    const fixture = fixtureUtterances("v1")!;
    for (const [r, text] of [["R1", R_LINES.R1], ["R2", R_LINES.R2]] as const) {
      const item = items.find((it) => it.required_line === r)!;
      expect(item.id).toBe(`item-${r}`); // the seeded row, now linked to the sentence
      expect(item.text).toBe(text);
      const line = view.lines.find((l) => l.id === item.utterance_ids[0])!;
      expect(line.text).toBe(text);
      expect(line.tStartMs).toBe(fixture.find((f) => f.text === text)!.t_start_ms);
      expect(rCard(view, line.id).quote).toBe(text);
    }
    expect(view.lines.find((l) => l.text === R_LINES.R1)!.tStartMs).toBe(49520);
    expect(view.lines.find((l) => l.text === R_LINES.R2)!.tStartMs).toBe(53681);

    // D0 card variants: measure at home, how to measure, target (R1), warning line (R2)
    const variants = view.cards.flatMap((c) => (c.kind === "doc" ? c.rows.map((r) => r.variant) : []));
    for (const v of ["reading", "measure_home", "how_to_measure", "lifestyle", "target", "threshold", "follow_up"]) expect(variants).toContain(v);
    // consent from the transcript
    expect(view.consent.given).toBe(true);
    expect(view.consent.utteranceId).toBe("v1-u02");

    // the question list after "Come back in about a week": "what counts as normal" answered by R1 itself,
    // his wrist-machine question answered by the doctor's next sentence
    expect(view.qlist?.anchor).toBe("v1-u10");
    const [target, machine] = view.qlist!.items;
    expect(target).toMatchObject({ why: "ripple_target", state: "done" });
    expect(target.answer).toMatchObject({ utteranceId: "v1-u08", text: R_LINES.R1, auto: true });
    expect(machine).toMatchObject({ questionId: "q-machine", state: "done", askedBy: "v1-u11" });
    expect(machine.answer?.text).toBe("手腕的不太准。买一个绑手臂的，upper arm 的。");
    expect(view.counts).toEqual({ doc: 7, toConfirm: 0, chk: 0, q: 2 });
    // "Come back in about a week": an approximate date, never an exact one
    const back = rCard(view, "v1-u10").rows.find((r) => r.variant === "follow_up")!;
    expect(back.dueDate).toBe("2026-08-31");
    expect(rowDesc("zh-Hans", back)).toBe("大约 8月31日");
    expect(rowDesc("en", back)).toBe("About 31 Aug");
  });

  it("the same items when the live transcript arrives in 10-15 s chunks", async () => {
    const s = await newSession();
    const live = await replayLive(s, "v1", 12_000);
    await assertAgainstAnswers("v1", live, s.id);
  });
});

describe("replay v2 (D8): R3 and R4, the first prescription, the check card", () => {
  it("matches the answer file; R3 and R4 verbatim with time and the stand-in clip of R4", async () => {
    const s = await newSession();
    const live = await replayLive(s, "v2");
    await assertAgainstAnswers("v2", live, s.id);
    const view = await finalizeReplay(s, "v2");
    await assertAgainstAnswers("v2", view, s.id);

    const items = await visitItems(s.id, "v2");
    for (const [r, text, id, t] of [
      ["R3", R_LINES.R3, "v2-u06", 20767],
      ["R4", R_LINES.R4, "v2-u08", 43320],
    ] as const) {
      const item = items.find((it) => it.required_line === r)!;
      expect(item.utterance_ids).toEqual([id]);
      expect(item.text).toBe(text);
      const line = view.lines.find((l) => l.id === id)!;
      expect(line).toMatchObject({ text, tStartMs: t });
      const card = rCard(view, id);
      expect(card.quote).toBe(text);
      expect(card.clip).toMatchObject({ standIn: true });
      expect(card.clip!.url).toContain(`/api/visits/v2/clip?u=${id}`);
    }
    // variants the D8 cards need: first prescription, purpose (R3), don't change the dose (R4)
    const variants = view.cards.flatMap((c) => (c.kind === "doc" ? c.rows.map((r) => r.variant) : []));
    for (const v of ["diagnosis", "new_med", "purpose", "dose_rule", "watch", "measure_home", "follow_up", "how_to_take", "missed_dose"]) {
      expect(variants).toContain(v);
    }
    const med = rCard(view, "v2-u05").rows[0];
    expect(med).toMatchObject({ variant: "new_med", drug: "amlodipine", strength: "5 mg", isNew: true });

    // check card on "Around 130": 13 readings, average 144/92, 13 not below R1's 135/85 said on 2026-08-24
    const bp = checksOn(view, "v2-u02")[0] as Extract<CheckCardView, { check: "bp" }>;
    expect(bp).toMatchObject({ check: "bp", recorded: 13, unconfirmed: 1, avgSystolic: 144, avgDiastolic: 92, notBelow: 13 });
    expect(bp.target).toMatchObject({ systolic: 135, diastolic: 85, quote: R_LINES.R1, date: "2026-08-24" });
    expect(view.lines.find((l) => l.id === "v2-u02")!.marks).toContainEqual({ text: "Around 130", kind: "chk" });

    // his own question about the knee painkiller, answered word for word
    const knee = view.qlist!.items.find((q) => q.questionId === "q-knee-1")!;
    expect(knee).toMatchObject({ state: "done", askedBy: "v2-u10" });
    expect(knee.answer?.text).toBe("Which one? Bring it next time and show me. For now, try not to take it every day.");
  });
});

describe("replay v3 (D42): the v3 design", () => {
  it("matches the answer file: check cards, a new medicine, the question list with five answers saved (the extra-tablet question too)", async () => {
    const s = await newSession({ story_day: 42 });
    const live = await replayLive(s, "v3");
    await assertAgainstAnswers("v3", live, s.id);
    const view = await finalizeReplay(s, "v3");
    await assertAgainstAnswers("v3", view, s.id);

    const bp = checksOn(view, "v3-u02")[0] as Extract<CheckCardView, { check: "bp" }>;
    expect(bp).toMatchObject({ recorded: 10, avgSystolic: 140, avgDiastolic: 85, notBelow: 9 });
    expect(bp.target).toMatchObject({ systolic: 135, diastolic: 85 });
    const med = checksOn(view, "v3-u04")[0] as Extract<CheckCardView, { check: "med" }>;
    expect(med).toMatchObject({ total: 33, taken: 29, missed: 4 });
    expect(med.meds.map((m) => m.labelLine)).toEqual(["AMLODIPINE 5MG TABLET"]);
    expect(med.routine?.days).toEqual(["Tue", "Thu"]);
    const note = checksOn(view, "v3-u06")[0] as Extract<CheckCardView, { check: "note" }>;
    expect(note.note).toMatchObject({ text: "今天在大巴窑中心走了一圈，脚踝有点肿。", date: "2026-09-30" });

    const meds = rCard(view, "v3-u07").rows;
    expect(meds.map((r) => [r.drug, r.strength, r.isNew])).toEqual([
      ["amlodipine", "5 mg", false],
      ["losartan", "50 mg", true],
    ]);

    // "blood test ... in two weeks, and come back ... in six weeks": each row gets its own date
    const due = Object.fromEntries(rCard(view, "v3-u08").rows.map((r) => [r.variant, r.dueDate]));
    expect(due).toEqual({ test: "2026-10-19", follow_up: "2026-11-16" });
    // the dates are the app's arithmetic: always written as approximate (v3: "Around 19 Nov")
    const shown = Object.fromEntries(rCard(view, "v3-u08").rows.map((r) => [r.variant, [rowDesc("zh-Hans", r), rowDesc("en", r)]]));
    expect(shown).toEqual({ test: ["大约 10月19日", "About 19 Oct"], follow_up: ["大约 11月16日", "About 16 Nov"] });

    expect(view.qlist!.anchor).toBe("v3-u09");
    const qs = view.qlist!.items;
    expect(qs.map((q) => q.why)).toEqual(["ripple_new_med", "ripple_test", "pattern", "own", "refused_question"]);
    // 10-10 (visits-script D42, Gengyue): he asks the D29 question he was refused, and Dr Lim answers it (v3-u18 / v3-u19)
    expect(qs.map((q) => q.state)).toEqual(["done", "done", "done", "done", "done"]);
    expect(qs.map((q) => q.answer?.utteranceId ?? null)).toEqual(["v3-u11", "v3-u13", "v3-u15", "v3-u17", "v3-u19"]);
    expect(view.qlist!.answered).toBe(5);
    const extra = qs.find((q) => q.questionId === "q-extra-tablet")!;
    expect(extra).toMatchObject({ askedBy: "v3-u18" });
    expect(extra.answer).toMatchObject({
      utteranceId: "v3-u19",
      text: "No, please don't take an extra tablet on your own. One high reading doesn't mean the dose is wrong; I look at all your readings together, and that's why we're adding losartan today.",
      tStartMs: 94772,
    });
    // his "150 over 95" brings up the same readings card as "Around 130" (R1's 135/85, 9 of 10 not below); Dr Lim's next
    // line restates the warning line (a threshold, 180) and how to measure again
    const again = checksOn(view, "v3-u18")[0] as Extract<CheckCardView, { check: "bp" }>;
    expect(again).toMatchObject({ check: "bp", recorded: 10, avgSystolic: 140, avgDiastolic: 85, notBelow: 9 });
    expect(rCard(view, "v3-u20").rows.map((r) => r.variant)).toEqual(["threshold", "how_to_measure"]);
    expect(rCard(view, "v3-u20").clip).toMatchObject({ standIn: true });
    // the losartan line is still only inferred: headed "To confirm", so not counted as a doctor's note
    expect(view.counts).toEqual({ doc: 2, toConfirm: 1, chk: 4, q: 5 });
  });
});

describe("replay p1 (D12 pharmacy)", () => {
  it("matches the answer file", async () => {
    const s = await newSession();
    await replayLive(s, "p1");
    const view = await finalizeReplay(s, "p1");
    await assertAgainstAnswers("p1", view, s.id);
  });
});

describe("never 140 or 130 as a line", () => {
  it("no check card carries 140 or 130 as a comparison number", async () => {
    const s = await newSession({ story_day: 42 });
    for (const v of ["v2", "v3"]) {
      const view = await replayLive(s, v);
      for (const c of view.cards.filter((x): x is CardView => x.kind === "chk")) {
        if (c.kind === "chk" && c.check === "bp") {
          expect([c.target?.systolic, c.target?.diastolic]).toEqual([135, 85]);
          expect(JSON.stringify(c.target)).not.toMatch(/\b1[34]0\b/);
        }
      }
    }
  });
});
