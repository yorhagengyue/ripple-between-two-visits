/**
 * The same number in four places at the same moment (docs/plan/real-app.md 4.4, lines 934-956, the table at 951-956;
 * 8.3 「单元 summary/untracked」, line 1429: 「4.4 那张表的四种情况；简报、女儿端、核对卡、规律问题四处同数」).
 *
 * An example account with an active care link (his switch for her: dose_summary on). For each row of the 4.4 table the
 * four places are read at one frozen moment, through the routes the pages use, and compared:
 *   (a) the brief            GET /api/brief (his cookie): doses { due, taken, missed, unconfirmed, days, missedDays, routine }
 *   (b) her view             GET /api/family/view?link= and GET /api/family/week?link=&offset=0..-3 (her cookie): the
 *                            week's count (daysDue, daysAllTaken) and every day's cells with their marks
 *   (c) the visit check card the sample visit started at that moment, GET /api/visits/v3: the medicines card
 *                            { total, taken, missed, unconfirmed, missedDays, routine }; at the moments before the last
 *                            one, the summary the card is built from (lib/summary/visit-check.ts) for "a visit started now"
 *   (d) the pattern question q-tai-chi's words and evidence (lib/daily/patterns.ts), as the question list and the brief show it
 *
 * The 4.4 table (the window is day 9 to today; the morning window is 08:45 / 09:15 / 09:45):
 *   signed up after 09:45                       this morning's cell is untracked     33 mornings, 29 taken, all day
 *   signed up before 09:45, not yet 09:45       not counted                          33, 29
 *   signed up before 09:45, he tapped 吃了       counted                              34, 30
 *   signed up before 09:45, no reply by 09:45   counted, not confirmed               34, 29, 1 not confirmed
 * and one more as the control (not a row of the table): signed up before 09:45 and he tapped 没吃, so the missed count
 * moves in all four places together (34, 29, 5 missed; the pattern question: 5 mornings, 4 of them on tai chi days).
 *
 * What is compared, exactly (the recorded rule: lib/summary/scope-doses.ts, web/progress/b.md 「哪些格子算他的」 and item 7):
 *   brief = card      the same window (the day after the last clinic visit to today) and the same rule: every number, the
 *                     missed days and the routine they fall on are equal.
 *   brief = her view  her view shows weeks, not the brief's window: this week and the three before it (day 19 to today on
 *                     these dates). For every day she can open, the cells' marks counted (taken, missed, no reply) equal
 *                     the brief's numbers of that day, and each week's daysDue / daysAllTaken equal the brief's days of
 *                     that week. Days 9 to 18 are on the brief and the card only.
 *                     One cell is shown to her and not counted, by the recorded decision (b.md item 7: after a sign-up
 *                     later than 09:45 his own tap on that morning 「今天页照样显示，但……四处都不计」): her strip shows that
 *                     answer too (mark "taken" with its time) while her week's count leaves it out, as the brief does.
 *                     The test states this as it is and compares the counts.
 *   brief = pattern   the pattern question counts missed mornings since day 0 (lib/daily/patterns.ts: the morning slot
 *                     only), the brief missed doses in its window. On the example account (one medicine, taken in the
 *                     morning, first due on day 9) these are the same days: the count in the question's words, its dates
 *                     and its weekdays equal the brief's missed days and the routine line.
 * Her read never settles a window (lib/care/home.ts) and his brief does: her view is read before and after his brief
 * and must be the same both times.
 *
 * Today is Wed 18 Nov 2026 (not the template's dates): d0 is Wed 7 Oct, tai chi falls on Thu and Sat, the four missed
 * mornings are 22, 24, 31 Oct and 12 Nov. tests/unit/daily/account-round2.test.ts has the first row with his tap through
 * the functions; tests/unit/visit/account-check.test.ts has card = brief on Mon 12 Oct.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as briefGet } from "@/app/api/brief/route";
import { POST as dosesPost } from "@/app/api/doses/route";
import { GET as familyViewGet } from "@/app/api/family/view/route";
import { GET as familyWeekGet } from "@/app/api/family/week/route";
import { GET as visitGet } from "@/app/api/visits/[id]/route";
import { fixtureUtterances } from "@/lib/asr";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import type { CellMark, FamilyHomeData, HomeState, WeekDayView, WeekView } from "@/lib/care/home-types";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import type { AccountBriefView } from "@/lib/summary/account-brief";
import type { DoseSummary } from "@/lib/summary/doses";
import { visitCheckSummary } from "@/lib/summary/visit-check";
import { setTestClock } from "@/lib/time/now";
import { processChunk, startVisit } from "@/lib/visit/pipeline";
import type { CheckCardView, MedCheck, VisitView } from "@/lib/visit/types";
import { agreedLink } from "../../support/agreed-link";

const store = getMemoryStore();
const TODAY = "2026-11-18";
const D0 = "2026-10-07";
const SGT = (hhmm: string) => `${TODAY}T${hhmm}:00+08:00`;
const AML = "med-amlodipine";
/** the example's four missed mornings (days 15, 17, 24, 36) on these dates, as the pattern question writes them */
const MISSED_DAYS = [15, 17, 24, 36];
const MISSED_ZH = ["10月22日", "10月24日", "10月31日", "11月12日"];

