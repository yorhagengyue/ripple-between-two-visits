/**
 * 10-14, the owner's decision (「很多内容太绝对，比如胸口痛就必须打 995。应该给合适的建议，记下这个信号，下次告诉医生；不是问题，只是要
 * 告诉医生的情况：什么时候、几点出现了不舒服。给一个不会出错的合理方案」; he chose record + tell the doctor + a conditional 995):
 *
 *   his own chest pain, stroke sign (one-sided weakness, slurred speech ...) or reading above his doctor's warning line,
 *   with no sign that it is happening badly now, stays the emergency route and is answered as a sign for his doctor:
 *     1. 「你说的已记下（10月14日 16:20），会放进下次要告诉医生的情况里。」: his words are kept as his note, marked for the doctor
 *        (lib/daily/signals.ts), with the date and time on his own clock;
 *     2. his doctor's own warning line, quoted with its source and clip (first, for a reading alone);
 *     3. 995 for when it gets bad, in words for its kind (templates.ts SIGNAL_995), drawn as Ripple's line with the 打 995
 *        button.
 *   No question is added. listDoctorSignals lists it (and his readings above the doctor's line), and the brief shows it
 *   under 「要告诉医生的情况」.
 *
 * What stays exactly as it was: self-harm (the helplines), an overdose (「我刚吃了十粒」: emergency_overdose), and every sign
 * that says it is happening badly now (breathing, collapse, cannot be woken, confusion, an allergic swelling, bleeding, a
 * bad headache with a high reading), two kinds of symptom at once, and someone else's emergency: the fixed 995 sentence.
 */
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BriefBody } from "@/components/brief/AccountBrief";
import { BriefSheet } from "@/components/brief/BriefSheet";
import { AnswerCard } from "@/components/daily/AnswerCard";
import { answerParts } from "@/components/daily/answer-parts";
import { ThresholdRelayBlock } from "@/components/daily/elder/ThresholdRelayBlock";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { isSignalNote, listDoctorSignals, SIGNAL_REPLY_PREFIX } from "@/lib/daily/signals";
import { createMockLlm } from "@/lib/llm";
import { classifyRules, signalFamily } from "@/lib/safety/classify";
import { ask } from "@/lib/safety/pipeline";
import { renderText } from "@/lib/safety/render";
import { selfHarmTemplateIds, SIGNAL_RECORDED, TEMPLATES } from "@/lib/safety/templates";
import { relayDoctorThreshold } from "@/lib/safety/threshold";
import { storedAnswer } from "@/lib/safety/turns";
import type { AskResult, Locale } from "@/lib/safety/types";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow, Store } from "@/lib/store/types";
import { buildAccountBrief } from "@/lib/summary/account-brief";
import { buildBrief } from "@/lib/summary/brief";
import { setTestClock } from "@/lib/time/now";

const store = getMemoryStore();
const R2 = "If your reading at home is above 180 on top, or you get chest pain, weakness on one side, or your speech becomes slurred, go to A&E or call 995.";
/** Tue 14 Oct 2026, 16:20 in Singapore: the owner's example */
const AT = "2026-10-14T16:20:00+08:00";
const KEPT_ZH = "你说的已记下（10月14日 16:20），会放进下次要告诉医生的情况里。";
const KEPT_EN = "I've noted what you told me (14 Oct, 4:20 pm). It goes on the list of things to tell your doctor next time.";
const HELPLINES = ["self_harm_sos", "self_harm_mindline", "self_harm_care_corner"];

beforeAll(() => {
  setTestClock({ at: AT, frozen: true });
});
afterAll(() => setTestClock(null));

