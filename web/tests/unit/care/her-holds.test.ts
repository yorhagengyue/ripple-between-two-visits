/**
 * What she can hold on her screens (owner's decision of 2026-10-14: the long press of his side is on hers too). The read
 * itself and its cut by his switches are tests/unit/explain/family-viewer.test.ts; here, which element of her home and
 * of her month stands for which of his records (lib/care/her-holds.ts homeHolds, components/family-ui), and that the
 * wrap changes nothing she sees:
 *
 *   her home     today's sentence is that part of today's medicine; a day of the week that is one record; the blood
 *                pressure row is the week and its number the latest reading; each question's words is that question;
 *                the next visit's row is the next visit. Each only while his switch for it is on, and gone the moment
 *                her page cuts the kind out of its copy
 *   her month    a row can be held, keeps its marks and its test id, and a row that opens a screen still opens it
 *   the wrap     adds no visible text: the screen's words are the same with it and without it
 *
 * Mr Tan's example account on Tue 13 Oct 2026, 09:00 his time, as tests/unit/care/home-detail.test.ts lays it out.
 */
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FamilyHome, MonthRow, StatusCard } from "@/components/family-ui";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { homeHolds } from "@/lib/care/her-holds";
import { HOME_QUESTIONS, herPaths, homeFacts, homeHeadline, weekDays } from "@/lib/care/her-view";
import { hideOff } from "@/lib/care/hide";
import { familyHome } from "@/lib/care/home";
import type { FamilyHomeData } from "@/lib/care/home-types";
import { answerDose } from "@/lib/daily/doses";
import { NO_GRANTS } from "@/lib/family/types";
import { MemoryStore } from "@/lib/store/memory";
import type { CareLinkRow, FamilyGrantItems, SessionRow } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";

const store = new MemoryStore();
const SGT = (hhmm: string) => `2026-10-13T${hhmm}:00+08:00`;
const ALL: FamilyGrantItems = { dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: true, notes: true };
const TZ = "Asia/Singapore";

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

async function copy(grants: Partial<FamilyGrantItems>): Promise<FamilyHomeData> {
  return familyHome(store, await scope(), { link, grants: { ...NO_GRANTS, ...grants }, version: 4 }, now);
}

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
  const today = (await scope()).story_day;
  await store.addBp(him.userId, { day: today, slot: "morning", systolic: 139, diastolic: 83, created_at: new Date(setClock("08:10")).toISOString() });
  await store.addBp(him.userId, { day: today, slot: "morning", systolic: 147, diastolic: 93, pulse: 61, created_at: new Date(setClock("08:20")).toISOString() });
  setClock("08:30");
  await store.addQuestion(him.userId, { for: "doctor", origin: "own", text: "早上头晕的时候要不要先量血压再吃药", lang: "zh-Hans" });
  now = setClock("08:50");
  await answerDose(store, await scope(), { medication_id: "med-amlodipine", slot: "morning", state: "missed", reason: "forgot", reason_text: "忘了" }, now);
  now = setClock("09:00");
});

afterAll(() => setTestClock(null));

