/**
 * Real-account helpers for track F's journeys (05 visit, 06 prescription, 08 unknown medicine): a test account made
 * with the foundation's developer tool on the phone itself (POST /api/dev/accounts signs that phone in), the
 * developer test clock, and the stand-in transcription's fixture header. Nothing here is recorded by itself: call these
 * before the first kit.step, or between steps where the caption says what happens.
 */
import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext } from "@playwright/test";
import { waitLive } from "../../helpers";
import type { Phone } from "../_kit";

export const TEST_PASSWORD = "a long test password";

/** Launch options for a journey that records with Chromium's fake microphone: the config's own args plus the fake media. */
export const FAKE_MIC_LAUNCH = {
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--force-device-scale-factor=2",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ],
};

/** Set the app's developer test clock (process-wide on that server). `frozen`: it stands still there. */
export async function setClock(request: APIRequestContext, at: string, opts: { frozen?: boolean } = {}): Promise<string> {
  const res = await request.post("/api/dev/clock", { data: { at, frozen: opts.frozen ?? true } });
  expect(res.status(), `dev clock: ${await res.text()}`).toBe(200);
  return ((await res.json()) as { now: string }).now;
}

export async function clearClock(request: APIRequestContext): Promise<void> {
  await request.post("/api/dev/clock", { data: { clear: true } });
}

/** A new test account on this phone (signed in), with a blank space or Mr Tan's example data. */
export async function newAccount(
  phone: Phone,
  opts: { space: "blank" | "example"; displayName?: string; locale?: "zh-Hans" | "en" },
): Promise<{ userId: string; login: string }> {
  const login = `f${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const res = await phone.context.request.post("/api/dev/accounts", {
    data: { login, password: TEST_PASSWORD, space: opts.space, display_name: opts.displayName ?? "陈先生", locale: opts.locale ?? "zh-Hans" },
  });
  expect(res.status(), `dev account: ${await res.text()}`).toBe(201);
  const body = (await res.json()) as { user_id: string; login: string };
  return { userId: body.user_id, login: body.login };
}

/** Open one of his pages and wait for its live connection (every /p page of an account has one). */
export async function openPage(phone: Phone, pathname: string): Promise<void> {
  await phone.page.goto(pathname);
  await waitLive(phone.page);
}

/** The stand-in transcription (SPEECH_PROVIDER=devfake) hears the visit as this fixture (v1, v2, v3, p1). */
export async function hearAs(phone: Phone, fixture: string | null): Promise<void> {
  await phone.context.setExtraHTTPHeaders(fixture ? { "x-ripple-devfake-fixture": fixture } : {});
}

/** GET one of his own APIs with this phone's cookies. */
export async function getJson<T>(phone: Phone, pathname: string): Promise<T> {
  const res = await phone.context.request.get(pathname);
  expect(res.status(), `${pathname}: ${await res.text()}`).toBe(200);
  return (await res.json()) as T;
}
