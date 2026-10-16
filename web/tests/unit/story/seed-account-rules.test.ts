/**
 * The example account's consistency rules 4, 5, 7 and 8 (docs/plan/real-app.md 4.8, lines 999-1010; 8.4 line 1440:
 * 「4.8 的八条，对一周七个『今天』参数化」), each for seven consecutive "today"s, one per weekday. Rules 1, 2, 3 and 6 are
 * in tests/unit/story/seed-account.test.ts; this file reuses its seven days and its clocked store.
 *
 *   rule 4   the account brief's numbers (lib/summary/account-brief.ts buildAccountBrief, what GET /api/brief answers an
 *            account with) equal the table of 4.4 (lines 951-958): signed up at 07:00 and at 10:00, the morning cell
 *            answered and not answered, and the other numbers of 4.4 (lines 960-965): 10 readings averaging 140/85, 9
 *            not below the doctor's 135/85, the 4 missed mornings on the two tai chi days (which weekdays those are
 *            turns with d0: 4.3, lines 927-933), the day-37 note under its real date, the three questions.
 *   rule 5   the visit check card (the sample visit's cards, lib/visit/account-check.ts over lib/summary/visit-check.ts)
 *            and the brief of the same moment say the same numbers, in each of those cases.
 *   rule 7   nothing the example account gets says 「Day N」 or 「第N天」, shows a date of the demo template that his own
 *            layout has no day for, or names his user id (which is his scope's id): every GET under app/api that answers
 *            him, in both languages, fresh and after a morning of use and the sample visit; what he gets back from the
 *            everyday writes; his event stream; the push texts the daily jobs send for him; and the pattern question's
 *            evidence, which names the missed mornings by date (the design's own example, line 933, is the Friday here).
 *            The demo's own routes (app/api/demo/**, whose sentences count in story days) answer him 404 on every
 *            method and change nothing of his; the one that only sets the "this browser shows the demo" cookie is scanned.
 *   rule 8   after the sample visit v3 is replayed and confirmed (4.6), the brief's three questions are answered, each
 *            with the doctor's own sentence, its line in the recording, the speaker and the time point.
 *
 * Recorded decisions this file follows where they differ from the design's wording:
 *   - web/progress/b.md 「9:45 以后注册」 and 「summarizeDoses 没有加 untrackedBefore 参数」: an account is counted cell by
 *     cell (lib/summary/scope-doses.ts); an answer written on an untracked cell after tracking began is shown on Today
 *     and never counted. The numbers are the design's table either way.
 *   - web/progress/b.md 「示例的规律问题证据…现在账号上写真实日期」: the evidence reads 「漏吃的 4 个早上里，4 个在打太极的日子
 *     （周六、周一）：9月12日、…」; the design gives 「漏的早上：9月12日、9月14日……」 as an example. The dates are asserted
 *     exactly, the words around them are not.
 *
 * Clocks: seed-account.test.ts moves a store's own clock. The brief, the visit pipeline and the routes also read the
 * app's clock (lib/time/now), so `clockedStore` here moves both together. The routes answer from the process-wide
 * store, so the route scans make their accounts there (createAccountWithSpace, as tests/unit/subject/account-guards).
 *
 * What the scan does not read: bodies that are not text (the reminder's sound, a visit clip, the sample bag's picture).
 * The pattern /Day\s*\d+/i is the design's, used as written; day numbers that travel as data (`"day": 37`, an id like
 * note-d37-1, `scriptSection: "D0"`) are not words on a screen and do not match it.
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as askPost } from "@/app/api/ask/route";
import { POST as bpPost } from "@/app/api/bp/route";
import { DELETE as dosesDelete, POST as dosesPost } from "@/app/api/doses/route";
import { GET as eventsGet } from "@/app/api/events/route";
import { POST as notesPost } from "@/app/api/notes/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { fixtureUtterances, getSpeechProvider } from "@/lib/asr";
import { mayNotifyFamily } from "@/lib/care/recipients";
import { bpWindows, runBpDay } from "@/lib/daily/bp-run";
import { bpPlanFor, type BpPlan } from "@/lib/daily/bp-schedule";
import { answerDose, routineOf } from "@/lib/daily/doses";
import { patternEvidence, routinePatterns } from "@/lib/daily/patterns";
import { DAILY_BP_JOB, DAILY_DOSES_JOB } from "@/lib/jobs/daily";
import { registerNoticeSender } from "@/lib/jobs/notify";
import { questionList } from "@/lib/profile/questions";
import { createWebPushSender, storeSubscriptions } from "@/lib/push/sender";
import { getMemoryStore, MemoryStore } from "@/lib/store/memory";
import type { QuestionRow, SessionRow, Store } from "@/lib/store/types";
import { storyDate, weekdayIndex } from "@/lib/story/clock";
import { EXAMPLE_TODAY_DAY, seedAccount } from "@/lib/story/example";
import { loadTemplate } from "@/lib/story/seed";
import { careEntryStore } from "@/lib/subject/care";
import { pushEntryStore } from "@/lib/subject/push";
import { buildAccountBrief, type AccountBriefView } from "@/lib/summary/account-brief";
import { buildBrief } from "@/lib/summary/brief";
import { zonedTimeToUtcMs } from "@/lib/time/clock";
import { setTestClock } from "@/lib/time/now";
import { confirmVisit, finalizeVisit, processChunk, startVisit } from "@/lib/visit/pipeline";
import type { CheckCardView, VisitView } from "@/lib/visit/types";
import { buildVisitView } from "@/lib/visit/view";
import v3Expected from "@/fixtures/visits/v3.expected.json";
import { startPushService, type PushService } from "../../support/push-service";

// ---------------------------------------------------------------- the seven days (as tests/unit/story/seed-account.test.ts)

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A store whose clock the test moves; the app's clock moves with it. */
function clockedStore(startMs: number) {
  let t = startMs;
  setTestClock({ at: startMs, frozen: true });
  const store = new MemoryStore({ now: () => new Date(t) });
  return {
    store,
    set: (ms: number) => {
      t = ms;
      setTestClock({ at: ms, frozen: true });
    },
    at: () => t,
  };
}

const sg = (date: string, time = "10:00") => zonedTimeToUtcMs(date, time);

function addDays(iso: string, n: number): string {
  return storyDate(iso, n);
}

// seven consecutive days: every weekday once (2026-10-05 is a Monday)
const TODAYS = [0, 1, 2, 3, 4, 5, 6].map((n) => addDays("2026-10-05", n));

/**
 * What each of the seven days must show, written out by hand (4.3: the template's Monday d0 has tai chi on Tue and
 * Thu and the misses on days 15, 17, 24 and 36; a later d0 turns the weekdays by the same number of days). The Friday
 * is the design's own example (lines 932-933): tai chi on Sat and Mon, 「9月12日、9月14日、9月21日、10月3日」.
 */
const BY_TODAY: Record<string, { d0: string; taiChi: [string, string]; taiChiZh: string; missedZh: string; missedEn: string }> = {
  "2026-10-05": { d0: "2026-08-24", taiChi: ["Tue", "Thu"], taiChiZh: "周二、周四", missedZh: "9月8日、9月10日、9月17日、9月29日", missedEn: "8 Sep, 10 Sep, 17 Sep, 29 Sep" },
  "2026-10-06": { d0: "2026-08-25", taiChi: ["Wed", "Fri"], taiChiZh: "周三、周五", missedZh: "9月9日、9月11日、9月18日、9月30日", missedEn: "9 Sep, 11 Sep, 18 Sep, 30 Sep" },
  "2026-10-07": { d0: "2026-08-26", taiChi: ["Thu", "Sat"], taiChiZh: "周四、周六", missedZh: "9月10日、9月12日、9月19日、10月1日", missedEn: "10 Sep, 12 Sep, 19 Sep, 1 Oct" },
  "2026-10-08": { d0: "2026-08-27", taiChi: ["Fri", "Sun"], taiChiZh: "周五、周日", missedZh: "9月11日、9月13日、9月20日、10月2日", missedEn: "11 Sep, 13 Sep, 20 Sep, 2 Oct" },
  "2026-10-09": { d0: "2026-08-28", taiChi: ["Sat", "Mon"], taiChiZh: "周六、周一", missedZh: "9月12日、9月14日、9月21日、10月3日", missedEn: "12 Sep, 14 Sep, 21 Sep, 3 Oct" },
  "2026-10-10": { d0: "2026-08-29", taiChi: ["Sun", "Tue"], taiChiZh: "周日、周二", missedZh: "9月13日、9月15日、9月22日、10月4日", missedEn: "13 Sep, 15 Sep, 22 Sep, 4 Oct" },
  "2026-10-11": { d0: "2026-08-30", taiChi: ["Mon", "Wed"], taiChiZh: "周一、周三", missedZh: "9月14日、9月16日、9月23日、10月5日", missedEn: "14 Sep, 16 Sep, 23 Sep, 5 Oct" },
};

