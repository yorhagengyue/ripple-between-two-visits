/**
 * 05 看诊：同意、录音、字幕、卡片、回家确认 — on a real account (C2 track F).
 *
 *   8月25日 09:30 (developer test clock, frozen; the example story's first visit day, a week before journey 06's)
 *                  a new blank account, his phone only
 *   /p/visit       an empty list (「还没有看诊」, 「开始」) → where: 诊所看医生 → 「直接开始」 (not the brief first; track V) →
 *                  the card for the doctor (English, recording kept 90 days) → the doctor agrees
 *                  → recording: Chromium's fake microphone; the live captions and the record come from the
 *                  developer tools' stand-in transcription (SPEECH_PROVIDER=devfake, fixture v1: Dr Lim's first visit),
 *                  said in the corner label 「转写：测试替身」
 *   录完了          the 16 kHz WAV uploads, the stand-in makes the whole-visit record → the review page
 *   review         one line at a time: the reading, measuring at home, how to measure, less salt, the target (he
 *                  listens first: Dr Lim's stand-in voice), the warning line with 995 (listens too); 「大约一周后回来」
 *                  he says 「不是」: flagged, kept on the screen with its undo bar, a question for the doctor; 「下一件」;
 *                  save; then 「改一下」 it to 「是」
 *
 * The review is walked by what is on the screen, not by a count (_f/review.ts): he answers every line that comes up
 * until the summary shows, the lines named here get the answers above, and a line a real model adds on top (or the
 * developer tools' stand-in for one, DEVFAKE_EXTRACT=adds-two-changes-one on the server) gets 「不记得」. The assertions
 * are on the lines this journey is about, never on how many there are. Against the real database the waits for an
 * answer, for the save and for the edit after it allow 30 s.
 *
 * Run: the server on this track's port with SPEECH_PROVIDER=devfake and RIPPLE_DEV_TOOLS=1 (scripts/record/serve.mjs),
 * then `node scripts/record/run.mjs 05 --base-url http://localhost:3560`.
 */
import type { VisitView } from "@/lib/visit/types";
import { expect, journey } from "./_kit";
import { FAKE_MIC_LAUNCH, getJson, hearAs, newAccount, openPage, setClock } from "./_f/account";
import { ANSWER_TIMEOUT, answerUntilSummary, rowOf } from "./_f/review";

journey.use({ launchOptions: FAKE_MIC_LAUNCH });

/** The lines of this visit he says 「是，医生说的」 to (a piece of each, as the transcript has them). */
const YES = ["152 over 94", "measure at home for one week", "rest five minutes first", "Cut down on salt", "below 135 over 85", "call 995"];

