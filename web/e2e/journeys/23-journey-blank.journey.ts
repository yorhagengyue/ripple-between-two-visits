/**
 * 23 空白账号整条线：从欢迎页到简报 (C2 track G; docs/plan/real-app.md 8.12, lines 1548-1559).
 * The design names this test `e2e/real/journey-blank.spec.ts`. It is written with the recording kit, so that the same
 * walk can be recorded as an mp4, and the kit takes only files named `NN-name.journey.ts`: hence this name and place.
 *
 * ONE blank account, one continuous walk, in the design's order. Two phones: 陈先生的手机 and 女儿的手机. Both people
 * sign up through the app's real pages. The only developer tools used are the test clock (POST /api/dev/clock) and one
 * pass of named scheduled jobs (POST /api/dev/tick): a person cannot move time or wait for a job. Day one is the
 * server's real "today" in Singapore; every date below is worked out from it.
 *
 *   1  day 1 07:30  the welcome page, 注册 (username, the two consents, 从空白开始, the recovery code shown once),
 *                   setting up by himself: the clinic, breakfast 08:30 (so the morning reminder is 08:45), tai chi on
 *                   Saturday; the other screens are skipped or put off
 *   2        07:50  /p/meds/add: the camera input gets fixtures/labels/amlodipine.png, the stub reader reads it, he
 *                   confirms line by line; the label's 「every MORNING」 sets the one morning slot (药袋上写着)
 *   3        08:40  Today says the reminder comes at 8:45; 08:45 the medicine job runs once: the reminder is his (he
 *                   confirmed the medicine before the window opened); 08:52 吃了
 *   4        09:00  one reading (142/88); one ask with the stub model; 「加一个问题」 on the question list
 *   5        09:20  he invites Wei Ling; she signs up through the invitation's own pages and accepts; he confirms it
 *                   is her and switches on 「每天吃药了没有」 only: her page shows his medicine and nothing else
 *   6        10:00  the visit: the consent card, a recording with Chromium's fake microphone while nothing listens on
 *                   127.0.0.1:7966: the visit is awaiting_transcript and the review says the recording is kept and
 *                   waits for its text. Then a stand-in Whisper comes up (corner label), one pass of asr.pending sends
 *                   the saved recording, and he reviews: the prescription, the follow-up, the target, the doctor's
 *                   answer to the question he added, the warning line; then the line that was his own
 *   7        10:45  「我的药」 has one more row, Losartan 「等药袋确认」; he photographs fixtures/labels/losartan.png and
 *                   the row is confirmed with its morning slot
 *   8  day 2        08:45 reminder, 吃了 for both medicines; one reading (138/84)
 *      day 3        both reminders unanswered; after 09:45 the job settles both medicines as 「没回」; her phone, with
 *                   the no-reply switch off, is told nothing
 *      day 4        08:45 reminder, 吃了
 *   9  day 4 10:00  the brief: real dates; the medicine counts equal what this script tapped and what was settled
 *                   (worked out below from the script's own ledger, per medicine and slot); his reading next to the
 *                   doctor's own words for the target; on the question list the answered one is the doctor's sentence
 *   10              the leak watch (e2e/real/_leak.ts, H1 and H3) on both phones for the whole walk
 *
 * Where the built app differs from the design's list, the app is followed:
 *   - The brief covers the days after the last clinic visit (lib/summary/account-brief.ts sinceLastHappenedVisit; real-app
 *     2.18). The reading of step 4 is taken before the visit, so it can never be in the brief that follows it. Step 9's
 *     「读数和医生原话并列」 is therefore checked with a second reading, taken on day 2. The same holds for the dose of
 *     step 3: the brief counts days 2 to 4.
 *   - A Whisper transcript has no speakers (lib/asr/whisper.ts): who said a line is guessed from its own words
 *     (lib/visit/roles.ts), and a doctor's sentence becomes the answer to a question only when the question line
 *     reads as his and the next line reads as the clinician's (lib/visit/extract.ts). The stand-in transcript is made
 *     of lines of the replay files, text and time points as written there (fixtures/visits): the first nine lines of
 *     v3 and its last one (the prescription, the follow-up, the warning line), and three lines of v1 at v1's own time
 *     points (the target, and the wrist-monitor question with its answer). v3 itself states no target, and none of
 *     its five question-and-answer pairs is recognised without speakers: those ten lines of v3 are left out here, and
 *     reported as a finding by track G (web/progress/g.md).
 *   - The recording is a few seconds of Chromium's test tone, the stand-in transcript's time points are the replay
 *     files': no line of the review has a clip cut from the recording.
 *
 * Environment. Offline (the default, what track G ran):
 *   SPEECH_PROVIDER=whisper WHISPER_URL=http://127.0.0.1:7966 WHISPER_TOKEN=<any 43 characters or more> \
 *     node scripts/record/serve.mjs --port <port> --build --detach        (memory store, memory sign-in, stub model)
 *   node scripts/record/run.mjs 23 --base-url http://localhost:<port>
 * Nothing may listen on 127.0.0.1:7966 when the journey starts: it starts its own stand-in Whisper there in step 6,
 * on the machine the server runs on.
 *
 * Against the real test database and the real model (the integrator):
 *   SPEECH_PROVIDER=whisper WHISPER_URL=http://127.0.0.1:7966 WHISPER_TOKEN=<any 43 characters or more> \
 *     node scripts/record/serve.mjs --port <port> --no-offline
 * with web/.env pointing at the TEST project (STORE=supabase, AUTH_PROVIDER=supabase and their keys; migrations
 * 0001-0017 applied; file storage as .env has it: the recording is really uploaded) and LLM_PROVIDER=hunyuan with its key pair. The three
 * speech variables are given in the environment of that command so that they override .env. RIPPLE_DEPLOYED unset,
 * JOBS unset (the journey ticks the jobs itself), RIPPLE_DEV_TOOLS=1 (serve.mjs sets it). Then
 *   JOURNEY_MODEL=real node scripts/record/run.mjs 23 --base-url http://localhost:<port>
 * With the real database and the stub model (LLM_PROVIDER=mock CHECKER_PROVIDER=mock in the environment of serve.mjs),
 * leave JOURNEY_MODEL unset.
 *
 * The two switches (read by the journey, not by the server; _g/mode.ts):
 *   JOURNEY_MODEL=real   keeps every assertion the design requires with any model and drops only the stub's exact
 *                        output: the number and spelling of a label's lines (each is still confirmed, the medicine and
 *                        its morning slot must come out), which leaflet sentence answers the ask (each line shown must
 *                        still carry its source), the number and order of the review's lines and the exact rows under
 *                        each (the five lines of the stand-in transcript must still come up and hold at least the
 *                        rules' rows), 「没听出是谁说的」 being exactly three lines, and the question lists being exactly
 *                        one row long. Track G ran this branch against the stub model only: no real model was called.
 *   JOURNEY_SPEECH=none  the two offline-only things of this journey are the fake microphone (_g/fake-mic.ts) and the
 *                        stand-in Whisper (_g/fake-whisper.ts). A browser test has no microphone and no conversation,
 *                        so they stay on by default, also against the real database: they are the design's step 6 as
 *                        written. With JOURNEY_SPEECH=none neither is used and the server's transcription may be
 *                        anything (the real Whisper service, devfake, mock): the journey then leaves out steps 6 and 7
 *                        (no visit, no Losartan) and walks the rest, the brief counting from day 1 with no doctor's
 *                        line in it. The real service's own path on an account is journey 05-whisper.
 *
 * Nobody else may use that server meanwhile: the test clock is one clock for the whole process, and the journey moves
 * it three days ahead. Each run makes two accounts (sign-ups per address: 5 an hour, 500 with the developer tools on)
 * and deletes both at the end; a run that fails deletes them too when the phones are still open.
 */
import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import type { VisitView } from "@/lib/visit/types";
import { LeakWatch } from "../real/_leak";
import { expect, journey } from "./_kit";
import { deleteAccount, getJson, HER_PASSWORD, HIS_PASSWORD, me, newLoginName, signUpThroughPages, userIdOf } from "./_g/account";
import { addDays, clearClock, setClock, sgt, sgToday, tick, tickDoses, utcOf, zhDay } from "./_g/clock";
import { FAKE_MIC_LAUNCH } from "./_g/fake-mic";
import { FakeWhisper, fixtureLines, type FakeLine } from "./_g/fake-whisper";
import { settleWithin } from "./_g/leak";
import { REAL_MODEL, STANDIN_SPEECH } from "./_g/mode";
import { clipAt, sayYes } from "./_g/review";

// the fake microphone only with the stand-ins on (JOURNEY_SPEECH, see _g/mode.ts); without them no visit is recorded
if (STANDIN_SPEECH) journey.use({ launchOptions: FAKE_MIC_LAUNCH });

