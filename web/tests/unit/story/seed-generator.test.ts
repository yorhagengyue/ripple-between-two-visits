/**
 * The seed generator (scripts/data/build_timeline.py) writes exactly the checked-in seed (fixtures/timeline.seed.json),
 * line for line, including the two story-day fields that were added to the seed by hand and that the script did not
 * write before: med-relative-box start_day 8 (round 4; the box shows up at the D8 counter) and q-relative-box
 * created_day 8. Regenerating the seed must not drop them.
 * Needs Python 3 on PATH (python, or the py launcher); skipped without it.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const WEB = process.cwd();
const SCRIPT = path.join(WEB, "scripts", "data", "build_timeline.py");
const SEED = path.join(WEB, "fixtures", "timeline.seed.json");

function findPython(): string[] | null {
  for (const cmd of [["python"], ["python3"], ["py", "-3"]]) {
    const r = spawnSync(cmd[0], [...cmd.slice(1), "-I", "--version"], { encoding: "utf8" });
    if (r.status === 0 && /Python 3/.test(`${r.stdout}${r.stderr}`)) return cmd;
  }
  return null;
}

const python = findPython();
const dir = mkdtempSync(path.join(tmpdir(), "ripple-seed-gen-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("scripts/data/build_timeline.py", () => {
  it.skipIf(!python)("regenerates fixtures/timeline.seed.json byte for byte (keeps the relative's box on D8)", () => {
    const out = path.join(dir, "timeline.seed.json");
    const r = spawnSync(python![0], [...python!.slice(1), "-I", SCRIPT, out], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    // line endings aside (a Windows checkout with core.autocrlf may turn the seed's LF into CRLF), byte for byte
    const lf = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
    const generated = lf(out);
    expect(generated === lf(SEED), "the regenerated seed differs from fixtures/timeline.seed.json").toBe(true);
    const seed = JSON.parse(generated) as { medications: { id: string; start_day?: number }[]; questions: { id: string; created_day?: number }[] };
    expect(seed.medications.find((m) => m.id === "med-relative-box")?.start_day).toBe(8);
    expect(seed.questions.find((q) => q.id === "q-relative-box")?.created_day).toBe(8);
  });
});
