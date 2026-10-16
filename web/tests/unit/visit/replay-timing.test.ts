/**
 * The realtime replay on the server (no browser): with a speed factor, each caption is published within
 * 1.5 s (replay clock) of its sentence starting, and each card within 5 s of its sentence ending. Timing is
 * measured on the bus events, in wall-clock ms scaled by the speed factor back to the replay clock.
 */
import { describe, expect, it } from "vitest";
import { fixtureUtterances } from "@/lib/asr";
import { getBus, type BusEvent } from "@/lib/bus";
import { getMemoryStore } from "@/lib/store/memory";
import { startVisit } from "@/lib/visit/pipeline";
import { startReplay } from "@/lib/visit/replay";
import type { CardView, VisitView } from "@/lib/visit/types";
import { expectationsOf, expectedAnswers, newSession } from "./helpers";

const SPEED = 10;

describe("realtime replay timing (v1 at 10x)", () => {
  it("captions within 1.5 s of speech start, cards within 5 s of the sentence end, every D0 item extracted", async () => {
    // the first visit on its own day (Day 0): the replay is the visit itself, written in place (on a later day it is a
    // re-watch in a copy, lib/visit/pipeline.ts seedConfirmedBefore)
    const s = await newSession({ story_day: 0 });
    await startVisit(getMemoryStore(), s, { mode: "replay", fixture: "v1" });
    const events: { e: BusEvent; at: number }[] = [];
    const off = getBus().subscribe(s.id, (e) => events.push({ e, at: Date.now() }));
    const r = startReplay(getMemoryStore(), s, "v1", "v1", { speed: SPEED });
    const lines = fixtureUtterances("v1")!;
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 30_000;
      const timer = setInterval(() => {
        if (events.filter((x) => x.e.type === "asr.final").length >= lines.length) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() > deadline) {
          clearInterval(timer);
          reject(new Error("replay did not finish"));
        }
      }, 50);
    });
    off();

    const replayMs = (wall: number) => (wall - r.startedAt) * SPEED;
    for (const u of lines) {
      const first = events.find((x) => (x.e.type === "asr.partial" || x.e.type === "asr.final") && JSON.stringify(x.e.data).includes(`"${u.id}"`))!;
      expect(first, u.id).toBeTruthy();
      expect(replayMs(first.at) - u.t_start_ms, `caption ${u.id}`).toBeLessThanOrEqual(1500);
    }
    const cards = events.filter((x) => x.e.type === "card.created");
    expect(cards.length).toBeGreaterThanOrEqual(7);
    for (const c of cards) {
      const card = (c.e.data as { card: CardView }).card;
      const u = lines.find((l) => l.id === card.anchor)!;
      expect(replayMs(c.at) - u.t_end_ms, `card ${card.id}`).toBeLessThanOrEqual(5000);
    }
    const last = events.filter((x) => x.e.type === "asr.final").at(-1)!.e.data as { view: VisitView };
    expect(last.view.stream.state).toBe("ended");

    const items = await getMemoryStore().listVisitItems(s.id, { visit_id: "v1" });
    for (const a of expectedAnswers("v1")) {
      for (const e of expectationsOf(a.expected_item)) {
        if (e.kind === "item") expect(items.some((it) => it.utterance_ids.includes(a.id) && it.type === e.type), `${a.id} ${e.type}`).toBe(true);
      }
    }
    await getMemoryStore().updateVisit(s.id, "v1", { status: "review" });
  }, 40_000);
});
