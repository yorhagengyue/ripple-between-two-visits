/* eslint-disable react/no-children-prop -- createElement(X, props) without JSX: the props types require `children`, so it goes in props */
/**
 * <Said> cannot be used without a source.
 * - Type level: tests/unit/ui/said-source.check.tsx compiles with zero errors (so every @ts-expect-error in
 *   it is consumed), and the same file with the directives removed has exactly one error per directive,
 *   each "source" related. `npm run typecheck` enforces the fixture too.
 * - Runtime: a caller that gets around the type (plain JS, `as any`) gets an exception, not an
 *   unsourced quote.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { Said } from "@/components/ui/Said";

const WEB = process.cwd();
const FIXTURE = path.join(WEB, "tests", "unit", "ui", "said-source.check.tsx");
const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();

function compilerOptions(): ts.CompilerOptions {
  const configPath = path.join(WEB, "tsconfig.json");
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, WEB, undefined, configPath);
  return { ...parsed.options, noEmit: true, incremental: false, tsBuildInfoFile: undefined };
}

function diagnosticsFor(text: string): ts.Diagnostic[] {
  const options = compilerOptions();
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) =>
    norm(fileName) === norm(FIXTURE)
      ? ts.createSourceFile(fileName, text, languageVersion, true, ts.ScriptKind.TSX)
      : original(fileName, languageVersion, onError, shouldCreate);
  const program = ts.createProgram({ rootNames: [FIXTURE], options, host });
  const file = program.getSourceFiles().find((f) => norm(f.fileName) === norm(FIXTURE));
  if (!file) throw new Error("fixture not in program");
  return [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)];
}

const lineOf = (d: ts.Diagnostic) => (d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line : -1);
const message = (d: ts.Diagnostic) => ts.flattenDiagnosticMessageText(d.messageText, "\n");

describe("<Said> source, at the type level", () => {
  const fixture = readFileSync(FIXTURE, "utf8");
  const directiveLines = fixture
    .split("\n")
    .map((l, i) => (l.trim().startsWith("// @ts-expect-error") ? i : -1))
    .filter((i) => i >= 0);

  it("the fixture has the five missing-source cases", () => {
    expect(directiveLines).toHaveLength(5);
  });

  it("compiles as written: every @ts-expect-error is consumed", () => {
    const diags = diagnosticsFor(fixture);
    expect(diags.map((d) => `${lineOf(d) + 1}: ${message(d)}`)).toEqual([]);
  }, 120_000);

  it("without the directives, each case is a type error about the source", () => {
    const stripped = fixture
      .split("\n")
      .map((l) => (l.trim().startsWith("// @ts-expect-error") ? "" : l))
      .join("\n");
    const diags = diagnosticsFor(stripped);
    const errorLines = [...new Set(diags.map(lineOf))].sort((a, b) => a - b);
    expect(errorLines).toEqual(directiveLines.map((l) => l + 1));
    for (const d of diags) expect(message(d)).toMatch(/source|kind|ref|"ripple"/i);
    // the well-formed quote at the top stays clean
    expect(diags.some((d) => lineOf(d) < directiveLines[0])).toBe(false);
  }, 120_000);
});

describe("<Said> source, at run time", () => {
  const render = (props: Record<string, unknown>) =>
    renderToStaticMarkup(createElement(Said as unknown as (p: Record<string, unknown>) => ReturnType<typeof Said>, props));

  it("renders the words in a blockquote that carries the source", () => {
    const html = renderToStaticMarkup(
      createElement(Said, { source: { kind: "doctor", ref: "v2-u08" }, lang: "en", ruled: true, children: "“Please don't change the dose yourself.”" }),
    );
    expect(html).toContain("<blockquote");
    expect(html).toContain('data-rp="said"');
    expect(html).toContain('data-source-kind="doctor"');
    expect(html).toContain('data-source-ref="v2-u08"');
    expect(html).toContain('data-ruled="true"');
    expect(html).toContain('data-lang="en"');
    expect(html).toContain('lang="en"');
  });

  it("Chinese words get the zh size", () => {
    const html = renderToStaticMarkup(createElement(Said, { source: { kind: "family", ref: "clip-wei-ling-1" }, lang: "zh-Hans", children: "「爸，早餐吃了吗？药记得吃哦。」" }));
    expect(html).toContain('data-lang="zh"');
    expect(html).toContain('data-kind="family"');
    expect(html).toContain("「爸，早餐吃了吗？药记得吃哦。」");
  });

  it("throws without a source, with a blank ref, or with a speaker that is not someone else", () => {
    expect(() => render({ lang: "en", children: "x" })).toThrow(/needs a source/);
    expect(() => render({ source: { kind: "doctor", ref: "   " }, lang: "en", children: "x" })).toThrow(/needs a source/);
    expect(() => render({ source: { kind: "ripple", ref: "refer_doctor" }, lang: "en", children: "x" })).toThrow(/needs a source/);
    expect(() => render({ source: { kind: "self", ref: "q-1" }, lang: "en", children: "x" })).toThrow(/needs a source/);
    expect(() => render({ source: "v2-u08", lang: "en", children: "x" })).toThrow(/needs a source/);
  });
});
