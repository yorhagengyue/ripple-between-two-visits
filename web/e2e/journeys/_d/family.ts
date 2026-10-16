/**
 * Helpers for track D's journeys (16-20: Wei Ling's side): the developer test clock and job tick, test accounts made
 * on a phone itself (the foundation's POST /api/dev/accounts signs that phone in), a family link made through the real
 * routes (invite, accept, confirm), and reads of her view. Nothing here is recorded by itself: call these before the
 * first kit.step, or between steps where the caption says what happens.
 */
import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import type { Phone } from "../_kit";

export const TEST_PASSWORD = "a long test password";

/** Launch options for a journey where her phone records: the config's own args, the fake microphone playing `wav`. */
export function fakeMicLaunch(wav: string) {
  return {
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--force-device-scale-factor=2",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${wav}`,
    ],
  };
}

/** Set the app's developer test clock (process-wide on that server), frozen there unless `frozen` is false. */
export async function setClock(request: APIRequestContext, at: string, opts: { frozen?: boolean } = {}): Promise<void> {
  const res = await request.post("/api/dev/clock", { data: { at, frozen: opts.frozen ?? true } });
  expect(res.status(), `dev clock: ${await res.text()}`).toBe(200);
}

export async function clearClock(request: APIRequestContext): Promise<void> {
  await request.post("/api/dev/clock", { data: { clear: true } });
}

/**
 * Run track B's medicine job once (lib/daily/dose-run.ts: the reminders, settling "no reply", her alert). Only that
 * job: the others (privacy retention and orphans among them) have nothing to do with these journeys and would run
 * under the frozen test clock.
 */
export async function tick(request: APIRequestContext): Promise<Record<string, unknown>> {
  const res = await request.post("/api/dev/tick", { data: { names: ["daily.doses"] } });
  expect(res.status(), `dev tick: ${await res.text()}`).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

/** A test account signed in on this phone: his (blank or Mr Tan's example data) or hers (no space). */
export async function newAccount(
  who: Phone | BrowserContext,
  opts: { space: "blank" | "example" | "none"; displayName: string; prefix?: string },
): Promise<{ userId: string; login: string }> {
  const context = "context" in who ? who.context : who;
  const login = `${opts.prefix ?? "d"}${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const res = await context.request.post("/api/dev/accounts", { data: { login, password: TEST_PASSWORD, space: opts.space, display_name: opts.displayName, locale: "zh-Hans" } });
  expect(res.status(), `dev account: ${await res.text()}`).toBe(201);
  const body = (await res.json()) as { user_id: string; login: string };
  return { userId: body.user_id, login: body.login };
}

async function postJson(context: BrowserContext, path: string, data: unknown): Promise<Record<string, unknown>> {
  const res = await context.request.post(path, { data });
  expect(res.ok(), `${path}: ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as Record<string, unknown>;
}

/** His invitation, her acceptance, his confirmation, through the real routes: the active link's id. */
export async function linkFamily(him: BrowserContext, her: BrowserContext, opts: { label?: string; calls?: string } = {}): Promise<string> {
  const made = await postJson(him, "/api/family/invites", { family_label: opts.label ?? "Wei Ling", relation: "daughter", patient_label: opts.calls ?? "爸爸" });
  const token = String(made.path).replace(/^\/invite\//, "");
  const linkId = (made.link as { id: string }).id;
  await postJson(her, "/api/family/invites/accept", { token });
  await postJson(him, `/api/family/links/${linkId}/confirm`, { yes: true });
  return linkId;
}

/** His switches for her link (through his own route). */
export async function setSwitches(him: BrowserContext, linkId: string, items: Record<string, boolean>): Promise<void> {
  await postJson(him, `/api/family/links/${linkId}/grants`, { items });
}

/** Her view through her link, as the server sends it (the raw text too, for what must never be in it). */
export async function herView(her: BrowserContext, linkId: string): Promise<{ status: number; text: string; body: Record<string, unknown> }> {
  const res = await her.request.get(`/api/family/view?link=${encodeURIComponent(linkId)}`);
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // not JSON
  }
  return { status: res.status(), text, body };
}

/** Mark a page: from now on, `window.__rpSeen[name]` is the time (Date.now() in that page) `selector` first appears. */
export async function watchFor(page: Page, name: string, selector: string): Promise<void> {
  await page.evaluate(
    ({ name, selector }) => {
      const w = window as unknown as { __rpSeen?: Record<string, number> };
      w.__rpSeen ??= {};
      const seen = w.__rpSeen;
      delete seen[name];
      const check = () => {
        if (seen[name] === undefined && document.querySelector(selector)) seen[name] = Date.now();
      };
      check();
      const obs = new MutationObserver(check);
      obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
    },
    { name, selector },
  );
}

/** Mark a page: `window.__rpTapped[name]` is the time of the next click on an element matching `selector`. */
export async function watchTap(page: Page, name: string, selector: string): Promise<void> {
  await page.evaluate(
    ({ name, selector }) => {
      const w = window as unknown as { __rpTapped?: Record<string, number> };
      w.__rpTapped ??= {};
      const tapped = w.__rpTapped;
      delete tapped[name];
      document.addEventListener(
        "click",
        (e) => {
          if (tapped[name] === undefined && (e.target as Element | null)?.closest(selector)) tapped[name] = Date.now();
        },
        true,
      );
    },
    { name, selector },
  );
}

export async function seenAt(page: Page, name: string): Promise<number> {
  await expect.poll(async () => page.evaluate((n) => (window as unknown as { __rpSeen?: Record<string, number> }).__rpSeen?.[n] ?? null, name), { timeout: 10_000 }).not.toBeNull();
  return page.evaluate((n) => (window as unknown as { __rpSeen: Record<string, number> }).__rpSeen[n], name);
}

export async function tappedAt(page: Page, name: string): Promise<number> {
  await expect.poll(async () => page.evaluate((n) => (window as unknown as { __rpTapped?: Record<string, number> }).__rpTapped?.[n] ?? null, name), { timeout: 10_000 }).not.toBeNull();
  return page.evaluate((n) => (window as unknown as { __rpTapped: Record<string, number> }).__rpTapped[n], name);
}
