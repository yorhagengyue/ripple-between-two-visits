/**
 * M6 on her whole device, not only /f (second verification, defects 1-4 and 6): everything Mr Tan switched off stays
 * off on Wei Ling's phone, whatever she opens, and she cannot act for him anywhere.
 *
 * In the normal suite since 10-09 wave B (the fixes: web/proxy.ts + lib/family/gate.ts, the deny-by-default gate for
 * the family role; app/p/layout.tsx sendFamilyToF; app/api/events familyStreamFor; denyFamily in GET /api/notes,
 * GET /api/bp, POST /api/ask, POST /api/clock; reminderAuthorFor + reminderAudioProblem in POST /api/reminders).
 * The route-by-route enumeration of the same rule is e2e/m6-privacy-routes.spec.ts.
 *
 *   1  his pages (/p/*): her phone is sent to /f before anything renders; the 307 carries none of his data.
 *   1  his read APIs: 403 patient_only, or nothing he switched off (his notes, R1, reading numbers).
 *   2  /api/events: her stream carries no note text, no reading, nothing of what he asked.
 *   2  /api/events while he replays visit v1 (the leak the wave A check found): with visit transcripts off her stream
 *      carries no visit line, no R1/R2, no asr.* or card.* event and not his member id, live or on a reconnect that
 *      replays the history; with transcripts on it carries only content-free hints and the lines come through
 *      /api/family/view, trimmed on the server.
 *   3  POST /api/ask from her phone: 403 patient_only; his notes and questions do not change.
 *   4  POST /api/reminders: a path never uploaded is 404 audio_not_found; his own device cannot register a clip
 *      that would play as 女儿的录音 (403 family_only). Two tests, so each half fails at its own line today.
 *   6  POST /api/clock from her phone: 403; the story day does not move.
 *   7  (10-09 fixer, deny by default) her own browser on /f with its cookies dropped (fetch with credentials "omit",
 *      what a private window does) names his session: 403 member_required for his notes and for his switches, and
 *      her /f still shows only what he allowed; her phone naming another real session gets 403 there, allow-list
 *      included, and registers nothing in it.
 *   7  (10-10 wrap-up, no identity) a private window before anyone joined as family (a judge's sandbox, the shoot
 *      before she joins): his notes, readings, visit, brief, view, switches and stream are 403 member_required, it
 *      cannot change the switches, write a note, move the clock or reset; the session row it may read has no members
 *      (no member id); the code cannot make it his phone (patient_exists), a judge or backstage; nothing changes.
 *   8  (10-10 wrap-up) the join code is not on her phone: not in /f's page, not on its debug line, not in the session
 *      row her stream carries after his side moves the clock and resets; she has no jump menu, and the story beats it
 *      names are not in any script her /f loads.
 * Every defect-1 probe first checks that his own phone gets 200 from the same page or API, and checks her side with
 * soft assertions, so one run lists every page and API still open.
 *
 * D41 with the seed's switches: dose summary, readings count, questions count and the no-reply alert on; visit
 * transcripts and his notes off.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext } from "@playwright/test";
import { BASE_URL, closeAll, CREW_HEADERS, createSession, waitLive, withCrew, type Device } from "./helpers";

// C2 (lib/crew/gate.ts): the story clock and reset are the film crew's; his side's clean-ups and clock moves below carry
// the crew key on that one request (a file-wide header would reach her phone and the private window too).

const NOTE_D20 = "我今天好累。";
const NOTE_D37 = "今天在大巴窑中心走了一圈，脚踝有点肿。";
const R1 = "At home, we want it below 135 over 85.";
const R2 = "If your reading at home is above 180 on top";
const OFF_CONTENT = [NOTE_D20, NOTE_D37, R1, "150/95", "126/82", '"systolic"'];
/** every line of visit v1 long enough to be his words (not "OK."), from the replay fixture itself */
const V1_LINES: string[] = (
  JSON.parse(readFileSync(path.join(__dirname, "..", "fixtures", "visits", "v1.utterances.json"), "utf8")) as { utterances: { text: string }[] }
).utterances
  .map((u) => u.text)
  .filter((t) => t.length >= 12);
const ALL_OFF = { dose_summary: false, bp_summary: false, questions_count: false, no_reply_alert: false, visit_transcripts: false, notes: false };
/** the only events she receives with data while every content switch is off (lib/family/events.ts "pass") */
const PASS_TYPES = new Set(["family_grant.changed", "clock.changed", "session.reset", "session.filming_mode"]);

