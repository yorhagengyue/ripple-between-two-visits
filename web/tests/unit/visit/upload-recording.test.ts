/**
 * Sending a visit's recording from the phone, one file or in parts (C2 track R; components/visit/elder/upload-recording.ts,
 * recording-store.ts keptSource and chunkKeeper, lib/visit/parts.ts), on the phone store's memory twin and a small
 * stand-in for the server that keeps the rules of app/api/visits/[id]/parts (it measures every file itself, takes parts
 * in order, never replaces one). The part length here is two seconds, so nothing needs large audio.
 *
 *   - a recording that fits in one part goes exactly as before: one link, one PUT, no question to the parts route
 *   - a longer one goes in parts, in order, each confirmed by the server before the next is read; the audio the server
 *     ends up with is the recording, sample for sample
 *   - a failure (the storage refuses a file, the server does not confirm, the answer is lost) stops there; trying again
 *     asks the server what it has and goes on from the first part it lacks, never from the start
 *   - the phone's copy of a part is dropped only after the server confirmed that part, with the server's path for it
 *   - what the phone did not take (it is full, it has no store) is still sent while the page lives
 *   - a copy kept before this (floats at the microphone's rate) uploads the same way
 */
import { describe, expect, it } from "vitest";
import { chunkKeeper, chunkSamples, keptSource, memoryKeptDb, pendingRecordings, type KeptDb, type KeptWriter } from "@/components/visit/elder/recording-store";
import { uploadRecording, type ServerPart, type UploadApi, type UploadProgress } from "@/components/visit/elder/upload-recording";
import { measurePart } from "@/lib/visit/recording-audio";
import { parseWav } from "@/lib/visit/wav";

const RATE = 16_000;
const PART_MS = 2000;
const OWNER = "a-his";
const VISIT = "visit-1";

/** sample i of the test recording, as the microphone gives it: a ramp that never repeats within a recording of minutes */
const value = (i: number) => ((i % 30_000) - 15_000) / 16_384;
/** ... and as the WAV holds it */
const held = (i: number) => {
  const s = value(i);
  return Math.trunc(s < 0 ? s * 0x8000 : s * 0x7fff);
};

/** `ms` of microphone audio from sample `from`, in the worklet's 128-sample blocks */
function blocks(ms: number, from = 0): Float32Array[] {
  const out: Float32Array[] = [];
  const total = (ms * RATE) / 1000;
  for (let i = 0; i < total; i += 128) {
    const b = new Float32Array(Math.min(128, total - i));
    for (let j = 0; j < b.length; j++) b[j] = value(from + i + j);
    out.push(b);
  }
  return out;
}

/** Record `ms` into `db` as the page does: a chunk every 700 ms of the test clock, the rest at the flush. */
async function record(db: KeptDb, ms: number, opts: { visitId?: string; from?: number } = {}) {
  let t = 0;
  const keeper = chunkKeeper(OWNER, opts.visitId ?? VISIT, { db, now: () => t, everyMs: 700 });
  await new Promise((r) => setTimeout(r, 0));
  for (const b of blocks(ms, opts.from ?? 0)) {
    keeper.listener(b, RATE);
    t += 8;
  }
  await keeper.flush();
  return keeper;
}

