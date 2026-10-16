/**
 * M4 cross-module fix: who said R1-R4 (and any visit line) follows this session's transcript. After a replay of
 * v2 that he has not confirmed, the medicine card (/p/meds/[id]) and /api/ask say 推断：医生 / Inferred: doctor for
 * R3, exactly as the visit screen does; once he confirms the line, all three say 医生说 / Doctor said.
 */
import { describe, expect, it } from "vitest";
import { chipText } from "@/components/visit/labels";
import { createMockLlm } from "@/lib/llm";
import { buildMedCardView } from "@/lib/meds/card";
import { chipFromSentence, chipKindText } from "@/lib/meds/chips";
import { buildCandidates } from "@/lib/safety/candidates";
import { ask } from "@/lib/safety/pipeline";
import type { AskResult } from "@/lib/safety/types";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { confirmVisit, startVisit, processChunk } from "@/lib/visit/pipeline";
import { buildVisitView } from "@/lib/visit/view";
import { fixtureUtterances } from "@/lib/asr";
import { finalizeReplay, newSession, replayLive } from "../visit/helpers";

const R3_ID = "visit:v2:R3";
const R4_ID = "visit:v2:R4";

async function askAs(session: SessionRow, text: string, locale: "en" | "zh-Hans"): Promise<AskResult> {
  return ask(
    { sessionId: session.id, text, locale },
    { store: getMemoryStore(), llm: createMockLlm(), checker: null, checkerReason: "test", publish: () => {}, costGuard: null },
  );
}

/** What the visit screen, the medicine card and /api/ask say about who said a line, in one language. */
async function threeScreens(session: SessionRow, locale: "en" | "zh-Hans") {
  const store = getMemoryStore();
  const view = (await buildVisitView(store, session.id, "v2"))!;
  // the seed end state has no transcript lines on the visit screen (the review shows the R lines as confirmed)
  const line = (id: string) => view.lines.find((l) => l.id === id) ?? { role: "doctor" as const, display: "confirmed" as const };
  const med = (await store.getMed(session.id, "med-amlodipine"))!;
  const card = await buildMedCardView(store, session.id, med, { day: session.story_day, locale });
  const r3Card = card.purpose.find((l) => l.sourceId === R3_ID);
  const why = await askAs(session, locale === "zh-Hans" ? "我感觉很好，为什么还要吃这个药？" : "I feel fine, why do I still take it?", locale);
  const r3Ask = why.sentences.find((s) => s.sourceId === R3_ID);
  const hero = await askAs(session, locale === "zh-Hans" ? "今天 150/95，我能不能多吃一粒？" : "Today 150/95, can I take one more tablet?", locale);
  const r4Ask = hero.sentences.find((s) => s.sourceId === R4_ID);
  return {
    visit: { r3: chipText(locale, line("v2-u06").role, line("v2-u06").display), r4: chipText(locale, line("v2-u08").role, line("v2-u08").display) },
    card: r3Card ? chipKindText(locale, r3Card.chip) : null,
    askR3: r3Ask ? chipKindText(locale, chipFromSentence(r3Ask)) : null,
    askR4: r4Ask ? chipKindText(locale, chipFromSentence(r4Ask)) : null,
    r3Ask,
    r4Ask,
  };
}

