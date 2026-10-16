import { describe, expect, it, vi } from "vitest";
import { Bus, getBus, toSseFrame, type BusEvent } from "@/lib/bus";

describe("bus", () => {
  it("delivers events only to the same session, in the spec shape", () => {
    const bus = new Bus();
    const a: BusEvent[] = [];
    const b: BusEvent[] = [];
    bus.subscribe("A", (e) => a.push(e));
    bus.subscribe("B", (e) => b.push(e));

    const ev = bus.publish("A", "dose.logged", "Mr Tan ticked taken", { day: 29 });
    expect(a).toEqual([ev]);
    expect(b).toEqual([]);
    expect(ev).toMatchObject({ type: "dose.logged", session_id: "A", say: "Mr Tan ticked taken", data: { day: 29 } });
    expect(Number.isNaN(Date.parse(ev.at))).toBe(false);
  });

  it("unsubscribes and keeps a per-session history for replay", () => {
    const bus = new Bus();
    const seen: number[] = [];
    const off = bus.subscribe("A", (e) => seen.push(e.id));
    const e1 = bus.publish("A", "clock.changed", "Day 8", {});
    off();
    const e2 = bus.publish("A", "clock.changed", "Day 9", {});
    bus.publish("B", "clock.changed", "other session", {});
    expect(seen).toEqual([e1.id]);
    expect(bus.listenerCount("A")).toBe(0);
    expect(bus.recent("A").map((e) => e.id)).toEqual([e1.id, e2.id]);
    expect(bus.recent("A", { sinceId: e1.id }).map((e) => e.id)).toEqual([e2.id]);
    expect(bus.recent("A", { limit: 1 }).map((e) => e.id)).toEqual([e2.id]);
  });

  it("caps history at 200 events per session", () => {
    const bus = new Bus();
    for (let i = 0; i < 250; i++) bus.publish("A", "asr.partial", `p${i}`, null);
    const recent = bus.recent("A");
    expect(recent).toHaveLength(200);
    expect(recent[0].say).toBe("p50");
  });

  it("keeps going when one listener throws", () => {
    const bus = new Bus();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const got: string[] = [];
    bus.subscribe("A", () => {
      throw new Error("boom");
    });
    bus.subscribe("A", (e) => got.push(e.say));
    bus.publish("A", "director.cue", "reminder now", {});
    expect(got).toEqual(["reminder now"]);
    spy.mockRestore();
  });

  it("is a process-wide singleton and frames events as SSE", () => {
    expect(getBus()).toBe(getBus());
    const frame = toSseFrame({ id: 7, type: "bp.logged", session_id: "A", at: "t", say: "多行\n文字", data: {} });
    expect(frame.startsWith("id: 7\ndata: ")).toBe(true);
    expect(frame.endsWith("\n\n")).toBe(true);
    expect(frame.split("\n")).toHaveLength(4); // id, data, blank, blank
    expect(JSON.parse(frame.split("\n")[1].slice("data: ".length)).say).toBe("多行\n文字");
  });
});