/** The server as the upload sees it. */
function server(visitId = VISIT) {
  const stored = new Map<string, Uint8Array>();
  let parts: ServerPart[] = [];
  let n = 0;
  const state = {
    calls: [] as string[],
    /** the whole recording is on the visit (POST /api/asr/jobs closed the list) */
    complete: false,
    path: null as string | null,
    /** fail the nth PUT (1 for the first), once each */
    failPut: new Set<number>(),
    /** take the registration and lose the answer, for the nth register call */
    loseAnswer: new Set<number>(),
    /** refuse the nth register call (the server is down) */
    failRegister: new Set<number>(),
    failParts: false,
    puts: 0,
    registers: 0,
    get parts() {
      return parts;
    },
    stored,
    /** every part's samples, joined: what the server would transcribe */
    audio(): number[] {
      return parts.flatMap((p) => samplesOf(stored.get(p.path)!));
    },
    api: null as unknown as UploadApi,
  };
  state.api = {
    async link(id) {
      state.calls.push("link");
      expect(id).toBe(visitId);
      return { url: `https://storage.test/${++n}`, method: "PUT", headers: { "content-type": "audio/wav" }, path: `prefix/visits/${id}/recording-${n}.wav` };
    },
    async put(link, file) {
      state.puts += 1;
      state.calls.push(`put:${file.size}`);
      if (state.failPut.delete(state.puts)) return false;
      expect(file.type).toBe("audio/wav");
      stored.set(`prefix/visits/${visitId}/recording-${link.url.split("/").pop()}.wav`, new Uint8Array(await file.arrayBuffer()));
      return true;
    },
    async parts() {
      state.calls.push("parts");
      if (state.failParts) throw new Error("offline");
      return { parts: parts.map((p) => ({ ...p })), complete: state.complete, path: state.path };
    },
    async register(_id, seq, path) {
      state.registers += 1;
      state.calls.push(`register:${seq}`);
      if (state.failRegister.delete(state.registers)) throw new Error("503");
      // the rules of the route: in order, never replaced, measured by the server
      if (seq < parts.length && parts[seq].path === path) return { parts: parts.map((p) => ({ ...p })) };
      if (seq !== parts.length) throw new Error(seq < parts.length ? "part_exists" : "out_of_order");
      const bytes = stored.get(path);
      if (!bytes) throw new Error("audio_not_found");
      const measured = measurePart(bytes);
      if (!measured.ok) throw new Error(measured.why);
      parts = [...parts, { seq, path, ms: measured.ms }];
      if (state.loseAnswer.delete(state.registers)) throw new Error("the answer never arrived");
      return { parts: parts.map((p) => ({ ...p })) };
    },
  };
  return state;
}

function samplesOf(wav: Uint8Array): number[] {
  const info = parseWav(wav)!;
  expect([info.sampleRate, info.channels, info.bitsPerSample]).toEqual([16_000, 1, 16]);
  return Array.from(new Int16Array(wav.slice(info.dataOffset, info.dataOffset + info.dataLength).buffer));
}

async function keptSamples(db: KeptDb, visitId = VISIT): Promise<number> {
  return (await db.read(OWNER, visitId)).reduce((n, c) => n + chunkSamples(c).length, 0);
}

/** How many samples the whole chunks of a copy hold that end at or before `sample` (a chunk across it is not counted). */
async function wholeChunksBefore(db: KeptDb, sample: number): Promise<number> {
  let at = 0;
  for (const c of await db.read(OWNER, VISIT)) {
    if (at + c.pcm.length > sample) break;
    at += c.pcm.length;
  }
  return at;
}

async function send(db: KeptDb, srv: ReturnType<typeof server>, opts: { unsaved?: ReturnType<ReturnType<typeof chunkKeeper>["unsaved"]>; partMs?: number; progress?: UploadProgress[] } = {}) {
  const source = await keptSource(OWNER, VISIT, { db, unsaved: opts.unsaved });
  expect(source).not.toBeNull();
  return uploadRecording({ visitId: VISIT, source: source!, partMs: opts.partMs ?? PART_MS, api: srv.api, onProgress: (p) => opts.progress?.push({ ...p }) });
}

const expectWhole = (audio: number[], ms: number) => {
  expect(audio.length).toBe((ms * RATE) / 1000);
  for (const i of [0, 1, 127, 128, 11_199, 11_200, 31_999, 32_000, 32_001, 63_999, 64_000, audio.length - 1].filter((x) => x < audio.length)) expect(audio[i], `sample ${i}`).toBe(held(i));
  // and all of them, cheaply: no sample lost, none twice, none out of place
  expect(audio.every((s, i) => s === held(i))).toBe(true);
};

