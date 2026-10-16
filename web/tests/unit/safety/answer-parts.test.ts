/**
 * The 问一句 screen's parts (components/daily/answer-parts.ts) and words (components/daily/ask-copy.ts), C2 track S: every
 * sentence lib/safety returns lands in the part that names its source; the five crisis numbers become call buttons, never
 * another number; nothing is reworded except the lead-in its tag already says.
 */
import { describe, expect, it } from "vitest";
import { answerParts, callsOf } from "@/components/daily/answer-parts";
import { askCopy, clockAt, dateLine, shortDate, limitWords } from "@/components/daily/ask-copy";
import { createMockLlm } from "@/lib/llm";
import { ask } from "@/lib/safety/pipeline";
import { TEMPLATES } from "@/lib/safety/templates";
import { getMemoryStore } from "@/lib/store/memory";

const store = getMemoryStore();

async function answerAt(text: string, locale: "zh-Hans" | "en" = "zh-Hans") {
  const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
  return ask({ sessionId: s.id, text, locale, role: "patient" }, { store, llm: createMockLlm(), checker: null, checkerReason: "test", publish: () => {}, costGuard: null });
}

describe("answerParts", () => {
  it("the hero: the doctor's words (医生说, date and time point, the clip), the label without a doubled lead-in, Ripple's referral", async () => {
    const r = await answerAt("今天 150/95，我能不能多吃一粒？");
    const parts = answerParts(r.sentences, "zh-Hans");
    expect(parts.map((p) => p.kind)).toEqual(["quote", "label", "ripple"]);
    expect(parts[0]).toMatchObject({ kind: "quote", speaker: "doctor", inferred: false, lang: "en", when: "9月1日 · 0:43", ref: "v2-u08", standIn: true });
    expect(parts[1]).toMatchObject({ kind: "label", printed: "Take ONE tablet every MORNING", restated: "每天早上服用一片。" });
    expect(parts[2]).toMatchObject({ kind: "ripple", text: TEMPLATES.refer_doctor.zh, lang: "zh-Hans" });
    const en = answerParts(r.sentences, "en");
    expect(en[1]).toMatchObject({ kind: "label", printed: "Take ONE tablet every MORNING" });
    expect(en[1]).not.toHaveProperty("restated");
    expect(en[0]).toMatchObject({ when: "1 Sep · 0:43" });
  });

  it("an emergency happening badly now: the red block first, then the doctor's warning line as a quote", async () => {
    const r = await answerAt("我胸口好痛，喘不上气");
    const parts = answerParts(r.sentences, "zh-Hans");
    expect(parts.map((p) => p.kind)).toEqual(["emergency", "quote"]);
    expect(parts[0]).toMatchObject({ text: TEMPLATES.emergency_995.zh });
  });

  it("his own chest pain (10-14, the owner's decision): Ripple's sentence that it was kept, the doctor's line, then 995 if it gets bad as a line with its button", async () => {
    const r = await answerAt("我胸口好痛");
    const parts = answerParts(r.sentences, "zh-Hans");
    expect(parts.map((p) => p.kind)).toEqual(["ripple", "quote", "hotlines"]);
    expect(parts[0]).toMatchObject({ kind: "ripple", lang: "zh-Hans" });
    expect(parts[0].kind === "ripple" && parts[0].text).toMatch(/^你说的已记下（\d{1,2}月\d{1,2}日.*），会放进下次要告诉医生的情况里。$/);
    expect(parts[2]).toMatchObject({ kind: "hotlines", lines: [{ text: TEMPLATES.signal_995_chest.zh, calls: [{ number: "995", href: "tel:995", urgent: true }] }] });
  });

  it("self-harm: one hotlines part, each line with its numbers as buttons; 995 urgent, CareText by WhatsApp", async () => {
    const r = await answerAt("我觉得活着没什么意思，只会拖累孩子");
    const parts = answerParts(r.sentences, "zh-Hans");
    expect(parts).toHaveLength(1);
    const hot = parts[0];
    expect(hot.kind).toBe("hotlines");
    if (hot.kind !== "hotlines") return;
    expect(hot.lines.map((l) => l.calls.map((c) => [c.number, c.href, !!c.urgent, !!c.whatsapp]))).toEqual([
      [["995", "tel:995", true, false]],
      [
        ["1767", "tel:1767", false, false],
        ["9151 1767", "https://wa.me/6591511767", false, true],
      ],
      [["1771", "tel:1771", false, false]],
      [["1800-3535-800", "tel:18003535800", false, false]],
    ]);
    expect(hot.lines.map((l) => l.text)).toEqual(["self_harm_995", "self_harm_sos", "self_harm_mindline", "self_harm_care_corner"].map((id) => TEMPLATES[id as keyof typeof TEMPLATES].zh));
  });

  it("the unknown medicine: the fixed English sentence as it is, one Chinese line under it in the Chinese UI", async () => {
    const r = await answerAt("我亲戚给的宁和平压丸是什么药？");
    const [p] = answerParts(r.sentences, "zh-Hans");
    expect(p).toMatchObject({ kind: "ripple", text: TEMPLATES.unknown_med.en, lang: "en", second: TEMPLATES.unknown_med.zh });
  });

  it("callsOf: only the five numbers dial.ts knows, each once; any other number stays text", () => {
    expect(callsOf("打 995，或者 995。")).toEqual([{ number: "995", href: "tel:995", urgent: true }]);
    expect(callsOf("6389 2222 和 1800-221-4444")).toEqual([]);
  });
});

describe("ask-copy", () => {
  it("the date line, a short date, the time to ask again", () => {
    expect(dateLine("2026-10-10", "zh-Hans")).toBe("10月10日 周六");
    expect(dateLine("2026-10-10", "en")).toBe("Sat 10 Oct");
    expect(shortDate("2026-09-06", "zh-Hans")).toBe("9月6日");
    expect(clockAt("2026-10-10T02:42:00.000Z")).toBe("10:42");
    expect(clockAt(null)).toBeNull();
    expect(askCopy("zh-Hans").tooMany("10:42")).toBe("这个小时问得太多了，10:42 以后再问。");
    // C2 round 2: the 429 says which limit; each sentence is true for its own
    expect(limitWords("zh-Hans", { limit: "requests_per_hour", retryAt: "2026-10-10T03:00:00.000Z" })).toBe("这个小时问得太多了，11:00 以后再问。");
    expect(limitWords("zh-Hans", { limit: "tokens_per_day", retryAt: "2026-10-10T16:00:00.000Z" })).toBe("今天问得太多了，明天再问。");
    expect(limitWords("en", { limit: "tokens_per_day" })).toBe("Too many questions today. Ask again tomorrow.");
    expect(limitWords("en", { limit: "requests_per_hour", retryAt: "2026-10-10T03:00:00.000Z" })).toBe("Too many questions this hour. Ask again after 11:00.");
    expect(limitWords("zh-Hans", null)).toBe("这个小时问得太多了，请稍后再问。");
    expect(askCopy("zh-Hans").translation).toBe("中文翻译，以英文原话为准");
  });
});