const D37_NOTE = "今天在大巴窑中心走了一圈，脚踝有点肿。";
const THREE = ["q-extra-tablet", "q-tai-chi", "q-knee-2"];
const R1 = "At home, we want it below 135 over 85.";

let service: PushService;
beforeAll(async () => {
  process.env.MOCK_ASR_JOB_MS = "0";
  delete process.env.SPEECH_PROVIDER;
  service = await startPushService();
});
afterAll(async () => {
  registerNoticeSender(null);
  setTestClock(null);
  await service.close();
});

// ---------------------------------------------------------------- rules 4 and 5: the cases of the table

type Counts = { due: number; taken: number; missed: number; unconfirmed: number };

interface TableCase {
  name: string;
  /** when the example was laid out (his tracking_since) */
  signUp: string;
  /** when he taps 吃了 for this morning, or null */
  tap: string | null;
  /** the moments the brief is read at */
  read: string[];
  /** the moment the sample visit starts (rule 5) */
  visitAt: string;
  want: Counts;
}

const UNCHANGED: Counts = { due: 33, taken: 29, missed: 4, unconfirmed: 0 };

/** The table of 4.4 (lines 951-958), its four rows, and the 10:00 sign-up with the morning cell answered afterwards. */
const TABLE: TableCase[] = [
  { name: "row 1: signed up at 10:00, after 09:45; the morning cell left alone: 33 / 29 all day", signUp: "10:00", tap: null, read: ["10:00", "10:01", "15:00", "23:59"], visitAt: "10:15", want: UNCHANGED },
  { name: "row 1: signed up at 10:00, then 吃了 for that morning at 10:30: still 33 / 29 all day", signUp: "10:00", tap: "10:30", read: ["10:30", "10:31", "15:00", "23:59"], visitAt: "10:45", want: UNCHANGED },
  { name: "row 2: signed up at 07:00, not yet 09:45, no answer: 33 / 29", signUp: "07:00", tap: null, read: ["07:00", "08:45", "09:44"], visitAt: "09:30", want: UNCHANGED },
  { name: "row 3: signed up at 07:00, 吃了 at 08:52: 34 / 30", signUp: "07:00", tap: "08:52", read: ["08:52", "09:44", "09:45", "23:59"], visitAt: "09:30", want: { due: 34, taken: 30, missed: 4, unconfirmed: 0 } },
  { name: "row 4: signed up at 07:00, no answer by 09:45: 34 / 29 and 1 not confirmed", signUp: "07:00", tap: null, read: ["09:45", "09:46", "23:59"], visitAt: "09:50", want: { due: 34, taken: 29, missed: 4, unconfirmed: 1 } },
];

/** An example account laid out at `c.signUp` on `today`, with the tap of the case made. */
async function tableAccount(today: string, c: Pick<TableCase, "signUp" | "tap">) {
  const clock = clockedStore(sg(today, c.signUp));
  const userId = randomUUID();
  await seedAccount(clock.store, { userId, space: "example", nowMs: clock.at() });
  if (c.tap) {
    clock.set(sg(today, c.tap));
    await answerDose(clock.store, (await clock.store.getSession(userId))!, { medication_id: "med-amlodipine", slot: "morning", state: "taken" }, clock.at());
  }
  const briefAt = async (time: string): Promise<{ scope: SessionRow; brief: AccountBriefView }> => {
    clock.set(sg(today, time));
    const scope = (await clock.store.getSession(userId))!;
    return { scope, brief: await buildAccountBrief(clock.store, scope, "zh-Hans", { nowMs: clock.at(), translate: "cache" }) };
  };
  return { ...clock, userId, briefAt };
}

const counts = (d: Counts): Counts => ({ due: d.due, taken: d.taken, missed: d.missed, unconfirmed: d.unconfirmed });

const check = <K extends CheckCardView["check"]>(view: VisitView, anchor: string, kind: K) =>
  view.cards.find((c): c is Extract<CheckCardView, { check: K }> => c.kind === "chk" && c.anchor === anchor && (c as CheckCardView).check === kind)!;

/** The routine's tai chi weekdays on a scope (as tests/unit/story/seed-account.test.ts reads them). */
function taiChiOf(scope: SessionRow): string[] {
  const tai = routineOf(scope).find((r) => r.label === "Tai chi");
  return Array.isArray(tai?.days) ? (tai!.days as string[]) : [];
}

// ---------------------------------------------------------------- rule 7: the scan

const WEB = process.cwd();
const DAY_EN = /Day\s*\d+/gi;
const DAY_ZH = /第\s*\d+\s*天/g;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const TEMPLATE_D0 = loadTemplate("mr-tan").meta.d0;
/** Every absolute date written in the demo template (its visits, readings, doses, notes, the bag's dispensed date). */
const TEMPLATE_DATES = [...new Set(readFileSync(path.join(WEB, "fixtures", "timeline.seed.json"), "utf8").match(/\d{4}-\d{2}-\d{2}/g) ?? [])].sort();

/** The template's dates that an account laid out on `d0` has no day for (its own days are d0 to d0 + 42, today). */
function strayTemplateDates(d0: string): string[] {
  const own = new Set(Array.from({ length: EXAMPLE_TODAY_DAY + 1 }, (_, k) => storyDate(d0, k)));
  return TEMPLATE_DATES.filter((d) => !own.has(d));
}

/** A date as the app writes one: 2026-08-24, 8月24日, 24 Aug, Aug 24. */
function dateForms(iso: string): RegExp[] {
  const [, m, d] = iso.split("-").map(Number);
  return [new RegExp(iso, "g"), new RegExp(`(?<!\\d)${m}月${d}日`, "g"), new RegExp(`(?<!\\d)${d} ${MONTHS[m - 1]}`, "g"), new RegExp(`${MONTHS[m - 1]} ${d}(?!\\d)`, "g")];
}

interface Him {
  /** user ids that must not be named (his; hers when there is a family member) */
  ids: string[];
  d0: string;
}

/** Everything in `text` that rule 7 forbids, each with the words around it. Empty: clean. */
function storyWords(text: string, him: Him): string[] {
  const found: string[] = [];
  const around = (i: number, n: number) => text.slice(Math.max(0, i - 40), i + n + 40).replace(/\s+/g, " ");
  for (const [name, re] of [
    ["Day N", DAY_EN],
    ["第N天", DAY_ZH],
  ] as const) {
    for (const m of text.matchAll(re)) found.push(`${name}: …${around(m.index ?? 0, m[0].length)}…`);
  }
  for (const iso of strayTemplateDates(him.d0)) {
    for (const re of dateForms(iso)) for (const m of text.matchAll(re)) found.push(`template date ${iso}: …${around(m.index ?? 0, m[0].length)}…`);
  }
  for (const id of him.ids) {
    const i = text.indexOf(id);
    if (i >= 0) found.push(`user id: …${around(i, id.length)}…`);
  }
  return found;
}

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...routeFiles(p));
    else if (name === "route.ts") out.push(path.relative(WEB, p).split(path.sep).join("/"));
  }
  return out.sort();
}
const ROUTES = routeFiles(path.join(WEB, "app", "api"));

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;
type Locale = "zh-Hans" | "en";
interface How {
  params?: Record<string, string>;
  query?: string;
}