describe("R1-R4 follow the session's transcript (visit screen = medicine card = /api/ask)", () => {
  it("seed end state (never replayed): 医生说 everywhere, confirmed", async () => {
    const s = await newSession();
    const set = await buildCandidates(getMemoryStore(), s.id, { day: 29, route: "explain", topics: ["target"] });
    for (const id of ["visit:v1:R1", R3_ID, R4_ID]) expect(set.byId.get(id)!.cite).toMatchObject({ roleState: "confirmed", role: "doctor" });
    const zh = await threeScreens(s, "zh-Hans");
    expect(zh.card).toBe("医生说");
    expect(zh.askR4).toBe("医生说");
  });

  it("replay v2, confirm R4 but leave R3 unconfirmed: R3 is 推断：医生 on all three screens, R4 is 医生说", async () => {
    const s = await newSession();
    await replayLive(s, "v2");
    const done = await finalizeReplay(s, "v2");
    const r4Card = done.cards.find((c) => c.kind === "doc" && c.anchor === "v2-u08")!;
    if (r4Card.kind !== "doc") throw new Error("no R4 card");
    await confirmVisit(getMemoryStore(), s, "v2", { mine: ["v2-u02", "v2-u03", "v2-u10", "v2-u14", "v2-u16"], items: Object.fromEntries(r4Card.rows.map((r) => [r.itemId, "right" as const])) });

    for (const locale of ["zh-Hans", "en"] as const) {
      const out = await threeScreens(s, locale);
      const inferred = locale === "zh-Hans" ? "推断：医生" : "Inferred: doctor";
      const said = locale === "zh-Hans" ? "医生说" : "Doctor said";
      expect(out.visit.r3, locale).toBe(inferred);
      expect(out.card, `${locale} medicine card`).toBe(out.visit.r3);
      expect(out.askR3, `${locale} /api/ask`).toBe(out.visit.r3);
      expect(out.r3Ask!.cite).toMatchObject({ roleState: "inferred", role: "doctor" });
      expect(out.visit.r4, locale).toBe(said);
      expect(out.askR4, `${locale} hero R4`).toBe(said);
      expect(out.r4Ask!.cite).toMatchObject({ roleState: "confirmed", clipUrl: `/api/visits/v2/clip?u=v2-u08&session=${encodeURIComponent(s.id)}` });
    }
  });

  it("right after the replay (nothing confirmed): R4 in the hero answer is 推断：医生, still word for word and playable", async () => {
    const s = await newSession();
    await replayLive(s, "v2");
    await finalizeReplay(s, "v2");
    const out = await threeScreens(s, "zh-Hans");
    expect(out.visit.r4).toBe("推断：医生");
    expect(out.askR4).toBe("推断：医生");
    expect(out.r4Ask!.en).toBe("Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.");
    expect(out.r4Ask!.cite?.clipUrl).toContain("/api/visits/v2/clip?u=v2-u08");
    // confirming R3 turns the card and the answer into 医生说 together with the visit screen
    const view = (await buildVisitView(getMemoryStore(), s.id, "v2"))!;
    const items: Record<string, "right"> = {};
    for (const anchor of ["v2-u06", "v2-u08"]) {
      const c = view.cards.find((x) => x.kind === "doc" && x.anchor === anchor);
      if (c && c.kind === "doc") for (const r of c.rows) items[r.itemId] = "right";
    }
    await confirmVisit(getMemoryStore(), s, "v2", { mine: [], items });
    const after = await threeScreens(s, "zh-Hans");
    expect([after.visit.r3, after.card, after.askR3, after.visit.r4, after.askR4]).toEqual(["医生说", "医生说", "医生说", "医生说", "医生说"]);
  });

  it("a recording that has not reached R4 yet: R4 is not a source at all (not said yet)", async () => {
    const s = await newSession();
    await startVisit(getMemoryStore(), s, { mode: "replay", fixture: "v2" });
    await processChunk(getMemoryStore(), s, "v2", fixtureUtterances("v2")!.slice(0, 4));
    const set = await buildCandidates(getMemoryStore(), s.id, { day: 29, route: "refuse_route", topics: ["dose_change"] });
    expect(set.byId.has(R4_ID)).toBe(false);
    expect(set.byId.has(R3_ID)).toBe(false);
  });

  it("a recorded answer follows the transcript too, unless he linked it himself", async () => {
    const store = getMemoryStore();
    const s = await newSession();
    await replayLive(s, "v2");
    await finalizeReplay(s, "v2");
    // q-knee-1 (seed: doctor's answer at v2, not linked to a transcript line): now inferred
    let set = await buildCandidates(store, s.id, { day: 29, route: "explain", topics: [] });
    const answer = set.list.find((c) => c.span.startsWith("Which one? Bring it next time"))!;
    expect(answer.cite).toMatchObject({ roleState: "inferred" });
    // he links the answer to the line himself (M3's picker / M2's review): his choice stands
    await store.updateQuestion(s.id, "q-knee-1", { answer_utterance_id: "v2-u11", answer_speaker: "doctor" });
    set = await buildCandidates(store, s.id, { day: 29, route: "explain", topics: [] });
    expect(set.list.find((c) => c.span.startsWith("Which one? Bring it next time"))!.cite).toMatchObject({ roleState: "confirmed", role: "doctor" });
  });
});
