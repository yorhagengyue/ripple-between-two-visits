/**
 * Speak one fixed, harmless sentence through TTS_PROVIDER=trtc and write the audio to a file: the first real check of
 * lib/tts/trtc.ts, which was written without keys and has never reached the service. Run it by hand once the keys are
 * in web/.env. Every run sends real, billed requests (one for the short sentence, four for --long).
 *
 *   from web/:
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/tts/say.ts            Mandarin, one request
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/tts/say.ts --en       English, one request
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/tts/say.ts --long     a longer Mandarin passage with one
 *                                                                                    English line: several requests joined
 *   ... --out D:/somewhere                                                           where the file goes
 *                                                                                    (default D:/ripple-c2/tmp/t)
 *
 * It goes through the adapter the app uses (lib/tts/trtc.ts createTrtcTts, what getTtsProvider hands out), never the
 * mock: without the real provider's configuration it stops and says which variable is missing. It prints the provider's settings by name (the host, the
 * region, the voice ids, the speed), the size and length of the audio and where it was written; never a key.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TtsError, ttsProviderName, type TtsAudio } from "@/lib/tts";
import { createTrtcTts, splitForTrtc, TRTC_TTS_REQUIRED_ENV, trtcTtsConfig, TrtcTtsError } from "@/lib/tts/trtc";

const SENTENCES = {
  zh: "你好。这是「读给我听」的试音。现在听到的是华语，一句一句，慢慢地读。",
  en: "Hello. This is a test of the read-aloud voice. It reads one sentence at a time, slowly.",
  long: [
    "这是一段比较长的试音，用来听一听句子和句子之间的停顿。",
    "第一句说今天的天气：早上有一点凉，中午出太阳，傍晚可能下一点小雨，出门记得带伞。",
    "第二句说一说数字：一共有 3 页，每页 12 行，编号是 6123 4567，时间是早上 8 点 15 分。",
    "下面这一句是英文，由同一个声音来读。",
    "The next sentence is in English, read by the same voice. Please listen for whether every word is clear.",
    "英文读完了，回到华语。如果每一句都听得清楚，中间没有少字，也没有重复，这次试音就算通过。",
  ].join("\n"),
} as const;

const CHECKLIST = [
  "What to check by ear (nothing in the code can tell):",
  "  1. It is Mandarin (not Cantonese), and every word of the text above is there, once, in order.",
  "  2. The voice suits an older listener; another one: TRTC_TTS_VOICE_ZH / TRTC_TTS_VOICE_EN (ids in progress/t.md).",
  "  3. The speed: TRTC_TTS_SPEED is 0.9 by default (the service's normal is 1.0; 0.5 to 2).",
  "  4. With --long: the pauses between sentences, the numbers, and whether the English line is clear in this voice.",
  "  5. The file plays on an iPhone, and so does the button in the app (a medicine card, the consent screen).",
];

type Env = Record<string, string | undefined>;

export interface SayDeps {
  env?: Env;
  /** tests: a stand-in for the service */
  fetch?: typeof fetch;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