/** The GETs that need something in the path or the query before they answer him, and what he would send. */
const HOW: Record<string, (linkId: string) => How[]> = {
  "app/api/visits/[id]/route.ts": () => ["v1", "v2", "p1", "v3"].map((id) => ({ params: { id } })),
  "app/api/visits/[id]/clip/route.ts": () => [{ params: { id: "v2" }, query: "u=v2-u08" }],
  // track R: the parts of a long recording the server has for a visit (none for the example's visits; the answer is his own)
  "app/api/visits/[id]/parts/route.ts": () => ["v1", "v2", "p1", "v3"].map((id) => ({ params: { id } })),
  "app/api/meds/[id]/route.ts": () => ["med-amlodipine", "med-ibuprofen", "med-relative-box"].map((id) => ({ params: { id } })),
  "app/api/reminders/[id]/audio/route.ts": () => [{ params: { id: "clip-wei-ling-1" } }],
  "app/api/understanding/route.ts": () => [{ query: "med_id=med-amlodipine" }],
  "app/api/asr/jobs/route.ts": () => [{ query: "visit_id=v3" }],
  "app/api/labels/sample/route.ts": () => [{ query: "name=losartan" }],
  "app/api/preflight/wait/route.ts": () => [{ query: "ms=0" }],
  "app/api/family/links/[id]/access/route.ts": (linkId) => [{ params: { id: linkId } }],
  "app/api/family/links/[id]/grants/route.ts": (linkId) => [{ params: { id: linkId } }],
};

/** The everyday reads the scan must have covered, each answered 200 (the visits are his four). */
const EVERYDAY = [
  "/api/doses",
  "/api/bp",
  "/api/meds",
  "/api/notes",
  "/api/questions",
  "/api/brief",
  "/api/visits/v1",
  "/api/visits/v2",
  "/api/visits/p1",
  "/api/visits/v3",
  "/api/reminders",
  "/api/profile",
  "/api/me",
  "/api/family/links",
  "/api/ask/history",
  "/api/understanding",
  "/api/watch",
  "/api/prevent",
  "/api/diet",
  "/api/chat",
];

/** GETs that do not answer an example account with 2xx, and why. A GET that is neither scanned nor here fails the test. */
const NOT_HIS: Record<string, string> = {
  "app/api/asr/jobs/[id]/route.ts": "404: he has no recording waiting for its transcript",
  "app/api/blob/read/route.ts": "403: a signed link only",
  "app/api/crew/filming-account/accounts/[ref]/route.ts": "404: the film crew's",
  "app/api/crew/filming-account/accounts/route.ts": "404: the film crew's",
  "app/api/crew/filming-account/route.ts": "404: the film crew's",
  "app/api/demo/warm/route.ts": "404: the judges' page loads the ask pipeline with it (204 for a demo copy); an account has no judges' page",
  "app/api/family/alerts/route.ts": "404: her side, through her link",
  "app/api/family/clip/route.ts": "404: her side, through her link",
  "app/api/family/grants/route.ts": "404: the demo's switches",
  "app/api/family/links/[id]/reset-code/route.ts": "404: her side of a link",
  "app/api/family/live/route.ts": "404: her side, through her link (scene 1, 10-15: his visit as it is recorded)",
  "app/api/family/shared/route.ts": "404: her side, through her link",
  "app/api/family/view/route.ts": "404: her side, through her link",
  "app/api/family/week/route.ts": "404: her side, through her link",
  "app/api/me/export/recording/route.ts": "404: no recording of his own to export",
  "app/api/profile/lang/route.ts": "303: sets the language cookie and goes back",
  "app/api/real/[id]/route.ts": "404: the demo's real-recording check",
  "app/api/real/route.ts": "404: the demo's real-recording check",
  "app/api/session/route.ts": "404: demo sessions only (real-app H5)",
};

/** Answers that are not text (never scanned for words). */
const NOT_TEXT = ["app/api/labels/sample/route.ts", "app/api/reminders/[id]/audio/route.ts", "app/api/visits/[id]/clip/route.ts"];

/**
 * The demo's own routes (app/api/demo/**: the judges' page and the film crew's copy write their story-day sentences
 * through these), and what each answers an account, whatever the method. A demo route that is not here fails the test.
 */
const DEMO_ROUTES: Record<string, string> = {
  "app/api/demo/bp/route.ts": "404: the demo's blood pressure page corrects and deletes a reading here; an account does through /api/bp",
  "app/api/demo/reminders/[id]/route.ts": "404: 「删掉这段」 on the demo's /f; her real account deletes through /api/reminders/[id]?link=",
  "app/api/demo/warm/route.ts": "404: the judges' page loads the ask pipeline; an account has no judges' page",
  "app/api/demo/view/route.ts": "200: a cookie that says this browser shows the demo; it names no session and reads nothing of his",
};
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

interface DemoCall {
  route: string;
  method: string;
  status: number;
  text: string;
}

/** Every handler of every demo route, called as him with something of his own to act on (a reading of today, his daughter's clip). */
async function demoRoutesAsHim(token: string, his: { readingId: string; clipId: string }): Promise<DemoCall[]> {
  const out: DemoCall[] = [];
  for (const route of ROUTES.filter((r) => r.startsWith("app/api/demo/"))) {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(path.join(WEB, route)).href)) as Record<string, unknown>;
    for (const method of METHODS) {
      const handler = mod[method];
      if (typeof handler !== "function") continue;
      const params: Record<string, string> = {};
      const url = route
        .replace(/^app/, "")
        .replace(/\/route\.ts$/, "")
        .replace(/\[(?:\.\.\.)?(\w+)\]/g, (_m, key: string) => encodeURIComponent((params[key] = his.clipId)));
      const body = method === "GET" ? undefined : JSON.stringify(method === "PATCH" ? { id: his.readingId, systolic: 111, diastolic: 71 } : { id: his.readingId });
      const req = new NextRequest(`http://localhost${url}`, { method, headers: { cookie: `rp_at=${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body });
      const res = await (handler as Handler)(req, { params: Promise.resolve(params) });
      out.push({ route, method, status: res.status, text: await res.text() });
    }
  }
  return out;
}

interface Answer {
  route: string;
  url: string;
  locale: Locale;
  /** -1: the handler did not answer in time */
  status: number;
  /** null: a body that is not text */
  text: string | null;
}

const decoder = new TextDecoder();
const answered = (a: Answer) => a.status >= 200 && a.status < 300;

/** Every GET handler under app/api, called as him in one language. */
async function getEverything(token: string, linkId: string, locale: Locale): Promise<Answer[]> {
  const out: Answer[] = [];
  for (const route of ROUTES) {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(path.join(WEB, route)).href)) as Record<string, unknown>;
    if (typeof mod.GET !== "function") continue;
    for (const how of HOW[route]?.(linkId) ?? [{}]) {
      const params: Record<string, string> = {};
      const url = route
        .replace(/^app/, "")
        .replace(/\/route\.ts$/, "")
        .replace(/\[(?:\.\.\.)?(\w+)\]/g, (_m, key: string) => encodeURIComponent((params[key] = how.params?.[key] ?? "x")));
      const abort = new AbortController();
      const req = new NextRequest(`http://localhost${url}?${how.query ? `${how.query}&` : ""}locale=${locale}`, { headers: { cookie: `rp_at=${token}; rp_lang=${locale}` }, signal: abort.signal });
      const res = await Promise.race([Promise.resolve((mod.GET as Handler)(req, { params: Promise.resolve(params) })), new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000))]);
      if (!res) {
        out.push({ route, url, locale, status: -1, text: null });
        continue;
      }
      const type = res.headers.get("content-type") ?? "";
      let text: string | null = null;
      if (type.includes("text/event-stream")) {
        // a stream stays open: what it says first, then it is closed
        const reader = res.body!.getReader();
        const first = await Promise.race([reader.read(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000))]);
        text = first && first.value ? decoder.decode(first.value) : "";
        await reader.cancel().catch(() => undefined);
        abort.abort();
      } else if (/json|^text\//.test(type) || !res.body) {
        text = await res.text();
      } else {
        await res.arrayBuffer();
      }
      out.push({ route, url, locale, status: res.status, text });
    }
  }
  return out;
}

