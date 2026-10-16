/**
 * lib/translate (C2 track S): a doctor's English line in Chinese and his Chinese words in English, translated once, checked
 * twice (the same facts on both sides, then the checker model), kept per scope; null on any failure (the screen then shows
 * the original words and the recording alone).
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { createDecidingChecker, createMockLlm } from "@/lib/llm";
import type { ChatOpts, LlmClient } from "@/lib/llm/types";
import { getMemoryStore } from "@/lib/store/memory";
import { ScopeViolation, scopedStore } from "@/lib/subject";
import { cachedTranslation, hasNegation, sameFacts, translateDoctorLine, translateOwnWords, translationKey } from "@/lib/translate";

const store = getMemoryStore();
const R1 = "At home, we want it below 135 over 85.";
const R1_ZH = "在家里，我们希望血压低于 135/85。";
const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";
const R4_ZH = "请不要自己改药量。如果读数高，把它们写下来，下次看诊时告诉我。";
const V3_U07 = "Okay. We keep amlodipine at 5 milligrams, and I'll add losartan 50 milligrams, once in the morning.";

/** A translating model that answers `out` (or throws), counting its calls. */
function translator(out: string | Error): LlmClient & { calls: ChatOpts[] } {
  const calls: ChatOpts[] = [];
  return {
    provider: "fake-translator",
    model: "test",
    calls,
    async chat(opts: ChatOpts) {
      calls.push(opts);
      if (out instanceof Error) throw out;
      return { content: JSON.stringify({ translation: out }), tokens: 0 };
    },
  };
}

/** A checker that answers `{ same }` (or throws), counting its calls. */
function checker(same: boolean | Error): LlmClient & { calls: ChatOpts[] } {
  const calls: ChatOpts[] = [];
  return {
    provider: "fake-checker",
    model: "test",
    calls,
    async chat(opts: ChatOpts) {
      calls.push(opts);
      if (same instanceof Error) throw same;
      return { content: JSON.stringify({ same }), tokens: 0 };
    },
  };
}

const sandbox = async () => (await store.createSession({ ttl_hours: 1 })).id;

describe("check one: the same facts on both sides", () => {
  it("the doctor's numbers, medicine names (in either language), units and times must all be there, nothing added", () => {
    expect(sameFacts(R1, R1_ZH, "en>zh-Hans").pass).toBe(true);
    expect(sameFacts(V3_U07, "好。氨氯地平保持 5 毫克，我再加氯沙坦 50 毫克，早上吃一次。", "en>zh-Hans").pass).toBe(true);
    expect(sameFacts(R1, "在家里，我们希望血压低于 135。", "en>zh-Hans")).toMatchObject({ pass: false, reasons: ["numbers_missing"] });
    expect(sameFacts(R4, "请不要自己改药量，可以多吃两粒。如果读数高，写下来，下次看诊时告诉我。", "en>zh-Hans").reasons).toEqual(expect.arrayContaining(["numbers_added", "units_added"]));
    expect(sameFacts(V3_U07, "好。氨氯地平保持 5 毫克，早上吃一次。", "en>zh-Hans").reasons).toEqual(expect.arrayContaining(["drugs_missing", "numbers_missing"]));
  });

  it("a negation must survive; the target language; not empty, not padded", () => {
    expect(hasNegation(R4)).toBe(true);
    expect(sameFacts(R4, "请自己改药量。如果读数高，把它们写下来，下次看诊时告诉我。", "en>zh-Hans").reasons).toContain("negation_dropped");
    expect(sameFacts(R4, R4_ZH, "en>zh-Hans").pass).toBe(true);
    expect(sameFacts(R1, R1, "en>zh-Hans").reasons).toContain("wrong_language");
    expect(sameFacts(R1, "  ", "en>zh-Hans").reasons).toEqual(["empty"]);
    expect(sameFacts(R1, `${R1_ZH}${"很重要。".repeat(40)}`, "en>zh-Hans").reasons).toContain("too_long");
    expect(sameFacts("最近很累，没有力气", "I have been very tired lately and have no strength.", "zh-Hans>en").pass).toBe(true);
    expect(sameFacts("最近很累，没有力气", "I have been very tired lately and have strength.", "zh-Hans>en").reasons).toContain("negation_dropped");
    expect(sameFacts("最近很累", "最近很累", "zh-Hans>en").reasons).toContain("wrong_language");
  });
});