describe("a recording that fits in one part", () => {
  it("goes as one file, exactly as before: one link, one PUT, nothing asked of the parts route, nothing dropped by the upload", async () => {
    const db = memoryKeptDb();
    await record(db, 1500);
    const srv = server();
    const up = await send(db, srv);
    expect(up).toEqual({ ok: true, path: `prefix/visits/${VISIT}/recording-1.wav`, parts: null });
    expect(srv.calls).toEqual(["link", `put:${44 + 1500 * 32}`]);
    expectWhole(samplesOf(srv.stored.get(up.ok ? up.path : "")!), 1500);
    // the phone's copy stays until the page hears from the visit itself that the recording is there (dropConfirmed)
    expect(await keptSamples(db)).toBe(1500 * 16);
  });

  it("exactly one part, and one part with less than the tail on top, are still one file", async () => {
    for (const ms of [2000, 2400, 2500]) {
      const db = memoryKeptDb();
      await record(db, ms);
      const srv = server();
      expect(await send(db, srv), String(ms)).toMatchObject({ ok: true, parts: null });
      expect(srv.calls).toEqual(["link", `put:${44 + ms * 32}`]);
    }
  });

  it("the storage refuses it: said so, the copy untouched; the next try sends the same file", async () => {
    const db = memoryKeptDb();
    await record(db, 1500);
    const srv = server();
    srv.failPut.add(1);
    expect(await send(db, srv)).toEqual({ ok: false, why: "upload" });
    expect(await keptSamples(db)).toBe(1500 * 16);
    expect(await send(db, srv)).toMatchObject({ ok: true, parts: null });
    expect(srv.puts).toBe(2);
  });

  it("nothing recorded: nothing is sent, and the page is told there is no audio", async () => {
    const srv = server();
    const empty = await keptSource(OWNER, VISIT, { db: memoryKeptDb(), unsaved: [{ pcm: new Int16Array(0), rate: RATE, seq: 0 }] });
    expect(empty).toBeNull();
    const db = memoryKeptDb();
    // a row with no samples in it
    await (await db.writer(OWNER, VISIT))!.append(new Int16Array(0), RATE);
    expect(await send(db, srv)).toEqual({ ok: false, why: "empty" });
    expect(srv.calls).toEqual([]);
  });
});

