/**
 * The app's environment file on the server (/etc/ripple/web.env): which names go in, which values the scripts write
 * themselves, and whether the result is a configuration the deployed app would start with and run as intended
 * (C2 track P; docs/plan/hosting.md 5.5, 5.7).
 *
 * The check does not have rules of its own where the app has them: the candidate environment is handed to the app's own
 * functions, the ones the server runs at start-up (lib/auth/boot.ts, lib/guard/boot.ts: what a deployment refuses to
 * start with) and the ones that pick each provider (lib/ops/health.ts, which is also what /api/health answers). So
 * "LLM_PROVIDER=hunyuan with an empty key" is refused here because the app would run its mock, not because this file
 * knows about keys.
 *
 * Two decisions are still open and are switches on the command line, never read from the file and never assumed:
 *   --speech mock      no transcription service: a recorded visit is saved and its page says the text comes once a
 *                      service is connected (the app's own wording, lib/visit/account-copy.ts "visit.noService")
 *   --speech whisper   the service at WHISPER_URL (https) with WHISPER_TOKEN
 *   --speech tencent   Tencent Cloud speech recognition (lib/asr/tencent.ts): TENCENT_SECRET_ID, TENCENT_SECRET_KEY;
 *                      TENCENT_ASR_REGION (default ap-singapore) and TENCENT_ASR_ENGINE (default 16k_zh_en) optional
 *   --tts mock         no read-aloud on accounts (the app hides the button), the demo keeps its labelled test voice
 *   --tts trtc         Tencent RTC's TextToSpeech: TRTC_SDK_APP_ID, TENCENT_SECRET_ID, TENCENT_SECRET_KEY
 * The Tencent Cloud key pair (TENCENT_SECRET_*) is one pair for both: it goes into the file when either switch needs it.
 * Values are never printed: only names, and what is wrong with them.
 */
import { tencentAsrConfig, type TencentAsrProblem } from "@/lib/asr/tencent";
import { whisperConfig } from "@/lib/asr/whisper";
import { authDeployProblems } from "@/lib/auth/boot";
import { guardDeployProblems } from "@/lib/guard/boot";
import { HEALTH_COMPARED, healthReport } from "@/lib/ops/health";
import { trtcTtsConfig } from "@/lib/tts/trtc";
import { type Args, DeployError } from "./cli";
import { type DeployContext, isHostname, OWNER_ONLY, shapeProblem, type Values } from "./deploy-file";

export interface Switches {
  speech: "mock" | "whisper" | "tencent";
  tts: "mock" | "trtc";
}

/** --speech and --tts, both required; --profile judges | commercial is the plan's older name for the speech choice. */
export function switchesOf(args: Args): Switches {
  const profile = args.value("profile");
  if (profile !== undefined && profile !== "judges" && profile !== "commercial") throw new DeployError("--profile is judges or commercial");
  const fromProfile = profile === "judges" ? "mock" : profile === "commercial" ? "whisper" : undefined;
  const speech = args.value("speech") ?? fromProfile;
  const tts = args.value("tts");
  if (args.value("speech") && fromProfile && args.value("speech") !== fromProfile) throw new DeployError(`--profile ${profile} means --speech ${fromProfile}; it was given together with --speech ${args.value("speech")}`);
  if (speech !== "mock" && speech !== "whisper" && speech !== "tencent") {
    throw new DeployError(
      "say whether this deployment has a transcription service: --speech mock (none: a recorded visit waits for its text and the page says so), --speech whisper (WHISPER_URL, WHISPER_TOKEN) or --speech tencent (Tencent Cloud speech recognition: TENCENT_SECRET_ID, TENCENT_SECRET_KEY). This is still an open decision, so there is no default.",
    );
  }
  if (tts !== "mock" && tts !== "trtc") {
    throw new DeployError("say which read-aloud voice this deployment uses: --tts mock (no real voice: accounts get no read-aloud button) or --tts trtc (TRTC_SDK_APP_ID, TENCENT_SECRET_ID, TENCENT_SECRET_KEY). This is still an open decision, so there is no default.");
  }
  return { speech, tts };
}

/** Written by the script, the same on every deployment; the deploy file may repeat them but not contradict them. */
export const FIXED: Readonly<Values> = {
  RIPPLE_DEPLOYED: "1",
  STORE: "supabase",
  BLOB_DRIVER: "supabase",
  AUTH_PROVIDER: "supabase",
  LLM_PROVIDER: "hunyuan",
  CHECKER_PROVIDER: "hunyuan",
  TRUSTED_PROXY_HOPS: "1",
  JOBS: "1",
  FILMING_MODE: "false",
  LLM_SPEND_LOG: "/srv/ripple/shared/llm-spend.jsonl",
};

const SPEECH_NAMES = /^(WHISPER_|ASR_REPLAY_FALLBACK$)/;
/** Tencent Cloud speech recognition's own settings (the key pair is TENCENT_KEY_NAMES) */
const TENCENT_ASR_NAMES = /^TENCENT_ASR_/;
/** one Tencent Cloud API key pair, for speech recognition (--speech tencent) and read-aloud (--tts trtc) alike */
const TENCENT_KEY_NAMES = /^TENCENT_SECRET_/;
const TTS_NAMES = /^TRTC_/;

