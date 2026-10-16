/**
 * 18 女儿：录提醒 (C2 track D; real-app 3.10 录提醒; the daughter brief E1-E5; architecture review 18 「能听回、能删、能
 * 重录；卡上的字和录音一致」, 还开着的决定: medicine names, numbers and doses keep the words off his card).
 * Two phones: 陈先生的手机 (his account, Mr Tan's example data) and 女儿的手机 (her account, confirmed by him), Tuesday 8:10 pm.
 *
 *   her recorder   what plays now (the seed's stand-in, 「代录音」) → record (Chromium's fake microphone plays a test
 *                  recording of 「爸，早餐吃了吗？药记得吃哦。」) → listen back (the take's own sound goes into the mp4) →
 *                  record again → 「就用这段」: the server takes the words from the clip itself (the developer tools'
 *                  stand-in transcription, said in the corner) → 「明天 8:45 开始放这段。」 and what his card will say
 *   a take naming a medicine and a dose (the stand-in transcription hears 「…吃一粒 Amlodipine 5 毫克」): his card will
 *                  show only 「Wei Ling 的录音」, no words; on 「我录过的」 (its own screen, the v3 draft's E5) she switches
 *                  back to her first take (「换回这段」) and deletes the other one (「删掉」)
 *   next morning   8:45: the reminder goes out (the jobs run once); his phone opens it and plays HER recording, her
 *                  words under it, labelled 「Wei Ling 的录音」; her home says she was just heard
 */
import path from "node:path";
import type { HerReminders } from "@/lib/care/reminders";
import { expect, journey } from "./_kit";
import { clearClock, fakeMicLaunch, linkFamily, newAccount, setClock, setSwitches, tick } from "./_d/family";

const STAND_IN = path.resolve(process.cwd(), "lib", "daily", "assets", "wei-ling-reminder.standin.wav");
const WORDS = "爸，早餐吃了吗？药记得吃哦。";

journey.use({ launchOptions: fakeMicLaunch(STAND_IN) });

