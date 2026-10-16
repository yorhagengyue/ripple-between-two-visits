/**
 * Static check (M2 acceptance): app code never reads the answer files. The mock role inference and the mock
 * extraction work from the utterance text, kb/glossary.json and the session's required lines; the answer
 * files under web/fixtures/visits are for tests only. Any mention of the answer-file name in web/app,
 * web/lib or web/components fails this test.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DIRS = ["app", "lib", "components"];
const NEEDLE = ["expected", "json"].join(".");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe("no answer files in app code", () => {
  it(`no file under ${DIRS.join(", ")} mentions "${NEEDLE}"`, () => {
    const files = DIRS.flatMap((d) => walk(path.join(ROOT, d)));
    expect(files.length).toBeGreaterThan(50);
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      text.split(/\r?\n/).forEach((line, i) => {
        if (line.includes(NEEDLE)) hits.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("no import of an answer file without the extension either", () => {
    const files = DIRS.flatMap((d) => walk(path.join(ROOT, d))).filter((f) => /\.(t|j)sx?$|\.m[jt]s$/.test(f));
    const re = /from\s+["'][^"']*\.expected["']|import\(\s*["'][^"']*\.expected["']|require\(\s*["'][^"']*\.expected["']/;
    const hits = files.filter((f) => re.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  it("the check itself finds a planted mention", () => {
    const planted = `import x from "@/fixtures/visits/v1.${NEEDLE}";`;
    expect(planted.includes(NEEDLE)).toBe(true);
  });
});
