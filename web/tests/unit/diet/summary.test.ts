/**
 * Track K, journey 13 → 14: the doctor's diet line (lib/diet/doctor.ts), the daily check's question (lib/diet/check.ts)
 * and the brief's weekly diet line (lib/diet/summary.ts weeklyDietLine, called by track B's brief).
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { checkElementFor } from "@/lib/diet/check";
import { doctorDietLines, isDietLine } from "@/lib/diet/doctor";
import { weeklyDietLine } from "@/lib/diet/summary";
import { getMemoryStore } from "@/lib/store/memory";
import { scopedStore } from "@/lib/subject";

const store = getMemoryStore();
const DIET = "Cut down on salt. Less gravy, don't finish the soup. And keep up your morning walks.";

async function account(space: "example" | "blank") {
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `kd${randomUUID().slice(0, 10)}`, password: "a long test password", space });
  const own = scopedStore(store, a.scope!, "self", { userId: a.userId, maskSessionId: true });
  const scope = (await own.getSession(a.scope!.id))!;
  return { own, scope };
}

describe("the doctor's diet line", () => {
  it("food words in a doctor's line count; a medicine, a test or a question does not", () => {
    expect(isDietLine(DIET)).toBe(true);
    expect(isDietLine("少喝汤，少吃咸的。")).toBe(true);
    expect(isDietLine("Yes, both together after breakfast is fine.")).toBe(false);
    expect(isDietLine("No need to fast for this one. Just take your medicine as usual and come in.")).toBe(false);
    expect(isDietLine("Any soup today?")).toBe(false);
    expect(isDietLine("这个药饭后吃，汤可以喝。")).toBe(false);
    expect(isDietLine("你有糖尿病。")).toBe(false);
  });

  it("the example account: Dr Lim's first-visit line, word for word, with its visit, date and time point", async () => {
    const { own, scope } = await account("example");
    const lines = await doctorDietLines(own, scope);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ visitId: "v1", utteranceId: "v1-u07", text: DIET, role: "doctor", tStartMs: 42667, lang: "en", visitDay: 0 });
    expect(lines[0].visitDate).toBe(scope.d0);
  });

  it("a blank account has none", async () => {
    const { own, scope } = await account("blank");
    expect(await doctorDietLines(own, scope)).toEqual([]);
  });

  it("the day's question is picked from the doctor's words: soup first, then gravy, sweet drinks, fried; else the general one", () => {
    expect(checkElementFor(DIET).id).toBe("soup");
    expect(checkElementFor("Less gravy please.").id).toBe("gravy");
    expect(checkElementFor("Cut down on sugary drinks.").id).toBe("sweet_drinks");
    expect(checkElementFor("Less fried food.").id).toBe("fried");
    expect(checkElementFor("Cut down on salt.").id).toBe("general");
    expect(checkElementFor(DIET).question["zh-Hans"]).toBe("今天的汤，有没有喝完？");
  });
});

describe("weeklyDietLine (the brief's diet line)", () => {
  it("a blank account with no doctor line and no answers: null", async () => {
    const { own, scope } = await account("blank");
    expect(await weeklyDietLine(own, scope, "en")).toBeNull();
  });

  it("the doctor gave the instruction but nothing was answered in the window: null (no 'answered on 0 days' line)", async () => {
    const { own, scope } = await account("example");
    expect(await weeklyDietLine(own, scope, "en")).toBeNull();
    expect(await weeklyDietLine(own, scope, "zh-Hans", { fromDay: 0, toDay: scope.story_day })).toBeNull();
  });

  it("one answer: the doctor's words ride along, the question and the counts", async () => {
    const { own, scope } = await account("example");
    await own.setDietCheck(scope.id, { day: scope.story_day, item: "soup", answer: "no", source_ref: "v1:v1-u07" });
    const line = (await weeklyDietLine(own, scope, "en"))!;
    expect(line).toMatchObject({ item: "soup", days: 7, answered: 1, yes: 0, no: 1, unsure: 0, question: "Did you finish the soup today?" });
    expect(line.doctor).toMatchObject({ text: DIET, visitId: "v1", utteranceId: "v1-u07" });
    expect(line.text).toMatch(/^Diet check \(on the doctor's words of \d{1,2} [A-Z][a-z]{2}\), .+: answered on 1 of 7 days; finished the soup on 0 days, did not on 1 day, did not remember on 0 days\.$/);
  });

  it("counts his answers in the last 7 days for today's question only, in both languages, without a judging word", async () => {
    const { own, scope } = await account("example");
    const day = scope.story_day;
    const set = (d: number, answer: string, item = "soup") => own.setDietCheck(scope.id, { day: d, item, answer, source_ref: "v1:v1-u07" });
    await set(day - 10, "yes"); // outside the window
    await set(day - 6, "no");
    await set(day - 4, "yes");
    await set(day - 3, "no");
    await set(day - 2, "unsure");
    await set(day, "no");
    await set(day - 1, "yes", "gravy"); // another question: not counted
    const en = (await weeklyDietLine(own, scope, "en"))!;
    expect(en).toMatchObject({ days: 7, answered: 5, yes: 1, no: 3, unsure: 1 });
    expect(en.text).toContain("answered on 5 of 7 days; finished the soup on 1 day, did not on 3 days, did not remember on 1 day.");
    const zh = (await weeklyDietLine(own, scope, "zh-Hans"))!;
    expect(zh.text).toContain("7 天里答了 5 天；汤喝完了 1 天，没喝完 3 天，不记得 1 天。");
    for (const t of [en.text, zh.text]) expect(t).not.toMatch(/好|差|正常|不错|应该|需要|建议|good|bad|well done|should|need/i);
  });

  it("the brief's own window: only its days, never before the visit with the instruction", async () => {
    const { own, scope } = await account("example");
    await own.setDietCheck(scope.id, { day: 3, item: "soup", answer: "yes" });
    await own.setDietCheck(scope.id, { day: 12, item: "soup", answer: "no" });
    const line = (await weeklyDietLine(own, scope, "en", { fromDay: 1, toDay: 10 }))!;
    expect(line).toMatchObject({ days: 10, answered: 1, yes: 1, no: 0 });
    expect(await weeklyDietLine(own, scope, "en", { fromDay: 0, toDay: 0 })).toBeNull();
  });
});
