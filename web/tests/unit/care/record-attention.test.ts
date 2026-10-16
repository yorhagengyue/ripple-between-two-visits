/**
 * 「留意」 on her phone, as the owner decided it on 2026-10-14 (lib/care/record.ts herRecord; components/family/RecordFeed.tsx;
 * POST /api/family/questions): it lists only what needs attention, each item with a follow-up, and counts everything
 * routine in one line.
 *
 *   dose_missed    the question for his doctor is worded by the reason he chose: his own words are inside it, 忘了 has
 *                  its own sentence, a habit of his (太极) is a reason in his words; the reason's code never reaches her
 *   routine        a dose he took is no item: it is one more in the line 「近 7 日：已服药 N 次」
 *   bp_high        a reading is an item only against a number HIS DOCTOR gave and he confirmed: above the target (a
 *                  question, one item a day), above the warning level (call him); with no confirmed number, never
 *   the list       with his questions_count switch off the question is shown and cannot be added (403); with it on, one
 *                  tap adds it in her name (asked_by_user_id), a second one merges, and the item says it is on his list
 *   no duplicate   a dose missed for a habit of his, when Ripple already put a question about that pattern on his list:
 *                  that question stands as the follow-up, and nothing is written
 *   switches       a switch that is off takes its items (and the parts it alone shows) away at once
 *   her link       one she bound herself and he has not acknowledged adds nothing (409)
 *
 * Mr Tan's example account laid out on Tue 13 Oct 2026 (morning reminders 08:45 / 09:15), the process-wide memory store
 * and identity provider (the route is called for real), the developer test clock, frozen.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as familyQuestionsPost } from "@/app/api/family/questions/route";
import { QuestionLine } from "@/app/p/questions/AccountQuestions";
import { RecordFeed, allowedEntries, attentionItems, holdSubject, nextVisitRow, restCounts, shownEntries, whenWords } from "@/components/family/RecordFeed";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { addFamilyQuestion } from "@/lib/care/family-questions";
import { herRecord, type HerRecord, type RecordEntry } from "@/lib/care/record";
import { allRecordStrings, restLine } from "@/lib/care/record-copy";
import { answerDose } from "@/lib/daily/doses";
import { DELIVERY } from "@/lib/daily/no-reply";
import type { Locale } from "@/lib/i18n";
import { questionList, questionOut } from "@/lib/profile/questions";
import { getMemoryStore } from "@/lib/store/memory";
import type { CareLinkRow, FamilyGrantItems, SessionRow } from "@/lib/store/types";
import { ScopeViolation, familySubject } from "@/lib/subject";
import { setTestClock } from "@/lib/time/now";
import { agreedLink } from "../../support/agreed-link";

const store = getMemoryStore();
const auth = getAuthProvider();
const TZ = "Asia/Singapore";
const SGT = (hhmm: string) => `2026-10-13T${hhmm}:00+08:00`;
const ALL: FamilyGrantItems = { dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: true, notes: true };
const AML = "med-amlodipine";
const TODAY_MORNING = "missed:2026-10-13:morning";
/** his own words for today's missed dose, in words nothing else in his records holds */
const REASON = "去公园了，药没带在身上";
/** the spoken words this page never uses (the owner's rule for its register) */
const SPOKEN = /吃了|没吃|没回|量了血压|看了医生|去了药房/;

let him: TestAccount;
let her: TestAccount;
let blank: TestAccount;
let link: CareLinkRow;
let now = 0;

function setClock(hhmm: string): number {
  setTestClock({ at: SGT(hhmm), frozen: true });
  now = Date.parse(SGT(hhmm));
  return now;
}

async function scope(of: TestAccount = him): Promise<SessionRow> {
  const s = await store.getSession(of.userId);
  if (!s) throw new Error("no scope");
  return s;
}

/** Her record of him at this moment, under these switches. */
async function record(grants: FamilyGrantItems = ALL, locale: Locale = "zh-Hans"): Promise<HerRecord> {
  return herRecord(store, await scope(), { link, userId: her.userId, grants, version: 3, locale, acknowledged: true }, now);
}

const item = (r: HerRecord, id: string): RecordEntry | undefined => r.entries.find((e) => e.id === id);

/** He says how today's morning dose went. */
async function answer(state: "taken" | "missed", reason: string | null = null, words: string | null = null): Promise<void> {
  await answerDose(store, await scope(), { medication_id: AML, slot: "morning", state, reason, reason_text: words }, now);
}