/** A transcription service that runs on this deployment's own lines (the replay fallback is turned off with it). */
const transcribes = (sw: Switches) => sw.speech === "whisper" || sw.speech === "tencent";

/** What a Tencent speech setting problem means, by name (lib/asr/tencent.ts tencentAsrConfig): never a value. */
const TENCENT_PROBLEM: Record<TencentAsrProblem, string> = {
  no_keys: "TENCENT_SECRET_ID and TENCENT_SECRET_KEY are not set",
  no_secret_id: "TENCENT_SECRET_ID is not set",
  no_secret_key: "TENCENT_SECRET_KEY is not set",
  bad_region: "TENCENT_ASR_REGION is not a region name like ap-singapore",
  bad_engine: "TENCENT_ASR_ENGINE is not a 16 kHz engine name like 16k_zh_en",
  bad_endpoint: "TENCENT_ASR_ENDPOINT is not an asr.*.tencentcloudapi.com host name",
};

export interface WebEnv {
  env: Values;
  /** names whose value the script wrote (fixed, derived from the host names, a default, or a switch) */
  written: string[];
  /** names taken from the deploy file */
  fromFile: string[];
  /** names the deploy file has that were left out, with the reason */
  left: Array<{ name: string; why: string }>;
}

/** The candidate web.env for these switches. Stops on a deploy-file value that contradicts what the script writes. */
export function buildWebEnv(ctx: DeployContext, sw: Switches): WebEnv {
  const v = ctx.deploy.values;
  const appDomain = v.DEPLOY_APP_DOMAIN;
  if (!appDomain || !isHostname(appDomain)) throw new DeployError("DEPLOY_APP_DOMAIN is missing or not a host name: the app's public address is built from it");
  const env: Values = {};
  const written: string[] = [];
  const fromFile: string[] = [];
  const left: WebEnv["left"] = [];
  const deployable = ctx.app.all.filter((n) => !ctx.app.notDeployed.includes(n));

  const write = (name: string, value: string, conflict: (fileValue: string) => boolean = (fv) => fv.toLowerCase() !== value.toLowerCase()) => {
    if (v[name] && conflict(v[name])) {
      throw new DeployError(`${name} is written by the script for every deployment (${name === "APP_BASE_URL" || name === "RIPPLE_PUBLIC_HOSTS" ? "from DEPLOY_APP_DOMAIN" : `it is always ${value}`}); the deploy file sets it to something else. Remove it from the deploy file.`);
    }
    env[name] = value;
    written.push(name);
  };

  for (const [name, value] of Object.entries(FIXED)) write(name, value);
  write("APP_BASE_URL", `https://${appDomain}`, (fv) => fv.replace(/\/+$/, "").toLowerCase() !== `https://${appDomain}`);
  write("SPEECH_PROVIDER", sw.speech, () => false);
  write("TTS_PROVIDER", sw.tts, () => false);
  if (transcribes(sw)) write("ASR_REPLAY_FALLBACK", "off", (fv) => !["off", "0", "false", "no"].includes(fv.toLowerCase()));

  for (const name of deployable) {
    if (name in env) {
      if (v[name] && (name === "SPEECH_PROVIDER" || name === "TTS_PROVIDER") && v[name].toLowerCase() !== env[name]) left.push({ name, why: `the --${name === "SPEECH_PROVIDER" ? "speech" : "tts"} switch decides` });
      continue;
    }
    if (!v[name]) continue;
    if (SPEECH_NAMES.test(name) && sw.speech !== "whisper") left.push({ name, why: "only with --speech whisper" });
    else if (TENCENT_ASR_NAMES.test(name) && sw.speech !== "tencent") left.push({ name, why: "only with --speech tencent" });
    else if (TENCENT_KEY_NAMES.test(name) && sw.speech !== "tencent" && sw.tts !== "trtc") left.push({ name, why: "only with --speech tencent or --tts trtc" });
    else if (TTS_NAMES.test(name) && sw.tts !== "trtc") left.push({ name, why: "only with --tts trtc" });
    else {
      env[name] = v[name];
      fromFile.push(name);
    }
  }
  // defaults the plan sets for this hosting, unless the file says otherwise
  const fallback = (name: string, value: string) => {
    if (env[name]) return;
    env[name] = value;
    written.push(name);
  };
  fallback("BUS_STREAM_MAX_MS", "290000");
  fallback("RIPPLE_PUBLIC_HOSTS", appDomain);
  fallback("VAPID_SUBJECT", `https://${appDomain}`);
  return { env, written, fromFile, left };
}

function silently<T>(read: () => T): T {
  const warn = console.warn;
  const info = console.info;
  console.warn = () => {};
  console.info = () => {};
  try {
    return read();
  } finally {
    console.warn = warn;
    console.info = info;
  }
}

