/**
 * Which model clients the app uses, from the environment (names only are ever printed, never values).
 *
 * Main model (classification fallback, generation, whole-visit item extraction, Ripple's summary and answers):
 *   LLM_PROVIDER = hunyuan | openai | replay | mock | stub (stub is an alias of mock)
 *   - hunyuan: Tencent Cloud Hunyuan (the owner's decision of 10-16: 「模型本身用混元。把 DeepSeek 直接去掉。」) on Tencent
 *     Cloud's TokenHub, OpenAI-compatible (./hunyuan.ts says why and what the pages say): HUNYUAN_API_KEY (a TokenHub API
 *     key), HUNYUAN_BASE_URL (default the international Singapore site, https://tokenhub-intl.tencentcloudmaas.com/v1;
 *     TokenHub's own hosts only),
 *     HUNYUAN_MODEL (default hy3). Without the key (or with a base URL that is not TokenHub's) it falls back to mock with a
 *     warning, so the app runs with no keys at all;
 *   - explicit value wins; openai without OPENAI_API_KEY falls back to mock the same way;
 *   - unset: openai when OPENAI_API_KEY is set, otherwise mock. Hunyuan is never picked implicitly (a key in web/.env
 *     must not make the tests spend money): it needs LLM_PROVIDER=hunyuan.
 *   - deepseek is retired (10-16): LLM_PROVIDER=deepseek is refused with a warning naming hunyuan, never called.
 *   LLM_MODEL (wins over HUNYUAN_MODEL; default per provider: hy3, gpt-5.4-mini), LLM_VISION_MODEL (label photos; with Hunyuan
 *   none: no Hunyuan model reads images on the account), LLM_FALLBACK_PROVIDER (failover target, needs
 *   its own key), LLM_TIMEOUT_MS, LLM_MAX_ATTEMPTS, LLM_MAX_CONCURRENCY, LLM_QUEUE_TIMEOUT_MS, REPLAY_PROVIDER (provider the
 *   cassettes were recorded with, default openai), CASSETTE_DIR. Hunyuan's thinking (on by default at the vendor for hy3
 *   and hy4-preview) is sent off (`thinking: {type: "disabled"}`) unless HUNYUAN_THINKING=enabled (LLM_THINKING is read
 *   when that is not set).
 *
 * Checker (layer 3): CHECKER_PROVIDER = hunyuan | anthropic | gemini | mistral | xai | compatible | replay | mock ;
 *   CHECKER_API_KEY (Hunyuan: falls back to HUNYUAN_API_KEY) ; CHECKER_MODEL (Hunyuan default hy4-preview, the other
 *   Hunyuan chat model TokenHub lists) ; CHECKER_BASE_URL (only for "compatible") ; CHECKER_TIMEOUT_MS (default 10000) ;
 *   CHECKER_MAX_ATTEMPTS (default 1) ; CHECKER_THINKING (Hunyuan, default HUNYUAN_THINKING, i.e. disabled). The checker has its own
 *   concurrency queue, and CHECKER_TIMEOUT_MS bounds the whole check (waiting for a slot included), so a busy main model
 *   cannot hold a check open.
 *   Unset, incomplete, or the main model itself -> no checker, and borderline sentences are blocked (fail closed).
 *   web-app.md asked for a second vendor; on 10-09 Gengyue chose a different model of the main model's vendor (then
 *   DeepSeek), and since 10-16 the checker is a different Hunyuan model: same vendor, different model. That is allowed
 *   only for Hunyuan and only with a different model, and `independence: "same_vendor"` says so wherever the checker is
 *   described. CHECKER_PROVIDER=replay answers layer 3 from cassettes recorded with REPLAY_CHECKER_PROVIDER (default
 *   hunyuan).
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
import { HUNYUAN_CHECKER_MODEL, HUNYUAN_DEFAULT_BASE_URL, HUNYUAN_KEY_ENV, HUNYUAN_MAIN_MODEL, HUNYUAN_VISION_MODEL, hunyuanSettings } from "./hunyuan";
import { createCompatClient, defaultMaxConcurrency, type CompatConfig } from "./openai";
import { createMockLlm } from "./mock";
import { createReplayClient, withRecording } from "./replay";
import { getSpendLedger, spendCapUsd, spendLogPath } from "./spend";
import type { LlmClient } from "./types";

type Env = Record<string, string | undefined>;

/**
 * OpenAI's default model. The main model is Hunyuan (HUNYUAN_MAIN_MODEL, hy3, since 10-16; lib/how describes it); OpenAI remains an optional provider (LLM_PROVIDER=openai), and replay looks up OpenAI-recorded cassettes
 * (REPLAY_PROVIDER=openai) under this name.
 */
