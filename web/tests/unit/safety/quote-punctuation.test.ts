/**
 * Layer 1's verbatim test keeps punctuation (10-09 wave B, item 2 blocker; round-3 safety check problem 1).
 *
 * The old compare (normalizeForCompare: every punctuation mark removed) let a quote with a moved sentence boundary
 * pass as the source's own words, skip layer 3 and the judgement check, and be shown as the generator wrote it:
 *   - R4 "Please don't. Change the dose yourself if your readings are high, ..." attributed to visit:v2:R4;
 *   - the leaflet restatement "... Do not. Double up to make up for the missed one.";
 *   - the paracetamol restatement "The leaflet says not to. Use two products that both contain paracetamol ...";
 *   - the counter's line 「忘了吃的话，想起来就吃，但是不要。一次吃两粒。」.
 * Now a quote is compared sentence by sentence with the punctuation inside each sentence (only case, whitespace,
 * quote style and the mark that ends a sentence are ignored), and a sentence that is a quote is shown in the source's
 * own words, never the generator's string. Every test here is offline (mock model, no checker).
 */
import { describe, expect, it } from "vitest";
import type { ComposedSentence, ComposePayload } from "@/lib/llm/protocol";
import { buildCandidates } from "@/lib/safety/candidates";
import { renderText } from "@/lib/safety/render";
import { getMemoryStore } from "@/lib/store/memory";
import { loadConfirmedTranscripts } from "@/scripts/eval";
import { isWholeSentencesOf, matchWholeSentences, normalizeForCompare, quoteKey, sameQuote } from "@/lib/safety/text";
import type { Candidate, Sentence } from "@/lib/safety/types";
import { originOf, sourceWords, verifySentences } from "@/lib/safety/verify";
import { runAsk } from "./helpers";

const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";
const R4_MOVED = "Please don't. Change the dose yourself if your readings are high, write them down and tell me at your next visit.";
const MISSED = "The leaflet says: if you forget a dose, take it when you remember, then take the next one at the usual time. Do not double up to make up for the missed one.";
const MISSED_MOVED = "The leaflet says: if you forget a dose, take it when you remember, then take the next one at the usual time. Do not. Double up to make up for the missed one.";
const PARA = "The leaflet says not to use two products that both contain paracetamol at the same time.";
const PARA_MOVED = "The leaflet says not to. Use two products that both contain paracetamol at the same time.";
const COUNTER = "忘了吃的话，想起来就吃，但是不要一次吃两粒。";
const COUNTER_MOVED = "忘了吃的话，想起来就吃，但是不要。一次吃两粒。";

const REPRODUCTIONS: [string, string, string][] = [
  ["R4", R4, R4_MOVED],
  ["leaflet missed dose", MISSED, MISSED_MOVED],
  ["paracetamol combination", PARA, PARA_MOVED],
  ["the counter's missed-dose line", COUNTER, COUNTER_MOVED],
];

