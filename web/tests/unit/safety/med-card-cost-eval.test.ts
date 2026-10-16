import { describe, expect, it } from "vitest";
import { buildMedCard } from "@/lib/safety/med-card";
import { CostGuard, CostLimitError, costLimits } from "@/lib/safety/cost-guard";
import { ask } from "@/lib/safety/pipeline";
import { wilson, scoreCase } from "@/lib/safety/eval";
import { createMockLlm } from "@/lib/llm";
import { getMemoryStore } from "@/lib/store/memory";
import { seedCase, runSeedCase } from "./helpers";

describe("medicine card data", () => {
  it("amlodipine with a confirmed label: purpose, food, missed dose, stopping (leaflet) and dose and time (label), each with its source", async () => {
    const store = getMemoryStore();
    const s = await store.createSession();
    const med = (await store.getMed(s.id, "med-amlodipine"))!;
    expect(med.status).toBe("label_confirmed");
    const card = buildMedCard(med);
    expect(card.awaitingLabel).toBe(false);
    expect(card.leaflet.map((p) => p.key)).toEqual(["purpose", "food", "missed", "stopping"]);
    for (const p of card.leaflet) {
      expect(p.source).toMatchObject({ kind: "leaflet", sourceId: expect.stringMatching(/^hh-amlodipine:/), url: expect.stringContaining("healthhub.sg") });
      expect(p.source.pageDate).toBeTruthy();
      expect(p.zh).toBeTruthy();
    }
    expect(card.label).toMatchObject({
      key: "dose_time",
      en: "Take ONE tablet every MORNING",
      zh: "药品标签：每天早上服用一片。",
      source: { kind: "label", sourceId: "label:med-amlodipine", dispensed: "2026-09-01" },
      check: { pass: true },
    });
    // the draft food and missed-dose wording add a slot their evidence field lacks (web/PROGRESS.md)
    expect(card.leaflet.find((p) => p.key === "purpose")!.check.pass).toBe(true);
  });

  it("before the label is confirmed: only the leaflet parts and the awaiting-label flag", async () => {
    const store = getMemoryStore();
    const s = await store.createSession();
    const med = await store.updateMed(s.id, "med-amlodipine", { status: "awaiting_label" });
    const card = buildMedCard(med);
    expect(card.awaitingLabel).toBe(true);
    expect(card.label).toBeNull();
    expect(card.leaflet).toHaveLength(4);
    const losartan = buildMedCard((await store.getMed(s.id, "med-losartan"))!);
    expect(losartan).toMatchObject({ awaitingLabel: true, label: null });
  });

  it("an unidentified medicine has no leaflet parts", async () => {
    const store = getMemoryStore();
    const s = await store.createSession();
    const card = buildMedCard((await store.getMed(s.id, "med-relative-box"))!);
    expect(card).toMatchObject({ drugId: null, awaitingLabel: true, leaflet: [] });
  });
});

describe("cost guard", () => {
  it("reads limits from the environment with defaults", () => {
    expect(costLimits({})).toEqual({ requestsPerHour: 60, tokensPerDay: 200000 });
    expect(costLimits({ COST_REQ_PER_HOUR: "5", COST_TOKENS_PER_DAY: "100" })).toEqual({ requestsPerHour: 5, tokensPerDay: 100 });
  });

  it("caps requests per session per hour, never crisis answers, and resets after the hour", () => {
    let now = Date.UTC(2026, 9, 9, 10, 0, 0);
    const g = new CostGuard({ requestsPerHour: 2, tokensPerDay: 1000 }, () => now);
    g.admit("a");
    g.admit("a");
    expect(() => g.admit("a")).toThrow(CostLimitError);
    expect(() => g.admit("a", { exempt: true })).not.toThrow();
    g.admit("b"); // other sessions are separate
    now += 3_600_001;
    expect(() => g.admit("a")).not.toThrow();
  });

  it("caps tokens per session per day", () => {
    let now = Date.UTC(2026, 9, 9, 10, 0, 0);
    const g = new CostGuard({ requestsPerHour: 100, tokensPerDay: 50 }, () => now);
    g.admit("a");
    g.addTokens("a", 60);
    const err = (() => {
      try {
        g.admit("a");
      } catch (e) {
        return e as CostLimitError;
      }
    })();
    expect(err?.limit).toBe("tokens_per_day");
    now += 24 * 3_600_000;
    expect(() => g.admit("a")).not.toThrow();
  });

  it("is applied by ask(): over the cap a question is refused but an emergency is still answered", async () => {
    const store = getMemoryStore();
    const s = await store.createSession();
    const guard = new CostGuard({ requestsPerHour: 1, tokensPerDay: 1000 });
    const deps = { store, llm: createMockLlm(), checker: null, publish: () => {}, costGuard: guard };
    await ask({ sessionId: s.id, text: "What is amlodipine for?" }, deps);
    await expect(ask({ sessionId: s.id, text: "What is amlodipine for?" }, deps)).rejects.toBeInstanceOf(CostLimitError);
    const em = await ask({ sessionId: s.id, text: "I have chest pain and my left arm feels heavy" }, deps);
    expect(em.route).toBe("emergency");
  });
});

describe("eval scoring", () => {
  it("Wilson 95% interval", () => {
    expect(wilson(0, 0)).toMatchObject({ rate: null, ci95: null });
    const all = wilson(4, 4);
    expect(all.rate).toBe(1);
    expect(all.ci95![0]).toBeCloseTo(0.51, 2);
    expect(all.ci95![1]).toBe(1);
    const half = wilson(5, 10);
    expect(half.ci95![0]).toBeCloseTo(0.237, 2);
    expect(half.ci95![1]).toBeCloseTo(0.763, 2);
  });

  it("scores a case: route, sources, texts, question", async () => {
    const run = await runSeedCase("dc-01");
    const score = scoreCase(seedCase("dc-01"), run.result, run.questionsAfter > run.questionsBefore);
    expect(score.pass).toBe(true);
    // D29 reuses the seeded q-extra-tablet (M4): the list does not grow, the question is still on it
    expect(run.result).toMatchObject({ questionReused: true, addedQuestionId: "q-extra-tablet" });
    expect(score.checks.find((c) => c.name === "question_added")).toMatchObject({ pass: true, detail: "reused q-extra-tablet" });
    const wrong = scoreCase({ ...seedCase("dc-01"), expected_route: "explain" }, run.result, false);
    expect(wrong.pass).toBe(false);
    expect(wrong.checks.filter((c) => !c.pass).map((c) => c.name)).toEqual(["route"]);
    // neither added nor reused: the question check fails
    const noQuestion = scoreCase({ ...seedCase("dc-01"), expected_route: "explain" }, { ...run.result, questionReused: undefined }, false);
    expect(noQuestion.checks.filter((c) => !c.pass).map((c) => c.name)).toEqual(["route", "question_added"]);
    const claimOnly = scoreCase(seedCase("dc-01"), { ...run.result, addedQuestionId: undefined }, false);
    expect(claimOnly.checks.find((c) => c.name === "question_added")!.pass).toBe(false);
  });
});
