/**
 * 06 开药到会吃：柜台、拍药袋、讲解卡、理解清单 — on a real account (C2 track F).
 *
 *   9月1日 10:30 (developer test clock, frozen; the day the fixture label was dispensed, the example story's second
 *                  visit day)  a new blank account; before the first step his visit with Dr Lim was
 *                  recorded and turned into text by the developer tools' stand-in transcription (SPEECH_PROVIDER=devfake,
 *                  fixture v2: amlodipine is prescribed, the clinic counter explains it), said in the corner label
 *   review         he confirms Dr Lim's prescription and his reason (listening to Dr Lim's stand-in voice), and the
 *                  counter's two lines (「是，柜台说的」); saved: amlodipine is on his list, awaiting its label
 *   /p/meds        「拍 Amlodipine 的药袋」: the camera (a fixture photo of the clinic label), the label's lines on one
 *                  screen, each with 「对」 and 「改」: four 「对」, the clinic line 「改」; the last answer saves; the
 *                  label's 「every MORNING」 sets the morning slot
 *   card           the doctor's reason (医生说), how to take it (药袋上写着), what he changed (你改过); from the card, each
 *                  a screen of its own (the timeline draft's 06-8, 06-9): the explain card 「为什么没感觉也要吃」 (Dr Lim,
 *                  the counter, the leaflet) and the checklist: 知道 ×3, 不确定 (on his list); after a reload his 知道
 *                  are still there
 *
 * The review is walked by what is on the screen, not by a count (_f/review.ts): he answers every line that comes up
 * until the summary shows, the lines named here get 「是」, and a line a real model adds on top (or the developer
 * tools' stand-in for one, DEVFAKE_EXTRACT=adds-two-changes-one on the server) gets 「不记得」. The assertions are on
 * the lines this journey is about, never on how many there are. Against the real database the waits for an answer and
 * for the save allow 30 s.
 */
import path from "node:path";
import type { VisitView } from "@/lib/visit/types";
import type { Locator } from "@playwright/test";
import { expect, journey } from "./_kit";
import { clearClock, getJson, newAccount, openPage, setClock } from "./_f/account";
import { ANSWER_TIMEOUT, answerUntilSummary, rowOf } from "./_f/review";

const LABEL_PHOTO = path.join(__dirname, "..", "..", "fixtures", "labels", "amlodipine.png");
const DEVFAKE = { "x-ripple-devfake-fixture": "v2" };
/** The lines of this visit he says 「是」 to: Dr Lim's six and the counter's two (a piece of each, as the transcript has them). */
const YES = [
  "Your blood pressure is high",
  "Amlodipine, 5 milligrams, one tablet every morning",
  "This tablet works quietly",
  "ankle swelling",
  "Please don't change the dose yourself",
  "twice a week is enough now",
  "每天早上吃一粒",
  "想起来就吃",
];

// the developer test clock is one per server: the journey that runs next there must not find this one's frozen day
journey.afterAll(async ({ request }) => {
  await clearClock(request);
});

