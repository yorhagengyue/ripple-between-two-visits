/**
 * Track K, journey 13 (M16; e2e-chains 11): kb/diet.json keeps its own rules (official sources with URL and review
 * date, our words, no numbers, no claim that a food does something, no orders), the diet screen puts the doctor's own
 * words first, asks the day's question only while there is such a line, cites every official line, shows grapefruit only
 * from the leaflet while amlodipine is on his list, and sends a special diet to the doctor or a dietitian.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { CHECK_ELEMENTS } from "@/lib/diet/check";
import { DIET_CONDITIONS, dietKb, sourceOf } from "@/lib/diet/kb";
import { answerDietCheck, dietCheckToday, dietView, setFoods, SPECIAL_DIET } from "@/lib/diet/view";
import { addFact } from "@/lib/profile/facts";
import { getMemoryStore } from "@/lib/store/memory";
import { scopedStore } from "@/lib/subject";

const store = getMemoryStore();
const DIET = "Cut down on salt. Less gravy, don't finish the soup. And keep up your morning walks.";

/** A food doing something to his body, numbers, orders: never in a diet line. */
const EFFICACY = /\b(?:lowers?|lowering|reduces? (?:your )?(?:blood|risk|cholesterol|sugar)|controls?|controlling|prevents?|preventing|protects?|cures?|good for|bad for|benefits?|helps? (?:to )?(?:lower|control|prevent|keep|reduce|manage))\b|降低|降血压|降血糖|降胆固醇|控制|预防|保护|有助|改善|有益|对身体好|对.{0,6}有好处/i;
const ORDERS = /你应该|你需要|你必须|一定要|建议|\byou should\b|\byou must\b|\byou need\b|\brecommend/i;
const NUMBERS = /\d|[一二三四五六七八九十两百千万]\s*(?:克|毫克|茶匙|汤匙|卡|份|杯|碗)|\b(?:one|two|three|four|five|half)\b/i;
const OFFICIAL = /^https:\/\/(?:www\.)?(?:healthhub\.sg|hpb\.gov\.sg|moh\.gov\.sg|[a-z0-9.-]+\.gov\.sg)\//;

async function account(space: "example" | "blank") {
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `kd${randomUUID().slice(0, 10)}`, password: "a long test password", space });
  const own = scopedStore(store, a.scope!, "self", { userId: a.userId, maskSessionId: true });
  const scope = async () => (await own.getSession(a.scope!.id))!;
  return { own, scope };
}

describe("kb/diet.json keeps its rules", () => {
  it("parses; every line names a known source; every source is an official Singapore page with a review date", () => {
    const kb = dietKb();
    expect(kb.lines.length).toBeGreaterThan(0);
    for (const l of kb.lines) {
      const s = sourceOf(l);
      expect(s.url, l.id).toMatch(OFFICIAL);
      expect(s.reviewed, l.id).toMatch(/^2026-\d{2}-\d{2}$/);
      expect(s.publisher, l.id).toMatch(/HealthHub|Health Promotion Board|Ministry of Health/);
    }
    for (const id of Object.keys(kb.sources)) expect(kb.lines.some((l) => l.source === id), `unused source ${id}`).toBe(true);
  });

  it("each of the three conditions has its lines, and the eating-out lines cover several hawker dishes", () => {
    const kb = dietKb();
    for (const c of DIET_CONDITIONS) expect(kb.lines.filter((l) => l.conditions.includes(c)).length, c).toBeGreaterThanOrEqual(4);
    const foods = new Set(kb.lines.flatMap((l) => l.foods));
    expect(foods.size).toBeGreaterThanOrEqual(5);
    for (const f of foods) expect(kb.foods.some((x) => x.id === f), `unknown food ${f}`).toBe(true);
  });

  it("our words only: no numbers, no claim that a food does something, no orders, no grapefruit", () => {
    for (const l of dietKb().lines) {
      for (const text of [l.en, l.zh]) {
        expect(text, `${l.id}: ${text}`).not.toMatch(NUMBERS);
        expect(text, `${l.id}: ${text}`).not.toMatch(EFFICACY);
        expect(text, `${l.id}: ${text}`).not.toMatch(ORDERS);
        expect(text, `${l.id}: ${text}`).not.toMatch(/grapefruit|西柚|柚子/i);
      }
    }
    for (const t of [SPECIAL_DIET["zh-Hans"], SPECIAL_DIET.en]) expect(t).not.toMatch(ORDERS);
    // reported as what the page lists, never an order: no Chinese line opens with an imperative
    for (const l of dietKb().lines) expect(l.zh, `${l.id}: ${l.zh}`).not.toMatch(/^(?:要|不要|别|请|少吃|多吃|少喝|多喝|选|避免|应|必须)/);
    for (const e of CHECK_ELEMENTS) for (const q of [e.question["zh-Hans"], e.question.en]) expect(q, q).not.toMatch(ORDERS);
  });
});

