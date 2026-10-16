/**
 * M2 flows (docs/plan/tasks/M2-visit.md, acceptance): sample replays through the real pipeline on Mr Tan's
 * phone (SPEECH_PROVIDER=mock, server-pushed realtime captions on the session's event stream).
 *
 *   1. v1 at real time: first caption <= 1.5 s after each sentence starts, every card <= 5 s after its sentence
 *      ends; R1 and R2 verbatim with their time; the D0 items; the question list.
 *   2. v2: R3 and R4 verbatim with time; the R4 card plays clips/v2-u08.wav, labelled 代录音 / stand-in
 *      recording; the prescription sentence shows 推断 / Inferred, never 医生说 / Doctor said.
 *   3. v3 (story on Day 42): the v3 screen (three counters, three check cards, the question list with four
 *      answers saved), text size, then End visit -> review -> confirm turns the inferred medicine line into 医生说.
 *   4. a realtime client sending what it heard every 12 s to POST /api/visits/[id]/extract over HTTP: the cards
 *      reach the phone within 5 s of each chunk, and the D0 items, R1 and R2 come out the same.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { api, BASE_URL, closeAll, createSession, openDevice, textBelow } from "./helpers";

interface Fixture {
  id: string;
  t_start_ms: number;
  t_end_ms: number;
  speaker_cluster: number | null;
  lang: string;
  text: string;
}

function fixture(visit: string): Fixture[] {
  const file = path.join(__dirname, "..", "fixtures", "visits", `${visit}.utterances.json`);
  return (JSON.parse(readFileSync(file, "utf8")) as { utterances: Fixture[] }).utterances;
}

function answers(visit: string): { id: string; expected_item: string; required_line: string | null }[] {
  const file = path.join(__dirname, "..", "fixtures", "visits", `${visit}.expected.json`);
  return (JSON.parse(readFileSync(file, "utf8")) as { answers: { id: string; expected_item: string; required_line: string | null }[] }).answers;
}

const R = {
  R1: "At home, we want it below 135 over 85.",
  R2: "If your reading at home is above 180 on top, or you get chest pain, weakness on one side, or your speech becomes slurred, go to A&E or call 995.",
  R3: "This tablet works quietly. You won't feel it, and you don't feel the high pressure either, but over the years high pressure damages the heart, the brain and the kidneys. So you take it every day, even when you feel fine.",
  R4: "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.",
};

/** next dev compiles each route on first use: run every visit route once so timed runs measure the pipeline. */
async function warmUp(request: APIRequestContext, browserPage?: Page) {
  // Day 0, the first visit's own day: the replay is the visit itself, written in place (C2: on a later day it is a
  // re-watch in a copy, e2e/m2-fallback.spec.ts and the last test here)
  const s = await createSession(request, { story_day: 0 });
  await api(request, "/api/visits", s.id, { mode: "replay", fixture: "v1" });
  await api(request, "/api/visits/v1/replay", s.id, { speed: 20 });
  await request.get(`/api/visits/v1?session=${s.id}`);
  await request.get(`/api/visits/v1/clip?u=v1-u08&session=${s.id}`);
  await api(request, "/api/asr/realtime-token", s.id, {});
  await new Promise((r) => setTimeout(r, 4500));
  const job = (await api(request, "/api/asr/jobs", s.id, { visit_id: "v1" })) as { job_id: string };
  await new Promise((r) => setTimeout(r, 400));
  await request.get(`/api/asr/jobs/${job.job_id}?session=${s.id}`);
  await api(request, "/api/visits/v1/finalize", s.id, { job_id: job.job_id });
  await request.get("/p/visit", { headers: { cookie: `rp_session=${s.id}` } });
  await request.get("/p/visit/v1/review", { headers: { cookie: `rp_session=${s.id}` } });
  if (browserPage) await browserPage.goto("/p/visit");
}

type Timings = {
  startedAt: number | null;
  speed: number;
  captions: Record<string, number>;
  cards: Record<string, number>;
};

test.describe.configure({ mode: "serial" });

