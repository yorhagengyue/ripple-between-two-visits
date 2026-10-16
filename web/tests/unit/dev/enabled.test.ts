/**
 * When the developer tools may run, and when the server must refuse to start (lib/dev/enabled.ts; C2 F1 item H, as
 * changed by the integrator):
 *   rule 1  the developer tools (/api/dev/**, the test clock, SPEECH_PROVIDER=devfake, the test-account helper) are on
 *           when NODE_ENV !== "production" OR RIPPLE_DEV_TOOLS === "1"; otherwise they refuse (404, or throw)
 *   rule 2  with RIPPLE_DEPLOYED === "1" the server refuses to start if RIPPLE_DEV_TOOLS=1, AUTH_PROVIDER=memory (or no
 *           provider, which is memory) or SPEECH_PROVIDER=devfake
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "@/instrumentation";
import { DevfakeSpeechProvider, getSpeechProvider, SpeechError } from "@/lib/asr";
import { getAuthProvider } from "@/lib/auth";
import { assertDeployable, assertDevTools, deployProblems, devToolsEnabled, effectiveAuthProvider, isDeployed, UnsafeDeployment } from "@/lib/dev/enabled";
import { refuseUnsafeStart } from "@/lib/dev/startup";
import { getMemoryStore } from "@/lib/store/memory";
import { createDevAccount, devSignIn } from "@/lib/subject/dev";
import { advanceTestClock, nowMs, setTestClock, testClock } from "@/lib/time/now";

const SUPABASE = { SUPABASE_URL: "https://project.example.test", SUPABASE_SERVICE_KEY: "service", SUPABASE_ANON_KEY: "anon" };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setTestClock(null);
});

describe("rule 1: on outside production, or with RIPPLE_DEV_TOOLS=1", () => {
  it("next dev, vitest and scripts have them; a production build does not, unless the flag says 1", () => {
    expect(devToolsEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(devToolsEnabled({ NODE_ENV: "test" })).toBe(true);
    expect(devToolsEnabled({})).toBe(true);
    expect(devToolsEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(devToolsEnabled({ NODE_ENV: "production", RIPPLE_DEV_TOOLS: "1" })).toBe(true);
    for (const v of ["0", "true", "yes", "on", "", "11"]) expect(devToolsEnabled({ NODE_ENV: "production", RIPPLE_DEV_TOOLS: v }), v).toBe(false);
  });

  it("assertDevTools throws when they are off", () => {
    expect(() => assertDevTools("x", { NODE_ENV: "production" })).toThrow(/developer tool/);
    expect(() => assertDevTools("x", { NODE_ENV: "production", RIPPLE_DEV_TOOLS: "1" })).not.toThrow();
    expect(() => assertDevTools("x", { NODE_ENV: "test" })).not.toThrow();
  });

  it("the test clock cannot be set on a production build, and a clock left behind is ignored there", () => {
    const real = Date.now();
    setTestClock({ offsetMs: 5 * 24 * 3600 * 1000 });
    expect(nowMs() - real).toBeGreaterThan(4 * 24 * 3600 * 1000);
    vi.stubEnv("NODE_ENV", "production");
    expect(() => setTestClock({ offsetMs: 1000 })).toThrow(/developer tool/);
    expect(() => advanceTestClock(1000)).toThrow(/developer tool/);
    expect(() => setTestClock(null)).toThrow(/developer tool/);
    expect(Math.abs(nowMs() - Date.now())).toBeLessThan(1000);
    expect(testClock()).toBeNull();
    // the integrator's recording build: the flag turns it back on
    vi.stubEnv("RIPPLE_DEV_TOOLS", "1");
    expect(nowMs() - Date.now()).toBeGreaterThan(4 * 24 * 3600 * 1000);
    expect(testClock()).not.toBeNull();
  });

  it("SPEECH_PROVIDER=devfake refuses to exist when they are off", () => {
    const off = { NODE_ENV: "production", SPEECH_PROVIDER: "devfake" };
    expect(() => new DevfakeSpeechProvider(off)).toThrow(SpeechError);
    try {
      new DevfakeSpeechProvider(off);
    } catch (err) {
      expect((err as SpeechError).code).toBe("not_configured");
    }
    expect(() => getSpeechProvider(off)).toThrow(SpeechError);
    expect(() => new DevfakeSpeechProvider({ NODE_ENV: "production", RIPPLE_DEV_TOOLS: "1" })).not.toThrow();
  });

  it("a devfake provider made while they were on stops taking jobs when they are off", async () => {
    const speech = new DevfakeSpeechProvider();
    await expect(speech.createFileJob({ url: "fixture:none", speakers: 2, lang: "en" })).resolves.toMatchObject({ jobId: expect.any(String) });
    vi.stubEnv("NODE_ENV", "production");
    await expect(speech.createFileJob({ url: "fixture:none", speakers: 2, lang: "en" })).rejects.toThrow(SpeechError);
  });

  it("the test-account helper refuses when they are off", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(createDevAccount({ login: `d${randomUUID().slice(0, 8)}`, password: "a long test password" })).rejects.toThrow(/developer tool/);
    await expect(devSignIn("anyone", "anything")).rejects.toThrow(/developer tool/);
    expect(await getMemoryStore().listAccountScopes()).toEqual([]);
  });
});

describe("rule 2: a real deployment refuses to start with a developer tool or the in-memory identity provider", () => {
  it("not a deployment: nothing to refuse", () => {
    expect(isDeployed({})).toBe(false);
    expect(isDeployed({ RIPPLE_DEPLOYED: "0" })).toBe(false);
    expect(deployProblems({ RIPPLE_DEV_TOOLS: "1", AUTH_PROVIDER: "memory", SPEECH_PROVIDER: "devfake" })).toEqual([]);
    expect(() => assertDeployable({ RIPPLE_DEV_TOOLS: "1", AUTH_PROVIDER: "memory", SPEECH_PROVIDER: "devfake" })).not.toThrow();
  });

  it("a safe deployment starts", () => {
    const env = { RIPPLE_DEPLOYED: "1", NODE_ENV: "production", AUTH_PROVIDER: "supabase", SPEECH_PROVIDER: "whisper", ...SUPABASE };
    expect(deployProblems(env)).toEqual([]);
    expect(() => assertDeployable(env)).not.toThrow();
    // no AUTH_PROVIDER, but the project's keys: supabase
    expect(effectiveAuthProvider({ ...SUPABASE })).toBe("supabase");
    expect(deployProblems({ RIPPLE_DEPLOYED: "1", ...SUPABASE })).toEqual([]);
  });

  it("each of the three is refused on its own, and all three together", () => {
    const base = { RIPPLE_DEPLOYED: "1", NODE_ENV: "production", AUTH_PROVIDER: "supabase", ...SUPABASE };
    expect(deployProblems({ ...base, RIPPLE_DEV_TOOLS: "1" })).toEqual([expect.stringMatching(/^RIPPLE_DEV_TOOLS=1/)]);
    expect(deployProblems({ ...base, AUTH_PROVIDER: "memory" })).toEqual([expect.stringMatching(/^AUTH_PROVIDER=memory/)]);
    expect(deployProblems({ ...base, AUTH_PROVIDER: "MEMORY" })).toEqual([expect.stringMatching(/^AUTH_PROVIDER=memory/)]);
    expect(deployProblems({ ...base, SPEECH_PROVIDER: "devfake" })).toEqual([expect.stringMatching(/^SPEECH_PROVIDER=devfake/)]);
    expect(deployProblems({ ...base, SPEECH_PROVIDER: "DevFake" })).toHaveLength(1);
    expect(deployProblems({ ...base, RIPPLE_DEV_TOOLS: "1", AUTH_PROVIDER: "memory", SPEECH_PROVIDER: "devfake" })).toHaveLength(3);
    expect(() => assertDeployable({ ...base, RIPPLE_DEV_TOOLS: "1" })).toThrow(UnsafeDeployment);
  });

  it("no identity provider named and no Supabase keys is the in-memory one, and is refused", () => {
    expect(effectiveAuthProvider({})).toBe("memory");
    expect(deployProblems({ RIPPLE_DEPLOYED: "1" })).toEqual([expect.stringMatching(/^AUTH_PROVIDER=memory/)]);
    expect(deployProblems({ RIPPLE_DEPLOYED: "1", SUPABASE_URL: "https://project.example.test" })).toHaveLength(1);
  });

  it("the developer tools on a deployment refuse even where rule 1 alone would allow them", () => {
    expect(() => assertDevTools("x", { RIPPLE_DEPLOYED: "1", NODE_ENV: "production", RIPPLE_DEV_TOOLS: "1", AUTH_PROVIDER: "supabase", ...SUPABASE })).toThrow(UnsafeDeployment);
    expect(() => new DevfakeSpeechProvider({ RIPPLE_DEPLOYED: "1", NODE_ENV: "production", RIPPLE_DEV_TOOLS: "1", AUTH_PROVIDER: "supabase", ...SUPABASE })).toThrow(SpeechError);
  });

  it("the identity layer refuses the in-memory provider on a deployment", () => {
    expect(() => getAuthProvider({ RIPPLE_DEPLOYED: "1", AUTH_PROVIDER: "memory" })).toThrow(UnsafeDeployment);
    expect(getAuthProvider({ AUTH_PROVIDER: "memory" }).name).toBe("memory");
  });

  it("instrumentation.ts stops the server before it answers anything (Node.js runtime)", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("RIPPLE_DEPLOYED", "1");
    vi.stubEnv("AUTH_PROVIDER", "memory");
    await register();
    expect(exit).toHaveBeenCalledWith(1);
    expect(String(error.mock.calls[0]?.[0])).toMatch(/AUTH_PROVIDER=memory/);

    exit.mockClear();
    vi.stubEnv("AUTH_PROVIDER", "supabase");
    vi.stubEnv("SUPABASE_URL", SUPABASE.SUPABASE_URL);
    vi.stubEnv("SUPABASE_SERVICE_KEY", SUPABASE.SUPABASE_SERVICE_KEY);
    vi.stubEnv("SUPABASE_ANON_KEY", SUPABASE.SUPABASE_ANON_KEY);
    vi.stubEnv("SPEECH_PROVIDER", "devfake");
    await register();
    expect(exit).toHaveBeenCalledWith(1);

    exit.mockClear();
    vi.stubEnv("SPEECH_PROVIDER", "mock");
    // track A's part of the check (lib/auth/boot.ts): a deployment also needs the three account secrets
    await register();
    expect(exit).toHaveBeenCalledWith(1);
    exit.mockClear();
    vi.stubEnv("AUTH_COOKIE_SECRET", "c".repeat(40));
    vi.stubEnv("RATE_LIMIT_SALT", "s".repeat(40));
    vi.stubEnv("RECOVERY_PEPPER", "p".repeat(40));
    // track L's part (lib/guard/boot.ts): a deployment also says how the client address is read
    await register();
    expect(exit).toHaveBeenCalledWith(1);
    exit.mockClear();
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    await register();
    expect(exit).not.toHaveBeenCalled();

    // the integrator's recording build on this machine (not a deployment) starts with the flag on
    vi.stubEnv("RIPPLE_DEPLOYED", "");
    vi.stubEnv("RIPPLE_DEV_TOOLS", "1");
    vi.stubEnv("AUTH_PROVIDER", "memory");
    await register();
    expect(exit).not.toHaveBeenCalled();
  });

  it("the Edge build of instrumentation.ts never sees process.exit (the check is loaded for Node.js only)", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("RIPPLE_DEPLOYED", "1");
    vi.stubEnv("AUTH_PROVIDER", "memory");
    await register();
    expect(exit).not.toHaveBeenCalled();
    const src = readFileSync(path.join(__dirname, "..", "..", "..", "instrumentation.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/process\.exit/);
    expect(src).toMatch(/process\.env\.NEXT_RUNTIME === "nodejs"/);
  });

  it("refuseUnsafeStart: exit code 1 with the reason, or nothing", () => {
    const exits: number[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    refuseUnsafeStart({ RIPPLE_DEPLOYED: "1", RIPPLE_DEV_TOOLS: "1", AUTH_PROVIDER: "supabase", ...SUPABASE }, (c) => exits.push(c));
    refuseUnsafeStart({ RIPPLE_DEPLOYED: "1", AUTH_PROVIDER: "supabase", ...SUPABASE }, (c) => exits.push(c));
    refuseUnsafeStart({ NODE_ENV: "production", RIPPLE_DEV_TOOLS: "1", AUTH_PROVIDER: "memory" }, (c) => exits.push(c));
    expect(exits).toEqual([1]);
  });
});