describe("a recording longer than one part", () => {
  it("goes in parts, in order, each registered before the next is sent; the server's audio is the recording, sample for sample", async () => {
    const db = memoryKeptDb();
    await record(db, 7300);
    const srv = server();
    const progress: UploadProgress[] = [];
    const up = await send(db, srv, { progress });
    expect(up).toEqual({ ok: true, path: `prefix/visits/${VISIT}/recording-1.wav`, parts: 4 });
    // the server is asked first what it has; then link, PUT, register for each part, nothing interleaved
    expect(srv.calls).toEqual([
      "parts",
      "link",
      `put:${44 + 2000 * 32}`,
      "register:0",
      "link",
      `put:${44 + 2000 * 32}`,
      "register:1",
      "link",
      `put:${44 + 2000 * 32}`,
      "register:2",
      "link",
      `put:${44 + 1300 * 32}`,
      "register:3",
    ]);
    expect(srv.parts.map((p) => p.ms)).toEqual([2000, 2000, 2000, 1300]);
    expectWhole(srv.audio(), 7300);
    // the screen is told how far it is, in the visit's own time
    expect(progress.map((p) => p.sentMs)).toEqual([0, 2000, 4000, 6000, 7300]);
    expect(new Set(progress.map((p) => p.totalMs))).toEqual(new Set([7300]));
  });

  it("the last part takes a remainder shorter than the tail; no file of a fraction of a second", async () => {
    const db = memoryKeptDb();
    await record(db, 4400);
    const srv = server();
    expect(await send(db, srv)).toMatchObject({ ok: true, parts: 2 });
    expect(srv.parts.map((p) => p.ms)).toEqual([2000, 2400]);
    expectWhole(srv.audio(), 4400);
  });

  it("each part's chunks leave the phone only after the server confirmed that part, and only with its path", async () => {
    const db = memoryKeptDb();
    await record(db, 7300);
    const srv = server();
    const inner = srv.api.register;
    const keptAt: number[] = [];
    // what is on the phone at the moment the server is asked to take a part: everything it has not confirmed yet
    srv.api.register = async (id, seq, path) => {
      keptAt.push(await keptSamples(db));
      return inner(id, seq, path);
    };
    await send(db, srv);
    // 700 ms chunks: a chunk across a cut stays until the part after it is confirmed, so never less than what is unconfirmed
    expect(keptAt[0]).toBe(7300 * 16);
    for (const [i, kept] of keptAt.entries()) expect(kept, `before part ${i}`).toBeGreaterThanOrEqual((7300 - i * 2000) * 16);
    expect(keptAt[3]).toBeLessThan(7300 * 16 - 2 * 2000 * 16);
    // after the last confirmation nothing unconfirmed is left, and the count of what was recorded is unchanged
    expect(await keptSamples(db)).toBe(0);
    expect(await pendingRecordings(OWNER, db)).toMatchObject([{ visitId: VISIT, durationMs: 7300 }]);
    // without the server's path nothing is dropped
    const db2 = memoryKeptDb();
    await record(db2, 7300);
    const whole = await wholeChunksBefore(db2, 2000 * 16);
    // the chunks here are about 0.7 s: the third one lies across the two-second cut
    expect(whole).toBeGreaterThan(1300 * 16);
    expect(whole).toBeLessThan(2000 * 16);
    const source = (await keptSource(OWNER, VISIT, { db: db2 }))!;
    await source.read(0, 2000 * 16);
    for (const serverPartPath of [null, undefined, "", "  "]) expect(await source.dropBefore(2000 * 16, { serverPartPath })).toBe(false);
    expect(await source.dropBefore(2000 * 16, {} as { serverPartPath: string })).toBe(false);
    expect(await keptSamples(db2)).toBe(7300 * 16);
    expect(await source.dropBefore(2000 * 16, { serverPartPath: "prefix/visits/visit-1/recording-1.wav" })).toBe(true);
    // whole chunks only: the one across the cut stays
    expect(source.startSample).toBe(whole);
    expect(await keptSamples(db2)).toBe(7300 * 16 - whole);
  });

  it("one PUT fails: the upload stops there; the next try asks the server and goes on from that part, never from the start", async () => {
    const db = memoryKeptDb();
    await record(db, 7300);
    const srv = server();
    srv.failPut.add(3); // the third file
    expect(await send(db, srv)).toEqual({ ok: false, why: "upload" });
    expect(srv.parts.map((p) => p.seq)).toEqual([0, 1]);
    // what the server lacks is still on the phone
    expect(await keptSamples(db)).toBeGreaterThanOrEqual((7300 - 4000) * 16);
    srv.calls.length = 0;
    const progress: UploadProgress[] = [];
    expect(await send(db, srv, { progress })).toMatchObject({ ok: true, parts: 4 });
    // parts 0 and 1 are not sent again
    expect(srv.calls).toEqual(["parts", "link", `put:${44 + 2000 * 32}`, "register:2", "link", `put:${44 + 1300 * 32}`, "register:3"]);
    expect(progress.map((p) => p.sentMs)).toEqual([4000, 6000, 7300]);
    expectWhole(srv.audio(), 7300);
    expect(srv.puts).toBe(5);
  });

  it("the server does not take a part it was sent (it is down): that part is sent again next time, the ones before it are not", async () => {
    const db = memoryKeptDb();
    await record(db, 7300);
    const srv = server();
    srv.failRegister.add(2);
    expect(await send(db, srv)).toEqual({ ok: false, why: "server" });
    expect(srv.parts).toHaveLength(1);
    expect(await send(db, srv)).toMatchObject({ ok: true, parts: 4 });
    expectWhole(srv.audio(), 7300);
    // five files reached the storage: the four parts and the one the server never listed (the orphan sweep's, later)
    expect(srv.stored.size).toBe(5);
  });

  it("the server took a part and its answer was lost: nothing is dropped on a guess; the next try finds the part there and goes on after it", async () => {
    const db = memoryKeptDb();
    await record(db, 7300);
    const srv = server();
    srv.loseAnswer.add(2);
    expect(await send(db, srv)).toEqual({ ok: false, why: "server" });
    expect(srv.parts).toHaveLength(2);
    // the phone has not heard that part 1 is there: its chunks are still on the phone
    expect(await keptSamples(db)).toBeGreaterThanOrEqual((7300 - 2000) * 16);
    srv.calls.length = 0;
    expect(await send(db, srv)).toMatchObject({ ok: true, parts: 4 });
    expect(srv.calls.filter((c) => c.startsWith("register"))).toEqual(["register:2", "register:3"]);
    expectWhole(srv.audio(), 7300);
    expect(await keptSamples(db)).toBe(0);
  });

  it("the server cannot be asked: nothing is sent at all", async () => {
    const db = memoryKeptDb();
    await record(db, 7300);
    const srv = server();
    srv.failParts = true;
    expect(await send(db, srv)).toEqual({ ok: false, why: "server" });
    expect(srv.calls).toEqual(["parts"]);
    expect(await keptSamples(db)).toBe(7300 * 16);
  });

  it("the page was closed mid-upload: a new page, with only the phone's copy and the server's list, finishes it", async () => {
    const db = memoryKeptDb();
    await record(db, 7300);
    const srv = server();
    const whole = await wholeChunksBefore(db, 2000 * 16);
    srv.failPut.add(2);
    await send(db, srv);
    // a new page: a new source, read from the phone as it is now (the whole chunks of its first part dropped)
    const again = (await keptSource(OWNER, VISIT, { db }))!;
    expect(again.startSample).toBe(whole);
    expect(again.totalMs).toBe(7300);
    expect(await uploadRecording({ visitId: VISIT, source: again, partMs: PART_MS, api: srv.api })).toMatchObject({ ok: true, parts: 4 });
    expectWhole(srv.audio(), 7300);
  });

  it("a later try with another part length goes on from the audio the server has, not from a part number", async () => {
    const db = memoryKeptDb();
    await record(db, 7300);
    const srv = server();
    srv.failPut.add(2);
    await send(db, srv, { partMs: 2000 });
    expect(srv.parts.map((p) => p.ms)).toEqual([2000]);
    expect(await send(db, srv, { partMs: 3000 })).toMatchObject({ ok: true, parts: 3 });
    expect(srv.parts.map((p) => p.ms)).toEqual([2000, 3000, 2300]);
    expectWhole(srv.audio(), 7300);
  });

  it("the server already holds the whole recording (an earlier try stopped after the upload): nothing is sent again", async () => {
    const db = memoryKeptDb();
    await record(db, 7300);
    const srv = server();
    expect(await send(db, srv)).toMatchObject({ ok: true, parts: 4 });
    // the phone still has a copy (say the page died before it heard): a longer one than a part, so the server is asked
    const db2 = memoryKeptDb();
    await record(db2, 7300);
    srv.complete = true;
    srv.path = srv.parts[0].path;
    srv.calls.length = 0;
    expect(await send(db2, srv)).toEqual({ ok: true, path: srv.parts[0].path, parts: 4 });
    expect(srv.calls).toEqual(["parts"]);
  });

  it("the server lacks audio this phone no longer has: it says so and sends nothing that would leave a hole", async () => {
    const db = memoryKeptDb();
    await record(db, 7300);
    const srv = server();
    srv.failPut.add(3);
    await send(db, srv);
    // the server's list was emptied under the phone (cannot happen through the routes: a confirmed part is never replaced)
    const lost = server();
    expect(await send(db, lost)).toEqual({ ok: false, why: "gone" });
    expect(lost.calls).toEqual(["parts"]);
  });
});

