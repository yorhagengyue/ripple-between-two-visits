/**
 * The rule that recognises the doctor's R lines in a transcript (lib/visit/extract.ts) compares sentence by sentence
 * with the punctuation inside each sentence (10-09 wave B; round-3 safety check problem 1 (b)). The old compare
 * (sameWords: all punctuation removed) took a transcript line whose sentence boundary moved, for example a pause
 * Whisper read as a full stop ("Please don't. Change the dose yourself. ..."), as R4 with no confirmation, and every
 * later dose refusal quoted that string as the doctor's words. Now such a line is an ordinary line: it is not
 * marked R4 and keeps no claim to the seeded R4 row.
 */
import { describe, expect, it } from "vitest";
import seedTimeline from "@/fixtures/timeline.seed.json";
import { extractItems, type ExtractContext, type ExtractLine } from "@/lib/visit/extract";
import { norm, sameSentence, sameWords } from "@/lib/visit/text";

const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";
const MOVED = [
  "Please don't. Change the dose yourself if your readings are high, write them down and tell me at your next visit.",
  "Please don't. Change the dose yourself. If your readings are high, write them down and tell me at your next visit.",
  "Please don't change the dose yourself if your readings are high. Write them down and tell me at your next visit.",
];

const required = seedTimeline.required_doctor_lines.map((l) => ({
  id: `item-${l.id}`,
  visit_id: l.visit,
  type: (l.id === "R1" ? "target" : l.id === "R2" ? "threshold" : l.id === "R3" ? "purpose" : "instruction") as ExtractContext["requiredLines"][number]["type"],
  text: l.text,
  required_line: l.id as "R1" | "R2" | "R3" | "R4",
  slots: {},
  speaker: "doctor" as const,
}));

const ctx: ExtractContext = { visit: { id: "v2", day: 29, kind: "gp" }, requiredLines: required, priorPrescriptions: ["amlodipine"] };
const line = (text: string): ExtractLine => ({ id: "v2-u08", text, role: "doctor", t_start_ms: 0, t_end_ms: 5000 });

describe("R-line rule matching keeps punctuation", () => {
  it("the seeded R4 is the line the tests use", () => {
    expect(required.find((r) => r.required_line === "R4")?.text).toBe(R4);
  });

  it.each(MOVED)("a moved sentence boundary is not R4: %s", (text) => {
    // the old loose key says it is the same words (this is the hole)
    expect(sameWords(R4, text)).toBe(true);
    expect(norm(text)).toBe(norm(R4));
    expect(sameSentence(R4, text)).toBe(false);
    const items = extractItems([line(text)], 0, ctx);
    expect(items.some((i) => i.required_line === "R4")).toBe(false);
    expect(items.some((i) => i.id === "item-R4")).toBe(false);
  });

  it("the R line said with other case, spacing, quote style or no final full stop is still R4, said in its own visit", () => {
    for (const text of [R4, R4.toLowerCase(), R4.replace("don't", "don’t"), R4.slice(0, -1), `  ${R4.replace(/ /g, "  ")}  `]) {
      expect(sameSentence(R4, text), text).toBe(true);
      const items = extractItems([line(text)], 0, ctx);
      const r4 = items.find((i) => i.required_line === "R4");
      expect(r4, text).toBeDefined();
      expect(r4!.id).toBe("item-R4");
      // the item keeps the words as said in this visit
      expect(r4!.text).toBe(text);
    }
  });

  it("the Mandarin counter line with a moved full stop is not the same sentence", () => {
    expect(sameSentence("忘了吃的话，想起来就吃，但是不要一次吃两粒。", "忘了吃的话，想起来就吃，但是不要。一次吃两粒。")).toBe(false);
    expect(sameSentence("忘了吃的话，想起来就吃，但是不要一次吃两粒。", "忘了吃的话,想起来就吃,但是不要一次吃两粒")).toBe(true);
  });
});

describe("fix round 1: the same sentence ends for R lines as for quotes", () => {
  const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";
  it("a '?' or '!' where the doctor said '.' is another sentence; a line break or decimal never splits one", () => {
    expect(sameSentence(R4, R4.replace("yourself.", "yourself?"))).toBe(false);
    expect(sameSentence(R4, R4.replace("yourself.", "yourself!"))).toBe(false);
    expect(sameSentence(R4, R4.replace("yourself. ", "yourself.\n"))).toBe(true);
    expect(sameSentence(R4, R4.replace("don't change", "don't\nchange"))).toBe(true);
    expect(sameSentence("Amlodipine, 2.5 milligrams, one tablet every morning.", "amlodipine, 2.5 milligrams, one tablet every morning")).toBe(true);
    // only whitespace differs ("2. 5"): the same sentence, and the source's own "2.5" is what is shown
    expect(sameSentence("Amlodipine, 2.5 milligrams, one tablet every morning.", "Amlodipine, 2. 5 milligrams, one tablet every morning.")).toBe(true);
    expect(sameSentence("Amlodipine, 2.5 milligrams, one tablet every morning.", "Amlodipine, 2. Five milligrams, one tablet every morning.")).toBe(false);
  });
});
