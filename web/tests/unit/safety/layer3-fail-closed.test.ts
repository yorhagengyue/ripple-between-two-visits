/**
 * Layer 3 with the DeepSeek checker wiring (overnight plan item 2): whatever goes wrong with the checker - a
 * timeout, a 5xx, a reply that is not {"supported": true}, the spend cap - the borderline sentence is blocked and
 * ask() replaces it with the referral template and adds a question. No network: the checker is the real
 * OpenAI-compatible client with a fake fetch.
 */
import { describe, expect, it } from "vitest";
import { createCompatClient, LlmError } from "@/lib/llm";
import type { CompatConfig } from "@/lib/llm/openai";
import { SpendLedger } from "@/lib/llm/spend";
import { evidenceFor, getPatientText } from "@/lib/kb/load";
import { renderText } from "@/lib/safety/render";
import type { Candidate, Sentence } from "@/lib/safety/types";
import { layer3, verifySentences } from "@/lib/safety/verify";
import { runAsk } from "./helpers";

const ev = evidenceFor(getPatientText("amlodipine.purpose")!)!;
const PURPOSE: Candidate = { sourceId: "hh-amlodipine:amlodipine.purpose", kind: "patient_text", span: ev.en, attribution: "leaflet", topics: ["purpose"], drugs: ["amlodipine"] };
const PARAPHRASE: Sentence = { speechAct: "restate", sourceId: PURPOSE.sourceId, span: ev.en, slots: {}, en: "Amlodipine is a blood pressure medicine.", attribution: "leaflet" };

function checkerCfg(over: Partial<CompatConfig> = {}): CompatConfig {
  return {
    name: "deepseek",
    vendor: "deepseek",
    baseUrl: "https://api.deepseek.com",
    apiKey: "sk-test",
    model: "deepseek-v4-pro",
    maxTokensField: "max_tokens",
    jsonMode: true,
    extraBody: { thinking: { type: "disabled" } },
    timeoutMs: 30,
    maxAttempts: 1,
    ledger: null,
    ...over,
  };
}

const answer = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 80, completion_tokens: 8, total_tokens: 88 } }), { status: 200 });

const hanging = (_url: string, init: RequestInit) =>
  new Promise<Response>((_res, reject) => {
    init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })));
  });

const FAILURES: [string, (url: string, init: RequestInit) => Promise<Response>, Partial<CompatConfig>?][] = [
  ["timeout", hanging],
  ["server error", async () => new Response("overloaded", { status: 503 })],
  ["not JSON", async () => answer("Yes, it is supported.")],
  ["supported is not a literal true", async () => answer('{"supported":"yes","reason":"ok"}')],
  ["empty answer (cut off)", async () => answer("")],
  ["auth failure", async () => new Response("bad key", { status: 401 })],
];

describe("layer 3 fails closed with the DeepSeek checker", () => {
  it("passes a supported paraphrase when the checker says a literal true (control)", async () => {
    const checker = createCompatClient(checkerCfg(), async () => answer('{"supported": true, "reason": "same meaning"}'));
    const r = await layer3(PARAPHRASE, PURPOSE, checker, null);
    expect(r).toMatchObject({ pass: true, needed: true, checker: "deepseek" });
  });

  for (const [name, fetchImpl] of FAILURES) {
    it(`blocks the sentence on ${name}`, async () => {
      const checker = createCompatClient(checkerCfg(), fetchImpl);
      const { verdicts } = await verifySentences([PARAPHRASE], { candidates: new Map([[PURPOSE.sourceId, PURPOSE]]), checker, checkerReason: null });
      expect(verdicts[0]).toMatchObject({ pass: false, blockedBy: 3 });
      expect(verdicts[0].layer3!.reasons.some((r) => r === "checker_error" || r === "checker_not_supported")).toBe(true);
    });
  }

  it("blocks when the spend cap is reached (the checker is never called)", async () => {
    let sent = 0;
    const ledger = new SpendLedger({ file: null, capUsd: 0, windowMs: 86_400_000 });
    const checker = createCompatClient(checkerCfg({ ledger }), async () => {
      sent++;
      return answer('{"supported": true}');
    });
    const r = await layer3(PARAPHRASE, PURPOSE, checker, null);
    expect(r).toMatchObject({ pass: false, reasons: ["checker_error"] });
    expect(String((r.detail as { error?: string }).error)).toMatch(/spend cap/);
    expect(sent).toBe(0);
  });

  it("a verbatim quote never needs the checker (a dead checker cannot block R4)", async () => {
    const r4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";
    const cand: Candidate = { sourceId: "visit:v2:R4", kind: "visit", span: r4, attribution: "doctor", instruction: true };
    const checker = createCompatClient(checkerCfg(), hanging);
    const r = await layer3({ speechAct: "restate", sourceId: cand.sourceId, span: r4, slots: {}, en: r4, attribution: "doctor" }, cand, checker, null);
    expect(r).toMatchObject({ pass: true, needed: false });
  });

  it("through ask(): a checker timeout blocks the paraphrase, the referral replaces it and a question is added", async () => {
    const checker = createCompatClient(checkerCfg(), hanging);
    const t0 = Date.now();
    const run = await runAsk({ text: "What is amlodipine for?", locale: "en", day: 29 }, { inject: () => [PARAPHRASE], checker });
    expect(Date.now() - t0).toBeLessThan(5000);
    const { result } = run;
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0]).toMatchObject({ layer: 3, reasons: expect.arrayContaining(["checker_error"]) });
    expect(renderText(result, "en")).not.toContain(PARAPHRASE.en);
    expect(result.sentences.some((s) => s.origin === "template" && s.speechAct === "referral")).toBe(true);
    expect(run.questionsAfter).toBe(run.questionsBefore + 1);
    // the safety event names the checker and how independent it is
    const layer3Event = result.events[0].layer3 as { checker: string | null; checkerModel: string | null };
    expect(layer3Event).toMatchObject({ checker: "deepseek", checkerModel: "deepseek-v4-pro" });
    expect(run.events.some((e) => e.type === "ask.blocked" && /layer 3/.test(e.say))).toBe(true);
  });

  it("LlmError codes reach the safety event as a short message, never the request", async () => {
    const checker = createCompatClient(checkerCfg(), async () => new Response("bad key", { status: 401 }));
    const r = await layer3(PARAPHRASE, PURPOSE, checker, null);
    const msg = String((r.detail as { error?: string }).error);
    expect(msg).toMatch(/API key rejected/);
    expect(msg).not.toContain(PARAPHRASE.en);
    expect(new LlmError("timeout", "x", 504).code).toBe("timeout");
  });
});
