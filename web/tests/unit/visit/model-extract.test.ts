/**
 * Whole-visit item extraction with the main model (lib/visit/model-extract.ts). The model only points at sentence
 * ids and picks labels; code checks every label against the sentence's own words, takes text and time points from
 * the sentence, and merges with the rules (rules win). Any model failure leaves the rules' items. No network: the
 * "model" is a fake client.
 */
import { describe, expect, it } from "vitest";
import { fixtureUtterances, getSpeechProvider } from "@/lib/asr";
import { getBus } from "@/lib/bus";
import type { ChatOpts, LlmClient } from "@/lib/llm/types";
import { getMemoryStore } from "@/lib/store/memory";
import type { VisitItemRow } from "@/lib/store/types";
import { extractItems, type ExtractContext, type ExtractLine } from "@/lib/visit/extract";
import { draftsFromLabels, EXTRACT_SYSTEM, extractPayload, extractWithModel, matchesRequiredLine, mergeDrafts, wordOverlap } from "@/lib/visit/model-extract";
import { finalizeVisit, processChunk, startVisit } from "@/lib/visit/pipeline";
import { newSession, visitItems } from "./helpers";

const R1 = "At home, we want it below 135 over 85.";
const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";

function fakeLlm(answer: (opts: ChatOpts) => string | Promise<string>, calls: ChatOpts[] = []): LlmClient {
  return {
    provider: "fake",
    model: "fake-model",
    async chat(opts) {
      calls.push(opts);
      return { content: await answer(opts), tokens: 10 };
    },
  };
}

const L = (id: string, text: string, role: ExtractLine["role"], t = 0): ExtractLine => ({ id, text, role, t_start_ms: t, t_end_ms: t + 1000 });

async function requiredRows(): Promise<VisitItemRow[]> {
  const s = await newSession();
  return getMemoryStore().listVisitItems(s.id, { required_only: true });
}

async function ctxFor(visitId: string, day: number): Promise<ExtractContext> {
  return { visit: { id: visitId, day, kind: "follow_up" }, requiredLines: await requiredRows(), priorPrescriptions: [] };
}