describe("what the phone did not take is still sent", () => {
  it("a browser that keeps nothing: the keeper holds the recording, and it is uploaded from there, in parts when it is long", async () => {
    const none: KeptDb = { writer: async () => null, list: async () => [], read: async () => [], remove: async () => undefined };
    const keeper = await record(none, 5000);
    expect(keeper.unsaved().reduce((n, c) => n + c.pcm.length, 0)).toBe(5000 * 16);
    expect(keeper.refused()).toBe(false);
    expect(keeper.recordedMs()).toBe(5000);
    const srv = server();
    const source = (await keptSource(OWNER, VISIT, { db: none, unsaved: keeper.unsaved() }))!;
    expect(source.totalMs).toBe(5000);
    expect(await uploadRecording({ visitId: VISIT, source, partMs: PART_MS, api: srv.api })).toMatchObject({ ok: true, parts: 3 });
    expect(srv.parts.map((p) => p.ms)).toEqual([2000, 2000, 1000]);
    expectWhole(srv.audio(), 5000);
  });

  it("the phone refuses some chunks: they stay with the keeper, in their place among the ones it took, and the upload reads both", async () => {
    const inner = memoryKeptDb();
    // the third and fourth chunk never reach the phone; the ones before and after do
    const flaky: KeptDb = {
      ...inner,
      async writer(owner, visitId) {
        const w = (await inner.writer(owner, visitId))!;
        const writer: KeptWriter = { base: w.base, append: (pcm, rate, at) => (at === 2 || at === 3 ? Promise.resolve(false) : w.append(pcm, rate, at)) };
        return writer;
      },
    };
    const keeper = await record(flaky, 5000);
    expect(keeper.refused()).toBe(true);
    const unsaved = keeper.unsaved();
    expect(unsaved.map((c) => c.seq)).toEqual([2, 3]);
    const missing = unsaved.reduce((n, c) => n + c.pcm.length, 0);
    expect(missing).toBeGreaterThan(1300 * 16);
    // the phone has the rest, with the two places free
    expect((await inner.read(OWNER, VISIT)).map((c) => c.seq)).toEqual([0, 1, 4, 5, 6, 7]);
    expect(await keptSamples(inner)).toBe(5000 * 16 - missing);

    const srv = server();
    const source = (await keptSource(OWNER, VISIT, { db: inner, unsaved }))!;
    expect(await uploadRecording({ visitId: VISIT, source, partMs: PART_MS, api: srv.api })).toMatchObject({ ok: true, parts: 3 });
    // every sample in its place: the chunks only the page has, between the ones the phone has
    expectWhole(srv.audio(), 5000);
    // a chunk that is not on the phone is not dropped from it, and nothing after it is
    expect((await inner.read(OWNER, VISIT)).map((c) => c.seq)).toEqual([4, 5, 6, 7]);
  });

  it("room is made: the refused chunks are written again at the next flush, each in its own place, and the copy is whole", async () => {
    const inner = memoryKeptDb();
    let full = true;
    const flaky: KeptDb = {
      ...inner,
      async writer(owner, visitId) {
        const w = (await inner.writer(owner, visitId))!;
        return { base: w.base, append: (pcm, rate, at) => (full ? Promise.resolve(false) : w.append(pcm, rate, at)) };
      },
    };
    let t = 0;
    const keeper = chunkKeeper(OWNER, VISIT, { db: flaky, now: () => t, everyMs: 700 });
    await new Promise((r) => setTimeout(r, 0));
    for (const b of blocks(3000)) {
      keeper.listener(b, RATE);
      t += 8;
    }
    await keeper.flush();
    expect(keeper.refused()).toBe(true);
    expect(await keptSamples(inner)).toBe(0);
    full = false;
    await keeper.flush();
    expect(keeper.unsaved()).toEqual([]);
    expect(keeper.refused()).toBe(false);
    const all = (await inner.read(OWNER, VISIT)).flatMap((c) => Array.from(chunkSamples(c)));
    expectWhole(all, 3000);
    expect(await pendingRecordings(OWNER, inner)).toEqual([{ visitId: VISIT, durationMs: 3000, chunks: 5 }]);
  });
});