test("v1 replay at real time: captions within 1.5 s, cards within 5 s, R1 and R2 verbatim with their time, the D0 items", async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  await warmUp(request);
  const s = await createSession(request, { story_day: 0 });
  const phone = await openDevice(browser, s.id, "/p/visit?replay=v1&speed=1");
  const page = phone.page;
  await expect(page.getByTestId("visit-screen")).toBeVisible();
  await expect(page.getByTestId("visit-screen")).toHaveAttribute("data-stream", "ended", { timeout: 120_000 });
  await expect(page.getByTestId("line-v1-u12")).toBeVisible();

  const tm = (await page.evaluate(() => window.__rpVisit)) as unknown as Timings;
  expect(tm.startedAt).not.toBeNull();
  expect(tm.speed).toBe(1);
  const lines = fixture("v1");
  const late: string[] = [];
  for (const u of lines) {
    const seen = tm.captions[u.id];
    expect(seen, `caption for ${u.id}`).toBeTruthy();
    const delay = seen - (tm.startedAt! + u.t_start_ms);
    if (delay > 1500) late.push(`caption ${u.id}: ${delay} ms after speech start`);
  }
  const cardIds = Object.keys(tm.cards);
  expect(cardIds.length).toBeGreaterThanOrEqual(8);
  for (const id of cardIds) {
    const anchor = /^(?:doc-|chk-|qlist-)([a-z0-9]+-u\d+)/.exec(id)![1];
    const u = lines.find((l) => l.id === anchor)!;
    const delay = tm.cards[id] - (tm.startedAt! + u.t_end_ms);
    if (delay > 5000) late.push(`card ${id}: ${delay} ms after the sentence ended`);
  }
  expect(late).toEqual([]);

  // R1 and R2: the doctor's words, verbatim, with their time in the recording
  await expect(page.getByTestId("card-v1-u08-quote")).toHaveText(`“${R.R1}”`);
  await expect(page.getByTestId("card-v1-u08-chip")).toContainText("0:49");
  await expect(page.getByTestId("card-v1-u08")).toHaveAttribute("data-required", "R1");
  await expect(page.getByTestId("card-v1-u09-quote")).toHaveText(`“${R.R2}”`);
  await expect(page.getByTestId("card-v1-u09-chip")).toContainText("0:53");
  await expect(page.getByTestId("card-v1-u09")).toHaveAttribute("data-required", "R2");
  await expect(page.getByTestId("card-v1-u08-play-label")).toHaveText("代录音");

  // the D0 table: a card for every instruction line; consent; the question list after "Come back"
  const variants: Record<string, string> = {
    "v1-u03": "reading",
    "v1-u05": "measure_home",
    "v1-u06": "how_to_measure",
    "v1-u07": "lifestyle",
    "v1-u08": "target",
    "v1-u09": "threshold",
    "v1-u10": "follow_up",
  };
  for (const [id, v] of Object.entries(variants)) await expect(page.getByTestId(`card-${id}`)).toHaveAttribute("data-variants", new RegExp(`\\b${v}\\b`));
  await expect(page.getByTestId("count-doc")).toHaveAttribute("data-count", "7");
  await expect(page.getByTestId("count-q")).toHaveAttribute("data-count", "2");
  await expect(page.getByTestId("visit-consent")).toBeVisible();
  const qlist = page.getByTestId("qlist");
  await expect(qlist).toHaveAttribute("data-anchor", "v1-u10");
  await expect(qlist.getByTestId("q-rq-v1-target")).toHaveAttribute("data-state", "done");
  await expect(qlist.getByTestId("q-rq-v1-target-answer")).toHaveText(R.R1);
  await expect(qlist.getByTestId("q-q-q-machine")).toHaveAttribute("data-state", "done");
  await expect(qlist.getByTestId("q-q-q-machine-answer")).toHaveText("手腕的不太准。买一个绑手臂的，upper arm 的。");

  // the same against the answer file, through the API: every expected line has its card / item
  const view = ((await (await request.get(`/api/visits/v1?session=${s.id}`)).json()) as { view: { lines: { id: string; text: string; tStartMs: number }[]; cards: { anchor: string }[] } }).view;
  for (const a of answers("v1")) {
    const l = view.lines.find((x) => x.id === a.id)!;
    expect(l, a.id).toBeTruthy();
    if (a.required_line) {
      const text = R[a.required_line as keyof typeof R];
      expect(l.text).toBe(text);
      expect(l.tStartMs).toBe(lines.find((f) => f.id === a.id)!.t_start_ms);
    }
  }
  expect(view.lines.find((l) => l.text === R.R1)!.tStartMs).toBe(49520);
  expect(view.lines.find((l) => l.text === R.R2)!.tStartMs).toBe(53681);
  await closeAll([phone]);
});

