/**
 * Patterns (task M4 item 2, literal requirement): the seed's missed mornings on tai chi days (Tue/Thu) give exactly
 * one question whose words only describe the pattern: none of 换, 改到, 建议, move, switch, should, try.
 */
import { describe, expect, it } from "vitest";
import { POST as dosesPost } from "@/app/api/doses/route";
import { patternText, routinePatterns, syncPatternQuestions } from "@/lib/daily/patterns";
import { questionsView } from "@/lib/daily/questions";
import type { RoutineEntry } from "@/lib/daily/schedule";
import { getMemoryStore } from "@/lib/store/memory";
import { templateCast, templateDefaults } from "@/lib/story/seed";
import type { SessionRow } from "@/lib/store/types";
import { ADVICE_WORDS, postReq, sessionAt } from "./helpers";

const routine = templateCast().persona.routine as RoutineEntry[];
const d0 = templateDefaults().d0;

async function patternQuestions(s: SessionRow) {
  return (await getMemoryStore().listQuestions(s.id)).filter((q) => q.origin === "pattern");
}

function noAdvice(text: string) {
  for (const w of ADVICE_WORDS) expect(text.toLowerCase(), `${w} in "${text}"`).not.toContain(w);
}

describe("routine patterns in his dose log", () => {
  it("the seed: 4 missed mornings (D15, D17, D24, D36), all on tai chi days; the pattern exists from the 3rd (D24)", async () => {
    const store = getMemoryStore();
    const s = await sessionAt(41);
    const [doses, meds] = await Promise.all([store.listDoses(s.id), store.listMeds(s.id)]);
    const [p, ...rest] = routinePatterns({ doses, meds, routine, d0, day: 41 });
    expect(rest).toEqual([]);
    expect(p).toMatchObject({ slug: "tai_chi", weekdays: ["Tue", "Thu"], missedDays: [15, 17, 24, 36], onRoutine: [15, 17, 24, 36], firstDay: 24 });
    expect(routinePatterns({ doses, meds, routine, d0, day: 23 })).toEqual([]); // two misses so far
    const zh = patternText(p, d0, "zh-Hans");
    const en = patternText(p, d0, "en");
    expect(zh).toBe("我漏吃的 4 个早上都在打太极的日子（周二、周四）：9月8日、9月10日、9月17日、9月29日。");
    expect(en).toBe("All 4 mornings I missed were tai chi days (Tue, Thu): 8 Sep, 10 Sep, 17 Sep, 29 Sep.");
    noAdvice(zh);
    noAdvice(en);
  });

  it("D29: exactly one pattern question (the seed's q-tai-chi reused), worded as the pattern only", async () => {
    const s = await sessionAt(29);
    const first = await syncPatternQuestions(getMemoryStore(), s);
    expect(first.map((x) => [x.question.id, x.change])).toEqual([["q-tai-chi", "updated"]]);
    const qs = await patternQuestions(s);
    expect(qs).toHaveLength(1);
    expect(qs[0]).toMatchObject({ id: "q-tai-chi", for: "doctor", status: "open", created_day: 25, lang: "zh-Hans" });
    expect(qs[0].text).toBe("我漏吃的 3 个早上都在打太极的日子（周二、周四）：9月8日、9月10日、9月17日。");
    expect(qs[0].evidence).toContain("pattern:tai_chi");
    noAdvice(qs[0].text);
    // idempotent
    expect((await syncPatternQuestions(getMemoryStore(), s)).map((x) => x.change)).toEqual(["unchanged"]);
    // the list page shows it in both languages, pattern words only
    for (const locale of ["zh-Hans", "en"] as const) {
      const view = await questionsView(getMemoryStore(), s, locale);
      const shown = [...view.doctor, ...view.pharmacist].filter((q) => q.origin === "pattern");
      expect(shown).toHaveLength(1);
      noAdvice(shown[0].text);
    }
  });

  it("before the third miss (D20) there is no pattern and the seed's question is not on the list yet", async () => {
    const s = await sessionAt(20);
    expect(await syncPatternQuestions(getMemoryStore(), s)).toEqual([]);
    const view = await questionsView(getMemoryStore(), s, "zh-Hans");
    expect([...view.doctor, ...view.pharmacist].some((q) => q.origin === "pattern")).toBe(false);
  });

  it("D24, the day of the third miss: the question appears that day (no second one later)", async () => {
    const s = await sessionAt(24);
    await syncPatternQuestions(getMemoryStore(), s);
    expect((await patternQuestions(s)).map((q) => [q.id, q.created_day])).toEqual([["q-tai-chi", 24]]);
    await getMemoryStore().setStoryDay(s.id, 37);
    await syncPatternQuestions(getMemoryStore(), (await getMemoryStore().getSession(s.id))!);
    const qs = await patternQuestions(s);
    expect(qs).toHaveLength(1);
    expect(qs[0].text).toContain("4 个早上");
  });

  it("a missed tai chi morning logged now (D43 is a Tuesday) updates the same question", async () => {
    const s = await sessionAt(43, "09:00");
    const res = await dosesPost(postReq("/api/doses", s.id, { medication_id: "med-amlodipine", slot: "morning", state: "missed", reason: "tai_chi_morning", reason_text: "打太极" }));
    expect(res.status).toBe(200);
    const qs = await patternQuestions(s);
    expect(qs).toHaveLength(1);
    expect(qs[0].text).toBe("我漏吃的 5 个早上都在打太极的日子（周二、周四）：9月8日、9月10日、9月17日、9月29日、10月6日。");
    noAdvice(qs[0].text);
  });

  it("with no pattern question in the list, one is created (and only one)", async () => {
    const s = await sessionAt(29);
    await getMemoryStore().updateQuestion(s.id, "q-tai-chi", { origin: "own" }); // as if he had asked it himself
    const out = await syncPatternQuestions(getMemoryStore(), s);
    expect(out.map((x) => [x.question.id, x.change])).toEqual([["q-pattern-tai_chi", "created"]]);
    await syncPatternQuestions(getMemoryStore(), s);
    expect((await patternQuestions(s)).map((q) => [q.id, q.created_day])).toEqual([["q-pattern-tai_chi", 24]]);
  });

  it("an answered pattern question is left as it was", async () => {
    const s = await sessionAt(29);
    await getMemoryStore().updateQuestion(s.id, "q-tai-chi", { status: "answered", answer_text: "x", answer_visit_id: "v3" });
    const before = (await getMemoryStore().getQuestion(s.id, "q-tai-chi"))!.text;
    expect((await syncPatternQuestions(getMemoryStore(), s)).map((x) => x.change)).toEqual(["unchanged"]);
    expect((await getMemoryStore().getQuestion(s.id, "q-tai-chi"))!.text).toBe(before);
    expect(await patternQuestions(s)).toHaveLength(1);
  });
});