describe("checks on the model's labels", () => {
  it("keeps only labels the sentence's words support; text and slots come from the sentence", async () => {
    const ctx = await ctxFor("v9", 50);
    const lines = [
      L("v9-u01", "Your blood pressure today is 148 over 92.", "doctor", 1000),
      L("v9-u02", "Can I take it at night?", "patient", 5000),
      L("v9-u03", "We will start a tablet.", "doctor", 9000),
      L("v9-u04", "Amlodipine, 5 milligrams, one tablet every morning.", "doctor", 12000),
      L("v9-u05", "How are you today?", "doctor", 15000),
      L("v9-u06", "My daughter says hello.", "family", 17000),
    ];
    const labels = [
      { utterance_id: "v9-u01", type: "reading", variant: null, systolic: 200 }, // model numbers are ignored
      { utterance_id: "v9-u02", type: "question" },
      { utterance_id: "v9-u03", type: "medication" }, // no medicine named
      { utterance_id: "v9-u04", type: "medication" },
      { utterance_id: "v9-u05", type: "question" }, // a clinician's question is not his question
      { utterance_id: "v9-u06", type: "instruction" }, // family never gets items
      { utterance_id: "v9-u99", type: "reading" }, // invented id
      { utterance_id: "v9-u01", type: "prescribe_more" }, // unknown type
      { utterance_id: "v9-u02", type: "consent" }, // consent belongs to the rules
      "not an object",
    ];
    const { drafts, rejected } = draftsFromLabels(labels, lines, 0, ctx);
    expect(drafts.map((d) => d.id)).toEqual(["v9-u01-reading", "v9-u02-question", "v9-u04-medication-amlodipine"]);
    expect(drafts[0]).toMatchObject({ text: lines[0].text, utterance_ids: ["v9-u01"], slots: { systolic: 148, diastolic: 92, variant: "reading", extracted_by: "model" }, speaker: "doctor" });
    expect(drafts[2].slots).toMatchObject({ drug: "amlodipine", strength: "5 mg", is_new: true });
    expect(rejected.map((r) => r.reason).sort()).toEqual(
      // v9-u99 and the bare string have no sentence; prescribe_more and consent are not model types
      ["no_known_medicine_in_sentence", "wrong_speaker", "wrong_speaker", "unknown_utterance", "unknown_utterance", "unknown_type", "unknown_type"].sort(),
    );
  });

  it("never labels context lines (before fromIndex)", async () => {
    const ctx = await ctxFor("v9", 50);
    const lines = [L("v9-u01", "Come back in two weeks.", "doctor"), L("v9-u02", "Come back in six weeks.", "doctor")];
    const { drafts, rejected } = draftsFromLabels([{ utterance_id: "v9-u01", type: "follow_up" }, { utterance_id: "v9-u02", type: "follow_up" }], lines, 1, ctx);
    expect(drafts.map((d) => d.id)).toEqual(["v9-u02-follow_up"]);
    expect(drafts[0].slots).toMatchObject({ days: 42 });
    expect(rejected).toEqual([{ label: { utterance_id: "v9-u01", type: "follow_up" }, reason: "context_line" }]);
  });

  it("a required line only when the words say it: overlap, every number, the right type", async () => {
    const ctx = await ctxFor("v9", 50);
    const said = L("v9-u01", "At home we want it to be below 135 over 85.", "doctor"); // a word added, punctuation gone
    const other = L("v9-u02", "At home we want it below 140 over 90.", "doctor"); // different numbers
    const r4 = L("v9-u03", "Please don't change the dose by yourself. If your readings are high, write them down and tell me at the next visit.", "doctor");
    const { drafts, rejected } = draftsFromLabels(
      [
        { utterance_id: "v9-u01", type: "target", required_line: "R1" },
        { utterance_id: "v9-u02", type: "target", required_line: "R1" },
        { utterance_id: "v9-u03", type: "lifestyle", required_line: "R4" }, // wrong type for R4
        { utterance_id: "v9-u03", type: "instruction", variant: "dose_rule", required_line: "R4" },
      ],
      [said, other, r4],
      0,
      ctx,
    );
    const req = drafts.filter((d) => d.required_line);
    expect(req.map((d) => [d.required_line, d.utterance_ids[0], d.id])).toEqual([
      ["R1", "v9-u01", "v9-u01-R1"],
      ["R4", "v9-u03", "v9-u03-R4"],
    ]);
    expect(req[0]).toMatchObject({ text: said.text, slots: { systolic: 135, diastolic: 85, variant: "target" } });
    // the R1 claim on different numbers falls back to a plain target item with its own numbers
    expect(drafts.find((d) => d.id === "v9-u02-target")?.slots).toMatchObject({ systolic: 140, diastolic: 90 });
    expect(rejected.filter((r) => r.reason === "required_line_mismatch")).toHaveLength(2);
    expect(matchesRequiredLine(said.text, { text: R1, slots: { systolic: 135, diastolic: 85 } })).toBe(true);
    expect(wordOverlap(R1, R1)).toBe(1);
    expect(wordOverlap("我今天好累", "我今天好累")).toBe(1);
  });

  it("in the visit where the line was seeded, the required line keeps its seeded row id", async () => {
    const ctx = await ctxFor("v2", 8);
    const { drafts } = draftsFromLabels([{ utterance_id: "v2-u08", type: "instruction", required_line: "R4" }], [L("v2-u08", R4, "doctor")], 0, ctx);
    expect(drafts[0]).toMatchObject({ id: "item-R4", required_line: "R4", type: "instruction", slots: { variant: "dose_rule" } });
  });
});