/** A device's cookies as one Cookie header (and by name), from a browser context or an API request context. */
async function cookiesOf(ctx: BrowserContext | APIRequestContext): Promise<{ header: string; byName: Record<string, string> }> {
  const list = "newPage" in ctx ? await ctx.cookies() : (await ctx.storageState()).cookies;
  const byName: Record<string, string> = {};
  for (const c of list) byName[c.name] = c.value;
  return { header: list.map((c) => `${c.name}=${c.value}`).join("; "), byName };
}

/** The raw event stream with a device's cookies: the same bytes that device's EventSource gets. */
async function openStream(url: string, cookie: string, headers: Record<string, string> = {}) {
  const ctrl = new AbortController();
  const res = await fetch(`${BASE_URL}${url}`, { headers: { cookie, accept: "text/event-stream", ...headers }, signal: ctrl.signal });
  const state = { status: res.status, text: "" };
  void (async () => {
    try {
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        state.text += dec.decode(value, { stream: true });
      }
    } catch {
      // aborted at the end of the probe
    }
  })();
  return { state, stop: () => ctrl.abort() };
}

/** Frames of an SSE text that carry an id but no data (a dropped event must send none of these). */
function bareIdFrames(text: string): string[] {
  return text.split("\n\n").filter((f) => /^id: \d+$/m.test(f) && !/^data: /m.test(f));
}

/** The data frames of an SSE text (frames that are only an `id:` line are left out). */
function dataFrames(text: string): { type: string; say: unknown; data: unknown }[] {
  const out: { type: string; say: unknown; data: unknown }[] = [];
  for (const block of text.split("\n\n")) {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => l.slice(6))
      .join("\n");
    if (!data) continue;
    const e = JSON.parse(data) as { type: string; say: unknown; data: unknown };
    out.push({ type: e.type, say: e.say, data: e.data });
  }
  return out;
}

/** He starts visit v1 as a replay at speed 20 from his own phone; resolves with the replay's real-time length. */
async function replayV1(request: APIRequestContext, sid: string): Promise<number> {
  const v = await request.post(`/api/visits?session=${sid}`, { data: { mode: "replay", fixture: "v1" } });
  expect(v.ok(), `POST /api/visits ${v.status()} ${await v.text()}`).toBeTruthy();
  const r = await request.post(`/api/visits/v1/replay?session=${sid}`, { data: { speed: 20 } });
  expect(r.ok(), `replay ${r.status()} ${await r.text()}`).toBeTruthy();
  return ((await r.json()) as { duration_ms: number }).duration_ms;
}

/** What of his visit is in a stream text (empty: nothing). */
function visitLeaks(text: string, hisMember: string): string[] {
  return [R1, R2, "asr.partial", "asr.final", "card.created", hisMember, ...V1_LINES].filter((x) => x && text.includes(x));
}

/** Wei Ling's phone: joined with the session's code as "family" (member row + cookies), opened on /f. */
async function joinAsFamily(browser: Browser, code: string, open = true): Promise<Device> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const res = await context.request.post("/api/session/join", { data: { code, role: "family" } });
  expect(res.status(), await res.text()).toBe(200);
  const page = await context.newPage();
  if (open) {
    await page.goto("/f");
    await waitLive(page);
  }
  return { context, page };
}

/** His phone: the session is created by it as the patient device (member row + cookies on `request`). */
async function hisSession(request: APIRequestContext) {
  return createSession(request, { story_day: 41, story_time: "20:15", role: "patient" });
}

/** His notes and his question list, read from his own phone (`request` carries his cookies). */
async function counts(request: APIRequestContext, sid: string): Promise<{ notes: number; questions: number }> {
  const notes = (await (await request.get(`/api/notes?session=${sid}`)).json()) as { notes?: unknown[] };
  const html = await (await request.get("/p/questions")).text();
  return { notes: notes.notes?.length ?? -1, questions: (html.match(/data-testid="question"/g) ?? []).length };
}

async function clipCount(request: APIRequestContext, sid: string): Promise<number> {
  return ((await (await request.get(`/api/reminders?session=${sid}`)).json()) as { clips: unknown[] }).clips.length;
}

