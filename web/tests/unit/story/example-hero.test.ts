/**
 * The hero line on an example account (docs/plan/real-app.md 4.5, lines 969-977; 8.4 「单元 story/example-hero」, line 1441:
 * 「问主镜头那句，回答有 R4、药袋原文、「已经在问题单里」；按定下的复用规则，问题单条数不变；简报仍是三条不重复的问题。」).
 *
 * A person who signed up with Mr Tan's example data asks, today, 「今天 150/95，我能不能多吃一粒？」 through the real route
 * (POST /api/ask with his rp_at cookie, the stub model: LLM_PROVIDER=mock). The answer is the film's:
 *   - no dose advice: the question is refused by the dose-change rule, and every sentence is a source's own words or a
 *     fixed template, none made by a model;
 *   - R4, Dr Lim's exact words (the template's required line), source visit:v2:R4, dated day 8 of HIS days as a real
 *     date (d0 + 8, never the template's 2026-09-01), with the recording that plays it;
 *   - the bag's own text: a sentence whose source is the medicine's label, its instruction line word for word;
 *   - 「已经在问题单里」: the question is the one already on his list since day 29 (q-extra-tablet), said with the real
 *     date he asked it (「你 X月X日 也问过，已经在问题单里」);
 *   - by the reuse rule that was decided (an open question on the same topic made since the last clinic visit is used
 *     again, lib/safety/pipeline.ts), the question list has the same rows before and after, however often he asks;
 *   - the brief (GET /api/brief) still shows exactly three different questions: q-extra-tablet, q-tai-chi, q-knee-2.
 * For two "today"s that are not the template's own dates (the template's day 42 is 2026-10-05), on two weekdays.
 * The control: on a blank account the same sentence makes a new question (so the count can change), with no R4 and no
 * label line.
 *
 * tests/unit/safety/c2-ask.test.ts (accounts: "the example account's hero") has R4, the reused question and the date
 * words through ask() directly; tests/unit/safety/api-ask-c2.test.ts has the route's two chat rows. Added here: the
 * label's line, the unchanged rows, the brief's three questions, and all of it through the route for other dates.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as askPost } from "@/app/api/ask/route";
import { GET as briefGet } from "@/app/api/brief/route";
import { GET as clipGet } from "@/app/api/visits/[id]/clip/route";
import { questionRowWords, shortDate } from "@/components/daily/ask-copy";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import type { StoredLabel } from "@/lib/meds/types";
import { TEMPLATES } from "@/lib/safety/templates";
import type { AskResult } from "@/lib/safety/types";
import { getMemoryStore } from "@/lib/store/memory";
import { storyDate } from "@/lib/story/clock";
import { loadTemplate } from "@/lib/story/seed";
import type { AccountBriefView } from "@/lib/summary/account-brief";
import { setTestClock } from "@/lib/time/now";

const store = getMemoryStore();
const HERO = "今天 150/95，我能不能多吃一粒？";
/** how the example's list words the question he asked on day 29 (a recorded summary, not his words) */
const SUMMARY = "读数高的时候（例如 150/95）可以多吃一粒吗？";
const saved = { ...process.env };

beforeAll(() => {
  process.env.LLM_PROVIDER = "mock"; // the stub model
});
afterAll(() => {
  process.env = saved;
  setTestClock(null);
});