describe("merge: rules first", () => {
  it("rules win every collision; the model adds what the rules missed; a model R line replaces the rules' items of its sentence", async () => {
    const ctx = await ctxFor("v9", 50);
    const lines = [
      L("v9-u01", "Doctor, can I record?", "patient"),
      L("v9-u02", "Sure.", "doctor"),
      L("v9-u03", "Cut down on salt.", "doctor"),
      L("v9-u04", "At home we want it to be below 135 over 85.", "doctor"),
      L("v9-u05", "Your kidneys look okay on the scan.", "doctor"),
    ];
    const rules = extractItems(lines, 0, ctx);
    const model = draftsFromLabels(
      [
        { utterance_id: "v9-u02", type: "instruction" }, // the consent yes belongs to the rules
        { utterance_id: "v9-u03", type: "lifestyle" }, // same as the rules
        { utterance_id: "v9-u04", type: "target", required_line: "R1" },
        { utterance_id: "v9-u05", type: "diagnosis" }, // missed by the rules
      ],
      lines,
      0,
      ctx,
    ).drafts;
    const { drafts, added } = mergeDrafts(rules, model);
    expect(added.map((d) => d.id)).toEqual(["v9-u04-R1", "v9-u05-diagnosis"]);
    expect(drafts.filter((d) => d.utterance_ids[0] === "v9-u04").map((d) => d.id)).toEqual(["v9-u04-R1"]);
    expect(drafts.filter((d) => d.utterance_ids[0] === "v9-u02").map((d) => d.type)).toEqual(["consent"]);
    expect(drafts.filter((d) => d.utterance_ids[0] === "v9-u03").map((d) => d.slots.extracted_by ?? "rules")).toEqual(["rules"]);
  });

  it("a required line the rules already matched is not matched again", async () => {
    const ctx = await ctxFor("v2", 8);
    const lines = [L("v2-u08", R4, "doctor"), L("v2-u09", R4, "doctor")];
    const rules = extractItems(lines, 0, ctx);
    const model = draftsFromLabels([{ utterance_id: "v2-u09", type: "instruction", required_line: "R4" }], lines, 0, ctx).drafts;
    expect(mergeDrafts(rules, model).added).toEqual([]);
  });
});

describe("extractWithModel", () => {
  const lines = [L("v9-u01", "Come back in six weeks.", "doctor")];

  it("sends labels-only instructions and the sentences, and asks for JSON", async () => {
    const ctx = await ctxFor("v9", 50);
    const calls: ChatOpts[] = [];
    const res = await extractWithModel(fakeLlm(() => '{"items":[{"utterance_id":"v9-u01","type":"follow_up"}]}', calls), lines, 0, ctx, { timeoutMs: 1234 });
    expect(res.error).toBeNull();
    expect(res.drafts.map((d) => d.id)).toEqual(["v9-u01-follow_up"]);
    expect(calls[0]).toMatchObject({ system: EXTRACT_SYSTEM, json: true, temperature: 0, timeoutMs: 1234, purpose: "extract" });
    expect(JSON.parse(calls[0].user)).toEqual(extractPayload(lines, 0, ctx));
    expect(EXTRACT_SYSTEM).toMatch(/never write, translate or rephrase/);
  });

  it("never throws: model error, bad JSON and a wrong shape all come back as an error with no drafts", async () => {
    const ctx = await ctxFor("v9", 50);
    const failing = fakeLlm(() => {
      throw new Error("deepseek timed out after 30000 ms");
    });
    for (const [llm, code] of [
      [failing, /model_failed/],
      [fakeLlm(() => "Sure! Here are the items."), /bad_json/],
      [fakeLlm(() => '{"cards":[]}'), /bad_shape/],
    ] as const) {
      const res = await extractWithModel(llm, lines, 0, ctx);
      expect(res.drafts).toEqual([]);
      expect(res.error).toMatch(code);
    }
  });

  it("skips the call when no line could carry an item", async () => {
    const ctx = await ctxFor("v9", 50);
    const calls: ChatOpts[] = [];
    const res = await extractWithModel(fakeLlm(() => "{}", calls), [L("v9-u01", "Hello", "family")], 0, ctx);
    expect(calls).toHaveLength(0);
    expect(res.error).toBeNull();
  });
});