beforeAll(() => {
  process.env.MOCK_ASR_JOB_MS = "0";
  delete process.env.SPEECH_PROVIDER;
});
afterAll(() => setTestClock(null));

function setClock(hhmm: string): number {
  setTestClock({ at: SGT(hhmm), frozen: true });
  return Date.parse(SGT(hhmm));
}

function req(p: string, token: string, body?: unknown): NextRequest {
  const headers: Record<string, string> = { cookie: `rp_at=${token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

interface People {
  him: TestAccount;
  her: TestAccount;
  linkId: string;
}

/** He signs up with the example at `hhmm` today; she is linked and confirmed, his dose switch on for her (nothing else). */
async function family(hhmm: string): Promise<People> {
  setClock(hhmm);
  const him = await createAccountWithSpace(store, getAuthProvider(), { login: `sn${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  const her = await createAccountWithSpace(store, getAuthProvider(), { login: `sw${randomUUID().slice(0, 10)}`, password: "a long test password", space: "none" });
  const hash = `h-${randomUUID()}`;
  const inv = await store.createInvite({ patient_id: him.userId, invite_token_hash: hash, invite_expires_at: "2099-01-01T00:00:00.000Z" }, { dose_summary: true });
  if (!inv.ok) throw new Error("invite");
  await store.acceptInvite(hash, her.userId, "Wei Ling");
  await store.confirmLink(inv.link.id, him.userId, true);
  // the two records an invitation he confirmed carries (without them her view is the alert-only form: lib/care/reconsent.ts)
  await agreedLink(store, { id: inv.link.id, patient_id: him.userId, family_id: her.userId });
  expect(him.scope).toMatchObject({ d0: D0, story_day: 42, example_data: true });
  return { him, her, linkId: inv.link.id };
}
const scopeOf = async (p: People): Promise<SessionRow> => (await store.getSession(p.him.userId))!;

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  expect(res.status, text.slice(0, 300)).toBe(200);
  return JSON.parse(text) as T;
}

interface Counts {
  due: number;
  taken: number;
  missed: number;
  unconfirmed: number;
}
const counts = (x: Counts): Counts => ({ due: x.due, taken: x.taken, missed: x.missed, unconfirmed: x.unconfirmed });

// ------------------------------------------------------------------ (a) the brief

const briefOf = async (p: People) => (await json<{ brief: AccountBriefView }>(await briefGet(req("/api/brief?locale=zh-Hans", p.him.tokens.access_token)))).brief;
const briefDay = (b: AccountBriefView, date: string): Counts => counts(b.doses.days.find((d) => d.date === date) ?? { due: 0, taken: 0, missed: 0, unconfirmed: 0 });

// ------------------------------------------------------------------ (b) her view

interface Hers {
  home: FamilyHomeData;
  /** this week and the three before it, oldest first */
  weeks: WeekView[];
}
async function hersOf(p: People): Promise<Hers> {
  const t = p.her.tokens.access_token;
  const home = await json<FamilyHomeData>(await familyViewGet(req(`/api/family/view?link=${p.linkId}`, t)));
  const weeks: WeekView[] = [];
  for (const offset of [-3, -2, -1, 0]) weeks.push(await json<WeekView>(await familyWeekGet(req(`/api/family/week?link=${p.linkId}&offset=${offset}`, t))));
  expect(home.grants).toMatchObject({ dose_summary: true, no_reply_alert: false, bp_summary: false, notes: false });
  expect(home.week).toEqual(weeks[3]); // her home's week is the week page's
  return { home, weeks };
}
const marksOf = (d: WeekDayView): CellMark[] => d.slots.flatMap((s) => s.cells.map((c) => c.mark));
/** A day of her strip as numbers: the marks that are an answer or a closed window with none. */
function herDay(d: WeekDayView): Counts {
  const n = (m: CellMark) => marksOf(d).filter((x) => x === m).length;
  return { due: n("taken") + n("missed") + n("no_reply"), taken: n("taken"), missed: n("missed"), unconfirmed: n("no_reply") };
}
const herToday = (h: Hers): WeekDayView => h.weeks[3].days.find((d) => d.isToday)!;

// ------------------------------------------------------------------ (c) the check card

/** What the card would count for a visit that started at this moment (lib/visit/view.ts builds an account's card from this). */
async function cardIfStartedNow(p: People, nowMs: number): Promise<DoseSummary> {
  const scope = await scopeOf(p);
  const v3 = (await store.listVisits(scope.id)).find((v) => v.id === "v3")!;
  return (await visitCheckSummary(store, scope, { visit: v3, startedMs: nowMs, locale: "zh-Hans" })).doses;
}
/** He starts the example's sample visit now; the medicines card of the visit screen, through its route. */
async function realCard(p: People): Promise<MedCheck> {
  const scope = await scopeOf(p);
  await startVisit(store, scope, { mode: "replay", fixture: "v3" });
  await processChunk(store, scope, "v3", fixtureUtterances("v3")!);
  const { view } = await json<{ view: VisitView }>(await visitGet(req("/api/visits/v3", p.him.tokens.access_token), { params: Promise.resolve({ id: "v3" }) }));
  const card = view.cards.find((c): c is Extract<CheckCardView, { check: "med" }> => c.kind === "chk" && (c as CheckCardView).check === "med");
  expect(card, "the visit screen has a medicines card").toBeTruthy();
  return card!;
}

// ------------------------------------------------------------------ (d) the pattern question

interface PatternNumbers {
  /** missed mornings in all */
  total: number;
  /** of them on the routine's days */
  onRoutine: number;
  weekdays: string;
  dates: string[];
}
const ALL = /^我漏吃的 (\d+) 个早上都在打太极的日子（(.+?)）：(.+)。$/;
const SOME = /^我漏吃的 (\d+) 个早上里，有 (\d+) 个在打太极的日子（(.+?)）：(.+)。$/;
const EVIDENCE = /^pattern:tai_chi; 漏吃的 (\d+) 个早上里，(\d+) 个在打太极的日子（(.+?)）：(.+)$/;
/** The numbers the pattern question says, read out of its words and out of its evidence (they must say the same). */
async function patternOf(p: People): Promise<PatternNumbers> {
  const q = (await store.getQuestion(p.him.userId, "q-tai-chi"))!;
  expect(q).toMatchObject({ status: "open", origin: "pattern", for: "doctor" });
  const all = ALL.exec(q.text);
  const some = SOME.exec(q.text);
  expect(all || some, q.text).toBeTruthy();
  const words: PatternNumbers = all ? { total: Number(all[1]), onRoutine: Number(all[1]), weekdays: all[2], dates: all[3].split("、") } : { total: Number(some![1]), onRoutine: Number(some![2]), weekdays: some![3], dates: some![4].split("、") };
  const ev = EVIDENCE.exec(q.evidence ?? "");
  expect(ev, q.evidence ?? "").toBeTruthy();
  expect({ total: Number(ev![1]), onRoutine: Number(ev![2]), weekdays: ev![3], dates: ev![4].split("、") }).toEqual(words);
  return words;
}
const zhDay = (iso: string) => `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;

// ------------------------------------------------------------------ the four places at one moment

interface Expected {
  total: Counts;
  today: Counts;
  /** her strip's marks for today, and her headline */
  herMarks: CellMark[];
  herState: HomeState;
  /** his own late tap on an untracked cell: shown to her, counted nowhere (see the header) */
  shownNotCounted?: boolean;
  /** missed mornings in all, and how many of them on tai chi days */
  missed: { days: number[]; onRoutine: number };
}

/** Read the four places now, compare them with each other and with the table's row. Returns the brief. */
async function sameEverywhere(p: People, hhmm: string, want: Expected, opts: { startVisit?: boolean } = {}): Promise<AccountBriefView> {
  const nowMs = setClock(hhmm);
  const label = `at ${hhmm}`;

  // her view first: nothing of his has been settled by a read of his yet
  const before = await hersOf(p);
  const brief = await briefOf(p);
  const hers = await hersOf(p);
  expect(hers, `${label}: her view does not depend on his brief having been opened`).toEqual(before);

  // (a) the brief: the table's row
  expect(brief.window, label).toMatchObject({ fromDay: 9, toDay: 42, fromDate: storyDate(D0, 9), toDate: TODAY, lastVisit: { id: "v2", day: 8 } });
  expect(counts(brief.doses), label).toEqual(want.total);
  expect(briefDay(brief, TODAY), label).toEqual(want.today);
  expect(brief.doses.missedDays, label).toEqual(want.missed.days);
  expect(brief.doses.routine, label).toMatchObject({ label: "Tai chi", labelZh: "打太极", weekdays: ["Thu", "Sat"], onRoutine: MISSED_DAYS, all: want.missed.onRoutine === want.missed.days.length });

  // (c) the check card of a visit started now: every number of the brief
  const card = await cardIfStartedNow(p, nowMs);
  expect(card, label).toEqual(brief.doses);

  // (b) her view: day by day over the four weeks she can open, and each week's count
  const days = hers.weeks.flatMap((w) => w.days);
  expect(days).toHaveLength(28);
  expect(days[0].date, "her oldest day is inside the brief's window").toBe(storyDate(D0, 19));
  expect(days.filter((d) => d.isToday).map((d) => d.date)).toEqual([TODAY]);
  let compared = 0;
  for (const d of days) {
    if (d.date > TODAY) {
      expect(herDay(d), `${label} ${d.date}: a day to come has nothing counted`).toEqual({ due: 0, taken: 0, missed: 0, unconfirmed: 0 });
      continue;
    }
    if (d.isToday && want.shownNotCounted) continue; // compared below, as what it is
    expect(herDay(d), `${label} ${d.date}`).toEqual(briefDay(brief, d.date));
    compared += 1;
  }
  expect(compared).toBe(want.shownNotCounted ? 23 : 24); // day 19 to today
  for (const w of hers.weeks) {
    const inWeek = brief.doses.days.filter((d) => d.date >= w.fromDate && d.date <= w.toDate);
    expect({ daysDue: w.daysDue, daysAllTaken: w.daysAllTaken }, `${label} week ${w.fromDate}`).toEqual({ daysDue: inWeek.length, daysAllTaken: inWeek.filter((d) => d.taken === d.due).length });
  }
  // the missed mornings she can see are the brief's missed days of those weeks
  expect(days.filter((d) => herDay(d).missed > 0).map((d) => d.date), label).toEqual(want.missed.days.filter((day) => day >= 19).map((day) => storyDate(D0, day)));
  // today on her page
  expect(marksOf(herToday(hers)), label).toEqual(want.herMarks);
  expect(hers.home.status?.state, label).toBe(want.herState);
  if (want.shownNotCounted) {
    // his late tap on a morning from before he started: she sees it, with its time; her week does not count it, like the brief
    expect(herDay(herToday(hers))).toEqual({ due: 1, taken: 1, missed: 0, unconfirmed: 0 });
    expect(briefDay(brief, TODAY)).toEqual({ due: 0, taken: 0, missed: 0, unconfirmed: 0 });
    expect(hers.weeks[3]).toMatchObject({ daysDue: 2, daysAllTaken: 2 }); // Monday and Tuesday; today is not one of them
  }

  // (d) the pattern question: the brief's missed days, in its own words
  const pattern = await patternOf(p);
  expect(pattern, label).toEqual({ total: brief.doses.missed, onRoutine: brief.doses.routine!.onRoutine.length, weekdays: "周四、周六", dates: brief.doses.routine!.onRoutine.map((day) => zhDay(storyDate(D0, day))) });
  expect(pattern.total, label).toBe(brief.doses.missedDays.length);
  expect(pattern, label).toMatchObject({ total: want.missed.days.length, onRoutine: want.missed.onRoutine, dates: MISSED_ZH });
  // and the brief shows that very question
  const asked = (await store.getQuestion(p.him.userId, "q-tai-chi"))!;
  expect(brief.questions.shown.find((q) => q.id === "q-tai-chi")?.text, label).toBe(asked.text);

  if (opts.startVisit) {
    // the real card on the visit screen, started at this very moment
    const real = await realCard(p);
    expect({ due: real.total, taken: real.taken, missed: real.missed, unconfirmed: real.unconfirmed }, `${label}: the visit screen's card`).toEqual(want.total);
    expect(real.missedDays, label).toEqual(brief.doses.missedDays);
    // the card names the routine only when every missed morning falls on it (lib/visit/account-check.ts)
    expect(real.routine, label).toEqual(brief.doses.routine!.all ? { label: "Tai chi", labelZh: "打太极", days: ["Thu", "Sat"] } : null);
    expect({ fromDate: real.fromDate, toDate: real.toDate }, label).toEqual({ fromDate: brief.window.fromDate, toDate: brief.window.toDate });
  }
  return brief;
}

