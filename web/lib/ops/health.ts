/**
 * What GET /api/health reports about this process's configuration (C2 track P; docs/plan/hosting.md 5.7, 5.12 item 1).
 * Names only: which store, which model provider, which checker, which speech and read-aloud provider, whether the
 * scheduled jobs run here, whether the process considers itself the real deployment. Never a key, a URL, a host, a
 * file path or a count of anything about people.
 *
 * The deploy scripts (web/scripts/deploy) compute the same report from the environment file they are about to push and,
 * after the restart, compare it with what the running server answers: a server that came back with another
 * configuration (an old process, a file that was not read, a provider that fell back to its mock because a key is
 * missing) is caught there instead of by a judge.
 *
 * Every field comes from the function the app itself uses to pick that provider, so a fallback the app would take
 * (LLM_PROVIDER=hunyuan without its key pair runs the offline mock) is what gets reported. Server-only.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { speechProviderName } from "@/lib/asr";
import { tencentAsrConfig } from "@/lib/asr/tencent";
import { whisperConfig } from "@/lib/asr/whisper";
import { blobDriver } from "@/lib/blob";
import { effectiveAuthProvider, isDeployed } from "@/lib/dev/enabled";
import { checkerConfig, mainProviderKind } from "@/lib/llm";
import { vapidConfig } from "@/lib/push/vapid";
import { storeKind } from "@/lib/store";
import { ttsProviderName, ttsReady } from "@/lib/tts";

type Env = Record<string, string | undefined>;

export interface HealthReport {
  /** memory | supabase | invalid */
  store: string;
  /** local | supabase | invalid: where recordings and label photos go */
  blob: string;
  /** memory | supabase | another AUTH_PROVIDER value's kind is never echoed: anything else reads "other" */
  auth: string;
  /** hunyuan | openai | replay | mock: what answers a question (mock also when the key is missing) */
  llm: string;
  /** the checker's provider name, or mock | replay | none (none: borderline sentences are all blocked) */
  checker: string;
  /** mock | whisper | tencent | trtc | devfake | invalid: mock means this server has no transcription service */
  speech: string;
  /**
   * with speech = whisper: null, or why it cannot be reached (no_url | bad_url | no_token | short_token); with speech =
   * tencent: null, or what is missing or wrong (no_keys | no_secret_id | no_secret_key | bad_region | bad_engine |
   * bad_endpoint). Names a variable's problem, never a value.
   */
  speech_problem: string | null;
  /** mock | trtc */
  tts: string;
  /** the read-aloud provider answers with audio as it stands (the mock's tones count) */
  tts_ready: boolean;
  /** the scheduled jobs loop runs in this process (JOBS=1) */
  jobs: boolean;
  /** RIPPLE_DEPLOYED=1: the real hosting server, with its start-up refusals */
  deployed: boolean;
  /** web push can be sent (a VAPID key pair is configured) */
  push: boolean;
}

/** The fields a deployment is compared on (tts_ready depends on the vendor's last answer, so it is not one of them). */
export const HEALTH_COMPARED = ["store", "blob", "auth", "llm", "checker", "speech", "speech_problem", "tts", "jobs", "deployed", "push"] as const;

const KNOWN_AUTH = new Set(["memory", "supabase"]);

function guarded<T extends string>(read: () => T): T | "invalid" {
  try {
    return read();
  } catch {
    return "invalid";
  }
}

/**
 * Three of the readers warn on every call while they fall back (the main model, the checker through it, read-aloud):
 * right for the server log when a request needs them, noise when a monitor asks every few minutes. Warnings said once
 * per process (push keys, an incomplete read-aloud configuration) are not read inside this.
 */
function quietly<T>(read: () => T): T {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return read();
  } finally {
    console.warn = warn;
  }
}

function checkerName(env: Env): string {
  const resolved = checkerConfig(env);
  if (resolved.mock) return "mock";
  if (resolved.replay) return "replay";
  // config.name is CHECKER_PROVIDER after it matched the vendor table (or "compatible"): a fixed word, never a URL
  return resolved.config ? resolved.config.name : "none";
}

export function healthReport(env: Env = process.env): HealthReport {
  const models = quietly(() => ({ llm: mainProviderKind(env), checker: guarded(() => checkerName(env)), tts: ttsProviderName(env) }));
  const speech = guarded(() => speechProviderName(env));
  const auth = effectiveAuthProvider(env);
  return {
    store: guarded(() => storeKind(env)),
    blob: guarded(() => blobDriver(env)),
    auth: KNOWN_AUTH.has(auth) ? auth : "other",
    llm: models.llm,
    checker: models.checker,
    speech,
    speech_problem: speech === "whisper" ? whisperConfig(env).problem : speech === "tencent" ? tencentAsrConfig(env).problem : null,
    tts: models.tts,
    // the mock always answers (its tones); a real provider says for itself whether it can speak now
    tts_ready: models.tts === "mock" ? true : guarded(() => (ttsReady(env) ? "yes" : "no")) === "yes",
    jobs: (env.JOBS ?? "").trim() === "1",
    deployed: isDeployed(env),
    push: guarded(() => (vapidConfig(env) ? "yes" : "no")) === "yes",
  };
}

let buildId: string | null | undefined;

/**
 * This build's id (.next/BUILD_ID, the same string every page's static file paths carry), or null under next dev.
 * A release compares it with the build it just made, so an old process still answering on the port is not taken for
 * the new version.
 */
export function buildIdOf(cwd: string = process.cwd()): string | null {
  if (buildId !== undefined) return buildId;
  try {
    const file = path.join(cwd, ".next", "BUILD_ID");
    buildId = existsSync(file) ? readFileSync(file, "utf8").trim().slice(0, 64) || null : null;
  } catch {
    buildId = null;
  }
  return buildId;
}

/** Tests only: forget the cached build id. */
export function resetBuildIdForTests(): void {
  buildId = undefined;
}