test("v2 replay: R3 and R4 with their time; the R4 card plays clips/v2-u08.wav as a stand-in recording; the prescription is inferred", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const s = await createSession(request, { story_day: 8 }); // the second visit's own day
  const phone = await openDevice(browser, s.id, "/p/visit?replay=v2&speed=6");
  const page = phone.page;
  await expect(page.getByTestId("card-v2-u08")).toBeVisible({ timeout: 60_000 });

  await expect(page.getByTestId("card-v2-u06-quote")).toHaveText(`“${R.R3}”`);
  await expect(page.getByTestId("card-v2-u06-chip")).toContainText("0:20");
  await expect(page.getByTestId("card-v2-u06")).toHaveAttribute("data-required", "R3");
  await expect(page.getByTestId("card-v2-u08-quote")).toHaveText(`“${R.R4}”`);
  await expect(page.getByTestId("card-v2-u08-chip")).toContainText("0:43");
  await expect(page.getByTestId("card-v2-u08")).toHaveAttribute("data-required", "R4");

  // the R4 clip: the stand-in file, labelled as such, and it plays
  const play = page.getByTestId("card-v2-u08-play");
  const url = await play.getAttribute("data-clip-url");
  expect(url).toContain("/api/visits/v2/clip?u=v2-u08");
  await expect(page.getByTestId("card-v2-u08-play-label")).toHaveText("代录音");
  const served = await request.get(url!);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("audio/wav");
  const file = readFileSync(path.join(__dirname, "..", "fixtures", "visits", "clips", "v2-u08.wav"));
  expect(Buffer.from(await served.body()).equals(file)).toBe(true);
  await play.click();
  await expect.poll(async () => page.evaluate(() => (window.__rpClipPlays ?? []).map((p) => p.url)), { timeout: 10_000 }).toContain(url!);

  // the prescription line: inferred, "to confirm", never "Doctor said"
  const med = page.getByTestId("card-v2-u05");
  await expect(med).toHaveAttribute("data-medication", "true");
  await expect(med).toHaveAttribute("data-display", "inferred");
  await expect(page.getByTestId("card-v2-u05-tag")).toContainText("待确认");
  await expect(page.getByTestId("card-v2-u05-chip")).toContainText("推断");
  await expect(med).not.toContainText("医生说");
  await expect(med).not.toContainText("医生交代");
  await expect(page.getByTestId("who-v2-u05")).toContainText("推断");
  for (const id of ["v2-u06", "v2-u08"]) await expect(page.getByTestId(`card-${id}`)).not.toContainText("医生说");
  // the side effect of the new tablet ("... with this one. If you notice it, tell me.") is about that medicine too
  await expect(page.getByTestId("card-v2-u07-tag")).toContainText("待确认");
  // "Come back in five weeks": the app's own arithmetic, so only an approximate date
  await expect(page.getByTestId("card-v2-u09-due-follow_up")).toHaveText("大约 10月6日");
  // the counter names what it counts: doctor's notes, and the cards still to confirm (counted once the replay is over)
  await expect(page.getByTestId("visit-screen")).toHaveAttribute("data-stream", "ended", { timeout: 60_000 });
  await expect(page.getByTestId("line-v2-u17")).toBeAttached();
  const toConfirm = await page.locator('[data-kind="doc"][data-display="inferred"][data-medication="true"]').count();
  expect(toConfirm).toBeGreaterThanOrEqual(5);
  await expect(page.getByTestId("count-to-confirm")).toHaveAttribute("data-count", String(toConfirm));
  const allDoc = await page.locator('[data-kind="doc"]').count();
  await expect(page.getByTestId("count-doc")).toHaveAttribute("data-count", String(allDoc - toConfirm));

  // English: "stand-in recording", "Inferred: doctor", never "Doctor said"
  await phone.context.addCookies([{ name: "rp_lang", value: "en", url: BASE_URL }]);
  await page.goto("/p/visit?visit=v2&mode=replay");
  await expect(page.getByTestId("card-v2-u08-play-label")).toHaveText("stand-in recording");
  await expect(page.getByTestId("card-v2-u05-chip")).toContainText("Inferred: doctor");
  await expect(page.getByTestId("card-v2-u05")).not.toContainText("Doctor said");
  await expect(page.getByTestId("card-v2-u05-tag")).toContainText("To confirm");
  await closeAll([phone]);
});

