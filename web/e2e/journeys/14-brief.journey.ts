/**
 * 14 准备下次看诊, on a real account (C2 track B; real-app 2.18, 4.4; e2e-chains 19). One phone, his.
 *
 * Setup (not recorded): the developer test clock stands at Mon 12 Oct 2026 10:00 and an account is made with Mr Tan's
 * example data (POST /api/dev/accounts, the phone signed in): today is his follow-up (the planned v3), the last clinic
 * visit that happened is v2 on 8 Sep. At 10:05 he records one reading, 185/112 (POST /api/bp).
 *
 *   10:10  Today: the next visit is today, 3 questions for the doctor, the brief is ready
 *          the brief: from the day after the last visit that happened, real dates (9 Sep to 12 Oct); readings with
 *          the target in the doctor's own words; the reading above the doctor's warning line on a line of its own;
 *          doses counted cell by cell (today's morning was before he started: not counted); the routine the missed
 *          ones fall on; his notes and the same three questions as the visit screen (no diet line: he answered no
 *          diet check, so track K's weeklyDietLine is null)
 *          给医生看: full screen, large English; one tap to Mandarin and back; 看完了
 */
import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect, journey } from "./_kit";

const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;

async function clock(request: APIRequestContext, at: string): Promise<void> {
  const res = await request.post("/api/dev/clock", { data: { at, frozen: true } });
  expect(res.status(), await res.text()).toBe(200);
}

journey.afterAll(async ({ request }) => {
  await request.post("/api/dev/clock", { data: { clear: true } });
});