describe("homeHolds: which element of her home stands for which of his records", () => {
  it("with every switch on", async () => {
    const home = await copy(ALL);
    const holds = homeHolds(home);
    expect(holds.status).toEqual({ type: "dose", ref: "2026-10-13:morning" });
    // this week up to today (Monday and Tuesday): one part of the day each, so each day is one record; no day to come
    expect(holds.days).toEqual({ "2026-10-12": { type: "dose", ref: "2026-10-12:morning" }, "2026-10-13": { type: "dose", ref: "2026-10-13:morning" } });
    expect(holds.bpWeek).toEqual({ type: "bp_week", ref: "" });
    expect(holds.bpLatest).toEqual({ type: "bp", ref: home.bp!.readings[0].id });
    expect(home.bp!.readings[0]).toMatchObject({ systolic: 147, diastolic: 93 });
    // as many lines as her home lists, each the question whose words it shows
    expect(holds.questions).toEqual(home.questions!.items.slice(0, HOME_QUESTIONS).map((q) => ({ type: "question", ref: q.id })));
    expect(holds.questions).toHaveLength(Math.min(HOME_QUESTIONS, home.questions!.items.length));
    expect(holds.nextVisit).toEqual({ type: "next_visit", ref: "" });
  });

  it("only what the copy holds: a switch that is off leaves nothing of its kind to hold", async () => {
    const none = { status: null, days: {}, bpWeek: null, bpLatest: null, questions: [], nextVisit: null };
    expect(homeHolds(await copy({}))).toEqual(none);
    expect(homeHolds(null)).toEqual(none);
    const noDose = homeHolds(await copy({ ...ALL, dose_summary: false }));
    expect([noDose.status, noDose.days]).toEqual([null, {}]);
    expect(noDose.bpWeek).not.toBeNull();
    const noBp = homeHolds(await copy({ ...ALL, bp_summary: false }));
    expect([noBp.bpWeek, noBp.bpLatest]).toEqual([null, null]);
    const noQuestions = homeHolds(await copy({ ...ALL, questions_count: false }));
    expect([noQuestions.questions, noQuestions.nextVisit]).toEqual([[], null]);
    // the no-reply switch alone: the alert has no medicine in it, and nothing of his medicine can be held
    expect(homeHolds(await copy({ no_reply_alert: true })).status).toBeNull();
    // he switches a kind off while her page is open: it leaves the copy her page holds, and what could be held with it
    const cut = homeHolds(hideOff(await copy(ALL), { ...ALL, bp_summary: false, questions_count: false }));
    expect([cut.bpWeek, cut.bpLatest, cut.questions, cut.nextVisit]).toEqual([null, null, [], null]);
    expect(cut.status).toEqual({ type: "dose", ref: "2026-10-13:morning" });
  });

  it("a day with two parts stands for two records: it is not held", async () => {
    const home = await copy(ALL);
    const day = home.week!.days.find((d) => d.date === "2026-10-13")!;
    const two: FamilyHomeData = { ...home, week: { ...home.week!, days: home.week!.days.map((d) => (d.date === day.date ? { ...d, slots: [d.slots[0], { ...d.slots[0], slot: "evening" as const }] } : d)) } };
    expect(Object.keys(homeHolds(two).days)).toEqual(["2026-10-12"]);
  });
});