describe("finalizeVisit with a model", () => {
  /** v2 replayed live, then the whole-visit pass with the R4 sentence worded slightly differently (as a transcript can be). */
  async function finalizeWith(llm: LlmClient | null) {
    process.env.MOCK_ASR_JOB_MS = "0";
    const s = await newSession({ story_day: 8 });
    await startVisit(getMemoryStore(), s, { mode: "replay", fixture: "v2" });
    await processChunk(getMemoryStore(), s, "v2", fixtureUtterances("v2")!.slice(0, 2));
    const speech = getSpeechProvider();
    const { jobId } = await speech.createFileJob({ url: "fixture:v2", lang: "zh-en-mixed", fixture: "v2" });
    const job = await speech.getFileJob(jobId);
    const reworded = "Please don't change the dose by yourself. If your readings are high, write them down and tell me at the next visit.";
    job.utterances = job.utterances!.map((u) => (u.id === "v2-u08" ? { ...u, text: reworded } : u));
    await finalizeVisit(getMemoryStore(), s, "v2", job, { llm });
    return { s, items: await visitItems(s.id, "v2"), events: getBus().recent(s.id) };
  }

  it("rules only (no model): the reworded R4 is not found", async () => {
    const { items, events } = await finalizeWith(null);
    expect(items.some((i) => i.required_line === "R4" && i.utterance_ids.includes("v2-u08"))).toBe(false);
    const changed = events.filter((e) => e.type === "visit.changed").at(-1)!;
    expect((changed.data as { extraction: { source: string } }).extraction.source).toBe("rules");
  });

  it("with the model: R4 is found on the reworded sentence, with that sentence's time points; the event says so", async () => {
    const llm = fakeLlm(() => JSON.stringify({ items: [{ utterance_id: "v2-u08", type: "instruction", variant: "dose_rule", required_line: "R4" }] }));
    const { s, items, events } = await finalizeWith(llm);
    const r4 = items.find((i) => i.required_line === "R4")!;
    expect(r4).toMatchObject({ id: "item-R4", utterance_ids: ["v2-u08"] });
    // the item points at the stored sentence, whose time points are the transcript's (the script's: 43.32 s)
    const script = fixtureUtterances("v2")!.find((u) => u.id === "v2-u08")!;
    const stored = (await getMemoryStore().listUtterances(s.id, "v2")).find((u) => u.id === "v2-u08")!;
    expect(stored.text).toMatch(/by yourself/);
    expect(Math.abs(stored.t_start_ms - script.t_start_ms)).toBeLessThanOrEqual(3000);
    const changed = events.filter((e) => e.type === "visit.changed").at(-1)!;
    expect((changed.data as { extraction: Record<string, unknown> }).extraction).toMatchObject({ source: "rules+model", provider: "fake", added: 1, error: null });
    expect(changed.say).toMatch(/fake-model labelled it too \(1 more item/);
  });

  it("a failing model leaves exactly the rules' items and says so", async () => {
    const llm = fakeLlm(() => {
      throw new Error("deepseek timed out after 30000 ms (2 attempts)");
    });
    const failed = await finalizeWith(llm);
    const none = await finalizeWith(null);
    const ids = (xs: VisitItemRow[]) => xs.map((i) => i.id).sort();
    expect(ids(failed.items)).toEqual(ids(none.items));
    const changed = failed.events.filter((e) => e.type === "visit.changed").at(-1)!;
    expect((changed.data as { extraction: { error: string } }).extraction.error).toMatch(/model_failed/);
    expect(changed.say).toMatch(/model labelling failed, rules only/);
  });
});
