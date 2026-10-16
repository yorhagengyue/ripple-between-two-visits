/**
 * 05 看诊（Whisper） — journey 05 with the real transcription service, on a real account (C2 track F).
 *
 *   8月25日 09:30 (developer test clock, frozen)  a new blank account, his phone only
 *   microphone     Chromium's fake microphone plays e2e/journeys/_f/whisper-mic.ts: silence, then Dr Lim's two lines of
 *                  the first visit in the repo's stand-in voice (R1 from 0:49, R2 right after), said in the corner label
 *   /p/visit       诊所 → the card for the doctor → recording: live captions from the Whisper service (2-3 s chunks to
 *                  /api/asr/chunk, the last two lines on screen) show R1 and R2 as they are said
 *   录完了          the 16 kHz WAV uploads; the service transcribes the whole recording (large-v3); the review
 *   review         the reviewed lines include R1 at 0:49 and R2; he confirms them one at a time
 *
 * Skips itself, saying why, unless the server runs SPEECH_PROVIDER=whisper and the service answers /health as ready.
 * Run: the integration build with SPEECH_PROVIDER=whisper, the service's address and token in its own web/.env, and
 * RIPPLE_DEV_TOOLS=1 (test accounts, the test clock), then
 *   node scripts/record/run.mjs 05-whisper --base-url <server>   (or npx playwright test -c playwright.journeys.config.ts e2e/journeys/05-whisper.journey.ts)
 */
import type { VisitView } from "@/lib/visit/types";
import { expect, journey } from "./_kit";
import { getJson, newAccount, openPage, setClock } from "./_f/account";
import { WHISPER_MIC_LAUNCH, WHISPER_MIC_MS } from "./_f/whisper-mic";

journey.use({ launchOptions: WHISPER_MIC_LAUNCH });

const R1 = /135/;
const R1_ALSO = /85/;
const R2 = /995|A&E|180/i;

journey.beforeEach(async ({ request }) => {
  const res = await request.get("/api/asr/health").catch(() => null);
  const h = (res && res.ok() ? await res.json().catch(() => null) : null) as { provider?: string; whisper?: { healthy?: boolean; reason?: string } } | null;
  journey.skip(!h, "the app server did not answer GET /api/asr/health");
  journey.skip(h?.provider !== "whisper", `SPEECH_PROVIDER is ${h?.provider ?? "unknown"} on this server, not whisper: this journey needs the Whisper service`);
  journey.skip(h?.whisper?.healthy !== true, `the Whisper service does not answer /health as ready (${h?.whisper?.reason ?? "no answer"})`);
});

journey("05 看诊（Whisper）：真转写的字幕和回顾", async ({ kit, request }) => {
  journey.setTimeout(8 * 60_000);
  await setClock(request, "2026-08-25T09:30:00+08:00");
  kit.cornerLabel("麦克风：代录音文件");
  const { elder } = await kit.phones({ elder: "陈先生的手机" });
  const pp = elder.page;
  await elder.context.grantPermissions(["microphone"]);
  await newAccount(elder, { space: "blank" });
  await openPage(elder, "/p/visit");

  await kit.step(pp, "8月25日上午，陈先生在诊所。打开「看诊」，还没有看诊记录，他按「开始」");
  await expect(pp.getByTestId("visit-empty")).toContainText("还没有看诊");
  await pp.getByTestId("visit-start").click();

  await kit.step(pp, "选「诊所看医生」；这次不先给医生看简报，按「直接开始」");
  await expect(pp.getByTestId("visit-where")).toBeVisible();
  await pp.getByTestId("visit-clinic").click();
  await expect(pp.getByTestId("visit-before")).toBeVisible();
  await pp.getByTestId("visit-direct").click();

  await kit.step(pp, "英文卡给医生看。医生同意，他按「医生同意了，开始录」");
  await expect(pp.getByTestId("visit-consent")).toBeVisible();
  await pp.getByTestId("consent-start").click();
  const startedAt = Date.now();
  const live = pp.getByTestId("visit-live");
  await expect(live).toHaveAttribute("data-mode", "record");
  const visitId = (await live.getAttribute("data-visit"))!;

  await kit.step(pp, "这次是本机的 Whisper 在听。麦克风放的是代录音：前面静音，0:49 起是 Dr Lim 的两句");
  const captions = pp.getByTestId("visit-captions");
  await expect(captions).toContainText(R1, { timeout: 120_000 });

  await kit.step(pp, "Dr Lim 说在家要低于 135/85：字幕是 Whisper 边听边写出来的");
  await expect(captions).toContainText(R1_ALSO, { timeout: 30_000 });
  await kit.pause(1500);

  await kit.step(pp, "接着是警示线：超过 180、胸口痛、说话不清就去急诊、打 995");
  await expect(captions).toContainText(R2, { timeout: 60_000 });

  await kit.step(pp, "医生说完了，他按「录完了」：整段录音交给 Whisper 整理成文字");
  // the fake microphone's file has played to its end
  const left = WHISPER_MIC_MS + 1000 - (Date.now() - startedAt);
  if (left > 0) await pp.waitForTimeout(left);
  await pp.getByTestId("visit-stop").click();
  await pp.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 300_000 });
  await expect(pp.getByTestId("review-queue")).toBeVisible({ timeout: 30_000 });

  await kit.step(pp, "回家再认：Whisper 整理出来的句子，一次认一句");
  const view = (await getJson<{ view: VisitView }>(elder, `/api/visits/${visitId}`)).view;
  expect(view.visit.status).toBe("review");
  const r1 = view.lines.find((l) => R1.test(l.text) && R1_ALSO.test(l.text));
  const r2 = view.lines.find((l) => R2.test(l.text));
  expect(r1, `R1 among the transcript's lines: ${JSON.stringify(view.lines.map((l) => [l.tStartMs, l.text]))}`).toBeTruthy();
  expect(r2, "R2 among the transcript's lines").toBeTruthy();
  // R1 is said from 0:49.5 of the recording (the service's segment start may differ by a fraction of a second)
  expect(r1!.tStartMs).toBeGreaterThanOrEqual(48_500);
  expect(r1!.tStartMs).toBeLessThan(50_500);
  const one = pp.getByTestId("review-one");
  const summary = pp.getByTestId("review-summary");
  for (let i = 0; i < 12 && !(await summary.isVisible()); i++) {
    await expect(one.locator('[data-rp="said"]')).toBeVisible();
    const said = (await one.locator('[data-rp="said"]').textContent()) ?? "";
    await pp.getByTestId("review-yes").click();
    await expect(one.filter({ hasText: said })).toHaveCount(0, { timeout: 15_000 });
    await kit.pause(500);
  }

  await kit.step(pp, "认好的句子里有 0:49 的「在家低于 135/85」，也有打 995 的警示线");
  await expect(summary).toBeVisible();
  const rows = summary.getByTestId("review-row");
  const r1Row = rows.filter({ hasText: R1 }).filter({ hasText: R1_ALSO });
  await expect(r1Row.first()).toBeVisible();
  await expect(r1Row.first()).toContainText(/0:49|0:48|0:50/);
  await expect(rows.filter({ hasText: R2 }).first()).toBeVisible();
  await kit.show(r1Row.first());
  await kit.finish();
});