async function tap(p: People, hhmm: string, state: "taken" | "missed"): Promise<void> {
  setClock(hhmm);
  const body = state === "taken" ? { medication_id: AML, slot: "morning", state } : { medication_id: AML, slot: "morning", state, reason: "forgot", reason_text: "忘了" };
  const res = await dosesPost(req("/api/doses", p.him.tokens.access_token, body));
  expect(res.status, await res.clone().text()).toBe(200);
}

const NONE: Counts = { due: 0, taken: 0, missed: 0, unconfirmed: 0 };
const ALL_FOUR = { days: MISSED_DAYS, onRoutine: 4 };

describe("the 4.4 table on an example account with a daughter who sees his medicine: four places, one number", () => {
  it("row 1, signed up after 09:45 (10:00): this morning is untracked: 33 mornings, 29 taken, all day, also after he taps 吃了", async () => {
    const p = await family("10:00");
    const row = { total: { due: 33, taken: 29, missed: 4, unconfirmed: 0 }, today: NONE, missed: ALL_FOUR };
    await sameEverywhere(p, "10:02", { ...row, herMarks: ["untracked"], herState: "untracked" });
    // he taps 吃了 for this morning at 10:05: his own page keeps it, the four places do not count it
    await tap(p, "10:05", "taken");
    expect((await store.listDoses(p.him.userId, { fromDay: 42, toDay: 42 })).map((d) => [d.state, d.created_at])).toEqual([["taken", "2026-11-18T02:05:00.000Z"]]);
    await sameEverywhere(p, "10:06", { ...row, herMarks: ["taken"], herState: "taken", shownNotCounted: true });
    await sameEverywhere(p, "15:00", { ...row, herMarks: ["taken"], herState: "taken", shownNotCounted: true });
    await sameEverywhere(p, "23:50", { ...row, herMarks: ["taken"], herState: "taken", shownNotCounted: true }, { startVisit: true });
  });

  it("row 2, signed up before 09:45 (07:00), 09:45 not reached yet: today is not counted: 33 mornings, 29 taken", async () => {
    const p = await family("07:00");
    const row = { total: { due: 33, taken: 29, missed: 4, unconfirmed: 0 }, today: NONE, missed: ALL_FOUR };
    await sameEverywhere(p, "08:00", { ...row, herMarks: ["pending"], herState: "before" });
    await sameEverywhere(p, "08:45", { ...row, herMarks: ["waiting"], herState: "reminding" });
    await sameEverywhere(p, "09:44", { ...row, herMarks: ["waiting"], herState: "reminding" }, { startVisit: true });
    // nothing was written for today by any of these reads
    expect(await store.listDoses(p.him.userId, { fromDay: 42, toDay: 42 })).toEqual([]);
  });

  it("row 3, signed up before 09:45, he tapped 吃了 at 08:52: counted: 34 mornings, 30 taken", async () => {
    const p = await family("07:00");
    await tap(p, "08:52", "taken");
    const row = { total: { due: 34, taken: 30, missed: 4, unconfirmed: 0 }, today: { due: 1, taken: 1, missed: 0, unconfirmed: 0 }, missed: ALL_FOUR, herMarks: ["taken"] as CellMark[], herState: "taken" as const };
    await sameEverywhere(p, "08:53", row);
    await sameEverywhere(p, "09:50", row);
    await sameEverywhere(p, "21:00", row, { startVisit: true });
  });

  it("row 4, signed up before 09:45, no reply by 09:45: counted, not confirmed: 34 mornings, 29 taken, 1 not confirmed", async () => {
    const p = await family("07:00");
    const row = { total: { due: 34, taken: 29, missed: 4, unconfirmed: 1 }, today: { due: 1, taken: 0, missed: 0, unconfirmed: 1 }, missed: ALL_FOUR, herMarks: ["no_reply"] as CellMark[], herState: "not_logged" as const };
    // 09:45 exactly: the window has closed. Her view is read first, before anything settled the cell: the same number
    expect(await store.listDoses(p.him.userId, { fromDay: 42, toDay: 42 })).toEqual([]);
    await sameEverywhere(p, "09:45", row);
    // his brief settled it: one row, "no reply"
    expect((await store.listDoses(p.him.userId, { fromDay: 42, toDay: 42 })).map((d) => [d.state, d.reason])).toEqual([["unconfirmed", "no_reply"]]);
    await sameEverywhere(p, "13:00", row, { startVisit: true });
  });

  it("the control: signed up before 09:45 and he tapped 没吃: the missed count moves in all four places (34, 29, 5 missed)", async () => {
    const p = await family("07:00");
    await tap(p, "08:52", "missed");
    const row = {
      total: { due: 34, taken: 29, missed: 5, unconfirmed: 0 },
      today: { due: 1, taken: 0, missed: 1, unconfirmed: 0 },
      // today, day 42, is a Wednesday: the fifth missed morning is not on a tai chi day
      missed: { days: [...MISSED_DAYS, 42], onRoutine: 4 },
      herMarks: ["missed"] as CellMark[],
      herState: "missed" as const,
    };
    const brief = await sameEverywhere(p, "08:53", row, { startVisit: true });
    expect(brief.doses.routine).toMatchObject({ all: false, onRoutine: MISSED_DAYS });
    expect((await store.getQuestion(p.him.userId, "q-tai-chi"))!.text).toBe("我漏吃的 5 个早上里，有 4 个在打太极的日子（周四、周六）：10月22日、10月24日、10月31日、11月12日。");
  });
});
