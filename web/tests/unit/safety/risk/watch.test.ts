/**
 * risk/watch.ts: the watch state from his own safety records only. Thoughts / danger (or an old self_harm route) keep it on
 * for 7 days, whatever he answers; possible / distress for 72 hours, cleared by a later "no" to the confirm question; a store
 * error is off with a code and a warning that holds no words of his.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONFIRM_NO_ROW, watchState } from "@/lib/safety/risk/watch";
import { getMemoryStore } from "@/lib/store/memory";
import type { SafetyEventRow, Store } from "@/lib/store/types";

const NOW = Date.parse("2026-10-16T12:00:00.000Z");
const H = 3_600_000;

function row(hoursAgo: number, route: string, risk?: Record<string, unknown>, input = "his words"): SafetyEventRow {
  return {
    id: `s-${hoursAgo}-${route}`,
    session_id: "sess",
    input,
    lang: "en",
    route,
    candidates: null,
    layer1: null,
    layer2: null,
    layer3: null,
    output: risk ? { locale: "en", risk } : { locale: "en" },
    blocked: null,
    latency_ms: 1,
    created_at: new Date(NOW - hoursAgo * H).toISOString(),
  };
}
/** A store with these records, oldest first (as listSafetyEvents returns them). */
const storeOf = (rows: SafetyEventRow[]) => ({ listSafetyEvents: async () => [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at)) }) as unknown as Store;
const risk = (ladder: string, extra: Record<string, unknown> = {}) => ({ level: 4, ladder, rows: [], frameSource: "model+rules", watch: { on: false }, ...extra });

afterEach(() => vi.restoreAllMocks());

describe("watchState", () => {
  it("off with no records, or only ordinary ones", async () => {
    expect(await watchState(storeOf([]), "sess", NOW)).toEqual({ on: false });
    expect(await watchState(storeOf([row(2, "explain"), row(5, "log_only", risk("none"))]), "sess", NOW)).toEqual({ on: false });
  });

  it("thoughts 6 days ago: on, since then, ladder_thoughts; 8 days ago: off", async () => {
    expect(await watchState(storeOf([row(6 * 24, "self_harm", risk("thoughts"))]), "sess", NOW)).toEqual({
      on: true,
      since: new Date(NOW - 6 * 24 * H).toISOString(),
      reason: "ladder_thoughts",
    });
    expect((await watchState(storeOf([row(8 * 24, "self_harm", risk("thoughts"))]), "sess", NOW)).on).toBe(false);
  });

  it("an old self_harm route with no risk record (before the harness): on for 7 days, route_self_harm", async () => {
    expect(await watchState(storeOf([row(30, "self_harm")]), "sess", NOW)).toMatchObject({ on: true, reason: "route_self_harm" });
  });

  it("danger wins the reason", async () => {
    const s = storeOf([row(100, "self_harm", risk("thoughts")), row(10, "emergency", risk("danger"))]);
    expect(await watchState(s, "sess", NOW)).toMatchObject({ on: true, reason: "ladder_danger", since: new Date(NOW - 100 * H).toISOString() });
  });

  it("possible 48 hours ago: on; 80 hours ago: off", async () => {
    expect(await watchState(storeOf([row(48, "refuse_route", risk("possible"))]), "sess", NOW)).toMatchObject({ on: true, reason: "ladder_possible" });
    expect((await watchState(storeOf([row(80, "refuse_route", risk("possible"))]), "sess", NOW)).on).toBe(false);
  });

  it("distress in a frame: on for 72 hours", async () => {
    expect(await watchState(storeOf([row(20, "log_only", risk("none", { frame: { distress: "yes" } }))]), "sess", NOW)).toMatchObject({ on: true, reason: "distress" });
  });

  it("a later 'no' to the confirm question clears possible and distress, never thoughts", async () => {
    const no = row(5, "log_only", risk("none", { rows: [`${CONFIRM_NO_ROW}:en`] }));
    expect((await watchState(storeOf([row(20, "refuse_route", risk("possible")), row(10, "log_only", risk("none", { frame: { distress: "yes" } })), no]), "sess", NOW)).on).toBe(false);
    expect(await watchState(storeOf([row(20, "self_harm", risk("thoughts")), no]), "sess", NOW)).toMatchObject({ on: true, reason: "ladder_thoughts" });
    // a possible AFTER his "no" counts again
    expect(await watchState(storeOf([no, row(2, "refuse_route", risk("possible"))]), "sess", NOW)).toMatchObject({ on: true, reason: "ladder_possible" });
  });

  it("a self_harm route whose ladder is possible is the possible part (his 'no' clears it)", async () => {
    const no = row(1, "log_only", risk("none", { rows: [CONFIRM_NO_ROW] }));
    expect((await watchState(storeOf([row(5, "self_harm", risk("possible")), no]), "sess", NOW)).on).toBe(false);
  });

  it("someone else's crisis he reported (the self-harm route, the harness's ladder none): not his, the watch stays off", async () => {
    expect(await watchState(storeOf([row(2, "self_harm", risk("none"))]), "sess", NOW)).toEqual({ on: false });
    expect(await watchState(storeOf([row(2, "self_harm", risk("none", { frame: { about: "other_adult", distress: "yes" } }))]), "sess", NOW)).toEqual({ on: false });
  });

  it("malformed records are skipped", async () => {
    const bad = { ...row(3, "self_harm"), created_at: "not a date" };
    const weird = row(4, "explain", { ladder: 42, rows: "x", frame: "y" } as unknown as Record<string, unknown>);
    expect(await watchState(storeOf([bad, weird]), "sess", NOW)).toEqual({ on: false });
  });

  it("a store error: off, store_error, a warning with the code and none of his words", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const broken = { listSafetyEvents: async () => Promise.reject(new Error("connection refused for I want to die")) } as unknown as Store;
    expect(await watchState(broken, "sess-secret", NOW)).toEqual({ on: false, reason: "store_error" });
    expect(warn).toHaveBeenCalledTimes(1);
    const said = String(warn.mock.calls[0][0]);
    expect(said).toContain("store_error");
    expect(said).not.toMatch(/die|sess-secret/);
  });

  it("reads the memory store's own records", async () => {
    const store = getMemoryStore();
    const session = await store.createSession({ ttl_hours: 1 });
    await store.addSafetyEvent(session.id, { input: "x", route: "explain", output: { risk: risk("possible") } });
    const s = await watchState(store, session.id, Date.now());
    expect(s).toMatchObject({ on: true, reason: "ladder_possible" });
  });
});