/** POST /api/family/questions as a signed-in person, with her link in the address. */
function post(who: TestAccount, body: unknown, query = `?link=${encodeURIComponent(link.id)}`): Promise<Response> {
  return familyQuestionsPost(
    new NextRequest(`http://localhost/api/family/questions${query}`, {
      method: "POST",
      headers: { cookie: `rp_at=${who.tokens.access_token}; rp_lang=zh-Hans`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const hisQuestions = async () => store.listQuestions(him.userId);

beforeAll(async () => {
  setClock("07:30");
  him = await createAccountWithSpace(store, auth, { login: `h${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example", locale: "zh-Hans" });
  her = await createAccountWithSpace(store, auth, { login: `w${randomUUID().slice(0, 10)}`, password: "a long test password", space: "none", locale: "zh-Hans" });
  blank = await createAccountWithSpace(store, auth, { login: `b${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
  const inv = await store.createInvite({ patient_id: him.userId, patient_label: "爸爸", invite_token_hash: randomUUID(), invite_expires_at: "2099-01-01T00:00:00.000Z" }, ALL);
  if (!inv.ok) throw new Error(inv.code);
  const acc = await store.acceptInvite(inv.link.invite_token_hash!, her.userId, "Wei Ling");
  if (!acc.ok) throw new Error(acc.code);
  const ok = await store.confirmLink(inv.link.id, him.userId, true);
  if (!ok.ok) throw new Error(ok.code);
  link = ok.link;
  // her record under the text in force, as a link she bound carries (lib/care/reconsent.ts); none of his, so the last
  // describe can still make it a link he has not acknowledged (lib/care/ack.ts)
  await agreedLink(store, link, { his: false });
  setClock("09:00");
});

afterAll(() => setTestClock(null));

describe("a dose he did not take: the follow-up is a question for his doctor, worded by the reason he gave", () => {
  it("his own words: the item names the medicine, quotes him, and the question holds his words", async () => {
    setClock("08:50");
    await answer("missed", "own_words", REASON);
    setClock("09:00");
    const r = await record();
    const it = item(r, TODAY_MORNING)!;
    expect(it).toMatchObject({
      kind: "dose",
      attention: true,
      attn: "dose_missed",
      day: "2026-10-13",
      slot: "morning",
      timed: false,
      title: "Amlodipine 未服药",
      ref: "2026-10-13:morning",
      lines: [{ text: REASON, as: "said" }],
      ask: { for: "doctor", added: false, text: `10月13日早间的 Amlodipine 未服用，原因是「${REASON}」。遇到这种情况，服药时间可以怎么安排？` },
      switches: ["dose_summary"],
    });
    expect(whenWords(it, r.today, "zh-Hans", TZ)).toBe("今天 早间");
    // the option he tapped is filed under a code in his space: only his words reach her
    expect(JSON.stringify(r)).not.toContain("own_words");

    const en = item(await record(ALL, "en"), TODAY_MORNING)!;
    expect(en.title).toBe("Amlodipine not taken");
    expect(en.ask!.text).toBe(`The 13 Oct morning dose of Amlodipine was not taken. The reason given: “${REASON}”. How should the timing be handled when this happens?`);
    expect(whenWords(en, r.today, "en", TZ)).toBe("Today, morning");
  });

  it("忘了, 出门了, 药不在身边 each have their own question; no reason given says so and asks the plain one", async () => {
    const cases: [string | null, string | null, string, string][] = [
      ["forgot", "忘了", "忘了", "10月13日早间的 Amlodipine 忘记服用。漏服一次后应该怎么处理？"],
      ["away", "出门了", "出门了", "10月13日早间外出，Amlodipine 未服用。外出时服药时间可以怎么安排？"],
      ["not_with_me", "药不在身边", "药不在身边", "10月13日早间药不在身边，Amlodipine 未服用。这种情况应该怎么处理？"],
      // a chip tapped with no words kept: the chip's own words are the reason (lib/daily/schedule.ts FIXED_REASONS, 10-14)
      ["forgot", null, "忘记服用", "10月13日早间的 Amlodipine 忘记服用。漏服一次后应该怎么处理？"],
    ];
    for (const [code, words, said, question] of cases) {
      await answer("missed", code, words);
      const r = await record();
      const it = item(r, TODAY_MORNING)!;
      expect(it.lines, String(code)).toEqual([{ text: said, as: "said" }]);
      expect(it.ask, String(code)).toEqual({ text: question, for: "doctor", added: false });
      expect(JSON.stringify(r), String(code)).not.toMatch(/"forgot"|"away"|not_with_me/);
    }
    await answer("missed");
    const none = item(await record(), TODAY_MORNING)!;
    expect(none.lines).toEqual([{ text: "未说明原因" }]);
    expect(none.ask!.text).toBe("10月13日早间的 Amlodipine 未服用。漏服一次后应该怎么处理？");
    expect(item(await record(ALL, "en"), TODAY_MORNING)).toMatchObject({ lines: [{ text: "No reason given" }], ask: { text: "The 13 Oct morning dose of Amlodipine was not taken. What should be done after a missed dose?" } });
  });

  it("a reason of his own that is very long is cut short inside the question, which stays within what his list takes", async () => {
    const long = "早上".repeat(200);
    await answer("missed", "own_words", long);
    const q = item(await record(), TODAY_MORNING)!.ask!.text;
    expect([...q].length).toBeLessThanOrEqual(300);
    expect(q).toMatch(/^10月13日早间的 Amlodipine 未服用，原因是「(早上)+…」。遇到这种情况，服药时间可以怎么安排？$/);
  });
});

describe("routine: a dose he took is not an item, it is counted", () => {
  it("taken: no item for that part of the day, one more in 「近 7 日：已服药 N 次」", async () => {
    await answer("missed", "own_words", REASON);
    const before = restCounts(shownEntries((await record()).entries, ALL));
    await answer("taken");
    const r = await record();
    const rows = shownEntries(r.entries, ALL);
    expect(item(r, TODAY_MORNING)).toBeUndefined();
    expect(attentionItems(rows).filter((e) => e.kind === "dose" && e.day === "2026-10-13")).toEqual([]);
    // the routine entry carries nothing to draw: a count, and the switch that shows it
    expect(item(r, "dose:2026-10-13:morning")).toMatchObject({ attention: false, title: "", count: 1, switches: ["dose_summary"] });
    const counts = restCounts(rows);
    expect(counts.doses).toBe(before.doses + 1);
    expect(restLine(counts, "zh-Hans")).toMatch(new RegExp(`^近 7 日：已服药 ${counts.doses} 次`));
    expect(restLine({ doses: 12, bp: 5, visits: 1 }, "zh-Hans")).toBe("近 7 日：已服药 12 次 · 血压测量 5 次 · 就诊 1 次");
    expect(restLine({ doses: 1, bp: 0, visits: 2 }, "en")).toBe("Last 7 days: 1 dose taken · 2 clinic visits");
    expect(restLine({ doses: 0, bp: 0, visits: 0 }, "zh-Hans")).toBeNull();
    // back to the dose he did not take, for what follows
    await answer("missed", "own_words", REASON);
  });
});

describe("a reading: an item only against his doctor's own number", () => {
  it("above the target he confirmed: ONE item for all the days above it, each day's highest as a line, a question that counts the last 7 days", async () => {
    const s = await scope();
    const first = await store.addBp(s.id, { day: s.story_day, slot: "morning", systolic: 147, diastolic: 93, created_at: new Date(Date.parse(SGT("08:20"))).toISOString() });
    let r = await record();
    const top = item(r, `bp:${first.id}`)!;
    // the example's earlier readings above his target are lines of the same item, newest day first
    const days = top.lines!.length;
    expect(days).toBeGreaterThanOrEqual(2);
    expect(top).toMatchObject({ kind: "bp", attention: true, attn: "bp_high", timed: true, title: `近 14 日有 ${days} 天血压高于医生设定的目标 135/85`, ref: first.id, switches: ["bp_summary"] });
    expect(top.lines![0]!.text.endsWith("147/93")).toBe(true);
    expect(r.entries.filter((e) => e.attn === "bp_high").map((e) => e.id)).toEqual([`bp:${first.id}`]);
    const counted = /^近 7 日有 (\d+) 次血压高于目标 135\/85，最高 147\/93。需要注意什么？$/.exec(top.ask!.text);
    expect(counted, top.ask!.text).not.toBeNull();
    const weekBefore = Number(counted![1]);
    expect(weekBefore).toBeGreaterThanOrEqual(2);
    expect(top.ask).toMatchObject({ for: "doctor", added: false });
    expect(whenWords(top, r.today, "zh-Hans", TZ)).toBe("今天 8:20");
    expect(item(await record(ALL, "en"), `bp:${first.id}`)!.title).toBe(`Blood pressure above the doctor's target of 135/85 on ${days} days in the last 14`);

    // a second reading above the target the same day folds into the highest: it is routine, and the question counts it
    const second = await store.addBp(s.id, { day: s.story_day, slot: "morning", systolic: 139, diastolic: 83, created_at: new Date(Date.parse(SGT("08:30"))).toISOString() });
    // a reading that equals the target is not above it
    const equal = await store.addBp(s.id, { day: s.story_day, slot: "morning", systolic: 135, diastolic: 85, created_at: new Date(Date.parse(SGT("08:40"))).toISOString() });
    r = await record();
    expect(r.entries.filter((e) => e.attn === "bp_high").map((e) => e.id)).toEqual([`bp:${first.id}`]);
    expect(item(r, `bp:${second.id}`)).toMatchObject({ attention: false, count: 1, title: "" });
    expect(item(r, `bp:${equal.id}`)).toMatchObject({ attention: false, count: 1 });
    expect(item(r, `bp:${first.id}`)!.ask!.text).toBe(`近 7 日有 ${weekBefore + 1} 次血压高于目标 135/85，最高 147/93。需要注意什么？`);
    expect(restCounts(shownEntries(r.entries, ALL)).bp).toBe(2);
  });

  it("above the warning level he confirmed: the follow-up is to call him, never a question of Ripple's", async () => {
    const s = await scope();
    const high = await store.addBp(s.id, { day: s.story_day, slot: "morning", systolic: 185, diastolic: 112, created_at: new Date(Date.parse(SGT("08:45"))).toISOString() });
    const r = await record();
    const it = item(r, `bp:${high.id}`)!;
    expect(it).toMatchObject({ attention: true, attn: "bp_high", title: "血压 185/112，高于医生设定的警戒值 180", call: true });
    expect(it.ask).toBeUndefined();
    expect(holdSubject(it, ALL)).toEqual({ type: "bp", ref: high.id });
    await store.deleteBp(s.id, high.id);
  });

  it("with no number confirmed by him, no reading is ever an item: it is counted, nothing more", async () => {
    const s = await scope(blank);
    await store.addBp(s.id, { day: s.story_day, slot: "morning", systolic: 185, diastolic: 112 });
    await store.addBp(s.id, { day: s.story_day, slot: "evening", systolic: 147, diastolic: 93 });
    const r = await herRecord(store, s, { link: { id: "no-such-link" }, grants: ALL, acknowledged: true }, now);
    expect(attentionItems(r.entries)).toEqual([]);
    expect(restCounts(r.entries)).toEqual({ doses: 0, bp: 2, visits: 0 });
    expect(JSON.stringify(r)).not.toMatch(/高于|above/);
  });
});

describe("his question list: shown only with questions_count on, and written only through it", () => {
  it("the switch off: the question is there to pass on, nothing of his list is read, and the route answers 403", async () => {
    const off = { ...ALL, questions_count: false };
    const r = await record(off);
    const it = item(r, TODAY_MORNING)!;
    expect(it.ask).toEqual({ for: "doctor", added: false, text: `10月13日早间的 Amlodipine 未服用，原因是「${REASON}」。遇到这种情况，服药时间可以怎么安排？` });
    expect(nextVisitRow(r.entries)).toBeUndefined();
    expect(r.entries.some((e) => e.attn === "visit_soon")).toBe(false);

    const before = (await hisQuestions()).length;
    await store.setFamilyGrant(him.userId, link.id, { questions_count: false });
    const res = await post(her, { entry: TODAY_MORNING });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not_shared" });
    expect((await hisQuestions()).length).toBe(before);
    await store.setFamilyGrant(him.userId, link.id, { questions_count: true });
  });

  it("one tap puts it on his list in her name; a second one merges; the item then says it is on his list", async () => {
    const before = await hisQuestions();
    const text = item(await record(), TODAY_MORNING)!.ask!.text;

    const res = await post(her, { entry: TODAY_MORNING });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ outcome: "created", added: true });
    const after = await hisQuestions();
    expect(after.length).toBe(before.length + 1);
    const row = after.find((q) => !before.some((b) => b.id === q.id))!;
    expect(row).toMatchObject({ for: "doctor", origin: "own", status: "open", text, asked_by_user_id: her.userId });

    const again = await post(her, { entry: TODAY_MORNING });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ outcome: "merged", added: true });
    expect((await hisQuestions()).length).toBe(before.length + 1);

    // her record: marked added, in whichever language her page is
    expect(item(await record(), TODAY_MORNING)!.ask).toEqual({ text, for: "doctor", added: true });
    expect(item(await record(ALL, "en"), TODAY_MORNING)!.ask!.added).toBe(true);

    // his side: the list says a family member added it, and never who
    const list = await questionList(store, await scope(), "zh-Hans");
    expect(list.open.find((q) => q.id === row.id)).toMatchObject({ text, fromFamily: true, origin: "own" });
    expect(list.open.filter((q) => q.id !== row.id).every((q) => q.fromFamily === false)).toBe(true);
    const mine = renderToStaticMarkup(createElement(QuestionLine, { q: list.open.find((q) => q.id === row.id)!, locale: "zh-Hans" }));
    expect(mine).toContain("家人加的");
    expect(mine).toContain('data-from-family="true"');
    expect(mine).not.toContain("我自己想问的");
    const own = renderToStaticMarkup(createElement(QuestionLine, { q: list.open.find((q) => q.id === "q-knee-2")!, locale: "zh-Hans" }));
    expect(own).toContain("我自己想问的");
    expect(own).not.toMatch(/家人加的|data-from-family/);
    const out = questionOut(row, await scope());
    expect(out.from_family).toBe(true);
    expect(JSON.stringify(out)).not.toContain(her.userId);
    expect(Object.keys(out)).not.toContain("asked_by_user_id");
  });

  it("the route takes an item's id and nothing else: no text of hers, no unknown item, not his own account", async () => {
    const count = (await hisQuestions()).length;
    expect((await post(her, { entry: TODAY_MORNING, text: "把药停了吧" })).status).toBe(400);
    expect((await post(her, {})).status).toBe(400);
    const none = await post(her, { entry: "missed:1999-01-01:morning" });
    expect(none.status).toBe(404);
    expect(await none.json()).toEqual({ error: "entry_not_found" });
    // an item with no suggested question (the next visit)
    expect((await post(her, { entry: "visit_soon" })).status).toBe(404);
    expect((await post(him, { entry: TODAY_MORNING }, "")).status).toBe(404);
    expect((await hisQuestions()).length).toBe(count);
  });

  // asking or not is his: what he set aside stays set aside, and her item says so in the place of the button
  it("he sets her question aside: the item says so, and her tap puts nothing back", async () => {
    const text = item(await record(), TODAY_MORNING)!.ask!.text;
    const row = (await hisQuestions()).find((q) => q.text === text)!;
    await store.updateQuestion(him.userId, row.id, { status: "skipped" });
    expect(item(await record(), TODAY_MORNING)!.ask).toMatchObject({ added: false, aside: true });
    const count = (await hisQuestions()).length;
    const res = await post(her, { entry: TODAY_MORNING });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "aside", added: false });
    expect((await hisQuestions()).length).toBe(count);
    expect((await store.getQuestion(him.userId, row.id))!.status).toBe("skipped");
  });

  it("through her link the store lets her do exactly that: a question in her own name, and no change to one that is there", async () => {
    const s = await scope();
    const hers = familySubject(store, s, her.userId, link).store;
    const mine = (await hisQuestions()).find((q) => q.asked_by_user_id === her.userId)!;
    const his = (await hisQuestions()).find((q) => q.id === "q-knee-2")!;
    await expect(hers.addQuestion(s.id, { for: "doctor", origin: "own", text: "x" })).rejects.toBeInstanceOf(ScopeViolation);
    await expect(hers.addQuestion(s.id, { for: "doctor", origin: "own", text: "x", asked_by_user_id: him.userId })).rejects.toBeInstanceOf(ScopeViolation);
    await expect(hers.addQuestion(s.id, { for: "doctor", origin: "pattern", text: "x", asked_by_user_id: her.userId })).rejects.toBeInstanceOf(ScopeViolation);
    await expect(hers.addQuestion(s.id, { for: "doctor", origin: "own", text: "x", asked_by_user_id: her.userId, status: "answered", answer_text: "y" })).rejects.toBeInstanceOf(ScopeViolation);
    await expect(hers.updateQuestion(s.id, his.id, { text: "别的话" })).rejects.toBeInstanceOf(ScopeViolation);
    await expect(hers.updateQuestion(s.id, his.id, { status: "skipped" })).rejects.toBeInstanceOf(ScopeViolation);
    await expect(hers.updateQuestion(s.id, mine.id, { status: "open", text: "别的话" })).rejects.toBeInstanceOf(ScopeViolation);
    // not even putting back one he set aside
    await expect(hers.updateQuestion(s.id, his.id, { status: "open" })).rejects.toBeInstanceOf(ScopeViolation);
    const aside = (await hisQuestions()).find((q) => q.status === "skipped" && !q.merged_into)!;
    await expect(hers.updateQuestion(s.id, aside.id, { status: "open" })).rejects.toBeInstanceOf(ScopeViolation);
    expect((await addFamilyQuestion(hers, s, { linkId: link.id, userId: her.userId, text: aside.text, for: aside.for })).outcome).toBe("aside");
    expect((await store.getQuestion(s.id, his.id))!.text).toBe(his.text);
    // the one door: addFamilyQuestion on her store (the caller has checked his switch)
    const added = await addFamilyQuestion(hers, s, { linkId: link.id, userId: her.userId, text: "下次复诊前需要空腹吗？", for: "doctor" });
    expect(added.outcome).toBe("created");
    expect(await store.getQuestion(s.id, added.id)).toMatchObject({ asked_by_user_id: her.userId, origin: "own", status: "open", text: "下次复诊前需要空腹吗？" });
    expect((await addFamilyQuestion(hers, s, { linkId: link.id, userId: her.userId, text: "下次复诊前需要空腹吗", for: "doctor" })).outcome).toBe("merged");
  });
});

describe("a dose missed for a habit of his", () => {
  const TAI_CHI = "missed:2026-10-07:morning";

  // owner 10-14: 「周四我要打太极，那么我周四能不能换个时间吃药」 is the question he wants on the item. The line Ripple put
  // on his list from the pattern in his log says what happened; it does not stand in for the question
  it("the item offers its own question, his words as the reason, whatever Ripple's line about the pattern says on his list", async () => {
    const s = await scope();
    const pattern = (await questionList(store, s, "zh-Hans")).open.find((q) => q.origin === "pattern")!;
    expect(pattern).toBeTruthy();
    const r = await record();
    const it = item(r, TAI_CHI)!;
    expect(it).toMatchObject({ attn: "dose_missed", title: "Amlodipine 未服药", lines: [{ text: "打太极，忘了", as: "said" }] });
    expect(it.ask).toEqual({ for: "doctor", added: false, text: "10月7日早间的 Amlodipine 未服用，原因是「打太极，忘了」。遇到这种情况，服药时间可以怎么安排？" });
    const html = draw(shownEntries(r.entries, ALL), r, ALL);
    const card = html.slice(html.indexOf(`data-explain-ref="2026-10-07:morning"`), html.indexOf("</li>", html.indexOf(`data-explain-ref="2026-10-07:morning"`)));
    expect(card).toContain("原因是「打太极，忘了」");
    expect(card).not.toContain(pattern.text);
    expect(card).not.toContain("已加入问题单");
  });

  it("with his questions not shared the question stays, to pass on; no button", async () => {
    const off = { ...ALL, questions_count: false };
    const r = await record(off);
    const it = item(r, TAI_CHI)!;
    expect(it.ask).toEqual({ for: "doctor", added: false, text: "10月7日早间的 Amlodipine 未服用，原因是「打太极，忘了」。遇到这种情况，服药时间可以怎么安排？" });
    // and on her open page, the moment he switches his questions off
    const cut = allowedEntries((await record()).entries, off).find((e) => e.id === TAI_CHI)!;
    expect(cut.ask!.text).toBe(it.ask!.text);
    const html = draw(allowedEntries((await record()).entries, off), r, off);
    expect(html).toContain("爸爸没有分享问题单，可以直接转告。");
    expect(html).not.toContain("加入问题单</span></button>");
  });

  it("a habit with no words kept is named by his routine", async () => {
    const s = await scope();
    const row = (await store.listDoses(s.id, { fromDay: s.story_day - 6, toDay: s.story_day - 6 })).find((d) => d.medication_id === AML)!;
    expect(row).toMatchObject({ state: "missed", reason: "tai_chi_morning" });
    await store.logDose(s.id, { medication_id: AML, day: row.day, slot: "morning", state: "missed", reason: "tai_chi_morning", reason_text: null });
    const it = item(await record(), TAI_CHI)!;
    expect(it.lines).toEqual([{ text: "打太极", as: "said" }]);
    expect(it.ask).toEqual({ for: "doctor", added: false, text: "10月7日早间的 Amlodipine 未服用，原因是「打太极」。遇到这种情况，服药时间可以怎么安排？" });
    expect(item(await record(ALL, "en"), TAI_CHI)!.ask!.text).toContain("The reason given: “Tai chi”.");
  });
});

describe("the rest of the screen", () => {
  it("the next visit is a row of its own; near, with questions waiting, it is an item too; a note is an item with a question", async () => {
    const r = await record();
    const next = nextVisitRow(r.entries)!;
    expect(next).toMatchObject({ kind: "next_visit", attention: false, title: "下次就诊", value: "今天", ref: "" });
    const soon = item(r, "visit_soon")!;
    expect(soon).toMatchObject({ kind: "next_visit", attention: true, attn: "visit_soon", title: "今天就诊" });
    expect(soon.lines!.at(-1)!.text).toMatch(/^问题单上有 \d+ 个问题待问$/);
    expect(soon.ask).toBeUndefined();
    expect(soon.call).toBeUndefined();
    expect(holdSubject(soon, ALL)).toEqual({ type: "next_visit", ref: "" });
    expect(whenWords(soon, r.today, "zh-Hans", TZ)).toBe("10月13日 周二");
    // the visit's item stands first of what needs attention; the rest is newest first
    const items = attentionItems(shownEntries(r.entries, ALL));
    expect(items[0].id).toBe("visit_soon");
    const days = items.slice(1).map((e) => e.day);
    expect(days).toEqual([...days].sort().reverse());

    const note = r.entries.find((e) => e.attn === "note")!;
    expect(note).toMatchObject({ kind: "note", attention: true, switches: ["notes"] });
    expect(note.lines![0]).toMatchObject({ as: "quote" });
    expect(note.ask!.text).toMatch(/^10月\d+日的记录：「.+」。这种情况需要注意什么？$/);
    expect(note.ask!.text).not.toContain("。」");
    expect(holdSubject(note, ALL)).toBeNull();
  });

  it("two reminders of a past day he never answered: an item whose follow-up is to call him; the medicines only with his medicine shared", async () => {
    const s = await scope();
    const day = s.story_day - 1;
    await store.logDose(s.id, { medication_id: AML, day, slot: "morning", state: "unconfirmed", reason: "no_reply", reason_text: null });
    await store.recordDelivery(s.id, { kind: DELIVERY.familyNoReply, ref: link.id, day, slot: "morning" });
    const r = await record();
    const it = item(r, "no_reply:2026-10-12:morning")!;
    expect(it).toMatchObject({ kind: "no_reply", attention: true, attn: "no_reply", title: "两次提醒均未回应", slot: "morning", call: true, ref: "2026-10-12:morning", lines: [{ text: "Amlodipine" }], switches: ["no_reply_alert"], only: { lines: "dose_summary" } });
    expect(it.ask).toBeUndefined();
    expect(whenWords(it, r.today, "zh-Hans", TZ)).toBe("昨天 早间");
    expect(holdSubject(it, ALL)).toEqual({ type: "dose", ref: "2026-10-12:morning" });
    // with the alert alone: that it happened, never which medicine, and nothing to hold
    const alertOnly = { ...ALL, dose_summary: false };
    const built = item(await record(alertOnly), "no_reply:2026-10-12:morning")!;
    expect(built.lines).toBeUndefined();
    expect(JSON.stringify(await record(alertOnly))).not.toContain("Amlodipine");
    const cut = allowedEntries(r.entries, alertOnly).find((e) => e.id === it.id)!;
    expect(cut.lines).toBeUndefined();
    expect(holdSubject(cut, alertOnly)).toBeNull();
    // he answers after all: routine
    await store.logDose(s.id, { medication_id: AML, day, slot: "morning", state: "taken", reason: null, reason_text: null });
    expect(item(await record(), "no_reply:2026-10-12:morning")).toBeUndefined();
  });

  it("a switch he turns off takes its items away at once, and what the server builds without it is the same", async () => {
    const r = await record();
    const kinds = (rows: readonly RecordEntry[]) => [...new Set(rows.map((e) => `${e.kind}/${e.attn ?? (e.attention ? "" : "routine")}`))].sort();
    expect(kinds(r.entries)).toEqual(expect.arrayContaining(["dose/dose_missed", "dose/routine", "bp/bp_high", "bp/routine", "next_visit/routine", "next_visit/visit_soon", "note/note"]));
    const gone: [keyof FamilyGrantItems, (e: RecordEntry) => boolean][] = [
      ["dose_summary", (e) => e.kind === "dose"],
      ["bp_summary", (e) => e.kind === "bp"],
      ["questions_count", (e) => e.kind === "next_visit"],
      ["notes", (e) => e.kind === "note"],
    ];
    for (const [off, mine] of gone) {
      const grants = { ...ALL, [off]: false };
      const cut = allowedEntries(r.entries, grants);
      expect(r.entries.some(mine), off).toBe(true);
      expect(cut.some(mine), off).toBe(false);
      expect(cut.length, off).toBe(r.entries.filter((e) => !mine(e)).length);
      // nothing of that kind is read for a record built with the switch off
      expect((await record(grants)).entries.some(mine), off).toBe(false);
    }
    expect(allowedEntries(r.entries, { dose_summary: false, bp_summary: false, questions_count: false, no_reply_alert: false, visit_transcripts: false, notes: false })).toEqual([]);
    const none = restCounts(allowedEntries(r.entries, { ...ALL, dose_summary: false, bp_summary: false }));
    expect(none).toMatchObject({ doses: 0, bp: 0 });
  });

  it("drawn: the three parts, the page's own register, and each card held for Ripple's read", async () => {
    const r = await record();
    const rows = shownEntries(r.entries, ALL);
    const html = draw(rows, r, ALL);
    expect(html).toContain("需要留意");
    expect(html).toContain("其余记录");
    expect(html).toMatch(/近 7 日：已服药 \d+ 次/);
    expect(html).toContain("在日历中查看每日记录");
    expect(html).toContain(`href="/f/month?link=${link.id}"`);
    // the visit is today with questions waiting: it is an item (「今天就诊」), and the plain row is not drawn a second time
    expect(html).toContain("今天就诊");
    expect(html).not.toContain('data-testid="record-next"');
    expect(html).toContain("建议问医生");
    // his reason, quoted and attributed; his words keep their own element
    expect(html).toContain(`爸爸说：「<span>${REASON}</span>」`);
    // each item is a card that says what holding it asks about
    expect(html.match(/data-testid="attention-item"/g)!.length).toBe(attentionItems(rows).length);
    expect(html).toContain('data-attn="dose_missed" data-kind="dose" data-day="2026-10-13" data-explain-type="dose" data-explain-ref="2026-10-13:morning"');
    expect(html).toContain('data-rpx-type="dose" data-rpx-ref="2026-10-13:morning"');
    expect(html).toContain('data-explain-type="next_visit" data-explain-ref=""');
    // a note is not held
    expect(html).not.toContain('data-rpx-type="note"');
    // nothing routine is listed: no card for a dose he took
    expect(html).not.toContain('data-explain-ref="2026-10-12:morning"');
    // the page's fixed words are a log's, in both languages; the drawn page too (his own words apart)
    for (const [key, words] of allRecordStrings("zh-Hans")) expect(words, key).not.toMatch(SPOKEN);
    expect(html.replace(/<span[^>]*>[^<]*<\/span>/g, "")).not.toMatch(SPOKEN);
    expect(allRecordStrings("en").map(([k]) => k)).toEqual(allRecordStrings("zh-Hans").map(([k]) => k));

    // nothing needs attention: one quiet sentence, and the line of the rest stays
    const quiet = draw(rows.filter((e) => !e.attention), r, ALL);
    expect(quiet).toContain("近 14 日没有需要留意的事。");
    expect(quiet).not.toContain('data-testid="attention-item"');
    // he shares nothing: one sentence, nothing else
    expect(draw([], r, { ...ALL, dose_summary: false }, false)).toBe('<p class="rpf rpfr-empty" data-rp="record-empty" data-testid="record-empty" data-shared="false">爸爸尚未分享任何记录。</p>');
  });
});

describe("a link she bound herself that he has not acknowledged", () => {
  it("the question is shown and cannot be added: the record says so, and the route answers 409", async () => {
    await store.addAccountEvent(him.userId, "family_bound", { link_id: link.id, by: "family" });
    const r = await herRecord(store, await scope(), { link, grants: ALL, locale: "zh-Hans" }, now);
    expect(r.acknowledged).toBe(false);
    // an item whose question is not on his list yet (today's reading above the target)
    const open = r.entries.find((e) => e.attn === "bp_high" && e.ask && !e.ask.added)!;
    const count = (await hisQuestions()).length;
    const res = await post(her, { entry: open.id });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "link_not_acknowledged" });
    expect((await hisQuestions()).length).toBe(count);
    const html = draw(shownEntries(r.entries, ALL), r, ALL);
    expect(html).toContain("等爸爸在自己的手机上点了「知道了」，才能加入问题单。");
    expect(html).not.toContain("加入问题单</span></button>");
  });
});

/** Her screen's list, drawn from these entries under these switches. */
function draw(entries: readonly RecordEntry[], r: HerRecord, grants: FamilyGrantItems, shared = true): string {
  return renderToStaticMarkup(
    createElement(RecordFeed, {
      entries,
      today: r.today,
      locale: "zh-Hans",
      tz: TZ,
      dad: "爸爸",
      linkId: link.id,
      grants,
      acknowledged: r.acknowledged,
      phone: "+65 9123 4567",
      calendarHref: `/f/month?link=${link.id}`,
      shared,
    }),
  );
}