const LABELS = path.join(__dirname, "..", "..", "fixtures", "labels");
const CLINIC = "Blossom Family Clinic";
const ASK = "早上忘了吃，现在补吃可以吗？";
const QUESTION = "家里的血压计是绑手腕的，可以用吗？";

/** The stand-in transcript (see the header): v3's opening, prescription, follow-up and warning line; v1's target and wrist-monitor answer. */
const TRANSCRIPT: FakeLine[] = [
  ...fixtureLines("v3", { ids: ["v3-u01", "v3-u02", "v3-u03", "v3-u04", "v3-u05", "v3-u06", "v3-u07", "v3-u08", "v3-u09", "v3-u20"] }),
  ...fixtureLines("v1", { ids: ["v1-u08", "v1-u11", "v1-u12"] }),
].sort((a, b) => a.start_ms - b.start_ms);
const line = (start: string): FakeLine => {
  const found = TRANSCRIPT.find((l) => l.text.startsWith(start));
  if (!found) throw new Error(`no line of the stand-in transcript starts with "${start}"`);
  return found;
};
const PRESCRIBED = line("Okay. We keep amlodipine");
const FOLLOW_UP = line("Do a blood test");
const TARGET = line("At home, we want it below 135 over 85.");
const HIS_ASK = line("医生，我家里那个机器");
const ANSWER = line("手腕的不太准");
const WARNING = line("If it's high, sit down");
const HIS_OWN_LINE = line("Hmm, don't think so.");
/** The question Ripple itself keeps for next time when a blood test is ordered (lib/visit/questions.ts RIPPLE_QUESTIONS.bloodTest). */
const RIPPLE_TEST_QUESTION = "验血要空腹吗？";

/** The two medicines as her page names them. */
const MED_NAME: Record<string, string> = { "med-amlodipine": "Amlodipine", "med-losartan": "Losartan" };

const fake = new FakeWhisper({ lines: TRANSCRIPT });

/** What the script itself did to each cell (one medicine, one slot, one day): the brief must count exactly this. */
type Mark = "taken" | "no_reply";
interface Cell {
  date: string;
  med: string;
  slot: "morning";
  mark: Mark;
}
interface DoseRow {
  medication_id: string;
  day: number;
  slot: string;
  state: string;
  reason: string | null;
  created_at: string;
}
interface MedItem {
  id: string;
  status: string;
  slots: string[];
}
interface QuestionOut {
  id: string;
  text: string;
  for: string;
  origin: string;
  status: string;
  answer?: { text: string; speaker: string; date: string; tStartMs: number | null; inferred: boolean } | null;
}
interface QuestionListOut {
  list: { open: QuestionOut[]; answered: QuestionOut[]; skipped: QuestionOut[]; counts: { open: number; answered: number; skipped: number } };
}
interface BriefOut {
  brief: {
    kind: string;
    date: string;
    window: { fromDate: string; toDate: string; lastVisit: { date: string } | null };
    bp: { count: number; avgSystolic: number | null; avgDiastolic: number | null; notBelow: number | null };
    targetLine: { text: string; state: string; systolic: number; diastolic: number | null; date: string; tStartMs: number | null } | null;
    doses: { due: number; taken: number; missed: number; unconfirmed: number; days: { date: string; due: number; taken: number; missed: number; unconfirmed: number }[]; meds: { id: string }[] };
    questions: { shown: { id: string; text: string; origin: string }[]; more: number };
    nextVisit: { date: string; days: number } | null;
  };
}
interface HerHome {
  grants: Record<string, boolean>;
  status: { state: string } | null;
  week: { days: { date: string; mark: string; slots: { slot: string; cells: { name: string; mark: string }[] }[] }[] } | null;
  noReply: unknown;
  bp: unknown;
  questions: unknown;
  visitsShared: boolean;
  notesShared: boolean;
}

/** The accounts this run has made and not yet deleted (phone, password): a run that fails tidies up after itself too. */
const accounts: { context: BrowserContext; password: string }[] = [];

journey.afterEach(async () => {
  // only after a failure (the journey deletes both accounts itself, and checks it); best effort, the phones are still open
  for (const m of accounts.splice(0)) await m.context.request.post("/api/me/delete", { data: { password: m.password, confirm: true } }).catch(() => undefined);
});

journey.afterAll(async ({ request }) => {
  await clearClock(request);
  await fake.stop();
});

