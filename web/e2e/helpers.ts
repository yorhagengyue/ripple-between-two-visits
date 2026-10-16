/**
 * Shared helpers for the M0 flows. Each "device" is its own browser context (own cookies), joined to a
 * session by the rp_session cookie, the same way a phone is after /join.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { CURRENT_CONSENT_VERSIONS } from "../lib/privacy/consent-texts";
import { CREW_COOKIE, crewCookieValue } from "../lib/session/crew-key";

/** Same port as playwright.config.ts: PW_PORT, default 3200. */
export const BASE_URL = `http://localhost:${Number(process.env.PW_PORT || 3200)}`;

export interface SessionInfo {
  id: string;
  join_code: string;
  story_day: number;
  story_time: string | null;
  filming_mode: boolean;
}

export async function createSession(
  request: APIRequestContext,
  body: Record<string, unknown> = {},
): Promise<SessionInfo> {
  const res = await request.post("/api/session", { data: body });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).session as SessionInfo;
}

export async function api(
  request: APIRequestContext,
  pathname: string,
  sessionId: string,
  body: Record<string, unknown> = {},
): Promise<unknown> {
  const sep = pathname.includes("?") ? "&" : "?";
  const res = await request.post(`${pathname}${sep}session=${sessionId}`, { data: body });
  expect(res.ok(), `${pathname}: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

export interface Device {
  context: BrowserContext;
  page: Page;
}

/** A new device (browser context) in the session, opened on `pathname`, with its event stream open. */
export async function openDevice(browser: Browser, sessionId: string, pathname: string): Promise<Device> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await context.addCookies([{ name: "rp_session", value: sessionId, url: BASE_URL }]);
  const page = await context.newPage();
  await page.goto(pathname);
  await waitLive(page);
  return { context, page };
}

/**
 * Wait until the page's Server-Sent Events stream is open, then make sure the page stays loaded.
 *
 * A `next dev` that has fallen into an HMR reload loop (Turbopack answers every subscribe with
 * "restart", then `reloadPage: HMR hash mismatch`, ~200 reloads in 8 s) still opens the stream for a
 * moment on each load, so later assertions would fail in confusing ways. Seen 10-09 with dev servers
 * launched from an agent's background shell; Playwright's own webServer did not loop.
 */
export async function waitLive(page: Page): Promise<void> {
  await expect(page.locator('[data-live="open"]').first()).toBeAttached({ timeout: 15_000 });
  await page.evaluate(() => {
    (window as unknown as { __rpStillHere?: boolean }).__rpStillHere = true;
  });
  await page.waitForTimeout(300);
  const stayed = await page
    .evaluate(() => (window as unknown as { __rpStillHere?: boolean }).__rpStillHere === true)
    .catch(() => false);
  if (!stayed) {
    throw new Error(
      `The page reloaded by itself right after loading: the dev server on ${BASE_URL} is in an HMR reload loop. ` +
        "Stop it and let Playwright start a fresh one (see web/PROGRESS.md, 10-09 M0 fixes).",
    );
  }
}

export async function closeAll(devices: Device[]): Promise<void> {
  await Promise.all(devices.map((d) => d.context.close()));
}

/**
 * `next dev` compiles each route on its first request. Hit every route the timed flows use once, so
 * the 1-second checks measure the sync, not the compiler.
 */
export async function warmUp(request: APIRequestContext): Promise<void> {
  const s = await createSession(request);
  for (const p of ["/", "/p/today", "/p/meds", "/f", "/backstage", "/director", "/join"]) {
    await request.get(p, { headers: { cookie: `rp_session=${s.id}` } });
  }
  await api(request, "/api/doses", s.id, { medication_id: "med-amlodipine", slot: "morning", state: "taken" });
  await api(request, "/api/clock", s.id, { day: 29 });
  await api(request, "/api/director/cue", s.id, { cue: "reminder" });
  await api(request, "/api/director/filming", s.id, { on: false });
  await api(request, "/api/session/reset", s.id);
  await request.get(`/api/doses?session=${s.id}`);
}

/**
 * Text on Mr Tan's and Wei Ling's phones that is exempt from the 18px body-text rule:
 * - source and kind labels (.rp-src, .rp-tag, .rp-kicker, .rp-count): the design rule calls them
 *   出处小标签 ("small source labels"); they keep the v3 sizes until the owner decides otherwise;
 * - developer chrome (jump menu, debug line): not part of the patient screen, and not rendered in
 *   filming mode.
 */
export const SMALL_TEXT_EXEMPT =
  ".rp-src, .rp-tag, .rp-kicker, .rp-count, [data-testid='jump-menu'], [data-testid='debug-info']";

export interface SmallText {
  text: string;
  px: number;
  where: string;
}

/**
 * Every piece of text the page actually renders (each non-empty text node with a visible box, plus
 * the value of text inputs) whose computed font size is below `minPx`. Text inside `exempt` is
 * skipped. Returns [] when everything is large enough; otherwise each offender names its element.
 */
export async function textBelow(page: Page, minPx: number, exempt: string = SMALL_TEXT_EXEMPT): Promise<SmallText[]> {
  return page.evaluate(
    ({ minPx, exempt }) => {
      const out: { text: string; px: number; where: string }[] = [];
      const describe = (el: Element): string => {
        const id = el.getAttribute("data-testid");
        const cls = (el.getAttribute("class") ?? "").trim().split(/\s+/).slice(0, 4).join(".");
        return `${el.tagName.toLowerCase()}${id ? `[data-testid=${id}]` : ""}${cls ? `.${cls}` : ""}`;
      };
      const visible = (el: Element): boolean => {
        const cs = getComputedStyle(el);
        return cs.visibility !== "hidden" && cs.opacity !== "0";
      };
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!text) continue;
        const el = node.parentElement;
        if (!el || el.closest("script, style, noscript, template, title")) continue;
        if (exempt && el.closest(exempt)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const boxes = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
        if (boxes.length === 0 || !visible(el)) continue;
        const px = parseFloat(getComputedStyle(el).fontSize);
        if (px < minPx) out.push({ text: text.slice(0, 40), px, where: describe(el) });
      }
      const fields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        "input:not([type=radio]):not([type=checkbox]):not([type=hidden]), textarea",
      );
      for (const field of Array.from(fields)) {
        if (exempt && field.closest(exempt)) continue;
        if (field.getClientRects().length === 0 || !visible(field)) continue;
        const px = parseFloat(getComputedStyle(field).fontSize);
        if (px < minPx) out.push({ text: field.value || field.placeholder || "(empty field)", px, where: describe(field) });
      }
      return out;
    },
    { minPx, exempt },
  );
}

/** Computed font size (px) of the first element matching the test id. */
export async function fontPx(page: Page, testId: string): Promise<number> {
  return page.getByTestId(testId).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
}

interface SeedDose {
  day: number;
  med: string;
  slot: string;
  state: string;
}

/** The template dose log, straight from web/fixtures/timeline.seed.json. */
export function seedDoses(): SeedDose[] {
  const file = path.join(__dirname, "..", "fixtures", "timeline.seed.json");
  return (JSON.parse(readFileSync(file, "utf8")) as { dose_log: SeedDose[] }).dose_log;
}

// ---------------------------------------------------------------------------------------------------------------
// Chain e2e helpers (e2e/chains/**, docs/plan/e2e-chains.md section 15 item 1). Added 10-10; nothing above changed.
// Every device in a chain joins the session with its join code and a role (a member row + rp_session, rp_member,
// rp_role), the way the phones do on the shoot: once Wei Ling has joined, a device with no row in his session is
// nobody (lib/family/identity.ts), so a chain never relies on a bare rp_session cookie.
// ---------------------------------------------------------------------------------------------------------------

export type JoinRole = "patient" | "family" | "backstage" | "director" | "judge";

/** The crew key the dev server accepts (lib/session/crew-key.ts): SCRIPTED_FALLBACK_KEY when set, else the dev key. */
export const CHAIN_CREW_KEY = process.env.SCRIPTED_FALLBACK_KEY || "dev-only-rehearsal-key";

const STAFF_ROLES: JoinRole[] = ["backstage", "director", "judge"];

export interface JoinOptions {
  /** rp_lang cookie: "en" or "zh-Hans" (default: the app's default, Mandarin) */
  lang?: "en" | "zh-Hans";
  viewport?: { width: number; height: number };
}

async function newDeviceContext(browser: Browser, opts: JoinOptions): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: BASE_URL, ...(opts.viewport ? { viewport: opts.viewport } : {}) });
  if (opts.lang) await context.addCookies([{ name: "rp_lang", value: opts.lang, url: BASE_URL }]);
  return context;
}

/**
 * A device that joins `code` as `role` (POST /api/session/join, what the /join form sends), then opens `pathname`
 * (default: the role's home page) with its event stream live. Staff devices carry the crew key header on the join
 * request: since 10-10 backstage and director join with the crew key only (lib/family/join.ts), a judge never joins
 * with a code, and a second "patient" is refused once his phone has joined.
 */
export async function joinAs(browser: Browser, code: string, role: JoinRole, pathname?: string, opts: JoinOptions = {}): Promise<Device> {
  const context = await newDeviceContext(browser, opts);
  const res = await context.request.post("/api/session/join", {
    data: { code, role },
    headers: STAFF_ROLES.includes(role) ? { "x-ripple-crew-key": CHAIN_CREW_KEY } : {},
  });
  expect(res.status(), `join as ${role}: ${await res.text()}`).toBe(200);
  const next = ((await res.json()) as { next: string }).next;
  const page = await context.newPage();
  await page.goto(pathname ?? next);
  await waitLive(page);
  return { context, page };
}

/** Each role's home page after /join (lib/session/ops.ts homeForRole). */
export const ROLE_HOME: Record<"patient" | "family" | "backstage" | "director", string> = {
  patient: "/p/today",
  family: "/f",
  backstage: "/backstage",
  director: "/director",
};

/**
 * A phone that joins through the /join page the way a person does: type the code, pick the role, tap the button;
 * the form sends the phone to its role's home page (/p/today for him, /f for her), whose event stream is then live.
 * (The form navigates as soon as the join answers, so the answer's body is not read here.)
 */
export async function joinThroughPage(
  browser: Browser,
  code: string,
  role: "patient" | "family" | "backstage" | "director",
  opts: JoinOptions = {},
): Promise<Device> {
  const context = await newDeviceContext(browser, opts);
  const page = await context.newPage();
  await page.goto("/join");
  await page.getByTestId("join-code-input").fill(code);
  await page.getByTestId(`join-role-${role}`).check();
  const joined = page.waitForResponse((r) => r.url().includes("/api/session/join") && r.request().method() === "POST");
  await page.getByTestId("join-submit").click();
  expect((await joined).status(), `join page as ${role}`).toBe(200);
  await page.waitForURL((u) => u.pathname === ROLE_HOME[role], { timeout: 15_000 });
  await waitLive(page);
  return { context, page };
}

/** Move the story clock (POST /api/clock) from `request`, the device that created the session (its judge row). */
export async function at(request: APIRequestContext, sessionId: string, day: number, time: string | null): Promise<void> {
  await api(request, "/api/clock", sessionId, { day, time });
}

/** A device's API context: a browser context's own request (its cookies) or an APIRequestContext as it is. */
function apiOf(device: Device | BrowserContext | APIRequestContext): APIRequestContext {
  if ("page" in device) return device.context.request;
  if ("newPage" in device) return device.request;
  return device;
}

export interface DoseRowSeen {
  medication_id: string;
  day: number;
  slot: string;
  state: string;
  reason: string | null;
  reason_text: string | null;
}

/** The dose_log rows from `fromDay` to `toDay` as the given device reads them (GET /api/doses). */
export async function doseRows(device: Device | BrowserContext | APIRequestContext, sessionId: string, fromDay: number, toDay = fromDay): Promise<DoseRowSeen[]> {
  const res = await apiOf(device).get(`/api/doses?session=${sessionId}&from=${fromDay}&to=${toDay}`);
  expect(res.status(), `GET /api/doses: ${await res.text()}`).toBe(200);
  return ((await res.json()) as { doses: DoseRowSeen[] }).doses;
}

/** GET a JSON API as the given device; asserts the status (default 200). */
export async function getJson<T = unknown>(device: Device | BrowserContext | APIRequestContext, pathname: string, sessionId: string, status = 200): Promise<T> {
  const sep = pathname.includes("?") ? "&" : "?";
  const res = await apiOf(device).get(`${pathname}${sep}session=${sessionId}`);
  expect(res.status(), `GET ${pathname}: ${(await res.text()).slice(0, 300)}`).toBe(status);
  return (await res.json()) as T;
}

/** Backstage rows (components/backstage/EventFeed.tsx), all or of one event type. */
export function eventRows(page: Page, type?: string) {
  return page.locator(type ? `[data-testid="event-row"][data-type="${type}"]` : '[data-testid="event-row"]');
}

/** The raw JSON of a backstage row (one tap on "raw"), parsed. */
export async function eventJson(row: ReturnType<Page["locator"]>): Promise<{ type: string; say: string; data: Record<string, unknown> }> {
  await row.getByTestId("event-raw").locator("summary").click();
  return JSON.parse((await row.getByTestId("event-raw-json").textContent()) ?? "{}");
}

export interface AskSeen {
  status: number;
  /** tap -> the asked line and its answer on screen (or the error line), ms */
  ms: number;
  // the AskResult (lib/safety/types.ts) as the phone received it; loosely typed on purpose
  body: {
    route?: string;
    sentences?: { sourceId: string; en: string; zh?: string; origin?: string }[];
    addedQuestionId?: string | null;
    questionReused?: boolean;
    llm?: { provider: string; calls: number };
    costLimited?: { limit: string };
    error?: string;
    limit?: string;
  } | null;
}

/**
 * He types `text` into Today's box (components/daily/AskBox.tsx) and taps send; resolves once the answer to THIS
 * sentence is on screen (or the error line shows), with the /api/ask response his phone received.
 */
export async function askOnPhone(page: Page, text: string): Promise<AskSeen> {
  await page.getByTestId("ask-input").fill(text);
  const answered = page.waitForResponse((r) => r.url().includes("/api/ask") && r.request().method() === "POST");
  const t0 = Date.now();
  await page.getByTestId("ask-send").click();
  const res = await answered;
  const status = res.status();
  const body = (await res.json().catch(() => null)) as AskSeen["body"];
  if (status === 200) {
    await expect(page.getByTestId("ask-asked")).toHaveText(`“${text}”`, { timeout: 4000 });
    await expect(page.getByTestId("ask-answer")).toHaveAttribute("data-complete", "true");
  } else {
    await expect(page.getByTestId("ask-error")).toBeVisible({ timeout: 4000 });
  }
  return { status, ms: Date.now() - t0, body };
}

/** A device's cookies as one Cookie header. */
export async function cookieHeader(device: Device | BrowserContext | APIRequestContext): Promise<string> {
  const list = "page" in device ? await device.context.cookies() : "newPage" in device ? await device.cookies() : (await device.storageState()).cookies;
  return list.map((c) => `${c.name}=${c.value}`).join("; ");
}

/**
 * The raw event stream (GET /api/events) with a device's cookies: the same bytes that device's EventSource gets.
 * `text()` is everything received so far; `stop()` closes it.
 */
export async function openEventStream(device: Device | BrowserContext | APIRequestContext, sessionId: string): Promise<{ status: number; text(): string; stop(): void }> {
  const cookie = await cookieHeader(device);
  const ctrl = new AbortController();
  const res = await fetch(`${BASE_URL}/api/events?session=${encodeURIComponent(sessionId)}`, { headers: { cookie, accept: "text/event-stream" }, signal: ctrl.signal });
  let text = "";
  if (res.body) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          text += dec.decode(value, { stream: true });
        }
      } catch {
        // stopped
      }
    })();
  }
  return { status: res.status, text: () => text, stop: () => ctrl.abort() };
}

// ---------------------------------------------------------------- C2 track A: real accounts (sign-up, log-in, log-out)
//
// Through the real account routes (lib/auth/api.ts), not the developer helper: the rate limits, the consent records and
// the recovery code are the real ones. The cookies land in the given browser context (or request context), so its
// pages are signed in afterwards. For a quick account that skips all that, POST /api/dev/accounts instead.

/** A browser context, a request context, or a Device: who makes the call (and keeps the cookies). */
export type AccountCaller = BrowserContext | APIRequestContext | Device;

function accountRequest(caller: AccountCaller): APIRequestContext {
  if ("page" in caller) return caller.context.request;
  if ("newPage" in caller) return caller.request;
  return caller;
}

export interface SignUpOptions {
  /** a username ("chen.tan") or an e-mail address */
  login: string;
  password: string;
  displayName?: string;
  locale?: "zh-Hans" | "en";
  /** someone in the family taps for him (his consents are recorded with assisted = true) */
  assisted?: boolean;
  /** his AI-processing decision (default granted) */
  ai?: "granted" | "declined";
  /** default "blank" (he lands on /onboard); "example" lays out Mr Tan's example on today's dates; "none": a family member with no space of her own (lands on /f) */
  space?: "blank" | "example" | "none";
}

/** Sign up through POST /api/auth/signup with the current consent texts; the caller is signed in afterwards. */
export async function signUp(caller: AccountCaller, opts: SignUpOptions): Promise<{ next: string; recoveryCode: string; login: string }> {
  const space = opts.space ?? "blank";
  const res = await accountRequest(caller).post("/api/auth/signup", {
    data: {
      login: opts.login,
      password: opts.password,
      display_name: opts.displayName ?? "陈先生",
      locale: opts.locale ?? "zh-Hans",
      assisted: opts.assisted ?? false,
      consents: {
        terms_privacy: { version: CURRENT_CONSENT_VERSIONS.terms_privacy },
        ai_processing: { decision: opts.ai ?? "granted", version: CURRENT_CONSENT_VERSIONS.ai_processing },
        ...(space === "example" ? { example_data: { version: CURRENT_CONSENT_VERSIONS.example_data } } : {}),
      },
      space,
    },
  });
  expect(res.status(), `sign up ${opts.login}: ${await res.text()}`).toBe(201);
  const body = (await res.json()) as { next: string; recovery_code: string; login: string };
  return { next: body.next, recoveryCode: body.recovery_code, login: body.login };
}

/** Log in through POST /api/auth/login; the caller is signed in afterwards. Expects success unless `status` says otherwise. */
export async function logIn(
  caller: AccountCaller,
  opts: { login: string; password: string; notMyPhone?: boolean; next?: string; status?: number },
): Promise<{ status: number; body: { next?: string; error?: string; until?: string } }> {
  const res = await accountRequest(caller).post("/api/auth/login", {
    data: { login: opts.login, password: opts.password, not_my_phone: opts.notMyPhone ?? false, ...(opts.next ? { next: opts.next } : {}) },
  });
  const body = (await res.json().catch(() => ({}))) as { next?: string; error?: string; until?: string };
  expect(res.status(), `log in ${opts.login}: ${JSON.stringify(body)}`).toBe(opts.status ?? 200);
  return { status: res.status(), body };
}

/** Log out through POST /api/auth/logout (this device, or every device with `everywhere`). */
export async function logOut(caller: AccountCaller, opts: { everywhere?: boolean } = {}): Promise<void> {
  const res = await accountRequest(caller).post("/api/auth/logout", { data: { everywhere: opts.everywhere ?? false } });
  expect(res.status(), `log out: ${await res.text()}`).toBe(200);
}

// ---------------------------------------------------------------- C2 track E: the demo fence (lib/crew/gate.ts)
//
// The crew's pages (/director, /backstage, /backstage/real, /join), the story clock and the director's routes (/api/clock,
// /api/director/*, /api/session/reset, a filming POST /api/session, /api/visits/[id]/scripted, /api/real/*) answer 404 to
// anyone without the film crew's cookie or key; the jump menu and debug line on a demo phone need the crew's cookie.
// A spec plays the crew with these: the header for its `request` fixture (test.use({ extraHTTPHeaders: CREW_HEADERS })),
// the rp_crew cookie for a browser context (withCrew), or a crew device (openCrewDevice, joinThroughPageAsCrew).

/** The judges' split page (it was "/" until C2; "/" redirects there until the front door is switched to the app). */
export const DEMO_ROOT = "/demo";

/** The crew key as a request header (what lib/crew/gate.ts accepts besides the cookie). */
export const CREW_HEADERS: Record<string, string> = { "x-ripple-crew-key": CHAIN_CREW_KEY };

/** The rp_crew cookie of the crew key: what /backstage/crew leaves on the crew's browser (a sha256, never the key). */
export function crewCookie(): { name: string; value: string; url: string } {
  return { name: CREW_COOKIE, value: crewCookieValue(CHAIN_CREW_KEY), url: BASE_URL };
}

/** Make a browser context the film crew's (the rp_crew cookie). Returns the same context. */
export async function withCrew(context: BrowserContext): Promise<BrowserContext> {
  await context.addCookies([crewCookie()]);
  return context;
}

/** openDevice as the crew: a device in the session that may open /director, /backstage, and shows the jump menu. */
export async function openCrewDevice(browser: Browser, sessionId: string, pathname: string): Promise<Device> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await context.addCookies([{ name: "rp_session", value: sessionId, url: BASE_URL }, crewCookie()]);
  const page = await context.newPage();
  await page.goto(pathname);
  await waitLive(page);
  return { context, page };
}

/** joinThroughPage as the crew's phone: the /join page is the crew's (a phone signs in at /backstage/crew first). */
export async function joinThroughPageAsCrew(
  browser: Browser,
  code: string,
  role: "patient" | "family" | "backstage" | "director",
  opts: JoinOptions = {},
): Promise<Device> {
  const context = await browser.newContext({ baseURL: BASE_URL, ...(opts.viewport ? { viewport: opts.viewport } : {}) });
  await context.addCookies([crewCookie(), ...(opts.lang ? [{ name: "rp_lang", value: opts.lang, url: BASE_URL }] : [])]);
  const page = await context.newPage();
  await page.goto("/join");
  await page.getByTestId("join-code-input").fill(code);
  await page.getByTestId(`join-role-${role}`).check();
  const joined = page.waitForResponse((r) => r.url().includes("/api/session/join") && r.request().method() === "POST");
  await page.getByTestId("join-submit").click();
  expect((await joined).status(), `join page as ${role}`).toBe(200);
  await page.waitForURL((u) => u.pathname === ROLE_HOME[role], { timeout: 15_000 });
  await waitLive(page);
  return { context, page };
}
