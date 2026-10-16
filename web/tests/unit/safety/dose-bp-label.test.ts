/**
 * Owner 10-16 (the demo's fourth beat): 「今天血压一百五十二、九十六，我能不能多吃一粒？」 on the example account (four
 * medicines) relays his doctor's words about the dose and the label of his blood-pressure medicine only, not all four
 * labels. A dose question that names a medicine keeps that medicine's label; one about neither keeps every label.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { createMockLlm } from "@/lib/llm";
import { ask } from "@/lib/safety/pipeline";
import { getMemoryStore } from "@/lib/store/memory";
import { setTestClock } from "@/lib/time/now";

const store = getMemoryStore();
let him: TestAccount;

const AMLODIPINE = "Take ONE tablet every MORNING";
const ALL_FOUR = [AMLODIPINE, "Take TWO tablets twice a day AFTER breakfast and dinner", "Take ONE tablet at BEDTIME", "Take ONE tablet every MORNING AFTER breakfast"];

async function labelsFor(text: string) {
  const res = await ask(
    { sessionId: him.scope!.id, text, role: "patient" },
    { store, llm: createMockLlm(), checker: null, checkerReason: "test", publish: () => {}, costGuard: null },
  );
  return { res, labels: res.sentences.filter((s) => s.sourceId.startsWith("label:")).map((s) => s.en) };
}

beforeAll(async () => {
  // the example's four medicines (off in this suite unless asked for, lib/story/example-meds.ts)
  vi.stubEnv("RIPPLE_EXAMPLE_MEDS", "on");
  setTestClock({ at: "2026-10-15T09:00:00+08:00", frozen: true });
  him = await createAccountWithSpace(store, getAuthProvider(), { login: `d${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  setTestClock({ at: "2026-10-15T13:10:00+08:00", frozen: true });
});
afterAll(() => {
  setTestClock(null);
  vi.unstubAllEnvs();
});

describe("a dose question about his blood pressure", () => {
  it("names no medicine: the doctor's words, the blood-pressure label only, the referral", async () => {
    for (const text of ["今天血压一百五十二、九十六，我能不能多吃一粒？", "My blood pressure is 152/96 today, can I take one more?"]) {
      const { res, labels } = await labelsFor(text);
      expect(res.route, text).toBe("refuse_route");
      // (the whole R4 when he names a high reading: its second sentence is about high readings)
      expect(res.sentences.some((s) => s.sourceId === "visit:v2:R4" && s.en.startsWith("Please don't change the dose yourself.")), text).toBe(true);
      expect(labels, text).toEqual([AMLODIPINE]);
      expect(res.sentences.some((s) => s.templateId === "refer_doctor"), text).toBe(true);
    }
  });

  it("names a medicine: that medicine's label, as before", async () => {
    const { labels } = await labelsFor("今天血压高，metformin 我能不能多吃一粒？");
    expect(labels).toEqual(["Take TWO tablets twice a day AFTER breakfast and dinner"]);
  });

  it("says nothing about blood pressure: every label, as before", async () => {
    const { labels } = await labelsFor("我能不能多吃一粒？");
    expect([...labels].sort()).toEqual([...ALL_FOUR].sort());
  });
});
