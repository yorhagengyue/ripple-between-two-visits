/**
 * The checked-in example translations and where a translation is shown (C2 track S, round 2; real-app 12 「英文原话下面配中文
 * 翻译，过数字、药名、单位、频次的确定性检查和核对模型，不过就只显示英文加听原声」; audit au4 row 29).
 *
 *   the set    every English line the doctor and the pharmacist say in the four sample visits has an entry; every entry
 *              passes the deterministic facts check; a line is in the set only with a passing stamp of the checker
 *              model that binds to the exact pair of texts (the committed file has none: written offline)
 *   shown      zhLookup: the Chinese page only, only with his consent to AI processing, only a checked row of his own or
 *              (an example account) a checked line of the set; never a rejected translation, never for another account
 *   example    ensureExampleTranslations keeps the set's checked lines as his own rows, once
 *   places     the blood pressure relay, the brief, the medicine card's lines, the answered questions, an ask
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fixtureUtterances } from "@/lib/asr/fixtures";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { createMockLlm } from "@/lib/llm";
import { ask } from "@/lib/safety";
import { relayDoctorThreshold } from "@/lib/safety/threshold";
import { getMemoryStore } from "@/lib/store/memory";
import { loadTemplate } from "@/lib/story/seed";
import { scopedStore } from "@/lib/subject";
import { buildAccountBrief } from "@/lib/summary/account-brief";
import { cachedTranslation, translationKey } from "@/lib/translate";
import { checkedExampleLines, exampleSetLines, exampleSetSummary, exampleZh, lineChecked, pairHash, type ExampleLine } from "@/lib/translate/example-set";
import { sameFacts } from "@/lib/translate/facts";
import { TRANSLATION_LABEL } from "@/lib/translate/label";
import { ensureExampleTranslations, zhLookup } from "@/lib/translate/shown";
import { inferRoles } from "@/lib/visit/roles";

const store = getMemoryStore();
const R1 = "At home, we want it below 135 over 85.";
const R2 = "If your reading at home is above 180 on top, or you get chest pain, weakness on one side, or your speech becomes slurred, go to A&E or call 995.";
const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";

const account = (space: "blank" | "example", consents?: ("terms_privacy" | "ai_processing" | "example_data")[]): Promise<TestAccount> =>
  createAccountWithSpace(store, getAuthProvider(), { login: `ex${randomUUID().slice(0, 10)}`, password: "a long test password", space, ...(consents ? { consents } : {}) });
const own = (a: TestAccount) => scopedStore(store, a.scope!, "self", { userId: a.userId, maskSessionId: true });

/** The set as it would be after the checker model passed every line (a stamp bound to each pair). */
function stamped(lines: ExampleLine[] = exampleSetLines()): Map<string, ExampleLine> {
  return checkedExampleLines(lines.map((l) => ({ ...l, meaning: { pass: true, checker: "test-checker", model: "test", at: "2026-10-10T00:00:00.000Z", pair: pairHash(l.en, l.zh) } })));
}

