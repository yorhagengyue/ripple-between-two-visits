/**
 * The project's DeepSeek key is RIPPLE_DEEPSEEK_API_KEY (10-09 wave B, item 2). `node --env-file` and Next both let a
 * variable already in the environment win over web/.env, and this machine's Windows user environment has its own
 * DEEPSEEK_API_KEY, which silently replaced the project key in every process (round-2 and round-3 checks). A
 * project-specific name cannot be shadowed that way; DEEPSEEK_API_KEY is read only as a last fallback, with a warning
 * that names the variables and never prints a value.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkerConfig, createMainLlm, DEEPSEEK_KEY_ENV, deepseekApiKey, llmStatus, mainProviderKind } from "@/lib/llm";
import { KEY_NAMES, keySource, parseEnvFile } from "@/scripts/llm/env-check";

const PROJECT = "sk-project-key-in-web-env";
const USER_ENV = "sk-someone-elses-user-variable";

afterEach(() => vi.restoreAllMocks());

describe("RIPPLE_DEEPSEEK_API_KEY wins over DEEPSEEK_API_KEY", () => {
  it("the project name alone turns DeepSeek on (main model and checker)", () => {
    const env = { LLM_PROVIDER: "deepseek", RIPPLE_DEEPSEEK_API_KEY: PROJECT, CHECKER_PROVIDER: "deepseek" };
    expect(DEEPSEEK_KEY_ENV).toBe("RIPPLE_DEEPSEEK_API_KEY");
    expect(mainProviderKind(env)).toBe("deepseek");
    expect(deepseekApiKey(env)).toBe(PROJECT);
    expect(createMainLlm(env).provider).toBe("deepseek");
    expect(checkerConfig(env).config?.apiKey).toBe(PROJECT);
    expect(llmStatus(env)).toMatchObject({ deepseekKey: "set", deepseekKeyName: "RIPPLE_DEEPSEEK_API_KEY" });
  });

  it("with both set (the Windows user variable plus web/.env), the project key is used everywhere", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = { LLM_PROVIDER: "deepseek", RIPPLE_DEEPSEEK_API_KEY: PROJECT, DEEPSEEK_API_KEY: USER_ENV, CHECKER_PROVIDER: "deepseek" };
    expect(deepseekApiKey(env)).toBe(PROJECT);
    expect(checkerConfig(env).config?.apiKey).toBe(PROJECT);
    expect(llmStatus(env).deepseekKeyName).toBe("RIPPLE_DEEPSEEK_API_KEY");
    expect(warn).not.toHaveBeenCalled();
  });

  it("CHECKER_API_KEY still wins for the checker", () => {
    const env = { CHECKER_PROVIDER: "deepseek", RIPPLE_DEEPSEEK_API_KEY: PROJECT, CHECKER_API_KEY: "sk-checker" };
    expect(checkerConfig(env).config?.apiKey).toBe("sk-checker");
  });

  it("DEEPSEEK_API_KEY alone is a last fallback, with a warning that names variables and never a value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = { LLM_PROVIDER: "deepseek", DEEPSEEK_API_KEY: USER_ENV, CHECKER_PROVIDER: "deepseek" };
    expect(mainProviderKind(env)).toBe("deepseek");
    expect(deepseekApiKey(env)).toBe(USER_ENV);
    expect(checkerConfig(env).config?.apiKey).toBe(USER_ENV);
    expect(llmStatus(env).deepseekKeyName).toBe("DEEPSEEK_API_KEY");
    for (const call of warn.mock.calls) expect(call.join(" ")).not.toContain(USER_ENV);
  });

  it("neither set: offline mock, and the checker reason names the project variable", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(mainProviderKind({ LLM_PROVIDER: "deepseek" })).toBe("mock");
    expect(checkerConfig({ CHECKER_PROVIDER: "deepseek" }).reason).toBe("CHECKER_API_KEY or RIPPLE_DEEPSEEK_API_KEY not set");
    expect(llmStatus({}).deepseekKey).toBe("not set");
  });

  it("a key alone never switches the real model on (LLM_PROVIDER must say deepseek)", () => {
    expect(mainProviderKind({ RIPPLE_DEEPSEEK_API_KEY: PROJECT })).toBe("mock");
  });
});

describe("the name in the files", () => {
  it(".env.example names RIPPLE_DEEPSEEK_API_KEY and has no bare DEEPSEEK_API_KEY= line", () => {
    const text = readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
    const names = Object.keys(parseEnvFile(text));
    expect(names).toContain("RIPPLE_DEEPSEEK_API_KEY");
    expect(names).not.toContain("DEEPSEEK_API_KEY");
  });

  it("env-check reports the project key first, then the legacy name", () => {
    expect(KEY_NAMES.slice(0, 2)).toEqual(["RIPPLE_DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY"]);
    expect(keySource("RIPPLE_DEEPSEEK_API_KEY", { RIPPLE_DEEPSEEK_API_KEY: PROJECT }, { RIPPLE_DEEPSEEK_API_KEY: PROJECT })).toBe("web/.env");
  });
});
