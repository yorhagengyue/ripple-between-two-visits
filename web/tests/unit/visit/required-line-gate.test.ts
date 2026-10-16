/**
 * A transcript line whose meaning changed is never relayed as the doctor's R line (10-09 DeepSeek fixer, round 2,
 * the never-cross finding of the round-2 safety check). The live deepseek-flash labelled
 *   "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next
 *    visit, then you may add a tablet."
 * as R4 and the old matcher accepted it; finalizeVisit upserted it as item-R4 and the hero question then showed
 * it first, attributed to the doctor. Two layers now stop that, both deterministic:
 *   1. the matcher's closed rule (lib/visit/model-extract.ts): only function words may differ, so the flipped
 *      line is rejected and item-R4 keeps the seeded words;
 *   2. a required line the model found (slots.extracted_by "model") reaches /api/ask only after he confirms it in
 *      the after-visit review (lib/safety/candidates.ts), like every other extracted item.
 * Everything runs end to end through finalizeVisit, confirmVisit and ask() on the memory store; the "model" is a
 * fake client that labels the given sentence R4, as the live model did.
 */
import { describe, expect, it } from "vitest";
import { fixtureUtterances, getSpeechProvider } from "@/lib/asr";
import { getBus } from "@/lib/bus";
import type { ChatOpts, LlmClient } from "@/lib/llm/types";
import { ask } from "@/lib/safety/pipeline";
import { getMemoryStore } from "@/lib/store/memory";
import { confirmVisit, finalizeVisit, processChunk, startVisit } from "@/lib/visit/pipeline";
import { newSession } from "./helpers";

const SEEDED_R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";
const FLIPPED = [
  "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit, then you may add a tablet.",
  "Please don't change the dose yourself unless your readings are high, then write them down and tell me at your next visit.",
  "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit. Otherwise you can adjust it.",
  "Please change the dose yourself. If your readings are not high, write them down and tell me at your next visit.",
];
const ASR_R4 = "Please don't change the dose by yourself. If your readings are high, write them down and tell me at the next visit.";
const HERO = "今天 150/95，我能不能多吃一粒？";

/** A fake live model that labels v2-u08 as R4 (what deepseek-flash did with the flipped lines) and composes nothing. */
function labelsR4(): LlmClient {
  return {
    provider: "fake-live",
    model: "fake",
    async chat(opts: ChatOpts) {
      const task = (JSON.parse(opts.user) as { task?: string }).task;
      if (task === "extract_items") return { content: JSON.stringify({ items: [{ utterance_id: "v2-u08", type: "instruction", variant: "dose_rule", required_line: "R4" }] }), tokens: 10 };
      return { content: JSON.stringify({ sentences: [] }), tokens: 1 };
    },
  };
}

/** D29 session; v2 replayed with v2-u08 said as `r4Line`, then the whole-visit pass with the fake model. */
async function replayV2With(r4Line: string) {
  process.env.MOCK_ASR_JOB_MS = "0";
  const store = getMemoryStore();
  const s = await newSession({ story_day: 29 });
  await startVisit(getMemoryStore(), s, { mode: "replay", fixture: "v2" });
  await processChunk(getMemoryStore(), s, "v2", fixtureUtterances("v2")!.slice(0, 2));
  const speech = getSpeechProvider();
  const { jobId } = await speech.createFileJob({ url: "fixture:v2", lang: "zh-en-mixed", fixture: "v2" });
  const job = await speech.getFileJob(jobId);
  job.utterances = job.utterances!.map((u) => (u.id === "v2-u08" ? { ...u, text: r4Line } : u));
  await finalizeVisit(getMemoryStore(), s, "v2", job, { llm: labelsR4() });
  const r4 = (await store.listVisitItems(s.id, { required_only: true })).find((i) => i.required_line === "R4")!;
  const changed = getBus()
    .recent(s.id)
    .filter((e) => e.type === "visit.changed")
    .at(-1)!;
  return { s, store, r4, extraction: (changed.data as { extraction: { added: number; rejected: number } }).extraction };
}

async function askHero(sessionId: string) {
  return ask({ sessionId, text: HERO, role: "patient" }, { store: getMemoryStore(), checker: null, checkerReason: "test", publish: () => {}, costGuard: null });
}

describe("a flipped R4 on the transcript is never the doctor's R4", () => {
  for (const line of FLIPPED) {
    it(`rejected and never shown: ${line.slice(0, 80)}`, async () => {
      const { s, r4, extraction } = await replayV2With(line);
      // item-R4 keeps the seeded words; the model's R4 label was dropped
      expect(r4.text).toBe(SEEDED_R4);
      expect(r4.slots?.extracted_by).toBeUndefined();
      expect(extraction.added).toBe(0);
      const res = await askHero(s.id);
      const shown = res.sentences.map((x) => x.en).join("\n");
      expect(shown).not.toContain(line);
      expect(shown).not.toMatch(/add a tablet|adjust it|unless your readings|readings are not high/);
      // the doctor did not say R4 in this recording, so it is not relayed at all (never the flipped words instead)
      expect(res.sentences.some((x) => x.sourceId === "visit:v2:R4")).toBe(false);
      expect(res.route).toBe("refuse_route");
      expect(res.addedQuestionId).toBeTruthy();
    });
  }
});

describe("a model-found R4 (function words only) waits for his confirmation", () => {
  it("found with the transcript's words, not relayed before he confirms, relayed after", async () => {
    const { s, store, r4, extraction } = await replayV2With(ASR_R4);
    expect(r4).toMatchObject({ id: "item-R4", text: ASR_R4, utterance_ids: ["v2-u08"], confirmed_by: null });
    expect(r4.slots?.extracted_by).toBe("model");
    expect(extraction.added).toBe(1);

    const before = await askHero(s.id);
    expect(before.sentences.some((x) => x.sourceId === "visit:v2:R4")).toBe(false);
    expect(before.sentences.map((x) => x.en).join("\n")).not.toContain(ASR_R4);

    const session = (await store.getSession(s.id))!;
    await confirmVisit(getMemoryStore(), session, "v2", { mine: [], items: { "item-R4": "right" } });
    const after = await askHero(s.id);
    const relayed = after.sentences.find((x) => x.sourceId === "visit:v2:R4");
    expect(relayed?.en).toBe(ASR_R4);
    expect(relayed?.attribution).toBe("doctor");
  });

  it("marked wrong in the review: never relayed", async () => {
    const { s, store } = await replayV2With(ASR_R4);
    const session = (await store.getSession(s.id))!;
    await confirmVisit(getMemoryStore(), session, "v2", { mine: [], items: { "item-R4": "wrong" } });
    const res = await askHero(s.id);
    expect(res.sentences.some((x) => x.sourceId === "visit:v2:R4")).toBe(false);
  });

  it("the rules' identical-words R4 still counts at once (the story's own transcript)", async () => {
    const { s, r4 } = await replayV2With(SEEDED_R4);
    expect(r4.text).toBe(SEEDED_R4);
    expect(r4.slots?.extracted_by).toBeUndefined();
    const res = await askHero(s.id);
    expect(res.sentences.find((x) => x.sourceId === "visit:v2:R4")?.en).toBe(SEEDED_R4);
  });
});
