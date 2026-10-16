/**
 * The check card compares his home readings only with R1, the doctor's 135/85, and only when R1 exists in the
 * session (said before this visit). Without R1 it shows the average and the count, nothing else. Never 140,
 * never 130 (his own "around 130") as a line.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { CheckCard } from "@/components/visit/CheckCard";
import { getMemoryStore } from "@/lib/store/memory";
import { buildBpCheck, targetFromR1 } from "@/lib/visit/checks";
import type { CheckCardView } from "@/lib/visit/types";
import { newSession, replayLive } from "./helpers";

function bpCard(view: { cards: CheckCardView[] | unknown[] }): Extract<CheckCardView, { check: "bp" }> {
  return (view.cards as CheckCardView[]).find((c) => c.kind === "chk" && c.check === "bp") as Extract<CheckCardView, { check: "bp" }>;
}

function html(card: CheckCardView, locale: "en" | "zh-Hans"): string {
  return renderToStaticMarkup(createElement(CheckCard, { card, locale }))
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

describe("bp check card", () => {
  it("with R1 in the session: R1's numbers, R1's words, nothing else as a line", async () => {
    const s = await newSession();
    const view = await replayLive(s, "v2");
    const card = bpCard(view);
    expect(card.target).toMatchObject({ systolic: 135, diastolic: 85, date: "2026-08-24" });
    expect(card.notBelow).toBe(13);
    expect(card.bars.every((b) => b.notBelow === true)).toBe(true);
    const en = html(card, "en");
    expect(en).toContain("13 of 13 were not below 135/85");
    expect(en).toContain("At home, we want it below 135 over 85.");
    expect(en).toContain("average 144/92");
    expect(en).not.toMatch(/\b140\b|\b130\b|\b180\b/);
    const zh = html(card, "zh-Hans");
    expect(zh).toContain("13 次里有 13 次不低于");
    expect(zh).toContain("135/85");
    expect(zh).not.toMatch(/\b140\b|\b130\b|\b180\b/);
  });

  it("without R1 in the session: only the average and the count", async () => {
    const s = await newSession();
    // take R1 out of this session (the store has no delete: it stops being a required line)
    await getMemoryStore().updateVisitItem(s.id, "item-R1", { required_line: null, type: "instruction", text: "(removed)" });
    const view = await replayLive(s, "v2");
    const card = bpCard(view);
    expect(card.target).toBeNull();
    expect(card.notBelow).toBeNull();
    expect(card.bars.every((b) => b.notBelow === null)).toBe(true);
    const en = html(card, "en");
    expect(en).toContain("you recorded 13 readings, average 144/92");
    expect(en).not.toMatch(/not below|135|85\b|140|130|180/);
    const zh = html(card, "zh-Hans");
    expect(zh).toContain("你记了 13 次，平均 144/92");
    expect(zh).not.toMatch(/不低于|135|140|130|180/);
  });

  it("R1 said in a later visit does not count", async () => {
    const s = await newSession();
    // R1 moved to the D42 visit: at D8 there is no doctor's number yet
    await getMemoryStore().updateVisitItem(s.id, "item-R1", { visit_id: "v3" } as never);
    const view = await replayLive(s, "v2");
    expect(bpCard(view).target).toBeNull();
  });

  it("pure builder: the line is R1's numbers, from its slots or its own words", () => {
    const readings = [
      { day: 1, slot: "morning", systolic: 140, diastolic: 93, state: "recorded" },
      { day: 2, slot: "morning", systolic: 130, diastolic: 80, state: "recorded" },
      { day: 3, slot: "evening", systolic: null, diastolic: null, state: "unconfirmed" },
    ] as never;
    const fromWords = targetFromR1({ text: "At home, we want it below 135 over 85.", slots: {}, visit_id: "v1" }, { id: "v1", date: "2026-08-24" }, "confirmed", 49520);
    expect(fromWords).toMatchObject({ systolic: 135, diastolic: 85 });
    const withR1 = buildBpCheck(readings, 1, 7, "2026-08-24", fromWords)!;
    expect(withR1).toMatchObject({ recorded: 2, unconfirmed: 1, notBelow: 1, avgSystolic: 135, avgDiastolic: 87 });
    const without = buildBpCheck(readings, 1, 7, "2026-08-24", null)!;
    expect(without).toMatchObject({ recorded: 2, notBelow: null, target: null });
    expect(buildBpCheck(readings, 10, 20, "2026-08-24", null)).toBeNull();
  });
});

describe("medicine and note checks", () => {
  it("v3: the label name verbatim, 29 of 33 doses, missed all on tai chi days; his own note verbatim", async () => {
    const s = await newSession({ story_day: 42 });
    const view = await replayLive(s, "v3");
    const med = (view.cards as CheckCardView[]).find((c) => c.kind === "chk" && c.check === "med")!;
    const en = html(med, "en");
    expect(en).toContain("AMLODIPINE 5MG TABLET");
    expect(en).toContain("You checked off 29 of 33 doses.");
    expect(en).toContain("The 4 missed were all on Tue and Thu, your tai chi mornings.");
    const zh = html(med, "zh-Hans");
    expect(zh).toContain("33 次服药中，29 次已服药");
    expect(zh).toContain("周二、周四");
    const note = (view.cards as CheckCardView[]).find((c) => c.kind === "chk" && c.check === "note")!;
    expect(html(note, "zh-Hans")).toContain("今天在大巴窑中心走了一圈，脚踝有点肿。");
  });

  it("v2: the relative's medicine gets lib/safety's fixed sentence", async () => {
    const s = await newSession();
    const view = await replayLive(s, "v2");
    const unknown = (view.cards as CheckCardView[]).find((c) => c.kind === "chk" && c.check === "unknown_med")!;
    expect(unknown.anchor).toBe("v2-u16");
    expect(html(unknown, "en")).toContain("I'm not able to identify that medication, please check with your pharmacist.");
  });
});
