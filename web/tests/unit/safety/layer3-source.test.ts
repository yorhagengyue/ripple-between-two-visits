/**
 * Layer 3 sees the whole source, and layers 1-2 catch app-worded claims before it (10-09 DeepSeek fixer, defects 1
 * and 5 of the round-1 check).
 *
 * The live deepseek-v4-pro checker passed three app-worded sentences because it was shown only the fragment the
 * generator picked: "Chest pain (angina) is not something it treats." (from "chest pain (angina) is not mentioned"),
 * "Most people have no trouble with the medicine." (lifted out of a paragraph about liver injury) and "... missed
 * only 3." (a minimising "only" on his own record). And any whole sentence of a kb evidence field could be shown as a
 * quote. Now: the three are blocked by the deterministic layers even when the checker says yes to everything, the
 * checker is sent the whole candidate span (the fragment only as a hint), evidence text is never a quote, and the
 * checks of one answer run in parallel and stop at the caller's deadline.
 */
import { describe, expect, it } from "vitest";
import { createDecidingChecker } from "@/lib/llm";
import type { ChatOpts, LlmClient } from "@/lib/llm/types";
import { buildCandidates, type CandidateSet } from "@/lib/safety/candidates";
import { modelWordingHits, judgementHits } from "@/lib/safety/judgement";
import type { Sentence } from "@/lib/safety/types";
import { originOf, supportPayload, verifySentences } from "@/lib/safety/verify";
import { getMemoryStore } from "@/lib/store/memory";

async function candidatesAt(day: number): Promise<CandidateSet> {
  const store = getMemoryStore();
  const s = await store.createSession({ story_day: day, ttl_hours: 1 });
  return buildCandidates(store, s.id, { day, route: "explain", topics: ["purpose", "side_effects", "readings_summary"] });
}

const said = (sourceId: string, span: string, en: string, attribution?: Sentence["attribution"]): Sentence => ({ speechAct: "restate", sourceId, span, slots: {}, en, attribution });

/** A checker that says "supported" to anything and records what it was sent. */
function yesChecker(calls: ChatOpts[] = []): LlmClient {
  return {
    provider: "always-yes",
    model: "test",
    async chat(opts) {
      calls.push(opts);
      return { content: '{"supported": true, "reason": "same meaning"}', tokens: 3 };
    },
  };
}

describe("the three sentences the live checker passed are blocked before layer 3", () => {
  it("even with a checker that says yes to everything", async () => {
    const cands = await candidatesAt(29);
    const purpose = cands.byId.get("hh-amlodipine:amlodipine.purpose")!;
    const allergy = cands.byId.get("hh-amlodipine:amlodipine.allergy")!;
    const doseLog = cands.byId.get("log:dose:med-amlodipine")!;
    expect(purpose && allergy && doseLog).toBeTruthy();
    // "From Day 9 to Day 29: 18 taken, 3 missed, 0 unconfirmed." -> the sentence the check wrote, with the record's own numbers
    const [, from, to, taken, missed] = /Day (\d+) to Day (\d+): (\d+) taken, (\d+) missed/.exec(doseLog.span)!;
    const sentences = [
      said(purpose.sourceId, "chest pain (angina) is not mentioned", "Chest pain (angina) is not something it treats.", "leaflet"),
      said(allergy.sourceId, "most people have no trouble with the medicine", "Most people have no trouble with the medicine.", "leaflet"),
      said(doseLog.sourceId, doseLog.span, `From Day ${from} to Day ${to} you took ${taken} doses and missed only ${missed}.`),
    ];
    const calls: ChatOpts[] = [];
    const { verdicts } = await verifySentences(sentences, { candidates: cands.byId, checker: yesChecker(calls), checkerReason: null });
    for (const v of verdicts) {
      expect(v.pass, v.sentence.en).toBe(false);
      expect([1, 2], v.sentence.en).toContain(v.blockedBy);
    }
    expect(calls, "the checker was never needed").toHaveLength(0);
    expect(verdicts[0].layer2?.judgement?.map((j) => j.category)).toContain("efficacy");
    // a verbatim lift of the reviewer-facing evidence stops at layer 1; its words would also stop it at layer 2
    expect(verdicts[1].layer1.reasons).toContain("evidence_not_patient_facing");
    expect(modelWordingHits(verdicts[1].sentence.en).map((h) => h.category)).toContain("minimising");
    expect(verdicts[2].layer2?.judgement?.map((j) => j.word)).toContain("only");
  });

  it("the new claim words apply to model wording only; the doctor's measuring-line filter (judgementHits) is unchanged", () => {
    expect(modelWordingHits("you missed only 3").map((h) => h.category)).toContain("minimising");
    expect(modelWordingHits("it is not mentioned").map((h) => h.category)).toContain("absence");
    expect(judgementHits("Just measure it twice a day, morning and night.")).toEqual([]);
  });
});

