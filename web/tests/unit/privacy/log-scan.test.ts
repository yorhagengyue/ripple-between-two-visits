/**
 * scripts/check/log-scan.ts, the pure parts (real-app 8.9 日志扫描; C2 track H): the phrases come from the repository's
 * synthetic data (R1-R4, his notes and questions, every visit line, the evaluation's questions), short chance lines are
 * left out, a match is reported by id and line, never by its words; lib/log.ts output never matches.
 */
import { describe, expect, it } from "vitest";
import { logLine } from "@/lib/log";
import { distinctive, normalise, phrases, scanText } from "@/scripts/check/log-scan";

const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";

describe("log-scan", () => {
  it("reads the phrases from the fixtures: R1-R4, his day-37 note, the visit lines, the evaluation's questions", () => {
    const list = phrases();
    const ids = new Set(list.map((p) => p.id));
    for (const id of ["seed:R1", "seed:R2", "seed:R3", "seed:R4", "seed:note:d37", "seed:q-knee-2", "visit:v1-u03", "eval:ex-01"]) expect(ids.has(id), id).toBe(true);
    expect(list.some((p) => p.key === normalise("Sure, no problem."))).toBe(false);
    expect(distinctive("Sure, no problem.")).toBe(false);
    expect(distinctive("我今天好累。")).toBe(true);
    expect(distinctive("好的。")).toBe(false);
  });

  it("finds a phrase in a log line (spacing and case do not hide it) and names it by id and line only", () => {
    const list = phrases(["这个药是做什么的？"]);
    const text = ["[ripple] ok", `[api/ask] failed for "${R4.toUpperCase().replace(/ /g, "  ")}"`, "plain", "问：这个药是做什么的？"].join("\n");
    const hits = scanText("server.log", text, list);
    expect(hits).toEqual([
      { file: "server.log", line: 2, phrase: "seed:R4" },
      { file: "server.log", line: 4, phrase: "also:1" },
    ]);
    expect(JSON.stringify(hits)).not.toContain("dose");
  });

  it("lib/log.ts lines stay clean even when a caller hands them the patient's words", () => {
    const list = phrases();
    const line = logLine("error", "me.export", { route: `/api/me/export?q=${R4}`, code: R4, counts: { files: 1 }, ...({ say: R4, body: "我今天好累。" } as object) });
    expect(scanText("server.log", line, list)).toEqual([]);
  });
});
