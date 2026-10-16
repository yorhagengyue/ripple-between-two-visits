/**
 * Which model clients the app uses, from the environment (names only are ever printed, never values).
 *
 * Main model (classification fallback, generation, label reading, whole-visit item extraction):
 *   LLM_PROVIDER = deepseek | openai | replay | mock | stub (stub is an alias of mock)
 *   - explicit value wins; deepseek without a DeepSeek key and openai without OPENAI_API_KEY fall back to mock
 *     with a warning, so the app runs with no keys at all;
 *   - the DeepSeek key is RIPPLE_DEEPSEEK_API_KEY (web/.env). DEEPSEEK_API_KEY is read only when that is not set,
 *     with a warning: `node --env-file` and Next both let a variable already in the environment win over web/.env,
 *     and this machine's Windows user environment has its own DEEPSEEK_API_KEY (not this project's key), which used
 *     to override web/.env silently (10-09 round-2 check). A project-specific name cannot be shadowed that way;
 *   - unset: openai when OPENAI_API_KEY is set, otherwise mock. DeepSeek is never picked implicitly (a key in
 *     web/.env must not make the tests spend money): it needs LLM_PROVIDER=deepseek.
 *   LLM_MODEL (default per provider: deepseek-flash, gpt-5.4-mini), LLM_FALLBACK_PROVIDER (failover target, needs
 *   its own key), LLM_TIMEOUT_MS, LLM_MAX_ATTEMPTS, LLM_MAX_CONCURRENCY, LLM_QUEUE_TIMEOUT_MS, REPLAY_PROVIDER
 *   (provider the cassettes were recorded with, default openai), CASSETTE_DIR, DEEPSEEK_BASE_URL.
 *   DeepSeek runs in non-thinking mode (`thinking: {type: "disabled"}`) unless LLM_THINKING=enabled.
 *
 * Checker (layer 3): CHECKER_PROVIDER = deepseek | anthropic | gemini | mistral | xai | compatible | replay | mock ;
 *   CHECKER_API_KEY (DeepSeek: falls back to the DeepSeek key above) ; CHECKER_MODEL (DeepSeek default deepseek-v4-pro) ;
 *   CHECKER_BASE_URL (only for "compatible") ; CHECKER_TIMEOUT_MS (default 10000) ; CHECKER_MAX_ATTEMPTS (default 1) ;
 *   CHECKER_THINKING (DeepSeek, default disabled). The checker has its own concurrency queue, and CHECKER_TIMEOUT_MS
 *   bounds the whole check (waiting for a slot included), so a busy main model cannot hold a check open.
 *   Unset, incomplete, or the main model itself -> no checker, and
 *   borderline sentences are blocked (fail closed). web-app.md asked for a second vendor; on 10-09 Gengyue chose
 *   deepseek-v4-pro to check deepseek-flash: same vendor, different model. That is allowed only for DeepSeek and only
 *   with a different model, and `independence: "same_vendor"` says so wherever the checker is described.
 *   CHECKER_PROVIDER=replay answers layer 3 from cassettes recorded with REPLAY_CHECKER_PROVIDER (default deepseek).
 *
 * Recording: LLM_RECORD=1 wraps every live client (main and checker) so each successful call is also written as
 * a cassette into CASSETTE_DIR (replay.ts). A cassette holds the whole prompt, i.e. the patient's words and his
 * records, so recording is only for the fictional demo data: it is refused (with a warning) when NODE_ENV is
 * production or STORE=supabase, unless LLM_RECORD_ALLOW_REAL_DATA=1 says the data is not a real patient's.
 * Spend: every live call goes through the US$ ledger (spend.ts).
 *
 * Privacy of the failover: LLM_FALLBACK_PROVIDER sends the same full prompt to a second vendor when the first is
 * down (502/503/504, a timeout included). llmStatus() names that vendor; configure it only with a vendor that may
 * process patient data.
 */
import { createCompatClient, defaultMaxConcurrency, type CompatConfig } from "./openai";
import { createMockLlm } from "./mock";
import { createReplayClient, withRecording } from "./replay";
import { getSpendLedger, spendCapUsd, spendLogPath } from "./spend";
import type { LlmClient } from "./types";

type Env = Record<string, string | undefined>;

/**
 * OpenAI's default model. The main model is DeepSeek (DEEPSEEK_MAIN_MODEL, deepseek-flash, since 10-09; lib/how
 * describes it); OpenAI remains an optional provider (LLM_PROVIDER=openai). mainModel() also reports this name for the
 * offline mock, and replay looks up OpenAI-recorded cassettes (REPLAY_PROVIDER=openai) under it.
 */
