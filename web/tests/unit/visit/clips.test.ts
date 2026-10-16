/**
 * Task card M2 做-7: the recording is cut into one clip per sentence, stored in Storage
 * (audio/<session>/visits/<visit>/segments/<utterance>.wav), linked from the sentence (clip_path) and
 * playable from the card and the clip route.
 *
 * The mock speech job replays a script file (source "fixture") and never reaches this path, so the test hands
 * finalizeVisit a whole-visit transcript of the recording itself (source "audio"), the shape the TRTC job
 * returns: no ids, a speaker number per sentence, times in the recording.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as clipGET } from "@/app/api/visits/[id]/clip/route";
import type { FileJobResult } from "@/lib/asr";
import { getBlobStore } from "@/lib/blob";
import { resetSession } from "@/lib/session/ops";
import { getMemoryStore } from "@/lib/store/memory";
import { finalizeVisit, startVisit } from "@/lib/visit/pipeline";
import { clipUrl } from "@/lib/visit/view";
import { encodeWav, parseWav } from "@/lib/visit/wav";
import { newSession } from "./helpers";

const saved = { ...process.env };
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ripple-m2-clips-"));
  process.env.BLOB_LOCAL_DIR = dir;
  delete process.env.BLOB_DRIVER;
});
afterAll(() => {
  process.env = saved;
  rmSync(dir, { recursive: true, force: true });
});

const RATE = 16_000;

/** 12 s of 16 kHz mono where second k holds the constant sample value (k + 1) * 1000: a slice tells where it came from. */
function recording(seconds = 12): Uint8Array {
  const pcm = new Int16Array(seconds * RATE);
  for (let i = 0; i < pcm.length; i++) pcm[i] = (Math.floor(i / RATE) + 1) * 1000;
  return encodeWav(pcm, RATE);
}

function samples(wav: Uint8Array): Int16Array {
  const info = parseWav(wav)!;
  const pcm = wav.slice(info.dataOffset, info.dataOffset + info.dataLength);
  return new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
}

const TRANSCRIPT: NonNullable<FileJobResult["utterances"]> = [
  { tStartMs: 1000, tEndMs: 3000, speaker: 0, text: "Doctor, can I record? My daughter wants me to use this app." },
  { tStartMs: 3500, tEndMs: 4500, speaker: 1, text: "Sure, no problem." },
  { tStartMs: 5000, tEndMs: 9000, speaker: 1, text: "Mr Tan, your blood pressure today is 152 over 94. I took it twice, still high." },
  // after the end of the 12 s recording: nothing to cut, no clip
  { tStartMs: 13000, tEndMs: 15000, speaker: 0, text: "But I feel okay leh." },
];

