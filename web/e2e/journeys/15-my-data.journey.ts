/**
 * 15 我的数据：导出、删除、录音保留期 — on real accounts (C2 track H; real-app 3.11, 8.9; the elder brief 15).
 * Two phones side by side: 陈先生的手机 and 女儿的手机.
 *
 *   before step 1   the developer test clock at 8月24日 and 9月1日: his blank account, and two visits recorded through
 *                   his visit screen's own calls (the recording uploaded to his storage folder; the stand-in
 *                   transcription, SPEECH_PROVIDER=devfake, makes the text: the corner label says so). Then the clock
 *                   goes back to real time: Wei Ling's account, his invitation, her acceptance and his confirmation
 *                   through track D's routes, two items switched on; her phone opens what he shares (her own page
 *                   writes the look into his access log).
 *   我的数据         export: the file saved on his phone, every table of his records in it, his recordings as links that
 *                   work for 24 hours (one is fetched); three a day, then the button rests (the fourth is 429)
 *   AI 处理          on, with what goes to Tencent Cloud's Hunyuan model; off: a new consent record, and the next answer says it used
 *                   the fixed rules only; on again
 *   录音留多久        both recordings kept until 90 days after their visit; 9月1日 kept for good; he listens to it
 *   90 days later   the test clock at 12月1日, one pass of the retention job: 8月24日's recording is gone (its file and
 *                   its link), its transcript stays; the kept one is still there
 *   家人什么时候看过   she looks again on 12月1日 (her page writes it) and his access log lists her looks
 *   删除账号          what goes, then his password: storage first (the kept recording's link stops working), his sign-in
 *                   and account gone, her page shows none of his (her link answers 404), the old login refused
 *
 * Run: the server on this track's port with SPEECH_PROVIDER=devfake and RIPPLE_DEV_TOOLS=1 (scripts/record/serve.mjs),
 * then `node scripts/record/run.mjs 15 --base-url http://localhost:3590`.
 */
import { readFileSync } from "node:fs";
import type { Download, Page } from "@playwright/test";
import { expect, journey } from "./_kit";
import { linkFamily, setSwitches } from "./_d/family";
import { clearClock, devAccount, fixtureWav, H_PASSWORD, recordVisit, setClock, tickRetention } from "./_h/my-data";

interface ExportDoc {
  format: string;
  links_expire_at: string;
  counts: Record<string, number>;
  tables: Record<string, Record<string, unknown>[]>;
  files: { kind: string; visit_id?: string; url: string | null; expires_at: string | null }[];
}

async function exportOnce(page: Page): Promise<{ download: Download; doc: ExportDoc }> {
  const downloaded = page.waitForEvent("download");
  await page.getByTestId("export-button").click();
  const download = await downloaded;
  const file = await download.path();
  return { download, doc: JSON.parse(readFileSync(file, "utf8")) as ExportDoc };
}

