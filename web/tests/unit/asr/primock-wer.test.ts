/** scripts/asr/primock-wer.ts, the pure parts: reference and hypothesis order, the per-consultation score, the averages, the arguments. */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hypothesisText, parseArgs, referenceText, scoreConsultation, summarise } from "@/scripts/asr/primock-wer";

const utt = (t: number, speaker: string, text: string) => ({ t_start_ms: t, t_end_ms: t + 900, speaker, text });

describe("one consultation", () => {
  it("both speakers' utterances in time order make the reference; Whisper's segments in time order the hypothesis", () => {
    const ref = referenceText([utt(3000, "patient", "Hi there!"), utt(1000, "doctor", "Hello?"), utt(5000, "doctor", " Um, how can I help? ")]);
    expect(ref).toBe("Hello? Hi there! Um, how can I help?");
    expect(hypothesisText([{ start_ms: 4000, end_ms: 6000, text: " How can I help?" }, { start_ms: 900, end_ms: 3500, text: "Hello. Hi there." }])).toBe("Hello. Hi there. How can I help?");
  });

  it("scores raw, numbers and full, with the frequent errors under full", () => {
    const r = scoreConsultation(
      "day5_consultation08",
      12.5,
      [utt(0, "patient", "Uh, date of birth twenty second of December, nineteen ninety."), utt(4000, "doctor", "OK, take two puffs.")],
      [{ start_ms: 0, end_ms: 3000, text: "Date of birth 22nd of December 1990." }, { start_ms: 4000, end_ms: 6000, text: "Okay, take two puffs." }],
    );
    expect(r.reference_words).toBe(14);
    expect(r.scores.raw.wer).toBeGreaterThan(r.scores.numbers.wer);
    expect(r.scores.numbers).toMatchObject({ substitutions: 1, deletions: 1, insertions: 0 });
    expect(r.scores.full).toMatchObject({ wer: 0, substitutions: 0, deletions: 0, insertions: 0, ref_words: 13 });
    expect(r.top_errors_full).toEqual([]);
    const s = summarise([r, r]);
    expect(s.full).toMatchObject({ pooled_wer: 0, mean_wer: 0, ref_words: 26 });
    expect(s.raw.ref_words).toBe(28);
  });
});

describe("arguments", () => {
  it("defaults, --ids validated, --rescore, --with-default-hotwords, --out", () => {
    expect(parseArgs([])).toMatchObject({ ids: null, rescore: false, defaultHotwords: false });
    expect(parseArgs([]).out.endsWith(path.join("eval", "results", "primock-wer.json"))).toBe(true);
    expect(parseArgs(["--ids", "day3_consultation08,day1_consultation06", "--rescore", "--with-default-hotwords"])).toMatchObject({
      ids: ["day3_consultation08", "day1_consultation06"],
      rescore: true,
      defaultHotwords: true,
    });
    expect(() => parseArgs(["--ids", "../etc"])).toThrow(/not a PriMock57 consultation id/);
    expect(() => parseArgs(["--out"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--bogus"])).toThrow(/unknown option/);
  });
});