test("v3 replay: the v3 screen, 18px text, then End visit, the review, and his confirmation", async ({ browser, request }) => {
  test.setTimeout(150_000);
  // Day 42: a sample visit is only replayed once the story has reached its day
  const s = await createSession(request, { story_day: 42 });
  const phone = await openDevice(browser, s.id, "/p/visit?replay=v3&speed=8");
  const page = phone.page;
  await expect(page.getByTestId("visit-screen")).toHaveAttribute("data-stream", "ended", { timeout: 60_000 });
  await expect(page.getByTestId("line-v3-u17")).toBeAttached();

  // "Doctor's notes 2 · to confirm 1": the losartan line is still only inferred, so it is not a doctor's note yet; the
  // second note is Dr Lim's last line (10-10: the warning line restated, and how to measure again)
  await expect(page.getByTestId("count-doc")).toHaveAttribute("data-count", "2");
  await expect(page.getByTestId("count-to-confirm")).toHaveAttribute("data-count", "1");
  await expect(page.getByTestId("count-doc")).toContainText("医生交代 2");
  await expect(page.getByTestId("count-doc")).toContainText("待确认 1");
  // 10-10: his "150 over 95" brings up his readings card a second time (v3-u18)
  await expect(page.getByTestId("count-chk")).toHaveAttribute("data-count", "4");
  await expect(page.getByTestId("count-q")).toHaveAttribute("data-count", "5");
  // check cards: the comparison line is the doctor's 135/85 (R1), never 140 or 130
  const bp = page.getByTestId("chk-v3-u02-bp");
  await expect(page.getByTestId("chk-v3-u02-bars")).toHaveAttribute("data-ref", "135/85");
  await expect(bp).toContainText(R.R1);
  // his own average happens to be 140/85 (visits-script: "平均 140/85"); the comparison sentence and the line are R1 only
  await expect(page.getByTestId("chk-v3-u02-summary")).toContainText("平均 140/85");
  const vs = page.getByTestId("chk-v3-u02-target");
  await expect(vs).toContainText("10 次里有 9 次不低于");
  await expect(vs).toContainText("135/85");
  await expect(vs).not.toContainText("140");
  await expect(vs).not.toContainText("130");
  await expect(page.getByTestId("chk-v3-u04-label")).toHaveText("AMLODIPINE 5MG TABLET");
  await expect(page.getByTestId("chk-v3-u04-doses")).toContainText("33 个早上勾了 29 个");
  await expect(page.getByTestId("chk-v3-u06-note-text")).toHaveText("“今天在大巴窑中心走了一圈，脚踝有点肿。”");
  // the question list: all five asked and answered, word for word (10-10: the D29 extra-tablet question too)
  await expect(page.getByTestId("qlist")).toHaveAttribute("data-anchor", "v3-u09");
  await expect(page.getByTestId("qlist-progress")).toHaveText("5 个问题，答了 5 个");
  await expect(page.getByTestId("qlist").locator('[data-state="done"]')).toHaveCount(5);
  await expect(page.getByTestId(/^q-.+-saved$/)).toHaveCount(5);
  await expect(page.getByTestId(/^q-.+-saved$/).first()).toContainText("回答已存");
  await expect(page.getByTestId("q-rq-v3-test-answer")).toHaveText("No need to fast for this one. Just take your medicine as usual and come in.");
  // "blood test ... in two weeks, and come back ... in six weeks": approximate dates, as in v3 ("Around 19 Nov")
  await expect(page.getByTestId("card-v3-u08-due-test")).toHaveText("大约 10月19日");
  await expect(page.getByTestId("card-v3-u08-due-follow_up")).toHaveText("大约 11月16日");
  // the new medicine: inferred, never "Doctor said"
  await expect(page.getByTestId("card-v3-u07-chip")).toContainText("推断");
  await expect(page.getByTestId("card-v3-u07")).not.toContainText("医生说");
  // Mr Tan's body text: 18px or more (small labels excepted)
  expect(await textBelow(page, 18)).toEqual([]);

  // End visit -> whole-visit transcript -> review
  await page.getByTestId("visit-end").click();
  await page.waitForURL(/\/p\/visit\/v3\/review$/, { timeout: 30_000 });
  await expect(page.getByTestId("review-status")).toHaveText("等你确认");
  await expect(page.getByTestId("review-chip-v3-u07")).toContainText("推断");
  await expect(page.getByTestId("review-line-v3-u07")).not.toContainText("医生说");
  expect(await textBelow(page, 18)).toEqual([]);
  await page.getByTestId("verdict-v3-u07-right").click();
  await page.getByTestId("review-confirm").click();
  await expect(page.getByTestId("review-status")).toHaveText("已确认", { timeout: 10_000 });
  await expect(page.getByTestId("review-chip-v3-u07")).toContainText("医生说");
  await expect(page.getByTestId("review-chip-v3-u02")).toContainText("本人说");
  await closeAll([phone]);
});

