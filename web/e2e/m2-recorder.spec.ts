/**
 * M2 recording (Chromium's fake microphone): consent -> record -> End visit. The browser makes a 16 kHz mono
 * WAV with an AudioWorklet and uploads it through the signed link; no request ever carries audio/webm, and
 * the upload route refuses WebM outright. Also: declining consent goes to "photograph the label".
 */
import { expect, test } from "@playwright/test";
import { api, closeAll, createSession, openDevice } from "./helpers";

test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
  permissions: ["microphone"],
});

test("recording on D0: the upload is a 16 kHz mono WAV, never WebM; the visit keeps it", async ({ browser, request }) => {
  test.setTimeout(120_000);
  const s = await createSession(request, { story_day: 0 });
  const phone = await openDevice(browser, s.id, "/p/visit?speed=10");
  const page = phone.page;
  await phone.context.grantPermissions(["microphone"]);

  const audioTypes: string[] = [];
  page.on("request", (r) => {
    const ct = r.headers()["content-type"] ?? "";
    if (ct.startsWith("audio/") || ct.startsWith("video/")) audioTypes.push(ct);
  });

  await page.getByTestId("consent-yes").click();
  await expect(page.getByTestId("visit-screen")).toBeVisible();
  await expect(page.getByTestId("visit-kicker")).toHaveText("看诊 · 正在听");
  await expect(page.getByTestId("visit-consent")).toBeVisible();
  // the story clock has no time on this day: no time is shown (never the device's wall clock)
  await expect(page.getByTestId("visit-consent")).toHaveText("已同意录音");
  await expect(page.getByTestId("visit-pause")).toBeVisible({ timeout: 10_000 }); // the microphone is recording
  // live captions while recording (mock speech replays the D0 script)
  await expect(page.getByTestId("line-v1-u03")).toBeVisible({ timeout: 30_000 });

  const upload = page.waitForRequest((r) => r.url().includes("/api/blob/upload") && r.method() === "PUT");
  await page.getByTestId("visit-end").click();
  const put = await upload;
  expect(put.headers()["content-type"]).toBe("audio/wav");
  // the local upload route only answers 200 after checking the bytes really are RIFF/WAVE (WebM is refused)
  expect((await put.response())?.status()).toBe(200);
  const rec = (await page.evaluate(() => window.__rpLastRecording))!;
  expect(rec).toMatchObject({ type: "audio/wav", sampleRate: 16000 });
  expect(rec.durationMs).toBeGreaterThan(500);
  const head = Buffer.from(rec.header);
  expect(head.subarray(0, 4).toString("ascii")).toBe("RIFF");
  expect(head.subarray(8, 12).toString("ascii")).toBe("WAVE");
  expect(head.readUInt16LE(20)).toBe(1); // PCM
  expect(head.readUInt16LE(22)).toBe(1); // mono
  expect(head.readUInt32LE(24)).toBe(16_000);
  expect(head.readUInt16LE(34)).toBe(16);

  await page.waitForURL(/\/p\/visit\/v1\/review$/, { timeout: 30_000 });
  const view = (await (await request.get(`/api/visits/v1?session=${s.id}`)).json()).view;
  expect(view.visit.audioPath).toMatch(new RegExp(`^${s.id}/visits/v1/recording-.+\\.wav$`));
  expect(audioTypes.filter((t) => t.includes("webm"))).toEqual([]);
  expect(audioTypes).toContain("audio/wav");
  await closeAll([phone]);
});

test("the upload route refuses WebM for a recording, with or without codecs", async ({ request }) => {
  const s = await createSession(request, { story_day: 0 });
  await api(request, "/api/visits", s.id, { mode: "record", consent: { given: true } });
  for (const ct of ["audio/webm", "audio/webm;codecs=opus", "video/webm"]) {
    const res = await request.post(`/api/upload-url?session=${s.id}`, { data: { kind: "recording", content_type: ct, visit_id: "v1" } });
    expect(res.status(), ct).toBe(415);
  }
  const ok = await request.post(`/api/upload-url?session=${s.id}`, { data: { kind: "recording", content_type: "audio/wav", visit_id: "v1" } });
  expect(ok.status()).toBe(200);
});

test("the doctor says no: no recording, go and photograph the label", async ({ browser, request }) => {
  const s = await createSession(request);
  const phone = await openDevice(browser, s.id, "/p/visit");
  await phone.page.getByTestId("consent-no").click();
  await expect(phone.page.getByTestId("visit-declined")).toBeVisible();
  await expect(phone.page.getByTestId("visit-photo-label")).toHaveAttribute("href", "/p/meds/add");
  await closeAll([phone]);
});
