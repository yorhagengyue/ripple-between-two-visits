/**
 * Check Tencent Cloud speech recognition with the real key pair (SPEECH_PROVIDER=tencent; lib/asr/tencent.ts): one fixture
 * clip through the provider's own client, as a live line is sent, and prints the text, the time it took and the engine.
 * Run it by hand once TENCENT_SECRET_ID and TENCENT_SECRET_KEY are in web/.env. Every run sends real, billed requests (one
 * recognition task for the clip; --whole a few more).
 *
 *   from web/:
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/asr/tencent-check.ts                 the doctor's line v2-u08
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/asr/tencent-check.ts --clip <wav>    another 16 kHz mono WAV
 *   ... --engine 16k_zh_large     another engine for this run (the default is TENCENT_ASR_ENGINE, else 16k_zh_en)
 *   ... --whole                   also the whole-visit path: the clip as a recording, cut into pieces and joined
 *   ... --health                  only the check that recognises nothing (DescribeTaskStatus for a task that does not exist)
 *
 * It prints the settings by name (the host, the region, the engine), the text Tencent sent back and the milliseconds; never
 * a key. Without the key pair it stops at once, says which variable is missing, sends nothing and exits with 2; a refusal
 * or a failure of the service exits with 1, with the reason the app would see and what to look at.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { TencentAsrClient, tencentAsrConfig, TencentSpeechProvider, type TencentAsrProblem } from "@/lib/asr/tencent";
import { WhisperUnavailable } from "@/lib/asr/whisper";
import { parseWav } from "@/lib/visit/wav";

type Env = Record<string, string | undefined>;

export interface CheckDeps {
  env?: Env;
  /** tests: a stand-in for the service */
  fetch?: typeof fetch;
  out?: (line: string) => void;
  err?: (line: string) => void;
  /** where web/ is (the default clip is under it) */
  webDir?: string;
}

const MISSING: Record<TencentAsrProblem, string> = {
  no_keys: "TENCENT_SECRET_ID and TENCENT_SECRET_KEY are not set",
  no_secret_id: "TENCENT_SECRET_ID is not set",
  no_secret_key: "TENCENT_SECRET_KEY is not set",
  bad_region: "TENCENT_ASR_REGION is not a region name like ap-singapore",
  bad_engine: "TENCENT_ASR_ENGINE (or --engine) is not a 16 kHz engine name like 16k_zh_en",
  bad_endpoint: "TENCENT_ASR_ENDPOINT is not an asr.*.tencentcloudapi.com host name",
};

/** What to look at first for each reason (the reason is printed above it). */
function hint(reason: string): string {
  if (reason === "unauthorized") return "Check TENCENT_SECRET_ID and TENCENT_SECRET_KEY (a cloud API key pair under Access Keys), and that this computer's clock is right.";
  if (reason === "not_configured:service_not_enabled") return "Recording file recognition is not opened on this account: open it in the ASR console (Speech Recognition, recording file recognition).";
  if (reason === "not_configured:no_balance" || reason === "not_configured:service_isolated") return "The account has no free quota or balance left for speech recognition: the ASR console, resource packs or pay-as-you-go.";
  if (reason.startsWith("not_configured:")) return "The host or region does not serve this API for this account: TENCENT_ASR_REGION (ap-singapore) or TENCENT_ASR_ENDPOINT.";
  if (reason === "busy") return "Too many requests at once: try again in a moment.";
  if (reason.startsWith("rejected_")) return "The service refused this request or this audio: the clip must be a 16 kHz mono 16-bit WAV of at most a few MB.";
  if (reason === "timeout" || reason === "unreachable") return "The service did not answer in time or could not be reached: the network, or try once more.";
  return "The service did not give a usable answer: try once more; if it repeats, tell the developer the reason above.";
}

