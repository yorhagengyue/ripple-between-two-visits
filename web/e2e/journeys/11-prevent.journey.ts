/**
 * 11 预防：筛查和疫苗 — on a real account (C2 track K; 老人端提示词 11; M10; e2e-chains 9).
 *
 *   10月12日 10:00 (developer test clock, frozen)   a new account with Mr Tan's example data (67; at his 9月8日 visit Dr Lim
 *                                                   said "Your blood pressure is high", confirmed in his review)
 *   「我」 → 预防   the next visit (today) and the questions waiting for it; first, what the doctor said about tests and
 *                 follow-ups at his last clinic visit (9月8日, 0:52); then the official tables' lines for his age, each in
 *                 our own words with the table, its version and the official page; cardiovascular screening says
 *                 「由你的医生跟进」 with Dr Lim's words; the NAIS caveat at the foot; never 你需要 / 你应该 / 你符合
 *   flu         「加进问题单，问医生」: one question for the doctor (origin preventive)
 *   FIT         「我做过了」: moves to 「已经做了的」 with today's date, 12 s 「撤销」 bar
 */
import { expect, journey } from "./_kit";
import { clearClock, newAccount, openPage, questions, setClock } from "./_k/account";

const FORBIDDEN = /你需要|你应该|你该|你符合|you need|you are due|you are eligible|you should/i;

journey("11 预防：筛查和疫苗", async ({ kit, request }) => {
  await setClock(request, "2026-10-12T10:00:00+08:00");
  const { elder } = await kit.phones({ elder: "陈先生的手机" });
  const pp = elder.page;
  await newAccount(elder, { space: "example" });
  const before = await questions(elder);
  await openPage(elder, "/p/me");

  const row = (id: string) => pp.locator(`[data-testid="prevent-row"][data-item="${id}"]`);

  await kit.step(pp, "陈先生（示例资料）在「我」里点「预防：筛查和疫苗」");
  const entry = pp.locator('[data-entry="prevent"]');
  await expect(entry).toContainText("预防：筛查和疫苗");
  await kit.show(entry);
  await entry.click();
  await pp.waitForURL(/\/p\/prevent$/);
  await expect(pp.getByTestId("prevent-screen")).toBeVisible();

  await kit.step(pp, "最上面：下次看诊就是今天，问题单里有几个问题等着问");
  const next = pp.getByTestId("prevent-next");
  await expect(next).toHaveAttribute("data-days", "0");
  await expect(next).toContainText("10月12日 · 今天");
  await expect(next).toContainText("要问的问题：");

  await kit.step(pp, "先列医生自己说的：9月8日看诊时说「一周量两次就够，五周后回来」（录音 0:52）");
  const dr = pp.locator('[data-testid="prevent-row"][data-kind="doctor"]');
  await expect(dr).toHaveCount(1);
  await expect(dr.locator('[data-rp="said"]')).toContainText("Keep measuring, twice a week is enough now. Come back in five weeks.");
  await expect(dr.locator('[data-rp="source-tag"]')).toContainText("9月8日 · 0:52");
  await kit.show(dr);

  await kit.step(pp, "再列官方表上按他的年龄写着的：流感疫苗，65 岁以上每年一剂，出处是国家成人免疫计划表 2026年4月1日版");
  const flu = row("C2-03");
  await expect(flu).toHaveAttribute("data-state", "listed");
  await expect(flu).toContainText("国家成人免疫计划表上写着：65 岁以上的成年人");
  await expect(flu.getByTestId("prevent-source")).toContainText("出处：国家成人免疫计划表（2026年4月1日版）");
  await kit.show(flu);

  await kit.step(pp, "肺炎球菌、带状疱疹疫苗，大肠癌筛查，乐龄功能检查：每条都是表上写着的，带出处");
  for (const id of ["C2-04", "C2-06", "C1-06", "C1-08"]) await expect(row(id)).toHaveAttribute("data-state", "listed");
  await expect(row("C1-04")).toHaveCount(0);
  await kit.show(row("C1-06"));

  await kit.step(pp, "心血管风险筛查：他已经被诊断高血压，这一条改成「由你的医生跟进」，下面是医生 9月8日 的原话");
  const cardio = row("C1-03");
  await expect(cardio).toHaveAttribute("data-state", "followed");
  await expect(cardio.getByTestId("prevent-followed")).toContainText("由你的医生跟进");
  await expect(cardio.getByTestId("prevent-followed")).toContainText("已经诊断有高血压、糖尿病或高胆固醇的人不做这项筛查");
  await expect(cardio.locator('[data-rp="said"]')).toContainText("Your blood pressure is high");
  await expect(row("C1-02")).toHaveCount(0);
  await kit.show(cardio);

  await kit.step(pp, "整页没有「你需要」「你应该」「你符合」：只说表上写着什么");
  expect(await pp.getByTestId("prevent-screen").innerText()).not.toMatch(FORBIDDEN);
  await kit.show(flu);

  await kit.step(pp, "他在流感疫苗下面点「加进问题单，问医生」");
  await flu.getByTestId("prevent-ask").click();
  await expect(flu.getByTestId("prevent-asked")).toContainText("已在下次看诊的问题单里");
  const added = (await questions(elder)).filter((q) => !before.some((b) => b.id === q.id));
  expect(added).toEqual([expect.objectContaining({ for: "doctor", origin: "preventive", text: "今年的流感疫苗适合我打吗？", status: "open" })]);

  await kit.step(pp, "大肠癌筛查他今年已经做过，点「我做过了」");
  await kit.show(row("C1-06"));
  await row("C1-06").getByTestId("prevent-done-btn").click();
  await expect(pp.getByTestId("undo-toast")).toContainText("已记下：我做过了");

  await kit.step(pp, "这一条挪到「已经做了的」，写着 10月12日 记的；记错了 12 秒内能撤销");
  const done = pp.locator('[data-testid="prevent-done"][data-item="C1-06"]');
  await expect(done).toContainText("10月12日 记的");
  await expect(row("C1-06")).toHaveCount(0);
  await kit.show(done);

  await kit.step(pp, "最后一句：每个人适合什么、能不能拿补贴，要看医生，出处是国家成人免疫计划表");
  const caveat = pp.getByTestId("prevent-caveat");
  await expect(caveat).toContainText("国家成人免疫计划表上写着：每个人适合什么、能不能拿补贴，要看医生。");
  await kit.show(caveat);

  await kit.step(pp, "问题单里多了他刚加的那一条");
  await openPage(elder, "/p/questions");
  const q = pp.getByText("今年的流感疫苗适合我打吗？").first();
  await expect(q).toBeVisible();
  await kit.show(q);

  await clearClock(request);
  await kit.finish();
});