describe("a leaflet source is shown only as its reviewed restatement", () => {
  it("a whole sentence of the kb evidence is blocked at layer 1 (evidence_not_patient_facing)", async () => {
    const cands = await candidatesAt(29);
    const allergy = cands.byId.get("hh-amlodipine:amlodipine.allergy")!;
    const quote = "The page adds that the odds of this are very small and that most people have no trouble with the medicine.";
    expect(allergy.span).toContain(quote);
    const s = said(allergy.sourceId, quote, quote, "leaflet");
    expect(originOf(s, allergy)).toBe("model");
    const { verdicts } = await verifySentences([s], { candidates: cands.byId, checker: yesChecker(), checkerReason: null });
    expect(verdicts[0]).toMatchObject({ pass: false, blockedBy: 1 });
    expect(verdicts[0].layer1.reasons).toContain("evidence_not_patient_facing");
  });

  it("the restatement itself still passes without the checker", async () => {
    const cands = await candidatesAt(29);
    const purpose = cands.byId.get("hh-amlodipine:amlodipine.purpose")!;
    const s = said(purpose.sourceId, purpose.span, purpose.restatement!.en, "leaflet");
    const { verdicts } = await verifySentences([s], { candidates: cands.byId, checker: null, checkerReason: "none" });
    expect(verdicts[0]).toMatchObject({ pass: true, blockedBy: null });
    expect(verdicts[0].layer3).toMatchObject({ needed: false });
  });
});

describe("what the checker is sent", () => {
  it("the whole candidate span as the source; the generator's fragment only as a hint", async () => {
    const cands = await candidatesAt(29);
    const purpose = cands.byId.get("hh-amlodipine:amlodipine.purpose")!;
    const fragment = "The leaflet describes amlodipine as a medicine that brings blood pressure down";
    const s = said(purpose.sourceId, fragment, "Amlodipine is a blood pressure medicine.", "leaflet");
    const calls: ChatOpts[] = [];
    const { verdicts } = await verifySentences([s], { candidates: cands.byId, checker: yesChecker(calls), checkerReason: null });
    expect(verdicts[0].layer3).toMatchObject({ needed: true, pass: true });
    expect(calls).toHaveLength(1);
    const payload = JSON.parse(calls[0].user);
    expect(payload).toEqual({ task: "support", source: purpose.span, fragment, sentence: s.en });
    expect(calls[0].system).toMatch(/whole SOURCE/);
    expect(calls[0].system).toMatch(/does not mention X/);
    // no fragment when the sentence cites the whole span
    expect(supportPayload({ ...s, span: purpose.span }, purpose)).toEqual({ task: "support", source: purpose.span, sentence: s.en });
  });

  it("a deciding checker decides on the whole source, not the fragment", async () => {
    const cands = await candidatesAt(29);
    const purpose = cands.byId.get("hh-amlodipine:amlodipine.purpose")!;
    const seen: string[] = [];
    const checker = createDecidingChecker((source) => {
      seen.push(source);
      return source.includes("Lowering blood pressure is the only purpose the page gives");
    });
    const s = said(purpose.sourceId, "The leaflet describes amlodipine as a medicine that brings blood pressure down", "Amlodipine is a blood pressure medicine.", "leaflet");
    const { verdicts } = await verifySentences([s], { candidates: cands.byId, checker, checkerReason: null });
    expect(seen).toEqual([purpose.span]);
    expect(verdicts[0].pass).toBe(true);
  });
});

describe("parallel checks and the caller's deadline", () => {
  const slowChecker = (ms: number): LlmClient => ({
    provider: "slow",
    model: "test",
    async chat(opts) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        opts.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(Object.assign(new Error("stopped at the caller's deadline"), { code: "deadline" }));
        });
      });
      return { content: '{"supported": true}', tokens: 1 };
    },
  });

  it("three borderline sentences are checked at the same time", async () => {
    const cands = await candidatesAt(29);
    const purpose = cands.byId.get("hh-amlodipine:amlodipine.purpose")!;
    const s = (en: string) => said(purpose.sourceId, purpose.span, en, "leaflet");
    const t0 = Date.now();
    const { verdicts } = await verifySentences([s("Amlodipine is a blood pressure medicine."), s("It is a medicine for blood pressure."), s("This medicine is for blood pressure.")], {
      candidates: cands.byId,
      checker: slowChecker(300),
      checkerReason: null,
    });
    expect(Date.now() - t0).toBeLessThan(800);
    expect(verdicts.map((v) => v.index)).toEqual([0, 1, 2]);
    expect(verdicts.every((v) => v.pass)).toBe(true);
  });

  it("a check still running at the deadline is blocked (fail closed)", async () => {
    const cands = await candidatesAt(29);
    const purpose = cands.byId.get("hh-amlodipine:amlodipine.purpose")!;
    const t0 = Date.now();
    const { verdicts } = await verifySentences([said(purpose.sourceId, purpose.span, "Amlodipine is a blood pressure medicine.", "leaflet")], {
      candidates: cands.byId,
      checker: slowChecker(5000),
      checkerReason: null,
      signal: AbortSignal.timeout(100),
    });
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(verdicts[0]).toMatchObject({ pass: false, blockedBy: 3 });
    expect(verdicts[0].layer3?.reasons).toEqual(["checker_error"]);
  });
});