function req(p: string, token: string, body?: unknown): NextRequest {
  const headers: Record<string, string> = { cookie: `rp_at=${token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function accountAt(now: string, space: "example" | "blank"): Promise<TestAccount> {
  setTestClock({ at: now, frozen: true });
  return createAccountWithSpace(store, getAuthProvider(), { login: `eh${randomUUID().slice(0, 10)}`, password: "a long test password", space });
}

async function askHero(a: TestAccount, locale: "zh-Hans" | "en" = "zh-Hans"): Promise<AskResult> {
  const res = await askPost(req("/api/ask", a.tokens.access_token, { text: HERO, locale }));
  const text = await res.text();
  expect(res.status, text).toBe(200);
  expect(text).not.toContain(a.userId);
  return JSON.parse(text) as AskResult;
}

async function briefOf(a: TestAccount): Promise<AccountBriefView> {
  const res = await briefGet(req("/api/brief?locale=zh-Hans", a.tokens.access_token));
  const text = await res.text();
  expect(res.status, text).toBe(200);
  return (JSON.parse(text) as { brief: AccountBriefView }).brief;
}

const R4 = loadTemplate("mr-tan").required_doctor_lines.find((r) => r.id === "R4")!;
const TEMPLATE_D0 = loadTemplate("mr-tan").meta.d0;

describe("the template itself (what the dates below must not be)", () => {
  it("R4 is Dr Lim's line at v2, and the template's own day 8, 29 and 42 are 1 Sep, 22 Sep and 5 Oct 2026", () => {
    expect(R4).toMatchObject({ visit: "v2", speaker: "doctor", text: "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit." });
    expect([8, 29, 42].map((d) => storyDate(TEMPLATE_D0, d))).toEqual(["2026-09-01", "2026-09-22", "2026-10-05"]);
  });
});

describe.each([
  { today: "2026-11-18", at: "2026-11-18T20:15:00+08:00", d0: "2026-10-07", r4Date: "2026-10-15", askedOn: "2026-11-05", askedZh: "11月5日" }, // a Wednesday
  { today: "2027-02-06", at: "2027-02-06T07:40:00+08:00", d0: "2026-12-26", r4Date: "2027-01-03", askedOn: "2027-01-24", askedZh: "1月24日" }, // a Saturday, across a new year
])("an example account whose today is $today", ({ at, d0, r4Date, askedOn, askedZh }) => {
  it("the hero line: R4 on its real date, the bag's own words, already on the list; no new row; the brief keeps its three questions", async () => {
    const him = await accountAt(at, "example");
    expect(him.scope).toMatchObject({ kind: "account", example_data: true, d0, story_day: 42 });
    const questionsBefore = await store.listQuestions(him.userId);
    expect(questionsBefore.map((q) => q.id)).toEqual(["q-machine", "q-knee-1", "q-relative-box", "q-extra-tablet", "q-tai-chi", "q-knee-2"]);
    expect(questionsBefore.find((q) => q.id === "q-extra-tablet")).toMatchObject({ status: "open", for: "doctor", origin: "refused_question", created_day: 29 });
    const briefBefore = await briefOf(him);
    expect(briefBefore.questions.shown.map((q) => q.id)).toEqual(["q-extra-tablet", "q-tai-chi", "q-knee-2"]);
    const listBefore = await store.listQuestions(him.userId); // after the brief brought the pattern question's words up to date

    const answer = await askHero(him);

    // no dose advice: refused by the dose-change rule; three sentences, each a source's own words or the fixed template
    expect(answer.route).toBe("refuse_route");
    expect(answer.routeReason).toBe("rule:dose_change");
    expect(answer.refusedRequest).toMatchObject({ rule: "rule:dose_change", replacedBy: "refer_doctor" });
    expect(answer.llm.provider).toBe("mock");
    expect(answer.blocked).toEqual([]);
    expect(answer.sentences.map((s) => [s.sourceId, s.origin, s.speechAct])).toEqual([
      ["visit:v2:R4", "span", "restate"],
      ["label:med-amlodipine", "span", "restate"],
      ["tpl:refer_doctor", "template", "referral"],
    ]);
    const [doctor, label, referral] = answer.sentences;
    expect(referral).toMatchObject({ templateId: "refer_doctor", en: TEMPLATES.refer_doctor.en, zh: TEMPLATES.refer_doctor.zh });
    // nothing in what he reads answers "can I take one more": no yes, no number of tablets but the label's own ONE
    const shown = answer.sentences.flatMap((s) => [s.en, s.zh ?? "", s.translation?.text ?? ""]).join("\n");
    expect(shown).not.toMatch(/可以多吃|能多吃|多吃一粒|加一粒|两粒|extra tablet|two tablets|one more|another tablet|\byes\b/i);
    expect(`${HERO} Yes, one more.`).toMatch(/可以多吃|能多吃|多吃一粒|加一粒|两粒|extra tablet|two tablets|one more|another tablet|\byes\b/i); // the pattern can match

    // R4: Dr Lim's exact words, from his v2 on day 8 of his own days, with the recording
    expect(doctor).toMatchObject({ en: R4.text, span: R4.text, attribution: "doctor" });
    expect(doctor.cite).toMatchObject({ visitId: "v2", requiredLine: "R4", day: 8, date: r4Date, role: "doctor", roleState: "confirmed", utteranceId: "v2-u08", clipUrl: "/api/visits/v2/clip?u=v2-u08" });
    expect(doctor.cite?.date).toBe(storyDate(him.scope!.d0!, 8));
    expect(doctor.cite?.date).not.toBe(storyDate(TEMPLATE_D0, 8));
    expect((await store.getVisit(him.userId, "v2"))?.date).toBe(r4Date);
    const clip = await clipGet(req(doctor.cite!.clipUrl!, him.tokens.access_token), { params: Promise.resolve({ id: "v2" }) });
    expect(clip.status).toBe(200);
    expect(clip.headers.get("content-type")).toBe("audio/wav");

    // the bag's own text: the label's instruction line, word for word, as its source
    const bag = (await store.getMed(him.userId, "med-amlodipine"))!.label as StoredLabel;
    expect(bag.directions).toBe("Take ONE tablet every MORNING");
    expect(label).toMatchObject({ en: bag.directions, span: bag.directions, attribution: "label", zh: "药品标签：每天早上服用一片。" });
    expect(label.cite).toMatchObject({ medId: "med-amlodipine", date: bag.dispensed });
    expect(bag.dispensed).toBe(r4Date); // the bag was dispensed at v2, on his dates

    // 「已经在问题单里」: the question he asked on day 29, said with that day's real date
    expect(answer).toMatchObject({ addedQuestionId: "q-extra-tablet", questionReused: true, reusedQuestion: { date: askedOn } });
    expect(askedOn).toBe(storyDate(him.scope!.d0!, 29));
    expect(questionRowWords("zh-Hans", answer, "已在下次看诊的问题单里")).toBe(`${askedZh} 问过 · 已在问题单`);
    expect(shortDate(askedOn, "zh-Hans")).toBe(askedZh);

    // the reuse rule: the list is the same rows, not one more and none changed
    const listAfter = await store.listQuestions(him.userId);
    expect(listAfter).toHaveLength(6);
    expect(listAfter).toEqual(listBefore);
    // asked again, and once more in English: still the same rows, the same answer
    const again = await askHero(him);
    expect(again.sentences.map((s) => s.sourceId)).toEqual(["visit:v2:R4", "label:med-amlodipine", "tpl:refer_doctor"]);
    expect(again).toMatchObject({ addedQuestionId: "q-extra-tablet", questionReused: true, reusedQuestion: { date: askedOn } });
    const english = await askHero(him, "en");
    expect(english).toMatchObject({ route: "refuse_route", addedQuestionId: "q-extra-tablet", questionReused: true });
    expect(await store.listQuestions(him.userId)).toEqual(listBefore);

    // the brief: still exactly three different questions, the refused one once
    const briefAfter = await briefOf(him);
    expect(briefAfter.questions.shown.map((q) => q.id)).toEqual(["q-extra-tablet", "q-tai-chi", "q-knee-2"]);
    expect(new Set(briefAfter.questions.shown.map((q) => q.text)).size).toBe(3);
    expect(briefAfter.questions.more).toBe(0);
    expect(briefAfter.questions.shown.filter((q) => q.origin === "refused_question")).toHaveLength(1);
    expect(briefAfter.questions.shown.slice(1)).toEqual(briefBefore.questions.shown.slice(1));
    // the one thing that changed on it: the refused question was the example's recorded summary, and is now in the
    // words he asked it with today (the summary kept next to them)
    expect(briefBefore.questions.shown[0]).toMatchObject({ id: "q-extra-tablet", wording: "recorded_summary", text: SUMMARY, summary: null, createdDay: 29 });
    expect(briefAfter.questions.shown[0]).toMatchObject({ id: "q-extra-tablet", wording: "own_words", text: HERO, summary: { text: SUMMARY }, createdDay: 29 });
  });
});

describe("the control: a blank account has no earlier question to use again", () => {
  it("the same line is refused too, but it makes a new question: one more row, no R4, no label line", async () => {
    const him = await accountAt("2026-11-18T20:15:00+08:00", "blank");
    const before = await store.listQuestions(him.userId);
    expect(before).toEqual([]);
    const answer = await askHero(him);
    expect(answer.route).toBe("refuse_route");
    expect(answer.sentences.map((s) => s.sourceId)).not.toContain("visit:v2:R4");
    expect(answer.sentences.some((s) => s.sourceId.startsWith("label:"))).toBe(false);
    expect(answer.questionReused).not.toBe(true);
    expect(answer.reusedQuestion).toBeUndefined();
    const after = await store.listQuestions(him.userId);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: answer.addedQuestionId, status: "open", for: "doctor", origin: "refused_question", text: HERO });
    // asked again the same day: that question is used again (the rule he gets on any account)
    const again = await askHero(him);
    expect(again.addedQuestionId).toBe(answer.addedQuestionId);
    expect(await store.listQuestions(him.userId)).toHaveLength(1);
  });
});
