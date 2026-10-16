/**
 * A production build puts lib/asr into several bundles: the routes' chunks and instrumentation's (the scheduled jobs,
 * lib/asr/pending.ts), while the speech provider lives on globalThis. A provider or an error made by another copy of
 * these classes must still be recognised (C2 track F, as StoreError in 6e66824): otherwise the pending-transcripts job
 * finds "no Whisper" and never sends a waiting visit, or a route turns the service's "unavailable" into a 500.
 */
import { describe, expect, it } from "vitest";
import { getWhisperProvider, SpeechError, WhisperSpeechProvider, WhisperUnavailable } from "@/lib/asr";
import { isRestartShaped } from "@/lib/asr/whisper";
import { fakeConfig, fakeWhisper } from "./fake-whisper";

/** What another bundle's copy looks like here: same shape and names, different classes. */
function foreignProvider() {
  const real = new WhisperSpeechProvider({ config: fakeConfig(), fetch: fakeWhisper().fetch });
  return Object.setPrototypeOf({ name: "whisper", client: real.client, createFileJob: () => undefined }, Object.prototype) as unknown;
}

describe("speech classes across bundle copies", () => {
  it("a whisper provider made by another copy is a WhisperSpeechProvider; other providers are not", () => {
    expect(foreignProvider() instanceof WhisperSpeechProvider).toBe(true);
    expect({ name: "mock", client: {}, createFileJob: () => undefined } instanceof WhisperSpeechProvider).toBe(false);
    expect({ name: "whisper" } instanceof WhisperSpeechProvider).toBe(false);
  });

  it("getWhisperProvider finds the provider on globalThis whoever made it", () => {
    const g = globalThis as unknown as { __rippleSpeech?: Map<string, unknown> };
    g.__rippleSpeech ??= new Map();
    const before = g.__rippleSpeech.get("whisper");
    try {
      const foreign = foreignProvider();
      g.__rippleSpeech.set("whisper", foreign);
      expect(getWhisperProvider({ SPEECH_PROVIDER: "whisper" })).toBe(foreign);
      expect(getWhisperProvider({ SPEECH_PROVIDER: "mock" })).toBeNull();
    } finally {
      if (before) g.__rippleSpeech.set("whisper", before);
      else g.__rippleSpeech.delete("whisper");
    }
  });

  it("errors by name: WhisperUnavailable and SpeechError from another copy; the deadline keeps its own test", () => {
    const foreignUnavailable = Object.assign(new Error("whisper unavailable: unreachable"), { name: "WhisperUnavailable", reason: "unreachable", status: null });
    expect(foreignUnavailable instanceof WhisperUnavailable).toBe(true);
    expect(Object.assign(new Error("x"), { name: "SpeechError", code: "unavailable" }) instanceof SpeechError).toBe(true);
    expect(new Error("x") instanceof WhisperUnavailable).toBe(false);
    // a service that went away is restart-shaped (a plain WhisperUnavailable is not mistaken for the job's deadline);
    // a wrong token is not
    expect(isRestartShaped(new WhisperUnavailable("unreachable"))).toBe(true);
    expect(isRestartShaped(foreignUnavailable)).toBe(true);
    expect(isRestartShaped(new WhisperUnavailable("unauthorized"))).toBe(false);
  });
});
