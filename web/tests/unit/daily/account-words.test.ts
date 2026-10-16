/**
 * Words on an account (C2 track B, from track C's review): a habit named only in Chinese gets a stable slug (its reason
 * code and its pattern question hang on it), the pattern question's evidence names real dates on an account (the demo
 * keeps its story days), and a question whose words he changed himself is his own words.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { patternEvidence, patternSlugOf, routinePatterns, syncPatternQuestions } from "@/lib/daily/patterns";
import { questionWords } from "@/lib/daily/questions";
import { reasonOptions, routineSlug, type RoutineEntry } from "@/lib/daily/schedule";
import { MemoryStore, getMemoryStore } from "@/lib/store/memory";
import type { DoseLogRow, MedicationRow, QuestionRow } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";
import { sessionAt } from "./helpers";

afterAll(() => setTestClock(null));

describe("routineSlug", () => {
  it("Latin words as before; a habit named in other letters: r_ and a hash of all its words, the same every time", () => {
    expect(routineSlug("Tai chi")).toBe("tai_chi");
    expect(routineSlug("Ｔａｉ ｃｈｉ")).toBe("tai_chi");
    const taiChi = routineSlug("打太极");
    expect(taiChi).toMatch(/^r_[a-z0-9]+$/);
    expect(routineSlug("打太极")).toBe(taiChi);
    expect(routineSlug(" 打太极 ")).toBe(taiChi);
    expect(routineSlug("散步")).not.toBe(taiChi);
    // digits alone never stand for the habit
    expect(routineSlug("8点散步")).not.toBe("8");
    expect(routineSlug("8点散步")).not.toBe(routineSlug("8点买菜"));
    expect(routineSlug("")).toBe("routine");
  });

  it("his Chinese-only habit gives its own reason code on its days, and its pattern question finds it again", () => {
    const routine: RoutineEntry[] = [{ label: "打太极", days: ["Tue", "Thu"], time: "07:30" }];
    // d0 Mon 31 Aug 2026: day 1 is a Tuesday
    const codes = reasonOptions(routine, "2026-08-31", 1).map((r) => r.code);
    expect(codes[0]).toBe(`${routineSlug("打太极")}_morning`);
    expect(codes[0]).not.toBe("_morning");
    const med = { id: "m1", origin: "prescription" } as MedicationRow;
    const doses = [1, 3, 8].map((day) => ({ medication_id: "m1", day, slot: "morning", state: "missed" }) as DoseLogRow);
    const [p] = routinePatterns({ doses, meds: [med], routine, d0: "2026-08-31", day: 9 });
    expect(p.slug).toBe(routineSlug("打太极"));
    const evidence = patternEvidence(p, { d0: "2026-08-31" });
    expect(evidence).toBe(`pattern:${p.slug}; 漏吃的 3 个早上里，3 个在打太极的日子（周二、周四）：9月1日、9月3日、9月8日`);
    expect(patternSlugOf({ origin: "pattern", text: "", evidence }, routine)).toBe(p.slug);
  });
});

describe("the pattern question's evidence", () => {
  it("an example account: real dates, the same ones as the question's words, no day number", async () => {
    const store = new MemoryStore();
    setTestClock({ at: "2026-10-12T10:00:00+08:00", frozen: true });
    const a = await createAccountWithSpace(store, getAuthProvider(), { login: `w${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
    const q = (await store.getQuestion(a.userId, "q-tai-chi"))!;
    expect(q.evidence).toMatch(/^pattern:tai_chi; 漏吃的 \d+ 个早上里，\d+ 个在打太极的日子（周二、周四）：\d+月\d+日(、\d+月\d+日)+$/);
    expect(q.evidence).not.toMatch(/Day \d|第 ?\d+ ?天/);
    const dates = (s: string) => s.slice(s.lastIndexOf("：") + 1).replace(/。$/, "");
    expect(dates(q.evidence!)).toBe(dates(q.text));
    // reading Today again leaves it as it is
    expect((await syncPatternQuestions(store, (await store.getSession(a.userId))!)).map((x) => x.change)).toEqual(["unchanged"]);
  });

  it("the demo keeps its story days", async () => {
    const s = await sessionAt(41);
    await syncPatternQuestions(getMemoryStore(), s);
    const q = (await getMemoryStore().getQuestion(s.id, "q-tai-chi"))!;
    expect(q.evidence).toBe("pattern:tai_chi; missed mornings on Tue/Thu: Day 15, 17, 24, 36 (4 of 4 missed)");
  });
});

describe("questionWords", () => {
  it("a refused question no ask of his created is a recorded summary, until he changes its words himself", () => {
    const q: Pick<QuestionRow, "origin" | "text" | "lang"> = { origin: "refused_question", text: "读数高的时候（例如 150/95）可以多吃一粒吗？", lang: "zh-Hans" };
    expect(questionWords(q, undefined).wording).toBe("recorded_summary");
    const mine = { ...q, text: "血压高的时候可以多吃一粒吗？", edited_at: "2026-10-12T02:00:00.000Z" };
    expect(questionWords(mine, { created: false, reusedBy: [{ text: "今天 150/95，我能不能多吃一粒？", lang: "zh-Hans" }] })).toEqual({
      text: "血压高的时候可以多吃一粒吗？",
      lang: "zh-Hans",
      wording: "own_words",
      summary: null,
    });
  });
});
