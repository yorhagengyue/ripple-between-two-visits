/**
 * GET /api/health and lib/ops/health.ts (C2 track P): the report names providers and never carries a value.
 */
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";
import { buildIdOf, HEALTH_COMPARED, healthReport, resetBuildIdForTests } from "@/lib/ops/health";
import { generateVapidKeys } from "@/lib/push/crypto";

const vapid = generateVapidKeys();

/** A deployment's environment, every secret a distinctive made-up value. */
function deployedEnv(over: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: "production",
    RIPPLE_DEPLOYED: "1",
    STORE: "supabase",
    BLOB_DRIVER: "supabase",
    AUTH_PROVIDER: "supabase",
    SUPABASE_URL: "https://zzfakeprojectrefzzzz.supabase.co",
    SUPABASE_SERVICE_KEY: "sb_secret_FAKE-service-key-0123456789abcdef",
    SUPABASE_ANON_KEY: "sb_publishable_FAKE-anon-key-0123456789abcdef",
    LLM_PROVIDER: "deepseek",
    RIPPLE_DEEPSEEK_API_KEY: "sk-FAKE-deepseek-key-0123456789abcdef",
    CHECKER_PROVIDER: "deepseek",
    SPEECH_PROVIDER: "mock",
    TTS_PROVIDER: "mock",
    JOBS: "1",
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    EDGE_SECRET: "FAKE-edge-secret-0123456789abcdef0123456789",
    BLOB_SIGNING_SECRET: "FAKE-blob-signing-0123456789abcdef0123456789",
    ...over,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetBuildIdForTests();
});

describe("healthReport", () => {
  it("reports a laptop with nothing set as all local stand-ins", () => {
    expect(healthReport({ NODE_ENV: "production" })).toEqual({
      store: "memory",
      blob: "local",
      auth: "memory",
      llm: "mock",
      checker: "none",
      speech: "mock",
      speech_problem: null,
      tts: "mock",
      tts_ready: true,
      jobs: false,
      deployed: false,
      push: false,
    });
  });

  it("reports a deployment by provider names", () => {
    expect(healthReport(deployedEnv())).toEqual({
      store: "supabase",
      blob: "supabase",
      auth: "supabase",
      llm: "deepseek",
      checker: "deepseek",
      speech: "mock",
      speech_problem: null,
      tts: "mock",
      tts_ready: true,
      jobs: true,
      deployed: true,
      push: true,
    });
  });

  it("carries no value of the environment, only names", () => {
    const env = deployedEnv({ SPEECH_PROVIDER: "whisper", WHISPER_URL: "https://asr.fake-ripple.example", WHISPER_TOKEN: "FAKE-whisper-token-0123456789abcdef0123456789" });
    const text = JSON.stringify(healthReport(env));
    for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SUPABASE_ANON_KEY", "RIPPLE_DEEPSEEK_API_KEY", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "EDGE_SECRET", "BLOB_SIGNING_SECRET", "WHISPER_URL", "WHISPER_TOKEN"]) {
      expect(text, name).not.toContain(env[name]!);
    }
    expect(text).not.toContain("zzfakeprojectrefzzzz");
    expect(text).not.toContain("asr.fake-ripple.example");
  });

  it("says mock when the main model's key is missing, as the app would run", () => {
    const report = healthReport(deployedEnv({ RIPPLE_DEEPSEEK_API_KEY: undefined }));
    expect(report.llm).toBe("mock");
    expect(report.checker).toBe("none");
  });

  it("does not print the model's fallback warning on every call", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    healthReport(deployedEnv({ RIPPLE_DEEPSEEK_API_KEY: undefined }));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("names the checker as mock or replay when it is one", () => {
    expect(healthReport(deployedEnv({ CHECKER_PROVIDER: "mock" })).checker).toBe("mock");
    expect(healthReport(deployedEnv({ CHECKER_PROVIDER: "replay" })).checker).toBe("replay");
    expect(healthReport(deployedEnv({ CHECKER_PROVIDER: "" })).checker).toBe("none");
  });

  it("never echoes a custom checker's address", () => {
    const report = healthReport(deployedEnv({ CHECKER_PROVIDER: "compatible", CHECKER_BASE_URL: "https://checker.fake-ripple.example/v1", CHECKER_API_KEY: "FAKE-checker-key-0123456789", CHECKER_MODEL: "some-model" }));
    expect(report.checker).toBe("compatible");
    expect(JSON.stringify(report)).not.toContain("fake-ripple");
  });

  it("gives the reason code when the transcription service is not reachable as configured", () => {
    expect(healthReport(deployedEnv({ SPEECH_PROVIDER: "whisper" })).speech_problem).toBe("no_url");
    expect(healthReport(deployedEnv({ SPEECH_PROVIDER: "whisper", WHISPER_URL: "https://asr.fake-ripple.example" })).speech_problem).toBe("no_token");
    expect(healthReport(deployedEnv({ SPEECH_PROVIDER: "whisper", WHISPER_URL: "https://asr.fake-ripple.example", WHISPER_TOKEN: "short" })).speech_problem).toBe("short_token");
    const fine = healthReport(deployedEnv({ SPEECH_PROVIDER: "whisper", WHISPER_URL: "https://asr.fake-ripple.example", WHISPER_TOKEN: "FAKE-whisper-token-0123456789abcdef0123456789" }));
    expect(fine.speech).toBe("whisper");
    expect(fine.speech_problem).toBeNull();
  });

  it("answers invalid instead of throwing on an unknown store, file driver or speech provider", () => {
    const report = healthReport(deployedEnv({ STORE: "sqlite", BLOB_DRIVER: "s3", SPEECH_PROVIDER: "siri" }));
    expect(report.store).toBe("invalid");
    expect(report.blob).toBe("invalid");
    expect(report.speech).toBe("invalid");
    expect(report.speech_problem).toBeNull();
  });

  it("reports a real read-aloud provider that cannot speak yet as not ready", () => {
    const report = healthReport(deployedEnv({ TTS_PROVIDER: "trtc", TRTC_SDK_APP_ID: "1400000000" }));
    expect(report.tts).toBe("trtc");
    expect(report.tts_ready).toBe(false);
    expect(healthReport(deployedEnv({ TTS_PROVIDER: "trtc" })).tts).toBe("mock");
  });

  it("reports push off when the key pair is missing or does not match", () => {
    expect(healthReport(deployedEnv({ VAPID_PRIVATE_KEY: undefined })).push).toBe(false);
    expect(healthReport(deployedEnv({ VAPID_PRIVATE_KEY: generateVapidKeys().privateKey })).push).toBe(false);
  });

  it("compares a deployment on every field except whether the voice answers right now", () => {
    const fields = Object.keys(healthReport({})).sort();
    expect([...HEALTH_COMPARED, "tts_ready"].sort()).toEqual(fields);
  });
});

describe("GET /api/health", () => {
  it("keeps ok, store and time, and adds the report and the build id", async () => {
    vi.stubEnv("STORE", "memory");
    vi.stubEnv("LLM_PROVIDER", "mock");
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.store).toBe("memory");
    expect(typeof body.time).toBe("string");
    expect(Number.isNaN(Date.parse(String(body.time)))).toBe(false);
    for (const field of [...HEALTH_COMPARED, "tts_ready", "build"]) expect(body, field).toHaveProperty(field);
    expect(body.llm).toBe("mock");
  });

  it("reads the build id from .next/BUILD_ID and answers null without a build", () => {
    expect(buildIdOf(path.join(os.tmpdir(), "ripple-no-such-build-folder"))).toBeNull();
  });
});
