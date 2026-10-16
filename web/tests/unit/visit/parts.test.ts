/**
 * How a long recording is cut and read back (C2 track R; lib/visit/parts.ts, lib/visit/recording.ts,
 * lib/visit/recording-audio.ts, lib/asr/whisper.ts joinPartUtterances), without any storage:
 *   - a part is safely under the bucket's limit and under the transcription service's intake; a recording that fits in
 *     one part is one file; a longer one is whole parts and a last one that takes a remainder shorter than a second
 *   - the phone's own limit: told before the end, stopped at the end
 *   - the visit row as a recording: one file, parts still arriving (no recording yet), a closed list
 *   - a clip across a cut is the end of one file and the start of the next, and a time past a file's end is not read
 *     from it
 *   - a transcript in parts: every part's times moved by the parts before it, the sentence across a cut joined
 */
import { describe, expect, it } from "vitest";
import { joinPartUtterances } from "@/lib/asr/whisper";
import { whisperConfig } from "@/lib/asr";
import type { BlobStore } from "@/lib/blob";
import { BUCKET_CONFIG } from "@/lib/blob/types";
import { LIMIT_NOTICE_MS, MAX_PARTS, minutesOfRoom, nextPartSamples, PART_MS, partMsOr, PHONE_MAX_PARTS, planParts, recordingLimit, tailMsFor, wavBytes } from "@/lib/visit/parts";
import { completeParts, recordingFiles, recordingMs, registeredParts, visitAudioPaths } from "@/lib/visit/recording";
import { measurePart, openRecording } from "@/lib/visit/recording-audio";
import { concatInt16, encodeWav, floatToInt16, parseWav, pcmRange, sliceWav } from "@/lib/visit/wav";

const MIN = 60_000;
const samples = (ms: number) => ms * 16;

describe("the part length", () => {
  it("one part is 20 minutes of audio: 38,400,044 bytes, safely under the bucket's 50 MiB and the service's default intake", () => {
    expect(PART_MS).toBe(20 * MIN);
    expect(wavBytes(PART_MS)).toBe(38_400_044);
    const limit = BUCKET_CONFIG.audio.maxBytes;
    expect(limit).toBe(50 * 1024 * 1024);
    // with the second a last part may carry on top
    expect(wavBytes(PART_MS + tailMsFor(PART_MS))).toBeLessThan(limit * 0.75);
    expect(wavBytes(PART_MS + tailMsFor(PART_MS))).toBeLessThan(whisperConfig({}).maxFileBytes);
    // what one file could hold at most: the 27 minutes the old upload ended at
    expect(Math.floor((limit - 44) / 32 / MIN)).toBe(27);
  });

  it("a recording that fits in one part is one file, whatever its length", () => {
    for (const ms of [1, 4000, 12 * MIN + 30_000, PART_MS, PART_MS + 999, PART_MS + 1000]) {
      expect(planParts(samples(ms), PART_MS), String(ms)).toEqual([samples(ms)]);
    }
    expect(planParts(0, PART_MS)).toEqual([]);
  });

  it("a longer one is whole parts, in order, and the last takes what is left; no part of a fraction of a second", () => {
    expect(planParts(samples(PART_MS + 1001), PART_MS)).toEqual([samples(PART_MS), samples(1001)]);
    expect(planParts(samples(45 * MIN), PART_MS)).toEqual([samples(20 * MIN), samples(20 * MIN), samples(5 * MIN)]);
    // 40 minutes and half a second: two files, the second carries the half second
    expect(planParts(samples(40 * MIN + 500), PART_MS)).toEqual([samples(20 * MIN), samples(20 * MIN + 500)]);
    // three hours: nine parts, each under the limit, nothing lost
    const three = planParts(samples(180 * MIN), PART_MS);
    expect(three).toHaveLength(9);
    expect(three.reduce((n, x) => n + x, 0)).toBe(samples(180 * MIN));
    expect(Math.max(...three) * 2 + 44).toBeLessThan(BUCKET_CONFIG.audio.maxBytes);
    // what is still to send after two parts went: the same cut as from the start (a resumed upload makes the same files)
    expect(nextPartSamples(samples(45 * MIN) - 2 * samples(PART_MS), PART_MS)).toBe(samples(5 * MIN));
  });

  it("a small part length for tests cuts the same way; anything unreasonable is the real one", () => {
    expect(partMsOr(2000)).toBe(2000);
    expect(planParts(samples(7300), 2000)).toEqual([samples(2000), samples(2000), samples(2000), samples(1300)]);
    // the tail of a tiny part is a quarter of it: 2.4 s is one more part of 2.4 s, not 2 s + 0.4 s
    expect(tailMsFor(2000)).toBe(500);
    expect(planParts(samples(4400), 2000)).toEqual([samples(2000), samples(2400)]);
    for (const bad of [null, undefined, 0, -5, 1.5, 199, PART_MS + 1, Number.NaN]) expect(partMsOr(bad as number)).toBe(PART_MS);
  });
});

