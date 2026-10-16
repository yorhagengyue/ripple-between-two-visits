/**
 * The live layer-3 case list (scripts/llm/checker.ts) is honest about where each case is decided, checked offline
 * with a checker that says "supported" to everything: the "1-2" cases must be blocked by the deterministic layers
 * without asking the checker, and the faithful and "3" cases must really reach the checker (so the live run measures
 * the checker on them, not the rules).
 */
import { describe, expect, it } from "vitest";
import type { ChatOpts, LlmClient } from "@/lib/llm/types";
import { verifySentences } from "@/lib/safety/verify";
import { CHECKER_CASES, checkerCandidates, checkerCaseSentence } from "@/scripts/llm/checker";

function yes(calls: ChatOpts[]): LlmClient {
  return { provider: "always-yes", model: "test", chat: async (opts) => (calls.push(opts), { content: '{"supported": true}', tokens: 1 }) };
}

describe("scripts/llm/checker.ts cases", () => {
  it("has faithful, deterministic and checker-only cases, the round-1 three among them", () => {
    expect(CHECKER_CASES.filter((c) => c.expect === "pass").length).toBeGreaterThanOrEqual(3);
    expect(CHECKER_CASES.filter((c) => c.layer === "3").length).toBeGreaterThanOrEqual(5);
    expect(CHECKER_CASES.filter((c) => c.name.startsWith("round 1:"))).toHaveLength(3);
  });

  for (const c of CHECKER_CASES) {
    it(`${c.name}: decided at ${c.expect === "pass" ? "layer 3" : `layer ${c.layer}`}`, async () => {
      const { cands, cleanup } = await checkerCandidates();
      const calls: ChatOpts[] = [];
      const { verdicts } = await verifySentences([checkerCaseSentence(c, cands)], { candidates: cands.byId, checker: yes(calls), checkerReason: null });
      const v = verdicts[0];
      if (c.expect === "pass" || c.layer === "3") {
        expect(v.layer3?.needed, `${v.sentence.en} -> ${JSON.stringify([...v.layer1.reasons, ...(v.layer2?.reasons ?? [])])}`).toBe(true);
        expect(calls).toHaveLength(1);
        // the checker always sees the whole source
        expect(JSON.parse(calls[0].user).source).toBe(cands.byId.get(v.sentence.sourceId)!.span);
      } else {
        expect([1, 2], v.sentence.en).toContain(v.blockedBy);
        expect(calls).toHaveLength(0);
      }
      await cleanup();
    });
  }
});
