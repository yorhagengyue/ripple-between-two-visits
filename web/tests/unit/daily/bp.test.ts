/**
 * Blood pressure (task M4 item 3, literal requirement): before the doctor said a number (R1) there is no
 * comparison line at all; from D1 his readings sit next to R1, word for word with its date and time point; no word
 * like 偏高 / 正常 / high / normal / good.
 */
import { describe, expect, it } from "vitest";
import { GET as bpGet, POST as bpPost } from "@/app/api/bp/route";
import { getBus } from "@/lib/bus";
import { bpView } from "@/lib/daily/bp";
import { dt, type DailyKey } from "@/lib/daily/i18n";
import { chipDetail, chipText } from "@/lib/daily/lines";
import { getMemoryStore } from "@/lib/store/memory";
import { startVisit } from "@/lib/visit/pipeline";
import { finalizeReplay, replayLive } from "../visit/helpers";
import { getReq, JUDGEMENT_WORDS_BP, postReq, sessionAt } from "./helpers";

const R1 = "At home, we want it below 135 over 85.";

function noJudgement(text: string) {
  for (const w of JUDGEMENT_WORDS_BP) expect(text.toLowerCase(), `"${w}" in: ${text}`).not.toContain(w.toLowerCase());
}

describe("blood pressure screen data", () => {
  it("D0 (the doctor has not given a number before today): no comparison line, no readings yet", async () => {
    const s = await sessionAt(0, "09:30");
    const v = await bpView(getMemoryStore(), s);
    expect(v.target).toBeNull();
    expect(v.readings).toEqual([]);
  });

  it("D0 visit being recorded (R1 not said yet): no line, also on D1 while the recording has not reached R1", async () => {
    const store = getMemoryStore();
    const s = await sessionAt(0, "09:30");
    await startVisit(getMemoryStore(), s, { mode: "record" });
    expect((await bpView(store, s)).target).toBeNull();
    await store.setStoryDay(s.id, 1, "07:40");
    expect((await bpView(store, (await store.getSession(s.id))!)).target).toBeNull();
  });

  it("from D1: R1 word for word, with its date, time point and stand-in clip; readings up to the story day", async () => {
    const s = await sessionAt(1, "07:40");
    const v = await bpView(getMemoryStore(), s);
    expect(v.target).toMatchObject({
      sourceId: "visit:v1:R1",
      text: R1,
      systolic: 135,
      diastolic: 85,
      date: "2026-08-24",
      tStartMs: 49520,
      standInVoice: true,
      clipUrl: `/api/visits/v1/clip?u=v1-u08&session=${encodeURIComponent(s.id)}`,
    });
    expect(chipText("zh-Hans", v.target!.chip)).toBe("医生说");
    expect(chipDetail("zh-Hans", v.target!.chip)).toBe("2026年8月24日 · 0:49 处 · 代录音");
    expect(chipDetail("en", v.target!.chip)).toBe("24 Aug 2026 · at 0:49 · stand-in recording");
    expect(v.readings.map((r) => [r.day, r.slot, r.systolic, r.diastolic])).toEqual([
      [1, "morning", 137, 93],
      [1, "evening", 141, 94],
    ]);
  });

  it("D29: nothing after the story day; the reading that was not taken (D3 evening) is unconfirmed", async () => {
    const s = await sessionAt(29, "20:15");
    const v = await bpView(getMemoryStore(), s);
    expect(v.readings.every((r) => r.day <= 29)).toBe(true);
    expect(v.readings.at(-1)).toMatchObject({ day: 29, slot: "evening", systolic: 150, diastolic: 95 });
    expect(v.readings.find((r) => r.day === 3 && r.slot === "evening")).toMatchObject({ state: "unconfirmed", systolic: null });
    expect(v.target?.text).toBe(R1);
  });

  it("after a replay of v1 he has not confirmed, R1 shows as 推断：医生 (same as the visit screen); the measuring words come with their state", async () => {
    const s = await sessionAt(29);
    await replayLive(s, "v1");
    await finalizeReplay(s, "v1");
    const v = await bpView(getMemoryStore(), s);
    expect(chipText("zh-Hans", v.target!.chip)).toBe("推断：医生");
    expect(chipText("en", v.target!.chip)).toBe("Inferred: doctor");
    expect(v.measuring.map((m) => m.text)).toEqual([
      "Sit down, rest five minutes first. Arm on the table, at the level of your heart. No coffee or smoking for half an hour before. Take two readings each time and write down the average.",
    ]);
    expect(chipText("zh-Hans", v.measuring[0].chip)).toBe("推断：医生");
  });

  it("no word on this screen judges a reading (every UI word of the page, both languages, and R1)", () => {
    const keys: DailyKey[] = ["bp.doctorNumber", "bp.lineLabel", "bp.onlyRecord", "bp.readings", "bp.chart", "bp.empty", "bp.unconfirmed", "bp.slot.morning", "bp.slot.evening", "bp.measuring", "bp.record.title", "bp.record.top", "bp.record.bottom", "bp.record.save", "bp.record.saved", "bp.record.invalid", "bp.unit"];
    for (const locale of ["zh-Hans", "en"] as const) for (const k of keys) noJudgement(dt(locale, k, { s: 135, d: 85 }));
    noJudgement(R1);
  });
});

describe("/api/bp", () => {
  it("POST records a reading for the story day (slot from the clock) and publishes bp.logged; GET returns the screen data", async () => {
    const s = await sessionAt(43, "20:30");
    const res = await bpPost(postReq("/api/bp", s.id, { systolic: 141, diastolic: 88 }));
    expect(res.status).toBe(201);
    expect((await res.json()).reading).toMatchObject({ day: 43, slot: "evening", systolic: 141, diastolic: 88, state: "recorded" });
    expect(getBus().recent(s.id).map((e) => e.type)).toEqual(["bp.logged"]);
    const missed = await bpPost(postReq("/api/bp", s.id, { state: "unconfirmed", slot: "morning" }));
    expect((await missed.json()).reading).toMatchObject({ state: "unconfirmed", systolic: null });
    const view = await (await bpGet(getReq("/api/bp", s.id))).json();
    // sorted by day, then slot: the morning that was not taken, then the evening reading
    expect(view.readings.slice(-2).map((r: { slot: string; state: string }) => [r.slot, r.state])).toEqual([
      ["morning", "unconfirmed"],
      ["evening", "recorded"],
    ]);
    expect(view.target.text).toBe(R1);
    noJudgement(JSON.stringify(view.readings));
  });

  it("rejects half a reading and unknown fields", async () => {
    const s = await sessionAt(29);
    expect((await bpPost(postReq("/api/bp", s.id, { systolic: 141 }))).status).toBe(400);
    expect((await bpPost(postReq("/api/bp", s.id, { systolic: 141, diastolic: 88, note: "high" }))).status).toBe(400);
  });
});
