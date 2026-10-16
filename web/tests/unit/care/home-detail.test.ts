/**
 * Each switch shows its kind in full while it is on, and nothing of it while it is off (the owner's decision of
 * 2026-10-14; lib/care/home.ts builds by it on the server, lib/care/hide.ts cuts by it on her page). Until that day the
 * first three switches gave her only "whether and how many": no reason for a dose he did not take, a count of readings,
 * a count of questions.
 *
 *   dose_summary      the reason he gave for a dose he did not take reaches her only with this switch on
 *   bp_summary        the readings themselves (and the pulse he recorded) only with this one
 *   questions_count   the questions' words, who each is for, and the next visit's place only with this one
 *   on her page       a kind he switches off while her page is open leaves the copy it holds at once, detail and all
 * and what stays hidden whatever is on: with the no-reply switch alone, nothing of his medicine but the alert.
 * Then her home as it is drawn from that copy (components/family-ui FamilyHome, lib/care/her-view.ts): the reason as one
 * quiet line under the large sentence, his latest reading as the blood pressure row's value with a small line under
 * it, his questions' words under their row, the next visit's place under its date.
 *
 * Mr Tan's example account on Tue 13 Oct 2026 (morning reminders 08:45 / 09:15): at 08:50 he says he did not take his
 * morning medicine and why, in words no other part of his records holds; he records two readings with words of their
 * own as numbers; he writes a question for the doctor and one for the pharmacist. Every check scans the whole copy she
 * is sent for those words and numbers, so a field added later cannot carry them out by another door.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FamilyHome } from "@/components/family-ui";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { missedReasonLine } from "@/lib/care/copy";
import { HOME_QUESTIONS, herPaths, homeFacts, homeHeadline, homeReason } from "@/lib/care/her-view";
import { hideOff } from "@/lib/care/hide";
import { QUESTIONS_SHOWN, familyHome } from "@/lib/care/home";
import type { FamilyHomeData } from "@/lib/care/home-types";
import { answerDose } from "@/lib/daily/doses";
import { NO_GRANTS } from "@/lib/family/types";
import { MemoryStore } from "@/lib/store/memory";
import type { CareLinkRow, FamilyGrantItems, SessionRow } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";

const store = new MemoryStore();
const SGT = (hhmm: string) => `2026-10-13T${hhmm}:00+08:00`;
const ALL: FamilyGrantItems = { dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: true, notes: true };

/** his words and numbers, chosen so that nothing else in the example's records holds them */
const REASON = "去公园了，药没带在身上";
const READING = { systolic: 147, diastolic: 93, pulse: 61 };
const EARLIER = { systolic: 139, diastolic: 83 };
const FOR_DOCTOR = "早上头晕的时候要不要先量血压再吃药";
const FOR_PHARMACIST = "这两种药可以一起吃吗，要隔多久";

let him: TestAccount;
let link: CareLinkRow;
let now = 0;

function setClock(hhmm: string): number {
  setTestClock({ at: SGT(hhmm), frozen: true });
  return Date.parse(SGT(hhmm));
}

async function scope(): Promise<SessionRow> {
  const s = await store.getSession(him.userId);
  if (!s) throw new Error("no scope");
  return s;
}

/** Her copy of his day at 09:00 under these switches. */
async function copy(grants: Partial<FamilyGrantItems>): Promise<FamilyHomeData> {
  return familyHome(store, await scope(), { link, grants: { ...NO_GRANTS, ...grants }, version: 4 }, now);
}

/** everything of his in the copy, as text (her own reminder left out: it is hers whatever his switches) */
const text = (home: FamilyHomeData) => JSON.stringify({ ...home, reminder: null });
const numbers = (r: { systolic: number; diastolic: number }) => [`"systolic":${r.systolic}`, `"diastolic":${r.diastolic}`];