/** The scan's own checks: it covered what it must, nothing was left out silently, and it found nothing. */
function expectClean(pass: string, answers: Answer[], him: Him): void {
  expect(answers.filter((a) => a.status === -1).map((a) => a.url), `${pass}: every handler answered`).toEqual([]);
  const ok = answers.filter(answered);
  for (const locale of ["zh-Hans", "en"] as const) {
    const urls = ok.filter((a) => a.locale === locale && a.text !== null && a.text.length > 0).map((a) => a.url);
    for (const need of EVERYDAY) expect(urls, `${pass} ${locale}: ${need} answered him`).toContain(need);
  }
  // a GET that does not answer him is listed above with its reason; a new one is noticed here
  const silent = [...new Set(answers.map((a) => a.route))].filter((r) => !ok.some((a) => a.route === r)).sort();
  expect(silent, `${pass}: GETs that did not answer him`).toEqual(Object.keys(NOT_HIS).sort());
  expect([...new Set(ok.filter((a) => a.text === null).map((a) => a.route))].sort(), `${pass}: answers that are not text`).toEqual([...NOT_TEXT].sort());
  expect(new Set(ok.map((a) => a.route)).size, `${pass}: GET routes that answered him`).toBeGreaterThanOrEqual(35);
  const found = ok.flatMap((a) => (a.text === null ? [] : storyWords(a.text, him).map((f) => `${pass} ${a.locale} GET ${a.url}: ${f}`)));
  expect(found).toEqual([]);
}

function post(p: string, opts: { token?: string; body: unknown }): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.cookie = `rp_at=${opts.token}`;
  return new NextRequest(`http://localhost${p}`, { method: "POST", headers, body: JSON.stringify(opts.body) });
}

/** An open event stream: everything it sends until `stop`. */
async function listen(url: string, cookie?: string): Promise<{ stop: () => Promise<string> }> {
  const abort = new AbortController();
  const res = await eventsGet(new NextRequest(`http://localhost${url}`, { headers: cookie ? { cookie } : {}, signal: abort.signal }));
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  let text = "";
  const pump = (async () => {
    for (;;) {
      const r = await reader.read().catch(() => ({ done: true as const, value: undefined }));
      if (r.done) return;
      text += decoder.decode(r.value);
    }
  })();
  return {
    stop: async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      abort.abort();
      await pump;
      return text;
    },
  };
}

const HERO = "今天 150/95，我能不能多吃一粒？";
const READINGS_ZH = "我的血压读数平均是多少？";
const READINGS_EN = "How have my readings been?";

/** The sample visit, start to finish, as tests/unit/visit/account-check.test.ts plays it: every line, the whole record, every item 「是」. */
async function replaySampleVisit(store: Store, userId: string): Promise<void> {
  const scope = (await store.getSession(userId))!;
  const lines = fixtureUtterances("v3")!;
  await startVisit(store, scope, { mode: "replay", fixture: "v3" });
  await processChunk(store, scope, "v3", lines);
  const speech = getSpeechProvider();
  const { jobId } = await speech.createFileJob({ url: "fixture:v3", lang: "zh-en-mixed", fixture: "v3" });
  await finalizeVisit(store, scope, "v3", await speech.getFileJob(jobId));
  const items = (await store.listVisitItems(userId, { visit_id: "v3" })).filter((i) => i.slots?.superseded !== true);
  const review = (await buildVisitView(store, userId, "v3"))!;
  const mine = review.lines.filter((l) => l.role === "patient").map((l) => l.id);
  await confirmVisit(store, (await store.getSession(userId))!, "v3", { mine, items: Object.fromEntries(items.map((i) => [i.id, "right" as const])) });
}

// ---------------------------------------------------------------- rule 8: which line answers which question

/**
 * From the answer file of the sample visit (fixtures/visits/v3.expected.json): he asks from his list in three lines
 * (the pattern, his own, the one Ripple refused), and the doctor's next line is the answer that is kept.
 */
const ANSWERED_BY: Record<string, string> = { "q-tai-chi": "v3-u15", "q-knee-2": "v3-u17", "q-extra-tablet": "v3-u19" };

// ================================================================= the seven days

