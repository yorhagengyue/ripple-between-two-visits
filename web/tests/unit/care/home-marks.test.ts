/**
 * Her home's marks (C2 track D, lib/care/home.ts): a window that closed before he started using Ripple is 「没有记录」,
 * never 「没回」 and never 「今天没有要记的药」.
 */
import { describe, expect, it } from "vitest";
import { headline } from "@/lib/care/copy";
import { cellMark, cellReason, dayMark, slotView, todayStatus } from "@/lib/care/home";
import type { SlotView } from "@/lib/care/home-types";
import type { DoseCell, SlotDay } from "@/lib/daily/cells";

const slot = (marks: SlotView["cells"][number]["mark"][]): SlotView => ({
  slot: "morning",
  first: "08:45",
  second: "09:15",
  closes: "09:45",
  phase: "closed",
  cells: marks.map((mark, i) => ({ medicationId: `m${i}`, name: i ? "Losartan" : "Amlodipine", strength: "5 mg", mark, at: null, reason: null })),
});

describe("untracked cells", () => {
  it("a closed window with no answer: no reply when tracked, untracked otherwise", () => {
    expect(cellMark({ state: null, reason: null, tracked: true }, "closed")).toBe("no_reply");
    expect(cellMark({ state: null, reason: null, tracked: false }, "closed")).toBe("untracked");
    expect(cellMark({ state: null, reason: null, tracked: false }, "before")).toBe("pending");
    expect(cellMark({ state: "taken", reason: null, tracked: false }, "closed")).toBe("taken");
  });

  it("an untracked slot says there is no record, not that there is no medicine", () => {
    const s = todayStatus(slot(["untracked"]), true);
    expect(s.state).toBe("untracked");
    expect(headline({ state: s.state, slot: "morning", at: null, first: "08:45", dad: "爸爸" }, "zh-Hans")).toBe("今天早间药物无记录：当时爸爸尚未开始使用 Ripple。");
    expect(todayStatus(null, true).state).toBe("no_meds");
  });

  it("untracked cells count for nothing beside tracked ones", () => {
    expect(todayStatus(slot(["untracked", "taken"]), true).state).toBe("taken");
    expect(dayMark([slot(["untracked"])])).toBe("none");
    expect(dayMark([slot(["untracked", "no_reply"])])).toBe("no_reply");
  });
});

// The owner's decision of 2026-10-14: with 「每天吃药的情况」 on she sees the reason he gave for a dose he did not take.
// It is the words stored with his answer (what his own Today shows), on the missed medicine's cell and nowhere else.
describe("the reason of a dose he did not take", () => {
  const cell = (over: Partial<DoseCell>): DoseCell => ({
    medicationId: "med-amlodipine",
    name: "Amlodipine",
    strength: "5 mg",
    labelWords: null,
    labelZh: null,
    labelConfirmed: true,
    slotSource: null,
    row: null,
    state: null,
    reason: null,
    reasonText: null,
    answeredAt: null,
    tracked: true,
    counted: true,
    ...over,
  });
  const day = (cells: DoseCell[]): SlotDay => ({
    day: 44,
    date: "2026-10-13",
    slot: "morning",
    schedule: { first: "08:45", second: "09:15", closes: "09:45" },
    firstMs: Date.parse("2026-10-13T08:45:00+08:00"),
    secondMs: Date.parse("2026-10-13T09:15:00+08:00"),
    closeMs: Date.parse("2026-10-13T09:45:00+08:00"),
    phase: "closed",
    cells,
  });

  it("is his stored words on a missed dose: the reason he tapped, or what he wrote himself; never the option's code", () => {
    expect(cellReason({ state: "missed", reasonText: "太极课" })).toBe("太极课");
    expect(cellReason({ state: "missed", reasonText: "  去女儿家，药没带  " })).toBe("去女儿家，药没带");
    // he tapped 「没吃」 and gave no reason, or only a code is stored: nothing is said for him
    expect(cellReason({ state: "missed", reasonText: null })).toBeNull();
    expect(cellReason({ state: "missed", reasonText: "   " })).toBeNull();
  });

  it("no other answer has one: 「吃了」, 「等一下」 and 「没回」 are states", () => {
    expect(cellReason({ state: "taken", reasonText: "忘了" })).toBeNull();
    expect(cellReason({ state: "unconfirmed", reasonText: "later" })).toBeNull();
    expect(cellReason({ state: null, reasonText: null })).toBeNull();
  });

  it("each medicine of a slot carries its own", () => {
    const view = slotView(
      day([
        cell({ state: "missed", reason: "tai_chi_morning", reasonText: "太极课", answeredAt: "2026-10-13T00:52:00.000Z" }),
        cell({ medicationId: "med-losartan", name: "Losartan", state: "taken", answeredAt: "2026-10-13T00:53:00.000Z" }),
        cell({ medicationId: "med-x", name: "Metformin", state: "unconfirmed", reason: "no_reply" }),
      ]),
    );
    expect(view.cells.map((c) => [c.name, c.mark, c.reason])).toEqual([
      ["Amlodipine", "missed", "太极课"],
      ["Losartan", "taken", null],
      ["Metformin", "no_reply", null],
    ]);
    // the option's code never leaves his space
    expect(JSON.stringify(view)).not.toContain("tai_chi_morning");
  });
});
