/**
 * What this server is actually running, box by box, for /how (real-status: "数据库一格写「Supabase 在用」，这台其实是内存
 * 存储"; real-app 12: every box from the runtime config, no file paths, no ports). lib/how/stack.ts says what was decided;
 * this says what answers on this server right now: the main model, the checker, the store and sign-in, speech, the label
 * reader, voice, and the kind of build. Names and models only: never a key, an address, a port or a path. Server-only.
 */
import { effectiveAuthProvider, isDeployed, type Env } from "@/lib/dev/enabled";
import { speechProviderName } from "@/lib/asr";
import { tencentAsrConfig } from "@/lib/asr/tencent";
import { checkerConfig, hunyuanSettings, mainModel, mainProviderKind } from "@/lib/llm";
import { storeKind } from "@/lib/store";
import { realVoiceReady, ttsProviderName } from "@/lib/tts";
import { visionMode } from "@/lib/vision";
import { OCR_REGION } from "@/lib/vision/ocr";
import type { StackBox } from "./stack";

const VENDOR_NAMES: Record<string, string> = { tencent: "Tencent Cloud Hunyuan", openai: "OpenAI", anthropic: "Anthropic" };
const vendorName = (v: string) => VENDOR_NAMES[v] ?? (v.startsWith("custom:") ? "a compatible service" : v);

export type RuntimeStack = Partial<Record<StackBox["id"], string>>;

export function runtimeStack(env: Env = process.env): RuntimeStack {
  const out: RuntimeStack = {};

  const main = mainProviderKind(env);
  // which TokenHub site, as Tencent's API page describes it (no address is shown)
  const site = hunyuanSettings(env).site;
  const where =
    site === "guangzhou" ? "TokenHub's Guangzhou site, resources scheduled in mainland China" : site === "siliconvalley" ? "TokenHub's Silicon Valley site, resources scheduled in the United States" : "TokenHub's Singapore site, resources scheduled globally";
  out.main_model =
    main === "hunyuan"
      ? `Tencent Cloud Hunyuan ${mainModel(env)}, called live (${where})`
      : main === "openai"
        ? `OpenAI ${mainModel(env)}, called live`
        : main === "replay"
          ? `recorded answers of ${mainModel(env)} (no live calls)`
          : "an offline stand-in: no model is called; the rules and the fixed templates answer";

  const checker = checkerConfig(env);
  out.checker = checker.config
    ? `${vendorName(checker.config.vendor)} ${checker.config.model}${checker.independence === "same_vendor" ? " (the same vendor as the main model)" : ""}`
    : checker.mock
      ? "an offline stand-in"
      : checker.replay
        ? `recorded answers of ${checker.replay.model}`
        : "none configured: a sentence that would need it is blocked";

  let speech: string;
  try {
    speech = speechProviderName(env);
  } catch {
    speech = "unknown";
  }
  // Tencent Cloud speech recognition (lib/asr/tencent.ts): where and which engine; a missing key pair said as such
  const tencent = speech === "tencent" ? tencentAsrConfig(env) : null;
  const tencentLine = !tencent
    ? null
    : tencent.problem
      ? "Tencent Cloud speech recognition is chosen but a setting is missing or wrong: a visit recorded here waits for transcription"
      : `Tencent Cloud speech recognition in ${tencent.region} (${tencent.engine}): each finished line while he records, the whole recording at the end`;
  out.stt =
    speech === "whisper"
      ? "local Whisper"
      : tencentLine
        ? tencentLine
        : speech === "devfake"
          ? "a test stand-in (developer tools): a recorded visit gets a test transcript"
          : speech === "trtc"
            ? "TRTC (not wired: no transcripts)"
            : "recorded replays of the sample visits; a visit recorded here waits for transcription";

  // who reads label photos (lib/vision visionMode)
  const reader = visionMode(env);
  out.ocr =
    reader === "ocr"
      ? `Tencent Cloud OCR in ${OCR_REGION}: two engines read each label photo, after his yes to AI processing`
      : reader === "model"
        ? `${main === "replay" ? "recorded answers of a model" : "the model"} reads label photos (not OCR)`
        : "no reader here: the sample labels show their recorded readings, any other label is typed in";

  // C2 track F, round three: what actually speaks (lib/tts realVoiceReady), not what is merely chosen
  out.tts = realVoiceReady(env) ? "Tencent TRTC TTS" : ttsProviderName(env) === "trtc" ? "Tencent TRTC TTS is chosen but cannot speak (a setting is missing, or the service refused it): read-aloud is off" : "a placeholder test voice";

  const store = storeKind(env) === "supabase" ? "Supabase" : "kept in this server's memory (gone when it restarts)";
  const auth = effectiveAuthProvider(env) === "supabase" ? "sign-in through Supabase Auth" : "a test sign-in kept in memory";
  out.database = `${store}; ${auth}`;

  const production = (env.NODE_ENV ?? "").trim() === "production";
  out.hosting = isDeployed(env) ? "the real deployment" : production ? "a production build on this machine" : "a development server on this machine";

  return out;
}