journey("18 女儿：录提醒", async ({ kit, request }) => {
  await setClock(request, "2026-10-13T20:10:00+08:00");
  try {
    kit.cornerLabel("转写：测试替身");
    const { elder, daughter } = await kit.phones({ elder: "陈先生的手机", daughter: "女儿的手机" });
    const pp = elder.page;
    const dp = daughter.page;
    await daughter.context.grantPermissions(["microphone"]);
    await newAccount(elder, { space: "example", displayName: "陈先生", prefix: "tan" });
    await newAccount(daughter, { space: "none", displayName: "Wei Ling", prefix: "wl" });
    const linkId = await linkFamily(elder.context, daughter.context);
    await setSwitches(elder.context, linkId, { dose_summary: true });
    await daughter.context.setExtraHTTPHeaders({ "x-ripple-devfake-fixture": "reminder" });
    await dp.goto(`/f?link=${linkId}`);
    await dp.evaluate((id) => {
      localStorage.setItem(`rp_f_welcomed_${id}`, "1");
      localStorage.setItem(`rp_f_phone_${id}`, "+65 0000 0000");
    }, linkId);
    await dp.reload();
    await pp.goto("/p/today");
    const mine = async () => (await (await daughter.context.request.get(`/api/reminders?link=${linkId}`)).json()) as HerReminders;

    await kit.step(dp, "晚上 8 点多，Wei Ling 在首页点「录一段新的提醒」");
    await expect(dp.getByTestId("family-app")).toHaveAttribute("data-live", "open");
    await dp.getByTestId("record-new").click();
    await expect(dp.getByTestId("reminder-studio")).toHaveAttribute("data-state", "idle");
    await expect(dp.getByTestId("family-headline")).toHaveText("录一句话，每天 8:45 放给爸爸听。");

    await kit.step(dp, "现在放给爸爸的是代录音。她按一下青绿色的录音键，对着手机说「爸，早餐吃了吗？药记得吃哦。」波形跟着声音动");
    await expect(dp.getByTestId("rec-current")).toContainText(WORDS);
    await expect(dp.getByTestId("rec-current")).toContainText("代录音");
    // the take lasts as long as the stand-in sentence (4.9 s): the caption comes before the tap, not during the take
    await dp.getByTestId("rec-start").click();
    await expect(dp.getByTestId("reminder-studio")).toHaveAttribute("data-state", "recording");
    await dp.waitForTimeout(4300);
    await dp.getByTestId("rec-stop").click();
    await expect(dp.getByTestId("reminder-studio")).toHaveAttribute("data-state", "recorded");
    await expect(dp.getByTestId("rec-time")).toHaveText(/^0:0[3-6]$/);

    await kit.step(dp, "录好了。她先点「听一遍」");
    await dp.getByTestId("rec-listen").click();
    await kit.waitForAudio(/^blob:/, { until: "ended", timeout: 20_000 });

    await kit.step(dp, "说得有点快，她点「重录」再录一次");
    await dp.getByTestId("rec-again").click();
    await expect(dp.getByTestId("reminder-studio")).toHaveAttribute("data-state", "recording");
    await dp.waitForTimeout(4300);
    await dp.getByTestId("rec-stop").click();
    await expect(dp.getByTestId("reminder-studio")).toHaveAttribute("data-state", "recorded");

    await kit.step(dp, "这次满意了。她点「就用这段」");
    await dp.getByTestId("rec-use").click();
    await expect(dp.getByTestId("reminder-studio")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
    await expect(dp.getByTestId("rec-saved")).toHaveText("明天 8:45 开始放这段。");
    await expect(dp.getByTestId("rec-card-preview")).toContainText(WORDS);
    const first = await mine();
    expect(first.current?.whose).toBe("yours");
    expect(first.current?.text).toBe(WORDS);
    const firstId = first.current!.id;

    await kit.step(dp, "已经换成这段：爸爸的卡上会显示她说的这句话，字和录音是同一段");
    await kit.pause(1200);

    await kit.step(dp, "她再试一段提到药名和剂量的（转写替身听成「吃一粒 Amlodipine 5 毫克」）");
    await daughter.context.setExtraHTTPHeaders({ "x-ripple-devfake-fixture": "reminder-dose" });
    await dp.getByTestId("rec-new").click();
    await dp.getByTestId("rec-start").click();
    await dp.waitForTimeout(3500);
    await dp.getByTestId("rec-stop").click();
    await dp.getByTestId("rec-use").click();
    await expect(dp.getByTestId("reminder-studio")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });

    await kit.step(dp, "说到了药名和剂量，爸爸那边只放录音，卡上只写「Wei Ling 的录音」");
    await expect(dp.getByTestId("rec-card-preview")).toContainText("Wei Ling 的录音");
    await expect(dp.getByTestId("rec-card-preview")).toContainText("药名、数字或剂量");
    const second = await mine();
    expect(second.current?.text).toBeNull();
    expect(JSON.stringify(second)).not.toContain("Amlodipine");

    await kit.step(dp, "她点「再录一段」回到录音页，再点「我录过的」：两段都在，刚录的那段标着「正在放」");
    await dp.getByTestId("rec-new").click();
    await expect(dp.getByTestId("reminder-studio")).toHaveAttribute("data-state", "idle");
    await dp.getByTestId("rec-mine-open").click();
    await expect(dp.getByTestId("rec-mine")).toBeVisible();
    const rows = dp.getByTestId("rec-mine-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toHaveAttribute("data-current", "true");
    await expect(rows.first()).toContainText("正在放");
    // the one that plays cannot be deleted while there is another to switch to
    await expect(rows.first().getByTestId("rec-mine-delete")).toHaveCount(0);
    await expect(dp.getByTestId("rec-mine")).toContainText("正在放的那段不能删。要删，先换回另一段。");

    await kit.step(dp, "她点第一段的「换回这段」：那一段排到最上面，标上「正在放」");
    await rows.nth(1).getByTestId("rec-mine-use").click();
    await expect.poll(async () => (await mine()).current?.text).toBe(WORDS);
    await expect(dp.getByTestId("rec-mine-row").first()).toHaveAttribute("data-current", "true");
    await expect(dp.getByTestId("rec-mine-said")).toHaveText("已经换回这段，明天 8:45 开始放。");

    await kit.step(dp, "提到药名的那段她不要了，点「删掉」：「我录过的」只剩现在放的这段");
    await dp.getByTestId("rec-mine-row").filter({ hasText: "Wei Ling 的录音" }).getByTestId("rec-mine-delete").click();
    await expect(dp.getByTestId("rec-mine-row")).toHaveCount(1);
    await expect(dp.getByTestId("rec-mine-row")).toContainText(WORDS);
    await expect.poll(async () => (await mine()).mine.length).toBe(1);
    expect((await mine()).current?.text).toBe(WORDS);

    // ------------------------------------------------------------ the next morning
    await setClock(request, "2026-10-14T08:45:00+08:00");
    await tick(request);
    await kit.step(pp, "第二天早上 8:45，陈先生的手机来了提醒（推送画在画面上）");
    await kit.showNotification(pp, { title: "Ripple", body: "早上的药，还没记", time: "8:45" });
    await kit.pause(1500);

    await kit.step(pp, "他点开提醒：今天页放的是女儿自己的录音");
    await pp.goto("/p/today?remind=dose-morning");
    const card = pp.getByTestId("her-reminder");
    await expect(card).toBeVisible();
    const current = (await mine()).current!;
    await expect(card).toHaveAttribute("data-clip", current.id);
    await expect(pp.getByTestId("her-words")).toContainText(WORDS);
    // the tag names her by the name he gave her link (real-app 3.10 「他的提醒卡写『Wei Ling 的录音』」)
    await expect(card).toContainText("Wei Ling 的录音");
    await expect(card).not.toContainText("女儿的录音");
    await kit.waitForAudio(`/api/reminders/${encodeURIComponent(current.id)}/audio`, { until: "ended", timeout: 20_000 });
    expect(current.id).not.toBe(firstId); // the chosen-again take is a fresh row pointing at the same file

    await dp.goto(`/f?link=${linkId}`);
    await kit.step(dp, "Wei Ling 的首页：刚提醒过爸爸，还没回；8:45 放的是她的提醒");
    await expect(dp.getByTestId("family-headline")).toHaveText("刚提醒过爸爸，还没回。");
    await expect(dp.getByTestId("family-timeline")).toContainText("放了你的提醒");
    await expect(dp.getByTestId("family-timeline")).toContainText(WORDS);
    await kit.pause(1500);
    await kit.finish();
  } finally {
    await clearClock(request);
  }
});
