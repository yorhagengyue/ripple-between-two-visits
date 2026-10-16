/**
 * The people of the two whole-line journeys of track G (23 blank, 24 example): both sign up through the app's real
 * pages (never POST /api/dev/accounts), with login names that cannot collide on a server that keeps its accounts, and
 * are deleted at the end through the app's own route.
 *
 *   newLoginName(prefix)        a username from the time and random digits, within lib/auth/login-name.ts
 *   signUpThroughPages(...)     /signup, one screen a step, to the recovery code; the space is a parameter
 *   userIdOf(context)           the signed-in person's user id (the `sub` of the rp_at cookie's JWT), for the leak watch
 *                               only: never print it
 *   me(context)                 GET /api/me with that phone's cookies
 *   deleteAccount(context, pw)  POST /api/me/delete { password, confirm: true }; then the sign-in is gone (401)
 *   getJson(context, path)      GET one of the person's own APIs (200 expected)
 */
import { expect, type BrowserContext, type Page } from "@playwright/test";
import type { Journey, Phone } from "../_kit";

/** Passwords of the two people (not common, 8+ characters; lib/auth/passwords.ts). */
export const HIS_PASSWORD = "plum blossom tea";
export const HER_PASSWORD = "jasmine tea 88";

const RECOVERY_CODE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

/** "tan" -> "tanmgl3k2a94821": lower case letters and digits, 3 to 32 characters, new on every call. */
export function newLoginName(prefix: string): string {
  const name = `${prefix}${Date.now().toString(36)}${Math.floor(1000 + Math.random() * 9000)}`.toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(name)) throw new Error(`not a username: ${name}`);
  return name;
}

export interface SignUpOptions {
  /** how the app addresses him: 「陈先生」 */
  name: string;
  login: string;
  password: string;
  /** 「从空白开始」 or Mr Tan's example data */
  space: "blank" | "example";
  /** who is tapping (default himself: both consents are then his own, assisted = false) */
  helper?: "self" | "family";
  /** called at the end of every step (the leak watch looks at the page as it stands) */
  afterStep?: (page: Page) => Promise<void>;
}

export interface SignedUp {
  /** the recovery code as the screen showed it, once */
  recoveryCode: string;
}

/**
 * Sign-up on this phone, from the first screen of /signup (the caller came from the welcome page's 「注册」) to
 * 「我记下了」 on the recovery code: language, name, account, password, who is tapping, the terms, AI processing (agreed),
 * where to start. One caption a screen. Afterwards the app sends him on by itself: a blank space to setting up
 * (/onboard), the example to Today.
 */