test("a realtime client sends 12 s windows to /api/visits/v1/extract over HTTP: cards on the phone within 5 s, the D0 items, R1 and R2", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const s = await createSession(request, { story_day: 0 });
  await api(request, "/api/visits", s.id, { mode: "record", consent: { given: true } });
  const phone = await openDevice(browser, s.id, "/p/visit?visit=v1&mode=record");
  const page = phone.page;
  await expect(page.getByTestId("visit-screen")).toBeVisible();

  // what a client flushing every 12 s sends: the sentences that finished in each period
  const lines = fixture("v1");
  const W = 12_000;
  const groups = new Map<number, Fixture[]>();
  for (const u of lines) groups.set(Math.floor(u.t_end_ms / W), [...(groups.get(Math.floor(u.t_end_ms / W)) ?? []), u]);
  const chunks = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, us]) => us);
  expect(chunks.length).toBeGreaterThan(3);
  expect(chunks.some((c) => c.length > 1)).toBe(true);

  const late: string[] = [];
  for (const chunk of chunks) {
    const sent = Date.now();
    const res = await request.post(`/api/visits/v1/extract?session=${s.id}`, {
      data: { utterances: chunk.map((u) => ({ id: u.id, t_start_ms: u.t_start_ms, t_end_ms: u.t_end_ms, speaker_cluster: u.speaker_cluster, lang: u.lang, text: u.text })) },
    });
    expect(res.status()).toBe(200);
    const out = (await res.json()) as { utterances: { id: string }[]; new_cards: { id: string; kind: string; anchor: string }[] };
    expect(out.utterances.map((u) => u.id)).toEqual(chunk.map((u) => u.id));
    for (const u of chunk) await expect(page.getByTestId(`line-${u.id}`)).toBeAttached({ timeout: 5000 });
    for (const c of out.new_cards) {
      await expect(page.getByTestId(c.kind === "doc" ? `card-${c.anchor}` : c.id)).toBeAttached({ timeout: 5000 });
    }
    const took = Date.now() - sent;
    if (took > 5000) late.push(`chunk ending ${chunk.at(-1)!.id}: cards on the phone ${took} ms after it was sent`);
  }
  expect(late).toEqual([]);

  // the D0 items, R1 and R2 verbatim with their time, the question list after "Come back"
  await expect(page.getByTestId("card-v1-u08-quote")).toHaveText(`“${R.R1}”`);
  await expect(page.getByTestId("card-v1-u08-chip")).toContainText("0:49");
  await expect(page.getByTestId("card-v1-u09-quote")).toHaveText(`“${R.R2}”`);
  await expect(page.getByTestId("card-v1-u09-chip")).toContainText("0:53");
  const variants: Record<string, string> = {
    "v1-u03": "reading",
    "v1-u05": "measure_home",
    "v1-u06": "how_to_measure",
    "v1-u07": "lifestyle",
    "v1-u08": "target",
    "v1-u09": "threshold",
    "v1-u10": "follow_up",
  };
  for (const [id, v] of Object.entries(variants)) await expect(page.getByTestId(`card-${id}`)).toHaveAttribute("data-variants", new RegExp(`\\b${v}\\b`));
  await expect(page.getByTestId("qlist")).toHaveAttribute("data-anchor", "v1-u10");
  const view = ((await (await request.get(`/api/visits/v1?session=${s.id}`)).json()) as { view: { lines: { id: string; text: string; tStartMs: number }[] } }).view;
  expect(view.lines.find((l) => l.text === R.R1)!.tStartMs).toBe(49520);
  expect(view.lines.find((l) => l.text === R.R2)!.tStartMs).toBe(53681);
  for (const a of answers("v1")) expect(view.lines.find((x) => x.id === a.id), a.id).toBeTruthy();
  await closeAll([phone]);
});

