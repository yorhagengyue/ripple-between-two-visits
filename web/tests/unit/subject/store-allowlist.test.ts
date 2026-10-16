/**
 * Direct store access only where it belongs (C2 architecture review, finding 9): every route and page gets the store
 * bound to its subject's scope from lib/subject (requireSubject, getPageSubject). getStore( may appear only in the
 * subject layer itself, the scheduled jobs and the store (plus scripts and tests, which this scan does not read).
 * A new file that reaches for the process-wide store fails here, with its path and line.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB = process.cwd();
const ALLOWED = ["lib/subject/", "lib/jobs/", "lib/store/"];
const ROOTS = ["app", "lib", "components"];
const ROOT_FILES = ["proxy.ts", "instrumentation.ts"];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => path.relative(WEB, p).split(path.sep).join("/");

/** Every `getStore(` outside the allow-list: "path:line". Comments count too (a reference is where the next use starts). */
export function offenders(): string[] {
  const all = [...ROOTS.flatMap((r) => files(path.join(WEB, r))), ...ROOT_FILES.map((f) => path.join(WEB, f))];
  const out: string[] = [];
  for (const file of all) {
    const r = rel(file);
    if (ALLOWED.some((a) => r.startsWith(a))) continue;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // a root file that does not exist
    }
    text.split(/\r?\n/).forEach((line, i) => {
      if (/\bgetStore\s*\(/.test(line)) out.push(`${r}:${i + 1}`);
    });
  }
  return out;
}

describe("getStore() only in the allow-list", () => {
  it("app/, lib/ and components/ reach the store through lib/subject", () => {
    expect(offenders()).toEqual([]);
  });

  it("the scan reads the real folders and would catch a use (sanity)", () => {
    const all = ROOTS.flatMap((r) => files(path.join(WEB, r))).map(rel);
    expect(all).toContain("app/api/doses/route.ts");
    expect(all).toContain("lib/subject/index.ts");
    // the allow-listed places do use it
    expect(readFileSync(path.join(WEB, "lib", "subject", "index.ts"), "utf8")).toMatch(/\bgetStore\(/);
    expect(/\bgetStore\s*\(/.test("const s = getStore();")).toBe(true);
  });
});
