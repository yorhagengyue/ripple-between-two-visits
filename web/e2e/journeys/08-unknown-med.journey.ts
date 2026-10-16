/**
 * 08 认不出的药 — on a real account (C2 track F; e2e-chains chain 6, real-app 12).
 *
 *   10月12日 19:30 (developer test clock, frozen)  a new blank account, his phone only
 *   /p/meds/add    亲戚带的 → 拍药袋: a fixture photo of the relative's box (printed only in Chinese, with dosing that must
 *                  never be relayed); he checks the one line read (the name)
 *   not identified the fixed sentence (lib/safety's, word for word, with the template's Chinese line, still marked draft
 *                  there), nothing about what it is or how to take it; his question for the pharmacist is on the list
 *   again          the same box photographed a second time: the same sentence, still one medicine, still one question
 *   card           his own choices: 「没在吃」, then 「带去给医生看」, which puts his question for the doctor on the list
 *                  in the same tap; the list shows the box as 带去给医生看
 */
import path from "node:path";
import { expect, journey } from "./_kit";
import { clearClock, getJson, newAccount, openPage, setClock } from "./_f/account";

const BOX = path.join(__dirname, "..", "..", "fixtures", "labels", "relative_box.png");
const FIXED = "I'm not able to identify that medication, please check with your pharmacist.";
const NEVER = "一次六粒，一日三次";

// the developer test clock is one per server: the journey that runs next there must not find this one's frozen day
journey.afterAll(async ({ request }) => {
  await clearClock(request);
});

journey("08 认不出的药", async ({ kit, request }) => {
  await setClock(request, "2026-10-12T19:30:00+08:00");
  const { elder } = await kit.phones({ elder: "陈先生的手机" });
  const pp = elder.page;
  await newAccount(elder, { space: "blank" });
  await openPage(elder, "/p/meds");

  await kit.step(pp, "亲戚从中国带了一盒降压药给陈先生。他打开「我的药」，点「拍药袋」");
  await expect(pp.getByTestId("meds-list")).toHaveAttribute("data-count", "0");
  await pp.getByTestId("meds-photo").click();

  await kit.step(pp, "先说这盒药从哪来：亲戚带的");
  await pp.getByTestId("add-origin-relative").click();
  await expect(pp.getByTestId("add-how")).toBeVisible();
  await pp.getByTestId("add-how-photo").click();

  await kit.step(pp, "用手机相机拍下药盒，Ripple 读出盒子上的名字");
  await pp.getByTestId("add-file").setInputFiles(BOX);
  const value = pp.getByTestId("add-check-value");
  await expect(value).toHaveAttribute("data-field", "drug_text", { timeout: 20_000 });
  await expect(value).toContainText("宁和平压丸");
  await expect(pp.getByTestId("add-check")).toHaveAttribute("data-total", "1");
  await expect(pp.locator("body")).not.toContainText(NEVER);

  await kit.step(pp, "名字和盒子上一样，他点「对」");
  await pp.getByTestId("add-line-right").click();
  const unknown = pp.getByTestId("add-unknown");
  await expect(unknown).toBeVisible({ timeout: 20_000 });

  await kit.step(pp, "认不出这盒药：只说一句固定的话，不猜是什么药、不教怎么吃；问题单加了一条问药剂师");
  await expect(pp.getByTestId("add-unknown-sentence")).toHaveText(new RegExp(FIXED.replace(/[.?]/g, "\\$&")));
  await expect(unknown).toContainText("宁和平压丸");
  await expect(pp.getByTestId("add-unknown-on-list")).toContainText("问药剂师");
  await expect(pp.locator("body")).not.toContainText(NEVER);
  const medId = (await unknown.getAttribute("data-med"))!;

  await kit.step(pp, "过几天他又拍了一次同一盒：还是同一个药，不会多出一条，问题也只有一条");
  await openPage(elder, "/p/meds/add");
  await pp.getByTestId("add-origin-relative").click();
  await pp.getByTestId("add-how-photo").click();
  await pp.getByTestId("add-file").setInputFiles(BOX);
  await expect(value).toContainText("宁和平压丸", { timeout: 20_000 });
  await pp.getByTestId("add-line-right").click();
  await expect(unknown).toHaveAttribute("data-med", medId, { timeout: 20_000 });
  await expect(pp.getByTestId("add-unknown-sentence")).toHaveText(new RegExp(FIXED.replace(/[.?]/g, "\\$&")));
  await expect(pp.getByTestId("add-unknown-on-list")).toBeVisible();
  const meds = (await getJson<{ groups: { items: { id: string; status: string }[] }[] }>(elder, "/api/meds")).groups.flatMap((g) => g.items);
  expect(meds.filter((m) => m.status === "unidentified").map((m) => m.id)).toEqual([medId]);
  const asked = JSON.stringify(await getJson<unknown>(elder, "/api/questions"));
  expect(asked.match(/宁和平压丸/g)?.length).toBe(1);
  await kit.pause(1500);

  await kit.step(pp, "打开药卡。这盒药怎么办由他自己选：先点「没在吃」");
  await pp.getByTestId("add-open-card").click();
  const choices = pp.getByTestId("card-unknown-choices");
  await expect(choices).toHaveAttribute("data-status", "none");
  await expect(pp.getByTestId("med-unknown-sentence")).toContainText(FIXED);
  await kit.show(choices);
  await pp.getByTestId("unknown-not-taking").click();
  await expect(choices).toHaveAttribute("data-status", "not_taking");
  await expect(pp.getByTestId("unknown-on-list")).toHaveCount(0);
  await kit.pause(1000);

  await kit.step(pp, "下次复诊想问医生：点「带去给医生看」，一下子就加进了问医生的问题单");
  await pp.getByTestId("unknown-bring").click();
  await expect(choices).toHaveAttribute("data-status", "bring_to_doctor");
  await expect(pp.getByTestId("unknown-on-list")).toContainText("已在下次看诊的问题单里");
  const list = JSON.stringify(await getJson<unknown>(elder, "/api/questions"));
  expect(list).toContain("我带了这盒药给医生看：「宁和平压丸」。可以吃吗？");
  await kit.show(choices);
  await kit.pause(1200);

  await kit.step(pp, "回到「我的药」：这盒药标着「带去给医生看」");
  await openPage(elder, "/p/meds");
  const row = pp.getByTestId(`med-row-${medId}`);
  await expect(row).toHaveAttribute("data-status", "unidentified");
  await expect(row).toContainText("带去给医生看");
  await expect(row).toContainText("宁和平压丸");
  await kit.finish();
});