/** His pages (every /p/* that renders). */
const HIS_PAGES = [
  "/p/today",
  "/p/bp",
  "/p/meds",
  "/p/meds/med-amlodipine",
  "/p/meds/add",
  "/p/questions",
  "/p/visit",
  "/p/visit/v1/review",
  "/p/brief",
  "/p/family",
];

/** His read APIs (each answers his own phone 200). */
const HIS_APIS = [
  "/api/notes",
  "/api/bp",
  "/api/doses",
  "/api/meds",
  "/api/meds/med-amlodipine",
  "/api/understanding?med_id=med-amlodipine",
  "/api/visits/v1",
  "/api/brief",
];

test.describe("Wei Ling's whole device", () => {
  test("defect 1: every page of his sends her phone to /f before rendering; the redirect carries none of his data", async ({ browser, request }) => {
    test.setTimeout(120_000);
    const s = await hisSession(request);
    const her = await joinAsFamily(browser, s.join_code, false);
    // (/p itself only redirects to /p/today and renders nothing)
    for (const p of HIS_PAGES) {
      // the probe is about her: his own phone opens the page
      expect((await request.get(p, { maxRedirects: 0 })).status(), `his phone on ${p}`).toBe(200);
      const res = await her.context.request.get(p, { maxRedirects: 0 });
      // soft: one run reports every page, not only the first one still open
      expect.soft(res.status(), p).toBe(307);
      expect.soft(res.headers().location ?? "", p).toMatch(/\/f$/);
      const body = await res.text();
      for (const x of OFF_CONTENT) expect.soft(body, `${p} carries ${x}`).not.toContain(x);
    }
    await closeAll([her]);
  });

  test("defect 1: his read APIs answer her 403, or hold nothing he switched off", async ({ browser, request }) => {
    const s = await hisSession(request);
    const her = await joinAsFamily(browser, s.join_code, false);
    for (const p of HIS_APIS) {
      const url = `${p}${p.includes("?") ? "&" : "?"}session=${s.id}`;
      // the probe is about her: the same call answers his own phone 200, so a 400 or 404 cannot pass as "closed"
      expect((await request.get(url)).status(), `his phone on ${p}`).toBe(200);
      const res = await her.context.request.get(url);
      const body = await res.text();
      if (res.status() === 403) {
        expect.soft(JSON.parse(body).error, p).toBe("patient_only");
        continue;
      }
      expect.soft(res.status(), `${p}: ${body.slice(0, 120)}`).toBe(200);
      for (const x of OFF_CONTENT) expect.soft(body, `${p} carries ${x}`).not.toContain(x);
    }
    await closeAll([her]);
  });

  test("defect 2: her event stream carries no note he wrote while notes was off, no reading, nothing he asked", async ({ browser, request }) => {
    test.setTimeout(90_000);
    const s = await hisSession(request);
    const her = await joinAsFamily(browser, s.join_code);
    // her browser reads the raw stream, the same bytes its EventSource gets
    await her.page.evaluate(async (sid) => {
      const w = window as unknown as { __rpProbe: { text: string; stop(): void } };
      const ctrl = new AbortController();
      w.__rpProbe = { text: "", stop: () => ctrl.abort() };
      const res = await fetch(`/api/events?session=${encodeURIComponent(sid)}`, { signal: ctrl.signal });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      void (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            w.__rpProbe.text += dec.decode(value, { stream: true });
          }
        } catch {
          // aborted at the end of the probe
        }
      })();
    }, s.id);
    await expect.poll(() => her.page.evaluate(() => (window as unknown as { __rpProbe: { text: string } }).__rpProbe.text)).toContain("connected");

    const NOTE = "今天脚踝更肿了，鞋子有点紧。";
    const ASK = "我可以多吃一粒降压药吗？";
    const q = `?session=${s.id}`;
    expect((await request.post(`/api/notes${q}`, { data: { text: NOTE } })).status()).toBe(201);
    expect((await request.post(`/api/bp${q}`, { data: { systolic: 151, diastolic: 97 } })).status()).toBe(201);
    expect((await request.post(`/api/ask${q}`, { data: { text: ASK, locale: "zh-Hans", role: "patient" } })).status()).toBe(200);
    // the reading reaches /f as a count (bp_summary is on), so the stream did deliver something after it
    await expect(her.page.getByTestId("family-bp")).toHaveAttribute("data-count", /\d+/);
    await her.page.waitForTimeout(1500);
    const text = await her.page.evaluate(() => {
      const w = window as unknown as { __rpProbe: { text: string; stop(): void } };
      w.__rpProbe.stop();
      return w.__rpProbe.text;
    });
    for (const x of [NOTE, ASK, "151", "systolic", "ask.received", "verify.layer", "ask.answered", "rp_member"]) expect(text, x).not.toContain(x);
    await closeAll([her]);
  });

  test("defect 2 (replay): he replays visit v1 with every switch off; her stream gets no visit line, no card, not his id, live or on a reconnect", async ({ browser, request }) => {
    test.setTimeout(150_000);
    const s = await createSession(request, { story_day: 0, role: "patient" });
    const off = await request.post(`/api/family/grants?session=${s.id}`, { data: { items: ALL_OFF } });
    expect(off.status(), await off.text()).toBe(200);
    const her = await joinAsFamily(browser, s.join_code, false);
    const herCookies = await cookiesOf(her.context);
    const hisCookies = await cookiesOf(request);
    const hisMember = hisCookies.byName.rp_member;
    expect(hisMember, "his phone holds a member cookie (the credential that must not reach her)").toBeTruthy();
    const herStream = await openStream(`/api/events?session=${s.id}`, herCookies.header);
    const hisStream = await openStream(`/api/events?session=${s.id}`, hisCookies.header);
    try {
      await expect.poll(() => herStream.state.text).toContain("connected");
      await expect.poll(() => hisStream.state.text).toContain("connected");
      expect(herStream.state.status).toBe(200);

      const duration = await replayV1(request, s.id);
      // the replay ran: his own stream carries R1 and the cards
      await expect.poll(() => hisStream.state.text, { timeout: duration / 20 + 30_000 }).toContain("card.created");
      await expect.poll(() => hisStream.state.text, { timeout: 10_000 }).toContain(R1);
      await new Promise((r) => setTimeout(r, 1500)); // anything still in flight to her stream arrives
      const text = herStream.state.text;
      expect(visitLeaks(text, hisMember), "her live stream").toEqual([]);
      const frames = dataFrames(text);
      expect(frames.map((f) => f.type).filter((t) => !PASS_TYPES.has(t)), "event types with data on her stream").toEqual([]);
      expect(frames.filter((f) => f.say !== ""), "a backstage sentence on her stream").toEqual([]);
      // a dropped event sends nothing at all, not even its id: her phone cannot tell when or how often he did things
      expect(bareIdFrames(text), "bare id lines on her stream").toEqual([]);
      expect(text.length, "her stream stays near-empty while his carries the visit").toBeLessThan(hisStream.state.text.length / 20);
    } finally {
      herStream.stop();
      hisStream.stop();
    }

    // a reconnect that asks for the history from the start goes through the same filter
    for (const [what, url, headers] of [
      ["Last-Event-ID: 0", `/api/events?session=${s.id}`, { "last-event-id": "0" }],
      ["?since=0", `/api/events?session=${s.id}&since=0`, {}],
    ] as const) {
      const again = await openStream(url, herCookies.header, headers);
      try {
        await expect.poll(() => again.state.text).toContain("connected");
        // the history is replayed through her filter: his switches (set before the replay) come back, nothing else
        await expect.poll(() => dataFrames(again.state.text).some((f) => f.type === "family_grant.changed"), { timeout: 10_000 }).toBe(true);
        await new Promise((r) => setTimeout(r, 1000));
        expect(visitLeaks(again.state.text, hisMember), `reconnect ${what}`).toEqual([]);
        expect(dataFrames(again.state.text).map((f) => f.type).filter((t) => !PASS_TYPES.has(t)), `reconnect ${what}`).toEqual([]);
        expect(bareIdFrames(again.state.text), `reconnect ${what}: bare id lines`).toEqual([]);
      } finally {
        again.stop();
      }
    }
    // control: his own reconnect does replay the visit (so the reconnect checks above had something to filter)
    const hisAgain = await openStream(`/api/events?session=${s.id}`, hisCookies.header, { "last-event-id": "0" });
    try {
      await expect.poll(() => hisAgain.state.text, { timeout: 10_000 }).toContain(R1);
    } finally {
      hisAgain.stop();
    }
    await closeAll([her]);
  });

  test("defect 2 (replay, transcripts on): her stream still carries only content-free hints; the lines come through /api/family/view", async ({ browser, request }) => {
    test.setTimeout(150_000);
    const s = await createSession(request, { story_day: 0, role: "patient" });
    const on = await request.post(`/api/family/grants?session=${s.id}`, { data: { items: { ...ALL_OFF, visit_transcripts: true, questions_count: true } } });
    expect(on.status(), await on.text()).toBe(200);
    const her = await joinAsFamily(browser, s.join_code, false);
    const herCookies = await cookiesOf(her.context);
    const hisCookies = await cookiesOf(request);
    const herStream = await openStream(`/api/events?session=${s.id}`, herCookies.header);
    try {
      await expect.poll(() => herStream.state.text).toContain("connected");
      const duration = await replayV1(request, s.id);
      // the visit's lines reach /f through the server-trimmed view (the switch works) ...
      await expect
        .poll(async () => (await her.context.request.get(`/api/family/view?session=${s.id}`)).text(), { timeout: duration / 20 + 30_000 })
        .toContain(R1);
      await expect.poll(() => dataFrames(herStream.state.text).some((f) => f.type === "visit.changed"), { timeout: 10_000 }).toBe(true);
      await new Promise((r) => setTimeout(r, 1500));
      // ... and never through her stream: a hint says "read it again", with no data and no backstage sentence
      const text = herStream.state.text;
      expect(visitLeaks(text, hisCookies.byName.rp_member), "her stream").toEqual([]);
      const withData = dataFrames(text).filter((f) => !PASS_TYPES.has(f.type) && JSON.stringify(f.data ?? {}) !== "{}");
      expect(withData, "hints with data").toEqual([]);
      expect(dataFrames(text).filter((f) => f.say !== ""), "a backstage sentence on her stream").toEqual([]);
    } finally {
      herStream.stop();
    }
    await closeAll([her]);
  });

  test("defect 3: she cannot ask for him (no note, no question added in his name)", async ({ browser, request }) => {
    const s = await hisSession(request);
    const her = await joinAsFamily(browser, s.join_code, false);
    const before = await counts(request, s.id);
    for (const text of ["我今天头有点晕。", "我可以多吃一粒降压药吗？"]) {
      const res = await her.context.request.post(`/api/ask?session=${s.id}`, { data: { text, locale: "zh-Hans" } });
      expect(res.status(), text).toBe(403);
      expect((await res.json()).error).toBe("patient_only");
    }
    expect(await counts(request, s.id)).toEqual(before);
    await closeAll([her]);
  });

  test("defect 4: a reminder whose file was never uploaded is refused (404 audio_not_found), and nothing is registered", async ({ browser, request }) => {
    const s = await hisSession(request);
    const her = await joinAsFamily(browser, s.join_code, false);
    try {
      const before = await clipCount(request, s.id);
      const ghost = await her.context.request.post(`/api/reminders?session=${s.id}`, { data: { audio_path: `${s.id}/reminders/never-uploaded.wav` } });
      expect(ghost.status()).toBe(404);
      expect((await ghost.json()).error).toBe("audio_not_found");
      expect(await clipCount(request, s.id)).toBe(before);
    } finally {
      await request.post(`/api/session/reset?session=${s.id}`, { headers: CREW_HEADERS }); // pass or fail: back to the seed
      await closeAll([her]);
    }
  });

  test("defect 4: his own phone cannot register a reminder that would play as 女儿的录音 (403 family_only)", async ({ request }) => {
    const s = await hisSession(request);
    try {
      const before = await clipCount(request, s.id);
      const link = await request.post(`/api/upload-url?session=${s.id}`, { data: { kind: "reminder", content_type: "audio/wav" } });
      if (link.status() === 200) {
        // a real WAV through the signed link, as her recorder sends it; then the registration is what is refused
        const up = (await link.json()) as { url: string; method: string; headers: Record<string, string>; path: string };
        const bytes = readFileSync(path.join(__dirname, "..", "fixtures", "visits", "clips", "v1-u08.wav"));
        const put = await request.fetch(up.url, { method: up.method, headers: up.headers, data: bytes });
        expect(put.ok(), `PUT ${put.status()}`).toBeTruthy();
        const reg = await request.post(`/api/reminders?session=${s.id}`, { data: { audio_path: up.path } });
        expect(reg.status()).toBe(403);
        expect((await reg.json()).error).toBe("family_only");
      } else {
        // the owner may refuse him earlier, at the upload link
        expect(link.status(), "his phone is refused the reminder upload link instead").toBe(403);
        expect((await link.json()).error).toBe("family_only");
      }
      expect(await clipCount(request, s.id)).toBe(before);
    } finally {
      await request.post(`/api/session/reset?session=${s.id}`, { headers: CREW_HEADERS }); // pass or fail: deletes the uploaded test file
    }
  });

  test("7: her browser with its cookies dropped is nobody in his session: no notes, no switches; /f still shows only what he allowed", async ({ browser, request }) => {
    test.setTimeout(90_000);
    const s = await hisSession(request);
    const her = await joinAsFamily(browser, s.join_code);
    // the session id is on her own stream's first line; she needs nothing she could not see
    const probe = await her.page.evaluate(async (sid) => {
      const omit = { credentials: "omit" as const };
      const notes = await fetch(`/api/notes?session=${encodeURIComponent(sid)}`, omit);
      const grants = await fetch(`/api/family/grants?session=${encodeURIComponent(sid)}`, {
        ...omit,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: { notes: true, visit_transcripts: true, dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true } }),
      });
      const view = await fetch(`/api/family/view?session=${encodeURIComponent(sid)}`, omit);
      const session = await fetch(`/api/session?session=${encodeURIComponent(sid)}`, omit);
      return {
        notes: { status: notes.status, body: await notes.text() },
        grants: { status: grants.status, body: await grants.text() },
        view: { status: view.status, body: await view.text() },
        session: { status: session.status, body: await session.text() },
      };
    }, s.id);
    for (const [what, r] of Object.entries(probe)) {
      expect.soft(r.status, `${what}: ${r.body.slice(0, 120)}`).toBe(403);
      expect.soft(JSON.parse(r.body).error, what).toBe("member_required");
      for (const x of [...OFF_CONTENT, "rp_member", '"members"']) expect.soft(r.body, `${what} carries ${x}`).not.toContain(x);
    }
    // his switches did not move, and her own /f (with her cookies) still holds none of what he keeps from her
    const grants = (await (await request.get(`/api/family/grants?session=${s.id}`)).json()) as { items: Record<string, boolean> };
    expect(grants.items).toMatchObject({ notes: false, visit_transcripts: false });
    const mine = await her.context.request.get(`/api/family/view?session=${s.id}`);
    expect(mine.status()).toBe(200);
    for (const x of OFF_CONTENT) expect.soft(await mine.text(), `her view carries ${x}`).not.toContain(x);
    await her.page.reload();
    await waitLive(her.page);
    const shown = await her.page.evaluate(() => document.body.innerText);
    for (const x of [NOTE_D20, NOTE_D37, R1]) expect(shown, x).not.toContain(x);
    // his own phone is unaffected
    expect((await request.get(`/api/notes?session=${s.id}`)).status()).toBe(200);
    await closeAll([her]);
  });

  test("7: her phone naming another real session gets nothing there and registers nothing in it", async ({ browser, request }) => {
    const s = await hisSession(request);
    const her = await joinAsFamily(browser, s.join_code, false);
    // another family's session T, opened from another browser (its id is a random UUID; here we hand it to her)
    const elsewhere = await browser.newContext({ baseURL: BASE_URL });
    const t = await createSession(elsewhere.request, { story_day: 41, story_time: "20:15", role: "patient" });
    const before = await clipCount(elsewhere.request, t.id);
    const r = her.context.request;
    const q = `?session=${t.id}`;
    for (const [what, res] of [
      ["GET /api/family/view", await r.get(`/api/family/view${q}`)],
      ["GET /api/family/alerts", await r.get(`/api/family/alerts${q}`)],
      ["GET /api/events", await r.get(`/api/events${q}`)],
      ["GET /api/reminders", await r.get(`/api/reminders${q}`)],
      ["POST /api/upload-url", await r.post(`/api/upload-url${q}`, { data: { kind: "reminder", content_type: "audio/wav" } })],
      ["POST /api/reminders", await r.post(`/api/reminders${q}`, { data: { audio_path: `${t.id}/reminders/hers.wav` } })],
    ] as const) {
      expect.soft(res.status(), what).toBe(403);
      expect.soft(((await res.json()) as { error: string }).error, what).toBe("patient_only");
    }
    expect(await clipCount(elsewhere.request, t.id)).toBe(before);
    // in her own session the same calls still work
    expect((await r.get(`/api/family/view?session=${s.id}`)).status()).toBe(200);
    expect((await r.post(`/api/upload-url?session=${s.id}`, { data: { kind: "reminder", content_type: "audio/wav" } })).status()).toBe(200);
    await elsewhere.close();
    await closeAll([her]);
  });

  test("7 (no identity): a private window, before anyone joined as family, gets nothing of his and cannot make itself his", async ({ browser, request }) => {
    // a judge's sandbox, or the shoot before her phone joins: only his phone is in (patient row + cookies on `request`)
    const s = await hisSession(request);
    const hisMember = (await cookiesOf(request)).byName.rp_member;
    // a private window: a browser with no cookie at all, on a public page of the app, naming his session by its id
    const incognito = await browser.newContext({ baseURL: BASE_URL });
    const page = await incognito.newPage();
    await page.goto("/how"); // a public page of the app that sets no cookie (C2: /join is the crew's)
    const probe = await page.evaluate(async ({ sid, code }) => {
      const q = `?session=${encodeURIComponent(sid)}`;
      const go = async (url: string, init: RequestInit = {}) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10_000);
        try {
          const res = await fetch(url, { credentials: "omit", ...init, signal: ctrl.signal });
          const text = res.headers.get("content-type")?.includes("event-stream") ? "(a stream)" : await res.text();
          ctrl.abort();
          return { status: res.status, body: text };
        } finally {
          clearTimeout(timer);
        }
      };
      const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const all = { notes: true, visit_transcripts: true, dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true };
      return {
        reads: {
          notes: await go(`/api/notes${q}`),
          bp: await go(`/api/bp${q}`),
          doses: await go(`/api/doses${q}`),
          visit: await go(`/api/visits/v1${q}`),
          brief: await go(`/api/brief${q}`),
          view: await go(`/api/family/view${q}`),
          switches: await go(`/api/family/grants${q}`),
          stream: await go(`/api/events${q}`),
        },
        acts: {
          grants: await go(`/api/family/grants${q}`, json({ items: all })),
          note: await go(`/api/notes${q}`, json({ text: "隐私窗口替他写的一句。" })),
          clock: await go(`/api/clock${q}`, json({ day: 0 })),
          reset: await go(`/api/session/reset${q}`, json({})),
        },
        session: await go(`/api/session${q}`),
        joins: {
          patient: await go("/api/session/join", json({ code, role: "patient" })),
          judge: await go("/api/session/join", json({ code, role: "judge" })),
          backstage: await go("/api/session/join", json({ code, role: "backstage" })),
        },
      };
    }, { sid: s.id, code: s.join_code });
    for (const [what, r] of [...Object.entries(probe.reads), ...Object.entries(probe.acts)]) {
      expect.soft(r.status, `${what}: ${r.body.slice(0, 120)}`).toBe(403);
      if (r.status === 403) expect.soft(JSON.parse(r.body).error, what).toBe("member_required");
      for (const x of [...OFF_CONTENT, NOTE_D37, hisMember]) expect.soft(r.body, `${what} carries ${x}`).not.toContain(x);
    }
    // the session row only: no members, so no member id (the rp_member credential)
    expect(probe.session.status).toBe(200);
    expect(Object.keys(JSON.parse(probe.session.body) as object)).toEqual(["session"]);
    expect(probe.session.body).not.toContain(hisMember);
    // the code cannot make it his phone (his is in), a judge, or backstage (no crew key)
    expect(Object.fromEntries(Object.entries(probe.joins).map(([k, r]) => [k, `${r.status} ${(JSON.parse(r.body) as { error?: string }).error}`]))).toEqual({
      patient: "403 patient_exists",
      judge: "403 role_not_joinable",
      backstage: "403 crew_key_required",
    });
    expect(await incognito.cookies()).toEqual([]);
    // nothing of his changed: switches, notes, the story clock
    const grants = (await (await request.get(`/api/family/grants?session=${s.id}`)).json()) as { items: Record<string, boolean> };
    expect(grants.items).toMatchObject({ notes: false, visit_transcripts: false });
    expect(JSON.stringify(await (await request.get(`/api/notes?session=${s.id}`)).json())).not.toContain("隐私窗口替他写的一句");
    expect(((await (await request.get(`/api/session?session=${s.id}`)).json()) as { session: { story_day: number } }).session.story_day).toBe(41);
    await incognito.close();
  });

  test("8: the join code is not on her phone (page, debug line, stream), and the story beats are not in /f's scripts", async ({ browser, request }) => {
    test.setTimeout(90_000);
    const s = await hisSession(request);
    const context = await browser.newContext({ baseURL: BASE_URL });
    const join = await context.request.post("/api/session/join", { data: { code: s.join_code, role: "family" } });
    expect(join.status(), await join.text()).toBe(200);
    const page = await context.newPage();
    const scripts: Promise<string>[] = [];
    page.on("response", (res) => {
      if ((res.headers()["content-type"] ?? "").includes("javascript")) scripts.push(res.text().catch(() => ""));
    });
    await page.goto("/f");
    await waitLive(page);
    // the page as served (HTML with its RSC payload) and as shown
    expect(await (await context.request.get("/f")).text()).not.toContain(s.join_code);
    // C2: the debug line and the jump menu are the film crew's (her phone never carries the crew's cookie)
    await expect(page.getByTestId("debug-info")).toHaveCount(0);
    await expect(page.getByTestId("jump-menu")).toHaveCount(0);
    // her stream while his side moves the clock and resets: the session row it carries has no code
    const herCookies = await cookiesOf(context);
    const stream = await openStream(`/api/events?session=${s.id}`, herCookies.header);
    try {
      await expect.poll(() => stream.state.text).toContain("connected");
      expect((await request.post(`/api/clock?session=${s.id}`, { data: { day: 40, time: "09:00" }, headers: CREW_HEADERS })).status()).toBe(200);
      expect((await request.post(`/api/session/reset?session=${s.id}`, { data: {}, headers: CREW_HEADERS })).status()).toBe(200);
      await expect.poll(() => dataFrames(stream.state.text).map((f) => f.type)).toEqual(expect.arrayContaining(["clock.changed", "session.reset"]));
      for (const f of dataFrames(stream.state.text).filter((x) => x.type === "clock.changed" || x.type === "session.reset")) {
        expect(Object.keys((f.data as { session: object }).session).sort(), f.type).toEqual(["filming_mode", "id", "story_day", "story_time"]);
      }
      expect(stream.state.text).not.toContain(s.join_code);
      expect(stream.state.text).not.toContain("join_code");
    } finally {
      stream.stop();
    }
    // the story beats (the director's labels: "He mentions his ankle") live in the jump menu's own chunk, which her /f
    // never loads
    await page.reload();
    await waitLive(page);
    const titles = [...readFileSync(path.join(__dirname, "..", "lib", "session", "beats.ts"), "utf8").matchAll(/title: "([^"]{12,})"/g)].map((m) => m[1]);
    expect(titles).toContain("He mentions his ankle");
    const loaded = await Promise.all(scripts);
    expect(loaded.length).toBeGreaterThan(0);
    for (const t of titles) expect(loaded.filter((js) => js.includes(t)).length, `a script on her /f carries "${t}"`).toBe(0);
    await context.close();
    // control: a judge's own sandbox opening /f on a crew browser keeps the menu (C2: the menu is the crew's), and there
    // the same scan does find the beats (so the check above looks at the scripts that would carry them)
    const judge = await withCrew(await browser.newContext({ baseURL: BASE_URL }));
    expect((await judge.request.post("/api/session", { data: { story_day: 41, story_time: "20:15" } })).status()).toBe(201);
    const jp = await judge.newPage();
    const judgeScripts: Promise<string>[] = [];
    jp.on("response", (res) => {
      if ((res.headers()["content-type"] ?? "").includes("javascript")) judgeScripts.push(res.text().catch(() => ""));
    });
    await jp.goto("/f");
    await waitLive(jp);
    await expect(jp.getByTestId("jump-menu")).toBeVisible();
    const judgeLoaded = await Promise.all(judgeScripts);
    expect(judgeLoaded.some((js) => js.includes("He mentions his ankle")), "the judge's /f loads the menu's beats").toBe(true);
    await judge.close();
  });

  test("defect 6: her phone cannot move the story clock", async ({ browser, request }) => {
    const s = await hisSession(request);
    const her = await joinAsFamily(browser, s.join_code, false);
    const res = await her.context.request.post(`/api/clock?session=${s.id}`, { data: { day: 0 } });
    expect(res.status()).toBe(403);
    const now = (await (await request.get(`/api/session?session=${s.id}`)).json()) as { session: { story_day: number } };
    expect(now.session.story_day).toBe(41);
    await closeAll([her]);
  });
});
