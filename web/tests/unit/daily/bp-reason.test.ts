/**
 * Owner 10-15, the demo video's second scene: a reading outside the target his doctor set (not the 180 warning line), his
 * words about that day kept as a note tied to the reading, and one question for the next visit on his list, written by
 * the model (checked) or the fixed template (no consent, the offline mock, a failed check). Plus the visit details the
 * first scene needs (today's visit at 10:30 with Dr Lim) and the one above-target rule every place uses.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as bpPost } from "@/app/api/bp/route";
import { POST as reasonPost } from "@/app/api/bp/reason/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { questionOfReading, questionProblems, quotedWords, readingQuestion, saveReadingReason, templateQuestion, type ReasonFacts } from "@/lib/daily/bp-reason";
import { isReasonNoteOf, latestReasons, outsideTarget, readingOfNote, reasonNoteId, targetRule } from "@/lib/daily/bp-target";
import { doctorWords, exampleVisitDetails, scopeVisitDetails, visitDetail } from "@/lib/daily/visit-details";
import type { LlmClient } from "@/lib/llm/types";
import { questionList } from "@/lib/profile/questions";
import { getMemoryStore } from "@/lib/store/memory";
import { settingsKept } from "@/lib/story/example";
import { setTestClock } from "@/lib/time/now";

const store = getMemoryStore();
const WORDS = "今天打太极，所以没怎么吃午饭。";
let him: TestAccount;

function req(path: string, method: string, token: string | null, body?: unknown): NextRequest {
  const headers: Record<string, string> = {};
  if (token) headers.cookie = `rp_at=${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

/** A model that answers with what it is given (or throws). */
function stubModel(answer: string | Error): LlmClient & { calls: number } {
  const m = {
    provider: "stub",
    model: "stub",
    calls: 0,
    async chat() {
      m.calls++;
      if (answer instanceof Error) throw answer;
      return { content: answer, tokens: 1 };
    },
  };
  return m;
}

async function record(token: string, systolic: number, diastolic: number): Promise<string> {
  const res = await bpPost(req("/api/bp", "POST", token, { systolic, diastolic }));
  expect(res.status).toBe(201);
  return (await res.json()).reading.id as string;
}

