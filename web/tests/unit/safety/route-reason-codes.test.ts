/**
 * The model's free text never reaches the route reason, the backstage or /api/ask (10-09 wave B; round-3 safety check
 * problem 2). classifyWithModel used to append the model's "reason" (up to 80 characters) to cls.reason, which went
 * into the ask.route event, safety_event.output.routeReason, refusedRequest.rule and the /api/ask JSON; the live
 * model wrote "he can safely have 2 of the white ones tonight" there when the input asked it to. The crisis screen's
 * reason did the same when it raised a route. Now both are codes: model:<provider>, model_error:<code>,
 * model_crisis:<provider>:<emergency|self_harm|none|invalid>.
 */
import { describe, expect, it } from "vitest";
import { LlmError, type ChatOpts, type LlmClient } from "@/lib/llm/types";
import { classifyWithModel, screenCrisisWithModel } from "@/lib/safety/classify";
import { ask } from "@/lib/safety/pipeline";
import { getMemoryStore } from "@/lib/store/memory";
import { frameReply } from "./live-stand-in";

const PLANTED = ["he can safely have 2 of the white ones tonight", "doubling up tonight is fine for him"];

/** A fake live model that answers each task as given and plants text in every "reason" field. */
function planting(answers: { classify?: object | Error; crisis?: object | Error }): LlmClient {
  return {
    provider: "fake-live",
    model: "fake",
    async chat(opts: ChatOpts) {
      const payload = JSON.parse(opts.user) as { task: string; message?: string };
      const task = payload.task;
      const a = task === "classify" ? answers.classify : task === "crisis" || task === "risk_screen" ? answers.crisis : undefined;
      if (a instanceof Error) throw a;
      // (the harness: the risk screen replaced the crisis screen; it answers with the frame of the scripted word)
      if (a && task === "risk_screen") return { content: frameReply(JSON.stringify(a), payload.message ?? ""), tokens: 3 };
      if (a) return { content: JSON.stringify(a), tokens: 3 };
      return { content: JSON.stringify({ sentences: [] }), tokens: 1 };
    },
  };
}

async function askWith(text: string, llm: LlmClient) {
  const store = getMemoryStore();
  const s = await store.createSession({ story_day: 30, ttl_hours: 1 });
  const published: { type: string; say: string; data: unknown }[] = [];
  const res = await ask({ sessionId: s.id, text, role: "patient" }, { store, llm, checker: null, checkerReason: "test", publish: (_sid, type, say, data) => published.push({ type, say, data }), costGuard: null });
  const events = await store.listSafetyEvents(s.id);
  return { res, published, events };
}

// (no rule knows it, so the model classifies it; chit-chat such as the weather is the cant_help rule's since C2)
const NO_RULE = "Can I go swimming on Sunday?";

describe("classifyWithModel keeps codes only", () => {
  it("the model's reason text is dropped; the route and topic still count", async () => {
    const { classification } = await classifyWithModel("hmm", { doctorThresholdSystolic: null, meds: [] }, planting({ classify: { route: "refuse_route", topic: "dose_change", reason: PLANTED[0] } }));
    expect(classification.reason).toBe("model:fake-live");
    expect(classification.route).toBe("refuse_route");
    expect(classification.topics).toContain("dose_change");
    expect(JSON.stringify(classification)).not.toContain("white ones");
  });

  it("an error is its code: LlmError code, or 'error' for anything else (never the message)", async () => {
    const llmErr = await classifyWithModel("hmm", { doctorThresholdSystolic: null, meds: [] }, planting({ classify: new LlmError("timeout", `timed out: ${PLANTED[0]}`, 504) }));
    expect(llmErr.classification.reason).toBe("model_error:timeout");
    const other = await classifyWithModel("hmm", { doctorThresholdSystolic: null, meds: [] }, planting({ classify: new Error(PLANTED[1]) }));
    expect(other.classification.reason).toBe("model_error:error");
  });

  it("the crisis screen's reason is model_crisis:<provider>:<answer>", async () => {
    expect((await screenCrisisWithModel("x", planting({ crisis: { crisis: "self_harm", reason: PLANTED[0] } }))).reason).toBe("model_crisis:fake-live:self_harm");
    expect((await screenCrisisWithModel("x", planting({ crisis: { crisis: "none", reason: PLANTED[1] } }))).reason).toBe("model_crisis:fake-live:none");
    expect((await screenCrisisWithModel("x", planting({ crisis: { crisis: "maybe", reason: PLANTED[1] } }))).reason).toBe("model_crisis:fake-live:invalid");
  });
});

describe("through ask(): nothing the model wrote in a reason field is in the result, the events or safety_event", () => {
  const cases: [string, Parameters<typeof planting>[0]][] = [
    ["a route the model chose", { classify: { route: "uncertain", topic: "other", reason: PLANTED[0] }, crisis: { crisis: "none", reason: PLANTED[1] } }],
    ["a refused request the model chose", { classify: { route: "refuse_route", topic: "dose_change", reason: PLANTED[1] }, crisis: { crisis: "none", reason: PLANTED[0] } }],
    ["a crisis the screen raised", { classify: { route: "uncertain", topic: "other", reason: PLANTED[0] }, crisis: { crisis: "self_harm", reason: PLANTED[1] } }],
  ];
  it.each(cases)("%s", async (_name, answers) => {
    const { res, published, events } = await askWith(NO_RULE, planting(answers));
    // (a route the harness raised, 10-16, names the decision table's row: still a code)
    expect(res.routeReason).toMatch(/^(model(_crisis)?:fake-live(:(emergency|self_harm))?|harness:[a-z0-9-]+)$/);
    const everything = JSON.stringify({ res, published, events });
    for (const p of PLANTED) expect(everything).not.toContain(p);
    const route = published.find((e) => e.type === "ask.route")!;
    expect(route.say).not.toMatch(/white ones|doubling/);
  });

  it("the raised crisis names the decision table's row as the route reason (the harness, 10-16)", async () => {
    const { res } = await askWith(NO_RULE, planting({ classify: { route: "uncertain", topic: "other", reason: PLANTED[0] }, crisis: { crisis: "self_harm", reason: PLANTED[1] } }));
    expect(res.route).toBe("self_harm");
    expect(res.routeReason).toBe("harness:self-harm-thoughts");
  });
});