beforeAll(async () => {
  setClock("07:30");
  const auth = getAuthProvider();
  him = await createAccountWithSpace(store, auth, { login: `h${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  const her = await createAccountWithSpace(store, auth, { login: `w${randomUUID().slice(0, 10)}`, password: "a long test password", space: "none" });
  const inv = await store.createInvite({ patient_id: him.userId, patient_label: "爸爸", invite_token_hash: randomUUID(), invite_expires_at: "2099-01-01T00:00:00.000Z" }, ALL);
  if (!inv.ok) throw new Error(inv.code);
  const acc = await store.acceptInvite(inv.link.invite_token_hash!, her.userId, "Wei Ling");
  if (!acc.ok) throw new Error(acc.code);
  const ok = await store.confirmLink(inv.link.id, him.userId, true);
  if (!ok.ok) throw new Error(ok.code);
  link = ok.link;

  // 08:10 and 08:20: two readings this morning, the later one with the pulse
  const today = (await scope()).story_day;
  await store.addBp(him.userId, { day: today, slot: "morning", ...EARLIER, created_at: new Date(setClock("08:10")).toISOString() });
  await store.addBp(him.userId, { day: today, slot: "morning", ...READING, created_at: new Date(setClock("08:20")).toISOString() });
  // a reading he did not take is not a reading (it has no numbers), and one he deleted is not listed
  await store.addBp(him.userId, { day: today, slot: "evening", state: "unconfirmed" });
  // 08:30 and 08:31: his two questions (a question is stamped with the moment it is written)
  setClock("08:30");
  await store.addQuestion(him.userId, { for: "doctor", origin: "own", text: FOR_DOCTOR, lang: "zh-Hans" });
  setClock("08:31");
  await store.addQuestion(him.userId, { for: "pharmacist", origin: "own", text: FOR_PHARMACIST, lang: "zh-Hans" });
  // 08:50, after the first reminder: 「没吃」, and why, in his own words
  now = setClock("08:50");
  await answerDose(store, await scope(), { medication_id: "med-amlodipine", slot: "morning", state: "missed", reason: "own_words", reason_text: REASON }, now);
  now = setClock("09:00");
});

afterAll(() => setTestClock(null));

describe("dose_summary: the reason he gave for a dose he did not take", () => {
  it("reaches her with the switch on: on today's cell and on the week's, with the medicine's name and when he answered", async () => {
    const home = await copy({ dose_summary: true });
    expect(home.status?.state).toBe("missed");
    expect(home.status?.slot?.cells).toEqual([expect.objectContaining({ name: "Amlodipine", mark: "missed", reason: REASON, at: expect.stringMatching(/^2026-10-13T00:50/) })]);
    const today = home.week?.days.find((d) => d.isToday);
    expect(today?.slots.flatMap((s) => s.cells).map((c) => c.reason)).toEqual([REASON]);
    // the option's code stays in his space: her copy holds his words, not what Ripple filed them under
    expect(text(home)).not.toContain("own_words");
  });

  it("does not reach her with the switch off, whatever else is on", async () => {
    const others = await copy({ ...ALL, dose_summary: false });
    expect(text(others)).not.toContain(REASON);
    expect(text(others)).not.toContain("Amlodipine");
    expect(others.status).toBeNull();
    expect(others.week).toBeNull();
    expect(text(await copy({}))).not.toContain(REASON);
  });

  it("the no-reply switch on alone shows nothing of it: he answered in time, so there is no alert and nothing of his medicine", async () => {
    const alertOnly = await copy({ no_reply_alert: true });
    expect(alertOnly.status).toBeNull();
    expect(alertOnly.noReply).toBeNull();
    expect(alertOnly.timeline).toEqual([]);
    expect(text(alertOnly)).not.toContain(REASON);
    expect(text(alertOnly)).not.toMatch(/Amlodipine|"missed"/);
  });
});

describe("bp_summary: the readings themselves", () => {
  it("reach her with the switch on: newest first, the numbers, the pulse when he recorded one, and when", async () => {
    const home = await copy({ bp_summary: true });
    const mine = home.bp!.readings.filter((r) => r.date === "2026-10-13");
    expect(mine).toEqual([
      { id: expect.any(String), date: "2026-10-13", slot: "morning", at: "2026-10-13T00:20:00.000Z", ...READING },
      { id: expect.any(String), date: "2026-10-13", slot: "morning", at: "2026-10-13T00:10:00.000Z", ...EARLIER, pulse: null },
    ]);
    // the latest reading is the first one, and the count is of the same rows (this week, recorded, both numbers)
    expect(home.bp!.readings[0]).toMatchObject(READING);
    expect(home.bp!.count).toBe(home.bp!.readings.length);
    expect(home.bp!.readings.every((r) => r.date >= "2026-10-12" && r.date <= "2026-10-13")).toBe(true);
    // a reading laid out with the example (not recorded on its own day) keeps its day and part of the day, no time
    for (const r of home.bp!.readings.filter((x) => x.date !== "2026-10-13")) expect(r.at).toBeNull();
    // the row's id is what her screen names when she holds the reading (owner 10-14: the long press on her side); never
    // its note or its history
    expect(Object.keys(home.bp!.readings[0]).sort()).toEqual(["at", "date", "diastolic", "id", "pulse", "slot", "systolic"]);
  });

  it("do not reach her with the switch off: not a number of them, whatever else is on", async () => {
    const others = await copy({ ...ALL, bp_summary: false });
    expect(others.bp).toBeNull();
    for (const n of [...numbers(READING), ...numbers(EARLIER), `"pulse":${READING.pulse}`]) expect(text(others), n).not.toContain(n);
    // and his last record she may know of is not the reading
    expect(others.lastRecord?.what ?? "dose").toBe("dose");
    expect((await copy({})).bp).toBeNull();
  });
});

describe("her home, as it is drawn (FamilyHome)", () => {
  const paths = herPaths("link-1");
  const TZ = "Asia/Singapore";
  const draw = (home: FamilyHomeData, locale: "zh-Hans" | "en", noReply = false) =>
    renderToStaticMarkup(
      createElement(FamilyHome, {
        locale,
        kicker: "10月13日 周二",
        status: homeHeadline(home, locale === "en" ? "Dad" : "爸爸", locale, TZ),
        reason: homeReason(home, locale) ?? undefined,
        noReply: noReply ? { title: "爸爸尚未回应早间药物提醒。", detail: "两次提醒均未回应。" } : undefined,
        stats: homeFacts(home, locale, paths, undefined, TZ),
        recordHref: paths.reminder,
        sharedHref: paths.shared,
        privacy: "这些是爸爸同意给你看的。",
      }),
    );
  const rows = (html: string) => [...html.matchAll(/data-rp="family-stat"[^>]*>(.*?)<\/div>/g)].map((m) => m[1].replace(/<[^>]+>/g, "|").replace(/\|+/g, "|"));

  it("under the large sentence: one quiet line with the reason he gave for today's missed dose", async () => {
    const home = await copy(ALL);
    expect(homeHeadline(home, "爸爸", "zh-Hans", TZ)).toMatchObject({ title: "爸爸记录：今天早间未服药。", detail: "由本人记录为未服药。" });
    expect(homeReason(home, "zh-Hans")).toBe(`未服药原因：${REASON}`);
    expect(homeReason(home, "en")).toBe(`Reason given: ${REASON}`);
    const html = draw(home, "zh-Hans");
    expect(html).toMatch(new RegExp(`<p class="rpf rpf-home-reason"[^>]*data-testid="home-missed-reason">未服药原因：${REASON}</p>`));
    // after the sentence and its lede, before the week
    expect(html.indexOf("family-lede")).toBeLessThan(html.indexOf("home-missed-reason"));
    expect(html.indexOf("home-missed-reason")).toBeLessThan(html.indexOf('data-rp="family-stats"'));
    // not shared, no line; and the no-reply state never draws one
    expect(homeReason(await copy({ ...ALL, dose_summary: false }), "zh-Hans")).toBeNull();
    expect(draw(await copy({ ...ALL, dose_summary: false }), "zh-Hans")).not.toContain("home-missed-reason");
    expect(draw(home, "zh-Hans", true)).not.toContain("home-missed-reason");
  });

  it("several medicines of the slot: one reason is said once, different reasons each with its medicine", () => {
    expect(missedReasonLine([{ name: "Amlodipine", reason: "忘了" }, { name: "Losartan", reason: "忘了" }], "zh-Hans")).toBe("未服药原因：忘了");
    expect(missedReasonLine([{ name: "Amlodipine", reason: "忘了" }, { name: "Losartan", reason: "出门了" }], "zh-Hans")).toBe("Amlodipine：忘了；Losartan：出门了");
    expect(missedReasonLine([{ name: "Amlodipine", reason: "Forgot" }, { name: "Losartan", reason: "I was out" }], "en")).toBe("Amlodipine: Forgot; Losartan: I was out");
    expect(missedReasonLine([{ name: "Amlodipine", reason: null }], "zh-Hans")).toBeNull();
    expect(missedReasonLine([], "en")).toBeNull();
  });

  it("the rows: his latest reading with when and how many this week; the number of questions with their words; the next visit with its place", async () => {
    const home = await copy(ALL);
    const n = home.bp!.count;
    const stats = homeFacts(home, "zh-Hans", paths, undefined, TZ);
    expect(stats.find((s) => s.key === "bp")).toEqual({ key: "bp", label: "血压", value: "147/93", lines: [`今天 8:20，脉搏 61。本周测量 ${n} 次。`] });
    const q = stats.find((s) => s.key === "questions")!;
    expect(q).toMatchObject({ label: "待问医生", value: `${home.questions!.waiting} 个` });
    // three of the questions' words at most, the newest first; the one for the pharmacist says so
    expect(q.lines).toHaveLength(Math.min(HOME_QUESTIONS, home.questions!.items.length));
    expect(q.lines!.slice(0, 2)).toEqual([`待问药剂师：${FOR_PHARMACIST}`, FOR_DOCTOR]);
    const next = stats.find((s) => s.key === "next");
    if (home.questions!.nextVisit) {
      expect(String(next?.value)).toMatch(/^约 \d+月\d+日$|^今天$/);
      // owner 10-15: its time before the place and its doctor under them, when the scope has them (the example's today: 10:30, Dr Lim)
      const where = [home.questions!.nextVisitTime, home.questions!.nextVisitPlace].filter(Boolean).join("　");
      const doctor = home.questions!.nextVisitDoctor?.name_zh ?? home.questions!.nextVisitDoctor?.name ?? null;
      expect(next?.lines).toEqual([where, doctor].filter(Boolean));
      if (home.questions!.nextVisit === home.today) expect(next?.lines).toEqual(["10:30　Blossom Family Clinic (fictional)", "林伟明医生（虚构）"]);
    } else expect(next).toBeUndefined();

    const en = homeFacts(home, "en", paths, undefined, TZ);
    expect(en.find((s) => s.key === "bp")).toEqual({ key: "bp", label: "Blood pressure", value: "147/93", lines: [`Today 8:20, pulse 61. ${n} ${n === 1 ? "reading" : "readings"} this week.`] });
    expect(en.find((s) => s.key === "questions")!.lines![0]).toBe(`For the pharmacist: ${FOR_PHARMACIST}`);

    // drawn: the value on the row, the small lines under it (16px, the quiet ink: components/family-ui/home-detail.css)
    const html = draw(home, "zh-Hans");
    const drawn = rows(html);
    expect(drawn[0]).toBe(`|血压|147/93|今天 8:20，脉搏 61。本周测量 ${n} 次。|`);
    expect(drawn[1]).toContain(`|待问医生|${home.questions!.waiting} 个|待问药剂师：${FOR_PHARMACIST}|${FOR_DOCTOR}|`);
    expect(html).toMatch(/data-rp="family-stat" data-state="normal" data-lines="true"/);
    expect(html.match(/class="rpf-stat-line"/g)!.length).toBeGreaterThanOrEqual(3);
    const css = readFileSync(fileURLToPath(new URL("../../../components/family-ui/home-detail.css", import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    // sizes of 16 and 17 only (the two tokens her screens have), the two inks, no shadow and no colour of its own
    expect([...css.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1]).sort()).toEqual(["var(--rpf-fs-body)", "var(--rpf-fs-min)"]);
    expect([...new Set([...css.matchAll(/(?<![-\w])color:\s*([^;]+);/g)].map((m) => m[1]))]).toEqual(["var(--rpf-ink-2)"]);
    expect(css).not.toMatch(/shadow|#[0-9a-fA-F]{3,8}\b|rgb|hsl|background/);
  });

  it("a reading laid out without a time says its day and part of the day; no reading this week says so; a switch off draws no row", async () => {
    const home = await copy(ALL);
    const seeded: FamilyHomeData = { ...home, bp: { count: 1, readings: [{ id: "bp-seeded", date: "2026-10-12", slot: "evening", at: null, systolic: 138, diastolic: 84, pulse: null }] } };
    expect(homeFacts(seeded, "zh-Hans", paths, undefined, TZ)[0]).toMatchObject({ value: "138/84", lines: ["昨天晚间。本周测量 1 次。"] });
    expect(homeFacts(seeded, "en", paths, undefined, TZ)[0]).toMatchObject({ value: "138/84", lines: ["Yesterday evening. 1 reading this week."] });
    expect(homeFacts({ ...home, bp: { count: 0, readings: [] } }, "zh-Hans", paths, undefined, TZ)[0]).toEqual({ key: "bp", label: "血压", value: "本周暂无测量" });
    const none = await copy({ dose_summary: true });
    expect(homeFacts(none, "zh-Hans", paths, undefined, TZ).map((s) => s.key)).toEqual([]);
    expect(draw(none, "zh-Hans")).not.toMatch(/family-stat|147\/93/);
  });
});

describe("questions_count: the questions' own words", () => {
  it("reach her with the switch on: newest first, who each is for, at most five, and the count of all of them", async () => {
    const home = await copy({ questions_count: true });
    const q = home.questions!;
    expect(q.items.slice(0, 2)).toEqual([
      { id: expect.any(String), for: "pharmacist", text: FOR_PHARMACIST, lang: "zh-Hans" },
      { id: expect.any(String), for: "doctor", text: FOR_DOCTOR, lang: "zh-Hans" },
    ]);
    expect(q.items.length).toBeLessThanOrEqual(QUESTIONS_SHOWN);
    expect(q.items.length).toBe(Math.min(QUESTIONS_SHOWN, q.waiting));
    expect(q.waiting).toBeGreaterThanOrEqual(2);
    // only the words, who they are for and the id her screen names when she holds one (owner 10-14): no evidence, no answer
    for (const item of q.items) expect(Object.keys(item).sort()).toEqual(["for", "id", "lang", "text"]);
  });

  it("more than five waiting: the five newest are worded, all of them are counted", async () => {
    const before = (await copy({ questions_count: true })).questions!.waiting;
    const extra = Array.from({ length: QUESTIONS_SHOWN }, (_, i) => `第 ${i + 1} 个另外的问题，问医生`);
    for (const [i, words] of extra.entries()) {
      setClock(`09:0${i + 1}`);
      await store.addQuestion(him.userId, { for: "doctor", origin: "own", text: words, lang: "zh-Hans" });
    }
    now = setClock("09:10");
    const q = (await copy({ questions_count: true })).questions!;
    expect(q.waiting).toBe(before + QUESTIONS_SHOWN);
    expect(q.items.map((x) => x.text)).toEqual([...extra].reverse());
    expect(JSON.stringify(q)).not.toContain(FOR_DOCTOR);
  });

  it("the next visit rides on this switch with its date and its place", async () => {
    const s = await scope();
    const visits = await store.listVisits(s.id);
    const planned = visits.filter((v) => v.status === "planned" && v.date >= "2026-10-13").sort((a, b) => a.date.localeCompare(b.date))[0];
    const home = await copy({ questions_count: true });
    expect(home.questions).toMatchObject({ nextVisit: planned?.date ?? null, nextVisitPlace: planned?.place?.trim() || null });
    if (planned?.place) expect(text(await copy({ ...ALL, questions_count: false }))).not.toContain(planned.place);
  });

  it("do not reach her with the switch off: not a word of them, whatever else is on", async () => {
    const others = await copy({ ...ALL, questions_count: false });
    expect(others.questions).toBeNull();
    for (const words of [FOR_DOCTOR, FOR_PHARMACIST, "另外的问题"]) expect(text(others), words).not.toContain(words);
    expect((await copy({})).questions).toBeNull();
  });
});

describe("on her page: he switches a kind off while it is open", () => {
  it("the detail goes with its kind at once, and what the other switches show stays as it was", async () => {
    const home = await copy(ALL);
    // the control: the copy her page holds has all three kinds in full
    expect(text(home)).toContain(REASON);
    expect(home.bp!.readings.length).toBeGreaterThan(0);
    expect(home.questions!.items.length).toBeGreaterThan(0);

    const noDoses = hideOff(home, { ...ALL, dose_summary: false }, 5);
    expect(text(noDoses)).not.toContain(REASON);
    expect(text(noDoses)).not.toMatch(/Amlodipine|medicationId|"reason"/);
    expect(noDoses.bp).toEqual(home.bp);
    expect(noDoses.questions).toEqual(home.questions);

    const noBp = hideOff(home, { ...ALL, bp_summary: false }, 5);
    expect(noBp.bp).toBeNull();
    for (const n of [...numbers(READING), ...numbers(EARLIER), `"pulse":${READING.pulse}`]) expect(text(noBp), n).not.toContain(n);
    expect(noBp.week).toEqual(home.week);
    expect(noBp.questions).toEqual(home.questions);

    const noQuestions = hideOff(home, { ...ALL, questions_count: false }, 5);
    expect(noQuestions.questions).toBeNull();
    for (const item of home.questions!.items) expect(text(noQuestions), item.text).not.toContain(item.text);
    if (home.questions!.nextVisitPlace) expect(text(noQuestions)).not.toContain(home.questions!.nextVisitPlace);
    expect(noQuestions.week).toEqual(home.week);
    expect(noQuestions.bp).toEqual(home.bp);
  });

  it("is what the server builds with that switch off: the cut copy and a fresh one hold the same detail", async () => {
    const home = await copy(ALL);
    for (const off of ["dose_summary", "bp_summary", "questions_count"] as const) {
      const cut = hideOff(home, { ...ALL, [off]: false }, 5);
      const fresh = await copy({ ...ALL, [off]: false });
      expect(cut.bp, off).toEqual(fresh.bp);
      expect(cut.questions, off).toEqual(fresh.questions);
      expect(cut.week, off).toEqual(fresh.week);
      expect(cut.status?.slot?.cells ?? [], off).toEqual(fresh.status?.slot?.cells ?? []);
    }
  });

  it("a kind that went ON shows no detail from the old copy: it comes with the fresh one", async () => {
    const off = await copy({});
    const on = hideOff(off, { ...NO_GRANTS, dose_summary: true, bp_summary: true, questions_count: true }, 9);
    expect(on).toMatchObject({ status: null, week: null, bp: null, questions: null });
    expect(text(on)).not.toContain(REASON);
  });
});