journey("15 我的数据：导出、删除、录音保留期", async ({ kit, request }) => {
  kit.cornerLabel("转写：测试替身 · 时间：测试时钟");
  const { elder, daughter } = await kit.phones({ elder: "陈先生的手机", daughter: "女儿的手机" });
  const pp = elder.page;
  const dp = daughter.page;
  const api = elder.context.request;

  // ---- before the first step: his account, two recorded visits, Wei Ling and her link (track D's real routes)
  await setClock(request, "2026-08-24T09:30:00+08:00");
  const him = await devAccount(api, { prefix: "tan", space: "blank", displayName: "陈先生" });
  const v1 = await recordVisit(api, { fixture: "v1", wav: fixtureWav("v1-u08") });
  await setClock(request, "2026-09-01T10:30:00+08:00");
  const v2 = await recordVisit(api, { fixture: "v2", wav: fixtureWav("v2-u08") });
  await clearClock(request);
  const her = await devAccount(daughter.context.request, { prefix: "weiling", space: "none", displayName: "Wei Ling" });
  const linkId = await linkFamily(elder.context, daughter.context, { label: "Wei Ling", calls: "爸爸" });
  await setSwitches(elder.context, linkId, { dose_summary: true, bp_summary: true });
  // she went through her first-visit steps already (track D keeps that on her phone): her home, not the welcome
  await dp.goto("/privacy");
  await dp.evaluate((id) => window.localStorage.setItem(`rp_f_welcomed_${id}`, "1"), linkId);
  await dp.goto(`/f?link=${linkId}`); // her page writes her look into his access log
  await expect(dp.getByTestId("family-app")).toBeVisible();
  expect((await daughter.context.request.get(`/api/family/view?link=${linkId}`)).status()).toBe(200);
  await pp.goto("/p/me");
  await expect(pp.locator('[data-entry="data"]')).toBeVisible();

  // ---- 我的数据: export
  await kit.step(pp, "陈先生在「我」里打开「我的数据」：导出、录音、家人看过的记录都在这里");
  await pp.locator('[data-entry="data"]').click();
  await expect(pp.getByTestId("page-my-data")).toBeVisible();
  await expect(pp.getByTestId("export-left")).toHaveText("今天还能导出 3 次。");
  await expect(pp.locator('[data-entry="access"]')).toContainText("Wei Ling 最近一次");
  await kit.show(pp.getByTestId("export-button"));

  await kit.step(pp, "点「导出我的资料」：一份文件存进手机，里面录音的链接 24 小时内能下载");
  const first = await exportOnce(pp);
  expect(first.download.suggestedFilename()).toMatch(/^ripple-export-\d{4}-\d{2}-\d{2}\.json$/);
  expect(first.doc).toMatchObject({ format: "ripple-export", counts: { visits: 2, family_links: 1, family_access_log: 1 } });
  expect(first.doc.counts.utterances).toBeGreaterThan(10);
  expect(first.doc.counts.consents).toBeGreaterThanOrEqual(2);
  const recordings = first.doc.files.filter((f) => f.kind === "visit_recording");
  expect(recordings.map((f) => f.visit_id).sort()).toEqual([v1.id, v2.id].sort());
  const hours = (Date.parse(first.doc.links_expire_at) - Date.now()) / 3_600_000;
  expect(hours).toBeGreaterThan(23.9);
  expect(hours).toBeLessThanOrEqual(24);
  const v1Link = recordings.find((f) => f.visit_id === v1.id)!.url!;
  const v2Link = recordings.find((f) => f.visit_id === v2.id)!.url!;
  const fetched = await request.get(v1Link);
  expect(fetched.status()).toBe(200);
  expect(fetched.headers()["content-type"]).toContain("audio/wav");
  for (const id of [him.userId, her.userId]) expect(JSON.stringify(first.doc)).not.toContain(id);
  await expect(pp.getByTestId("export-done")).toContainText("文件做好了");
  await expect(pp.getByTestId("export-done")).toContainText("都能下载");
  await expect(pp.getByTestId("export-left")).toHaveText("今天还能导出 2 次。");
  await kit.show(pp.getByTestId("export-done"));

  await kit.step(pp, "一天最多导 3 次：再导两次以后，按钮停下，写明哪天起能再导");
  await exportOnce(pp);
  await expect(pp.getByTestId("export-left")).toHaveText("今天还能导出 1 次。");
  await exportOnce(pp);
  await expect(pp.getByTestId("export-none-left")).toContainText("今天已经导出 3 次");
  await expect(pp.getByTestId("export-button")).toBeDisabled();
  const fourth = await api.post("/api/me/export", { data: {} });
  expect(fourth.status()).toBe(429);
  expect(await fourth.json()).toMatchObject({ error: "export_limit" });
  await kit.show(pp.getByTestId("export-none-left"));

  // ---- AI 处理
  await kit.step(pp, "「AI 处理」现在开着：写明问一句交给腾讯云的混元模型处理");
  await pp.goto("/p/me");
  await pp.locator('[data-entry="ai"]').click();
  const ai = pp.getByTestId("page-ai");
  // the AI switch itself (the one at the foot says someone is helping)
  const aiSwitch = ai.locator('[data-grant="ai_processing"]').getByRole("switch");
  await expect(ai).toHaveAttribute("data-on", "true");
  // the header names the screen; the state is on the switch, in words (the timeline draft's 15-5)
  await expect(pp.locator('[data-rp="page-title"]')).toHaveText("AI 处理");
  await expect(aiSwitch).toHaveAttribute("aria-checked", "true");
  await expect(aiSwitch).toContainText("开");
  await expect(pp.getByTestId("ai-text")).toContainText("腾讯云的混元模型");
  await kit.show(aiSwitch);

  await kit.step(pp, "他把开关点成「关」：记下一条新的同意，从现在起不发给混元模型");
  await aiSwitch.click();
  await expect(ai).toHaveAttribute("data-on", "false");
  await expect(aiSwitch).toHaveAttribute("aria-checked", "false");
  await expect(aiSwitch).toContainText("关");
  await expect(pp.getByTestId("ai-notice")).toContainText("不发给混元模型");
  const meOff = (await (await api.get("/api/me")).json()) as { consents: { kind: string; decision: string }[] };
  expect(meOff.consents.find((c) => c.kind === "ai_processing")?.decision).toBe("withdrawn");

  await kit.step(pp, "关了以后问一句：屏上写明没有同意用 AI，这里只能帮他记下来、转给医生");
  await pp.goto("/p/ask");
  await kit.type(pp.getByTestId("ask-input"), "这个药是做什么的？");
  const asked = pp.waitForResponse((r) => r.url().includes("/api/ask") && r.request().method() === "POST");
  await pp.getByTestId("ask-field").locator('button[type="submit"]').click();
  const askRes = await asked;
  expect(askRes.status()).toBe(200);
  expect(((await askRes.json()) as { noAiConsent?: boolean }).noAiConsent).toBe(true);
  // C2 track S (round 2): one sentence, the design's (real-app 2.10 line 189), on the ask screen while AI is off
  const noAi = pp.getByTestId("ask-no-ai");
  await expect(noAi).toHaveText("你没有同意用 AI，这里只能帮你记下来、转给医生。");
  await expect(noAi).toBeVisible();
  await kit.show(noAi);
  await kit.pause(3000); // the answer and its line stay on screen long enough to read

  await kit.step(pp, "回到「AI 处理」再打开：同样记一条同意，问一句又能用 AI 帮忙");
  await pp.goto("/p/me/ai");
  await pp.getByTestId("page-ai").locator('[data-grant="ai_processing"]').getByRole("switch").click();
  await expect(pp.getByTestId("page-ai")).toHaveAttribute("data-on", "true");
  await expect(pp.getByTestId("ai-notice")).toContainText("已经打开");
  expect(await (await api.get("/api/me/consent")).json()).toMatchObject({ ai: { on: true, decision: "granted" } });

  // ---- 录音留多久
  await kit.step(pp, "「看诊录音留多久」：两次看诊的录音，各留到看诊后 90 天");
  await pp.goto("/p/me/export");
  await pp.locator('[data-entry="recordings"]').click();
  await expect(pp.getByTestId("page-recordings")).toBeVisible();
  const rows = pp.getByTestId("recording");
  await expect(rows).toHaveCount(2);
  const row1 = pp.locator(`[data-testid="recording"][data-visit="${v1.id}"]`);
  const row2 = pp.locator(`[data-testid="recording"][data-visit="${v2.id}"]`);
  await expect(rows.first()).toHaveAttribute("data-visit", v2.id); // newest first
  await expect(row2).toContainText("9月1日");
  await expect(row2).toContainText("留到 11月30日，到期自动删。");
  await expect(row1).toContainText("8月24日");
  await expect(row1).toContainText("留到 11月22日，到期自动删。");

  await kit.step(pp, "9月1日开药那次，他点「一直保留」：这段录音不会自动删");
  await row2.getByRole("switch").click();
  await expect(row2).toHaveAttribute("data-state", "kept_forever");
  await expect(row2).toContainText("一直保留，不会自动删。");
  const meKept = (await (await api.get("/api/me")).json()) as { consents: { kind: string; decision: string }[] };
  expect(meKept.consents.find((c) => c.kind === "retention_keep_forever")?.decision).toBe("granted");

  await kit.step(pp, "点「听录音」：9月1日那次的录音还在（测试用的代录音）");
  const listen = row2.locator("button").filter({ hasText: "听录音" }).first();
  await listen.click();
  // a tap that lands before the page is ready plays nothing: tap once more (the recording is the same either way)
  // the player's address is his own route, which signs a fresh 10-minute link for every play (real-app 3.9)
  const started = await kit.waitForAudio("/api/me/export/recording", { until: "playing", timeout: 6_000 }).catch(() => null);
  if (!started) await listen.click();
  await kit.waitForAudio("/api/me/export/recording", { until: "ended", timeout: 25_000 });
  const fresh = await api.get(`/api/me/export/recording?visit=${encodeURIComponent(v2.id)}`, { maxRedirects: 0 });
  expect(fresh.status()).toBe(302);

  // ---- 90 days later
  await kit.step(pp, "测试时钟拨到 12月1日，跑一次定时任务：8月24日的录音过了 90 天，删了");
  await setClock(request, "2026-12-01T10:00:00+08:00");
  const ran = await tickRetention(request);
  // (on a JOBS=1 server the hourly loop may have done it first: the outcome is checked below, not the count)
  expect(ran.scope_failed).toBe(0);
  await pp.reload();
  await expect(row1).toHaveAttribute("data-state", "deleted");
  await expect(row1).toContainText("录音 12月1日 已经删了；逐字稿和医生交代的事还在。");
  await expect(row2).toHaveAttribute("data-state", "kept_forever");
  await expect(row2.getByText("听录音")).toBeVisible();
  // the file itself is gone (the local driver answers 404, Supabase Storage 400 with not_found in the body)
  expect((await request.get(v1Link)).status()).toBeGreaterThanOrEqual(400);
  expect((await request.get(v2Link)).status()).toBe(200); // the kept one is still there
  const v1View = (await (await api.get(`/api/visits/${v1.id}`)).json()) as { view: { lines: unknown[]; visit: { audioPath: string | null } } };
  expect(v1View.view.visit.audioPath).toBeNull();
  expect(v1View.view.lines.length).toBeGreaterThan(5); // the transcript stays
  const v2View = (await (await api.get(`/api/visits/${v2.id}`)).json()) as { view: { visit: { audioPath: string | null } } };
  expect(v2View.view.visit.audioPath).toBe(v2.recording);
  await kit.show(row1);

  // ---- her look, his access log
  await kit.step(dp, "女儿 Wei Ling 在自己的手机上，看爸爸分享的吃药情况和量血压次数");
  await dp.reload(); // her page writes this look into his access log
  await expect(dp.getByTestId("family-app")).toBeVisible();
  expect((await daughter.context.request.get(`/api/family/view?link=${linkId}`)).status()).toBe(200);
  await kit.pause(800);

  await kit.step(pp, "陈先生在「家人什么时候看过」里，一条一条看到她看了哪几项、什么时候");
  await pp.goto("/p/me/export");
  await pp.locator('[data-entry="access"]').click();
  const looks = pp.getByTestId("access-row");
  // one look is a node of the line: who and when on its head line, what she looked at as its title
  await expect(looks.first()).toContainText("Wei Ling");
  await expect(looks.first()).toContainText("12月1日 早上 10:00");
  await expect(looks.first()).toContainText("看了你的吃药情况、量血压次数");
  expect(await looks.count()).toBeGreaterThanOrEqual(2); // and her first look, before the clock moved
  await kit.show(looks.first());

  // ---- 删除账号
  await kit.step(pp, "删除账号：先写清楚会删掉什么，女儿也马上看不到，删了不能恢复");
  await pp.goto("/p/me");
  await pp.locator('[data-entry="delete"]').click();
  await expect(pp.getByTestId("delete-step-what")).toBeVisible();
  await expect(pp.getByTestId("delete-items")).toContainText("家人的查看：Wei Ling 马上看不到你的资料");
  await expect(pp.getByTestId("delete-items")).toContainText("看诊录音");
  await expect(pp.getByTestId("delete-step-what")).toContainText("约 21 天");
  await kit.show(pp.getByTestId("delete-continue"));

  await kit.step(pp, "第二步输入密码确认：先删录音和照片、核对为空，再删账号和全部记录");
  await pp.getByTestId("delete-continue").click();
  await expect(pp.getByTestId("delete-step-password")).toBeVisible();
  await kit.type(pp.getByTestId("delete-password"), H_PASSWORD);
  await pp.getByTestId("delete-submit").click();
  await expect(pp.getByTestId("delete-done")).toBeVisible({ timeout: 20_000 });
  await expect(pp.getByTestId("delete-done")).toContainText("账号已经删除");
  expect((await api.get("/api/me")).status()).toBe(401);
  expect((await elder.context.cookies()).find((c) => c.name === "rp_at")).toBeUndefined();
  expect((await request.get(v2Link)).status()).toBeGreaterThanOrEqual(400); // storage first: even the recording he kept for good

  await kit.step(dp, "女儿这边刷新：爸爸的资料一项都看不到了，这个联系已经不在");
  await dp.reload();
  const herApp = dp.getByTestId("family-app");
  // track D's /f: 「这个联系已经结束。」 (gone) while she still follows someone else; with no link left at all it says
  // 「你还没有在看谁的 Ripple。」 (no_link). Either way nothing of his is on her screen.
  await expect(herApp).toHaveAttribute("data-state", /^(gone|no_link)$/);
  await expect(herApp).not.toContainText("这一周");
  const herView = await daughter.context.request.get(`/api/family/view?link=${linkId}`);
  expect(herView.status()).toBe(404);
  expect(await herView.json()).toMatchObject({ error: "link_not_found" });
  await kit.pause(2500);

  await kit.step(pp, "再用原来的账号登录：只说账号或密码不对，这个账号已经没有了");
  await pp.goto("/login");
  await kit.type(pp.getByTestId("login-login"), him.login);
  await pp.getByTestId("login-next").click();
  await kit.type(pp.getByTestId("login-password"), H_PASSWORD);
  await pp.getByTestId("login-submit").click();
  await expect(pp.getByTestId("login-error")).toHaveText("账号或密码不对。");

  await clearClock(request);
  await kit.finish();
});
