/**
 * The words of her reminder clip, from the clip itself (C2 track D; architecture review 18: 「卡上的字和录音一致」).
 * Server-only. There is no typed field on her screen (the daughter brief E1-E6): what his card says is what the
 * recording says, or nothing.
 *
 *   SPEECH_PROVIDER=whisper   the local Whisper service transcribes the clip (a file job with the WAV bytes); a hard cap
 *                             of REMINDER_TRANSCRIBE_MS, and any failure, fallback or timeout means no words
 *   SPEECH_PROVIDER=devfake   the developer tools' stand-in (journeys, tests): the x-ripple-devfake-fixture header names
 *                             a fixture below, whose words the journey's fake microphone actually plays ("reminder" is
 *                             the seed clip's sentence, the same sentence the stand-in WAV says); no header, no words
 *   mock / trtc               no words (never a guess): the card shows only 「女儿的录音」 with her voice
 */
import { getSpeechProvider, speechProviderName, type SpeechProvider } from "@/lib/asr";
import { devToolsEnabled } from "@/lib/dev/enabled";
import { loadTemplate } from "@/lib/story/seed";

export const REMINDER_TRANSCRIBE_MS = 15_000;
const POLL_MS = 400;

/** The devfake stand-in's reminder fixtures: the header value -> the words the test recording says. */
export function reminderFixture(name: string | null | undefined): string | null {
  const key = (name ?? "").trim();
  if (key === "reminder") {
    const clip = loadTemplate("mr-tan").reminder_clips[0];
    return (clip?.text_zh ?? clip?.text ?? null) || null;
  }
  // a take that names a medicine and a dose: the card must show only 「女儿的录音」 (journey 18, unit tests)
  if (key === "reminder-dose") return "爸，今天记得吃一粒 Amlodipine 5 毫克。";
  if (key === "reminder-en") return "Dad, have you had breakfast? Remember your medicine.";
  return null;
}

export interface ReminderTranscript {
  text: string | null;
  source: "whisper" | "devfake" | "none";
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function transcribeReminder(
  audio: Uint8Array,
  opts: { devfakeFixture?: string | null; env?: Record<string, string | undefined>; provider?: SpeechProvider; timeoutMs?: number } = {},
): Promise<ReminderTranscript> {
  const env = opts.env ?? process.env;
  let name: string;
  try {
    name = speechProviderName(env);
  } catch {
    return { text: null, source: "none" };
  }
  if (name === "devfake") {
    if (!devToolsEnabled(env)) return { text: null, source: "none" };
    return { text: reminderFixture(opts.devfakeFixture), source: "devfake" };
  }
  if (name !== "whisper") return { text: null, source: "none" };
  const deadline = Date.now() + (opts.timeoutMs ?? REMINDER_TRANSCRIBE_MS);
  try {
    const provider = opts.provider ?? getSpeechProvider(env);
    const { jobId } = await provider.createFileJob({ url: "reminder:clip", lang: "zh-en-mixed", audio, recorded: true, speakers: 1 });
    while (Date.now() < deadline) {
      const job = await provider.getFileJob(jobId);
      if (job.status === "failed") return { text: null, source: "whisper" };
      if (job.status === "done") {
        if (job.source !== "audio" || job.fallback) return { text: null, source: "whisper" };
        const text = (job.utterances ?? []).map((u) => u.text.trim()).filter(Boolean).join(" ").trim();
        return { text: text || null, source: "whisper" };
      }
      await sleep(POLL_MS);
    }
  } catch (err) {
    console.warn("[care/transcribe] no transcript for a reminder clip", err instanceof Error ? err.name : "error");
  }
  return { text: null, source: "whisper" };
}
