/**
 * Scripted fallback (filming only, web-app.md section 8: "评委的在线链接上关掉剧本兜底") and the demo fence (M8 gating,
 * C2 track E: lib/crew/gate.ts):
 *   1. judge sandbox: the switch is not on the visit screen; without the crew the switch does not exist (404), and
 *      even with the crew key a sandbox refuses it (fallback_filming_only); filming mode is the crew's, and a sandbox the
 *      crew switched to filming mode stays a sandbox;
 *   2. the judge's own path: on /demo there is no Director link, the crew's pages answer 404, a filming session and
 *      filming mode are refused without the crew key, and the fallback stays unavailable (no switch, no unlock field,
 *      the API refuses). One gate (C2 follow-up): a guessed key gets the same 404 as no key, on every crew-only route;
 *   3. the crew (a filming session created with the crew key, /p/visit?crew=1): a phone that is not the crew's yet has the
 *      key field, which is the crew's sign-in door (a wrong key is said there, and nowhere else); with the right key the
 *      switch is there, works both ways (the door left the crew's cookie on the phone), and a misheard sentence is shown
 *      as the script line, marked on the phone and on backstage.
 */
import { expect, test } from "@playwright/test";
import { DEV_ONLY_CREW_KEY } from "../lib/visit/crew";
import { api, BASE_URL, closeAll, CREW_HEADERS, createSession, DEMO_ROOT, openCrewDevice, openDevice, waitLive } from "./helpers";

/** The crew key the dev server accepts: SCRIPTED_FALLBACK_KEY when the run sets it, else the dev-only default. */
const CREW_KEY = process.env.SCRIPTED_FALLBACK_KEY || DEV_ONLY_CREW_KEY;

test("judge sandbox: no fallback switch; without the crew the API has no switch, with the crew key a sandbox still refuses it", async ({ browser, request }) => {
  const s = await createSession(request); // judge sandbox
  const phone = await openDevice(browser, s.id, "/p/visit?replay=v1&speed=20&crew=1");
  await expect(phone.page.getByTestId("visit-screen")).toBeVisible();
  // Day 29: the first visit already happened, so this is a re-watch in a copy (C2); its lines carry the copy's id
  const copy = (await phone.page.getByTestId("visit-screen").getAttribute("data-visit"))!;
  expect(copy).toMatch(/^v1-again-/);
  await expect(phone.page.getByTestId(`line-${copy}-v1-u02`)).toBeVisible({ timeout: 20_000 });
  await expect(phone.page.getByTestId("fallback-toggle")).toHaveCount(0);
  await expect(phone.page.getByTestId("fallback-unlock")).toHaveCount(0);
  const res = await request.post(`/api/visits/v1/scripted?session=${s.id}`, { data: { on: true } });
  expect(res.status()).toBe(404);
  expect((await res.json()).error).toBe("not_found");
  for (const [what, opts] of [
    ["the key in the body", { data: { on: true, key: CREW_KEY } }],
    ["the crew header", { data: { on: true }, headers: CREW_HEADERS }],
  ] as const) {
    const keyed = await request.post(`/api/visits/v1/scripted?session=${s.id}`, opts);
    expect(keyed.status(), what).toBe(403);
    expect((await keyed.json()).error, what).toBe("fallback_filming_only");
  }
  const viaExtract = await request.post(`/api/visits/v1/extract?session=${s.id}`, {
    data: { utterances: [{ t_start_ms: 90000, t_end_ms: 91000, text: "hello" }], fallback: true },
  });
  // the extract flag is the crew's switch too: 404 without the crew, and a sandbox refuses it with the crew
  expect(viaExtract.status()).toBe(404);
  const viaExtractCrew = await request.post(`/api/visits/v1/extract?session=${s.id}`, {
    data: { utterances: [{ t_start_ms: 92000, t_end_ms: 93000, text: "hello" }], fallback: true },
    headers: CREW_HEADERS,
  });
  expect(viaExtractCrew.status()).toBe(403);
  expect((await viaExtractCrew.json()).error).toBe("fallback_filming_only");
  // filming mode is the crew's (404 without it); even with filming mode switched on, a sandbox stays a sandbox
  const noKey = await request.post(`/api/director/filming?session=${s.id}`, { data: { on: true } });
  expect(noKey.status()).toBe(404);
  expect((await noKey.json()).error).toBe("not_found");
  await api(request, "/api/director/filming", s.id, { on: true, crew_key: CREW_KEY });
  await phone.page.reload();
  await expect(phone.page.getByTestId("visit-screen")).toBeVisible();
  await expect(phone.page.getByTestId("fallback-toggle")).toHaveCount(0);
  expect((await request.post(`/api/visits/v1/scripted?session=${s.id}`, { data: { on: true }, headers: CREW_HEADERS })).status()).toBe(403);
  await closeAll([phone]);
});