describe("the checked-in set", () => {
  it("has one entry for every English line a clinician says in the four sample visits", () => {
    const required = loadTemplate("mr-tan").required_doctor_lines.map((r) => ({ text: r.text, speaker: r.speaker }));
    const kinds: Record<string, "clinic" | "pharmacy"> = { v1: "clinic", v2: "clinic", p1: "pharmacy", v3: "clinic" };
    const want: string[] = [];
    for (const visit of Object.keys(kinds)) {
      const lines = fixtureUtterances(visit)!;
      const roles = inferRoles(
        lines.map((u) => ({ id: u.id, speaker_cluster: u.speaker_cluster, text: u.text })),
        { visitKind: kinds[visit], requiredLines: required },
      );
      for (const u of lines) {
        const role = roles.byLine.get(u.id)?.role ?? "unknown";
        if (["doctor", "dispenser", "pharmacist"].includes(role) && !/\p{Script=Han}/u.test(u.text) && /[A-Za-z]/.test(u.text)) want.push(u.text.trim());
      }
    }
    const have = new Set(exampleSetLines().map((l) => l.en.trim()));
    expect(want.filter((t) => !have.has(t))).toEqual([]);
    expect(want.length).toBeGreaterThan(20);
    // the four required lines are among them
    for (const r of required) expect(have.has(r.text.trim()), r.text).toBe(true);
  });

  it("every entry passes the deterministic facts check, ids are unique, the Chinese is Chinese", () => {
    const lines = exampleSetLines();
    expect(new Set(lines.map((l) => l.id)).size).toBe(lines.length);
    expect(new Set(lines.map((l) => l.en)).size).toBe(lines.length);
    for (const l of lines) {
      const f = sameFacts(l.en, l.zh, "en>zh-Hans");
      expect(f.pass, `${l.id}: ${f.reasons.join(", ")}`).toBe(true);
      expect(/\p{Script=Han}/u.test(l.zh), l.id).toBe(true);
    }
  });

  it("a line is in the set only with a passing stamp for exactly these two texts", () => {
    const [first] = exampleSetLines();
    const ok = { pass: true, checker: "c", model: "m", at: "2026-10-10T00:00:00.000Z", pair: pairHash(first.en, first.zh) };
    expect(lineChecked({ ...first, meaning: null })).toBe(false);
    expect(lineChecked({ ...first, meaning: ok })).toBe(true);
    expect(lineChecked({ ...first, meaning: { ...ok, pass: false } })).toBe(false);
    // either text edited after the check: the stamp is for other words
    expect(lineChecked({ ...first, zh: `${first.zh}很重要。`, meaning: ok })).toBe(false);
    expect(lineChecked({ ...first, en: `${first.en} Really.`, meaning: ok })).toBe(false);
    // a stamp cannot rescue a translation that fails the facts check
    const r1 = exampleSetLines().find((l) => l.en === R1)!;
    const wrong = { ...r1, zh: "在家里，我们希望血压低于 140/85。" };
    expect(lineChecked({ ...wrong, meaning: { ...ok, pair: pairHash(wrong.en, wrong.zh) } })).toBe(false);
  });

  it("the committed file: whatever is stamped is honest, and nothing unstamped is ever handed out", () => {
    const summary = exampleSetSummary();
    expect(summary.lines).toBe(exampleSetLines().length);
    expect(summary.checked).toBe(exampleSetLines().filter(lineChecked).length);
    for (const l of exampleSetLines()) expect(exampleZh(l.en)).toBe(lineChecked(l) ? l.zh : null);
    expect(exampleZh("A sentence nobody said.")).toBeNull();
    expect(TRANSLATION_LABEL["zh-Hans"]).toBe("中文翻译，以英文原话为准");
  });
});

describe("where a translation is shown", () => {
  it("an example account with the set checked: every line of the set, in Chinese pages only, only with his consent", async () => {
    const him = await account("example");
    const set = stamped();
    const zh = await zhLookup(own(him), him.scope!, { locale: "zh-Hans", exampleLines: set });
    expect(zh(R1)).toBe("在家里，我们希望血压低于 135/85。");
    expect(zh(R4)).toBe("请不要自己改药量。如果读数高，把它们写下来，下次看诊时告诉我。");
    expect(zh(` ${R2} `)).toContain("995");
    expect(zh("手腕的不太准。")).toBeNull(); // already Chinese
    expect(zh("A sentence nobody said.")).toBeNull();
    expect(zh(null)).toBeNull();
    // the English page shows the words as they were said
    expect((await zhLookup(own(him), him.scope!, { locale: "en", exampleLines: set }))(R1)).toBeNull();
    // no consent to AI processing: no translation on the page
    const noAi = await account("example", ["terms_privacy", "example_data"]);
    expect((await zhLookup(own(noAi), noAi.scope!, { locale: "zh-Hans", exampleLines: set }))(R1)).toBeNull();
    // the unstamped set (the committed file today) shows nothing by itself
    const bare = await zhLookup(own(him), him.scope!, { locale: "zh-Hans", exampleLines: checkedExampleLines() });
    expect(bare(R1)).toBe(exampleZh(R1));
  });

  it("another account never reads the example's set; it reads its own checked rows, never a rejected one", async () => {
    const blank = await account("blank");
    const set = stamped();
    expect((await zhLookup(own(blank), blank.scope!, { locale: "zh-Hans", exampleLines: set }))(R1)).toBeNull();
    await store.putTranslation(blank.userId, { direction: "en>zh-Hans", source_sha256: translationKey(R1), source_text: R1, text: "在家里，我们希望血压低于 135/85。", status: "checked", checks: {} });
    await store.putTranslation(blank.userId, { direction: "en>zh-Hans", source_sha256: translationKey(R4), source_text: R4, text: null, status: "rejected", checks: { facts: { pass: false } } });
    const zh = await zhLookup(own(blank), blank.scope!, { locale: "zh-Hans", exampleLines: set });
    expect(zh(R1)).toBe("在家里，我们希望血压低于 135/85。");
    expect(zh(R4)).toBeNull();
  });

  it("ensureExampleTranslations keeps the set's checked lines as his own rows, once; nothing for the unstamped set or another account", async () => {
    const him = await account("example");
    const scope = (await store.getSession(him.userId))!;
    expect(await ensureExampleTranslations(own(him), scope, { exampleLines: checkedExampleLines(exampleSetLines().map((l) => ({ ...l, meaning: null }))) })).toBe(0);
    const set = stamped();
    expect(await ensureExampleTranslations(own(him), scope, { exampleLines: set })).toBe(set.size);
    expect(await ensureExampleTranslations(own(him), scope, { exampleLines: set })).toBe(0);
    // every other reader of the cache finds them now (the visit review, an ask, his family's view)
    expect(await cachedTranslation(own(him), him.userId, R4, "en>zh-Hans")).toMatchObject({ text: "请不要自己改药量。如果读数高，把它们写下来，下次看诊时告诉我。", from: "cache" });
    const row = (await store.listTranslations(him.userId)).find((r) => r.source_text === R4)!;
    expect(row).toMatchObject({ status: "checked" });
    expect(JSON.stringify(row.checks)).toContain("set:example.zh.json");
    expect(JSON.stringify(row.checks)).toContain("test-checker");
    const blank = await account("blank");
    expect(await ensureExampleTranslations(own(blank), (await store.getSession(blank.userId))!, { exampleLines: set })).toBe(0);
    // offline (the mock model) nothing is sent to translate, whatever the hook
    let asked = 0;
    await ensureExampleTranslations(own(him), scope, { exampleLines: new Map(), translateVisit: async () => void asked++ });
    expect(asked).toBe(0);
  });
});