describe("the verbatim test keeps punctuation", () => {
  it.each(REPRODUCTIONS)("%s: the moved boundary is not the source (the old punctuation-blind key said it was)", (_name, source, moved) => {
    // the hole: the old key equates them, so these tests exercise exactly what slipped through
    expect(normalizeForCompare(moved)).toBe(normalizeForCompare(source));
    expect(isWholeSentencesOf(source, moved)).toBe(false);
    expect(matchWholeSentences(source, moved)).toBeNull();
    expect(sameQuote(source, moved)).toBe(false);
  });

  it("case, whitespace, quote style and a missing or different final mark still match, and the source's text comes back as written", () => {
    expect(matchWholeSentences(R4, R4.toUpperCase())).toBe(R4);
    expect(matchWholeSentences(R4, R4.replace(/ /g, "  ").replace("don't", "don’t"))).toBe(R4);
    expect(matchWholeSentences(R4, R4.slice(0, -1))).toBe(R4);
    expect(matchWholeSentences(R4, "please don't change the dose yourself")).toBe("Please don't change the dose yourself.");
    expect(matchWholeSentences(R4, "If your readings are high, write them down and tell me at your next visit.")).toBe(
      "If your readings are high, write them down and tell me at your next visit.",
    );
    expect(matchWholeSentences("Take ONE tablet every MORNING", "Take one tablet every morning.")).toBe("Take ONE tablet every MORNING");
    expect(matchWholeSentences(COUNTER, "忘了吃的话,想起来就吃,但是不要一次吃两粒")).toBe(COUNTER);
    expect(sameQuote("“Noted.”", '"noted"')).toBe(true);
  });

  it("a fragment, an addition, a dropped comma or a merged sentence is not the source", () => {
    expect(isWholeSentencesOf(R4, "your readings are high")).toBe(false);
    expect(isWholeSentencesOf(R4, `${R4} But an extra is fine today.`)).toBe(false);
    expect(isWholeSentencesOf(R4, "Please don't change the dose yourself. If your readings are high write them down and tell me at your next visit.")).toBe(false);
    expect(isWholeSentencesOf(R4, "Please don't change the dose yourself if your readings are high, write them down and tell me at your next visit.")).toBe(false);
    expect(quoteKey("Do not double up.")).toBe("donotdoubleup");
    expect(quoteKey("Do not. Double up.")).not.toBe(quoteKey("Do not double up."));
  });
});

/** Every candidate source on Day 43 with all four visits' transcripts confirmed (as never-cross-probes does). */
async function allCandidates(): Promise<Map<string, Candidate>> {
  const store = getMemoryStore();
  const session = await store.createSession({ story_day: 43, ttl_hours: 1 });
  await loadConfirmedTranscripts(store, session.id);
  const set = await buildCandidates(store, session.id, { day: 43, route: "explain", topics: ["threshold"] });
  await store.deleteSession(session.id);
  return set.byId;
}

/** The real candidate whose words (span or restatement) are `words`. */
function candidateFor(all: Map<string, Candidate>, words: string): Candidate {
  const c = [...all.values()].find((x) => x.span === words || x.restatement?.en === words);
  if (!c) throw new Error(`no candidate for ${words}`);
  return c;
}

const sentence = (c: Candidate, en: string): Sentence => ({ speechAct: "restate", sourceId: c.sourceId, span: c.span, slots: {}, en, attribution: c.attribution });

describe("layers 1-3 on the four reproductions (no checker: a model sentence fails closed)", () => {
  // [name, source words, moved boundary, layer that stops it, a reason it gives]
  const cases: [string, string, string, 1 | 2, string][] = [
    // a spoken line is relayed word for word or not at all
    ["R4", R4, R4_MOVED, 1, "quote_not_verbatim"],
    // a leaflet line in other words is the model's own wording: its directive and its "not" are judged as such
    ["leaflet missed dose", MISSED, MISSED_MOVED, 2, "directive_not_verbatim"],
    ["paracetamol combination", PARA, PARA_MOVED, 2, "judgement_word"],
    ["the counter's line", COUNTER, COUNTER_MOVED, 1, "quote_not_verbatim"],
  ];
  it.each(cases)("%s with a moved boundary is the model's sentence and is blocked at layer %s", async (_name, words, moved, layer, reason) => {
    const all = await allCandidates();
    const c = candidateFor(all, words);
    const s = sentence(c, moved);
    expect(originOf(s, c)).toBe("model");
    expect(sourceWords(s, c)).toBeNull();
    const { verdicts } = await verifySentences([s], { candidates: all, checker: null, checkerReason: "test" });
    expect(verdicts[0].pass).toBe(false);
    expect(verdicts[0].blockedBy).toBe(layer);
    expect([...verdicts[0].layer1.reasons, ...(verdicts[0].layer2?.reasons ?? [])]).toContain(reason);
    expect(verdicts[0].layer3).toBeNull();
    expect(verdicts[0].sentence.en).toBe(moved);
  });

  it.each(cases)("%s as the source wrote it (any case, spacing, final mark) passes and is shown in the source's words", async (_name, words) => {
    const all = await allCandidates();
    const c = candidateFor(all, words);
    const sloppy = words.toLowerCase().replace(/[.。]$/, "");
    const s = sentence(c, sloppy);
    expect(originOf(s, c)).toBe(c.kind === "patient_text" ? "patient_text" : "span");
    const { verdicts } = await verifySentences([s], { candidates: all, checker: null, checkerReason: "test" });
    expect(verdicts[0], `${verdicts[0].layer1.reasons} ${verdicts[0].layer2?.reasons}`).toMatchObject({ pass: true, blockedBy: null });
    expect(verdicts[0].sentence.en).toBe(words);
  });
});