describe("the longest recording the phone makes", () => {
  it("three hours: told ten minutes before, stopped at the end, and always within what the server takes", () => {
    expect(PHONE_MAX_PARTS).toBeLessThanOrEqual(MAX_PARTS);
    expect(recordingLimit(0)).toMatchObject({ state: "ok", maxMs: 180 * MIN, leftMs: 180 * MIN });
    expect(recordingLimit(169 * MIN + 59_000).state).toBe("ok");
    expect(recordingLimit(170 * MIN)).toMatchObject({ state: "soon", leftMs: LIMIT_NOTICE_MS });
    expect(recordingLimit(179 * MIN + 59_000).state).toBe("soon");
    expect(recordingLimit(180 * MIN)).toMatchObject({ state: "stop", leftMs: 0 });
    expect(recordingLimit(200 * MIN).state).toBe("stop");
    // a test's tiny parts: nine of them, the notice half a part before the end
    expect(recordingLimit(16_900, 2000).state).toBe("ok");
    expect(recordingLimit(17_000, 2000).state).toBe("soon");
    expect(recordingLimit(18_000, 2000).state).toBe("stop");
  });

  it("minutes of room on the phone: whole minutes, never negative, nothing from a number that is not one", () => {
    expect(minutesOfRoom(0)).toBe(0);
    expect(minutesOfRoom(2_200_000 * 30 + 5)).toBe(30);
    expect(minutesOfRoom(-1)).toBe(0);
    expect(minutesOfRoom(Number.NaN)).toBe(0);
  });
});

describe("the visit row as a recording", () => {
  const a = { path: "p/visits/v/recording-a.wav", ms: 2000 };
  const b = { path: "p/visits/v/recording-b.wav", ms: 2000 };
  const c = { path: "p/visits/v/recording-c.wav", ms: 900 };

  it("one file: the recording is that file, no list, its length is the file's own", () => {
    const v = { audio_path: a.path };
    expect(recordingFiles(v)).toEqual([{ path: a.path, ms: null, startMs: 0 }]);
    expect(completeParts(v)).toBeNull();
    expect(registeredParts(v)).toEqual([]);
    expect(recordingMs(v)).toBeNull();
    expect(visitAudioPaths(v)).toEqual([a.path]);
    expect(recordingFiles({ audio_path: null })).toEqual([]);
    expect(visitAudioPaths({ audio_path: null })).toEqual([]);
  });

  it("parts still arriving: no recording yet, and every part that arrived is the visit's", () => {
    const v = { audio_path: null, audio_parts: [a, b] };
    expect(recordingFiles(v)).toEqual([]);
    expect(completeParts(v)).toBeNull();
    expect(registeredParts(v)).toEqual([a, b]);
    expect(visitAudioPaths(v)).toEqual([a.path, b.path]);
  });

  it("a closed list: the files in order, each with where it starts in the visit", () => {
    const v = { audio_path: a.path, audio_parts: [a, b, c] };
    expect(recordingFiles(v)).toEqual([
      { path: a.path, ms: 2000, startMs: 0 },
      { path: b.path, ms: 2000, startMs: 2000 },
      { path: c.path, ms: 900, startMs: 4000 },
    ]);
    expect(recordingMs(v)).toBe(4900);
    expect(visitAudioPaths(v)).toEqual([a.path, b.path, c.path]);
  });

  it("a list that is not this recording (another file is the recording), or rows that are not parts: the path alone is the recording", () => {
    const v = { audio_path: "p/visits/v/recording-whole.wav", audio_parts: [a, b] };
    expect(recordingFiles(v)).toEqual([{ path: v.audio_path, ms: null, startMs: 0 }]);
    // still pointed at, so the sweep leaves them until the list is cleared
    expect(visitAudioPaths(v)).toEqual([v.audio_path, a.path, b.path]);
    const odd = { audio_path: a.path, audio_parts: [a, { path: "", ms: 5 }, { path: "x", ms: Number.NaN }, null, "y"] as never };
    expect(registeredParts(odd)).toEqual([a]);
  });
});