/** Mr Tan's example account, laid out today (today is story day 42; his doctor's warning line R2 is from day 0). */
async function example(): Promise<SessionRow> {
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `sig${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  return a.scope!;
}

async function askOn(scope: SessionRow, text: string, locale: Locale, s: Store = store) {
  const questions = (await store.listQuestions(scope.id)).length;
  const notes = (await store.listNotes(scope.id)).length;
  const res = await ask({ sessionId: scope.id, text, locale, role: "patient" }, { store: s, llm: createMockLlm(), checker: null, checkerReason: "test", publish: () => {}, costGuard: null });
  return {
    res,
    questionsAdded: (await store.listQuestions(scope.id)).length - questions,
    notesAdded: (await store.listNotes(scope.id)).length - notes,
    shown: renderText(res, locale),
  };
}

const ids = (r: AskResult) => r.sentences.map((s) => s.templateId ?? s.sourceId);
const card = (question: string, res: AskResult, locale: Locale) => renderToStaticMarkup(createElement(AnswerCard, { question, answer: storedAnswer(res), locale }));

describe("his own chest pain on the example account: kept for his doctor, his doctor's line, 995 if it gets bad", () => {
  it("「胸口痛」: the kept sentence with the date and time, the doctor's own line with its clip, the conditional 995, a dial button", async () => {
    const scope = await example();
    const { res, questionsAdded, notesAdded, shown } = await askOn(scope, "胸口痛", "zh-Hans");
    expect(res.route).toBe("emergency");
    expect(res.routeReason).toBe("rule:emergency");
    expect(ids(res)).toEqual([SIGNAL_RECORDED.id, "visit:v1:R2", "signal_995_chest"]);
    expect(res.blocked).toEqual([]);
    expect(res.llm.calls).toBe(0);
    // 1. kept: the sentence names the date and the time, his own clock
    const [kept, doctor, conditional] = res.sentences;
    expect(kept).toMatchObject({ zh: KEPT_ZH, en: KEPT_EN, origin: "span" });
    expect(kept.sourceId).toMatch(/^signal:/);
    // 2. the doctor's own words, word for word, with the visit's date and the clip
    expect(doctor).toMatchObject({ en: R2, attribution: "doctor", origin: "span" });
    expect(doctor.cite).toMatchObject({ visitId: "v1", requiredLine: "R2", date: scope.d0, clipUrl: "/api/visits/v1/clip?u=v1-u09" });
    // 3. 995 for when it gets bad, the owner's words, cited to the heart-attack row
    expect(conditional).toMatchObject({ origin: "template", zh: "要是痛得厉害、一直不好、出冷汗或喘不上气，请马上打 995，或者去最近的急诊。", cite: { referralId: "B1-01" } });
    expect(shown.split("\n")).toEqual([KEPT_ZH, R2, TEMPLATES.signal_995_chest.zh]);
    // the unconditional sentence is gone; it is not a question
    expect(ids(res)).not.toContain("emergency_995");
    expect(shown).not.toContain(TEMPLATES.emergency_995.zh);
    expect(res.addedQuestionId).toBeUndefined();
    expect(questionsAdded).toBe(0);
    expect(notesAdded).toBe(1);
    // the screen: Ripple's line, the doctor's quote, Ripple's line with the 打 995 button; no red card
    const parts = answerParts(res.sentences, "zh-Hans");
    expect(parts.map((p) => p.kind)).toEqual(["ripple", "quote", "hotlines"]);
    expect(parts[2]).toMatchObject({ kind: "hotlines", lines: [{ calls: [{ number: "995", href: "tel:995", urgent: true }] }] });
    const html = card("胸口痛", res, "zh-Hans");
    expect((html.match(/href="tel:995"/g) ?? []).length).toBe(1);
    expect(html).not.toContain('data-rp="emergency"');
    expect(html).toContain("10月14日 16:20");
  });

  it("it lists as a sign for his doctor, his words as stored, with the moment and his date; the brief shows it under 「要告诉医生的情况」", async () => {
    const scope = await example();
    await askOn(scope, "胸口痛", "zh-Hans");
    const note = (await store.listNotes(scope.id)).find((n) => n.text === "胸口痛")!;
    expect(isSignalNote(note)).toBe(true);
    expect(note.app_reply).toBe(`${SIGNAL_REPLY_PREFIX}: chest`);
    const now = (await store.getSession(scope.id))!;
    expect(await listDoctorSignals(store, now, "zh-Hans")).toEqual([{ id: note.id, at: note.created_at, day: "2026-10-14", text: "胸口痛", lang: "zh-Hans" }]);
    expect(Date.parse(note.created_at)).toBe(Date.parse(AT));
    // the brief: his words with the date and his clock time, in a section of their own, and not again under his notes
    const brief = await buildAccountBrief(store, now, "zh-Hans", { translate: "cache" });
    expect(brief.signals).toEqual([{ id: note.id, date: "2026-10-14", time: "16:20", text: "胸口痛", lang: "zh-Hans" }]);
    expect(brief.notes.map((n) => n.text)).not.toContain("胸口痛");
  });

  it("the brief draws it first, under 「要告诉医生的情况」 / \"For the doctor\", his words with the date and time; the demo's sheet too", async () => {
    const scope = await example();
    await askOn(scope, "胸口痛", "zh-Hans");
    const now = (await store.getSession(scope.id))!;
    const zh = renderToStaticMarkup(createElement(BriefBody, { view: await buildAccountBrief(store, now, "zh-Hans", { translate: "cache" }), locale: "zh-Hans" }));
    expect(zh).toContain("要告诉医生的情况");
    expect(zh).toMatch(/data-testid="brief-signal"[^>]*data-signal="[^"]+"[^>]*data-date="2026-10-14"[^>]*data-time="16:20"/);
    expect(zh).toContain("「胸口痛」");
    expect(zh).toContain("10月14日 · 下午 4:20");
    // the section comes before the readings
    expect(zh.indexOf("要告诉医生的情况")).toBeLessThan(zh.indexOf('data-testid="brief-bp"'));
    // the page for the doctor, in English: his words, said not to be translated when there is no checked English
    const en = renderToStaticMarkup(createElement(BriefBody, { view: await buildAccountBrief(store, now, "en", { translate: "cache" }), locale: "en" }));
    expect(en).toContain("For the doctor");
    expect(en).toContain("14 Oct · 4:20 pm");
    expect(en).toContain("his own words, not translated");
    // a brief with nothing for the doctor has no such section
    const other = await example();
    const none = renderToStaticMarkup(createElement(BriefBody, { view: await buildAccountBrief(store, other, "zh-Hans", { translate: "cache" }), locale: "zh-Hans" }));
    expect(none).not.toContain("要告诉医生的情况");
    // the demo's sheet: the same words with the story's date
    const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
    await ask({ sessionId: s.id, text: "我胸口好痛", locale: "zh-Hans", role: "patient" }, { store, llm: createMockLlm(), checker: null, checkerReason: "test", publish: () => {}, costGuard: null });
    const view = await buildBrief(store, (await store.getSession(s.id))!, "zh-Hans");
    expect(view.signals?.map((x) => [x.text, x.date, x.time])).toEqual([["我胸口好痛", "2026-09-22", null]]);
    expect(view.notes.map((n) => n.text)).not.toContain("我胸口好痛");
    const sheet = renderToStaticMarkup(createElement(BriefSheet, { view, locale: "zh-Hans" }));
    expect(sheet).toContain("要告诉医生的情况");
    expect(sheet).toContain("「我胸口好痛」");
  });

  it("English: the same three lines in English, and it lists too", async () => {
    const scope = await example();
    const { res, shown, questionsAdded } = await askOn(scope, "I have chest pain", "en");
    expect(res.route).toBe("emergency");
    expect(ids(res)).toEqual([SIGNAL_RECORDED.id, "visit:v1:R2", "signal_995_chest"]);
    expect(shown.split("\n")).toEqual([KEPT_EN, R2, TEMPLATES.signal_995_chest.en]);
    expect(TEMPLATES.signal_995_chest.en).toBe("If the pain is bad or does not go away, or you break into a cold sweat or cannot catch your breath, call 995 straight away or go to the nearest A&E.");
    expect(res.blocked).toEqual([]);
    expect(questionsAdded).toBe(0);
    const html = card("I have chest pain", res, "en");
    expect((html.match(/href="tel:995"/g) ?? []).length).toBe(1);
    const signals = await listDoctorSignals(store, (await store.getSession(scope.id))!, "en");
    expect(signals.map((s) => s.text)).toEqual(["I have chest pain"]);
  });
});

describe("a stroke sign, and a reading above his doctor's line", () => {
  it.each([
    ["我右手突然没力，说话也说不清楚", "zh-Hans"],
    ["My face is drooping on one side", "en"],
  ] as const)("%s: kept, the doctor's line, then 995 now even if it has passed (a stroke sign is never wait and see)", async (text, locale) => {
    const scope = await example();
    const { res, shown } = await askOn(scope, text, locale);
    expect(res.route).toBe("emergency");
    expect(ids(res)).toEqual([SIGNAL_RECORDED.id, "visit:v1:R2", "signal_995_stroke"]);
    expect(res.sentences[2].cite?.referralId).toBe("B1-03");
    expect(shown).toContain(locale === "zh-Hans" ? "一边身体没力、脸歪或说话不清，就算已经好了，也请马上打 995。" : "Weakness on one side, a drooping face or slurred speech: call 995 now, even if it has passed.");
    expect(res.blocked).toEqual([]);
  });

  it.each([
    ["今天 185/112", "zh-Hans"],
    ["My reading is 190/110", "en"],
  ] as const)("%s: the doctor's line first, kept, then 995 if he feels very unwell", async (text, locale) => {
    const scope = await example();
    const { res, shown } = await askOn(scope, text, locale);
    expect(res.route).toBe("emergency");
    expect(ids(res)).toEqual(["visit:v1:R2", SIGNAL_RECORDED.id, "signal_995_unwell"]);
    expect(shown).toContain(locale === "zh-Hans" ? "要是很不舒服，请马上打 995，或者去最近的急诊。" : "If you feel very unwell, call 995 straight away or go to the nearest A&E.");
    expect(res.blocked).toEqual([]);
    expect((await listDoctorSignals(store, (await store.getSession(scope.id))!, locale)).map((s) => s.text)).toEqual([text]);
  });

  it("the blood pressure page: the doctor's line, then 995 if very unwell as Ripple's line with its button; the reading lists as a sign", async () => {
    const scope = await example();
    const relay = await relayDoctorThreshold(store, scope, { systolic: 186, diastolic: 101 });
    expect(relay!.lines.map((l) => l.templateId ?? l.sourceId)).toEqual(["visit:v1:R2", "signal_995_unwell"]);
    expect(relay!.template).toMatchObject({ origin: "template", en: TEMPLATES.signal_995_unwell.en, zh: TEMPLATES.signal_995_unwell.zh, cite: { referralId: "B1-01" } });
    const html = renderToStaticMarkup(createElement(ThresholdRelayBlock, { relay: relay!, locale: "zh-Hans" }));
    expect(html).toContain('data-template="signal_995_unwell"');
    expect(html).toContain(TEMPLATES.signal_995_unwell.zh);
    expect((html.match(/href="tel:995"/g) ?? []).length).toBe(1);
    expect(html).not.toContain('data-rp="emergency"');
    // the reading itself is the record: listed with his words' signs, newest first
    const now = (await store.getSession(scope.id))!;
    const reading = await store.addBp(scope.id, { day: now.story_day, slot: "evening", systolic: 186, diastolic: 101 });
    await store.addBp(scope.id, { day: now.story_day, slot: "evening", systolic: 150, diastolic: 95 });
    expect(await listDoctorSignals(store, now, "zh-Hans")).toEqual([{ id: reading.id, at: reading.created_at, day: "2026-10-14", text: "血压 186/101", lang: "zh-Hans" }]);
    expect((await listDoctorSignals(store, now, "en"))[0].text).toBe("Blood pressure 186/101");
  });
});

describe("what stays exactly as it was", () => {
  it("「我不想活了」 and \"I don't want to live anymore\": the helplines, nothing kept for the doctor", async () => {
    const scope = await example();
    const zh = await askOn(scope, "我不想活了", "zh-Hans");
    expect(zh.res.route).toBe("self_harm");
    expect(ids(zh.res)).toEqual(selfHarmTemplateIds("zh-Hans"));
    expect(zh.shown).toContain("1767");
    const en = await askOn(scope, "I don't want to live anymore", "en");
    expect(ids(en.res)).toEqual(selfHarmTemplateIds("en"));
    expect(ids(en.res)).not.toContain(HELPLINES[2]);
    expect(await listDoctorSignals(store, (await store.getSession(scope.id))!, "zh-Hans")).toEqual([]);
  });

  it("「我刚吃了十粒」 and \"I took 10 of my BP pills just now\": emergency_overdose, nothing else", async () => {
    const scope = await example();
    for (const [text, locale] of [
      ["我刚吃了十粒", "zh-Hans"],
      ["I took 10 of my BP pills just now", "en"],
    ] as const) {
      const { res, shown } = await askOn(scope, text, locale);
      expect(res.route, text).toBe("emergency");
      expect(ids(res), text).toEqual(["emergency_overdose"]);
      expect(shown, text).toBe(locale === "zh-Hans" ? TEMPLATES.emergency_overdose.zh : TEMPLATES.emergency_overdose.en);
    }
    expect(await listDoctorSignals(store, (await store.getSession(scope.id))!, "zh-Hans")).toEqual([]);
  });

  it.each([
    ["喘不上气", "breathing"],
    ["I can't breathe", "breathing"],
    ["我刚才晕倒了", "collapse"],
    ["叫不醒", "collapse"],
    ["我吐血了", "bleeding"],
    ["My lips are swelling up", "allergy"],
    ["My reading is 185/110 and I have a bad headache", "high_bp_symptom"],
    ["胸口痛，喘不上气", "breathing"],
    ["胸口痛，还出冷汗", "a cold sweat already"],
    ["My chest pain is getting worse", "getting worse already"],
    ["我右手没力，越来越重", "getting worse already"],
    ["I suddenly have the worst headache of my life", "a sudden worst headache"],
    ["我胸口好痛，左手没力", "two kinds"],
    ["My chest hurts and my left arm is weak", "two kinds"],
    ["My husband has chest pain", "someone else"],
  ])("%s (%s): the fixed 995 sentence first, as before, and nothing kept", async (text) => {
    const scope = await example();
    const locale: Locale = /\p{Script=Han}/u.test(text) ? "zh-Hans" : "en";
    const { res, notesAdded } = await askOn(scope, text, locale);
    expect(res.route, text).toBe("emergency");
    expect(res.sentences[0].templateId, text).toBe("emergency_995");
    expect(ids(res), text).not.toContain(SIGNAL_RECORDED.id);
    expect(notesAdded, text).toBe(0);
  });

  it("signalFamily: the kinds that are kept for the doctor, and the ones that are not", () => {
    const CTX = { doctorThresholdSystolic: 180, meds: [] };
    const family = (text: string) => {
      const cls = classifyRules(text, CTX)!;
      return signalFamily(cls.signals, text);
    };
    expect(family("胸口痛")).toBe("chest");
    expect(family("I have chest pain and my left arm feels heavy")).toBe("chest");
    expect(family("我右手突然没力，说话也说不清楚")).toBe("stroke");
    expect(family("今天 185/112")).toBe("reading");
    expect(family("今天 185/112，胸口很痛")).toBe("chest");
    expect(family("185/112 and my left arm is weak")).toBe("stroke");
    // words that say it is bad now count next to a symptom only: a reading alone is "very unwell" or not
    expect(family("185/112, I was sweating after tai chi")).toBe("reading");
    expect(family("I have chest pain and I'm sweating")).toBeNull();
    for (const text of ["喘不上气", "我刚才晕倒了", "我吐血了", "My reading is 185/110 and I have a bad headache", "我胸口好痛，左手没力", "My husband has chest pain"]) {
      expect(family(text), text).toBeNull();
    }
    // a route a model raised names no kind: the kinds its words carry, and none keeps 995 as before
    expect(signalFamily(["model_crisis_screen", "note"], "My arm went funny and heavy")).toBe("stroke");
    expect(signalFamily(["model_crisis_screen", "note"], "I feel strange all over")).toBeNull();
    expect(signalFamily(["model_crisis_screen", "third_person", "note"], "My arm went funny and heavy")).toBeNull();
  });

  it("when his words cannot be kept, the answer is the fixed 995 sentence as before (never a sentence that says it was kept)", async () => {
    const scope = await example();
    const failing: Store = new Proxy(store, {
      get(target, key, receiver) {
        if (key === "addNote") return async () => {
          throw new Error("the database is away");
        };
        const v = Reflect.get(target, key, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const { res } = await askOn(scope, "胸口痛", "zh-Hans", failing);
    expect(res.route).toBe("emergency");
    expect(ids(res)).toEqual(["emergency_995", "visit:v1:R2"]);
    expect(await listDoctorSignals(store, (await store.getSession(scope.id))!, "zh-Hans")).toEqual([]);
  });
});

describe("the demo: its story clock", () => {
  it("「我胸口好痛」 on day 29 at 20:15: kept with the story's date and time", async () => {
    const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
    const res = await ask({ sessionId: s.id, text: "我胸口好痛", locale: "zh-Hans", role: "patient" }, { store, llm: createMockLlm(), checker: null, checkerReason: "test", publish: () => {}, costGuard: null });
    expect(ids(res)).toEqual([SIGNAL_RECORDED.id, "visit:v1:R2", "signal_995_chest"]);
    expect(res.sentences[0].zh).toBe("你说的已记下（9月22日 20:15），会放进下次要告诉医生的情况里。");
    expect(res.blocked).toEqual([]);
    const signals = await listDoctorSignals(store, (await store.getSession(s.id))!, "zh-Hans");
    expect(signals.map((x) => [x.text, x.day])).toEqual([["我胸口好痛", "2026-09-22"]]);
  });
});