/** A mock-model injection: one extra sentence citing `sourceId`, with the given text and that candidate's span. */
function injectOne(sourceId: string, en: string, seen: { found: boolean }) {
  return (payload: ComposePayload): ComposedSentence[] => {
    const c = payload.candidates.find((x) => x.sourceId === sourceId);
    if (!c) return [];
    seen.found = true;
    return [{ speechAct: "restate", sourceId, span: c.span, slots: {}, en, attribution: c.attribution ?? "doctor" }];
  };
}

describe("through ask(): the moved-boundary quote never reaches the screen", () => {
  const runs: [string, string, number, string, string, string][] = [
    ["R4 on a why-take question", "Why do I need to take amlodipine?", 29, "visit:v2:R4", R4_MOVED, "Please don't."],
    ["the leaflet's missed-dose line", "I forgot my morning tablet, what should I do?", 29, "hh-amlodipine:amlodipine.missed", MISSED_MOVED, "Do not. Double"],
  ];
  it.each(runs)("%s", async (_name, text, day, sourceId, moved, marker) => {
    const seen = { found: false };
    const run = await runAsk({ text, locale: "en", day }, { inject: injectOne(sourceId, moved, seen) });
    expect(seen.found, `${sourceId} is a candidate for "${text}" (otherwise this proves nothing)`).toBe(true);
    for (const loc of ["en", "zh-Hans"] as const) {
      const out = renderText(run.result, loc);
      expect(out, loc).not.toContain(marker);
    }
    for (const s of run.result.sentences) expect(s.en).not.toBe(moved);
    const blocked = run.result.blocked.find((b) => b.sentence.sourceId === sourceId && b.sentence.en === moved);
    expect(blocked, "the moved quote is blocked, not dropped silently").toBeDefined();
    expect(blocked!.layer).toBeGreaterThanOrEqual(1);
  });

  it("the paracetamol restatement with a moved boundary is not shown on a combination question", async () => {
    const seen = { found: false };
    const run = await runAsk({ text: "Can I take Panadol together with my cold medicine?", locale: "en", day: 43 }, { inject: injectOne("hh-paracetamol:paracetamol.no_double", PARA_MOVED, seen) });
    expect(seen.found, "the restatement is a candidate (otherwise this proves nothing)").toBe(true);
    for (const loc of ["en", "zh-Hans"] as const) expect(renderText(run.result, loc)).not.toContain("not to. Use");
    for (const s of run.result.sentences) expect(s.en).not.toBe(PARA_MOVED);
    // the refused-request path keeps one sentence per source (the composer's own restatement wins); if the moved one
    // reached the checks, it was blocked
    const reached = run.result.blocked.filter((b) => b.sentence.en === PARA_MOVED);
    for (const b of reached) expect(b.layer).toBeGreaterThanOrEqual(1);
  });

  it("a quote the generator wrote in lower case without its full stop is shown as the doctor said it", async () => {
    const seen = { found: false };
    const lower = R4.toLowerCase().slice(0, -1);
    const run = await runAsk({ text: "Why do I need to take amlodipine?", locale: "en", day: 29 }, { inject: injectOne("visit:v2:R4", lower, seen) });
    expect(seen.found).toBe(true);
    const r4 = run.result.sentences.filter((s) => s.sourceId === "visit:v2:R4");
    expect(r4.length).toBeGreaterThan(0);
    for (const s of r4) expect(s.en).toBe(R4);
    expect(renderText(run.result, "en")).not.toContain(lower);
  });
});