function req(url: string, sessionId: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost:3200${url}${url.includes("?") ? "&" : "?"}session=${sessionId}`, { headers });
}

describe("per-sentence clips cut from the recording (task card 做-7)", () => {
  it("finalize cuts each sentence into segments/<utterance>.wav, links it, and the clip route plays it", async () => {
    const s = await newSession({ story_day: 0 });
    const store = getMemoryStore();
    await startVisit(getMemoryStore(), s, { mode: "record", consent: { given: true } });
    const audioPath = `${s.id}/visits/v1/recording-test.wav`;
    await getBlobStore().putObject("audio", audioPath, recording(), "audio/wav");
    await store.updateVisit(s.id, "v1", { audio_path: audioPath, status: "transcribing" });

    const view = await finalizeVisit(getMemoryStore(), s, "v1", { status: "done", source: "audio", utterances: TRANSCRIPT });
    expect(view.visit.status).toBe("review");
    const rows = (await store.listUtterances(s.id, "v1")).sort((a, b) => a.t_start_ms - b.t_start_ms);
    expect(rows.map((u) => u.text)).toEqual(TRANSCRIPT.map((u) => u.text));

    for (const [i, u] of rows.slice(0, 3).entries()) {
      const t = TRANSCRIPT[i];
      // stored in Storage under the session, one file per sentence
      expect(u.clip_path).toBe(`${s.id}/visits/v1/segments/${u.id}.wav`);
      const obj = await getBlobStore().getObject("audio", u.clip_path!);
      expect(obj, u.id).not.toBeNull();
      const info = parseWav(obj!.bytes)!;
      expect(info).toMatchObject({ sampleRate: RATE, channels: 1, bitsPerSample: 16, durationMs: t.tEndMs - t.tStartMs });
      // the right stretch of the recording: first and last samples come from the seconds the sentence covers
      const pcm = samples(obj!.bytes);
      expect(pcm[0]).toBe((Math.floor(t.tStartMs / 1000) + 1) * 1000);
      expect(pcm[pcm.length - 1]).toBe((Math.floor((t.tEndMs - 1) / 1000) + 1) * 1000);

      // the screen links it as the speaker's own recording (not a stand-in)
      const line = view.lines.find((l) => l.id === u.id)!;
      expect(line.clip).toEqual({ url: clipUrl(s.id, "v1", u.id), standIn: false });

      // and the clip route plays it: the same bytes, audio/wav, not marked as a stand-in, seekable
      const res = await clipGET(req(`/api/visits/v1/clip?u=${u.id}`, s.id), { params: Promise.resolve({ id: "v1" }) });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("audio/wav");
      expect(res.headers.get("x-ripple-stand-in")).toBe("0");
      expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(obj!.bytes))).toBe(true);
      const part = await clipGET(req(`/api/visits/v1/clip?u=${u.id}`, s.id, { range: "bytes=0-43" }), { params: Promise.resolve({ id: "v1" }) });
      expect(part.status).toBe(206);
    }

    // the clinic reading sentence has a doctor's-note card, and the card carries the clip
    const reading = view.cards.find((c) => c.kind === "doc" && c.anchor === rows[2].id);
    expect(reading && reading.kind === "doc" ? reading.clip : null).toEqual({ url: clipUrl(s.id, "v1", rows[2].id), standIn: false });

    // a sentence outside the recording gets no clip, and no play button
    expect(rows[3].clip_path).toBeNull();
    expect(view.lines.find((l) => l.id === rows[3].id)!.clip).toBeNull();
    expect((await clipGET(req(`/api/visits/v1/clip?u=${rows[3].id}`, s.id), { params: Promise.resolve({ id: "v1" }) })).status).toBe(404);

    // another session cannot play them
    const other = await newSession({ story_day: 0 });
    expect((await clipGET(req(`/api/visits/v1/clip?u=${rows[0].id}`, other.id), { params: Promise.resolve({ id: "v1" }) })).status).toBe(404);

    // resetting the session deletes the clips with the recording (spec section 3)
    await resetSession(getMemoryStore(), s.id);
    for (const u of rows.slice(0, 3)) expect(await getBlobStore().getObject("audio", u.clip_path!)).toBeNull();
    expect(await getBlobStore().getObject("audio", audioPath)).toBeNull();
  });

  it("a transcript replayed from a script file (mock, source fixture) cuts nothing from the recording", async () => {
    const s = await newSession({ story_day: 0 });
    await startVisit(getMemoryStore(), s, { mode: "record", consent: { given: true } });
    const audioPath = `${s.id}/visits/v1/recording-test.wav`;
    await getBlobStore().putObject("audio", audioPath, recording(), "audio/wav");
    await getMemoryStore().updateVisit(s.id, "v1", { audio_path: audioPath });
    await finalizeVisit(getMemoryStore(), s, "v1", { status: "done", source: "fixture", utterances: TRANSCRIPT });
    const rows = await getMemoryStore().listUtterances(s.id, "v1");
    expect(rows.every((u) => !u.clip_path?.includes("/segments/"))).toBe(true);
  });
});