/** Speak and write the file. Returns the process's exit code: 0 with a file written, 1 with nothing written. */
export async function say(args: string[], deps: SayDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const out = deps.out ?? ((l: string) => console.log(l));
  const err = deps.err ?? ((l: string) => console.error(l));
  const fail = (lines: string[]): number => {
    for (const l of lines) err(l);
    return 1;
  };
  const which: keyof typeof SENTENCES = args.includes("--long") ? "long" : args.includes("--en") ? "en" : "zh";
  const outAt = args.indexOf("--out");
  const outDir = outAt >= 0 && args[outAt + 1] ? args[outAt + 1] : "D:/ripple-c2/tmp/t";

  const chosen = (env.TTS_PROVIDER ?? "").trim().toLowerCase();
  if (chosen !== "trtc") {
    return fail([
      `Nothing was sent. TTS_PROVIDER is ${chosen ? `"${chosen}"` : "not set"}: this script speaks only through the real voice.`,
      `Set TTS_PROVIDER=trtc and ${TRTC_TTS_REQUIRED_ENV.join(", ")} in web/.env, then run it as:`,
      "  node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/tts/say.ts",
    ]);
  }
  const cfg = trtcTtsConfig(env);
  if (!cfg.ok) {
    return fail([
      "Nothing was sent. TTS_PROVIDER=trtc is not configured:",
      ...cfg.problems.map((p) => `  - ${p}`),
      "TRTC_SDK_APP_ID is the application's SDKAppID. TENCENT_SECRET_ID and TENCENT_SECRET_KEY are a cloud API key pair",
      "(TRTC console, account menu, Access Keys); the application's SDKSecretKey (TRTC_SDK_SECRET_KEY) is not used for speech.",
    ]);
  }
  // the provider the app itself would use for this environment (lib/tts getTtsProvider picks the same one)
  if (ttsProviderName(env) !== "trtc") return fail(["Nothing was sent. The provider in use is not trtc."]);
  const provider = createTrtcTts(env, deps.fetch ? { fetch: deps.fetch } : {});

  const text = SENTENCES[which];
  const lang = which === "en" ? "en" : "zh-Hans";
  const pieces = splitForTrtc(text, lang === "en" ? "en" : "zh");
  const c = cfg.config;
  out(`provider: trtc  host: ${c.endpoint}  region: ${c.region}  voice: ${c.voice[lang]}  speed: ${c.speed}  sample rate: ${c.sampleRate}`);
  out(`text (${which}, ${text.length} characters, ${pieces.length} request${pieces.length === 1 ? "" : "s"}):`);
  for (const line of text.split(/\n/)) out(`  ${line}`);

  const t0 = Date.now();
  let audio: TtsAudio;
  try {
    audio = await provider.synthesize({ text, lang });
  } catch (e) {
    if (e instanceof TtsError) {
      const h = hint(e);
      return fail([`No audio: ${e.code}. ${e.message}`, ...(h ? [h] : [])]);
    }
    return fail([`No audio: ${(e as Error).name}: ${(e as Error).message}`]);
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `say-${which}-${stamp}.wav`);
  writeFileSync(file, audio.audio);
  out("");
  out(`answered in ${Date.now() - t0} ms: ${audio.audio.byteLength} bytes, ${(audio.durationMs / 1000).toFixed(1)} s of ${audio.mime}`);
  out(`written to ${file}`);
  out("");
  for (const l of CHECKLIST) out(l);
  return 0;
}

/** What to look at first for each kind of answer (the vendor's code is printed above it). */
function hint(err: TtsError): string {
  const code = err instanceof TrtcTtsError ? (err.vendorCode ?? "") : "";
  if (/^AuthFailure\.SignatureExpire/.test(code)) return "This computer's clock is more than five minutes off.";
  if (/^AuthFailure|^UnauthorizedOperation|MissingParameter\.APIKey/.test(code)) return "Check TENCENT_SECRET_ID and TENCENT_SECRET_KEY: a cloud API key pair (Access Keys), not the application's SDKSecretKey.";
  if (code === "InvalidParameter.VoiceId") return "The voice id is not known to this application: TRTC_TTS_VOICE_ZH / TRTC_TTS_VOICE_EN.";
  if (code === "UnsupportedOperation.NotAllowed" || code === "FailedOperation.NotAbility") return "The application may not use speech synthesis yet: Conversational AI on the application, and the allowance under Package Management.";
  if (code === "UnsupportedRegion" || code === "InvalidAction" || code === "NoSuchVersion") return "The host or region does not serve this API for this account: TRTC_TTS_ENDPOINT (trtc.intl.tencentcloudapi.com or trtc.tencentcloudapi.com), TRTC_TTS_REGION.";
  if (code === "InvalidParameter.TextLength") return "The service counts this text as longer than the adapter does: tell the developer (lib/tts/trtc.ts trtcUnits).";
  if (err.code === "provider_failed") return "The service did not give audio this time (busy, slow, the network, or an answer in another shape). Try once more; if it repeats, the RequestId above is what Tencent's support asks for.";
  return "";
}

if (/[\\/]scripts[\\/]tts[\\/]say\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) {
  say(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(`No audio: ${(e as Error).name}: ${(e as Error).message}`);
      process.exit(1);
    },
  );
}