journey("14 准备下次看诊", async ({ kit, request }) => {
  await clock(request, SGT("2026-10-12", "10:00"));
  const { elder } = await kit.phones({ elder: "陈先生的手机" });
  const ctx = elder.context;
  const made = await ctx.request.post("/api/dev/accounts", { data: { login: `tan${randomUUID().slice(0, 8)}`, password: "a long test password", space: "example" } });
  expect(made.status(), await made.text()).toBe(201);
  // the example's one-time intro was put away earlier (track C's 「知道了」)
  const dismissed = await ctx.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
  expect(dismissed.status(), await dismissed.text()).toBe(200);
  await clock(request, SGT("2026-10-12", "10:05"));
  const bp = await ctx.request.post("/api/bp", { data: { id: randomUUID(), systolic: 185, diastolic: 112 } });
  expect(bp.status(), await bp.text()).toBe(201);
  await clock(request, SGT("2026-10-12", "10:10"));
  const pp = elder.page;

  await pp.goto("/p/today");
  await expect(pp.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
  await kit.step(pp, "10月12日周一，今天复诊：「今天」页写着今天看医生、3 个要问的、简报准备好了");
  // this morning's window closed before he started (real-app 4.4): a calm line, never 「没记」, so the day's overview stays
  await expect(pp.getByTestId("dose-headline")).toHaveAttribute("data-why", "untracked");
  await expect(pp.getByTestId("dose-headline")).toHaveText("早上的药，要记的话现在可以记。");
  const countdown = pp.getByTestId("countdown-section");
  await expect(countdown).toHaveAttribute("data-days", "0");
  await expect(pp.getByTestId("countdown-when")).toHaveText("今天");
  await expect(pp.getByTestId("countdown-questions")).toHaveText("3 个");
  await expect(pp.getByTestId("countdown-brief")).toHaveText("今天看医生 · 简报准备好了");
  await kit.show(countdown);
  await kit.pause(1200);

  await kit.step(pp, "点「简报」：从上次看诊（9月8日）的第二天算起，写的是真实日期");
  await pp.getByTestId("countdown-brief").click();
  await expect(pp.getByTestId("page-brief")).toHaveAttribute("data-scope", "account");
  await expect(pp.getByTestId("brief-window")).toHaveText("上次看诊（9月8日）之后：9月9日到10月12日");
  await expect(pp.getByTestId("page-brief")).not.toContainText(/第 ?\d+ ?天/);

  await kit.step(pp, "血压：11 次读数和平均数，旁边是医生说的目标原话；不评价");
  const bpBlock = pp.getByTestId("brief-bp");
  await expect(bpBlock).toHaveAttribute("data-count", "11");
  await expect(pp.getByTestId("brief-target")).toContainText("At home, we want it below 135 over 85.");
  await kit.show(bpBlock);
  await kit.pause(1500);

  await kit.step(pp, "今早那次 185/112 单独一行，放在医生说过的那条线旁边");
  const above = pp.getByTestId("brief-above");
  await expect(above).toHaveAttribute("data-count", "1");
  await expect(above.getByTestId("brief-above-reading")).toHaveAttribute("data-reading", "185/112");
  await expect(above).toContainText("10月12日");
  await kit.show(above);
  await kit.pause(1500);

  await kit.step(pp, "吃药：33 次里吃了 29 次，没吃的都在打太极的早上；今天早上那格他还没开始用，不算");
  const doses = pp.getByTestId("brief-doses");
  await expect(doses).toHaveAttribute("data-due", "33");
  await expect(doses).toHaveAttribute("data-taken", "29");
  await expect(pp.getByTestId("brief-doses-missed")).toContainText("打太极");
  await kit.show(doses);
  await kit.pause(1500);

  await kit.step(pp, "下面是他记下的原话，和要问医生的 3 个问题，每个都标着从哪来");
  const questions = pp.getByTestId("brief-questions");
  await expect(questions).toHaveAttribute("data-count", "3");
  await expect(questions.getByTestId("brief-question")).toHaveCount(3);
  await expect(questions.getByTestId("brief-question").nth(0)).toHaveAttribute("data-question", "q-extra-tablet");
  await expect(questions.getByTestId("brief-question").nth(1)).toHaveAttribute("data-question", "q-tai-chi");
  await expect(questions.getByTestId("brief-question").nth(2)).toHaveAttribute("data-question", "q-knee-2");
  await expect(questions.getByTestId("brief-question").nth(0)).toContainText("记录的摘要，不是他的原话");
  await kit.show(pp.getByTestId("brief-notes"));
  await kit.pause(1200);
  await kit.show(questions);
  await kit.pause(1500);

  await kit.step(pp, "点「给医生看」：全屏，英文大字，交给医生");
  await pp.getByTestId("brief-show-doctor").click();
  const doctor = pp.getByTestId("brief-doctor");
  await expect(doctor).toHaveAttribute("data-lang", "en");
  await expect(doctor).toContainText("Since the visit on 8 Sep");
  await expect(doctor).toContainText("11 readings");
  await expect(doctor.locator('[data-testid="brief-question"][data-question="q-extra-tablet"]')).toContainText("Recorded summary, not his own words");
  await kit.pause(1500);
  await kit.show(doctor.getByTestId("brief-questions"));
  await kit.pause(1500);

  await kit.step(pp, "一键切到华语给自己看，再切回英文");
  await pp.getByTestId("brief-doctor-lang").click();
  await expect(doctor).toHaveAttribute("data-lang", "zh-Hans");
  await expect(doctor).toContainText("上次看诊（9月8日）之后：9月9日到10月12日");
  await kit.pause(2000);
  await pp.getByTestId("brief-doctor-lang").click();
  await expect(doctor).toHaveAttribute("data-lang", "en");

  await kit.step(pp, "看完了：点「看完了」回到他自己的简报");
  await pp.getByTestId("brief-doctor-done").click();
  await expect(pp.getByTestId("page-brief")).toBeVisible();
  await expect(pp.getByTestId("brief-doctor")).toHaveCount(0);
  await kit.pause(1200);

  await kit.step(pp, "给医生看过的那一页留了底：简报最下面多一行「上次给医生看的那一页」，写着哪天几点");
  const last = pp.getByTestId("brief-last-shown");
  await expect(last).toContainText("上次给医生看的那一页");
  await expect(last).toContainText("10月12日 周一");
  await kit.show(last);
  await kit.pause(1500);

  await kit.step(pp, "点开还是那一页：以后再记什么，这一页的数字都不变");
  await last.locator("a").click();
  const kept = pp.getByTestId("brief-doctor");
  await expect(kept).toHaveAttribute("data-kept", "true");
  await expect(pp.getByTestId("brief-kept-note")).toContainText("给医生看的那一页，内容不会再变");
  await expect(kept).toContainText("11 readings");
  await kit.pause(2000);

  await kit.finish();
});