/** Returns the process's exit code: 0 checked, 1 the service refused or failed, 2 nothing was sent (a setting is missing). */
export async function check(args: string[], deps: CheckDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const out = deps.out ?? ((l: string) => console.log(l));
  const err = deps.err ?? ((l: string) => console.error(l));
  const web = deps.webDir ?? process.cwd();
  const at = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
  };
  const engine = at("--engine");
  const config = tencentAsrConfig({ ...env, ...(engine ? { TENCENT_ASR_ENGINE: engine } : {}) });
  if (config.problem) {
    err(`Nothing was sent: ${MISSING[config.problem]}.`);
    err("Put the cloud API key pair in web/.env (TENCENT_SECRET_ID, TENCENT_SECRET_KEY; never printed) and run:");
    err("  node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/asr/tencent-check.ts");
    return 2;
  }
  const clipPath = at("--clip") ?? path.join(web, "fixtures", "visits", "clips", "v2-u08.wav");
  let clip: Uint8Array;
  try {
    clip = new Uint8Array(readFileSync(clipPath));
  } catch {
    err(`Nothing was sent: the clip ${clipPath} cannot be read.`);
    return 2;
  }
  const info = parseWav(clip);
  if (!info || info.sampleRate !== 16_000 || info.channels !== 1 || info.bitsPerSample !== 16) {
    err(`Nothing was sent: ${clipPath} is not a 16 kHz mono 16-bit WAV (the phone records that, and the engine takes 16 kHz).`);
    return 2;
  }
  const client = new TencentAsrClient(config, deps.fetch ? { fetch: deps.fetch } : {});
  out(`provider: tencent  host: ${config.endpoint}  region: ${config.region}  engine: ${config.engine}`);

  const t0 = Date.now();
  const health = await client.check();
  out(`health check (DescribeTaskStatus for a task that does not exist; nothing billed): ${health ? `NOT OK: ${health}` : "ok"} in ${Date.now() - t0} ms`);
  if (health) {
    err(hint(health));
    return 1;
  }
  if (args.includes("--health")) return 0;

  out(`clip: ${path.basename(clipPath)} (${(info.durationMs / 1000).toFixed(1)} s)`);
  try {
    const r = await client.chunk(clip, { kind: "final" });
    out(`live line: ${r.roundTripMs} ms from sending to text (the task itself ${r.modelMs} ms), language ${r.lang ?? "unknown"}`);
    out(`text: ${r.text || "(nothing heard)"}`);
    for (const s of r.segments) out(`  [${(s.start_ms / 1000).toFixed(2)}-${(s.end_ms / 1000).toFixed(2)} s] ${s.text}`);
  } catch (e) {
    const reason = e instanceof WhisperUnavailable ? e.reason : `error:${(e as Error)?.name ?? "unknown"}`;
    err(`No text: ${reason}`);
    err(hint(reason));
    return 1;
  }

  if (args.includes("--whole")) {
    const provider = new TencentSpeechProvider({ config, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
    const t1 = Date.now();
    const { jobId } = await provider.createFileJob({ url: "check", lang: "zh-en-mixed", audio: clip, recorded: true });
    for (;;) {
      const job = await provider.getFileJob(jobId);
      if (job.status === "pending") {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      if (job.status === "failed" || job.fallback) {
        const reason = job.fallback?.reason ?? job.error ?? "failed";
        err(`Whole-visit path: no transcript (${reason}).`);
        err(hint(reason));
        return 1;
      }
      out(`whole-visit path: ${Date.now() - t1} ms, ${job.utterances?.length ?? 0} line(s), model ${job.model}`);
      for (const u of job.utterances ?? []) out(`  [${(u.tStartMs / 1000).toFixed(2)}-${(u.tEndMs / 1000).toFixed(2)} s] ${u.text}`);
      break;
    }
  }
  return 0;
}

if (/[\\/]scripts[\\/]asr[\\/]tencent-check\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) {
  check(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      // the name only: a message could carry the request
      console.error(`No text: ${(e as Error)?.name ?? "error"}`);
      process.exit(1);
    },
  );
}
