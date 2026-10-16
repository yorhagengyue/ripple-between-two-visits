/**
 * Track H's helpers for journey 15 (我的数据) and its page checks (e2e/h-pages.spec.ts). Nothing here is recorded by
 * itself: call them before the first kit.step, or between steps where the caption says what happens.
 *
 *   recordVisit(api, { fixture, wav })   a visit of his recorded through the same calls his visit screen makes (track F):
 *                                        POST /api/visits (after the consent card), the recording uploaded through
 *                                        POST /api/upload-url and its signed link, POST /api/asr/jobs with the recording;
 *                                        with SPEECH_PROVIDER=devfake the stand-in transcription turns it into the
 *                                        fixture's text (finalize); with mock it waits for its transcript. Either way the
 *                                        visit has his recording in his storage folder.
 * A family link is track D's: e2e/journeys/_d/family.ts linkFamily (his invitation, her acceptance, his confirmation)
 * and setSwitches; her own /f page writes each look into his access log.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type APIRequestContext } from "@playwright/test";

export const H_PASSWORD = "a long test password";

/** A stand-in clip from web/fixtures (16 kHz mono WAV): used as the bytes of a recorded visit. */
export function fixtureWav(name: "v1-u08" | "v1-u09" | "v2-u06" | "v2-u08"): Buffer {
  return readFileSync(path.join(__dirname, "..", "..", "..", "fixtures", "visits", "clips", `${name}.wav`));
}

export interface RecordedVisit {
  id: string;
  /** his recording's path in his storage folder */
  recording: string;
  status: string;
}

/** One visit recorded through his visit screen's own calls (see the header). The app's test clock names its day. */
export async function recordVisit(api: APIRequestContext, opts: { fixture: "v1" | "v2" | "p1"; wav: Buffer }): Promise<RecordedVisit> {
  const started = await api.post("/api/visits", { data: { mode: "record", consent: { given: true } } });
  expect(started.status(), `start visit: ${await started.text()}`).toBe(200);
  const id = ((await started.json()) as { visit: { id: string } }).visit.id;
  const link = await api.post("/api/upload-url", { data: { kind: "recording", content_type: "audio/wav", visit_id: id } });
  expect(link.status(), `upload link: ${await link.text()}`).toBe(200);
  const up = (await link.json()) as { url: string; path: string; headers: Record<string, string> };
  const put = await api.put(up.url, { data: opts.wav, headers: up.headers });
  expect(put.status(), `upload: ${await put.text()}`).toBeLessThan(300);
  const job = await api.post("/api/asr/jobs", { data: { visit_id: id, audio_path: up.path }, headers: { "x-ripple-devfake-fixture": opts.fixture } });
  expect(job.status(), `transcript job: ${await job.text()}`).toBe(200);
  const j = (await job.json()) as { job_id: string | null; status: string };
  if (j.job_id) {
    await expect
      .poll(async () => ((await (await api.get(`/api/asr/jobs/${j.job_id}?visit_id=${id}`)).json()) as { status: string }).status, { timeout: 30_000 })
      .toBe("done");
    const fin = await api.post(`/api/visits/${id}/finalize`, { data: { job_id: j.job_id } });
    expect(fin.status(), `finalize: ${await fin.text()}`).toBe(200);
  }
  const view = (await (await api.get(`/api/visits/${id}`)).json()) as { view: { visit: { status: string } } };
  return { id, recording: up.path, status: view.view.visit.status };
}

/** A test account on this context (POST /api/dev/accounts signs it in). */
export async function devAccount(api: APIRequestContext, opts: { prefix: string; space: "blank" | "example" | "none"; displayName: string; locale?: "zh-Hans" | "en" }): Promise<{ userId: string; login: string }> {
  const login = `${opts.prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const res = await api.post("/api/dev/accounts", { data: { login, password: H_PASSWORD, space: opts.space, display_name: opts.displayName, locale: opts.locale ?? "zh-Hans" } });
  expect(res.status(), `dev account: ${await res.text()}`).toBe(201);
  const body = (await res.json()) as { user_id: string; login: string };
  return { userId: body.user_id, login: body.login };
}

/** The app's developer test clock (process-wide on that server). */
export async function setClock(request: APIRequestContext, at: string): Promise<void> {
  const res = await request.post("/api/dev/clock", { data: { at, frozen: true } });
  expect(res.status(), `dev clock: ${await res.text()}`).toBe(200);
}

export async function clearClock(request: APIRequestContext): Promise<void> {
  await request.post("/api/dev/clock", { data: { clear: true } });
}

/** One pass of track H's retention job, now (POST /api/dev/tick names only it, so no other job runs). */
export async function tickRetention(request: APIRequestContext): Promise<Record<string, number>> {
  const res = await request.post("/api/dev/tick", { data: { names: ["privacy.retention"] } });
  expect(res.status(), `tick: ${await res.text()}`).toBe(200);
  const r = (await res.json()) as { reports: { job: string; outcome: string; counts: Record<string, number> }[] };
  const mine = r.reports.find((x) => x.job === "privacy.retention");
  expect(mine?.outcome, JSON.stringify(r.reports)).toBe("ran");
  return mine!.counts;
}