journey("23 空白账号整条线：从欢迎页到简报", async ({ kit, request }) => {
  journey.setTimeout(25 * 60_000);

  // ---- the days: the server's real today in Singapore is day one
  const D1 = sgToday();
  const D2 = addDays(D1, 1);
  const D3 = addDays(D1, 2);
  const D4 = addDays(D1, 3);
  const dayOf = (date: string) => [D1, D2, D3, D4].indexOf(date);
  const clock = (date: string, hhmm: string) => setClock(request, sgt(date, hhmm));
  const ledger: Cell[] = [];

  // ---- what the server must be (with the stand-ins on): Whisper configured, and nothing listening there yet
  if (STANDIN_SPEECH) {
    const health = (await (await request.get("/api/asr/health")).json()) as { provider?: string; whisper?: { healthy?: boolean } };
    expect(health.provider, "the server runs SPEECH_PROVIDER=whisper (see the header)").toBe("whisper");
    expect(health.whisper?.healthy, "nothing listens on the Whisper address when the journey starts").toBe(false);
  }
  /** the medicines he has a morning cell for from day 2 on: Losartan only when the visit prescribed it */
  const MORNING_MEDS = STANDIN_SPEECH ? ["med-amlodipine", "med-losartan"] : ["med-amlodipine"];

  await clock(D1, "07:30");
  if (STANDIN_SPEECH) kit.cornerLabel("麦克风和转写服务：测试替身");
  const { elder, daughter } = await kit.phones({ elder: "陈先生的手机", daughter: "女儿的手机" });
  const pp = elder.page;
  const dp = daughter.page;
  const watch = new LeakWatch();
  watch.attach(elder.context, "elder");
  watch.attach(daughter.context, "daughter");
  if (STANDIN_SPEECH) await elder.context.grantPermissions(["microphone"]);
  /** the end of a step: the leak watch looks at the screen as it stands */
  const seen = async (page: Page = pp) => watch.page(page, page === dp ? "daughter" : "elder");
  const hisLogin = newLoginName("tan");
  const herLogin = newLoginName("weiling");
  // her phone before she opens the link: a dark screen (her side is dark), not a white blank page
  await dp.setContent('<html><body style="margin:0;background:#05070A"></body></html>');
  await pp.goto("/");

  const doseRows = async (): Promise<DoseRow[]> => (await getJson<{ doses: DoseRow[] }>(elder.context, `/api/doses?from=0&to=${dayOf(D4)}`)).doses;
  const meds = async (): Promise<MedItem[]> => (await getJson<{ groups: { items: MedItem[] }[] }>(elder.context, "/api/meds")).groups.flatMap((g) => g.items);
  const questions = async () => (await getJson<QuestionListOut>(elder.context, "/api/questions")).list;
  /** the ledger as dose rows would say it, in a fixed order */
  const asRows = (cells: Cell[]) =>
    cells
      .map((c) => `${c.date} ${c.slot} ${c.med} ${c.mark === "taken" ? "taken" : "unconfirmed:no_reply"}`)
      .sort();
  const rowsAsCells = (rows: DoseRow[]) => rows.map((r) => `${[D1, D2, D3, D4][r.day]} ${r.slot} ${r.medication_id} ${r.state}${r.reason ? `:${r.reason}` : ""}`).sort();

  // =================================================================== 1. the welcome page, sign-up, setting up
  await kit.step(pp, "陈先生第一次打开 Ripple，在欢迎页点「注册」");
  // the welcome page is found by its own test id (app/page.tsx; components/ui Screen passes it on since track B's fix
  // round), on the screen itself
  const frontDoor = pp.getByTestId("front-door");
  await expect(frontDoor).toHaveAttribute("data-rp", "screen");
  await expect(frontDoor.getByRole("heading", { level: 1 })).toHaveText("Ripple");
  await expect(frontDoor).toContainText("看医生时把医生的话留下来，回家听得懂、记得住。");
  await expect(pp.getByTestId("front-door-login")).toHaveText("登录");
  await expect(pp.getByTestId("front-door-signup")).toHaveText("注册");
  // the app opens as the iOS app does (line fe-entry): the cold start's black screen with the mark drawing itself in
  // lies over the welcome for about 3.6 s and ends by itself; the welcome's buttons are his when it is gone
  await expect(pp.locator('[data-rp="splash"]')).toBeHidden({ timeout: 20_000 });
  await seen();
  await pp.getByTestId("front-door-signup").click();
  // 「注册」 leads to 「你是哪一位？」: he says he is the elder, and the elder's sign-up opens
  await expect(pp).toHaveURL(/\/who\?do=signup$/);
  await kit.step(pp, "先问他是哪一位：他点「我是长辈」");
  await expect(pp.getByTestId("who").getByRole("heading", { level: 1 })).toHaveText("你是哪一位？");
  await expect(pp.getByTestId("who-elder")).toContainText("我是长辈");
  await seen();
  await pp.getByTestId("who-elder").click();
  await expect(pp).toHaveURL(/\/signup\?as=elder$/);

  const signedUp = await signUpThroughPages(kit, elder, { name: "陈先生", login: hisLogin, password: HIS_PASSWORD, space: "blank", afterStep: seen });
  await pp.waitForURL("**/onboard/who");
  accounts.push({ context: elder.context, password: HIS_PASSWORD });
  const hisId = await userIdOf(elder.context);
  watch.addId("his user id (his scope id)", hisId);
  const mine = await me(elder.context);
  expect(mine.status).toBe(200);
  expect(mine.body).toMatchObject({ account: { login: hisLogin, display_name: "陈先生", login_kind: "username" }, scope: { example_data: false, onboarding: "started" } });
  expect((mine.body.consents as { kind: string; decision: string; assisted: boolean }[]).map((c) => [c.kind, c.decision, c.assisted])).toEqual([
    ["terms_privacy", "granted", false],
    ["ai_processing", "granted", false],
  ]);
  expect(JSON.stringify(mine.body)).not.toContain(signedUp.recoveryCode);

  const headline = pp.locator('[data-rp="headline"]');
  const next = pp.getByTestId("onboard-next");
  await kit.step(pp, "空白账号先建档：这一轮他自己填");
  await expect(headline).toHaveText("现在是谁在填？");
  await expect(pp.getByTestId("onboard-who-self")).toHaveAttribute("data-current", "true");
  await seen();
  await pp.getByTestId("onboard-who-self").click();
  await pp.waitForURL("**/onboard/clinic");
  // he fills it in himself: nothing he enters waits for anybody's confirmation
  await expect(pp.locator('[data-rp="helped"]')).toHaveCount(0);
  // the screens of setting up are six items; the step bar says which one a screen belongs to
  await expect(pp.locator('[data-rp="step"]')).toContainText("建档 · 第 1 项，共 6 项");

  await kit.step(pp, `常去的诊所：他写 ${CLINIC}`);
  await kit.type(pp.getByTestId("onboard-clinic"), CLINIC);
  await seen();
  await next.click();
  await pp.waitForURL("**/onboard/breakfast");

  await kit.step(pp, "早饭 8:30，早上的药就排在 8:45 提醒");
  await pp.getByTestId("onboard-breakfast-08:30").click();
  await expect(pp.getByTestId("onboard-reminder-at")).toHaveText("早上的药，会在 早上 8:45 提醒你。");
  await seen();
  await next.click();
  await pp.waitForURL("**/onboard/habits");

  await kit.step(pp, "每周固定做的事：周六早上 7:00 打太极");
  await pp.getByTestId("onboard-habit-tai-chi").click();
  await pp.getByTestId("onboard-day-Sat").click();
  await pp.getByTestId("onboard-habit-time-07:00").click();
  await pp.getByTestId("onboard-habit-add").click();
  const habit = pp.locator('[data-rp="habit"][data-habit="Tai chi"]');
  // the routine is a list now: the entry's name, and when it falls on the line under it
  await expect(habit).toContainText("打太极");
  await expect(habit).toContainText("周六 · 早上 7:00");
  await kit.show(habit);
  await seen();
  await next.click();
  await pp.waitForURL("**/onboard/meds");

  await kit.step(pp, "药先点「以后再说」，建完档再去拍药袋");
  await expect(pp.getByTestId("onboard-meds-photo")).toBeVisible();
  await seen();
  await pp.getByTestId("onboard-meds-later").click();
  await pp.waitForURL("**/onboard/age");

  await kit.step(pp, "年龄、病史、过敏这三屏，他都先跳过");
  await seen();
  await pp.getByTestId("onboard-skip").click();
  await pp.waitForURL("**/onboard/conditions");
  await pp.getByTestId("onboard-skip").click();
  await pp.waitForURL("**/onboard/allergies");
  await pp.getByTestId("onboard-skip").click();
  await pp.waitForURL("**/onboard/family");

  await kit.step(pp, "请家人和开提醒，也都点「以后再说」");
  await seen();
  await pp.getByTestId("onboard-family-later").click();
  await pp.waitForURL("**/onboard/reminders");
  await expect(pp.locator('[data-rp="text"]').first()).toContainText("早上的药，早上 8:45 提醒你。");
  await pp.getByTestId("onboard-reminders-later").click();
  await pp.waitForURL("**/onboard/done");

  await kit.step(pp, "建好了：早上的药提醒写着早上 8:45");
  await expect(pp.locator('[data-rp="done-hero"]')).toContainText("建好了。");
  const doneRows = pp.locator('[data-rp="row"]');
  await expect(doneRows.filter({ hasText: "早上的药提醒" })).toContainText("早上 8:45");
  await expect(doneRows.filter({ hasText: "常去的诊所" })).toContainText(CLINIC);
  await expect(doneRows.filter({ hasText: "等你确认" })).toHaveCount(0);
  const profile = (await getJson<{ profile: { clinic: string | null; breakfast: string | null; reminderAt: string; onboarding: string; habits: unknown[]; pending: unknown[]; facts: { kind: string; source: string; confirmed: boolean }[] } }>(elder.context, "/api/profile")).profile;
  expect(profile).toMatchObject({ clinic: CLINIC, breakfast: "08:30", reminderAt: "08:45", pending: [] });
  expect(profile.habits).toEqual([{ label: "Tai chi", label_zh: "打太极", days: ["Sat"], time: "07:00" }]);
  expect(profile.facts.map((f) => [f.kind, f.source, f.confirmed])).toEqual([
    ["clinic", "patient", true],
    ["routine", "patient", true],
    ["routine", "patient", true],
  ]);
  await seen();
  await pp.getByTestId("onboard-done").click();
  await pp.waitForURL("**/p/today");
  expect((await me(elder.context)).body).toMatchObject({ scope: { onboarding: "done" } });

  // =================================================================== 2. photographing a label
  await clock(D1, "07:50");
  await pp.goto("/p/today");
  await kit.step(pp, "今天页还没有药，他点「拍药袋」加第一种");
  await expect(pp.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
  await expect(pp.getByText(zhDay(D1)).first()).toBeVisible();
  await expect(pp.getByTestId("dose-headline")).toHaveAttribute("data-why", "no-meds");
  await seen();
  await pp.getByTestId("dose-empty-label").click();
  await pp.waitForURL(/\/p\/meds\/add$/);

  await kit.step(pp, "这是医生开的药：选「医生开的」，再选拍药袋");
  await expect(pp.getByTestId("add-origin")).toBeVisible();
  await seen();
  await pp.getByTestId("add-origin-prescription").click();
  await expect(pp.getByTestId("add-how")).toBeVisible();
  await pp.getByTestId("add-how-photo").click();
  await expect(pp.getByTestId("add-photo")).toBeVisible();
  // a blank account has no sample labels: only his own camera
  await expect(pp.getByTestId("add-sample-amlodipine")).toHaveCount(0);

  await kit.step(pp, "手机相机拍下药袋，Ripple 读出上面的字");
  await seen();
  await pp.getByTestId("add-file").setInputFiles(path.join(LABELS, "amlodipine.png"));
  const check = pp.getByTestId("add-check");
  await expect(check).toBeVisible({ timeout: 30_000 });
  if (!REAL_MODEL) await expect(check).toHaveAttribute("data-total", "5");

  const value = pp.getByTestId("add-check-value");
  const confirmLabel = async (lines: readonly (readonly [string, string])[]) => {
    if (REAL_MODEL) {
      // a real model reads the picture in its own spelling and may read more lines: the medicine's name must be in
      // the first one (the label's first line, its first word), and he says 「对」 to every line
      await expect(value).toContainText(new RegExp(lines[0][1].split(" ")[0], "i"));
      for (let i = 0; i < 12 && (await check.count()) > 0; i++) {
        const index = await check.getAttribute("data-index");
        await pp.getByTestId("add-line-right").click();
        await expect.poll(async () => (await check.count()) === 0 || (await check.getAttribute("data-index", { timeout: 500 }).catch(() => null)) !== index).toBe(true);
      }
      return;
    }
    for (const [field, text] of lines) {
      await expect(value).toHaveAttribute("data-field", field);
      await expect(value).toContainText(text);
      await pp.getByTestId("add-line-right").click();
      await kit.pause(400);
    }
  };
  await kit.step(pp, "药名、规格、用法、日期、诊所，逐行点「对」");
  await seen();
  await confirmLabel([
    ["drug_text", "AMLODIPINE 5MG TABLET"],
    ["strength", "5 mg"],
    ["directions", "Take ONE tablet every MORNING"],
    ["dispensed", "9月1日"],
    ["clinic", CLINIC],
  ]);
  const added = pp.getByTestId("add-done");
  await expect(added).toBeVisible({ timeout: 30_000 });

  await kit.step(pp, "药袋上写着每天早上：定在早上这一格");
  await expect(added).toHaveAttribute("data-status", "label_confirmed");
  await expect(added).toHaveAttribute("data-med", "med-amlodipine");
  await expect(added).toContainText("早上吃");
  expect((await meds()).map((m) => [m.id, m.status, m.slots])).toEqual([["med-amlodipine", "label_confirmed", ["morning"]]]);
  await seen();
  await pp.getByTestId("add-open-card").click();
  await expect(pp.getByTestId("med-card")).toHaveAttribute("data-status", "label_confirmed");
  await expect(pp.getByTestId("med-slots")).toHaveAttribute("data-source", "label");
  await expect(pp.getByTestId("card-how-to-take")).toContainText("Take ONE tablet every MORNING");
  await seen();

  // =================================================================== 3. the 08:45 reminder, 吃了
  const doseHeadline = pp.getByTestId("dose-headline");
  const doseDone = pp.getByTestId("dose-done");
  await clock(D1, "08:40");
  await pp.goto("/p/today");
  await kit.step(pp, "8:40 的今天页：早上的药 8:45 提醒他");
  await expect(doseHeadline).toHaveAttribute("data-why", "coming");
  await expect(doseHeadline).toHaveText("早上的药，8:45 提醒你。");
  await expect(pp.getByTestId("dose-med-med-amlodipine")).toContainText("Amlodipine 5 mg");
  expect(await doseRows()).toEqual([]);
  await seen();

  await kit.step(pp, "8:45 定时任务跑一遍，今天页写着还没记");
  await clock(D1, "08:45");
  // he confirmed the medicine at 07:50, before this window opened: the reminder is his
  expect((await tickDoses(request)).first).toBeGreaterThanOrEqual(1);
  expect((await tickDoses(request)).first).toBe(0);
  const reminders = async () => (await getJson<{ recent: { kind: string; slot: string; date: string; sent_at: string }[] }>(elder.context, "/api/push")).recent.filter((r) => r.kind.startsWith("dose_"));
  expect((await reminders()).map((r) => [r.kind, r.slot, r.date, r.sent_at])).toEqual([["dose_first", "morning", D1, utcOf(D1, "08:45")]]);
  await pp.goto("/p/today?remind=dose-morning");
  await expect(doseHeadline).toHaveAttribute("data-why", "remind");
  await expect(doseHeadline).toHaveText("早上的药，还没记。");
  await seen();

  await kit.step(pp, "8:52 他点「吃了」，记下的时间就是 8:52");
  await clock(D1, "08:52");
  await pp.getByTestId("dose-taken").click();
  await expect(doseDone).toHaveAttribute("data-kind", "taken");
  await expect(doseDone).toContainText("记好了。");
  await expect(doseDone).toContainText("早上 8:52 吃的。");
  ledger.push({ date: D1, med: "med-amlodipine", slot: "morning", mark: "taken" });
  await expect.poll(async () => (await doseRows()).map((r) => `${r.medication_id} ${r.slot} ${r.state}@${r.created_at}`)).toEqual([`med-amlodipine morning taken@${utcOf(D1, "08:52")}`]);
  await seen();

  // =================================================================== 4. a reading, an ask, a question
  await clock(D1, "09:00");
  await pp.goto("/p/bp");
  const keypad = pp.locator('[data-rp="bp-keypad"]');
  const keyIn = async (digits: string) => {
    for (const d of digits) await keypad.locator(".rpu-key", { hasText: new RegExp(`^${d}$`) }).click();
  };
  const saved = pp.getByTestId("bp-saved");
  await kit.step(pp, "9:00 量血压：照血压计输 142 和 88，点记下");
  await expect(pp.getByTestId("page-bp")).toHaveAttribute("data-scope", "account");
  // the blood pressure page opens on the week (the timeline draft's 03-3a); 「记一次血压」 brings the keypad
  await pp.getByTestId("bp-record-open").click();
  await keyIn("14288");
  await pp.getByTestId("bp-save").click();
  await expect(saved).toHaveAttribute("data-reading", "142/88");
  await expect(saved).toContainText("记下了：142/88");
  await expect(saved).toContainText("早上 9:00");
  // no doctor has given him a number yet: nothing is compared, nothing is said about the reading
  await expect(pp.getByTestId("threshold-relay")).toHaveCount(0);
  const readings = async () =>
    (await getJson<{ readings: { day: number; slot: string; systolic: number | null; diastolic: number | null; state: string }[] }>(elder.context, "/api/bp")).readings.map((r) => `${[D1, D2, D3, D4][r.day]} ${r.slot} ${r.systolic}/${r.diastolic} ${r.state}`);
  await expect.poll(readings).toEqual([`${D1} morning 142/88 recorded`]);
  await seen();

  await clock(D1, "09:05");
  await pp.goto("/p/ask");
  await kit.step(pp, "他问一句：早上忘了吃，现在补吃可以吗");
  await expect(pp.getByTestId("ask-section")).toHaveAttribute("data-mode", "screen");
  await kit.type(pp.getByTestId("ask-input"), ASK);
  const answered = pp.waitForResponse((r) => r.url().includes("/api/ask") && r.request().method() === "POST");
  await pp.getByTestId("ask-field").getByRole("button", { name: "问这句" }).click();
  const askRes = await answered;
  expect(askRes.status()).toBe(200);
  const turn = pp.locator('[data-testid="ask-turn"][data-latest="true"]');
  await expect(turn.getByRole("heading", { level: 1 })).toHaveText(ASK);

  await kit.step(pp, "回答只引药品单张里漏吃的原文，不替医生改药");
  if (REAL_MODEL) {
    // a real model picks among the candidate sentences itself: whichever it picks, every line shown is a source's own
    // words (it carries its source), and nothing was answered at a visit yet
    const lines = turn.getByTestId("answer-line");
    await expect(lines.first()).toBeVisible();
    for (const source of await lines.evaluateAll((els) => els.map((el) => el.getAttribute("data-source") ?? ""))) expect(source, "an answer line without a source").not.toBe("");
    expect((await questions()).counts).toMatchObject({ answered: 0 });
  } else {
    const leaflet = turn.locator('[data-testid="answer-line"][data-source="hh-amlodipine:amlodipine.missed"]');
    await expect(leaflet).toContainText("不要为了补漏掉的那次而加倍");
    await expect(turn).not.toContainText("改药的问题要问医生");
    await expect(turn.getByTestId("ask-question-added")).toHaveCount(0);
    await kit.show(leaflet);
    expect((await questions()).counts).toMatchObject({ open: 0, answered: 0 });
  }
  await seen();

  await clock(D1, "09:10");
  await pp.goto("/p/questions");
  await kit.step(pp, "问题单上点「加一个问题」，写下想问医生的话");
  await seen();
  await pp.getByTestId("questions-add").click();
  await pp.waitForURL("**/p/questions/add");
  await kit.type(pp.getByTestId("question-text-input"), QUESTION);
  await expect(pp.locator('[data-who="doctor"]')).toHaveAttribute("aria-pressed", "true");
  await seen();

  await kit.step(pp, "点「加上」：这个问题进了下次看诊要问的单子");
  await pp.getByTestId("question-submit").click();
  await expect(pp.locator('[data-rp="questions-notice"]')).toHaveText("加上了。");
  const myRow = pp.locator('[data-rp="questions-open"] [data-question]', { hasText: QUESTION }).first();
  await expect(myRow).toContainText("刚加上的");
  const afterAdd = await questions();
  const ownQuestions = afterAdd.open.filter((q) => q.origin === "own");
  expect(ownQuestions.map((q) => [q.text, q.for, q.origin, q.status])).toEqual([[QUESTION, "doctor", "own", "open"]]);
  // (a real model's answer to the ask above may have put a question of its own kind on the list; the stub's does not)
  if (!REAL_MODEL) expect(afterAdd.open).toHaveLength(1);
  const questionId = ownQuestions[0].id;
  await seen();

  // =================================================================== 5. inviting Wei Ling
  await clock(D1, "09:20");
  await pp.goto("/p/family");
  await kit.step(pp, "他在「家人」页邀请女儿 Wei Ling，做一个链接");
  await expect(pp.getByTestId("page-family")).toHaveAttribute("data-state", "none");
  await pp.getByTestId("family-invite").click();
  await expect(pp.getByTestId("invite-form")).toBeVisible();
  await kit.type(pp.getByTestId("invite-name"), "Wei Ling");
  await expect(pp.locator('[data-testid="invite-relation"] [data-choice="daughter"]')).toHaveAttribute("aria-checked", "true");
  await pp.getByTestId("invite-make").click();
  const made = pp.getByTestId("invite-made");
  await expect(made).toBeVisible();
  const inviteUrl = (await made.getAttribute("data-url"))!;
  const linkId = (await made.getAttribute("data-link"))!;
  expect(inviteUrl).toMatch(/\/invite\/[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
  await expect(made).toContainText("7 天内有效，只能用一次");
  await seen();

  await kit.step(dp, "Wei Ling 在自己手机上打开链接，点「接受」");
  await dp.goto(new URL(inviteUrl).pathname);
  await expect(dp.getByTestId("invite-page")).toHaveAttribute("data-state", "open");
  await expect(dp.getByTestId("family-headline")).toHaveText("爸爸邀请你看他的 Ripple");
  await expect(dp.getByTestId("invite-sees").locator("li")).toHaveCount(6);
  await seen(dp);
  await dp.getByTestId("invite-accept").click();
  await expect(dp.getByTestId("her-signup")).toBeVisible();

  await kit.step(dp, "她建自己的账号：名字、账号、密码，同意条款");
  await kit.type(dp.getByTestId("her-name"), "Wei Ling");
  await kit.type(dp.getByTestId("her-login"), herLogin);
  await kit.type(dp.getByTestId("her-password"), HER_PASSWORD);
  await dp.getByTestId("her-agree").check();
  await seen(dp);
  await dp.getByTestId("her-signup-submit").click();
  await expect(dp.getByTestId("her-code-value")).toHaveText(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  accounts.push({ context: daughter.context, password: HER_PASSWORD });
  watch.addId("her user id", await userIdOf(daughter.context));
  // her account is only for looking: no space of her own, her two consents, the invitation not yet accepted
  const hers = await me(daughter.context);
  expect(hers.body).toMatchObject({ account: { login: herLogin, display_name: "Wei Ling", login_kind: "username" }, scope: null });

  await kit.step(dp, "恢复码抄好，她接受了邀请，等爸爸确认");
  await seen(dp);
  await dp.getByTestId("her-code-done").click();
  await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "waiting");
  await expect(dp.getByTestId("family-headline")).toHaveText("已经告诉爸爸了，等他在手机上确认是你。");
  const herHome = async (): Promise<{ status: number; text: string; body: HerHome }> => {
    const res = await daughter.context.request.get(`/api/family/view?link=${encodeURIComponent(linkId)}`);
    const text = await res.text();
    return { status: res.status(), text, body: (res.status() === 200 ? JSON.parse(text) : {}) as HerHome };
  };
  // he has not confirmed her: she sees nothing of his
  const before = await daughter.context.request.get(`/api/family/view?link=${encodeURIComponent(linkId)}`);
  expect(before.status()).toBe(403);
  expect(await before.json()).toEqual({ error: "link_not_active" });
  await seen(dp);

  await kit.step(pp, "陈先生看到她的名字和账号，点「是她」");
  await pp.getByTestId("invite-back").click();
  await expect(pp.getByTestId("page-family")).toHaveAttribute("data-state", "confirm");
  await expect(pp.locator("body")).toContainText("Wei Ling 接受了邀请，是她吗？");
  await expect(pp.locator("body")).toContainText(herLogin);
  await seen();
  await pp.getByTestId("confirm-yes").click();
  await expect(pp.getByTestId("page-family-link")).toHaveAttribute("data-state", "active");
  const switches = pp.getByTestId("link-switches").locator('[role="switch"]');
  await expect(switches).toHaveCount(6);
  for (let i = 0; i < 6; i++) await expect(switches.nth(i)).toHaveAttribute("aria-checked", "false");
  await seen();

  await kit.step(dp, "她第一次进来：存爸爸的电话，通知以后再说");
  await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "welcome-1", { timeout: 20_000 });
  await kit.type(dp.getByTestId("phone-input"), "+65 0000 0000");
  await dp.getByTestId("phone-save").click();
  await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "welcome-2");
  await seen(dp);
  await dp.getByTestId("push-later").click();
  await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "welcome-3");
  await dp.getByTestId("welcome-done").click();

  await kit.step(dp, "六个开关都关着：她的首页什么都没有");
  await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "nothing_shared");
  await expect(dp.getByTestId("family-headline")).toHaveText("爸爸还没有打开任何一项。");
  await expect(dp.getByTestId("week-strip")).toHaveCount(0);
  const nothing = await herHome();
  expect(nothing.status).toBe(200);
  expect(Object.values(nothing.body.grants)).toEqual([false, false, false, false, false, false]);
  await seen(dp);

  await kit.step(pp, "他只打开「每天吃药了没有」这一项");
  const doseSwitch = pp.locator('[data-grant="dose_summary"] [role="switch"]');
  await doseSwitch.click();
  await expect(doseSwitch).toHaveAttribute("aria-checked", "true");
  await expect(pp.getByTestId("link-switches").locator('[role="switch"][aria-checked="true"]')).toHaveCount(1);
  await seen();

  await kit.step(dp, "她只看到吃药情况：今天早上的药 8:52 吃了");
  await expect(dp.getByTestId("week-strip")).toBeVisible({ timeout: 10_000 });
  await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "taken");
  await expect(dp.getByTestId("family-headline")).toHaveText("爸爸 8:52 吃了早上的药。");
  const shared = await herHome();
  expect(shared.status).toBe(200);
  expect(shared.body.grants).toEqual({ dose_summary: true, bp_summary: false, questions_count: false, no_reply_alert: false, visit_transcripts: false, notes: false });
  expect(shared.body).toMatchObject({ bp: null, questions: null, noReply: null, visitsShared: false, notesShared: false, status: { state: "taken" } });
  expect(shared.body.week!.days.find((d) => d.date === D1)!.slots.map((s) => [s.slot, s.cells.map((c) => `${c.name} ${c.mark}`)])).toEqual([["morning", ["Amlodipine taken"]]]);
  // nothing else of his is in what her phone was sent: no reading, no question, no reason
  expect(shared.text).not.toMatch(/systolic|diastolic|142|"reason"|reason_text/);
  expect(shared.text).not.toContain(QUESTION);
  await kit.show(dp.getByTestId("week-strip"));
  await seen(dp);

  // steps 6 and 7 need a recording: they are walked with the stand-ins on (JOURNEY_SPEECH, see _g/mode.ts)
  const visitAndNewMedicine = async () => {
    // =================================================================== 6. the visit
    await clock(D1, "10:00");
    await pp.goto("/p/visit");
    await kit.step(pp, "10:00 到诊所看 Dr Lim：看诊页上点「开始」");
    await expect(pp.getByTestId("visit-empty")).toContainText("还没有看诊");
    await seen();
    await pp.getByTestId("visit-start").click();

    await kit.step(pp, "选「诊所看医生」，这次不先看简报，直接开始");
    await expect(pp.getByTestId("visit-where")).toBeVisible();
    await pp.getByTestId("visit-clinic").click();
    await expect(pp.getByTestId("visit-before")).toBeVisible();
    await seen();
    await pp.getByTestId("visit-direct").click();

    await kit.step(pp, "英文卡给医生看，医生同意了，开始录音");
    await expect(pp.getByTestId("visit-consent")).toBeVisible();
    await seen();
    await pp.getByTestId("consent-start").click();
    const live = pp.getByTestId("visit-live");
    await expect(live).toHaveAttribute("data-mode", "record");
    const visitId = (await live.getAttribute("data-visit"))!;
    const visitView = async (): Promise<VisitView> => (await getJson<{ view: VisitView }>(elder.context, `/api/visits/${visitId}`)).view;
    // the doctor's yes is kept as a consent record of this moment (his own tap, nobody helping)
    const consents = (await me(elder.context)).body.consents as { kind: string; decision: string; assisted: boolean; at: string }[];
    expect(consents.filter((c) => c.kind === "visit_recording").map((c) => [c.decision, c.assisted, c.at])).toEqual([["granted", false, utcOf(D1, "10:00")]]);

    await kit.step(pp, "转写服务没有回应：没有字幕，录音照常在录");
    await expect(pp.getByTestId("visit-notice")).toContainText("转写服务现在没有回应", { timeout: 20_000 });
    await expect(pp.getByTestId("visit-captions")).toHaveCount(0);
    await pp.waitForTimeout(4000);
    expect((await visitView()).visit.status).toBe("recording");
    await seen();

    await kit.step(pp, "他点「录完了」：录音存好，等转写服务回来");
    await clock(D1, "10:10");
    await pp.getByTestId("visit-stop").click();
    await pp.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 90_000 });
    const waiting = pp.getByTestId("review-awaiting");
    await expect(waiting).toBeVisible();
    await expect(waiting).toHaveAttribute("data-transcript", "waiting");
    await expect(waiting).toContainText("录音已存，还没有文字。");
    await expect(waiting).toContainText(/录音（\d+ 分 \d+ 秒）已经存好。转写接上以后会出文字，到时候通知你。/);
    const kept = await visitView();
    expect(kept.visit.status).toBe("awaiting_transcript");
    expect(kept.visit.audioPath).toBeTruthy();
    expect(kept.visit.place).toBe(CLINIC);
    expect(kept.lines).toEqual([]);
    expect(fake.files).toBe(0);
    await seen();

    await kit.step(pp, "今天页也写着：录音已存，等转写");
    await pp.goto("/p/today");
    await expect(pp.getByTestId("today-visit-waiting")).toContainText("录音已存，等转写");
    await kit.show(pp.getByTestId("today-visit-waiting"));
    await seen();

    await kit.step(pp, "转写服务回来了（替身），定时任务把录音送去");
    await clock(D1, "10:20");
    await fake.start();
    await expect
      .poll(
        async () => {
          await tick(request, ["asr.pending"]);
          return (await visitView()).visit.status;
        },
        { timeout: 60_000, intervals: [400] },
      )
      .toBe("review");
    // sent once, and a later pass sends nothing more
    await tick(request, ["asr.pending"]);
    expect(fake.files).toBe(1);
    const record = await visitView();
    expect(record.lines.map((l) => [l.tStartMs, l.text])).toEqual(TRANSCRIPT.map((l) => [l.start_ms, l.text]));
    // a Whisper transcript has no speakers: each line's speaker is the app's guess from the line's own words, never confirmed yet
    expect(record.lines.every((l) => l.roleState !== "confirmed")).toBe(true);
    await pp.goto(`/p/visit/${visitId}/review`);
    await expect(pp.getByTestId("review-queue")).toBeVisible();
    await seen();

    // one line at a time (_g/review.ts): with the stub model exactly these five, in the recording's order; a real model
    // may add lines of its own, and each of these five must still come up
    // the question is the one he added himself (step 4): his own words, so the card writes 「你问：」
    const QUEUE = [PRESCRIBED, FOLLOW_UP, TARGET, { ...ANSWER, asked: QUESTION, own: true }, WARNING];
    const reviewCaptions = [
      "文字出来了，一次认一句：医生加开 Losartan",
      "两周后验血、六周后回来复诊：是，医生说的",
      "在家的目标是低于 135/85：是，医生说的",
      "他加的那个问题，医生当场回答了，他点「是」",
      "超过 180 或胸痛就打 995：是，医生说的",
    ];
    await sayYes(pp, QUEUE, { beforeYes: (_l, i) => kit.step(pp, reviewCaptions[i]), afterEach: seen });
    const summary = pp.getByTestId("review-summary");
    await expect(summary).toBeVisible();
    if (!REAL_MODEL) {
      await expect(summary.getByTestId("review-row")).toHaveCount(5);
      await expect(summary.locator('[data-testid="review-row"][data-verdict="right"]')).toHaveCount(5);
    }
    for (const l of QUEUE) await expect(summary.locator('[data-testid="review-row"][data-verdict="right"]', { hasText: l.text })).toHaveCount(1);

    // C2 track F, fix round (lib/visit/roles.ts turnsWithoutSpeakers): a transcript without speakers is now read by the
    // order and form of its lines, so the three lines that used to be nobody's are guessed (the doctor's question, his
    // reply 「Hmm, don't think so.」, the doctor's 「Anything else you want to ask?」) and there is no 「哪几句是你说的」
    // section for this transcript; his reply becomes his confirmed line when he saves (asserted after the save below).
    // NOT RUN since that change (the owner's budget notice stopped further runs): the integrator's first run checks it.
    await kit.step(pp, "他自己说的那句，Ripple 按前后顺序猜出来是他说的");
    await expect(pp.getByTestId("review-mine")).toHaveCount(0);
    expect((await visitView()).lines.find((l) => l.text === HIS_OWN_LINE.text)).toMatchObject({ role: "patient", roleState: "inferred" });
    await seen();

    await kit.step(pp, "点「就这样，存好」：记录确认，复诊排在六周后");
    await kit.show(pp.getByTestId("review-save"));
    await pp.getByTestId("review-save").click();
    await expect(summary).toHaveAttribute("data-status", "confirmed");
    const followUp = pp.getByTestId("review-follow-up");
    await expect(followUp).toHaveAttribute("data-date", addDays(D1, 42));
    await expect(followUp).toContainText(`大约 ${zhDay(addDays(D1, 42))}`);
    const confirmed = await visitView();
    expect(confirmed.visit.status).toBe("confirmed");
    const lineOf = (l: FakeLine) => confirmed.lines.find((x) => x.text === l.text);
    for (const l of [PRESCRIBED, FOLLOW_UP, TARGET, ANSWER, WARNING]) expect(lineOf(l), l.text).toMatchObject({ role: "doctor", roleState: "confirmed" });
    for (const l of [HIS_ASK, HIS_OWN_LINE]) expect(lineOf(l), l.text).toMatchObject({ role: "patient", roleState: "confirmed" });
    const rowsOf = (l: FakeLine) => confirmed.cards.flatMap((c) => (c.kind === "doc" && c.quote === l.text ? c.rows : [])).map((r) => [r.variant, r.drug ?? null, r.verdict]);
    // what each line holds: exactly these rows with the stub model (the rules); a real model may add rows of its own
    const holds = (l: FakeLine, rows: (string | null)[][]) => (REAL_MODEL ? expect(rowsOf(l), l.text).toEqual(expect.arrayContaining(rows)) : expect(rowsOf(l), l.text).toEqual(rows));
    holds(PRESCRIBED, [
      ["med", "amlodipine", "right"],
      ["new_med", "losartan", "right"],
    ]);
    holds(FOLLOW_UP, [
      ["follow_up", null, "right"],
      ["test", null, "right"],
    ]);
    holds(TARGET, [["target", null, "right"]]);
    holds(WARNING, [
      ["threshold", null, "right"],
      ["how_to_measure", null, "right"],
    ]);
    // his question is answered, in the doctor's own words; the one Ripple noticed (a blood test was ordered) waits for next time
    const afterVisit = await questions();
    expect(afterVisit.answered.filter((q) => q.id === questionId).map((q) => [q.id, q.text, q.answer?.text, q.answer?.speaker, q.answer?.date, q.answer?.tStartMs, q.answer?.inferred])).toEqual([
      [questionId, QUESTION, ANSWER.text, "doctor", D1, ANSWER.start_ms, false],
    ]);
    expect(afterVisit.open.map((q) => [q.text, q.for, q.origin])).toContainEqual([RIPPLE_TEST_QUESTION, "doctor", "before_you_go"]);
    if (!REAL_MODEL) {
      expect(afterVisit.answered).toHaveLength(1);
      expect(afterVisit.open).toHaveLength(1);
    }
    await seen();

    // =================================================================== 7. the new medicine's label
    await clock(D1, "10:45");
    await kit.step(pp, "「我的药」多了一行 Losartan，等药袋确认");
    await pp.getByTestId("review-to-meds").click();
    await pp.waitForURL(/\/p\/meds$/);
    const losartanRow = pp.getByTestId("med-row-med-losartan");
    await expect(losartanRow).toHaveAttribute("data-status", "awaiting_label");
    await expect(losartanRow).toContainText("等药袋确认");
    await expect(pp.getByTestId("med-row-med-amlodipine")).toHaveAttribute("data-status", "label_confirmed");
    await expect(pp.locator('[data-testid^="med-row-"]')).toHaveCount(2);
    expect((await meds()).map((m) => [m.id, m.status, m.slots]).sort()).toEqual([
      ["med-amlodipine", "label_confirmed", ["morning"]],
      ["med-losartan", "awaiting_label", []],
    ]);
    await kit.show(losartanRow);
    await seen();

    await kit.step(pp, "他点「拍 Losartan 的药袋」，用相机拍下来");
    await pp.getByTestId("meds-photo-awaiting").click();
    await expect(pp.getByTestId("add-photo")).toBeVisible();
    await expect(pp.getByTestId("add-photo")).toContainText("拍 Losartan 的药袋");
    await seen();
    await pp.getByTestId("add-file").setInputFiles(path.join(LABELS, "losartan.png"));
    await expect(check).toBeVisible({ timeout: 30_000 });
    if (!REAL_MODEL) await expect(check).toHaveAttribute("data-total", "5");

    await kit.step(pp, "逐行对过：Losartan 确认了，也是早上吃");
    await confirmLabel([
      ["drug_text", "LOSARTAN 50MG TABLET"],
      ["strength", "50 mg"],
      ["directions", "Take ONE tablet every MORNING"],
      ["dispensed", "10月5日"],
      ["clinic", CLINIC],
    ]);
    await expect(added).toBeVisible({ timeout: 30_000 });
    await expect(added).toHaveAttribute("data-status", "label_confirmed");
    await expect(added).toHaveAttribute("data-med", "med-losartan");
    await expect(added).toContainText("早上吃");
    expect((await meds()).map((m) => [m.id, m.status, m.slots]).sort()).toEqual([
      ["med-amlodipine", "label_confirmed", ["morning"]],
      ["med-losartan", "label_confirmed", ["morning"]],
    ]);
    await pp.goto("/p/meds");
    await expect(losartanRow).toHaveAttribute("data-status", "label_confirmed");
    await expect(pp.locator('[data-testid^="med-row-"]')).toHaveCount(2);
    // confirmed at 10:45, after this morning's window opened: today's morning is not his for Losartan, it starts tomorrow
    expect(rowsAsCells(await doseRows())).toEqual(asRows(ledger));
    await seen();
  };
  if (STANDIN_SPEECH) await visitAndNewMedicine();

  // =================================================================== 8. three days on
  const takeMorning = async (date: string) => {
    await clock(date, "08:45");
    expect((await tickDoses(request)).first).toBeGreaterThanOrEqual(1);
    await pp.goto("/p/today?remind=dose-morning");
    await expect(doseHeadline).toHaveText("早上的药，还没记。");
    await expect(pp.getByTestId("dose-med-med-amlodipine")).toContainText("Amlodipine 5 mg");
    if (MORNING_MEDS.includes("med-losartan")) await expect(pp.getByTestId("dose-med-med-losartan")).toContainText("Losartan 50 mg");
    else await expect(pp.getByTestId("dose-med-med-losartan")).toHaveCount(0);
    await clock(date, "08:50");
    if (MORNING_MEDS.length > 1) {
      // two medicines in the slot: each is answered by itself (the timeline draft's 02-7), then the slot is one entry
      for (const med of MORNING_MEDS) {
        await pp.getByTestId(`dose-taken-${med}`).click();
        await expect(pp.getByTestId(`dose-taken-${med}`)).toHaveCount(0);
      }
      await expect(pp.getByTestId("dose-row-morning")).toHaveAttribute("data-state", "taken");
      await expect(pp.getByTestId("dose-row-morning")).toContainText("早上 · 8:50 记的");
    } else {
      await pp.getByTestId("dose-taken").click();
      await expect(doseDone).toHaveAttribute("data-kind", "taken");
      await expect(doseDone).toContainText("早上 8:50 吃的。");
    }
    for (const med of MORNING_MEDS) ledger.push({ date, med, slot: "morning", mark: "taken" });
    await expect.poll(async () => rowsAsCells(await doseRows())).toEqual(asRows(ledger));
  };

  await kit.step(pp, STANDIN_SPEECH ? "第二天 8:45 提醒：两种药各自记，他两个都点「吃了」" : "第二天 8:45 提醒来了，他点「吃了」");
  await takeMorning(D2);
  await seen();

  await clock(D2, "08:58");
  await pp.goto("/p/bp");
  await kit.step(pp, "这天他再量一次血压：138/84");
  if (STANDIN_SPEECH) {
    await expect(pp.getByTestId("bp-target")).toContainText(TARGET.text);
    await expect(pp.getByTestId("bp-target")).toHaveAttribute("data-state", "confirmed");
    // its time point in the recording, the same figure as in the review (whole seconds, cut)
    await expect(pp.getByTestId("bp-target")).toContainText(`${zhDay(D1)} · ${clipAt(TARGET.start_ms)}`);
  } else {
    // no visit, so no doctor has given him a number: nothing to put next to the reading
    await expect(pp.getByTestId("bp-target")).toHaveCount(0);
  }
  await pp.getByTestId("bp-record-open").click();
  await keyIn("13884");
  await pp.getByTestId("bp-save").click();
  await expect(saved).toHaveAttribute("data-reading", "138/84");
  await expect.poll(readings).toEqual([`${D1} morning 142/88 recorded`, `${D2} morning 138/84 recorded`]);
  await seen();
  // the window closes with every cell answered: nothing is settled for him
  await clock(D2, "09:46");
  await tickDoses(request);
  expect(rowsAsCells(await doseRows())).toEqual(asRows(ledger));

  await kit.step(pp, "第三天两次提醒都来了，他都没有回");
  await clock(D3, "08:45");
  expect((await tickDoses(request)).first).toBeGreaterThanOrEqual(1);
  await pp.goto("/p/today?remind=dose-morning");
  await expect(doseHeadline).toHaveText("早上的药，还没记。");
  await clock(D3, "09:15");
  expect((await tickDoses(request)).second).toBeGreaterThanOrEqual(1);
  expect((await reminders()).filter((r) => r.date === D3).map((r) => [r.kind, r.sent_at]).sort()).toEqual([
    ["dose_first", utcOf(D3, "08:45")],
    ["dose_second", utcOf(D3, "09:15")],
  ]);
  await seen();

  await kit.step(pp, STANDIN_SPEECH ? "9:45 关窗：服务端把两种药都记成「没回」" : "9:45 关窗：服务端把这一格记成「没回」");
  await clock(D3, "09:46");
  // the job settles them (no page of his was read since the window closed)
  expect((await tickDoses(request)).settled).toBeGreaterThanOrEqual(MORNING_MEDS.length);
  for (const med of MORNING_MEDS) ledger.push({ date: D3, med, slot: "morning", mark: "no_reply" });
  expect(rowsAsCells(await doseRows())).toEqual(asRows(ledger));
  expect((await tickDoses(request)).settled).toBe(0);
  await pp.goto("/p/today");
  await expect(doseHeadline).toHaveAttribute("data-why", "closed");
  await expect(doseHeadline).toHaveText("早上的药，到 9:45 还没记。");
  await seen();

  await kit.step(dp, "女儿只开了吃药情况：这天她没有收到通知");
  await dp.goto(`/f?link=${encodeURIComponent(linkId)}`);
  await expect(dp.getByTestId("family-app")).toHaveAttribute("data-live", "open");
  // the no-reply switch is off: no alert block, no alert in what her phone was sent, and no alert row was written
  await expect(dp.getByTestId("home-no-reply")).toHaveCount(0);
  const day3 = await herHome();
  expect(day3.body.grants.no_reply_alert).toBe(false);
  expect(day3.body.noReply).toBeNull();
  // her week (Monday to Sunday) holds the days of his so far that fall in it: each one exactly as the ledger has it
  const herDays = day3.body.week!.days.filter((d) => d.date <= D3 && ledger.some((c) => c.date === d.date));
  expect(herDays.map((d) => d.date)).toContain(D3);
  expect(herDays.map((d) => [d.date, d.mark, d.slots.flatMap((s) => s.cells.map((c) => `${c.name} ${c.mark}`))])).toEqual(
    herDays.map((d) => {
      const cells = ledger.filter((c) => c.date === d.date);
      return [d.date, cells.some((c) => c.mark === "no_reply") ? "no_reply" : "taken", cells.map((c) => `${MED_NAME[c.med]} ${c.mark}`)];
    }),
  );
  expect(herDays.find((d) => d.date === D3)).toMatchObject({ mark: "no_reply" });
  await kit.show(dp.getByTestId("week-strip"));
  await seen(dp);

  await kit.step(pp, "第四天 8:50 他照常点「吃了」");
  await takeMorning(D4);
  await seen();

  // =================================================================== 9. the brief
  // what the brief must count, from the script's own ledger: the days after the visit (day 2 to day 4). Without the
  // visit (JOURNEY_SPEECH=none) no clinic visit has happened, and the brief counts from the day he started (day 1)
  const BRIEF_FROM = STANDIN_SPEECH ? D2 : D1;
  const inBrief = ledger.filter((c) => c.date >= BRIEF_FROM && c.date <= D4);
  const expectDoses = {
    due: inBrief.length,
    taken: inBrief.filter((c) => c.mark === "taken").length,
    missed: 0,
    unconfirmed: inBrief.filter((c) => c.mark === "no_reply").length,
  };
  const expectDays = [D1, D2, D3, D4]
    .filter((date) => date >= BRIEF_FROM)
    .map((date) => {
      const cells = inBrief.filter((c) => c.date === date);
      return { date, due: cells.length, taken: cells.filter((c) => c.mark === "taken").length, missed: 0, unconfirmed: cells.filter((c) => c.mark === "no_reply").length };
    });
  expect(expectDoses).toEqual(STANDIN_SPEECH ? { due: 6, taken: 4, missed: 0, unconfirmed: 2 } : { due: 4, taken: 3, missed: 0, unconfirmed: 1 });

  await clock(D4, "10:00");
  await pp.goto("/p/brief");
  await kit.step(pp, STANDIN_SPEECH ? "打开简报：从看诊第二天算起，写的是真实日期" : "打开简报：还没看过诊，从开始用那天算起");
  const briefPage = pp.getByTestId("page-brief");
  await expect(briefPage).toHaveAttribute("data-scope", "account");
  await expect(briefPage).toHaveAttribute("data-from", BRIEF_FROM);
  await expect(briefPage).toHaveAttribute("data-to", D4);
  await expect(pp.getByTestId("brief-window")).toHaveText(STANDIN_SPEECH ? `上次看诊（${zhDay(D1)}）之后：${zhDay(D2)}到${zhDay(D4)}` : `到目前为止：${zhDay(D1)}到${zhDay(D4)}`);
  await expect(briefPage).not.toContainText(/第 ?\d+ ?天|Day ?\d+/);
  await seen();

  const briefBp = pp.getByTestId("brief-bp");
  const briefTarget = pp.getByTestId("brief-target");
  if (STANDIN_SPEECH) {
    await kit.step(pp, "这次读数 138/84 旁边，是医生说的目标原话");
    await expect(briefBp).toHaveAttribute("data-count", "1");
    await expect(briefBp).toHaveAttribute("data-avg", "138/84");
    await expect(briefBp).toHaveAttribute("data-not-below", "1");
    await expect(briefBp).toContainText("138/84");
    await expect(briefTarget).toHaveAttribute("data-state", "confirmed");
    await expect(briefTarget).toContainText(`“${TARGET.text}”`);
    await expect(briefTarget).toContainText("医生说");
    // the visit's real date and the line's time point in the recording, the same figure the review and the question
    // list show for it (one rule everywhere since track B's fix round: whole seconds, cut; it used to round here)
    await expect(briefTarget).toContainText(`${D1.slice(0, 4)}年${zhDay(D1)} · ${clipAt(TARGET.start_ms)}`);
    await kit.show(briefTarget);
  } else {
    await kit.step(pp, "两次读数和平均数：没有医生说过的数，就不比");
    await expect(briefBp).toHaveAttribute("data-count", "2");
    await expect(briefBp).toHaveAttribute("data-avg", "140/86");
    await expect(briefBp).toHaveAttribute("data-not-below", "");
    await expect(briefBp).toContainText("记了 2 次，平均 140/86");
    await expect(briefTarget).toHaveCount(0);
    await expect(pp.getByTestId("brief-bp-mirror")).toHaveCount(0);
    await kit.show(briefBp);
  }
  await seen();

  await kit.step(pp, `吃药：${expectDoses.due} 次里吃了 ${expectDoses.taken} 次、${expectDoses.unconfirmed} 次没回，和记录一致`);
  const briefDoses = pp.getByTestId("brief-doses");
  await expect(briefDoses).toHaveAttribute("data-due", String(expectDoses.due));
  await expect(briefDoses).toHaveAttribute("data-taken", String(expectDoses.taken));
  await expect(briefDoses).toHaveAttribute("data-missed", String(expectDoses.missed));
  await expect(briefDoses).toHaveAttribute("data-unconfirmed", String(expectDoses.unconfirmed));
  await expect(briefDoses).toContainText("Amlodipine 5 mg");
  if (STANDIN_SPEECH) await expect(briefDoses).toContainText("Losartan 50 mg");
  else await expect(briefDoses).not.toContainText("Losartan");
  await kit.show(briefDoses);
  const brief = (await getJson<BriefOut>(elder.context, "/api/brief")).brief;
  expect(brief).toMatchObject({ kind: "account", date: D4, window: { fromDate: BRIEF_FROM, toDate: D4, lastVisit: STANDIN_SPEECH ? { date: D1 } : null } });
  expect({ due: brief.doses.due, taken: brief.doses.taken, missed: brief.doses.missed, unconfirmed: brief.doses.unconfirmed }).toEqual(expectDoses);
  expect(brief.doses.days.map((d) => ({ date: d.date, due: d.due, taken: d.taken, missed: d.missed, unconfirmed: d.unconfirmed }))).toEqual(expectDays);
  expect(brief.doses.meds.map((m) => m.id).sort()).toEqual(MORNING_MEDS);
  if (STANDIN_SPEECH) {
    expect(brief.bp).toMatchObject({ count: 1, avgSystolic: 138, avgDiastolic: 84, notBelow: 1 });
    expect(brief.targetLine).toMatchObject({ text: TARGET.text, state: "confirmed", systolic: 135, diastolic: 85, date: D1, tStartMs: TARGET.start_ms });
    expect(brief.nextVisit).toMatchObject({ date: addDays(D1, 42), days: 39 });
  } else {
    expect(brief.bp).toMatchObject({ count: 2, avgSystolic: 140, avgDiastolic: 86, notBelow: null });
    expect(brief.targetLine).toBeNull();
    expect(brief.nextVisit).toBeNull();
  }
  // every row of his record is what the script did, cell by cell (all four days)
  expect(rowsAsCells(await doseRows())).toEqual(asRows(ledger));
  await seen();

  const briefQuestions = pp.getByTestId("brief-questions");
  if (STANDIN_SPEECH) {
    await kit.step(pp, "要问医生的只剩 Ripple 记下的验血那一条");
    await expect(briefQuestions.locator('[data-testid="brief-question"]', { hasText: RIPPLE_TEST_QUESTION })).toHaveCount(1);
    await expect(briefQuestions).not.toContainText(QUESTION);
    expect(brief.questions.shown.map((q) => [q.text, q.origin])).toContainEqual([RIPPLE_TEST_QUESTION, "before_you_go"]);
    if (!REAL_MODEL) {
      await expect(briefQuestions).toHaveAttribute("data-count", "1");
      expect(brief.questions.shown).toHaveLength(1);
    }
  } else {
    await kit.step(pp, "要问医生的是他自己加的那一条，一字不改");
    await expect(briefQuestions.locator('[data-testid="brief-question"]', { hasText: QUESTION })).toHaveCount(1);
    expect(brief.questions.shown.map((q) => [q.text, q.origin])).toContainEqual([QUESTION, "own"]);
    if (!REAL_MODEL) await expect(briefQuestions).toHaveAttribute("data-count", "1");
  }
  await kit.show(briefQuestions);
  await seen();

  const finalList = await questions();
  if (STANDIN_SPEECH) {
    await kit.step(pp, "问题单里已回答的那条，存的是医生的原话");
    await pp.goto("/p/questions");
    await pp.locator('a[href="/p/questions/answered"]').click();
    await pp.waitForURL("**/p/questions/answered");
    const answeredRow = pp.locator(`[data-rp="question"][data-question="${questionId}"]`);
    await expect(answeredRow.locator(".rpu-q-text")).toHaveText(QUESTION);
    const answerBlock = answeredRow.locator('[data-rp="question-answer"]');
    await expect(answerBlock).toHaveAttribute("data-speaker", "doctor");
    await expect(answerBlock).toHaveAttribute("data-inferred", "false");
    await expect(answerBlock.locator('[data-rp="said"]')).toHaveText(ANSWER.text);
    await expect(answerBlock.locator('[data-rp="source-tag"]')).toContainText("医生说");
    await expect(answerBlock.locator('[data-rp="source-tag"]')).toContainText(`${zhDay(D1)} · ${clipAt(ANSWER.start_ms)}`);
    await kit.show(answerBlock);
    expect(finalList.answered.map((q) => [q.id, q.answer?.text])).toEqual([[questionId, ANSWER.text]]);
    await seen();
  } else {
    // no visit: nobody has answered anything, his question waits on the list
    expect(finalList.answered).toEqual([]);
    expect(finalList.open.map((q) => q.id)).toContain(questionId);
  }

  // ---- her phone was told nothing in these days: his record holds his own reminders and no alert for her
  const exported = await elder.context.request.post("/api/me/export", { data: {} });
  expect(exported.status(), await exported.text()).toBe(200);
  await watch.api("elder", exported, "POST");
  const tables = ((await exported.json()) as { tables: Record<string, { kind?: string; day?: number; slot?: string }[]> }).tables;
  expect(tables.reminder_deliveries.filter((r) => r.kind === "family_no_reply")).toEqual([]);
  // everything that was sent, or noted as sent, in these four days: his five reminders, 「Wei Ling 已经接受」, and (with
  // the visit) the one submission of the recording and the one 「看诊记录好了」
  expect(tables.reminder_deliveries.map((r) => `${[D1, D2, D3, D4][r.day!]} ${r.kind} ${r.slot}`).sort()).toEqual(
    [
      `${D1} dose_first morning`,
      `${D1} family_accepted accept`,
      ...(STANDIN_SPEECH ? [`${D1} transcript_try 1`, `${D1} visit_ready visit`] : []),
      `${D2} dose_first morning`,
      `${D3} dose_first morning`,
      `${D3} dose_second morning`,
      `${D4} dose_first morning`,
    ].sort(),
  );
  expect(tables.dose_log).toHaveLength(ledger.length);

  // =================================================================== 10. the leak watch over the whole walk
  // (settleWithin: the watch's own settle() waits without a limit for response bodies Playwright never delivers on this
  // walk; see _g/leak.ts)
  await settleWithin(watch);
  expect(watch.seen.pages, "the watch looked at the screens").toBeGreaterThan(STANDIN_SPEECH ? 60 : 45);
  expect(watch.seen.api, "the watch looked at the API answers").toBeGreaterThan(STANDIN_SPEECH ? 20 : 10);
  expect(watch.report()).toEqual([]);

  // ---- off screen: both accounts are deleted through the app's own route
  await deleteAccount(elder.context, HIS_PASSWORD);
  await deleteAccount(daughter.context, HER_PASSWORD);
  accounts.length = 0;
  await clearClock(request);
  await fake.stop();
  await kit.finish();
});