export const DEFAULT_MAIN_MODEL = "gpt-5.4-mini";
export { HUNYUAN_CHECKER_MODEL, HUNYUAN_MAIN_MODEL, HUNYUAN_VISION_MODEL } from "./hunyuan";

interface VendorSpec {
  vendor: string;
  baseUrl: string;
  maxTokensField: CompatConfig["maxTokensField"];
  jsonMode: boolean;
  /** env variable with this vendor's key, used when no explicit key is given */
  keyEnv?: string;
  /** a checker from the same vendor is acceptable when it is a different model (10-09, now Hunyuan) */
  sameVendorChecker?: boolean;
}

/** Endpoints. "hunyuan" and "openai" serve the main model; any of them can check. */
export const VENDORS: Record<string, VendorSpec> = {
  // TokenHub (./hunyuan.ts): the base URL comes from HUNYUAN_BASE_URL, checked to be TokenHub's
  // jsonMode false: TokenHub's response_format json_object garbles hy3's replies (./hunyuan.ts); the prompts ask for JSON
  hunyuan: { vendor: "tencent", baseUrl: HUNYUAN_DEFAULT_BASE_URL, maxTokensField: "max_tokens", jsonMode: false, keyEnv: HUNYUAN_KEY_ENV, sameVendorChecker: true },
  openai: { vendor: "openai", baseUrl: "https://api.openai.com/v1", maxTokensField: "max_completion_tokens", jsonMode: true, keyEnv: "OPENAI_API_KEY" },
  anthropic: { vendor: "anthropic", baseUrl: "https://api.anthropic.com/v1", maxTokensField: "max_tokens", jsonMode: false },
  gemini: { vendor: "google", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", maxTokensField: "max_tokens", jsonMode: true },
  mistral: { vendor: "mistral", baseUrl: "https://api.mistral.ai/v1", maxTokensField: "max_tokens", jsonMode: true },
  xai: { vendor: "xai", baseUrl: "https://api.x.ai/v1", maxTokensField: "max_tokens", jsonMode: true },
};

export type MainProviderKind = "hunyuan" | "openai" | "replay" | "mock";

/** A vendor's key from its own environment variable (the name, never the value, is reported). */
export function vendorKey(spec: Pick<VendorSpec, "keyEnv">, env: Env = process.env): { value: string; name: string } | null {
  if (spec.keyEnv && env[spec.keyEnv]) return { value: env[spec.keyEnv]!, name: spec.keyEnv };
  return null;
}

/** Hunyuan's base URL when it is a TokenHub one (null: a URL the app refuses to send a key to). */
function hunyuanBase(env: Env): string | null {
  const s = hunyuanSettings(env);
  return s.problem === "bad_base_url" ? null : s.baseUrl;
}

const warned = new Set<string>();
const warnOnce = (line: string) => {
  if (warned.has(line)) return;
  warned.add(line);
  console.warn(line);
};

export function mainProviderKind(env: Env = process.env): MainProviderKind {
  const raw = (env.LLM_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "mock" || raw === "stub") return "mock";
  if (raw === "replay") return "replay";
  if (raw === "hunyuan") {
    if (!hunyuanSettings(env).problem) return "hunyuan";
    warnOnce(`[llm] LLM_PROVIDER=hunyuan but its settings are not usable (${hunyuanSettings(env).problem}); using the offline mock`);
    return "mock";
  }
  if (raw === "openai") {
    if (env.OPENAI_API_KEY) return "openai";
    warnOnce("[llm] LLM_PROVIDER=openai but OPENAI_API_KEY is not set; using the offline mock");
    return "mock";
  }
  if (raw === "deepseek") warnOnce("[llm] LLM_PROVIDER=deepseek is retired (10-16); set LLM_PROVIDER=hunyuan. Not calling DeepSeek");
  else if (raw !== "") warnOnce(`[llm] unknown LLM_PROVIDER=${raw}; using ${env.OPENAI_API_KEY ? "openai" : "mock"}`);
  return env.OPENAI_API_KEY ? "openai" : "mock";
}

/** The model the main client uses for this configuration (mock stands in for Hunyuan, the configured main model). */
export function mainModel(env: Env = process.env): string {
  if (env.LLM_MODEL) return env.LLM_MODEL;
  const kind = mainProviderKind(env);
  const hunyuan = env.HUNYUAN_MODEL || HUNYUAN_MAIN_MODEL;
  if (kind === "openai") return DEFAULT_MAIN_MODEL;
  if (kind === "replay") return replayProvider(env) === "hunyuan" ? hunyuan : DEFAULT_MAIN_MODEL;
  return hunyuan;
}

function replayProvider(env: Env): string {
  return (env.REPLAY_PROVIDER || "openai").trim().toLowerCase();
}

/** The vendor behind the main model (mock and replay stand in for the vendor they replace). */
export function mainVendor(env: Env = process.env): string {
  const kind = mainProviderKind(env);
  if (kind === "openai") return "openai";
  if (kind === "replay") return VENDORS[replayProvider(env)]?.vendor ?? replayProvider(env);
  // hunyuan, and mock standing in for it (the configured main model since 10-16)
  return "tencent";
}

const positive = (v: string | undefined): number | null => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

const thinkingOn = (value: string | undefined) => (value ?? "").trim().toLowerCase() === "enabled";

/** Hunyuan's thinking setting: HUNYUAN_THINKING (disabled | enabled), else the older LLM_THINKING; disabled when unset. */
const hunyuanThinking = (env: Env): string | undefined => env.HUNYUAN_THINKING || env.LLM_THINKING;

/**
 * Hunyuan's thinking switch (on by default at the vendor for hy3 and hy4-preview; off here unless asked) and the token
 * floor thinking needs (it spends tokens before the answer).
 */
function thinkingFields(value: string | undefined): Pick<CompatConfig, "extraBody" | "minMaxTokens"> {
  // (HUNYUAN_THINKING: measured 10-16, thinking on takes 10-20 s and can spend all of max_tokens reasoning)
  return thinkingOn(value) ? { extraBody: { thinking: { type: "enabled" } }, minMaxTokens: 4096 } : { extraBody: { thinking: { type: "disabled" } } };
}

/** A Hunyuan client's configuration for one model (main, checker or vision). `thinking` undefined: no thinking field. */
function hunyuanConfig(env: Env, name: string, model: string, apiKey: string, baseUrl: string, thinking: string | undefined | null): CompatConfig {
  const v = VENDORS.hunyuan;
  return {
    name,
    vendor: v.vendor,
    baseUrl,
    apiKey,
    model,
    maxTokensField: v.maxTokensField,
    jsonMode: v.jsonMode,
    ...(thinking === null ? {} : thinkingFields(thinking)),
    timeoutMs: positive(env.LLM_TIMEOUT_MS) ?? 15_000,
    maxAttempts: positive(env.LLM_MAX_ATTEMPTS) ? Math.floor(positive(env.LLM_MAX_ATTEMPTS)!) : 2,
    // keeps one process from bursting the budget (the vendor's own limits answer 429 with Retry-After)
    maxConcurrency: defaultMaxConcurrency(env) || 8,
  };
}

function hunyuanMainConfig(env: Env): CompatConfig {
  const s = hunyuanSettings(env);
  return hunyuanConfig(env, "hunyuan", mainModel(env), s.apiKey ?? "", s.baseUrl, hunyuanThinking(env));
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
  const cfg = kind === "hunyuan" ? hunyuanMainConfig(env) : openAiConfig(env);
  cfg.fallback = fallbackConfig(env);
  const client = createCompatClient(cfg);
  return recording(env) ? withRecording(client, env.CASSETTE_DIR || undefined) : client;
}

/** The model that reads label photos: with Hunyuan, LLM_VISION_MODEL or none (no Hunyuan model reads images); else the main model. */
export function visionModel(env: Env = process.env): string | null {
  return mainProviderKind(env) === "hunyuan" ? env.LLM_VISION_MODEL || HUNYUAN_VISION_MODEL : env.LLM_VISION_MODEL || mainModel(env);
}

/**
 * The client lib/vision reads label photos with. With LLM_PROVIDER=hunyuan: the same vendor and key with LLM_VISION_MODEL
 * when it names a model that reads images (same spend ledger, its own concurrency queue, no thinking field), else the
 * mock (lib/vision then reads with Tencent Cloud OCR, or offline: no Hunyuan model reads images on the account, ./hunyuan.ts). OpenAI, replay and
 * mock: the main client, as before.
 */
export function createVisionLlm(env: Env = process.env): LlmClient {
  if (mainProviderKind(env) !== "hunyuan") return createMainLlm(env);
  const s = hunyuanSettings(env);
  const model = visionModel(env);
  // no Hunyuan model reads images (./hunyuan.ts HUNYUAN_VISION_MODEL): lib/vision reads with its offline path instead
  if (!model) return createMockLlm();
  const cfg = hunyuanConfig(env, "hunyuan", model, s.apiKey ?? "", s.baseUrl, null);
  cfg.slotKey = "hunyuan:vision";
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
  const baseUrl = name === "hunyuan" ? hunyuanBase(env) : spec.baseUrl;
  if (!baseUrl) return null;
  return {
    name,
    vendor: spec.vendor,
    baseUrl,
    apiKey: env.LLM_FALLBACK_API_KEY,
    model: env.LLM_FALLBACK_MODEL,
    maxTokensField: spec.maxTokensField,
    jsonMode: spec.jsonMode,
    ...(name === "hunyuan" ? thinkingFields(hunyuanThinking(env)) : {}),
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
    const provider = (env.REPLAY_CHECKER_PROVIDER || "hunyuan").trim().toLowerCase();
    const model = env.CHECKER_MODEL || (provider === "hunyuan" ? HUNYUAN_CHECKER_MODEL : "");
    if (!model) return none("CHECKER_MODEL not set");
    const vendor = VENDORS[provider]?.vendor ?? provider;
    return { config: null, mock: false, replay: { provider, model }, reason: null, independence: vendor === mainVendor(env) ? "same_vendor" : "other_vendor" };
  }
  if (name === "deepseek") return none("CHECKER_PROVIDER=deepseek is retired (10-16); set CHECKER_PROVIDER=hunyuan");
  let spec: VendorSpec | undefined = VENDORS[name];
  if (name === "compatible") {
    if (!env.CHECKER_BASE_URL) return none("CHECKER_BASE_URL not set");
    spec = { vendor: `custom:${env.CHECKER_BASE_URL}`, baseUrl: env.CHECKER_BASE_URL, maxTokensField: "max_tokens", jsonMode: false };
  }
  if (!spec) return none(`unknown CHECKER_PROVIDER=${name}`);
  const apiKey = env.CHECKER_API_KEY || vendorKey(spec, env)?.value || "";
  if (!apiKey) return none(spec.keyEnv ? `CHECKER_API_KEY or ${spec.keyEnv} not set` : "CHECKER_API_KEY not set");
  const baseUrl = name === "hunyuan" ? hunyuanBase(env) : spec.baseUrl;
  if (!baseUrl) return none("HUNYUAN_BASE_URL is not a TokenHub address");
  const model = env.CHECKER_MODEL || (name === "hunyuan" ? HUNYUAN_CHECKER_MODEL : "");
  if (!model) return none("CHECKER_MODEL not set");
  let independence: CheckerIndependence = "other_vendor";
  if (spec.vendor === mainVendor(env)) {
    if (!spec.sameVendorChecker) return none("checker must be a different vendor from the main model");
    if (model === mainModel(env)) return none("checker must not be the main model itself");
    independence = "same_vendor";
  }
  // fail closed fast: one attempt, a short timeout; a slow checker blocks the sentence instead of the answer.
  // The timeout bounds the whole check, queue wait included, and the checker waits in its own queue.
  const bounds = {
    timeoutMs: checkerTimeoutMs(env),
    totalTimeoutMs: checkerTimeoutMs(env),
    queueTimeoutMs: checkerTimeoutMs(env),
    slotKey: `${name}:checker`,
    maxAttempts: positive(env.CHECKER_MAX_ATTEMPTS) ? Math.floor(positive(env.CHECKER_MAX_ATTEMPTS)!) : 1,
  };
  const config: CompatConfig =
    name === "hunyuan"
      ? { ...hunyuanConfig(env, name, model, apiKey, baseUrl, env.CHECKER_THINKING || hunyuanThinking(env)), ...bounds }
      : { name, vendor: spec.vendor, baseUrl, apiKey, model, maxTokensField: spec.maxTokensField, jsonMode: spec.jsonMode, ...bounds };
  return { config, mock: false, replay: null, reason: null, independence };
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
  const kind = mainProviderKind(env);
  const live = kind === "hunyuan" || kind === "openai" || !!checker.config;
  const fb = live ? fallbackConfig(env) : null;
  const hy = hunyuanSettings(env);
  return {
    main: kind,
    model: mainModel(env),
    visionModel: kind === "hunyuan" ? visionModel(env) : null,
    openaiKey: env.OPENAI_API_KEY ? "set" : "not set",
    hunyuanKey: hy.apiKey ? "set" : "not set",
    /** which TokenHub site Hunyuan calls go to (singapore: global; guangzhou: mainland China; siliconvalley), never the key */
    hunyuanSite: hy.site,
    hunyuanProblem: hy.problem,
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
export { hunyuanSettings } from "./hunyuan";
export { getSpendLedger, SpendLedger, costUsd, estimateUsd, priceFor, PRICES, personSpendCapUsd } from "./spend";