describe("translated once, checked twice, kept", () => {
  it("both checks pass: the translation is kept and the next call reads it without any model", async () => {
    const sid = await sandbox();
    const llm = translator(R1_ZH);
    const ok = checker(true);
    const first = await translateDoctorLine(store, sid, R1, { aiAllowed: true, llm, checker: ok });
    expect(first).toEqual({ direction: "en>zh-Hans", source: R1, text: R1_ZH, from: "model" });
    expect(llm.calls).toHaveLength(1);
    expect(JSON.parse(llm.calls[0].user)).toEqual({ task: "translate", direction: "en>zh-Hans", text: R1 });
    expect(JSON.parse(ok.calls[0].user)).toEqual({ task: "same_meaning", direction: "en>zh-Hans", source: R1, translation: R1_ZH });
    const again = await translateDoctorLine(store, sid, `  ${R1} `, { aiAllowed: true, llm, checker: ok });
    expect(again).toMatchObject({ text: R1_ZH, from: "cache" });
    expect(llm.calls).toHaveLength(1);
    expect(await cachedTranslation(store, sid, R1, "en>zh-Hans")).toMatchObject({ text: R1_ZH, from: "cache" });
    const row = await store.getTranslation(sid, "en>zh-Hans", translationKey(R1));
    expect(row).toMatchObject({ status: "checked", text: R1_ZH, checks: { facts: { pass: true }, meaning: { pass: true, checker: "fake-checker" } } });
  });

  it("no consent to AI processing: no model call, nothing kept, null", async () => {
    const sid = await sandbox();
    const llm = translator(R1_ZH);
    expect(await translateDoctorLine(store, sid, R1, { aiAllowed: false, llm, checker: checker(true) })).toBeNull();
    expect(llm.calls).toHaveLength(0);
    expect(await store.listTranslations(sid)).toEqual([]);
  });

  it("check one fails: rejected and kept, so the model is not asked again; the checker is never asked", async () => {
    const sid = await sandbox();
    const llm = translator("请自己改药量。如果读数高，把它们写下来，下次看诊时告诉我。");
    const ok = checker(true);
    expect(await translateDoctorLine(store, sid, R4, { aiAllowed: true, llm, checker: ok })).toBeNull();
    expect(ok.calls).toHaveLength(0);
    const row = await store.getTranslation(sid, "en>zh-Hans", translationKey(R4));
    expect(row).toMatchObject({ status: "rejected", text: null, checks: { facts: { pass: false, reasons: ["negation_dropped"] } } });
    expect(JSON.stringify(row)).not.toContain("请自己改药量");
    expect(await translateDoctorLine(store, sid, R4, { aiAllowed: true, llm, checker: ok })).toBeNull();
    expect(llm.calls).toHaveLength(1);
  });

  it("check two says the meaning changed: rejected and kept", async () => {
    const sid = await sandbox();
    expect(await translateDoctorLine(store, sid, R4, { aiAllowed: true, llm: translator(R4_ZH), checker: checker(false) })).toBeNull();
    expect(await store.getTranslation(sid, "en>zh-Hans", translationKey(R4))).toMatchObject({ status: "rejected", checks: { meaning: { pass: false } } });
  });

  it("nothing reached (no checker, a checker or model error, the offline mock): null and nothing kept, so it is tried again", async () => {
    const sid = await sandbox();
    expect(await translateDoctorLine(store, sid, R1, { aiAllowed: true, llm: translator(R1_ZH), checker: null })).toBeNull();
    expect(await translateDoctorLine(store, sid, R1, { aiAllowed: true, llm: translator(R1_ZH), checker: checker(new Error("down")) })).toBeNull();
    expect(await translateDoctorLine(store, sid, R1, { aiAllowed: true, llm: translator(new Error("down")), checker: checker(true) })).toBeNull();
    expect(await translateDoctorLine(store, sid, R1, { aiAllowed: true, llm: createMockLlm(), checker: createDecidingChecker(() => true) })).toBeNull();
    expect(await store.listTranslations(sid)).toEqual([]);
    expect(await translateDoctorLine(store, sid, R1, { aiAllowed: true, llm: translator(R1_ZH), checker: checker(true) })).toMatchObject({ text: R1_ZH, from: "model" });
  });

  it("only the right language is translated: a Chinese line is not a doctor's English line, English is not his Chinese words", async () => {
    const sid = await sandbox();
    const llm = translator("x");
    expect(await translateDoctorLine(store, sid, "这个我不认得，你拿去问药剂师。", { aiAllowed: true, llm, checker: checker(true) })).toBeNull();
    expect(await translateOwnWords(store, sid, "I am tired", { aiAllowed: true, llm, checker: checker(true) })).toBeNull();
    expect(await translateDoctorLine(store, sid, "", { aiAllowed: true, llm, checker: checker(true) })).toBeNull();
    expect(llm.calls).toHaveLength(0);
  });

  it("his words for the brief: Chinese to English, the same checks", async () => {
    const sid = await sandbox();
    const out = await translateOwnWords(store, sid, "最近很累，没有力气", { aiAllowed: true, llm: translator("I have been very tired lately and have no strength."), checker: checker(true) });
    expect(out).toEqual({ direction: "zh-Hans>en", source: "最近很累，没有力气", text: "I have been very tired lately and have no strength.", from: "model" });
    expect(await cachedTranslation(store, sid, "最近很累，没有力气", "en>zh-Hans")).toBeNull();
  });
});