describe("a copy kept before parts existed", () => {
  it("floats at the microphone's rate, of any length: read by sample, uploaded in parts, dropped part by part", async () => {
    const db = memoryKeptDb();
    const w = (await db.writer(OWNER, VISIT))!;
    // as the old keeper wrote them: ten-second-style chunks of floats (here 0.9 s each), one of them at 48 kHz
    const total = 6300 * 16;
    let at = 0;
    for (let c = 0; at < total; c++) {
      const n = Math.min(900 * 16, total - at);
      if (c === 2) {
        // the same audio as the microphone would give it at 48 kHz: every sample three times, read back as every third
        const fast = new Float32Array(n * 3);
        for (let j = 0; j < n; j++) fast[j * 3] = fast[j * 3 + 1] = fast[j * 3 + 2] = value(at + j);
        await w.append(fast, 48_000);
      } else {
        await w.append(Float32Array.from({ length: n }, (_, j) => value(at + j)), RATE);
      }
      at += n;
    }
    expect(await pendingRecordings(OWNER, db)).toMatchObject([{ durationMs: 6300, chunks: 7 }]);
    const srv = server();
    srv.failPut.add(2);
    expect(await send(db, srv)).toEqual({ ok: false, why: "upload" });
    expect(await send(db, srv)).toMatchObject({ ok: true, parts: 3 });
    expect(srv.parts.map((p) => p.ms)).toEqual([2000, 2000, 2300]);
    const audio = srv.audio();
    expect(audio.length).toBe(total);
    // the 16 kHz chunks are exact; the 48 kHz one is resampled by itself, as it always was (its neighbours unharmed)
    for (const i of [0, 900 * 16 - 1, 900 * 16, 1800 * 16 - 1, 2700 * 16, total - 1]) expect(audio[i], `sample ${i}`).toBe(held(i));
    for (const i of [1800 * 16, 2000 * 16, 2700 * 16 - 2]) expect(Math.abs(audio[i] - held(i)), `sample ${i}`).toBeLessThanOrEqual(2);
  });

  it("the ranged read never takes more of a long copy than it was asked for", async () => {
    const inner = memoryKeptDb();
    await record(inner, 7300);
    const asked: (number | undefined)[] = [];
    const counting: KeptDb = { ...inner, read: (o, v, upTo) => (asked.push(upTo), inner.read(o, v, upTo)) };
    const source = (await keptSource(OWNER, VISIT, { db: counting }))!;
    const got = await source.read(0, 2000 * 16);
    expect(got.length).toBe(2000 * 16);
    expect(asked).toEqual([2000 * 16]);
    // three 700 ms chunks cover two seconds: the fourth and later are not read
    expect((await inner.read(OWNER, VISIT, 2000 * 16)).length).toBe(3);
    // from the middle, and past the end
    expect(Array.from(await source.read(3000 * 16, 4))).toEqual([0, 1, 2, 3].map((j) => held(3000 * 16 + j)));
    expect((await source.read(7200 * 16, 99_999)).length).toBe(100 * 16);
    expect((await source.read(7300 * 16, 10)).length).toBe(0);
  });
});