for (const today of TODAYS) {
  const weekday = WEEKDAYS[weekdayIndex(today, 0)];
  const want = BY_TODAY[today];
  const d0 = addDays(today, -EXAMPLE_TODAY_DAY);

  describe(`the example account on ${today} (${weekday})`, () => {
    it("the hand-written expectations are for this day: d0 = today - 42, tai chi turned with d0's weekday", () => {
      expect(want.d0).toBe(d0);
      // 4.3: k = (d0's weekday - Monday) mod 7; Tue and Thu move k days on
      const k = (weekdayIndex(d0, 0) - 1 + 7) % 7;
      expect(want.taiChi).toEqual([WEEKDAYS[(2 + k) % 7], WEEKDAYS[(4 + k) % 7]]);
      expect([15, 17, 24, 36].map((day) => WEEKDAYS[weekdayIndex(d0, day)])).toEqual([want.taiChi[0], want.taiChi[1], want.taiChi[1], want.taiChi[0]]);
    });

    it("rule 4: the brief's numbers equal the table of 4.4, and the other numbers of 4.4", async () => {
      for (const c of TABLE) {
        const account = await tableAccount(today, c);
        for (const time of c.read) {
          const { scope, brief } = await account.briefAt(time);
          expect(counts(brief.doses), `${c.name}, read at ${time}`).toEqual(c.want);

          // 「时间段从第 9 天到今天」, in real dates
          expect(brief.window, c.name).toMatchObject({ fromDay: 9, toDay: 42, fromDate: storyDate(d0, 9), toDate: today, lastVisit: { id: "v2", date: storyDate(d0, 8) } });
          expect(brief.date).toBe(today);
          // 「10 次读数，平均 140/85，9 次不低于医生说的 135/85」
          expect(brief.bp, c.name).toMatchObject({ count: 10, unconfirmed: 0, avgSystolic: 140, avgDiastolic: 85, notBelow: 9 });
          expect(brief.targetLine, c.name).toMatchObject({ kind: "target", text: R1, systolic: 135, diastolic: 85, date: d0, state: "confirmed" });
          // 「漏的 4 个都在两个太极日」: the four missed mornings, each on one of the two weekdays tai chi has on this d0
          expect(brief.doses.missedDays, c.name).toEqual([15, 17, 24, 36]);
          expect(brief.doses.routine, c.name).toMatchObject({ label: "Tai chi", labelZh: "打太极", weekdays: want.taiChi, onRoutine: [15, 17, 24, 36], all: true });
          const missed = brief.doses.days.filter((d) => d.missed > 0);
          expect(missed.map((d) => [d.day, d.date, d.weekday])).toEqual([15, 17, 24, 36].map((day) => [day, storyDate(d0, day), WEEKDAYS[weekdayIndex(d0, day)]]));
          expect(new Set(missed.map((d) => d.weekday))).toEqual(new Set(want.taiChi));
          expect(taiChiOf(scope)).toEqual(want.taiChi);
          // 「第 37 天那句原话，日期写成真实日期」
          const note = brief.notes.find((n) => n.text === D37_NOTE);
          expect(note, c.name).toMatchObject({ day: 37, date: storyDate(d0, 37), text: D37_NOTE });
          expect(brief.notes.map((n) => n.date)).toEqual([storyDate(d0, 20), storyDate(d0, 37)]);
          // 「问题三个」, the pattern one worded with this d0's weekdays and dates
          expect(brief.questions.shown.map((q) => q.id), c.name).toEqual(THREE);
          expect(brief.questions.more).toBe(0);
          const pattern = brief.questions.shown.find((q) => q.id === "q-tai-chi")!;
          expect(pattern.text).toContain(`（${want.taiChiZh}）`);
          expect(pattern.text).toContain(want.missedZh);
          // today's planned visit is not a visit that happened: it is the next one
          expect(brief.nextVisit).toMatchObject({ date: today, days: 0 });
        }
      }
    }, 60_000);

    it("rule 5: the visit check card and the brief of the same moment say the same numbers, in each case of the table", async () => {
      for (const c of TABLE) {
        const account = await tableAccount(today, c);
        // the brief he would show at that moment, read before the visit has a line (afterwards the brief counts from it)
        const { scope, brief } = await account.briefAt(c.visitAt);
        expect(counts(brief.doses), c.name).toEqual(c.want);
        await startVisit(account.store, scope, { mode: "replay", fixture: "v3" });
        const live = (await processChunk(account.store, scope, "v3", fixtureUtterances("v3")!)).view;

        // "the small white one": his medicines
        const med = check(live, "v3-u04", "med");
        expect(med, `${c.name}: the medicines card`).toBeTruthy();
        expect({ due: med.total, taken: med.taken, missed: med.missed, unconfirmed: med.unconfirmed }, c.name).toEqual(c.want);
        expect({ due: med.total, taken: med.taken, missed: med.missed, unconfirmed: med.unconfirmed }, c.name).toEqual(counts(brief.doses));
        expect(med.missedDays).toEqual(brief.doses.missedDays);
        expect(med.routine).toEqual({ label: "Tai chi", labelZh: "打太极", days: want.taiChi });
        expect(med.routine?.days).toEqual(brief.doses.routine?.weekdays);
        expect([med.fromDate, med.toDate]).toEqual([brief.window.fromDate, brief.window.toDate]);
        expect([med.fromDate, med.toDate]).toEqual([storyDate(d0, 9), today]);
        // "Around 130": his readings next to the doctor's number
        const bp = check(live, "v3-u02", "bp");
        expect(bp, `${c.name}: the readings card`).toBeTruthy();
        expect(bp).toMatchObject({ recorded: 10, unconfirmed: 0, avgSystolic: 140, avgDiastolic: 85, notBelow: 9, fromDate: storyDate(d0, 9), toDate: today });
        expect({ count: bp.recorded, unconfirmed: bp.unconfirmed, avgSystolic: bp.avgSystolic, avgDiastolic: bp.avgDiastolic, notBelow: bp.notBelow }).toEqual({
          count: brief.bp.count,
          unconfirmed: brief.bp.unconfirmed,
          avgSystolic: brief.bp.avgSystolic,
          avgDiastolic: brief.bp.avgDiastolic,
          notBelow: brief.bp.notBelow,
        });
        expect(bp.target).toMatchObject({ systolic: 135, diastolic: 85, quote: R1, date: d0, display: "confirmed" });
        expect([bp.target?.systolic, bp.target?.diastolic]).toEqual([brief.targetLine?.systolic, brief.targetLine?.diastolic]);
        // and the list of questions is the brief's three
        const listed = live.qlist!.items.filter((q) => q.questionId && !q.questionId.startsWith("rq-")).map((q) => q.questionId);
        expect(new Set(listed)).toEqual(new Set(brief.questions.shown.map((q) => q.id)));
      }
    }, 60_000);

    it("rule 7 (a): no GET that answers him, in either language, says Day N or 第N天, shows a stray template date or names his id; fresh, then after a morning of use and the sample visit", async () => {
      const store = getMemoryStore();
      setTestClock({ at: sg(today, "10:00"), frozen: true });
      const a = await createAccountWithSpace(store, getAuthProvider(), { login: `sr${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
      const token = a.tokens.access_token;
      const him: Him = { ids: [a.userId], d0 };
      expect(a.scope).toMatchObject({ id: a.userId, d0, story_day: 42, join_code: null });
      // he has invited his daughter, so the family reads have something to say
      const invited = await store.createInvite({ patient_id: a.userId, family_label: "Wei Ling", patient_label: "爸爸", relation: "daughter", invite_token_hash: randomUUID(), invite_expires_at: "2099-01-01T00:00:00.000Z" }, {});
      if (!invited.ok) throw new Error(invited.code);
      const linkId = invited.link.id;

      // the scan is not empty-handed on this day: there is a template date his layout has no day for (but on the Monday,
      // where his d0 is the template's own and every template date is one of his)
      expect(strayTemplateDates(d0).length > 0).toBe(d0 !== TEMPLATE_D0);
      if (d0 !== TEMPLATE_D0) expect(strayTemplateDates(d0)).toContain(TEMPLATE_D0);

      const fresh = [...(await getEverything(token, linkId, "zh-Hans")), ...(await getEverything(token, linkId, "en"))];
      expectClean("fresh", fresh, him);

      // exact dates where the template's would be the easy mistake: his visits, the note, the questions
      const json = (url: string) => JSON.parse(fresh.find((x) => x.url === url && x.locale === "zh-Hans")!.text!) as Record<string, unknown>;
      const visitDate = (id: string) => (json(`/api/visits/${id}`).view as { visit: { date: string } }).visit.date;
      expect([visitDate("v1"), visitDate("v2"), visitDate("p1"), visitDate("v3")]).toEqual([d0, storyDate(d0, 8), storyDate(d0, 12), today]);
      const brief = json("/api/brief").brief as AccountBriefView;
      expect(counts(brief.doses)).toEqual(UNCHANGED);
      expect(brief.notes.find((n) => n.text === D37_NOTE)?.date).toBe(storyDate(d0, 37));
      const open = (json("/api/questions").list as { open: { id: string; text: string; createdDate: string }[] }).open;
      expect(open.map((q) => [q.id, q.createdDate])).toEqual([
        ["q-extra-tablet", storyDate(d0, 29)],
        ["q-tai-chi", storyDate(d0, 25)],
        ["q-knee-2", storyDate(d0, 30)],
      ]);
      expect(open[1].text).toContain(want.missedZh);

      // a morning of use: the example's own sample asks (4.5, 4.7), his readings asked about, a tap, a note; then the visit
      setTestClock({ at: sg(today, "10:30"), frozen: true });
      const stream = await listen("/api/events", `rp_at=${token}`);
      const writes: [string, Response][] = [
        ["ask: the hero line", await askPost(post("/api/ask", { token, body: { text: HERO, locale: "zh-Hans" } }))],
        ["ask: 我今天好累", await askPost(post("/api/ask", { token, body: { text: "我今天好累", locale: "zh-Hans" } }))],
        ["ask: 胸口痛", await askPost(post("/api/ask", { token, body: { text: "胸口痛", locale: "zh-Hans" } }))],
        ["ask: his readings (zh)", await askPost(post("/api/ask", { token, body: { text: READINGS_ZH, locale: "zh-Hans" } }))],
        ["ask: his readings (en)", await askPost(post("/api/ask", { token, body: { text: READINGS_EN, locale: "en" } }))],
        ["dose: 吃了", await dosesPost(post("/api/doses", { token, body: { medication_id: "med-amlodipine", slot: "morning", state: "taken" } }))],
        ["note", await notesPost(post("/api/notes", { token, body: { text: "今天膝盖有点痛。" } }))],
        ["reading: 128/82", await bpPost(post("/api/bp", { token, body: { systolic: 128, diastolic: 82 } }))],
      ];
      const said: Record<string, string> = {};
      for (const [name, res] of writes) {
        const text = await res.text();
        expect(res.status, `${name}: ${text.slice(0, 200)}`).toBeLessThan(300);
        expect(storyWords(text, him).map((f) => `${name}: ${f}`)).toEqual([]);
        said[name] = text;
      }
      // the readings answer speaks of his readings by date (the demo says the same sentence with day numbers: see the controls)
      expect(said["ask: his readings (zh)"]).toMatch(/"sourceId":"log:bp"/);
      expect(said["ask: his readings (zh)"]).toMatch(/"zh":"\d+月\d+日到\d+月\d+日，你记了\d+次血压/);
      expect(said["ask: his readings (en)"]).toMatch(/"en":"From \d+ [A-Z][a-z]{2} to \d+ [A-Z][a-z]{2} you recorded \d+ readings/);

      // the demo's own routes say nothing to him and touch nothing of his: the reading he just recorded, his daughter's clip
      const reading = (JSON.parse(said["reading: 128/82"]) as { reading: { id: string; day: number; systolic: number; diastolic: number } }).reading;
      expect(reading).toMatchObject({ day: 42, systolic: 128, diastolic: 82 });
      const demo = await demoRoutesAsHim(token, { readingId: reading.id, clipId: "clip-wei-ling-1" });
      expect([...new Set(demo.map((c) => c.route))].sort()).toEqual(Object.keys(DEMO_ROUTES).sort());
      expect(demo.map((c) => `${c.method} ${c.route}`)).toEqual(
        expect.arrayContaining(["PATCH app/api/demo/bp/route.ts", "DELETE app/api/demo/bp/route.ts", "DELETE app/api/demo/reminders/[id]/route.ts", "GET app/api/demo/warm/route.ts"]),
      );
      for (const c of demo) {
        if (DEMO_ROUTES[c.route].startsWith("404")) {
          expect([c.status, JSON.parse(c.text)], `${c.method} ${c.route}`).toEqual([404, { error: "not_found" }]);
        } else {
          expect(c.status, `${c.method} ${c.route}`).toBe(200);
          expect(storyWords(c.text, him).map((f) => `${c.method} ${c.route}: ${f}`)).toEqual([]);
        }
      }
      expect((await store.listBp(a.userId, { fromDay: 42, toDay: 42 })).map((r) => [r.id, r.systolic, r.diastolic])).toEqual([[reading.id, 128, 82]]);
      expect((await store.listReminderClips(a.userId)).map((c) => c.id)).toEqual(["clip-wei-ling-1"]);

      await replaySampleVisit(store, a.userId);
      const events = await stream.stop();
      // his own stream carried what he did, without a backstage sentence
      for (const type of ["ask.received", "dose.logged", "note.logged", "bp.logged", "visit.changed", "question.updated"]) expect(events, type).toContain(`"type":"${type}"`);
      // one reading recorded and nothing after it: a demo route that had acted on him would have said "corrected" or "deleted" here
      expect([...events.matchAll(/"type":"bp\.logged"/g)]).toHaveLength(1);
      expect(storyWords(events, him).map((f) => `his event stream: ${f}`)).toEqual([]);

      const used = [...(await getEverything(token, linkId, "zh-Hans")), ...(await getEverything(token, linkId, "en"))];
      expectClean("after use", used, him);
      // the scan read the visit's record and the answers, not an empty page
      const after = (url: string) => used.find((x) => x.url === url && x.locale === "zh-Hans")!.text!;
      expect(after("/api/visits/v3")).toContain("please don't take an extra tablet on your own");
      expect(after("/api/questions")).toContain("please don't take an extra tablet on your own");
      expect(after("/api/ask/history")).toContain(HERO);
    }, 180_000);

    it("rule 7 (b): the push texts the daily jobs send for him, in both languages", async () => {
      for (const locale of ["zh-Hans", "en"] as const) {
        const store = new MemoryStore();
        registerNoticeSender(createWebPushSender({ port: () => storeSubscriptions(pushEntryStore(store)), mayNotify: (to, kind) => mayNotifyFamily(to, kind, { store: careEntryStore(store) }) }));
        try {
          // laid out at 07:00, so this morning's cell is his; his daughter is linked, her no-reply switch is on
          setTestClock({ at: sg(today, "07:00"), frozen: true });
          const auth = getAuthProvider();
          const his = await createAccountWithSpace(store, auth, { login: `sp${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example", locale });
          const hers = await createAccountWithSpace(store, auth, { login: `sw${randomUUID().slice(0, 10)}`, password: "a long test password", space: "none", locale });
          const invited = await store.createInvite({ patient_id: his.userId, patient_label: locale === "en" ? "Dad" : "爸爸", family_label: "Wei Ling", invite_token_hash: randomUUID(), invite_expires_at: "2099-01-01T00:00:00.000Z" }, { no_reply_alert: true });
          if (!invited.ok) throw new Error(invited.code);
          const linkId = invited.link.id;
          const accepted = await store.acceptInvite(invited.link.invite_token_hash!, hers.userId, "Wei Ling");
          if (!accepted.ok) throw new Error(accepted.code);
          const confirmed = await store.confirmLink(linkId, his.userId, true);
          if (!confirmed.ok) throw new Error(confirmed.code);
          const hisPhone = service.newPhone({ label: "his" });
          const herPhone = service.newPhone({ label: "hers" });
          await store.savePushSubscription({ user_id: his.userId, endpoint: hisPhone.endpoint, ...hisPhone.keys });
          await store.savePushSubscription({ user_id: hers.userId, endpoint: herPhone.endpoint, ...herPhone.keys });

          const from = service.messages.length;
          const tick = async (time: string) => {
            const nowMs = sg(today, time);
            setTestClock({ at: nowMs, frozen: true });
            return { doses: await DAILY_DOSES_JOB.run({ store, nowMs, holder: "test" }), bp: await DAILY_BP_JOB.run({ store, nowMs, holder: "test" }) };
          };
          expect((await tick("08:44")).doses).toMatchObject({ first: 0, second: 0, family: 0, sent: 0 });
          expect((await tick("08:45")).doses).toMatchObject({ first: 1, sent: 1 });
          expect((await tick("09:15")).doses).toMatchObject({ second: 1, sent: 1 });
          const closed = await tick("09:45");
          expect(closed.doses).toMatchObject({ settled: 1, family: 1, sent: 1 });
          // the example holds no measuring frequency the doctor gave, so the blood pressure job never reminds him ...
          expect(closed.bp).toMatchObject({ reminded: 0, sent: 0 });
          const scope = (await store.getSession(his.userId))!;
          expect(await bpPlanFor(store, scope)).toBeNull();
          // ... its reminder for this account, had the doctor said "every evening" at v2 (the job's own pass, the plan handed in)
          const plan: BpPlan = {
            words: { text: "Measure it every evening.", itemId: "plan", visitId: "v2", visitDay: 8, visitDate: storyDate(d0, 8), utteranceId: null, tStartMs: null, clipUrl: null, standIn: false, recordedAt: scope.tracking_since! },
            kind: "daily",
            perWeek: null,
            parts: ["evening"],
            fromDay: 9,
            toDay: null,
          };
          const evening = bpWindows(scope, plan, EXAMPLE_TODAY_DAY)[0];
          setTestClock({ at: evening.remindMs, frozen: true });
          expect(await runBpDay(store, (await store.getSession(his.userId))!, evening.remindMs, { plan, locale })).toMatchObject({ reminded: 1, sent: 1 });

          const got = service.messages.slice(from);
          expect(got.map((m) => [m.label, m.status, m.payload?.kind])).toEqual([
            ["his", 201, "dose_first"],
            ["his", 201, "dose_second"],
            ["hers", 201, "family_no_reply"],
            ["his", 201, "bp_due"],
          ]);
          const him: Him = { ids: [his.userId, hers.userId], d0 };
          for (const m of got) {
            expect(storyWords(m.text!, him).map((f) => `${locale} ${String(m.payload?.kind)}: ${f}`)).toEqual([]);
            expect(m.payload?.lang).toBe(locale);
            // her link's id is the address of her alert and nothing else
            const { url, ...rest } = m.payload as { url: string };
            expect(JSON.stringify(rest)).not.toContain(linkId);
            expect(url.includes(linkId)).toBe(m.payload?.kind === "family_no_reply");
            expect(url).not.toContain("session=");
          }
          // the tags carry his real date, never a day number
          expect(got.map((m) => m.payload?.tag)).toEqual([`dose-${today}-morning`, `dose-${today}-morning`, `no-reply-${today}-morning`, `bp-${today}-evening`]);
          if (locale === "zh-Hans") {
            // 2.24 通知一览, the lock-screen words
            expect(got.map((m) => [m.payload?.title, m.payload?.body])).toEqual([
              ["早间药物", "尚未记录"],
              ["早间药物", "尚未记录"],
              ["爸爸尚未回应早间药物提醒", "8:45 和 9:15 两次提醒均未回应。"],
              ["该测量血压了", "打开 Ripple 记录一次"],
            ]);
          }
        } finally {
          registerNoticeSender(null);
        }
      }
    }, 60_000);

    it("rule 7 (c): the pattern question's evidence names the missed mornings by date, never by day number", async () => {
      const { store } = clockedStore(sg(today, "10:00"));
      const userId = randomUUID();
      const scope = await seedAccount(store, { userId, space: "example", nowMs: sg(today, "10:00") });
      const [doses, meds] = await Promise.all([store.listDoses(userId), store.listMeds(userId)]);
      const patterns = routinePatterns({ doses, meds, routine: routineOf(scope), d0, day: EXAMPLE_TODAY_DAY });
      expect(patterns.map((p) => [p.slug, p.weekdays, p.onRoutine])).toEqual([["tai_chi", want.taiChi, [15, 17, 24, 36]]]);
      const zh = patternEvidence(patterns[0], { d0 });
      const en = patternEvidence(patterns[0], { d0, locale: "en" });
      // the dates of this d0, exactly, after the tag the question is found by
      expect(zh.startsWith("pattern:tai_chi; ")).toBe(true);
      expect(zh.endsWith(`（${want.taiChiZh}）：${want.missedZh}`)).toBe(true);
      expect(en.endsWith(`(${want.taiChi.join(", ")}): ${want.missedEn}`)).toBe(true);
      for (const text of [zh, en]) {
        expect(storyWords(text, { ids: [userId], d0 })).toEqual([]);
        expect(text).not.toMatch(/15, 17, 24, 36/);
      }
      // what the seeder stored on q-tai-chi is that evidence
      const stored = (await store.getQuestion(userId, "q-tai-chi"))!;
      expect(stored.evidence).toBe(zh);
      expect(stored.text).toBe(`我漏吃的 4 个早上都在打太极的日子（${want.taiChiZh}）：${want.missedZh}。`);
      // the same pattern without an account is the demo's wording: the scan finds it
      const demo = patternEvidence(patterns[0]);
      expect(demo).toContain("Day 15, 17, 24, 36");
      expect(storyWords(demo, { ids: [userId], d0 })).toHaveLength(1);
    });

    it("rule 8: after the sample visit is replayed and confirmed, the three questions are answered in the doctor's own words, with the speaker and the time point", async () => {
      const clock = clockedStore(sg(today, "10:00"));
      const { store } = clock;
      const userId = randomUUID();
      await seedAccount(store, { userId, space: "example", nowMs: clock.at() });
      const before = await store.listQuestions(userId);
      for (const id of THREE) expect(before.find((q) => q.id === id), id).toMatchObject({ status: "open", answer_text: null, answer_utterance_id: null, answer_visit_id: null, answer_speaker: null });
      expect((await questionList(store, (await store.getSession(userId))!, "zh-Hans")).open.map((q) => q.id)).toEqual(THREE);

      await replaySampleVisit(store, userId);
      clock.set(sg(today, "11:30"));
      const scope = (await store.getSession(userId))!;
      const lines = fixtureUtterances("v3")!;
      const transcript = await store.listUtterances(userId, "v3");
      const rows = await store.listQuestions(userId);
      const list = { "zh-Hans": await questionList(store, scope, "zh-Hans"), en: await questionList(store, scope, "en") };

      for (const id of THREE) {
        const line = lines.find((u) => u.id === ANSWERED_BY[id])!;
        expect(line, `${id}: its line in fixtures/visits/v3.utterances.json`).toBeTruthy();
        // the row: answered, the doctor's sentence word for word, where it was said and by whom
        const row = rows.find((q) => q.id === id) as QuestionRow;
        expect({ status: row.status, answer_text: row.answer_text, answer_visit_id: row.answer_visit_id, answer_utterance_id: row.answer_utterance_id, answer_speaker: row.answer_speaker, asked_at_visit_id: row.asked_at_visit_id }, id).toEqual({
          status: "answered",
          answer_text: line.text,
          answer_visit_id: "v3",
          answer_utterance_id: line.id,
          answer_speaker: "doctor",
          asked_at_visit_id: "v3",
        });
        // the line it points at, in his own record of the visit: the doctor's, confirmed by him, at the recording's time point
        expect(transcript.find((u) => u.id === line.id), id).toMatchObject({ text: line.text, role: "doctor", role_state: "confirmed", t_start_ms: line.t_start_ms, t_end_ms: line.t_end_ms });
        // his question list shows the answer with its speaker, its date and its time point, in either language
        for (const locale of ["zh-Hans", "en"] as const) {
          const shown = list[locale].answered.find((q) => q.id === id);
          expect(shown, `${id} on the ${locale} list`).toBeTruthy();
          expect(shown!.status).toBe("answered");
          expect(shown!.answer, `${id} on the ${locale} list`).toMatchObject({ text: line.text, speaker: "doctor", inferred: false, date: today, tStartMs: line.t_start_ms, visitId: "v3" });
          expect(typeof shown!.answer!.tStartMs).toBe("number");
        }
      }
      // exactly these three time points (the recording's own): 1:34, 1:05, 1:14
      expect(THREE.map((id) => list["zh-Hans"].answered.find((q) => q.id === id)!.answer!.tStartMs)).toEqual([94772, 65166, 74142]);
      // nothing is left to ask: the three, the three answered at earlier visits, and the two Ripple raised at this visit
      expect(list["zh-Hans"].open).toEqual([]);
      const others = list["zh-Hans"].answered.filter((q) => !THREE.includes(q.id));
      expect(others.filter((q) => q.answer?.visitId !== "v3").map((q) => q.id)).toEqual(["q-machine", "q-knee-1", "q-relative-box"]);
      expect(others.filter((q) => q.answer?.visitId === "v3").map((q) => q.origin)).toEqual(["before_you_go", "before_you_go"]);
      expect(list["zh-Hans"].counts).toMatchObject({ open: 0, answered: 8, skipped: 0 });
      // the doctor's sentences are the visit's, not the template's dates or day words
      expect(storyWords(JSON.stringify(list), { ids: [userId], d0 })).toEqual([]);
    }, 60_000);
  });
}

// ================================================================= where the mapping of rule 8 comes from

describe("rule 8: which line answers which question is read from the sample visit's own files", () => {
  it("the answer file: three asks from his list, each answered by the doctor's next line; the template's one seeded answer is that line", () => {
    const answers = v3Expected.answers;
    const asks: [RegExp, string][] = [
      [/^问题 \d+（来自规律/, "q-tai-chi"],
      [/^问题 \d+（他自己的单子/, "q-knee-2"],
      [/^问题 \d+（被拒答的/, "q-extra-tablet"],
    ];
    const derived: Record<string, string> = {};
    for (const [words, id] of asks) {
      const i = answers.findIndex((a) => words.test(a.expected_item));
      expect(i, String(words)).toBeGreaterThan(-1);
      expect(answers[i].true_role).toBe("patient");
      const next = answers[i + 1];
      expect(next.true_role).toBe("doctor");
      expect(next.expected_item.startsWith("回答已存")).toBe(true);
      derived[id] = next.id;
    }
    expect(derived).toEqual(ANSWERED_BY);
    const seeded = loadTemplate("mr-tan").questions.find((q) => q.id === "q-extra-tablet")!;
    expect(seeded.answer).toMatchObject({ visit: "v3", speaker: "doctor", text: fixtureUtterances("v3")!.find((u) => u.id === ANSWERED_BY["q-extra-tablet"])!.text });
    // each answering line is a clinician's sentence in the replay file, with a time point
    for (const id of Object.values(ANSWERED_BY)) expect(fixtureUtterances("v3")!.find((u) => u.id === id)).toMatchObject({ speaker_cluster: 0, t_start_ms: expect.any(Number) });
  });
});

// ================================================================= 4.4, two corners where the count leaves the table

describe("4.4 row 1 「33 个早上，吃了 29 个，全天不变」: two corners where an answer on an untracked cell once changed it", () => {
  // A tap stamped at the very instant of the sign-up (a frozen developer clock, as the journey recordings use). The
  // laid-out mornings carry that same timestamp; they count for what they are (DoseLogRow.pre_tracking), the tap does not.
  it("signed up at 10:00 and 吃了 for that morning at the same instant: 33 / 29", async () => {
    for (const today of TODAYS) {
      const account = await tableAccount(today, { signUp: "10:00", tap: "10:00" });
      expect(counts((await account.briefAt("10:01")).brief.doses), today).toEqual(UNCHANGED);
      // his tap is on his record (Today shows it), as a note outside tracking
      const rows = await account.store.listDoses(account.userId, { fromDay: 42, toDay: 42 });
      expect(rows.map((r) => [r.state, r.pre_tracking, r.created_at]), today).toEqual([["taken", false, new Date(sg(today, "10:00")).toISOString()]]);
    }
  });

  // POST /api/doses { when: "yesterday" } on a laid-out morning replaces its row with one written after tracking began.
  // The correction changes that morning's answer; the morning keeps its place in every count.
  it("signed up at 10:00 and yesterday's laid-out answer tapped again: 33 / 29; corrected to 没吃: 33 / 28, 5 missed", async () => {
    const store = getMemoryStore();
    for (const today of TODAYS) {
      setTestClock({ at: sg(today, "10:00"), frozen: true });
      const a = await createAccountWithSpace(store, getAuthProvider(), { login: `sy${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
      const briefNow = async (time: string) => counts((await buildAccountBrief(store, (await store.getSession(a.userId))!, "zh-Hans", { nowMs: sg(today, time), translate: "cache" })).doses);
      setTestClock({ at: sg(today, "10:30"), frozen: true });
      const again = await dosesPost(post("/api/doses", { token: a.tokens.access_token, body: { medication_id: "med-amlodipine", slot: "morning", state: "taken", when: "yesterday" } }));
      // the tap is taken (not refused), written on yesterday, at the moment he tapped
      expect(again.status, today).toBe(200);
      expect(((await again.json()) as { dose: { day: number; state: string; created_at: string } }).dose, today).toMatchObject({ day: 41, state: "taken", created_at: new Date(sg(today, "10:30")).toISOString() });
      expect(await briefNow("10:31"), today).toEqual(UNCHANGED);

      // the correction itself: yesterday was not taken after all
      setTestClock({ at: sg(today, "10:40"), frozen: true });
      const fixed = await dosesPost(post("/api/doses", { token: a.tokens.access_token, body: { medication_id: "med-amlodipine", slot: "morning", state: "missed", reason: "forgot", when: "yesterday" } }));
      expect(fixed.status, today).toBe(200);
      expect(await briefNow("10:41"), today).toEqual({ due: 33, taken: 28, missed: 5, unconfirmed: 0 });

      // and put back (his undo bar: DELETE with the answer he had before): 33 / 29 again, the morning never left
      setTestClock({ at: sg(today, "10:41"), frozen: true });
      const undone = await dosesDelete(
        new NextRequest("http://localhost/api/doses", {
          method: "DELETE",
          headers: { "content-type": "application/json", cookie: `rp_at=${a.tokens.access_token}` },
          body: JSON.stringify({ medication_id: "med-amlodipine", slot: "morning", when: "yesterday", restore: { state: "taken" } }),
        }),
      );
      expect(undone.status, today).toBe(200);
      expect(await briefNow("10:42"), today).toEqual(UNCHANGED);
    }
  });
});

// ================================================================= controls: the checks above can fail

describe("controls", () => {
  it("rule 7: the same scan finds Day 41 and 第N天 on a demo sandbox (its event stream and its answer about his readings), and a planted date or id", async () => {
    setTestClock(null);
    const store = getMemoryStore();
    const demo = await store.createSession({ story_day: 41, ttl_hours: 1 });
    const nobody: Him = { ids: [randomUUID()], d0: "2026-08-28" };
    const stream = await listen(`/api/events?session=${demo.id}`);
    const tick = await dosesPost(post(`/api/doses?session=${demo.id}`, { body: { medication_id: "med-amlodipine", slot: "morning", state: "taken" } }));
    expect(tick.status).toBe(200);
    const ask = await askPost(post(`/api/ask?session=${demo.id}`, { body: { text: READINGS_ZH, locale: "zh-Hans" } }));
    expect(ask.status).toBe(200);
    const answer = await ask.text();
    const events = await stream.stop();
    // the backstage sentence of his tick
    expect(events).toContain("Day 41 morning");
    expect(storyWords(events, nobody).some((f) => f.startsWith("Day N: ") && f.includes("Day 41"))).toBe(true);
    // the same question the example account asked: here the sentence counts in story days, in both languages
    expect(answer).toMatch(/"zh":"第\d+天到第\d+天，你记了\d+次血压/);
    const found = storyWords(answer, nobody);
    expect(found.some((f) => f.startsWith("Day N: "))).toBe(true);
    expect(found.some((f) => f.startsWith("第N天: "))).toBe(true);
    // the demo shows the template's own dates: stray ones for an account laid out four days later
    expect(found.some((f) => f.startsWith(`template date ${TEMPLATE_D0}`))).toBe(true);

    // planted values, one of each kind
    const id = nobody.ids[0];
    expect(storyWords("第 41 天", nobody)).toHaveLength(1);
    expect(storyWords("day41", nobody)).toHaveLength(1);
    expect(storyWords(`{"owner":"${id}"}`, nobody)).toHaveLength(1);
    expect(storyWords("8月24日 / 24 Aug / Aug 24 / 2026-08-24", nobody)).toHaveLength(4);
    // his own days are not stray: d0 itself, and a day written like a later one
    expect(storyWords("2026-08-28, 8月28日, 28 Aug; 18月24日, 124 Aug", nobody)).toEqual([]);
    expect(storyWords("早上的药 · 还没记 Monday, 12 Oct today", nobody)).toEqual([]);
  });

  it("rule 4: the demo's v3 keeps 33 / 29 (story time empty or before 09:45), on its brief and on its check card", async () => {
    setTestClock(null);
    const store = getMemoryStore();
    for (const time of [null, "09:00"]) {
      const demo = await store.createSession({ story_day: 42, story_time: time, ttl_hours: 1 });
      const brief = await buildBrief(store, demo, "zh-Hans");
      expect(brief.doses, `story time ${time}`).toMatchObject({ due: 33, taken: 29, missed: 4, unconfirmed: 0, missedDays: [15, 17, 24, 36] });
      expect(brief.bp).toMatchObject({ count: 10, avgSystolic: 140, avgDiastolic: 85, notBelow: 9 });
      await startVisit(store, demo, { mode: "replay", fixture: "v3" });
      const live = (await processChunk(store, demo, "v3", fixtureUtterances("v3")!)).view;
      expect(check(live, "v3-u04", "med")).toMatchObject({ total: 33, taken: 29, missed: 4 });
    }
  });
});