describe("kept per scope, through the subject's store", () => {
  it("his own store makes and reads them; another scope never sees them; her view (family) may not make one", async () => {
    const a = await createAccountWithSpace(store, getAuthProvider(), { login: `tr${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
    const own = scopedStore(store, a.scope!, "self", { userId: a.userId, maskSessionId: true });
    expect(await translateDoctorLine(own, a.userId, R1, { aiAllowed: true, llm: translator(R1_ZH), checker: checker(true) })).toMatchObject({ text: R1_ZH });
    expect(await cachedTranslation(own, a.userId, R1, "en>zh-Hans")).toMatchObject({ text: R1_ZH });
    const other = await sandbox();
    expect(await cachedTranslation(store, other, R1, "en>zh-Hans")).toBeNull();
    const hers = scopedStore(store, a.scope!, "family", { userId: randomUUID(), linkId: randomUUID(), maskSessionId: true });
    expect(await cachedTranslation(hers, a.userId, R1, "en>zh-Hans")).toMatchObject({ text: R1_ZH });
    await expect(translateDoctorLine(hers, a.userId, R4, { aiAllowed: true, llm: translator(R4_ZH), checker: checker(true) })).rejects.toBeInstanceOf(ScopeViolation);
  });
});

describe("his day's model spend (C2 round 2; real-app 3.5: US$0.20 a person a day)", () => {
  /** A paid translator: every call costs `usd`. */
  const paid = (out: string, usd: number): LlmClient & { calls: number } => {
    const c = {
      provider: "fake-paid",
      model: "test",
      calls: 0,
      async chat() {
        c.calls++;
        return { content: JSON.stringify({ translation: out, same: true }), tokens: 10, usd };
      },
    };
    return c;
  };

  it("the two calls are counted for him; at the cap nothing is sent, nothing is kept, and a kept translation is still read", async () => {
    const { PersonSpend, usagePerson } = await import("@/lib/llm/person-spend");
    const { usageStore } = await import("@/lib/subject/usage");
    const sid = await sandbox();
    const person = usagePerson({ id: sid, kind: "sandbox" });
    const mine = () => new PersonSpend(usageStore(store), person);
    const llm = paid(R1_ZH, 0.06);
    const check = paid("", 0.05);
    // counted through the default (the process-wide store's buckets)
    expect(await translateDoctorLine(store, sid, R1, { aiAllowed: true, llm, checker: check })).toMatchObject({ text: R1_ZH, from: "model" });
    await new Promise((r) => setTimeout(r, 5));
    expect(await mine().spentUsd()).toBeCloseTo(0.11, 6);
    expect(await translateDoctorLine(store, sid, R4, { aiAllowed: true, llm: paid(R4_ZH, 0.06), checker: check })).toMatchObject({ text: R4_ZH });
    await new Promise((r) => setTimeout(r, 5));
    expect(await mine().capped()).toBe(true);
    // at the cap: no request, null, nothing kept (a later day tries again)
    const idle = paid("好。", 0.06);
    const calls = check.calls;
    expect(await translateDoctorLine(store, sid, V3_U07, { aiAllowed: true, llm: idle, checker: check })).toBeNull();
    expect(idle.calls).toBe(0);
    expect(check.calls).toBe(calls);
    expect(await store.getTranslation(sid, "en>zh-Hans", translationKey(V3_U07))).toBeNull();
    // what was made before is read as before
    expect(await translateDoctorLine(store, sid, R1, { aiAllowed: true, llm: idle, checker: check })).toMatchObject({ text: R1_ZH, from: "cache" });
    // spend: null leaves the counter alone (tests, scripts)
    expect(await translateDoctorLine(store, sid, V3_U07, { aiAllowed: true, llm: translator("好。氨氯地平保持 5 毫克，我再加氯沙坦 50 毫克，早上吃一次。"), checker: checker(true), spend: null })).not.toBeNull();
  });
});