export async function signUpThroughPages(kit: Journey, phone: Phone, opts: SignUpOptions): Promise<SignedUp> {
  const page = phone.page;
  const after = async () => {
    await opts.afterStep?.(page);
  };
  const next = page.getByTestId("signup-next");

  await kit.step(page, "注册一屏一件事：先选语言，他选华语");
  await expect(page.getByTestId("signup-step-lang")).toBeVisible();
  await expect(page.getByTestId("signup-step-lang")).toContainText("第 1 步，共 9 步");
  await page.locator('[data-choice="zh-Hans"]').click();
  await expect(page.locator('[data-choice="zh-Hans"]')).toHaveAttribute("aria-checked", "true");
  await after();
  await next.click();

  await kit.step(page, `怎么称呼他：他在这一屏写「${opts.name}」`);
  await expect(page.getByTestId("signup-step-name")).toBeVisible();
  await kit.type(page.getByTestId("signup-name"), opts.name);
  await after();
  await next.click();

  await kit.step(page, "账号用一个用户名就行，不用邮箱");
  await expect(page.getByTestId("signup-step-account")).toBeVisible();
  await kit.type(page.getByTestId("signup-login"), opts.login);
  await after();
  await next.click();

  await kit.step(page, "密码这一屏：设一个自己记得住的密码");
  await expect(page.getByTestId("signup-step-password")).toBeVisible();
  await kit.type(page.getByTestId("signup-password"), opts.password);
  await after();
  await next.click();

  const helper = opts.helper ?? "self";
  await kit.step(page, helper === "self" ? "谁在操作：他自己，选「我自己」" : "家人在旁边帮忙，选「家人帮我操作」");
  await expect(page.getByTestId("signup-step-helper")).toBeVisible();
  await page.locator(`[data-choice="${helper}"]`).click();
  await expect(page.locator(`[data-choice="${helper}"]`)).toHaveAttribute("aria-checked", "true");
  await after();
  await next.click();

  await kit.step(page, "第一项同意：条款写明资料存在哪里、录音留多久，他点同意");
  await expect(page.getByTestId("signup-step-terms")).toBeVisible();
  await expect(page.getByTestId("signup-terms-text")).toContainText("东京");
  await expect(page.getByTestId("signup-terms-text")).toContainText("90 天");
  await after();
  await kit.show(page.getByTestId("signup-agree"));
  await page.getByTestId("signup-agree").click();

  await kit.step(page, "第二项同意：AI 处理，不同意也能用，他点同意");
  await expect(page.getByTestId("signup-step-ai")).toBeVisible();
  await expect(page.getByTestId("signup-ai-text")).toContainText("DeepSeek");
  await expect(page.getByTestId("signup-ai-decline")).toHaveText("不同意，也继续用");
  await after();
  await kit.show(page.getByTestId("signup-ai-agree"));
  await page.getByTestId("signup-ai-agree").click();

  await kit.step(page, opts.space === "blank" ? "从哪里开始：他选「从空白开始」，用自己的资料" : "从哪里开始：选陈先生的示例资料，按今天的日期铺好");
  await expect(page.getByTestId("signup-step-space")).toBeVisible();
  await page.locator(`[data-choice="${opts.space}"]`).click();
  await expect(page.locator(`[data-choice="${opts.space}"]`)).toHaveAttribute("aria-checked", "true");
  await after();
  await next.click();

  await kit.step(page, "账号建好了：恢复码只显示这一次，他抄下来");
  await expect(page.getByTestId("signup-step-code")).toBeVisible({ timeout: 20_000 });
  const recoveryCode = (await page.getByTestId("recovery-code").innerText()).trim();
  expect(recoveryCode).toMatch(RECOVERY_CODE);
  await after();
  await page.getByTestId("signup-kept").click();
  return { recoveryCode };
}

/** The `sub` of the rp_at cookie's JWT on this phone: the signed-in person's user id. For the leak watch; never print it. */
export async function userIdOf(context: BrowserContext): Promise<string> {
  const token = (await context.cookies()).find((c) => c.name === "rp_at")?.value ?? "";
  const payload = token.split(".")[1] ?? "";
  let sub: unknown;
  try {
    sub = (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: unknown }).sub;
  } catch {
    sub = undefined;
  }
  expect(typeof sub === "string" && /^[0-9a-f-]{36}$/i.test(sub), "the rp_at cookie carries the person's user id").toBe(true);
  return sub as string;
}

/** GET /api/me with this phone's cookies. */
export async function me(context: BrowserContext): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await context.request.get("/api/me");
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/** GET one of the person's own APIs with this phone's cookies. */
export async function getJson<T>(context: BrowserContext, pathname: string): Promise<T> {
  const res = await context.request.get(pathname);
  expect(res.status(), `${pathname}: ${await res.text()}`).toBe(200);
  return (await res.json()) as T;
}

/**
 * Delete the account signed in on this phone through the app's own route, and check that its sign-in is gone. Off
 * screen, at the very end of a journey: on a memory server it only tidies up, on a real database it is required.
 */
export async function deleteAccount(context: BrowserContext, password: string): Promise<void> {
  const res = await context.request.post("/api/me/delete", { data: { password, confirm: true } });
  expect(res.status(), `delete account: ${await res.text()}`).toBe(200);
  expect((await me(context)).status, "the deleted account's sign-in is gone").toBe(401);
}