describe("the places that show a doctor's English line carry its translation", () => {
  it("the blood pressure relay, the brief and an ask on an example account whose translations are kept", async () => {
    const him = await account("example");
    const scope = (await store.getSession(him.userId))!;
    await ensureExampleTranslations(own(him), scope, { exampleLines: stamped() });
    // the relay next to a reading above the doctor's line
    const relay = await relayDoctorThreshold(own(him), scope, { systolic: 185, diastolic: 112 }, { locale: "zh-Hans" });
    expect(relay!.doctorLine.en).toBe(R2);
    expect(relay!.doctorLine.translation).toMatchObject({ lang: "zh-Hans" });
    expect(relay!.doctorLine.translation!.text).toContain("180");
    expect((await relayDoctorThreshold(own(him), scope, { systolic: 185, diastolic: 112 }, { locale: "en" }))!.doctorLine.translation).toBeUndefined();
    // the brief, as he reads it in Chinese; the doctor's English view has none
    await store.addBp(him.userId, { day: scope.story_day, slot: "morning", systolic: 185, diastolic: 112 });
    const zhBrief = await buildAccountBrief(own(him), scope, "zh-Hans", { translate: "cache" });
    expect(zhBrief.doctorZh[R1]).toBe("在家里，我们希望血压低于 135/85。");
    expect(zhBrief.doctorZh[R2]).toContain("995");
    expect((await buildAccountBrief(own(him), scope, "en", { translate: "cache" })).doctorZh).toEqual({});
    // an ask: the doctor's line with its translation under it
    const r = await ask({ sessionId: him.userId, text: "今天 150/95，我能不能多吃一粒？", locale: "zh-Hans" }, { store: own(him), llm: createMockLlm(), checker: null, costGuard: null, publish: () => undefined });
    expect(r.sentences.find((s) => s.en === R4)?.translation).toEqual({ lang: "zh-Hans", text: "请不要自己改药量。如果读数高，把它们写下来，下次看诊时告诉我。" });
    // without his consent no translation is shown, in an ask either
    const off = await ask({ sessionId: him.userId, text: "今天 150/95，我能不能多吃一粒？", locale: "zh-Hans" }, { store: own(him), llm: createMockLlm(), checker: null, costGuard: null, publish: () => undefined, aiAllowed: false });
    expect(off.sentences.find((s) => s.en === R4)).toBeDefined();
    expect(off.sentences.find((s) => s.en === R4)?.translation).toBeUndefined();
  });
});
