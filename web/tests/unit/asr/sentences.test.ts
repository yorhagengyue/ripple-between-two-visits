/**
 * The doctor's line sentence by sentence (owner, 10-14: asked 「我能不能多吃」, the answer is the doctor's order and the app
 * plays the seconds of his recording that say it, not his whole line; lib/asr/sentences.ts, and the index
 * web/fixtures/visits/clips/sentences.json that scripts/asr/clip-sentences.ts measured with ffmpeg's silencedetect):
 *   the index    cuts every stand-in clip whose line has two or more sentences: the line's sentences in order, word for
 *                word, each a stretch of the clip that starts and ends in silence, in order, apart, as long as its words
 *   the route    &s=k is that stretch as a WAV file of its own (a valid header, the clip's own samples, shorter than the
 *                whole), &s=k-m a run of sentences, Range still works; any other s, a stand-in clip with no index and a
 *                real recording: 404; without s the whole clip, as before
 *   the answer   on the example account 「我能不能多吃」 and 「我多吃了一粒怎么办」 quote "Please don't change the dose yourself."
 *                with &s=0, the line's own source and citation, its translation cut the same way; a question about high
 *                readings, or about something else, keeps the line whole
 *   the helpers  sentenceOf / sentenceRange, sentenceClipUrl, the &s= values, narrowQuote's guards, cutTranslation
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as askPost } from "@/app/api/ask/route";
import { GET as clipGet } from "@/app/api/visits/[id]/clip/route";
import index from "@/fixtures/visits/clips/sentences.json";
import { fixtureUtterances, type FileJobResult } from "@/lib/asr";
import {
  clipSentences,
  cutTranslation,
  doseQuoteTopic,
  narrowQuote,
  parseSentenceParam,
  sentenceClipUrl,
  sentenceCut,
  sentenceOf,
  sentenceRange,
} from "@/lib/asr/sentences";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { getBlobStore } from "@/lib/blob";
import { createMockLlm } from "@/lib/llm";
import { ask } from "@/lib/safety/pipeline";
import { sentencePieces } from "@/lib/safety/text";
import type { AskResult, Candidate, Sentence } from "@/lib/safety/types";
import { getMemoryStore } from "@/lib/store/memory";
import { setTestClock } from "@/lib/time/now";
import { finalizeVisit, startVisit } from "@/lib/visit/pipeline";
import { encodeWav, parseWav } from "@/lib/visit/wav";
import { newSession } from "../visit/helpers";

const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";
const R4_DOSE = "Please don't change the dose yourself.";
const R4_READINGS = "If your readings are high, write them down and tell me at your next visit.";
const MOVED_R4 = "Please don't. Change the dose yourself. If your readings are high, write them down and tell me at your next visit.";
/** R4's checked translation in the example set (web/fixtures/translations/example.zh.json) */
const R4_ZH = "请不要自己改药量。如果读数高，把它们写下来，下次看诊时告诉我。";
const R4_DOSE_ZH = "请不要自己改药量。";

const CLIPS = path.join(process.cwd(), "fixtures", "visits", "clips");
const CLIP_IDS = readdirSync(CLIPS)
  .filter((f) => /^[a-z0-9]+-u\d{2,3}\.wav$/.test(f))
  .map((f) => f.slice(0, -4))
  .sort();
const wavOf = (id: string) => new Uint8Array(readFileSync(path.join(CLIPS, `${id}.wav`)));
const lineOf = (id: string) => fixtureUtterances(id.slice(0, id.indexOf("-u")))!.find((u) => u.id === id)!.text;
const MULTI = CLIP_IDS.filter((id) => sentencePieces(lineOf(id)).length >= 2);

/** The 16-bit samples of a PCM WAV as bytes (to compare a slice with the clip it came from). */
const dataOf = (wav: Uint8Array) => {
  const info = parseWav(wav)!;
  return Buffer.from(wav.subarray(info.dataOffset, info.dataOffset + info.dataLength));
};
/** The loudest sample of a 16-bit mono WAV within `windowMs` of `atMs`. */
function peakNear(wav: Uint8Array, atMs: number, windowMs = 15): number {
  const info = parseWav(wav)!;
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const from = Math.max(0, Math.floor(((atMs - windowMs) * info.sampleRate) / 1000));
  const to = Math.min(info.dataLength / 2, Math.ceil(((atMs + windowMs) * info.sampleRate) / 1000));
  let peak = 0;
  for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(view.getInt16(info.dataOffset + i * 2, true)));
  return peak;
}
/** Spoken words: one a word, one a digit of a number ("180" is said as about three words). */
const spokenWords = (text: string) => text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).reduce((n, t) => n + (/^\D*\d+\D*$/.test(t) ? t.replace(/\D/g, "").length : 1), 0);