describe("reading the audio of a recording in parts", () => {
  /** three files whose samples say which file they are from */
  const files = new Map<string, Uint8Array>([
    ["p/a.wav", encodeWav(new Int16Array(samples(2000)).fill(100))],
    ["p/b.wav", encodeWav(new Int16Array(samples(2000)).fill(200))],
    ["p/c.wav", encodeWav(new Int16Array(samples(900)).fill(300))],
  ]);
  const reads: string[] = [];
  const blob = {
    async getObject(_bucket: string, p: string) {
      reads.push(p);
      const bytes = files.get(p);
      return bytes ? { bytes, contentType: "audio/wav" } : null;
    },
  } as unknown as BlobStore;
  const visit = { audio_path: "p/a.wav", audio_parts: [{ path: "p/a.wav", ms: 2000 }, { path: "p/b.wav", ms: 2000 }, { path: "p/c.wav", ms: 900 }] };
  const pcm = (wav: Uint8Array | null) => {
    const info = parseWav(wav!)!;
    return Array.from(new Int16Array(wav!.slice(info.dataOffset, info.dataOffset + info.dataLength).buffer));
  };

  it("a clip inside one file comes from that file alone; a clip across a cut is the end of one and the start of the next", async () => {
    reads.length = 0;
    const rec = openRecording(blob, visit)!;
    expect(rec.files.map((f) => f.startMs)).toEqual([0, 2000, 4000]);
    const inside = pcm(await rec.clip(2100, 2600));
    expect(inside.length).toBe(samples(500));
    expect(new Set(inside)).toEqual(new Set([200]));
    expect(reads).toEqual(["p/b.wav"]);

    const across = pcm(await rec.clip(1750, 2250));
    expect(across.length).toBe(samples(500));
    expect(across.slice(0, samples(250)).every((x) => x === 100)).toBe(true);
    expect(across.slice(samples(250)).every((x) => x === 200)).toBe(true);
    // across two cuts: the whole middle file with a bit of both neighbours
    const wide = pcm(await rec.clip(1900, 4100));
    expect(wide.length).toBe(samples(2200));
    expect([wide[0], wide[samples(100)], wide[samples(2100) - 1], wide[samples(2100)]]).toEqual([100, 200, 200, 300]);
    // past the end of the recording there is nothing; a range that ends in the last file stops with it
    expect(await rec.clip(4900, 5200)).toBeNull();
    expect(pcm(await rec.clip(4700, 9999)).length).toBe(samples(200));
    expect(await rec.clip(300, 300)).toBeNull();
  });

  it("the files are read one at a time, in order, each once when the lines are in order", async () => {
    reads.length = 0;
    const rec = openRecording(blob, visit)!;
    for (const [s, e] of [[100, 400], [900, 1500], [1900, 2300], [2500, 3000], [3900, 4200], [4300, 4800]]) expect(await rec.clip(s, e)).not.toBeNull();
    expect(reads).toEqual(["p/a.wav", "p/b.wav", "p/c.wav"]);
  });

  it("a recording in one file is cut exactly as before", async () => {
    const one = openRecording(blob, { audio_path: "p/b.wav" })!;
    expect(one.files).toHaveLength(1);
    expect(await one.clip(250, 750)).toEqual(sliceWav(files.get("p/b.wav")!, 250, 750));
    expect(openRecording(blob, { audio_path: null, audio_parts: visit.audio_parts })).toBeNull();
    // a file that is not in storage: no clip, no error
    expect(await openRecording(blob, { audio_path: "p/missing.wav" })!.clip(0, 100)).toBeNull();
  });

  it("what the server accepts as a part: a 16 kHz mono 16-bit WAV with audio; its length is measured", () => {
    expect(measurePart(files.get("p/c.wav")!)).toEqual({ ok: true, ms: 900 });
    expect(measurePart(new Uint8Array([1, 2, 3]))).toEqual({ ok: false, why: "not_wav" });
    expect(measurePart(encodeWav(new Int16Array(480), 48_000))).toEqual({ ok: false, why: "wrong_format" });
    expect(measurePart(encodeWav(new Int16Array(0)))).toEqual({ ok: false, why: "empty" });
  });

  it("sample helpers: a range of a file, floats as the encoder writes them, runs joined", () => {
    const wav = encodeWav(Int16Array.from({ length: 160 }, (_, i) => i));
    expect(Array.from(pcmRange(wav, 2, 4)!.samples)).toEqual(Array.from({ length: 32 }, (_, i) => 32 + i));
    expect(pcmRange(wav, 50, 60)).toBeNull();
    const floats = Float32Array.from([0, 0.5, -0.5, 1, -1, 2, -2]);
    expect(encodeWav(floatToInt16(floats))).toEqual(encodeWav(floats));
    expect(Array.from(concatInt16([Int16Array.from([1, 2]), new Int16Array(0), Int16Array.from([3])]))).toEqual([1, 2, 3]);
  });
});