describe("her home, drawn", () => {
  const paths = herPaths("link-1");
  const draw = (home: FamilyHomeData, held: boolean, noReply = false) =>
    renderToStaticMarkup(
      createElement(FamilyHome, {
        locale: "zh-Hans",
        kicker: "10月13日 周二",
        status: homeHeadline(home, "爸爸", "zh-Hans", TZ),
        noReply: noReply ? { title: "爸爸尚未回应早间药物提醒。", detail: "两次提醒均未回应。" } : undefined,
        week: home.week ? { label: "本周", days: weekDays(home.week, "zh-Hans"), href: paths.week } : undefined,
        stats: homeFacts(home, "zh-Hans", paths, "爸爸", TZ),
        recordHref: paths.reminder,
        sharedHref: paths.shared,
        privacy: "这些是爸爸同意给你看的。",
        explain: held ? { link: "link-1", holds: homeHolds(home) } : undefined,
      }),
    );
  /** every held element of a page: its type, its ref, and how the wrapper stands */
  const held = (html: string) => [...html.matchAll(/<(div|span) class="rpx([^"]*)" data-rpx="hold" data-rpx-type="([^"]*)" data-rpx-ref="([^"]*)" data-rpx-viewer="family"/g)].map((m) => `${m[3]}:${m[4]}${m[2].includes("rpx-inline") ? " inline" : m[2].includes("rpf-day-hold") ? " day" : ""}`);
  const words = (html: string) => html.replace(/<button[^>]*class="rpx-ask"[^>]*><\/button>/g, "").replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");

  it("each element that stands for one of his records is held, through her link; nothing else is", async () => {
    const home = await copy(ALL);
    const html = draw(home, true);
    const ids = home.questions!.items.slice(0, HOME_QUESTIONS).map((q) => q.id);
    expect(held(html)).toEqual([
      "dose:2026-10-13:morning inline",
      "dose:2026-10-12:morning day",
      "dose:2026-10-13:morning day",
      "bp_week:",
      `bp:${home.bp!.readings[0].id} inline`,
      ...ids.map((id) => `question:${id} inline`),
      "next_visit:",
    ]);
    // every one of them is a family member's (the sheet then reads through her link)
    expect(html.match(/data-rpx="hold"/g)).toHaveLength(html.match(/data-rpx-viewer="family"/g)!.length);
    // the sentence is held inside its heading, which keeps its place and its test id
    expect(html).toMatch(/<h1 class="rpf-h1" data-testid="family-headline"><span class="rpx rpx-inline" data-rpx="hold" data-rpx-type="dose"/);
    // a day of the week is held inside its own cell; the days still to come are plain
    expect(html).toMatch(/<li class="rpf-day" data-today="true" data-mark="missed" data-testid="week-day-2026-10-13"><div class="rpx rpf-day-hold"/);
    expect(html).toMatch(/<li class="rpf-day" data-mark="pending" data-testid="week-day-2026-10-14"><span class="rpf-day-wd"/);
    // the blood pressure row is held as a whole and keeps its own element; her additions' row and the buttons are not held
    expect(html).toMatch(/data-rpx-type="bp_week" data-rpx-ref="" data-rpx-viewer="family"><div class="rpf rpf-stat" data-rp="family-stat"/);
    // the hidden button names what it would ask about
    expect(html).toContain('aria-label="问 Ripple：血压"');
    expect(html).toContain('aria-label="问 Ripple：147/93"');
  });

  it("the wrap adds no visible text, and without her link nothing can be held", async () => {
    const home = await copy(ALL);
    const plain = draw(home, false);
    expect(plain).not.toContain("data-rpx");
    expect(words(draw(home, true))).toBe(words(plain));
    // the amber sentence when he did not reply is the same record
    const amber = draw(home, true, true);
    expect(amber).toMatch(/data-testid="home-no-reply"[^>]*><div[^>]*data-rp="family-hero"[^>]*><h1 class="rpf-h1" data-testid="family-headline"><span class="rpx rpx-inline" data-rpx="hold" data-rpx-type="dose"/);
    expect(words(amber)).toBe(words(draw(home, false, true)));
  });

  it("a switch off: the element is not there, so there is nothing to hold", async () => {
    const home = await copy({ ...ALL, bp_summary: false, questions_count: false });
    expect(held(draw(home, true))).toEqual(["dose:2026-10-13:morning inline", "dose:2026-10-12:morning day", "dose:2026-10-13:morning day"]);
    expect(held(draw(await copy({ no_reply_alert: true }), true))).toEqual([]);
  });

  it("a row that is not in its normal state holds nothing", () => {
    const row = (state: "off" | "loading" | "error") =>
      renderToStaticMarkup(createElement(StatusCard, { locale: "zh-Hans", label: "血压", value: "147/93", lines: ["今天 8:20"], state, holdLink: "link-1", hold: { type: "bp_week", ref: "" }, valueHold: { type: "bp", ref: "r1" }, lineHolds: [{ type: "question", ref: "q1" }] }));
    for (const state of ["off", "loading", "error"] as const) expect(row(state)).not.toContain("data-rpx");
  });
});

describe("her month's rows", () => {
  const row = (props: Partial<Parameters<typeof MonthRow>[0]>) =>
    renderToStaticMarkup(createElement(MonthRow, { kind: "bp", explainRef: "r1", title: "血压测量", value: "147/93", ...props }));

  it("a row given a record can be held; it keeps its marks and its test id", () => {
    const html = row({ hold: { subject: { type: "bp", ref: "r1" }, link: "link-1", locale: "zh-Hans", label: "血压测量 147/93" } });
    expect(html).toMatch(/^<li class="rpf-month-row" data-kind="bp" data-explain-type="bp" data-explain-ref="r1" data-testid="month-bp"><div class="rpx" data-rpx="hold" data-rpx-type="bp" data-rpx-ref="r1" data-rpx-viewer="family"><div class="rpf-month-rowin">/);
    expect(html).toContain('aria-label="问 Ripple：血压测量 147/93"');
    expect(row({})).not.toContain("data-rpx");
  });

  it("a row that opens a screen still does: the link is inside what she holds", () => {
    const html = row({ kind: "visit", explainRef: "v2", title: "就诊", href: "/f/shared/visit/v2?link=link-1", hold: { subject: { type: "visit", ref: "v2" }, link: "link-1", locale: "zh-Hans" } });
    expect(html).toMatch(/<div class="rpx" data-rpx="hold" data-rpx-type="visit" data-rpx-ref="v2" data-rpx-viewer="family"><a class="rpf-month-rowin" href="\/f\/shared\/visit\/v2\?link=link-1"/);
  });
});