const saved = { ...process.env };
let blobDir: string;
beforeAll(() => {
  process.env.LLM_PROVIDER = "mock"; // the stub model (POST /api/ask on an account)
  blobDir = mkdtempSync(path.join(tmpdir(), "ripple-clip-sentences-"));
  process.env.BLOB_LOCAL_DIR = blobDir;
  delete process.env.BLOB_DRIVER;
});
afterAll(() => {
  process.env = saved;
  setTestClock(null);
  rmSync(blobDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- the index

describe("the index matches the lines and the clips", () => {
  it("cuts every stand-in clip whose line has two or more sentences, and no other", () => {
    expect(MULTI).toEqual(["v2-u06", "v2-u08", "v3-u19", "v3-u20"]);
    expect(Object.keys(index).sort()).toEqual(MULTI);
    for (const id of CLIP_IDS.filter((x) => !MULTI.includes(x))) expect(clipSentences(id), id).toBeNull();
  });

  it.each(MULTI)("%s: the line's sentences in order, word for word, each a stretch of the clip that starts and ends in silence", (id) => {
    const cuts = clipSentences(id)!;
    expect(cuts.map((c) => c.text)).toEqual(sentencePieces(lineOf(id)));
    const wav = wavOf(id);
    const info = parseWav(wav)!;
    expect(info).toMatchObject({ sampleRate: 16_000, channels: 1, bitsPerSample: 16 });
    // quieter than -50 dBFS at every cut inside the clip: the cut falls in a pause, never in a word
    const quiet = 32768 * 10 ** (-50 / 20);
    for (const [k, c] of cuts.entries()) {
      expect(Number.isInteger(c.startMs) && Number.isInteger(c.endMs), `${id} ${k}`).toBe(true);
      expect(c.startMs, `${id} ${k}`).toBeGreaterThanOrEqual(0);
      expect(c.endMs, `${id} ${k}`).toBeGreaterThan(c.startMs);
      expect(c.endMs, `${id} ${k}`).toBeLessThanOrEqual(info.durationMs);
      if (k > 0) expect(c.startMs, `${id} ${k} after ${k - 1}`).toBeGreaterThan(cuts[k - 1].endMs);
      for (const at of [c.startMs, c.endMs]) if (at > 0 && at < info.durationMs) expect(peakNear(wav, at), `${id} ${k} at ${at} ms`).toBeLessThan(quiet);
      // as long as its words: about 2-4 spoken words a second, the margins included
      const rate = spokenWords(c.text) / ((c.endMs - c.startMs) / 1000);
      expect(rate, `${id} ${k}: ${rate.toFixed(2)} words a second`).toBeGreaterThan(2);
      expect(rate, `${id} ${k}: ${rate.toFixed(2)} words a second`).toBeLessThan(4);
    }
    // nothing of the line is left out: the speech before the first cut and after the last is silence
    expect(peakNear(wav, cuts[0].startMs / 2, cuts[0].startMs / 2 + 1)).toBeLessThan(quiet);
    const tail = (info.durationMs + cuts[cuts.length - 1].endMs) / 2;
    expect(peakNear(wav, tail, (info.durationMs - cuts[cuts.length - 1].endMs) / 2)).toBeLessThan(quiet);
  });

  it("R4's sentence about the dose is the first 2.4 s of v2-u08 (the whole line is 8.3 s)", () => {
    expect(clipSentences("v2-u08")).toEqual([
      { text: R4_DOSE, startMs: 0, endMs: 2448 },
      { text: R4_READINGS, startMs: 3151, endMs: 7565 },
    ]);
    expect(parseWav(wavOf("v2-u08"))!.durationMs).toBe(8275);
  });
});

// ---------------------------------------------------------------- the route

const demoClip = (url: string, headers: Record<string, string> = {}) =>
  clipGet(new NextRequest(`http://localhost${url}`, { headers }), { params: Promise.resolve({ id: url.split("/")[3] }) });

describe("GET /api/visits/[id]/clip?s=: one sentence of a stand-in clip", () => {
  it("s=0 is that sentence as a WAV file of its own: a valid header, the clip's own samples, shorter than the whole", async () => {
    const s = await newSession({ story_day: 29 });
    const whole = await demoClip(`/api/visits/v2/clip?u=v2-u08&session=${s.id}`);
    expect(whole.status).toBe(200);
    const wholeBytes = new Uint8Array(await whole.arrayBuffer());
    expect(Buffer.from(wholeBytes).equals(Buffer.from(wavOf("v2-u08")))).toBe(true); // without s: as before

    for (const [k, cut] of clipSentences("v2-u08")!.entries()) {
      const res = await demoClip(`/api/visits/v2/clip?u=v2-u08&session=${s.id}&s=${k}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("audio/wav");
      expect(res.headers.get("x-ripple-stand-in")).toBe("1");
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(res.headers.get("content-length")).toBe(String(bytes.length));
      expect(Buffer.from(bytes.subarray(0, 4)).toString("ascii")).toBe("RIFF");
      const info = parseWav(bytes)!;
      expect(info).toMatchObject({ sampleRate: 16_000, channels: 1, bitsPerSample: 16, dataOffset: 44, dataLength: (cut.endMs - cut.startMs) * 32, durationMs: cut.endMs - cut.startMs });
      expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true)).toBe(bytes.length - 8); // the RIFF size
      expect(bytes.length).toBeLessThan(wholeBytes.length);
      // exactly those samples of the clip
      expect(dataOf(bytes).equals(dataOf(wholeBytes).subarray(cut.startMs * 32, cut.endMs * 32))).toBe(true);
    }
  });

  it("s=k-m is consecutive sentences as one stretch; Range still works on a sentence", async () => {
    const s = await newSession({ story_day: 29 });
    const run = await demoClip(`/api/visits/v2/clip?u=v2-u06&session=${s.id}&s=1-2`);
    expect(run.status).toBe(200);
    const [, second, third] = clipSentences("v2-u06")!;
    const bytes = new Uint8Array(await run.arrayBuffer());
    expect(parseWav(bytes)!.durationMs).toBe(third.endMs - second.startMs);
    expect(dataOf(bytes).equals(dataOf(wavOf("v2-u06")).subarray(second.startMs * 32, third.endMs * 32))).toBe(true);
    expect(sentenceCut("v2-u06", "1-2")).toEqual({ startMs: second.startMs, endMs: third.endMs });

    const one = new Uint8Array(await (await demoClip(`/api/visits/v2/clip?u=v2-u08&session=${s.id}&s=0`)).arrayBuffer());
    const part = await demoClip(`/api/visits/v2/clip?u=v2-u08&session=${s.id}&s=0`, { range: "bytes=0-99" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 0-99/${one.length}`);
    expect(Buffer.from(await part.arrayBuffer()).equals(Buffer.from(one.subarray(0, 100)))).toBe(true);
  });

  it("any other s is 404, and so is any s on a stand-in clip with no sentence index (whose whole clip still plays)", async () => {
    const s = await newSession({ story_day: 29 });
    for (const bad of ["2", "0-2", "1-0", "-1", "01", "a", "0,1", ""]) {
      const res = await demoClip(`/api/visits/v2/clip?u=v2-u08&session=${s.id}&s=${encodeURIComponent(bad)}`);
      expect([bad, res.status, await res.json()]).toEqual([bad, 404, { error: "no_sentence" }]);
    }
    // v1-u08 is one sentence (R1): no index entry
    expect((await demoClip(`/api/visits/v1/clip?u=v1-u08&session=${s.id}`)).status).toBe(200);
    const one = await demoClip(`/api/visits/v1/clip?u=v1-u08&session=${s.id}&s=0`);
    expect([one.status, await one.json()]).toEqual([404, { error: "no_sentence" }]);
  });

  it("a real recording cut from his visit plays whole, and any s on it is 404 (no sentence index for those, for now)", async () => {
    const s = await newSession({ story_day: 0 });
    const store = getMemoryStore();
    await startVisit(store, s, { mode: "record", consent: { given: true } });
    const audioPath = `${s.id}/visits/v1/recording-test.wav`;
    const pcm = new Int16Array(8 * 16_000).map((_, i) => (Math.floor(i / 16_000) + 1) * 1000);
    await getBlobStore().putObject("audio", audioPath, encodeWav(pcm, 16_000), "audio/wav");
    await store.updateVisit(s.id, "v1", { audio_path: audioPath, status: "transcribing" });
    const transcript: NonNullable<FileJobResult["utterances"]> = [{ tStartMs: 1000, tEndMs: 5000, speaker: 0, text: "Please don't change the dose yourself. If your readings are high, write them down." }];
    await finalizeVisit(store, s, "v1", { status: "done", source: "audio", utterances: transcript });
    const [row] = await store.listUtterances(s.id, "v1");
    expect(row.clip_path).toBe(`${s.id}/visits/v1/segments/${row.id}.wav`);
    const whole = await demoClip(`/api/visits/v1/clip?u=${row.id}&session=${s.id}`);
    expect([whole.status, whole.headers.get("x-ripple-stand-in")]).toEqual([200, "0"]);
    for (const k of ["0", "1", "0-1"]) {
      const res = await demoClip(`/api/visits/v1/clip?u=${row.id}&session=${s.id}&s=${k}`);
      expect([k, res.status, await res.json()]).toEqual([k, 404, { error: "no_sentence" }]);
    }
  });
});

// ---------------------------------------------------------------- the answer

function accountReq(p: string, token: string, body?: unknown): NextRequest {
  const headers: Record<string, string> = { cookie: `rp_at=${token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

describe("the answer on the example account (POST /api/ask, the stub model)", () => {
  let him: TestAccount;
  beforeAll(async () => {
    setTestClock({ at: "2026-11-18T20:15:00+08:00", frozen: true });
    him = await createAccountWithSpace(getMemoryStore(), getAuthProvider(), { login: `cs${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  });

  const askHim = async (text: string, locale: "zh-Hans" | "en" = "zh-Hans"): Promise<AskResult> => {
    const res = await askPost(accountReq("/api/ask", him.tokens.access_token, { text, locale }));
    const body = await res.text();
    expect(res.status, body).toBe(200);
    return JSON.parse(body) as AskResult;
  };
  const r4Of = (a: AskResult) => a.sentences.find((s) => s.sourceId === "visit:v2:R4");

  it.each([
    ["我能不能多吃", "rule:dose_change"],
    ["我多吃了一粒怎么办", "rule:extra_dose_taken"],
  ])("%s: the doctor's sentence about the dose, its translation, and only that stretch of his recording", async (text, reason) => {
    const answer = await askHim(text);
    expect(answer.route).toBe("refuse_route");
    expect(answer.routeReason).toBe(reason);
    expect(answer.blocked).toEqual([]); // the three checks passed it as it is shown
    const doctor = r4Of(answer)!;
    expect(doctor).toMatchObject({ en: R4_DOSE, span: R4_DOSE, attribution: "doctor", origin: "span" });
    expect(R4.startsWith(doctor.en)).toBe(true); // the line's own words, never reworded
    // the line's source and citation, and the clip URL of its first sentence
    expect(doctor.cite).toMatchObject({ visitId: "v2", requiredLine: "R4", utteranceId: "v2-u08", clipPath: "visits/clips/v2-u08.wav", standInVoice: true, roleState: "confirmed" });
    expect(doctor.cite!.clipUrl).toBe("/api/visits/v2/clip?u=v2-u08&s=0");
    expect(doctor.cite!.clipUrl!.endsWith("&s=0")).toBe(true);
    expect(doctor.translation).toEqual({ lang: "zh-Hans", text: R4_DOSE_ZH });
    // the safety record has the words shown
    expect((answer.events[0].output as { sentences: { sourceId: string; en: string }[] }).sentences.find((s) => s.sourceId === "visit:v2:R4")?.en).toBe(R4_DOSE);
    // and the URL plays that sentence only, 2.4 of the line's 8.3 seconds
    const clip = await clipGet(accountReq(doctor.cite!.clipUrl!, him.tokens.access_token), { params: Promise.resolve({ id: "v2" }) });
    expect(clip.status).toBe(200);
    const bytes = new Uint8Array(await clip.arrayBuffer());
    expect(parseWav(bytes)!.durationMs).toBe(2448);
    expect(dataOf(bytes).equals(dataOf(wavOf("v2-u08")).subarray(0, 2448 * 32))).toBe(true);
  });

  it("the citation is the line's own: the same as when the whole line is quoted, but for &s=0", async () => {
    const whole = r4Of(await askHim("读数高的时候可以多吃一粒吗"))!;
    const part = r4Of(await askHim("我能不能多吃"))!;
    expect({ ...part.cite, clipUrl: whole.cite!.clipUrl }).toEqual(whole.cite);
    expect(part.cite!.clipUrl).toBe(`${whole.cite!.clipUrl}&s=0`);
  });

  it("a question about high readings: both sentences bear on it, so the whole line, the whole clip and its whole translation", async () => {
    for (const text of ["读数高的时候可以多吃一粒吗", "今天 150/95，我能不能多吃一粒？"]) {
      const doctor = r4Of(await askHim(text))!;
      expect(doctor, text).toMatchObject({ en: R4, span: R4 });
      expect(doctor.cite!.clipUrl, text).toBe("/api/visits/v2/clip?u=v2-u08");
      expect(doctor.translation, text).toEqual({ lang: "zh-Hans", text: R4_ZH });
    }
  });

  it("a question about something else: the quote is unchanged", async () => {
    // stopping is not a dose question: R4 whole
    const stop = await askHim("今晚不吃可以吗");
    expect(stop.routeReason).toBe("rule:stopping");
    expect(r4Of(stop)).toMatchObject({ en: R4, cite: { clipUrl: "/api/visits/v2/clip?u=v2-u08" } });
    // R3 (v2-u06) has a sentence index too, yet a question about why he takes it quotes it whole, with the whole clip
    const why = await askHim("为什么没感觉也要吃药？");
    expect(why.sentences.find((s) => s.sourceId === "visit:v2:R3")).toMatchObject({ en: lineOf("v2-u06"), cite: { clipUrl: "/api/visits/v2/clip?u=v2-u06" } });
    // and no answer but a dose question's carries &s=
    for (const text of ["这个药是做什么的？", "为什么没感觉也要吃药？", "这两种药可以一起吃吗"]) {
      const a = await askHim(text);
      for (const s of a.sentences) expect(s.cite?.clipUrl ?? "", `${text}: ${s.sourceId}`).not.toMatch(/[?&]s=/);
    }
  });

  it("in English the same, with no translation", async () => {
    const doctor = r4Of(await askHim("Can I take one more tablet?", "en"))!;
    expect(doctor).toMatchObject({ en: R4_DOSE, cite: { clipUrl: "/api/visits/v2/clip?u=v2-u08&s=0" } });
    expect(doctor.translation).toBeUndefined();
  });
});

describe("the same on the demo (the stand-in clips are the demo's too)", () => {
  it("我多吃了一粒怎么办: R4's sentence about the dose, &s=0 after the session, and the clip route plays it", async () => {
    const s = await newSession({ story_day: 29 });
    const answer = await ask({ sessionId: s.id, text: "我多吃了一粒怎么办", locale: "zh-Hans" }, { store: getMemoryStore(), llm: createMockLlm(), checker: null, checkerReason: "test", costGuard: null, publish: () => undefined });
    const doctor = answer.sentences.find((x) => x.sourceId === "visit:v2:R4")!;
    expect(doctor.en).toBe(R4_DOSE);
    expect(doctor.cite!.clipUrl).toBe(`/api/visits/v2/clip?u=v2-u08&session=${encodeURIComponent(s.id)}&s=0`);
    const clip = await demoClip(doctor.cite!.clipUrl!);
    expect(clip.status).toBe(200);
    expect(parseWav(new Uint8Array(await clip.arrayBuffer()))!.durationMs).toBe(2448);
  });
});

// ---------------------------------------------------------------- the helpers

const R4_CANDIDATE: Candidate = {
  sourceId: "visit:v2:R4",
  kind: "visit",
  span: R4,
  attribution: "doctor",
  drugs: [],
  about: ["amlodipine"],
  topics: ["dose_change"],
  instruction: true,
  cite: {
    visitId: "v2",
    day: 8,
    date: "2026-09-01",
    requiredLine: "R4",
    utteranceId: "v2-u08",
    tStartMs: 43320,
    tEndMs: 51396,
    clipPath: "visits/clips/v2-u08.wav",
    standInVoice: true,
    clipUrl: "/api/visits/v2/clip?u=v2-u08",
    role: "doctor",
    roleState: "confirmed",
  },
};

describe("the helpers", () => {
  it("sentenceOf / sentenceRange: which sentence(s) of a clip a span is, by their words", () => {
    expect(sentenceOf("v2-u08", R4_DOSE)).toBe(0);
    expect(sentenceOf("v2-u08", R4_READINGS)).toBe(1);
    expect(sentenceOf("v2-u08", "please don’t change the dose yourself")).toBe(0); // case, apostrophe, the final mark
    expect(sentenceOf("v2-u08", R4)).toBeNull(); // the whole utterance
    expect(sentenceOf("v2-u08", "your readings are high")).toBeNull(); // not a sentence of it
    expect(sentenceOf("v2-u08", "Please don't. Change the dose yourself.")).toBeNull(); // a moved boundary is other words
    expect(sentenceOf("v1-u08", "At home, we want it below 135 over 85.")).toBeNull(); // no index: one sentence
    expect(sentenceOf("v9-u01", R4_DOSE)).toBeNull();
    expect(sentenceOf("constructor", R4_DOSE)).toBeNull();
    const [, second, third] = clipSentences("v2-u06")!;
    expect(sentenceRange("v2-u06", `${second.text} ${third.text}`)).toEqual({ from: 1, to: 2 });
    expect(sentenceOf("v2-u06", `${second.text} ${third.text}`)).toBeNull(); // not one sentence
  });

  it("sentenceClipUrl: &s=k or &s=k-m at the end, replacing one already there", () => {
    expect(sentenceClipUrl("/api/visits/v2/clip?u=v2-u08", 0)).toBe("/api/visits/v2/clip?u=v2-u08&s=0");
    expect(sentenceClipUrl("/api/visits/v2/clip?u=v2-u08&session=abc", { from: 1, to: 2 })).toBe("/api/visits/v2/clip?u=v2-u08&session=abc&s=1-2");
    expect(sentenceClipUrl("/api/visits/v2/clip?u=v2-u08&s=1&session=abc", { from: 0, to: 0 })).toBe("/api/visits/v2/clip?u=v2-u08&s=0&session=abc");
  });

  it("the &s= values: k or k-m, in the line, nothing else", () => {
    expect(parseSentenceParam("0", 2)).toEqual({ from: 0, to: 0 });
    expect(parseSentenceParam("1", 2)).toEqual({ from: 1, to: 1 });
    expect(parseSentenceParam("0-1", 2)).toEqual({ from: 0, to: 1 });
    for (const bad of ["2", "0-2", "1-0", "-1", "01", "1-", "a", " 1", "1.0", ""]) expect(parseSentenceParam(bad, 2), bad).toBeNull();
    expect(sentenceCut("v2-u08", "1")).toEqual({ startMs: 3151, endMs: 7565 });
    expect(sentenceCut("v1-u08", "0")).toBeNull();
  });

  it("doseQuoteTopic: a dose question, about high readings or not; anything else has none", () => {
    for (const q of ["我能不能多吃", "我多吃了一粒怎么办", "要是多吃了一粒会怎么样", "I took two by mistake", "How much amlodipine is too much?", "我有高血压，能不能多吃一粒"]) expect(doseQuoteTopic(["dose_change"], q), q).toBe("dose");
    for (const q of ["读数高的时候可以多吃一粒吗", "今天 150/95，我能不能多吃一粒？", "血压有点高能多吃吗", "Today 150/95, can I take one more tablet?", "Can I take an extra one when it's high?", "My BP went up, can I take more?"]) {
      expect(doseQuoteTopic(["dose_change"], q), q).toBe("dose_high_readings");
    }
    expect(doseQuoteTopic(["stopping"], "今晚不吃可以吗")).toBeNull();
    expect(doseQuoteTopic([], "我能不能多吃")).toBeNull();
  });

  it("narrowQuote: only the sentences that bear on the question, the line's words as written; the rest of the quote as it was", () => {
    const n = narrowQuote(R4_CANDIDATE, "dose");
    expect(n).toEqual({ ...R4_CANDIDATE, span: R4_DOSE, cite: { ...R4_CANDIDATE.cite, clipUrl: "/api/visits/v2/clip?u=v2-u08&s=0" } });
    expect(R4_CANDIDATE.span).toBe(R4); // the candidate itself is not changed
    // a sentence made from it: en and its translation follow
    const said: Sentence = { speechAct: "restate", sourceId: "visit:v2:R4", span: R4, en: R4, slots: {}, attribution: "doctor", cite: R4_CANDIDATE.cite, translation: { lang: "zh-Hans", text: R4_ZH } };
    expect(narrowQuote(said, "dose")).toMatchObject({ span: R4_DOSE, en: R4_DOSE, translation: { lang: "zh-Hans", text: R4_DOSE_ZH }, cite: { clipUrl: "/api/visits/v2/clip?u=v2-u08&s=0" } });
    // Dr Lim's D42 answer: its first sentence refuses the extra tablet
    const v3u19 = lineOf("v3-u19");
    const d42 = { span: v3u19, cite: { visitId: "v3", utteranceId: "v3-u19", clipPath: "visits/clips/v3-u19.wav", clipUrl: "/api/visits/v3/clip?u=v3-u19" } };
    expect(narrowQuote(d42, "dose")).toMatchObject({ span: "No, please don't take an extra tablet on your own.", cite: { clipUrl: "/api/visits/v3/clip?u=v3-u19&s=0" } });
    expect(narrowQuote(d42, "dose_high_readings")).toBe(d42);
  });

  it("narrowQuote leaves the quote as it was when it may not cut it", () => {
    // not a dose question; a question about high readings (both sentences: the whole line)
    expect(narrowQuote(R4_CANDIDATE, null)).toBe(R4_CANDIDATE);
    expect(narrowQuote(R4_CANDIDATE, "dose_high_readings")).toBe(R4_CANDIDATE);
    // a real recording (no sentence index), no clip at all, a clip with no index entry
    const real = { ...R4_CANDIDATE, cite: { ...R4_CANDIDATE.cite, clipPath: "s1/visits/v2/segments/u8.wav", standInVoice: false } };
    expect(narrowQuote(real, "dose")).toBe(real);
    const none = { ...R4_CANDIDATE, cite: { visitId: "v2", requiredLine: "R4" } };
    expect(narrowQuote(none, "dose")).toBe(none);
    const r1 = { ...R4_CANDIDATE, cite: { ...R4_CANDIDATE.cite, clipPath: "visits/clips/v1-u08.wav" } };
    expect(narrowQuote(r1, "dose")).toBe(r1);
    // words that are not the clip's, sentence for sentence (a boundary moved: "Please don't. Change the dose yourself.")
    const moved = { ...R4_CANDIDATE, span: MOVED_R4 };
    expect(narrowQuote(moved, "dose")).toBe(moved);
    // a line where no sentence says not to change the dose (R3, v2-u06): nothing to cut to
    const r3 = { span: lineOf("v2-u06"), cite: { clipPath: "visits/clips/v2-u06.wav", clipUrl: "/api/visits/v2/clip?u=v2-u06" } };
    expect(narrowQuote(r3, "dose")).toBe(r3);
    // a sentence whose en is not the line it claims (never cut words that are not the span)
    const other: Sentence = { speechAct: "restate", sourceId: "visit:v2:R4", span: R4, en: "Something else.", slots: {}, cite: R4_CANDIDATE.cite };
    expect(narrowQuote(other, "dose")).toBe(other);
  });

  it("cutTranslation: the same sentences of a translation that splits like the line; else the whole line's", () => {
    expect(cutTranslation(R4, R4_DOSE, R4_ZH)).toBe(R4_DOSE_ZH);
    expect(cutTranslation(R4, R4_READINGS, R4_ZH)).toBe("如果读数高，把它们写下来，下次看诊时告诉我。");
    expect(cutTranslation(R4, R4, R4_ZH)).toBe(R4_ZH); // the whole line
    expect(cutTranslation(R4, R4_DOSE, null)).toBeNull();
    // one Chinese sentence for two English ones: the whole translation
    expect(cutTranslation(R4, R4_DOSE, "请不要自己改药量，如果读数高，把它们写下来，下次看诊时告诉我。")).toBe("请不要自己改药量，如果读数高，把它们写下来，下次看诊时告诉我。");
    // split the same way but in another order: the cut fails the facts check (the negation is gone), so the whole one
    const swapped = "如果读数高，把它们写下来，下次看诊时告诉我。请不要自己改药量。";
    expect(cutTranslation(R4, R4_DOSE, swapped)).toBe(swapped);
  });
});