describe("a transcript made part by part", () => {
  const u = (tStartMs: number, tEndMs: number, text: string, more: Record<string, unknown> = {}) => ({ tStartMs, tEndMs, speaker: null, text, ...more });

  it("every part's times are moved by the parts before it; a pause across the cut keeps two lines", () => {
    const out = joinPartUtterances([
      { startMs: 0, utterances: [u(300, 900, "Doctor, can I record?")] },
      { startMs: 1_200_000, utterances: [u(1000, 2000, "Sure, no problem.")] },
      { startMs: 2_400_000, utterances: [u(0, 400, "Come back in six weeks.")] },
    ]);
    expect(out.map((x) => [x.tStartMs, x.tEndMs, x.text])).toEqual([
      [300, 900, "Doctor, can I record?"],
      [1_201_000, 1_202_000, "Sure, no problem."],
      [2_400_000, 2_400_400, "Come back in six weeks."],
    ]);
  });

  it("the sentence the cut went through is one line again: its text joined, its end the second half's, the less sure of the two", () => {
    const out = joinPartUtterances(
      [
        { startMs: 0, utterances: [u(100, 500, "Good morning."), u(1_199_200, 1_200_000, "At home, we want it below", { lang: "en", confidence: "high" })] },
        { startMs: 1_200_000, utterances: [u(0, 700, "135 over 85.", { lang: "en", confidence: "medium" }), u(3000, 4000, "好的。", { lang: "zh" })] },
      ],
      550,
    );
    expect(out.map((x) => [x.tStartMs, x.tEndMs, x.text])).toEqual([
      [100, 500, "Good morning."],
      [1_199_200, 1_200_700, "At home, we want it below 135 over 85."],
      [1_203_000, 1_204_000, "好的。"],
    ]);
    expect(out[1]).toMatchObject({ lang: "en", confidence: "medium" });
    // Chinese halves join without a space
    const zh = joinPartUtterances([
      { startMs: 0, utterances: [u(1500, 2000, "医生，我家里那个机器")] },
      { startMs: 2000, utterances: [u(100, 900, "是绑手腕的，可以用吗？")] },
    ]);
    expect(zh.map((x) => x.text)).toEqual(["医生，我家里那个机器是绑手腕的，可以用吗？"]);
  });

  it("a part with no speech moves nothing but the clock; one part alone is as it came", () => {
    const out = joinPartUtterances([
      { startMs: 0, utterances: [u(100, 500, "One.")] },
      { startMs: 2000, utterances: [] },
      { startMs: 4000, utterances: [u(0, 300, "Two.")] },
    ]);
    expect(out.map((x) => [x.tStartMs, x.text])).toEqual([
      [100, "One."],
      [4000, "Two."],
    ]);
    expect(joinPartUtterances([{ startMs: 0, utterances: [u(5, 9, "Only.")] }])).toEqual([u(5, 9, "Only.")]);
    expect(joinPartUtterances([])).toEqual([]);
  });
});
