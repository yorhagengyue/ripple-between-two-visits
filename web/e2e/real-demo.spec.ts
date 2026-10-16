/**
 * "Try a real recording / 用真录音试一次" (plan item 4, acceptance 4.3 and 4.4; lib/asr/real-demo.ts).
 *
 *   1. (always) /backstage/real: the dataset credit (en and zh, both links), the five consultations; without filming
 *      mode the run is locked and says how to unlock it. /how links to it and shows the same credit line.
 *   2. (the REAL Whisper service) a crew browser runs the shortest consultation: real Whisper (large-v3) -> lines with
 *      time points and the speaker from the dataset -> items (rules, plus the main model when LLM_PROVIDER is not
 *      mock) -> the safety layer -> cards. Every card quotes one of the doctor's transcript lines byte for byte with
 *      its time point; never_cross 0; nothing withheld that should not be. Then Mr Tan's pages, the family page and
 *      backstage of a fresh session carry nothing of the recording (acceptance 4.4 on the rendered pages).
 *
 * Test 2 needs the real service and the downloaded recordings, and runs only when asked (it holds the GPU about a
 * minute):
 *   SPEECH_PROVIDER=whisper PW_PORT=3223 npx playwright test e2e/real-demo.spec.ts
 * (or RP_REAL_E2E=1). It skips, saying why, when the service is not usable or the recording is not on this machine.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { DEV_ONLY_CREW_KEY } from "../lib/visit/crew";
import { BASE_URL, createSession, withCrew } from "./helpers";

const MANIFEST = JSON.parse(readFileSync(path.join(__dirname, "..", "fixtures", "real", "primock57.manifest.json"), "utf8")) as {
  credit: { en: string; zh: string; source_url: string; licence_url: string };
  consultations: { id: string; duration_s: number }[];
};
const CREW = { "x-ripple-crew-key": DEV_ONLY_CREW_KEY };
const SHORTEST = MANIFEST.consultations.slice().sort((a, b) => a.duration_s - b.duration_s)[0].id;
const RUN_REAL = process.env.SPEECH_PROVIDER === "whisper" || process.env.RP_REAL_E2E === "1";

test.describe.configure({ mode: "serial" });

test("the crew's demo page and /how show the dataset credit; to anyone else the page and its API do not exist (C2)", async ({ browser, page, playwright }) => {
  // a judge (no crew key): the page and the API answer 404 (real-app 5.2); /how shows the same credit, without a link
  expect((await page.goto("/backstage/real"))?.status()).toBe(404);
  const res = await page.request.post("/api/real", { data: { consultation: SHORTEST } });
  expect(res.status()).toBe(404);
  expect((await res.json()).error).toBe("not_found");
  expect((await page.request.get("/api/real")).status()).toBe(404);
  // a filming-mode session no longer opens it by itself: only the crew does (made from a separate client: a keyed
  // creation leaves the crew's cookie on the browser that made it)
  const crewSide = await playwright.request.newContext({ baseURL: BASE_URL });
  const made = await crewSide.post("/api/session", { data: { kind: "filming", filming_mode: true }, headers: CREW });
  expect(made.status()).toBe(201);
  const filmId = ((await made.json()) as { session: { id: string } }).session.id;
  await crewSide.dispose();
  const fresh = await browser.newContext({ baseURL: BASE_URL });
  expect((await fresh.request.get(`/api/real?session=${filmId}`)).status()).toBe(404);
  await fresh.close();
  await page.goto("/how");
  await expect(page.getByTestId("how-real-link")).toHaveCount(0);
  await expect(page.getByTestId("how-real-credit")).toContainText(MANIFEST.credit.en);
  await expect(page.getByTestId("how-real-credit")).toContainText(MANIFEST.credit.zh);

  // the crew's browser: /how links to the page, which shows the credit, the five consultations and why it cannot run here
  const crew = await withCrew(await browser.newContext({ baseURL: BASE_URL }));
  const cp = await crew.newPage();
  await cp.goto("/how");
  const link = cp.getByTestId("how-real-link");
  await expect(link).toHaveAttribute("href", "/backstage/real");
  await link.click();
  await expect(cp).toHaveURL(/\/backstage\/real$/);
  await expect(cp.getByTestId("page-real")).toBeVisible();
  await expect(cp.getByTestId("real-credit-en")).toHaveText(MANIFEST.credit.en);
  await expect(cp.getByTestId("real-credit-zh")).toHaveText(MANIFEST.credit.zh);
  const links = cp.getByTestId("real-credit").locator("a");
  await expect(links.nth(0)).toHaveAttribute("href", MANIFEST.credit.source_url);
  await expect(links.nth(1)).toHaveAttribute("href", MANIFEST.credit.licence_url);
  await expect(cp.getByTestId("real-consultations").locator("li")).toHaveCount(MANIFEST.consultations.length);
  await expect(cp.getByTestId("real-locked")).toHaveCount(0);
  const status = (await (await cp.request.get("/api/real")).json()) as { access: { allowed: boolean; via?: string }; whisper: { usable: boolean } };
  expect(status.access).toMatchObject({ allowed: true, via: "crew" });
  if (!status.whisper.usable) {
    await expect(cp.getByTestId("real-mode")).toContainText("not usable now");
    await expect(cp.getByTestId("real-run")).toBeDisabled();
  }
  await crew.close();
});

async function usable(request: APIRequestContext): Promise<string | null> {
  const s = (await (await request.get("/api/real", { headers: CREW })).json()) as { whisper: { usable: boolean; reason: string | null }; consultations: { id: string; available: boolean }[] };
  if (!s.consultations.find((c) => c.id === SHORTEST)?.available) return `${SHORTEST} is not on this machine (node scripts/data/fetch_primock57.mjs)`;
  if (!s.whisper.usable) return `the Whisper service is not usable (${s.whisper.reason})`;
  return null;
}

test("a real recording through the real Whisper: cards quote the doctor word for word with time points, never_cross 0, nothing in Mr Tan's pages", async ({ browser, request }) => {
  test.skip(!RUN_REAL, "runs the real Whisper service: SPEECH_PROVIDER=whisper (or RP_REAL_E2E=1)");
  const why = await usable(request);
  test.skip(why !== null, why ?? "");
  test.setTimeout(300_000);
  // the crew's browser: the page reads the crew's cookie, its API calls carry the key too (C2: lib/crew/gate.ts)
  const context = await withCrew(await browser.newContext({ baseURL: BASE_URL, extraHTTPHeaders: CREW }));
  const page = await context.newPage();
  try {
    await page.goto("/backstage/real");
    await expect(page.getByTestId("real-locked")).toHaveCount(0);
    await page.getByTestId(`real-pick-${SHORTEST}`).check();
    const started = page.waitForResponse((r) => r.url().endsWith("/api/real") && r.request().method() === "POST");
    const t0 = Date.now();
    await page.getByTestId("real-run").click();
    const post = await started;
    expect(post.status()).toBe(202);
    const jobId = ((await post.json()) as { job_id: string }).job_id;
    await expect(page.getByTestId("real-progress")).toBeVisible();
    await expect(page.getByTestId("real-summary")).toBeVisible({ timeout: 240_000 });
    const tookS = (Date.now() - t0) / 1000;

    // the run itself, from the API: the real service, the doctor's lines, the cards, the safety report
    const job = (await (await request.get(`/api/real/${jobId}`, { headers: CREW })).json()) as {
      state: string;
      result: {
        whisper: { model: string; segments: number; transcribe_ms: number };
        lines: { id: string; text: string; speaker: string; t_start_ms: number; t_end_ms: number }[];
        cards: { id: string; quote: string; line_id: string; t_start_ms: number; t_end_ms: number; speaker: string; by: string; variant: string }[];
        extraction: { source: string; provider: string | null; model: string | null; added: number; rejected: number; error: string | null };
        safety: { checked: number; passed: number; blocked: { layer: number; reasons: string[] }[]; never_cross: number };
        speakers: { doctor: number; patient: number; unknown: number };
      };
    };
    expect(job.state).toBe("done");
    const r = job.result;
    expect(r.whisper.model).toBe("large-v3");
    expect(r.lines.length).toBeGreaterThan(20);
    expect(r.speakers.doctor).toBeGreaterThan(5);
    expect(r.speakers.patient).toBeGreaterThan(5);
    expect(r.cards.length).toBeGreaterThan(0);
    const byId = new Map(r.lines.map((l) => [l.id, l]));
    for (const c of r.cards) {
      const l = byId.get(c.line_id)!;
      expect(l, c.id).toBeTruthy();
      expect(c.quote).toBe(l.text); // byte for byte the doctor's sentence as heard
      expect(l.speaker).toBe("doctor");
      expect([c.t_start_ms, c.t_end_ms]).toEqual([l.t_start_ms, l.t_end_ms]);
    }
    expect(r.safety.never_cross).toBe(0);
    expect(r.safety.passed).toBe(r.cards.length);
    console.log(
      `[real-demo] ${SHORTEST}: ${tookS.toFixed(1)} s end to end (Whisper ${(r.whisper.transcribe_ms / 1000).toFixed(1)} s, ${r.whisper.segments} segments); ` +
        `${r.lines.length} lines (doctor ${r.speakers.doctor}, patient ${r.speakers.patient}, unknown ${r.speakers.unknown}); ` +
        `extraction ${r.extraction.source}${r.extraction.provider ? ` ${r.extraction.provider}/${r.extraction.model}` : ""} (+${r.extraction.added}, ${r.extraction.rejected} labels dropped${r.extraction.error ? `, error ${r.extraction.error}` : ""}); ` +
        `cards ${r.cards.length} (${r.cards.filter((c) => c.by === "model").length} from the model), withheld ${r.safety.blocked.length} ${JSON.stringify(r.safety.blocked.map((b) => [b.layer, b.reasons]))}, never_cross ${r.safety.never_cross}`,
    );

    // the page shows the same: every card's quote is one of the doctor's lines in the transcript, with its time
    await expect(page.getByTestId("real-safety")).toHaveAttribute("data-never-cross", "0");
    const cards = page.getByTestId("real-card");
    await expect(cards).toHaveCount(r.cards.length);
    const doctorLines = new Map<string, string>();
    for (const el of await page.locator('[data-testid="real-line"][data-speaker="doctor"]').all()) {
      const id = (await el.getAttribute("data-id"))!;
      doctorLines.set(id, byId.get(id)!.text);
    }
    for (let i = 0; i < r.cards.length; i++) {
      const card = cards.nth(i);
      const lineId = (await card.getAttribute("data-line"))!;
      expect(doctorLines.has(lineId), lineId).toBe(true);
      expect(await card.getByTestId("real-card-quote").textContent()).toBe(doctorLines.get(lineId));
      await expect(card.getByTestId("real-card-time")).toHaveText(/^\d+:\d\d$/);
      await expect(card).toContainText("Doctor (as the dataset marks it)");
    }
    await expect(page.getByTestId("real-credit-en")).toHaveText(MANIFEST.credit.en);

    // acceptance 4.4 on rendered pages: a fresh session's patient, family and backstage pages carry nothing of it
    const s = await createSession(request, { story_day: 8 });
    const markers = [/primock/i, /babylon/i, /day[1-5]_consultation\d{2}/i];
    const heard = r.lines.filter((l) => l.text.split(/\s+/).length >= 8).map((l) => l.text);
    const story = await browser.newContext();
    await story.addCookies([{ name: "rp_session", value: s.id, url: BASE_URL }]);
    const sp = await story.newPage();
    try {
      for (const p of ["/p/today", "/p/meds", "/p/questions", "/f", "/backstage", "/p/visit/v1/review"]) {
        await sp.goto(p);
        const text = await sp.locator("body").innerText();
        for (const m of markers) expect(m.test(text), `${p} mentions ${m}`).toBe(false);
        for (const h of heard) expect(text.includes(h), `${p} shows a demo line`).toBe(false);
      }
    } finally {
      await story.close();
    }
  } finally {
    await context.close();
  }
});