describe("the diet screen on an account", () => {
  it("the example account: Dr Lim's words first, the soup question, his hypertension lines with sources, grapefruit from the leaflet", async () => {
    const { own, scope } = await account("example");
    const v = await dietView(own, await scope(), "zh-Hans");
    expect(v.doctor.map((d) => d.text)).toEqual([DIET]);
    expect(v.doctor[0]).toMatchObject({ visitId: "v1", utteranceId: "v1-u07", at: "0:42" });
    expect(v.check).toMatchObject({ item: "soup", question: "今天的汤，有没有喝完？", today: null, answers: { yes: "有", no: "没有", unsure: "不记得" } });
    expect(v.conditions.map((c) => c.id)).toEqual(["hypertension"]);
    expect(v.conditions[0].lines.length).toBeGreaterThanOrEqual(4);
    for (const l of v.conditions[0].lines) expect(l.source.url).toMatch(OFFICIAL);
    expect(v.grapefruit?.text).toBe("单张写着：吃氨氯地平期间不要吃西柚。");
    expect(v.grapefruit?.source.url).toBe("https://www.healthhub.sg/medication-devices-and-treatment/medications/amlodipine");
    expect(v.special).toEqual({ text: SPECIAL_DIET["zh-Hans"], first: false });
    expect(v.noCondition).toBe(false);
    expect(v.week).toBeNull();
  });

  it("the day's question: on Today until he answers, then not; answering again the same day changes the answer", async () => {
    const { own, scope } = await account("example");
    const today = await dietCheckToday(own, await scope(), "en");
    expect(today).toMatchObject({ item: "soup", question: "Did you finish the soup today?", doctor: { text: DIET } });
    expect(await answerDietCheck(own, await scope(), "no")).toMatchObject({ ok: true, item: "soup", answer: "no" });
    expect(await dietCheckToday(own, await scope(), "en")).toBeNull();
    await answerDietCheck(own, await scope(), "yes");
    const s = await scope();
    const rows = await own.listDietChecks(s.id, { fromDay: s.story_day, toDay: s.story_day });
    expect(rows).toEqual([expect.objectContaining({ item: "soup", answer: "yes", source_ref: "v1:v1-u07" })]);
    const v = await dietView(own, s, "en");
    expect(v.check?.today).toBe("yes");
    expect(v.week).toContain("answered on 1 of 7 days");
  });

  it("a blank account: no doctor's line, so no question; nothing recorded, so no condition lines", async () => {
    const { own, scope } = await account("blank");
    expect(await dietCheckToday(own, await scope(), "zh-Hans")).toBeNull();
    expect(await answerDietCheck(own, await scope(), "yes")).toMatchObject({ ok: false, error: "no_diet_check" });
    const v = await dietView(own, await scope(), "zh-Hans");
    expect(v).toMatchObject({ doctor: [], check: null, conditions: [], noCondition: true, grapefruit: null });
  });

  it("his hawker dishes: picked ones show their eating-out lines; unknown ids are dropped", async () => {
    const { own, scope } = await account("example");
    const kept = await setFoods(own, await scope(), ["chicken_rice", "noodle_soup", "nope"]);
    expect(kept).toEqual(["chicken_rice", "noodle_soup"]);
    const v = await dietView(own, await scope(), "zh-Hans");
    expect(v.foods.picked.map((f) => f.id)).toEqual(["chicken_rice", "noodle_soup"]);
    expect(v.foods.all.filter((f) => f.picked).map((f) => f.id)).toEqual(["chicken_rice", "noodle_soup"]);
    expect(v.foods.picked.some((f) => f.lines.length > 0)).toBe(true);
    expect(v.foods.canPick).toBe(true);
  });

  it("a demo session (a judge's sandbox): the screen reads; no picker, and its scope row is never written", async () => {
    const row = await store.createSession({ ttl_hours: 1 });
    const demo = scopedStore(store, row, "demo");
    const s = (await demo.getSession(row.id))!;
    // the scoped store refuses a demo's scope-row write outright (a 500 on the route): setFoods must never try it
    await expect(demo.updateScope(s.id, { settings: { diet_foods: ["laksa"] } })).rejects.toThrow(/not for demo mode/);
    expect(await setFoods(demo, s, ["laksa"])).toBeNull();
    const v = await dietView(demo, s, "zh-Hans");
    expect(v.foods.canPick).toBe(false);
    expect(v.foods.picked).toEqual([]);
    // the day's answer is a record (diet_check), never a setting: answering on a demo never touches its scope row
    await expect(answerDietCheck(demo, s, "no")).resolves.toBeTruthy();
    expect((await store.getSession(row.id))?.settings ?? {}).not.toHaveProperty("diet_foods");
  });

  it("kidney disease recorded: the referral to the doctor or a dietitian comes first, and the general lines are not listed", async () => {
    const { own, scope } = await account("blank");
    await addFact(own, await scope(), { kind: "condition", text: "高血压" }, { kind: "patient" }, { publish: () => undefined });
    await addFact(own, await scope(), { kind: "condition", text: "肾病" }, { kind: "patient" }, { publish: () => undefined });
    const v = await dietView(own, await scope(), "zh-Hans");
    expect(v.special).toEqual({ text: SPECIAL_DIET["zh-Hans"], first: true });
    expect(v.conditions).toEqual([]);
    expect(v.foods.picked).toEqual([]);
  });

  it("a condition he recorded himself (糖尿病) lists that condition's lines", async () => {
    const { own, scope } = await account("blank");
    await addFact(own, await scope(), { kind: "condition", text: "糖尿病" }, { kind: "patient" }, { publish: () => undefined });
    const v = await dietView(own, await scope(), "en");
    expect(v.conditions.map((c) => [c.id, c.name])).toEqual([["diabetes", "Diabetes"]]);
  });
});