export const DEFAULT_MAIN_MODEL = "gpt-5.4-mini";
export const DEEPSEEK_MAIN_MODEL = "deepseek-flash";
export const DEEPSEEK_CHECKER_MODEL = "deepseek-v4-pro";
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

interface VendorSpec {
  vendor: string;
  baseUrl: string;
  maxTokensField: CompatConfig["maxTokensField"];
  jsonMode: boolean;
  /** env variable with this vendor's key, used when no explicit key is given */
  keyEnv?: string;
  /** an older name read only when keyEnv is not set (with a warning) */
  legacyKeyEnv?: string;
  /** a checker from the same vendor is acceptable when it is a different model (decided 10-09 for DeepSeek) */
  sameVendorChecker?: boolean;
}

/** The project's DeepSeek key variable (web/.env); DEEPSEEK_API_KEY is only a last fallback. */
export const DEEPSEEK_KEY_ENV = "RIPPLE_DEEPSEEK_API_KEY";
export const DEEPSEEK_LEGACY_KEY_ENV = "DEEPSEEK_API_KEY";

/** OpenAI-compatible endpoints. "deepseek" and "openai" serve the main model; any of them can check. */
export const VENDORS: Record<string, VendorSpec> = {
  deepseek: {
    vendor: "deepseek",
    baseUrl: DEEPSEEK_BASE_URL,
    maxTokensField: "max_tokens",
    jsonMode: true,
    keyEnv: DEEPSEEK_KEY_ENV,
    legacyKeyEnv: DEEPSEEK_LEGACY_KEY_ENV,
    sameVendorChecker: true,
  },
  openai: { vendor: "openai", baseUrl: "https://api.openai.com/v1", maxTokensField: "max_completion_tokens", jsonMode: true, keyEnv: "OPENAI_API_KEY" },
  anthropic: { vendor: "anthropic", baseUrl: "https://api.anthropic.com/v1", maxTokensField: "max_tokens", jsonMode: false },
  gemini: { vendor: "google", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", maxTokensField: "max_tokens", jsonMode: true },
  mistral: { vendor: "mistral", baseUrl: "https://api.mistral.ai/v1", maxTokensField: "max_tokens", jsonMode: true },
  xai: { vendor: "xai", baseUrl: "https://api.x.ai/v1", maxTokensField: "max_tokens", jsonMode: true },
};

export type MainProviderKind = "deepseek" | "openai" | "replay" | "mock";

const warnedLegacyKey = new Set<string>();

/**
 * A vendor's key from the environment: its own variable, else the legacy name (warned once per name; the name only,
 * never the value). For DeepSeek: RIPPLE_DEEPSEEK_API_KEY, else DEEPSEEK_API_KEY.
 */
export function vendorKey(spec: Pick<VendorSpec, "keyEnv" | "legacyKeyEnv">, env: Env = process.env): { value: string; name: string } | null {
  if (spec.keyEnv && env[spec.keyEnv]) return { value: env[spec.keyEnv]!, name: spec.keyEnv };
  if (spec.legacyKeyEnv && env[spec.legacyKeyEnv]) {
    if (!warnedLegacyKey.has(spec.legacyKeyEnv)) {
      warnedLegacyKey.add(spec.legacyKeyEnv);
      console.warn(`[llm] ${spec.keyEnv} is not set; using ${spec.legacyKeyEnv} (any shell or Windows user variable of that name wins over web/.env). Put the key in web/.env as ${spec.keyEnv}.`);
    }
    return { value: env[spec.legacyKeyEnv]!, name: spec.legacyKeyEnv };
  }
  return null;
}

/** The DeepSeek key this configuration uses (RIPPLE_DEEPSEEK_API_KEY first, DEEPSEEK_API_KEY last), or "". */
export function deepseekApiKey(env: Env = process.env): string {
  return vendorKey(VENDORS.deepseek, env)?.value ?? "";
}

export function mainProviderKind(env: Env = process.env): MainProviderKind {
  const raw = (env.LLM_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "mock" || raw === "stub") return "mock";
  if (raw === "replay") return "replay";
  if (raw === "deepseek") {
    if (deepseekApiKey(env)) return "deepseek";
    console.warn(`[llm] LLM_PROVIDER=deepseek but ${DEEPSEEK_KEY_ENV} is not set; using the offline mock`);
    return "mock";
  }
  if (raw === "openai") {
    if (env.OPENAI_API_KEY) return "openai";
    console.warn("[llm] LLM_PROVIDER=openai but OPENAI_API_KEY is not set; using the offline mock");
    return "mock";
  }
  if (raw !== "") console.warn(`[llm] unknown LLM_PROVIDER=${raw}; using ${env.OPENAI_API_KEY ? "openai" : "mock"}`);
  return env.OPENAI_API_KEY ? "openai" : "mock";
}

/** The model the main client uses for this configuration. */
export function mainModel(env: Env = process.env): string {
  if (env.LLM_MODEL) return env.LLM_MODEL;
  const kind = mainProviderKind(env);
  if (kind === "deepseek") return DEEPSEEK_MAIN_MODEL;
  if (kind === "replay") return replayProvider(env) === "deepseek" ? DEEPSEEK_MAIN_MODEL : DEFAULT_MAIN_MODEL;
  return DEFAULT_MAIN_MODEL;
}

function replayProvider(env: Env): string {
  return (env.REPLAY_PROVIDER || "openai").trim().toLowerCase();
}

/** The vendor behind the main model (mock and replay stand in for the vendor they replace). */
export function mainVendor(env: Env = process.env): string {
  const kind = mainProviderKind(env);
  if (kind === "deepseek") return "deepseek";
  if (kind === "replay") return VENDORS[replayProvider(env)]?.vendor ?? replayProvider(env);
  // mock stands in for the configured main model (OpenAI before 10-09)
  return "openai";
}

const positive = (v: string | undefined): number | null => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

const thinkingOn = (value: string | undefined) => (value ?? "").trim().toLowerCase() === "enabled";

/** DeepSeek's thinking switch (on by default at the vendor; off here unless asked for) and the token floor it needs. */
function thinkingFields(value: string | undefined): Pick<CompatConfig, "extraBody" | "minMaxTokens"> {
  return thinkingOn(value) ? { extraBody: { thinking: { type: "enabled" } }, minMaxTokens: 4096 } : { extraBody: { thinking: { type: "disabled" } } };
}

function deepseekMainConfig(env: Env): CompatConfig {
  const v = VENDORS.deepseek;
  return {
    name: "deepseek",
    vendor: v.vendor,
    baseUrl: env.DEEPSEEK_BASE_URL || v.baseUrl,
    apiKey: deepseekApiKey(env),
    model: env.LLM_MODEL || DEEPSEEK_MAIN_MODEL,
    maxTokensField: v.maxTokensField,
    jsonMode: v.jsonMode,
    ...thinkingFields(env.LLM_THINKING),
    timeoutMs: positive(env.LLM_TIMEOUT_MS) ?? 15_000,
    maxAttempts: positive(env.LLM_MAX_ATTEMPTS) ? Math.floor(positive(env.LLM_MAX_ATTEMPTS)!) : 2,
    // DeepSeek's account-wide limit is far higher; this keeps one process from bursting the budget
    maxConcurrency: defaultMaxConcurrency(env) || 8,
  };
}

function openAiConfig(env: Env): CompatConfig {
  const v = VENDORS.openai;
  return {
    name: "openai",
    vendor: v.vendor,
    baseUrl: v.baseUrl,
    apiKey: env.OPENAI_API_KEY ?? "",
    model: env.LLM_MODEL || DEFAULT_MAIN_MODEL,
    maxTokensField: v.maxTokensField,
    jsonMode: v.jsonMode,
  };
}

const truthy = (v: string | undefined) => v === "1" || v === "true";

/** Where recording would write real patients' words: a production build or the shared database. */
export function recordingBlockedReason(env: Env = process.env): string | null {
  if (truthy(env.LLM_RECORD_ALLOW_REAL_DATA)) return null;
  if (env.NODE_ENV === "production") return "NODE_ENV=production";
  if ((env.STORE ?? "").trim().toLowerCase() === "supabase") return "STORE=supabase";
  return null;
}

const warnedRecording = new Set<string>();

/** LLM_RECORD=1, unless the data may be a real patient's (recordingBlockedReason). */
export function recording(env: Env = process.env): boolean {
  if (!truthy(env.LLM_RECORD)) return false;
  const blocked = recordingBlockedReason(env);
  if (!blocked) return true;
  if (!warnedRecording.has(blocked)) {
    warnedRecording.add(blocked);
    console.warn(`[llm] LLM_RECORD ignored (${blocked}): cassettes would store patients' words; set LLM_RECORD_ALLOW_REAL_DATA=1 only for demo data`);
  }
  return false;
}

/** The main model client for this process. */
export function createMainLlm(env: Env = process.env): LlmClient {
  const kind = mainProviderKind(env);
  if (kind === "mock") return createMockLlm();
  if (kind === "replay") {
    return createReplayClient({ provider: replayProvider(env), model: mainModel(env), dir: env.CASSETTE_DIR });
  }
  const cfg = kind === "deepseek" ? deepseekMainConfig(env) : openAiConfig(env);
  cfg.fallback = fallbackConfig(env);
  const client = createCompatClient(cfg);
  return recording(env) ? withRecording(client, env.CASSETTE_DIR || undefined) : client;
}

/**
 * Failover target for the main model (ripple-core's LLM_FALLBACK_PROVIDER, now with its own key and model):
 * LLM_FALLBACK_PROVIDER (a VENDORS name or "compatible"), LLM_FALLBACK_API_KEY, LLM_FALLBACK_MODEL,
 * LLM_FALLBACK_BASE_URL (compatible only). Anything missing -> no failover.
 */
export function fallbackConfig(env: Env = process.env): CompatConfig | null {
  const name = (env.LLM_FALLBACK_PROVIDER ?? "").trim().toLowerCase();
  if (!name || !env.LLM_FALLBACK_API_KEY || !env.LLM_FALLBACK_MODEL) return null;
  const spec: VendorSpec | undefined =
    name === "compatible"
      ? env.LLM_FALLBACK_BASE_URL
        ? { vendor: "custom", baseUrl: env.LLM_FALLBACK_BASE_URL, maxTokensField: "max_tokens", jsonMode: false }
        : undefined
      : VENDORS[name];
  if (!spec) return null;
  return {
    name,
    vendor: spec.vendor,
    baseUrl: spec.baseUrl,
    apiKey: env.LLM_FALLBACK_API_KEY,
    model: env.LLM_FALLBACK_MODEL,
    maxTokensField: spec.maxTokensField,
    jsonMode: spec.jsonMode,
    ...(spec.vendor === "deepseek" ? thinkingFields(env.LLM_THINKING) : {}),
  };
}

/** How independent the checker is from the main model. */
export type CheckerIndependence = "other_vendor" | "same_vendor";

export interface CheckerResolution {
  config: CompatConfig | null;
  /** "mock" when CHECKER_PROVIDER=mock */
  mock: boolean;
  /** CHECKER_PROVIDER=replay: answer layer 3 from cassettes */
  replay: { provider: string; model: string } | null;
  /** why there is no checker (shown in the backstage view and in safety_event.layer3) */
  reason: string | null;
  independence: CheckerIndependence | null;
}

const none = (reason: string): CheckerResolution => ({ config: null, mock: false, replay: null, reason, independence: null });

/** Time bound of one layer-3 check, queue wait included (CHECKER_TIMEOUT_MS, default 10 s). */
export function checkerTimeoutMs(env: Env = process.env): number {
  return positive(env.CHECKER_TIMEOUT_MS) ?? 10_000;
}

export function checkerConfig(env: Env = process.env): CheckerResolution {
  const name = (env.CHECKER_PROVIDER ?? "").trim().toLowerCase();
  if (!name) return none("CHECKER_PROVIDER not set");
  if (name === "mock") return { config: null, mock: true, replay: null, reason: null, independence: null };
  if (name === "replay") {
    const provider = (env.REPLAY_CHECKER_PROVIDER || "deepseek").trim().toLowerCase();
    const model = env.CHECKER_MODEL || (provider === "deepseek" ? DEEPSEEK_CHECKER_MODEL : "");
    if (!model) return none("CHECKER_MODEL not set");
    const vendor = VENDORS[provider]?.vendor ?? provider;
    return { config: null, mock: false, replay: { provider, model }, reason: null, independence: vendor === mainVendor(env) ? "same_vendor" : "other_vendor" };
  }
  let spec: VendorSpec | undefined = VENDORS[name];
  if (name === "compatible") {
    if (!env.CHECKER_BASE_URL) return none("CHECKER_BASE_URL not set");
    spec = { vendor: `custom:${env.CHECKER_BASE_URL}`, baseUrl: env.CHECKER_BASE_URL, maxTokensField: "max_tokens", jsonMode: false };
  }
  if (!spec) return none(`unknown CHECKER_PROVIDER=${name}`);
  const apiKey = env.CHECKER_API_KEY || vendorKey(spec, env)?.value;
  if (!apiKey) return none(spec.keyEnv ? `CHECKER_API_KEY or ${spec.keyEnv} not set` : "CHECKER_API_KEY not set");
  const model = env.CHECKER_MODEL || (spec.vendor === "deepseek" ? DEEPSEEK_CHECKER_MODEL : "");
  if (!model) return none("CHECKER_MODEL not set");
  let independence: CheckerIndependence = "other_vendor";
  if (spec.vendor === mainVendor(env)) {
    if (!spec.sameVendorChecker) return none("checker must be a different vendor from the main model");
    if (model === mainModel(env)) return none("checker must not be the main model itself");
    independence = "same_vendor";
  }
  return {
    config: {
      name,
      vendor: spec.vendor,
      baseUrl: name === "deepseek" ? env.DEEPSEEK_BASE_URL || spec.baseUrl : spec.baseUrl,
      apiKey,
      model,
      maxTokensField: spec.maxTokensField,
      jsonMode: spec.jsonMode,
      // fail closed fast: one attempt, a short timeout; a slow checker blocks the sentence instead of the answer.
      // The timeout bounds the whole check, queue wait included, and the checker waits in its own queue.
      timeoutMs: checkerTimeoutMs(env),
      totalTimeoutMs: checkerTimeoutMs(env),
      queueTimeoutMs: checkerTimeoutMs(env),
      slotKey: `${name}:checker`,
      maxAttempts: positive(env.CHECKER_MAX_ATTEMPTS) ? Math.floor(positive(env.CHECKER_MAX_ATTEMPTS)!) : 1,
      ...(spec.vendor === "deepseek" ? { ...thinkingFields(env.CHECKER_THINKING), maxConcurrency: defaultMaxConcurrency(env) || 8 } : {}),
    },
    mock: false,
    replay: null,
    reason: null,
    independence,
  };
}

/** The layer-3 checker, or null (borderline sentences are then blocked). */
export function createChecker(env: Env = process.env): { client: LlmClient | null; reason: string | null; independence: CheckerIndependence | null } {
  const res = checkerConfig(env);
  if (res.mock) return { client: createMockLlm(), reason: null, independence: null };
  if (res.replay) {
    return { client: createReplayClient({ provider: res.replay.provider, model: res.replay.model, dir: env.CASSETTE_DIR }), reason: null, independence: res.independence };
  }
  if (!res.config) return { client: null, reason: res.reason, independence: null };
  const client = createCompatClient(res.config);
  return { client: recording(env) ? withRecording(client, env.CASSETTE_DIR || undefined) : client, reason: null, independence: res.independence };
}

/** Configuration summary safe to print (no values). */
export function llmStatus(env: Env = process.env) {
  const checker = checkerConfig(env);
  const live = mainProviderKind(env) === "deepseek" || mainProviderKind(env) === "openai" || !!checker.config;
  const fb = live ? fallbackConfig(env) : null;
  return {
    main: mainProviderKind(env),
    model: mainModel(env),
    openaiKey: env.OPENAI_API_KEY ? "set" : "not set",
    deepseekKey: deepseekApiKey(env) ? "set" : "not set",
    /** which variable the DeepSeek key comes from (the name, never the value) */
    deepseekKeyName: vendorKey(VENDORS.deepseek, env)?.name ?? null,
    checker: checker.config?.name ?? (checker.mock ? "mock" : checker.replay ? `replay:${checker.replay.provider}` : null),
    checkerModel: checker.config?.model ?? checker.replay?.model ?? null,
    checkerReason: checker.reason,
    checkerIndependence: checker.independence,
    recording: recording(env),
    recordingBlocked: truthy(env.LLM_RECORD) ? recordingBlockedReason(env) : null,
    // the failover target receives the full prompt (patient content) when the main model is down
    fallback: fb ? { provider: fb.name, vendor: fb.vendor, model: fb.model, receivesPatientContent: true } : null,
    spend: live ? { capUsd: spendCapUsd(env), ledger: spendLogPath(env) ? "file" : "memory", ...pick(getSpendLedger(env).summary()) } : null,
  };
}

function pick(s: ReturnType<ReturnType<typeof getSpendLedger>["summary"]>) {
  return { spentUsd: s.spentUsd, remainingUsd: s.remainingUsd, windowHours: s.windowHours };
}

export * from "./types";
export { createMockLlm, setMockInjection, composeDeterministic, createDecidingChecker } from "./mock";
export { createReplayClient, withRecording, cassetteKey, cassetteDir } from "./replay";
export { createCompatClient, buildPayload } from "./openai";
export { getSpendLedger, SpendLedger, costUsd, estimateUsd, priceFor, PRICES, personSpendCapUsd } from "./spend";