test("Day 29, a visit that already happened is watched again in a copy: the same screen, the visit's own labels untouched, the re-watch listed to finish", async ({ browser, request }) => {
  test.setTimeout(150_000);
  const s = await createSession(request); // a judge's sandbox: Day 29, 8:15pm
  const phone = await openDevice(browser, s.id, "/p/visit");
  const page = phone.page;
  await page.getByTestId("replay-v2").click();
  const screen = page.getByTestId("visit-screen");
  await expect(screen).toBeVisible();
  const copy = (await screen.getAttribute("data-visit"))!;
  expect(copy).toMatch(/^v2-again-[a-z0-9]{6}$/);
  await expect(page.getByTestId("visit-rewatch")).toHaveText("这是重看一次这次看诊。原来那次的记录不会变。");
  // the same screen as the visit's own replay: R3 and R4 word for word with their time and the stand-in clip, the
  // question he asked there with the doctor's answer
  // (a copy's lines are "<copy>-<the file's line>")
  await expect(page.getByTestId(`card-${copy}-v2-u06-quote`)).toHaveText(`“${R.R3}”`, { timeout: 90_000 });
  // he leaves before the end (R4 has not been said in this replay yet): the hero question still gets R4 as 医生说
  const view = async () => ((await (await request.get(`/api/visits/${copy}?session=${s.id}`)).json()) as { view: { visit: { status: string }; lines: { text: string }[]; rewatch?: boolean } }).view;
  expect((await view()).rewatch).toBe(true);
  await page.goto("/p/today");
  await page.getByTestId("ask-input").fill("今天 150/95，我能不能多吃一粒？");
  await page.getByTestId("ask-send").click();
  const r4 = page.locator('[data-testid="answer-line"][data-source="visit:v2:R4"]');
  await expect(r4.getByTestId("answer-chip")).toHaveText("● 医生说", { timeout: 15_000 });
  await expect(r4).toHaveAttribute("data-inferred", "false");
  // the medicine card: R3 is still the doctor's
  await page.goto("/p/meds/med-amlodipine");
  await expect(page.locator('[data-testid="card-line"][data-source="visit:v2:R3"]').getByTestId("card-line-tag")).toHaveText("● 医生说");
  // the visit itself is as it was: confirmed, no transcript of its own
  const own = ((await (await request.get(`/api/visits/v2?session=${s.id}`)).json()) as { view: { visit: { status: string }; lines: unknown[]; rewatch?: boolean } }).view;
  expect([own.visit.status, own.lines.length, own.rewatch]).toEqual(["confirmed", 0, undefined]);

  // the visit page lists the re-watch on top, to finish
  await page.goto("/p/visit");
  const row = page.getByTestId(`unfinished-${copy}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText("重看");
  await page.getByTestId(`unfinished-open-${copy}`).click();
  await expect(page.getByTestId("visit-screen")).toHaveAttribute("data-visit", copy);
  await expect(page.getByTestId("visit-screen")).toHaveAttribute("data-stream", "ended", { timeout: 90_000 });
  await expect(page.getByTestId(`card-${copy}-v2-u08-quote`)).toHaveText(`“${R.R4}”`);
  await expect(page.getByTestId(`card-${copy}-v2-u08-play-label`)).toHaveText("代录音");
  await expect(page.getByTestId("qlist").getByTestId("q-q-q-knee-1")).toHaveAttribute("data-state", "done");
  await page.getByTestId("visit-end").click();
  await page.waitForURL(new RegExp(`/p/visit/${copy}/review$`), { timeout: 30_000 });
  await expect(page.getByTestId("review-rewatch")).toBeVisible();
  // in the re-watch every line is only inferred until he checks it there; the visit's own lines stay the doctor's
  await expect(page.getByTestId(`card-${copy}-v2-u06-chip`)).toContainText("推断：医生");
  await page.goto("/p/meds/med-amlodipine");
  await expect(page.locator('[data-testid="card-line"][data-source="visit:v2:R3"]').getByTestId("card-line-tag")).toHaveText("● 医生说");
  await closeAll([phone]);
});