journey("05 看诊：同意、录音、字幕、卡片、回家确认", async ({ kit, request }) => {
  await setClock(request, "2026-08-25T09:30:00+08:00");
  kit.cornerLabel("转写：测试替身");
  const { elder } = await kit.phones({ elder: "陈先生的手机" });
  const pp = elder.page;
  await elder.context.grantPermissions(["microphone"]);
  await newAccount(elder, { space: "blank" });
  await hearAs(elder, "v1");
  await openPage(elder, "/p/visit?speed=2");

  await kit.step(pp, "8月25日上午，陈先生到诊所看医生。打开「看诊」：还没有看诊记录，他按「开始」");
  await expect(pp.getByTestId("visit-empty")).toContainText("还没有看诊");
  await expect(pp.locator('[data-rp="meta-story"]')).toHaveText("8月25日 周二 · 上午 9:30");
  await pp.getByTestId("visit-start").click();

  await kit.step(pp, "先选在哪里看：诊所");
  await expect(pp.getByTestId("visit-where")).toBeVisible();
  await expect(pp.getByTestId("visit-unfinished")).toHaveCount(0);
  await pp.getByTestId("visit-clinic").click();

  await kit.step(pp, "可以先把简报给医生看。第一次看诊还没有可看的，他按「直接开始」");
  const before = pp.getByTestId("visit-before");
  await expect(before).toHaveAttribute("data-place", "clinic");
  await expect(pp.getByTestId("visit-brief-first")).toHaveText("先给医生看简报");
  await pp.getByTestId("visit-direct").click();

  await kit.step(pp, "这一屏给医生看：一句英文，问能不能录这次看诊；下面写着录音留 90 天");
  const consent = pp.getByTestId("visit-consent");
  await expect(consent).toHaveAttribute("data-place", "clinic");
  await expect(consent.locator('[data-rp="for-doctor"]')).toContainText("May I record our talk today?");
  await expect(consent).toContainText("录音留 90 天");

  await kit.step(pp, "医生点头。他按「医生同意了，开始录」");
  await pp.getByTestId("consent-start").click();
  const live = pp.getByTestId("visit-live");
  await expect(live).toHaveAttribute("data-mode", "record");
  await expect(live.locator('[data-rp="recording"]')).toContainText("正在录");
  const visitId = (await live.getAttribute("data-visit"))!;
  expect(visitId).toMatch(/^[0-9a-f-]{36}$/);
  expect((await getJson<{ view: VisitView }>(elder, `/api/visits/${visitId}`)).view.visit.status).toBe("recording");

  await kit.step(pp, "手机平放在桌上。医生的话一句句变成字幕，记下的事情一件件多起来");
  const captions = pp.getByTestId("visit-captions");
  await expect(captions).toContainText("152 over 94", { timeout: 20_000 });
  await expect.poll(async () => Number(await pp.getByTestId("visit-noted").getAttribute("data-count")), { timeout: 20_000 }).toBeGreaterThan(0);

  await kit.step(pp, "医生说了在家要低于 135/85，又说上面超过 180 就去急诊或打 995");
  await expect(captions).toContainText("below 135 over 85", { timeout: 30_000 });
  await expect(captions).toContainText("call 995", { timeout: 20_000 });
  await expect(live).toHaveAttribute("data-stream", "ended", { timeout: 30_000 });
  const noted = Number(await pp.getByTestId("visit-noted").getAttribute("data-count"));
  expect(noted).toBeGreaterThanOrEqual(6);

  await kit.step(pp, "医生说完了，他按「录完了」：录音传上去，整理成整段文字");
  await pp.getByTestId("visit-stop").click();
  await pp.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 60_000 });
  const queue = pp.getByTestId("review-queue");
  await expect(queue).toBeVisible();
  const view = (await getJson<{ view: VisitView }>(elder, `/api/visits/${visitId}`)).view;
  expect(view.visit.status).toBe("review");
  expect(view.lines.length).toBe(12);
  // never the demo's ids or the seed's record: his own visit, his own lines
  expect(view.lines.every((l) => l.id.startsWith(`${visitId}-`))).toBe(true);

  // the review: he answers whatever line comes up until the summary shows (_f/review.ts). The lines below are the ones
  // this journey is about; a line a real model adds on top gets 「不记得」 and changes nothing
  const one = pp.getByTestId("review-one");
  await kit.step(pp, "回家再认：一次只问一句。先是医生量的血压，他点「是，医生说的」");
  await expect(one).toContainText("第 1 件");
  const reviewed = await answerUntilSummary(kit, pp, [
    {
      text: "152 over 94",
      answer: "review-yes",
      before: async (line) => {
        await expect(line.locator('[data-rp="source-tag"]')).toContainText("好像是医生说的");
      },
    },
    { text: "measure at home for one week", answer: "review-yes", step: "在家量一周、怎么量、少吃盐：都是医生说的，一句一句点「是」", pause: 600 },
    { text: "rest five minutes first", answer: "review-yes", pause: 600 },
    { text: "Cut down on salt", answer: "review-yes" },
    {
      text: "below 135 over 85",
      answer: "review-yes",
      step: "这句是医生给的目标。他先点「听这一句」，听医生自己说（代录音）",
      before: async () => {
        await pp.getByTestId("review-listen").getByRole("button").click();
        await kit.waitForAudio("v1-u08", { until: "ended", timeout: 20_000 });
        await expect(pp.getByTestId("review-listen")).toContainText("代录音");
      },
    },
    {
      text: "call 995",
      answer: "review-yes",
      step: "警示线：超过 180 或胸口痛就去急诊、打 995。听完，点「是」",
      before: async () => {
        await pp.getByTestId("review-listen").getByRole("button").click();
        await kit.waitForAudio("v1-u09", { until: "ended", timeout: 30_000 });
      },
    },
    {
      text: "Come back in about a week",
      answer: "review-no",
      step: "「大约一周后带读数回来」他记不清，点「不是」：这句不删，只标出来，问题单加一条问医生",
      // the line stays on the screen, flagged, with 12 seconds to take the answer back; then 「下一件」
      held: async (held) => {
        await expect(held).toContainText("你说不对 · 已加进问题单");
        await expect(held).toContainText("这一条留着，不删。");
        await expect(pp.getByTestId("review-undo")).toContainText("已记下：不是");
        await kit.pause(1200);
      },
    },
  ]);
  const summary = pp.getByTestId("review-summary");
  const back = rowOf(pp, "Come back in about a week");
  await expect(back).toHaveAttribute("data-verdict", "wrong");
  await expect(back).toContainText("你说不对 · 已加进问题单");
  await kit.show(back);
  await kit.pause(1200);

  await kit.step(pp, "都认过了，每一句都还能改。他按「就这样，存好」");
  for (const text of YES) await expect(rowOf(pp, text), text).toHaveAttribute("data-verdict", "right");
  for (const text of reviewed.extra) await expect(rowOf(pp, text), text).toHaveAttribute("data-verdict", "unsure");
  await pp.getByTestId("review-save").click();
  await expect(summary).toHaveAttribute("data-status", "confirmed", { timeout: ANSWER_TIMEOUT });
  await expect(summary.locator('[data-rp="done-hero"]')).toContainText("记好了。");
  const saved = (await getJson<{ view: VisitView }>(elder, `/api/visits/${visitId}`)).view;
  expect(saved.visit.status).toBe("confirmed");
  const target = saved.lines.find((l) => l.text.includes("below 135 over 85"))!;
  expect(target).toMatchObject({ role: "doctor", roleState: "confirmed", display: "confirmed" });
  const flagged = saved.cards.find((c) => c.kind === "doc" && c.quote.startsWith("Come back in about a week"));
  expect(flagged).toMatchObject({ disputed: true });

  await kit.step(pp, "想了想，一周后回来确实是医生说的。他点这一行的「改一下」，改成「是」");
  await back.getByTestId("review-change").click();
  await expect(one.locator('[data-rp="said"]')).toContainText("Come back in about a week");
  await pp.getByTestId("review-yes").click();
  await expect(summary).toBeVisible({ timeout: ANSWER_TIMEOUT });
  await expect(rowOf(pp, "Come back in about a week")).toHaveAttribute("data-verdict", "right");
  await expect(summary).toHaveAttribute("data-status", "confirmed");
  const after = (await getJson<{ view: VisitView }>(elder, `/api/visits/${visitId}`)).view;
  // the lines this journey answered 「是」 to are the doctor's now, and nothing is flagged any more
  const verdictOf = (text: string) => {
    const card = after.cards.find((c) => c.kind === "doc" && c.quote.includes(text)) as { rows: { verdict?: string | null }[] } | undefined;
    return card?.rows.map((r) => r.verdict ?? "none") ?? [];
  };
  for (const text of [...YES, "Come back in about a week"]) {
    expect(verdictOf(text).length, text).toBeGreaterThan(0);
    expect(verdictOf(text).every((v) => v === "right"), text).toBe(true);
  }
  expect(after.cards.some((c) => c.kind === "doc" && (c as { disputed?: boolean }).disputed)).toBe(false);
  // a line he did not say 「是」 to is never the doctor's confirmed word
  for (const text of reviewed.extra) expect(after.lines.find((l) => l.text === text)?.display, text).not.toBe("confirmed");

  await kit.step(pp, "认过的每一句都标着「医生说」，录音留到 11月23日；每一句以后还能改");
  for (const text of [...YES, "Come back in about a week"]) await expect(rowOf(pp, text), text).toContainText("医生说");
  await expect(summary).toContainText("录音留到 11月23日");
  await kit.show(rowOf(pp, "call 995"));
  await kit.pause(800);
  await kit.show(pp.getByTestId("review-keep"));
  await kit.finish();
});
