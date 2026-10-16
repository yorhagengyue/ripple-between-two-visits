import { describe, expect, it } from "vitest";
import { illnessWords } from "@/lib/explain/verdict";

describe("illnessWords: the illness names a model's sentence uses (10-14)", () => {
  it("a verb on the blood pressure is no illness", () => {
    expect(illnessWords("布洛芬会升高血压")).toEqual([]);
    expect(illnessWords("这个药可以降低血压")).toEqual([]);
    expect(illnessWords("会提高血压，也会使血压升高")).toEqual([]);
  });

  it("the illness itself still counts, in either language", () => {
    expect(illnessWords("他有高血压")).toEqual(["高血压"]);
    expect(illnessWords("低血压的时候")).toEqual(["低血压"]);
    expect(illnessWords("It is for high blood pressure.").map((w) => w.toLowerCase())).toEqual(["high blood pressure"]);
    // a verb elsewhere in the sentence leaves the illness named after it alone
    expect(illnessWords("升高血压的药，治高血压")).toEqual(["高血压"]);
  });
});
