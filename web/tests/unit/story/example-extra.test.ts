import { afterEach, describe, expect, it, vi } from "vitest";
import { SIGNAL_REPLY_PREFIX } from "@/lib/daily/signals";
import { buildExampleSpace, EXAMPLE_TODAY_DAY } from "@/lib/story/example";
import { exampleExtraOn, exampleExtraTables } from "@/lib/story/example-extra";

// the extra everyday rows of an example account (owner 10-15: 「顺手多塞一点数据」); off for the rest of the suite
describe("the example account's extra everyday record (lib/story/example-extra.ts)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is on unless RIPPLE_EXAMPLE_EXTRA=off", () => {
    expect(exampleExtraOn({})).toBe(true);
    expect(exampleExtraOn({ RIPPLE_EXAMPLE_EXTRA: "off" })).toBe(false);
  });

  it("is laid out with the template's rows: more readings, notes and two open questions, nothing on or after today", () => {
    vi.stubEnv("RIPPLE_EXAMPLE_EXTRA", "on");
    const space = buildExampleSpace("scope-x", { today: "2026-10-15", nowIso: "2026-10-15T02:00:00.000Z" });
    const t = space.tables;
    expect(t.bp_readings.length).toBe(24 + 28);
    expect(t.notes.length).toBe(2 + 11);
    expect(t.questions.filter((q) => q.id.startsWith("x-")).map((q) => [q.id, q.status])).toEqual([
      ["x-q-night", "open"],
      ["x-q-travel", "open"],
    ]);
    for (const rows of [t.bp_readings, t.notes]) for (const r of rows) expect(r.day).toBeLessThan(EXAMPLE_TODAY_DAY);
    // one reading per day and slot: the extra days never repeat a template reading
    const keys = t.bp_readings.map((b) => `${b.day}-${b.slot}`);
    expect(new Set(keys).size).toBe(keys.length);
    const ids = [...t.bp_readings, ...t.notes].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("after the tablet started his readings sit within the target 135/85, except the four tai chi mornings he missed it (and the evening his question quotes)", () => {
    vi.stubEnv("RIPPLE_EXAMPLE_EXTRA", "on");
    const space = buildExampleSpace("scope-x", { today: "2026-10-15", nowIso: "2026-10-15T02:00:00.000Z" });
    const above = space.tables.bp_readings
      .filter((b) => b.day >= 9 && b.systolic !== null && b.diastolic !== null && (b.systolic > 135 || b.diastolic > 85))
      .map((b) => `${b.day}-${b.slot}`)
      .sort();
    expect(above).toEqual(["15-morning", "17-morning", "24-morning", "29-evening", "36-morning"].sort());
  });

  it("dates each row on its own story day in Singapore; the chest note is a sign kept for his doctor", () => {
    const d0 = "2026-09-03";
    const x = exampleExtraTables("scope-x", d0, EXAMPLE_TODAY_DAY);
    const chest = x.notes.find((n) => n.text.includes("胸口闷"))!;
    expect(chest.day).toBe(38);
    expect(chest.app_reply?.startsWith(SIGNAL_REPLY_PREFIX)).toBe(true);
    // day 38 of a space whose day 0 is 3 Sep is 11 Oct; 19:10 in Singapore is 11:10 UTC
    expect(chest.created_at).toBe("2026-10-11T11:10:00.000Z");
    expect(x.notes.filter((n) => n.app_reply).length).toBe(1);
    // readings stay in the story's own range, nothing near the doctor's warning line
    for (const b of x.bp_readings) {
      expect(b.systolic).toBeGreaterThanOrEqual(125);
      expect(b.systolic).toBeLessThan(160);
    }
    // nothing on day 42 or later is laid out when today is earlier
    expect(exampleExtraTables("scope-x", d0, 30).bp_readings.every((b) => b.day < 30)).toBe(true);
  });
});
