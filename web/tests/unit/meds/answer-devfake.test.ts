/**
 * Which speech providers let the replay transcript stand in for a visit with no stored transcript (lib/meds/answers.ts):
 * mock and the developer tools' stand-in devfake (C2 runs its whole e2e gate on devfake), never a real transcription
 * service. Without it, the demo's D12 answer picker for the relative's box offers nothing on devfake.
 */
import { describe, expect, it } from "vitest";
import { fixtureTranscriptAllowed } from "@/lib/meds/answers";

describe("the replay transcript as a visit's lines", () => {
  it("stands in with no provider, mock or devfake; never with whisper or trtc", () => {
    expect(fixtureTranscriptAllowed({})).toBe(true);
    expect(fixtureTranscriptAllowed({ SPEECH_PROVIDER: "mock" })).toBe(true);
    expect(fixtureTranscriptAllowed({ SPEECH_PROVIDER: "devfake" })).toBe(true);
    expect(fixtureTranscriptAllowed({ SPEECH_PROVIDER: " DevFake " })).toBe(true);
    expect(fixtureTranscriptAllowed({ SPEECH_PROVIDER: "whisper" })).toBe(false);
    expect(fixtureTranscriptAllowed({ SPEECH_PROVIDER: "trtc" })).toBe(false);
  });
});