test("the judge's path: /demo has no crew tools, the crew's pages are 404, filming is refused without the key; the fallback stays unavailable", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  // a judge opens the link: the demo page creates their own sandbox
  await page.goto(DEMO_ROOT);
  await expect.poll(async () => (await context.cookies()).find((c) => c.name === "rp_session")?.value ?? null, { timeout: 30_000 }).not.toBeNull();
  const sandbox = (await context.cookies()).find((c) => c.name === "rp_session")!.value;
  await expect(page.getByTestId("hero-button")).toBeVisible({ timeout: 30_000 });

  // no way to the director: no link, no story clock, and the crew's pages answer as if they did not exist
  await expect(page.getByTestId("staff-nav")).toHaveAttribute("data-crew", "false");
  await expect(page.getByRole("link", { name: "Director", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Backstage", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("landing-story")).toHaveCount(0);
  for (const route of ["/director", "/backstage", "/backstage/real", "/join"]) {
    expect((await page.request.get(route)).status(), route).toBe(404);
  }

  // the same by hand: no key 404, and a guessed key the same 404 (never "wrong key": the routes do not say a key exists)
  const bareFilming = await page.request.post("/api/session", { data: { kind: "filming" } });
  expect(bareFilming.status()).toBe(404);
  const guessedFilming = await page.request.post("/api/session", { data: { kind: "filming", crew_key: "letmein" } });
  expect(guessedFilming.status()).toBe(404);
  expect((await guessedFilming.json()).error).toBe("not_found");
  const bornFilming = await page.request.post("/api/session", { data: { kind: "sandbox", filming_mode: true } });
  expect(bornFilming.status()).toBe(404);
  const mode = await page.request.post(`/api/director/filming?session=${sandbox}`, { data: { on: true } });
  expect(mode.status()).toBe(404);
  const guessedMode = await page.request.post(`/api/director/filming?session=${sandbox}`, { data: { on: true, crew_key: "open sesame" } });
  expect(guessedMode.status()).toBe(404);
  // the speech service's health gives a guessed key the public answer only
  const health = await page.request.get("/api/asr/health", { headers: { "x-ripple-crew-key": "letmein" } });
  expect(health.status()).toBe(200);
  expect(JSON.stringify(await health.json())).not.toMatch(/"gpu"|"models"|"device"|replay_fallback/);
  const session = (await (await page.request.get(`/api/session?session=${sandbox}`)).json()).session as { filming_mode: boolean; expires_at: string | null };
  expect(session.filming_mode).toBe(false);
  expect(session.expires_at).not.toBeNull(); // still the judge's sandbox
  expect((await context.cookies()).find((c) => c.name === "rp_crew")).toBeUndefined();

  // the crew's sign-in page itself is open (no public page links to it); the judge stays in the own sandbox there
  await page.goto("/backstage/crew");
  await expect(page.getByTestId("page-crew")).toBeVisible({ timeout: 15_000 });
  expect((await context.cookies()).find((c) => c.name === "rp_session")!.value).toBe(sandbox);

  // the visit screen in the sandbox: start a sample replay; no switch, no unlock field
  await page.goto("/p/visit?speed=10");
  await waitLive(page);
  await page.getByTestId("replay-v1").click();
  await expect(page.getByTestId("visit-screen")).toBeVisible();
  // a judge's replay of a visit that already happened is a re-watch in a copy (C2)
  const copy = (await page.getByTestId("visit-screen").getAttribute("data-visit"))!;
  expect(copy).toMatch(/^v1-again-/);
  await expect(page.getByTestId(`line-${copy}-v1-u02`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("fallback-toggle")).toHaveCount(0);
  await expect(page.getByTestId("fallback-unlock")).toHaveCount(0);

  // the fallback API refuses: no key (404), a guessed key, the extract flag
  const bare = await page.request.post(`/api/visits/v1/scripted?session=${sandbox}`, { data: { on: true } });
  expect(bare.status()).toBe(404);
  const guess = await page.request.post(`/api/visits/v1/scripted?session=${sandbox}`, { data: { on: true, key: "letmein" } });
  expect(guess.status()).toBe(404);
  expect((await guess.json()).error).toBe("not_found");
  const flag = await page.request.post(`/api/visits/v1/extract?session=${sandbox}`, {
    data: { utterances: [{ t_start_ms: 900000, t_end_ms: 901000, text: "hello" }], fallback: true },
  });
  expect(flag.status()).toBe(404);
  const view = (await (await page.request.get(`/api/visits/v1?session=${sandbox}`)).json()).view as { fallback: { allowed: boolean; on: boolean } };
  expect(view.fallback).toMatchObject({ allowed: false, on: false });
  // the copy's own switch and view: the same closed door
  expect((await page.request.post(`/api/visits/${copy}/scripted?session=${sandbox}`, { data: { on: true } })).status()).toBe(404);
  const copyView = (await (await page.request.get(`/api/visits/${copy}?session=${sandbox}`)).json()).view as { fallback: { allowed: boolean; on: boolean } };
  expect(copyView.fallback).toMatchObject({ allowed: false, on: false });
  await page.goto(`/p/visit?visit=${copy}&mode=replay&crew=1`);
  await expect(page.getByTestId("visit-screen")).toBeVisible();
  await expect(page.getByTestId("fallback-toggle")).toHaveCount(0);
  await expect(page.getByTestId("fallback-unlock")).toHaveCount(0);
  await context.close();
});

test("filming session with the crew key: the switch is there; a misheard line shows the script line, marked", async ({ browser, request }) => {
  const s = await createSession(request, { kind: "filming", story_day: 0, filming_mode: true, crew_key: CREW_KEY });
  // start the D0 visit without the mock stream, as a realtime client would
  await api(request, "/api/visits", s.id, { mode: "record", consent: { given: true } });
  const phone = await openDevice(browser, s.id, "/p/visit?visit=v1&mode=record&crew=1");
  const page = phone.page;
  await expect(page.getByTestId("fallback-toggle")).toHaveCount(0);
  await expect(page.getByTestId("fallback-unlock")).toBeVisible();
  // this phone is in the filming session but is not the crew's yet: the switch's route does not exist for it
  expect((await page.request.post(`/api/visits/v1/scripted?session=${s.id}`, { data: { on: true } })).status()).toBe(404);
  // the key field is the crew's sign-in door: a wrong key is said here (the one place that says so), nothing switches
  await page.getByTestId("fallback-key").fill("not-the-key");
  await page.getByTestId("fallback-unlock-submit").click();
  await expect(page.getByTestId("fallback-unlock-status")).toHaveText("口令不对。");
  await expect(page.getByTestId("fallback-toggle")).toHaveCount(0);
  expect((await phone.context.cookies()).find((c) => c.name === "rp_crew")).toBeUndefined();
  await page.getByTestId("fallback-key").fill(CREW_KEY);
  await page.getByTestId("fallback-unlock-submit").click();
  await expect(page.getByTestId("fallback-toggle")).toBeVisible();
  await expect(page.getByTestId("fallback-switch")).toHaveAttribute("aria-pressed", "true");
  // the door left the crew's cookie on this phone (a hash, never the key): later switches need no key
  expect((await phone.context.cookies()).find((c) => c.name === "rp_crew")?.value).toMatch(/^[0-9a-f]{64}$/);
  // the switch works both ways once unlocked
  await page.getByTestId("fallback-switch").click();
  await expect(page.getByTestId("fallback-switch")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("fallback-switch").click();
  await expect(page.getByTestId("fallback-switch")).toHaveAttribute("aria-pressed", "true");

  const heard = await request.post(`/api/visits/v1/extract?session=${s.id}`, {
    data: { utterances: [{ t_start_ms: 1500, t_end_ms: 6115, speaker_cluster: 0, text: "Doctor, can I record? My daughter wants me to use this app." }] },
  });
  expect(heard.status()).toBe(200);
  const misheard = await request.post(`/api/visits/v1/extract?session=${s.id}`, {
    data: { utterances: [{ t_start_ms: 6815, t_end_ms: 8015, speaker_cluster: 1, text: "Shore, know prob lame." }] },
  });
  const out = await misheard.json();
  expect(out.utterances[0]).toMatchObject({ text: "Sure, no problem.", scripted_fallback: true });

  await page.reload();
  // after a reload the phone is still the crew's (its cookie): the switch is there with no key field
  await expect(page.getByTestId("fallback-toggle")).toBeVisible();
  await expect(page.getByTestId("fallback-unlock")).toHaveCount(0);
  const line = page.getByTestId(`line-${out.utterances[0].id}`);
  await expect(line).toContainText("Sure, no problem.");
  await expect(line).toContainText("剧本句");

  const backstage = await openCrewDevice(browser, s.id, "/backstage");
  await expect(backstage.page.getByText(/Scripted fallback/).first()).toBeVisible();
  await closeAll([phone, backstage]);
});