beforeAll(async () => {
  // the example's today is its story day 42: d0 is 3 Sep, so R1 (135/85) was said by Dr Lim on 3 Sep
  setTestClock({ at: "2026-10-15T09:00:00+08:00", frozen: true });
  him = await createAccountWithSpace(store, getAuthProvider(), { login: `s${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  setTestClock({ at: "2026-10-15T09:20:00+08:00", frozen: true });
});
afterAll(() => setTestClock(null));

describe("the one rule: a reading outside the doctor's target", () => {
  const t = { systolic: 135, diastolic: 85, since: 0 };
  it("strictly above either number, on or after the target's visit day; never without a target or for a reading not taken", () => {
    expect(outsideTarget({ day: 42, systolic: 152, diastolic: 96 }, t)).toBe(true);
    expect(outsideTarget({ day: 42, systolic: 136, diastolic: 80 }, t)).toBe(true);
    expect(outsideTarget({ day: 42, systolic: 130, diastolic: 86 }, t)).toBe(true);
    expect(outsideTarget({ day: 42, systolic: 135, diastolic: 85 }, t)).toBe(false);
    expect(outsideTarget({ day: 42, systolic: 120, diastolic: 80 }, t)).toBe(false);
    expect(outsideTarget({ day: 3, systolic: 152, diastolic: 96 }, { ...t, since: 8 })).toBe(false);
    expect(outsideTarget({ day: 42, systolic: 152, diastolic: 96 }, null)).toBe(false);
    expect(outsideTarget({ day: 42, systolic: null, diastolic: null, state: "unconfirmed" }, t)).toBe(false);
    expect(targetRule({ systolic: 135, diastolic: null, visitDay: 0 })).toBeNull();
    expect(targetRule({ systolic: 135, diastolic: 85, visitDay: 8 })).toEqual({ systolic: 135, diastolic: 85, since: 8 });
  });

  it("her 留意 reads the same rule (no second copy of it)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("lib/care/record.ts", "utf8");
    expect(src).toContain("outsideTarget(r, target)");
    expect(src).not.toMatch(/r\.systolic > target\.systolic/);
  });

  it("a note about a reading names it whole in its id", () => {
    const id = reasonNoteId("x-bp-d36-morning", "0a1b2c3d");
    expect(id).toBe("bpnote-x-bp-d36-morning-0a1b2c3d");
    expect(isReasonNoteOf({ id }, "x-bp-d36-morning")).toBe(true);
    expect(isReasonNoteOf({ id }, "x-bp-d36")).toBe(false);
    expect(readingOfNote({ id })).toBe("x-bp-d36-morning");
    expect(readingOfNote({ id: "vnote-v1-0a1b2c3d" })).toBeNull();
    const notes = [
      { id: reasonNoteId("r1", "00000001"), created_at: "2026-10-15T01:00:00.000Z" },
      { id: reasonNoteId("r1", "00000002"), created_at: "2026-10-15T01:05:00.000Z" },
      { id: "x-note-d3-1", created_at: "2026-10-15T01:06:00.000Z" },
    ];
    expect(latestReasons(notes).get("r1")?.id).toBe(reasonNoteId("r1", "00000002"));
    expect(latestReasons(notes).size).toBe(1);
  });
});

describe("the visits' details (no column: the scope's settings)", () => {
  it("the example's clinic visits are with Dr Lim (fictional), today's at 10:30; the pharmacy has none", async () => {
    const scope = (await store.getSession(him.userId))!;
    expect(scope.settings.visit_details).toEqual(exampleVisitDetails());
    const v3 = visitDetail(scope, "v3");
    expect(v3.time).toBe("10:30");
    expect(doctorWords(v3.doctor, "en")).toBe("Dr Lim Wei Ming (fictional)");
    expect(doctorWords(v3.doctor, "en", "short")).toBe("Dr Lim");
    expect(doctorWords(v3.doctor, "zh-Hans")).toBe("林伟明医生（虚构）");
    expect(doctorWords(v3.doctor, "zh-Hans", "short")).toBe("林医生");
    expect(visitDetail(scope, "v1").doctor?.short).toBe("Dr Lim");
    expect(visitDetail(scope, "v2").doctor?.short).toBe("Dr Lim");
    expect(visitDetail(scope, "p1")).toEqual({ time: null, doctor: null });
  });

  it("an example account laid out before 10-15 reads them from the example's file; a blank account has none; a clear drops them", () => {
    expect(scopeVisitDetails({ settings: {}, example_data: true }).v3?.time).toBe("10:30");
    expect(scopeVisitDetails({ settings: {}, example_data: false })).toEqual({});
    expect(scopeVisitDetails({ settings: { visit_details: { v9: { time: "25:00", doctor: { name: "" } } } }, example_data: false })).toEqual({});
    expect(settingsKept({ visit_details: exampleVisitDetails(), locale: "en" })).toEqual({ locale: "en" });
  });
});

describe("the question: template and checks", () => {
  const facts: ReasonFacts = { reading: { systolic: 152, diastolic: 96 }, date: "2026-10-15", words: WORDS, target: { systolic: 135, diastolic: 85, date: "2026-09-03", doctor: "Dr Lim" } };

  it("the fixed question quotes his words whole and passes every check, in both languages", () => {
    expect(templateQuestion(facts, "en")).toBe(`On 15 Oct my blood pressure reading was 152/96. I noted: “${WORDS}” On a day like that, what should I do, and how should I arrange my day?`);
    expect(templateQuestion(facts, "zh-Hans")).toBe(`10月15日我量的血压是 152/96，我记下的是：「${WORDS}」像这样的日子，我该怎么做？要怎么安排？`);
    for (const locale of ["en", "zh-Hans"] as const) {
      for (const words of [WORDS, "I did tai chi this morning and skipped lunch because I was busy", "x".repeat(400)]) {
        const f = { ...facts, words };
        expect(questionProblems(templateQuestion(f, locale), f, locale, { quoted: quotedWords(words) }), `${locale}: ${words.slice(0, 20)}`).toEqual([]);
      }
    }
  });

  it("a question that judges, compares, names a medicine or a dose change, invents a number or is not a question is refused", () => {
    const bad = [
      "Should I take an extra tablet when my reading is high?",
      "My reading of 152/96 was above the target. What should I do?",
      "Is 152/96 dangerous?",
      "What should I do when my reading is 170/100?",
      "Do tai chi less often.",
      "Was it because I did not eat lunch?",
      "打太极那天血压偏高，我要多吃一粒药吗？",
    ];
    for (const q of bad) expect(questionProblems(q, facts, q.match(/[一-鿿]/) ? "zh-Hans" : "en"), q).not.toEqual([]);
    expect(questionProblems("打太极那天我没怎么吃午饭，量到 152/96。像这样的日子我该怎么做？", facts, "en")).toContain("language");
    expect(questionProblems("On days I do tai chi and don't eat much lunch, my reading was 152/96. What should I do on such days, and how should I arrange my meals and exercise?", facts, "en")).toEqual([]);
  });

  it("the model's question when it passes; the template when there is no model, the model fails, or its question fails a check", async () => {
    const good = "On days I do tai chi and don't eat much lunch, my reading was 152/96. What should I do on such days, and how should I arrange my meals and exercise?";
    const m = stubModel(JSON.stringify({ question: good }));
    expect(await readingQuestion(facts, "en", m)).toEqual({ text: good, lang: "en", by: "model", why: null });
    expect(m.calls).toBe(1);
    expect(await readingQuestion(facts, "en", null)).toMatchObject({ by: "template", why: "no_model", text: templateQuestion(facts, "en") });
    expect(await readingQuestion(facts, "en", stubModel(new Error("down")))).toMatchObject({ by: "template", why: "model_failed" });
    expect(await readingQuestion(facts, "en", stubModel(JSON.stringify({ question: "Should I skip my tablet on tai chi days?" })))).toMatchObject({ by: "template", why: "checks" });
    expect(await readingQuestion(facts, "en", stubModel("not json"))).toMatchObject({ by: "template", why: "model_failed" });
  });

  it("a question that fails a check is asked for once more, told the words that were not allowed (never his words)", async () => {
    const good = "On days I do tai chi and do not eat much lunch, what should I do, and how should I plan those days?";
    const seen: string[] = [];
    const answers = [JSON.stringify({ question: "On days I do tai chi and skip lunch, what should I do?" }), JSON.stringify({ question: good })];
    const m: LlmClient = {
      provider: "stub",
      model: "stub",
      async chat(opts) {
        seen.push(opts.user);
        return { content: answers[seen.length - 1], tokens: 1 };
      },
    };
    expect(await readingQuestion(facts, "en", m)).toMatchObject({ text: good, by: "model" });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toContain("Your last question could not be used: it used words that are not allowed (skip)");
    // his words are in the facts both times, and the note about the last try names only the vocabulary's word
    expect(seen[1].split("Your last question")[1]).not.toContain(WORDS);
    const always = stubModel(JSON.stringify({ question: "On days I skip lunch, what should I do?" }));
    expect(await readingQuestion(facts, "en", always)).toMatchObject({ by: "template", why: "checks" });
    expect(always.calls).toBe(2);
  });
});

describe("POST /api/bp/reason and saveReadingReason", () => {
  it("his words become his note tied to the reading; one question goes on his list (the offline mock: the fixed question)", async () => {
    const t = him.tokens.access_token;
    const id = await record(t, 152, 96);
    const res = await reasonPost(req("/api/bp/reason", "POST", t, { reading: id, text: `  ${WORDS} ` }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ai).toBe(true);
    expect(body.note.text).toBe(WORDS);
    expect(body.note.lang).toBe("zh-Hans");
    expect(isReasonNoteOf(body.note, id)).toBe(true);
    expect(body.question).toMatchObject({ outcome: "created", by: "template", lang: "en" });
    expect(body.question.text).toContain(WORDS);
    expect(JSON.stringify(body)).not.toContain(him.userId);

    const note = (await store.listNotes(him.userId)).find((n) => n.id === body.note.id)!;
    expect(note).toMatchObject({ day: 42, source: "voice_note", text: WORDS });
    const q = (await store.listQuestions(him.userId)).find((x) => x.id === body.question.id)!;
    expect(q).toMatchObject({ for: "doctor", origin: "reading", status: "open", created_day: 42 });
    expect(JSON.parse(q.evidence!)).toMatchObject({ kind: "reading", reading: id, note: note.id, by: "template" });
    expect(questionOfReading(await store.listQuestions(him.userId), id)?.id).toBe(q.id);
    // it is on his list for the next visit (the 就诊 tab's list), as a question he can still change
    const scope = (await store.getSession(him.userId))!;
    const list = await questionList(store, scope, "en");
    expect(list.open.find((x) => x.id === q.id)).toMatchObject({ origin: "reading", canEdit: true });
  });

  it("said again about the same reading: another note, and the same question written again (never a second one)", async () => {
    const t = him.tokens.access_token;
    const id = await record(t, 150, 92);
    const first = await (await reasonPost(req("/api/bp/reason", "POST", t, { reading: id, text: "没吃午饭" }))).json();
    const second = await (await reasonPost(req("/api/bp/reason", "POST", t, { reading: id, text: WORDS, source: "typed" }))).json();
    expect(second.question).toMatchObject({ id: first.question.id, outcome: "updated" });
    expect(second.question.text).toContain(WORDS);
    expect((await store.listNotes(him.userId)).filter((n) => isReasonNoteOf(n, id)).map((n) => n.source)).toEqual(["voice_note", "typed"]);
    expect((await store.listQuestions(him.userId)).filter((q) => q.evidence?.includes(id))).toHaveLength(1);
  });

  it("with the model (his consent on): its checked question; its unsafe question is never kept", async () => {
    const scope = (await store.getSession(him.userId))!;
    const id = await record(him.tokens.access_token, 148, 90);
    const good = "On days I do tai chi and don't eat much lunch, what should I do, and how should I arrange my meals and exercise?";
    const saved = await saveReadingReason(store, scope, { readingId: id, text: WORDS }, { locale: "en", llm: stubModel(JSON.stringify({ question: good })), publish: () => undefined as never });
    expect(saved.question).toMatchObject({ text: good, by: "model", outcome: "created" });
    const id2 = await record(him.tokens.access_token, 147, 91);
    const unsafe = await saveReadingReason(store, scope, { readingId: id2, text: WORDS }, { locale: "zh-Hans", llm: stubModel(JSON.stringify({ question: "血压偏高的时候可以多吃一粒药吗？" })), publish: () => undefined as never });
    expect(unsafe.question.by).toBe("template");
    expect(unsafe.question.text).not.toMatch(/偏高|多吃|药/);
    expect(unsafe.question.text.startsWith("10月15日我量的血压是 147/91")).toBe(true);
  });

  it("without his consent to AI processing: the fixed question (the model is never asked), and the answer says ai: false", async () => {
    const t = him.tokens.access_token;
    await store.addConsentRecord({ user_id: him.userId, kind: "ai_processing", decision: "withdrawn" });
    try {
      const id = await record(t, 149, 93);
      const res = await reasonPost(req("/api/bp/reason", "POST", t, { reading: id, text: WORDS }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.ai).toBe(false);
      expect(body.question).toMatchObject({ by: "template", outcome: "created" });
      expect(body.question.text).toBe(`On 15 Oct my blood pressure reading was 149/93. I noted: “${WORDS}” On a day like that, what should I do, and how should I arrange my day?`);
    } finally {
      await store.addConsentRecord({ user_id: him.userId, kind: "ai_processing", decision: "granted" });
    }
  });

  it("refuses: a reading within the target (409), not his or not there (404), empty words (400), her phone and no sign-in", async () => {
    const t = him.tokens.access_token;
    const within = await record(t, 128, 80);
    expect((await reasonPost(req("/api/bp/reason", "POST", t, { reading: within, text: WORDS }))).status).toBe(409);
    expect((await reasonPost(req("/api/bp/reason", "POST", t, { reading: "nope", text: WORDS }))).status).toBe(404);
    const id = await record(t, 151, 95);
    expect((await reasonPost(req("/api/bp/reason", "POST", t, { reading: id, text: "   " }))).status).toBe(400);
    expect((await reasonPost(req("/api/bp/reason", "POST", null, { reading: id, text: WORDS }))).status).not.toBe(201);
    const demo = await store.createSession({ story_day: 30, ttl_hours: 1 });
    expect((await reasonPost(req(`/api/bp/reason?session=${demo.id}`, "POST", null, { reading: id, text: WORDS }))).status).toBe(404);
    // nothing was written for the refused ones
    expect((await store.listNotes(him.userId)).filter((n) => isReasonNoteOf(n, within) || isReasonNoteOf(n, id))).toEqual([]);
  });
});
