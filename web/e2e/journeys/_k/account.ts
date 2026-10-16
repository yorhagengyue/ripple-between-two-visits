/**
 * Real-account helpers for track K's journeys (04 chat, 11 prevention, 12 watch, 13 diet): the developer test clock,
 * a test account made on the phone itself with the foundation's developer tool (POST /api/dev/accounts signs that phone
 * in), his own pages and APIs. Nothing here is recorded by itself: call these before the first kit.step, or between
 * steps where the caption says what happens. (Track F has the same few helpers in ../_f; K keeps its own so the two
 * tracks' scripts never break each other.)
 */
import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext } from "@playwright/test";
import { waitLive } from "../../helpers";
import type { Phone } from "../_kit";

export const TEST_PASSWORD = "a long test password";

/** Set the app's developer test clock (process-wide on that server), frozen there unless `frozen: false`. */
export async function setClock(request: APIRequestContext, at: string, opts: { frozen?: boolean } = {}): Promise<void> {
  const res = await request.post("/api/dev/clock", { data: { at, frozen: opts.frozen ?? true } });
  expect(res.status(), `dev clock: ${await res.text()}`).toBe(200);
}

/** Move the developer test clock forward (it stays frozen when it was). */
export async function advanceClock(request: APIRequestContext, ms: number): Promise<void> {
  const res = await request.post("/api/dev/clock", { data: { advance_ms: ms } });
  expect(res.status(), `dev clock advance: ${await res.text()}`).toBe(200);
}

export async function clearClock(request: APIRequestContext): Promise<void> {
  await request.post("/api/dev/clock", { data: { clear: true } });
}

/** A new test account on this phone (signed in), with Mr Tan's example data or a blank space. */
export async function newAccount(phone: Phone, opts: { space: "blank" | "example"; locale?: "zh-Hans" | "en" } = { space: "example" }): Promise<{ login: string }> {
  const login = `k${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const res = await phone.context.request.post("/api/dev/accounts", {
    data: { login, password: TEST_PASSWORD, space: opts.space, display_name: "陈先生", locale: opts.locale ?? "zh-Hans" },
  });
  expect(res.status(), `dev account: ${await res.text()}`).toBe(201);
  return { login };
}

/** Open one of his pages and wait for its live connection (every /p page of an account has one). */
export async function openPage(phone: Phone, pathname: string): Promise<void> {
  await phone.page.goto(pathname);
  await waitLive(phone.page);
}

/**
 * His morning medicine answered 吃了 now, off screen (POST /api/doses for every medicine with a morning slot, as Today's
 * 吃了 does): for a journey about something else that needs Today's overview in the evening rather than the morning's
 * unanswered reminder.
 */
export async function takeMorningDose(phone: Phone): Promise<void> {
  const { groups } = await getJson<{ groups: { items: { id: string; slots: string[] }[] }[] }>(phone, "/api/meds");
  const morning = groups.flatMap((g) => g.items).filter((m) => m.slots.includes("morning"));
  expect(morning.length).toBeGreaterThan(0);
  for (const m of morning) {
    const res = await phone.context.request.post("/api/doses", { data: { medication_id: m.id, slot: "morning", state: "taken" } });
    expect(res.status(), `dose ${m.id}: ${await res.text()}`).toBeLessThan(300);
  }
}

/** GET one of his own APIs with this phone's cookies. */
export async function getJson<T>(phone: Phone, pathname: string): Promise<T> {
  const res = await phone.context.request.get(pathname);
  expect(res.status(), `${pathname}: ${await res.text()}`).toBe(200);
  return (await res.json()) as T;
}

export interface QuestionSeen {
  id: string;
  for: string;
  origin: string;
  text: string;
  status: string;
}

/** His question list as GET /api/questions answers it (open, answered and set-aside ones together). */
export async function questions(phone: Phone): Promise<QuestionSeen[]> {
  const { list } = await getJson<{ list: { open: QuestionSeen[]; answered: QuestionSeen[]; skipped: QuestionSeen[] } }>(phone, "/api/questions");
  return [...list.open, ...list.answered, ...list.skipped];
}