journey("06 开药到会吃：柜台、拍药袋、讲解卡、理解清单", async ({ kit, request }) => {
  await setClock(request, "2026-09-01T10:30:00+08:00");
  kit.cornerLabel("转写：测试替身");
  const { elder } = await kit.phones({ elder: "陈先生的手机" });
  const pp = elder.page;
  const api = elder.context.request;
  await newAccount(elder, { space: "blank" });

  // the visit itself (journey 05 records one): started after the consent card, turned into text by the stand-in
  const started = await api.post("/api/visits", { data: { mode: "record", consent: { given: true } } });
  expect(started.status()).toBe(200);
  const visitId = ((await started.json()) as { visit: { id: string } }).visit.id;
  const job = (await (await api.post("/api/asr/jobs", { data: { visit_id: visitId }, headers: DEVFAKE })).json()) as { job_id: string };
  await expect.poll(async () => ((await (await api.get(`/api/asr/jobs/${job.job_id}?visit_id=${visitId}`)).json()) as { status: string }).status).toBe("done");
  expect((await api.post(`/api/visits/${visitId}/finalize`, { data: { job_id: job.job_id } })).status()).toBe(200);
  await openPage(elder, `/p/visit/${visitId}/review`);

  // the review: he answers whatever line comes up until the summary shows (_f/review.ts). The lines below are the ones
  // this journey is about; a line a real model adds on top gets 「不记得」 and changes nothing
  const one = pp.getByTestId("review-one");
  let reasonLine = "";
  await kit.step(pp, "看完 Dr Lim 回家，Ripple 把医生和柜台的话整理成一句一句，等他认");
  await expect(pp.getByTestId("review-queue")).toBeVisible();
  await expect(one).toContainText("第 1 件");
  const counter = async (line: Locator) => {
    await expect(line.locator('[data-rp="source-tag"]')).toContainText("好像是柜台说的");
    await expect(pp.getByTestId("review-yes")).toContainText("是，柜台说的");
  };
  const reviewed = await answerUntilSummary(kit, pp, [
    { text: "Your blood pressure is high", answer: "review-yes" },
    { text: "Amlodipine, 5 milligrams, one tablet every morning", answer: "review-yes", step: "医生开了药：Amlodipine 5 毫克，每天早上一粒。他点「是，医生说的」" },
    {
      text: "This tablet works quietly",
      answer: "review-yes",
      step: "为什么要吃：他先听医生自己说一遍（代录音），再点「是」",
      before: async (line) => {
        reasonLine = (await line.getAttribute("data-line"))!;
        await expect(pp.getByTestId("review-listen")).toContainText("代录音");
        await pp.getByTestId("review-listen").getByRole("button").click();
        await kit.waitForAudio(`u=${reasonLine}`, { until: "ended", timeout: 30_000 });
      },
    },
    { text: "ankle swelling", answer: "review-yes", step: "脚肿要说、不要自己改剂量、一周量两次：都是医生说的", pause: 500 },
    { text: "Please don't change the dose yourself", answer: "review-yes", pause: 500 },
    { text: "twice a week is enough now", answer: "review-yes" },
    { text: "每天早上吃一粒", answer: "review-yes", step: "柜台的阿姨用华语讲了怎么吃、忘了怎么办：这两句他点「是，柜台说的」", before: counter, pause: 500 },
    { text: "想起来就吃", answer: "review-yes", before: counter },
  ]);
  // the summary: the lines this journey answered, each with his answer (how many rows there are is not this journey's)
  for (const text of YES) await expect(rowOf(pp, text), text).toHaveAttribute("data-verdict", "right");
  for (const text of reviewed.extra) await expect(rowOf(pp, text), text).toHaveAttribute("data-verdict", "unsure");

  await kit.step(pp, "都认好了，他按「就这样，存好」。医生开的药进了「我的药」，等拍药袋");
  const summary = pp.getByTestId("review-summary");
  await pp.getByTestId("review-save").click();
  await expect(summary).toHaveAttribute("data-status", "confirmed", { timeout: ANSWER_TIMEOUT });
  await pp.getByTestId("review-to-meds").click();
  await pp.waitForURL(/\/p\/meds$/);
  const row = pp.getByTestId("med-row-med-amlodipine");
  await expect(row).toHaveAttribute("data-status", "awaiting_label");
  await expect(row).toContainText("氨氯地平");
  await expect(row).toContainText("等药袋确认");
  const visit = (await getJson<{ view: VisitView }>(elder, `/api/visits/${visitId}`)).view;
  expect(visit.lines.find((l) => l.text.startsWith("Amlodipine, 5 milligrams"))).toMatchObject({ role: "doctor", roleState: "confirmed" });
  // a line he did not say 「是」 to is never the doctor's confirmed word
  for (const text of reviewed.extra) expect(visit.lines.find((l) => l.text === text)?.display, text).not.toBe("confirmed");
  await kit.pause(1200);

  await kit.step(pp, "回到家拿出药袋，点「拍 Amlodipine 的药袋」");
  await pp.getByTestId("meds-photo-awaiting").click();
  await expect(pp.getByTestId("add-photo")).toBeVisible();
  await expect(pp.getByTestId("add-photo")).toContainText("拍 Amlodipine 的药袋");
  await expect(pp.getByTestId("add-sample-amlodipine")).toHaveCount(0);

  await kit.step(pp, "用手机相机拍下药袋，Ripple 读出上面的字");
  await pp.getByTestId("add-file").setInputFiles(LABEL_PHOTO);
  const check = pp.getByTestId("add-check");
  await expect(check).toBeVisible({ timeout: 20_000 });
  await expect(check).toHaveAttribute("data-total", "5");

  await kit.step(pp, "一行一行对：药名、规格、用法、配药日期，跟药袋上一样，点「对」");
  const value = pp.getByTestId("add-check-value");
  for (const [field, text] of [
    ["drug_text", "AMLODIPINE 5MG TABLET"],
    ["strength", "5 mg"],
    ["directions", "Take ONE tablet every MORNING"],
    ["dispensed", "9月1日"],
  ] as const) {
    await expect(value).toHaveAttribute("data-field", field);
    await expect(value).toContainText(text);
    await pp.getByTestId("add-line-right").click();
    await kit.pause(400);
  }

  await kit.step(pp, "诊所那一行读多了几个字，他点「改」，改成自己认得的名字");
  await expect(value).toHaveAttribute("data-field", "clinic");
  await pp.getByTestId("add-line-change").click();
  const input = pp.getByTestId("add-edit-input");
  await kit.type(input, "Blossom Family Clinic");
  await pp.getByTestId("add-line-changed").click();
  const done = pp.getByTestId("add-done");
  await expect(done).toBeVisible({ timeout: 20_000 });

  await kit.step(pp, "药袋上写着「每天早上」：记好了，早上吃，从下一次开始提醒");
  await expect(done).toHaveAttribute("data-status", "label_confirmed");
  await expect(done).toContainText("早上吃");
  const listed = (await getJson<{ groups: { items: { id: string; status: string; slots: string[] }[] }[] }>(elder, "/api/meds")).groups.flatMap((g) => g.items);
  expect(listed.find((m) => m.id === "med-amlodipine")).toMatchObject({ status: "label_confirmed", slots: ["morning"] });
  await pp.getByTestId("add-open-card").click();

  await kit.step(pp, "药卡：医生说的为什么吃，药袋上写的怎么吃，他改过的那一行也标着「你改过」");
  const card = pp.getByTestId("med-card");
  await expect(card).toHaveAttribute("data-status", "label_confirmed");
  await expect(pp.getByTestId("med-zh-name")).toHaveText("氨氯地平");
  await expect(pp.getByTestId("med-slots")).toHaveAttribute("data-source", "label");
  await expect(pp.getByTestId("card-purpose")).toContainText("医生说");
  await expect(pp.getByTestId("card-how-to-take")).toContainText("Take ONE tablet every MORNING");
  await expect(pp.getByTestId("med-edited")).toContainText("Blossom Family Clinic");

  // the explain card and the checklist are screens of their own under the card (the timeline draft's 06-8, 06-9)
  await kit.step(pp, "点「为什么没感觉也要吃」：医生的原话、柜台的两句、单张上的话。他点「听原声」");
  await kit.show(pp.getByTestId("card-explain-open"));
  await pp.getByTestId("card-explain-open").click();
  const explain = pp.getByTestId("card-explain");
  await expect(explain).toBeVisible();
  await expect(pp.getByTestId("med-card")).toHaveAttribute("data-view", "why");
  await expect(explain.locator('[data-testid="explain-line"][data-kind="doctor"]')).toContainText("This tablet works quietly");
  // the counter's lines he said yes to in the review: the two this journey knows by their words (a real model finds
  // more lines to confirm than the rules do, so the total is not fixed)
  const counterLines = explain.locator('[data-testid="explain-line"][data-kind="counter"]');
  await expect(counterLines.filter({ hasText: "每天早上吃一粒" }).first()).toBeVisible();
  await expect(counterLines.filter({ hasText: "想起来就吃" }).first()).toBeVisible();
  // the same clip played in the review: wait for this second play (kit.waitForAudio would find the first one)
  const heard = () => kit.audioClips().filter((c) => c.src.includes(`u=${reasonLine}`));
  const before = heard().length;
  await explain.getByTestId("card-listen").first().getByRole("button").click();
  await expect.poll(() => heard().length, { timeout: 15_000 }).toBe(before + 1);
  await expect(explain.getByTestId("card-listen").first()).toHaveAttribute("data-playing", "true");
  await expect.poll(() => heard()[before].endWall !== null, { timeout: 30_000 }).toBe(true);

  await kit.step(pp, "理解清单：做什么的、没感觉要不要吃、什么时候吃，他都「知道」");
  await kit.show(pp.getByTestId("card-check-open"));
  await pp.getByTestId("card-check-open").click();
  const checklist = pp.getByTestId("card-checklist");
  await expect(checklist).toBeVisible();
  await expect(pp.getByTestId("med-card")).toHaveAttribute("data-view", "check");
  for (const item of ["purpose", "feel_fine", "when"]) {
    await pp.getByTestId(`check-${item}-know`).click();
    await expect(pp.getByTestId(`check-${item}`)).toHaveAttribute("data-answer", "know");
    await kit.pause(300);
  }
  await kit.pause(900);

  await kit.step(pp, "漏了怎么办他不确定：点「不确定」，加进下次看诊的问题单");
  await pp.getByTestId("check-missed-unsure").click();
  await expect(pp.getByTestId("check-missed")).toHaveAttribute("data-answer", "unsure");
  await expect(pp.getByTestId("check-missed")).toContainText("已在下次看诊的问题单里");
  await kit.show(pp.getByTestId("check-missed"));
  await kit.pause(1000);

  await kit.step(pp, "关掉再打开药卡：他点过的「知道」都还在");
  await pp.reload();
  await kit.show(pp.getByTestId("card-checklist"));
  for (const item of ["purpose", "feel_fine", "when"]) await expect(pp.getByTestId(`check-${item}`)).toHaveAttribute("data-answer", "know");
  await expect(pp.getByTestId("check-missed")).toHaveAttribute("data-answer", "unsure");
  await kit.finish();
});