/** What /api/health must answer once the server runs with this environment (the compared fields only). */
export function expectedHealth(env: Values): Record<string, unknown> {
  const report = silently(() => healthReport({ ...env, NODE_ENV: "production" })) as unknown as Record<string, unknown>;
  return Object.fromEntries(HEALTH_COMPARED.map((k) => [k, report[k]]));
}

/** What a deployment's health must be for these switches, whatever the file says. */
export function requiredHealth(sw: Switches): Record<string, unknown> {
  return { store: "supabase", blob: "supabase", auth: "supabase", llm: "hunyuan", checker: "hunyuan", speech: sw.speech, speech_problem: null, tts: sw.tts, jobs: true, deployed: true, push: true };
}

const NEEDS: Record<string, string> = {
  llm: "LLM_PROVIDER=hunyuan with HUNYUAN_API_KEY set (a TokenHub API key) and, when set, a TokenHub HUNYUAN_BASE_URL (without them the app answers from its offline mock)",
  checker: "CHECKER_PROVIDER=hunyuan with a key and a CHECKER_MODEL other than the main model (without a checker every borderline sentence is blocked)",
  push: "VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, a matching pair (without it reminders reach a phone only while the app is open)",
  speech: "the speech provider the --speech switch names",
  speech_problem: "WHISPER_URL and WHISPER_TOKEN (32 or more characters) for --speech whisper; TENCENT_SECRET_ID and TENCENT_SECRET_KEY for --speech tencent",
  tts: "the read-aloud provider the --tts switch names (trtc needs TRTC_SDK_APP_ID)",
};

/**
 * Everything that makes this environment unfit to push (empty: push it). Sentences about names, never a value.
 */
export function webEnvProblems(ctx: DeployContext, web: WebEnv, sw: Switches): string[] {
  const env = web.env;
  const candidate: Record<string, string | undefined> = { ...env, NODE_ENV: "production" };
  const out: string[] = [];

  for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SUPABASE_ANON_KEY", "HUNYUAN_API_KEY", "AUTH_USERNAME_DOMAIN", "EDGE_SECRET", "BLOB_SIGNING_SECRET"]) {
    if (!env[name]) out.push(`${name} is not set${OWNER_ONLY[name] ? ` (the owner supplies it: ${OWNER_ONLY[name]})` : ""}`);
  }
  for (const name of Object.keys(env)) {
    const p = shapeProblem(name, env[name], { ...ctx.deploy.values, ...env });
    if (p) out.push(`${name} ${p}`);
  }
  if (env.BLOB_SIGNING_SECRET && Buffer.byteLength(env.BLOB_SIGNING_SECRET, "utf8") < 32) out.push("BLOB_SIGNING_SECRET is shorter than 32 bytes");
  for (const name of ["SUPABASE_DB_URL", "SCRIPTED_FALLBACK_KEY", "RIPPLE_DEV_TOOLS", "RIPPLE_TEST_CLOCK", "LLM_RECORD"]) {
    if (name in env) out.push(`${name} must never be in the app's environment on the server`);
  }

  // what the server itself refuses to start with (the same functions instrumentation.ts runs)
  out.push(...silently(() => [...authDeployProblems(candidate), ...guardDeployProblems(candidate)]));

  // what the running app would be, against what a deployment must be
  const got = expectedHealth(env);
  const want = requiredHealth(sw);
  for (const key of Object.keys(want)) {
    if (got[key] === want[key]) continue;
    out.push(`the app would run with ${key}=${String(got[key])}; a deployment needs ${key}=${String(want[key])}: ${NEEDS[key] ?? `check the ${key} settings`}`);
  }
  if (sw.speech === "whisper") {
    const cfg = whisperConfig(candidate);
    if (!cfg.problem && !(cfg.url ?? "").startsWith("https://")) out.push("WHISPER_URL is not https://: the token would cross the internet in the clear");
  }
  if (sw.speech === "tencent") {
    const problem = tencentAsrConfig(candidate).problem;
    if (problem) out.push(`speech recognition (--speech tencent): ${TENCENT_PROBLEM[problem]}`);
  }
  if (sw.tts === "trtc") {
    const cfg = trtcTtsConfig(candidate);
    if (!cfg.ok) out.push(...cfg.problems.map((p) => `read-aloud (--tts trtc): ${p}`));
  }
  return [...new Set(out)];
}

const BARE = /^[A-Za-z0-9_@%+=:,./-]*$/;

/**
 * NAME=value lines systemd's EnvironmentFile and a POSIX shell both read the same way: a plain value as is, anything
 * else in single quotes (no escapes exist inside them). A value with a single quote or a line break cannot be written
 * and stops the script (by name).
 */
export function formatEnvFile(env: Values, header: string): string {
  const lines = [`# ${header}`];
  for (const name of Object.keys(env).sort()) {
    const value = env[name];
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new DeployError("internal: a name that is not a variable name reached the environment file", 1);
    if (/['\r\n\0]/.test(value)) throw new DeployError(`${name} contains a single quote or a line break: it cannot be written to an environment file`);
    lines.push(BARE.test(value) ? `${name}=${value}` : `${name}='${value}'`);
  }
  return `${lines.join("\n")}\n`;
}
