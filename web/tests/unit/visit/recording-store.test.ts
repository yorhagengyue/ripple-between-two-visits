/**
 * His recording kept on the phone (components/visit/elder/recording-store.ts, kept.ts; C2 track V; real-app 2.13, 2.14),
 * on the store's memory twin (the browser's IndexedDB half runs in e2e/v-visit.spec.ts):
 *   - the whole recording is kept, its last seconds and a recording shorter than 10 s too, once the page flushes;
 *   - a copy belongs to one owner: another account on the same phone lists nothing, reads nothing, deletes nothing;
 *   - a copy leaves the phone only with the server's path as proof, and no other export deletes;
 *   - what the page does with a kept copy follows from what the server says about its visit, never from a list's length.
 * C2 track R: a chunk is kept as the WAV's own samples (16-bit at 16 kHz), so the samples read back here are those;
 * the upload of a long recording from this copy is in tests/unit/visit/upload-recording.test.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyKept, uploadConfirmed, type KnownVisit } from "@/components/visit/elder/kept";
import * as recordingStore from "@/components/visit/elder/recording-store";
import { chunkKeeper, chunkSamples, dropConfirmed, keptRecording, memoryKeptDb, pendingRecordings, type KeptChunk, type KeptDb } from "@/components/visit/elder/recording-store";

const RATE = 16_000;
/** `seconds` of audio as the worklet hands it over: 128-sample blocks, each sample its own index (so order shows) */
function blocks(seconds: number, from = 0): Float32Array[] {
  const out: Float32Array[] = [];
  const total = Math.round(seconds * RATE);
  for (let i = 0; i < total; i += 128) {
    const b = new Float32Array(Math.min(128, total - i));
    for (let j = 0; j < b.length; j++) b[j] = ((from + i + j) % 1000) / 1000;
    out.push(b);
  }
  return out;
}

/** The kept chunks' samples as the values the microphone gave (a chunk is kept as 16-bit samples: within one step of 1/32767). */
const heard = (chunks: KeptChunk[]): number[] => chunks.flatMap((c) => Array.from(chunkSamples(c), (s) => s / 0x7fff));

async function samplesKept(db: KeptDb, owner: string, visitId: string): Promise<number> {
  return (await db.read(owner, visitId)).reduce((n, c) => n + c.pcm.length, 0);
}

describe("the keeper: every second he recorded reaches the phone", () => {
  it("a recording shorter than 10 s is on the phone once the page flushes (he ended the visit, or the page went away)", async () => {
    const db = memoryKeptDb();
    let t = 0;
    const keeper = chunkKeeper("a-owner", "visit-1", { db, now: () => t });
    for (const b of blocks(4)) {
      keeper.listener(b, RATE);
      t += 8;
    }
    // nothing yet: the 10 s have not passed (this is what the page's flush is for)
    expect(await samplesKept(db, "a-owner", "visit-1")).toBe(0);
    await keeper.flush();
    expect(await samplesKept(db, "a-owner", "visit-1")).toBe(4 * RATE);
    expect(await pendingRecordings("a-owner", db)).toEqual([{ visitId: "visit-1", durationMs: 4000, chunks: 1 }]);
  });

  it("every 10 s a chunk is written by itself, and the flush adds the last seconds after it, in order", async () => {
    const db = memoryKeptDb();
    let t = 0;
    const keeper = chunkKeeper("a-owner", "visit-1", { db, now: () => t });
    for (const b of blocks(25)) {
      keeper.listener(b, RATE);
      t += 8; // 128 samples at 16 kHz
    }
    // the writes already started are let through (they queue behind one another); the flush has not been asked for
    await new Promise((r) => setTimeout(r, 0));
    const before = await samplesKept(db, "a-owner", "visit-1");
    expect(before).toBeGreaterThanOrEqual(20 * RATE);
    expect(before).toBeLessThan(25 * RATE);
    await keeper.flush();
    const chunks = await db.read("a-owner", "visit-1");
    expect(chunks.length).toBe(3);
    const all = heard(chunks);
    expect(all.length).toBe(25 * RATE);
    // the samples are in recording order, none missing and none twice
    for (const i of [0, 1, 127, 128, 159_999, 160_000, 320_001, all.length - 1]) expect(all[i]).toBeCloseTo((i % 1000) / 1000, 4);
    // flushing again with nothing new writes nothing
    await keeper.flush();
    expect((await db.read("a-owner", "visit-1")).length).toBe(3);
  });

  it("a chunk's write is issued in the call that makes it (a closing page cannot wait), in order; flush waits for all of them", async () => {
    const inner = memoryKeptDb();
    const issued: number[] = [];
    const landed: number[] = [];
    let n = 0;
    const slow: KeptDb = {
      ...inner,
      async writer(owner, visitId) {
        const w = (await inner.writer(owner, visitId))!;
        return {
          append(pcm, rate) {
            const mine = n++;
            issued.push(mine);
            const kept = w.append(pcm, rate);
            // the phone confirms late, the first write last
            return new Promise<boolean>((resolve) => setTimeout(() => void kept.then((ok) => (landed.push(mine), resolve(ok))), 30 - mine * 10));
          },
        };
      },
    };
    let t = 0;
    const keeper = chunkKeeper("a-owner", "visit-1", { db: slow, now: () => t, everyMs: 1000 });
    // the writer is there a moment after the recording starts
    await new Promise((r) => setTimeout(r, 0));
    for (const b of blocks(2.5)) {
      keeper.listener(b, RATE);
      t += 8;
    }
    expect(issued).toEqual([0, 1]);
    const flushed = keeper.flush();
    // the last seconds went out before flush() returned its promise: nothing waits for the earlier writes to land
    expect(issued).toEqual([0, 1, 2]);
    expect(landed).toEqual([]);
    await flushed;
    expect(landed.sort()).toEqual([0, 1, 2]);
    const all = heard(await inner.read("a-owner", "visit-1"));
    expect(all.length).toBe(2.5 * RATE);
    for (const i of [0, 15_999, 16_000, 32_500, all.length - 1]) expect(all[i]).toBeCloseTo((i % 1000) / 1000, 4);
  });

  it("blocks handed over before the store is ready are kept too, in order", async () => {
    const inner = memoryKeptDb();
    const late: KeptDb = { ...inner, writer: (owner, visitId) => new Promise((resolve) => setTimeout(() => void inner.writer(owner, visitId).then(resolve), 20)) };
    let t = 0;
    const keeper = chunkKeeper("a-owner", "visit-1", { db: late, now: () => t, everyMs: 1000 });
    for (const b of blocks(2.5)) {
      keeper.listener(b, RATE);
      t += 8;
    }
    await keeper.flush();
    const all = heard(await inner.read("a-owner", "visit-1"));
    expect(all.length).toBe(2.5 * RATE);
    for (const i of [0, 15_999, 16_000, 32_500, all.length - 1]) expect(all[i]).toBeCloseTo((i % 1000) / 1000, 4);
  });

  it("a recording that already has chunks on the phone gets the new ones after them", async () => {
    const db = memoryKeptDb();
    const one = chunkKeeper("a-owner", "visit-1", { db });
    for (const b of blocks(1)) one.listener(b, RATE);
    await one.flush();
    const two = chunkKeeper("a-owner", "visit-1", { db });
    for (const b of blocks(1, RATE)) two.listener(b, RATE);
    await two.flush();
    const all = heard(await db.read("a-owner", "visit-1"));
    expect(all.length).toBe(2 * RATE);
    for (const i of [0, 15_999, 16_000, all.length - 1]) expect(all[i]).toBeCloseTo((i % 1000) / 1000, 4);
  });

  it("a block is copied when it is handed over (the recorder's buffer may be reused)", async () => {
    const db = memoryKeptDb();
    const keeper = chunkKeeper("a-owner", "visit-1", { db });
    const b = new Float32Array([0.25, 0.5]);
    keeper.listener(b, RATE);
    b.fill(0);
    await keeper.flush();
    // as the WAV holds them: 0.25 and 0.5 of the 16-bit range
    expect(Array.from((await db.read("a-owner", "visit-1"))[0].pcm)).toEqual([8191, 16383]);
  });

  it("a store that fails does not break the recording or the flush", async () => {
    const rest = { list: async () => [], read: async () => [], remove: async () => undefined };
    const stores: KeptDb[] = [
      // the browser has no store at all
      { ...rest, writer: async () => null },
      // opening it fails
      { ...rest, writer: () => Promise.reject(new Error("blocked")) },
      // a write throws (the connection is gone), or is refused (the phone is full)
      {
        ...rest,
        writer: async () => ({
          append: () => {
            throw new Error("closed");
          },
        }),
      },
      { ...rest, writer: async () => ({ append: () => Promise.reject(new Error("quota")) }) },
    ];
    for (const failing of stores) {
      const keeper = chunkKeeper("a-owner", "visit-1", { db: failing });
      for (const b of blocks(1)) keeper.listener(b, RATE);
      await expect(keeper.flush()).resolves.toBeUndefined();
      // and again once the store has answered
      for (const b of blocks(1)) keeper.listener(b, RATE);
      await expect(keeper.flush()).resolves.toBeUndefined();
    }
  });

  it("the kept copy is a 16 kHz mono WAV of the whole recording, whatever rate the microphone ran at", async () => {
    const db = memoryKeptDb();
    const keeper = chunkKeeper("a-owner", "visit-1", { db });
    for (const b of blocks(1)) keeper.listener(b, 48_000); // one second's worth of 16k blocks at 48 kHz = 1/3 s
    await keeper.flush();
    const wav = await keptRecording("a-owner", "visit-1", db);
    expect(wav?.type).toBe("audio/wav");
    const bytes = new Uint8Array(await wav!.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(new DataView(bytes.buffer).getUint32(24, true)).toBe(16_000);
    // a third of a second at 16 kHz, 16-bit mono
    expect(Math.abs((bytes.length - 44) / 2 - RATE / 3)).toBeLessThan(4);
    expect(await keptRecording("a-owner", "nothing-kept", db)).toBeNull();
  });
});

describe("a kept copy belongs to one account", () => {
  async function twoAccounts() {
    const db = memoryKeptDb();
    const his = chunkKeeper("a-his", "visit-1", { db });
    for (const b of blocks(3)) his.listener(b, RATE);
    await his.flush();
    return db;
  }

  it("another account on the same phone lists nothing and reads nothing of his", async () => {
    const db = await twoAccounts();
    expect(await pendingRecordings("a-hers", db)).toEqual([]);
    expect(await keptRecording("a-hers", "visit-1", db)).toBeNull();
    expect((await pendingRecordings("a-his", db)).map((k) => k.visitId)).toEqual(["visit-1"]);
  });

  it("another account cannot delete his copy, even with a server path and the same visit id", async () => {
    const db = await twoAccounts();
    expect(await dropConfirmed("a-hers", "visit-1", { serverAudioPath: "a-hers/visits/visit-1/recording.wav" }, db)).toBe(true);
    expect(await samplesKept(db, "a-his", "visit-1")).toBe(3 * RATE);
  });

  it("two accounts with the same visit id (the example's ids are the same in every example account) keep separate copies", async () => {
    const db = memoryKeptDb();
    const a = chunkKeeper("a-one", "v2-i03-planned", { db });
    const b = chunkKeeper("a-two", "v2-i03-planned", { db });
    for (const x of blocks(1)) a.listener(x, RATE);
    for (const x of blocks(2)) b.listener(x, RATE);
    await Promise.all([a.flush(), b.flush()]);
    expect(await samplesKept(db, "a-one", "v2-i03-planned")).toBe(RATE);
    expect(await samplesKept(db, "a-two", "v2-i03-planned")).toBe(2 * RATE);
  });

  it("without an owner nothing is kept, listed or read", async () => {
    const db = memoryKeptDb();
    const keeper = chunkKeeper("", "visit-1", { db });
    for (const b of blocks(1)) keeper.listener(b, RATE);
    await keeper.flush();
    expect(db.size()).toBe(0);
    expect(await pendingRecordings("", db)).toEqual([]);
    expect(await keptRecording("", "visit-1", db)).toBeNull();
  });
});

describe("a kept copy leaves the phone only when the server has the recording", () => {
  async function kept() {
    const db = memoryKeptDb();
    const keeper = chunkKeeper("a-his", "visit-1", { db });
    for (const b of blocks(2)) keeper.listener(b, RATE);
    await keeper.flush();
    return db;
  }

  it("no path from the server: nothing is deleted", async () => {
    const db = await kept();
    for (const serverAudioPath of [null, undefined, "", "   "]) {
      expect(await dropConfirmed("a-his", "visit-1", { serverAudioPath }, db)).toBe(false);
    }
    expect(await dropConfirmed("a-his", "visit-1", {} as { serverAudioPath: string }, db)).toBe(false);
    expect(await dropConfirmed("", "visit-1", { serverAudioPath: "a-his/visits/visit-1/r.wav" }, db)).toBe(false);
    expect(await samplesKept(db, "a-his", "visit-1")).toBe(2 * RATE);
  });

  it("the server's path: the copy goes, and only that visit's", async () => {
    const db = await kept();
    const other = chunkKeeper("a-his", "visit-2", { db });
    for (const b of blocks(1)) other.listener(b, RATE);
    await other.flush();
    expect(await dropConfirmed("a-his", "visit-1", { serverAudioPath: "a-his/visits/visit-1/r.wav" }, db)).toBe(true);
    expect((await pendingRecordings("a-his", db)).map((k) => k.visitId)).toEqual(["visit-2"]);
  });

  it("this page's upload is confirmed only by the same path on the visit", () => {
    expect(uploadConfirmed("p/visits/v/r1.wav", "p/visits/v/r1.wav")).toBe(true);
    expect(uploadConfirmed("p/visits/v/r1.wav", null)).toBe(false);
    expect(uploadConfirmed("p/visits/v/r1.wav", "p/visits/v/r0.wav")).toBe(false);
    expect(uploadConfirmed(null, "p/visits/v/r1.wav")).toBe(false);
    expect(uploadConfirmed("", "")).toBe(false);
  });

  it("the module deletes only on the server's word, and the visit page uses no other way", () => {
    // what the page can import: nothing that removes a copy except dropConfirmed (the whole copy, with the recording's
    // path on the visit) and, for a long recording (track R), the source's dropBefore (the chunks of a part, with the
    // path the server answered for that part); the browser store itself is private
    expect(Object.keys(recordingStore).sort()).toEqual(["chunkKeeper", "chunkSamples", "dropConfirmed", "keptRecording", "keptSource", "memoryKeptDb", "pendingRecordings"]);
    const dir = path.join(process.cwd(), "components", "visit", "elder");
    for (const file of ["AccountVisitFlow.tsx", "pages.tsx", "kept.ts", "TodayVisitWaiting.tsx", "upload-recording.ts"]) {
      const src = readFileSync(path.join(dir, file), "utf8");
      expect(src, file).not.toMatch(/dropRecording|indexedDB|deleteDatabase|\.remove\(|\.removeBefore\(/);
    }
    // the page itself never drops a part: only the upload does, each time with the server's path for that part
    expect(readFileSync(path.join(dir, "AccountVisitFlow.tsx"), "utf8")).not.toMatch(/dropBefore/);
    const partDrops = readFileSync(path.join(dir, "upload-recording.ts"), "utf8").match(/\.dropBefore\([^)]*\)/g) ?? [];
    expect(partDrops.length).toBe(2);
    for (const d of partDrops) expect(d).toMatch(/serverPartPath/);
    // the flow deletes in two places, each with the server's own answer as the proof
    const flow = readFileSync(path.join(dir, "AccountVisitFlow.tsx"), "utf8");
    const drops = flow.match(/dropConfirmed\([^)]*\)/g) ?? [];
    expect(drops.length).toBe(2);
    for (const d of drops) expect(d).toMatch(/serverAudioPath/);
    // and no button discards a recording
    expect(flow).not.toMatch(/resumeDrop|visit-resume-drop/);
  });
});

describe("what a kept copy's visit still needs (classifyKept)", () => {
  const v = (status: KnownVisit["status"], audioPath: string | null, empty?: boolean): KnownVisit => ({ id: "visit-1", status, audioPath, ...(empty ? { empty } : {}) });

  it("an unfinished visit is offered its recording, with or without one on the server", () => {
    expect(classifyKept(v("recording", null))).toBe("offer");
    expect(classifyKept(v("transcribing", null))).toBe("offer");
    expect(classifyKept(v("recording", "p/visits/visit-1/r.wav"))).toBe("offer");
  });

  it("a visit waiting for its text: offered while the server has no recording, done with once it has", () => {
    expect(classifyKept(v("awaiting_transcript", null))).toBe("offer");
    expect(classifyKept(v("awaiting_transcript", "p/visits/visit-1/r.wav"))).toBe("saved");
  });

  it("a visit with its record: done with when the server has the recording; ended with nothing at all, still offered", () => {
    expect(classifyKept(v("review", "p/visits/visit-1/r.wav"))).toBe("saved");
    expect(classifyKept(v("confirmed", "p/visits/visit-1/r.wav"))).toBe("saved");
    expect(classifyKept(v("review", null, true))).toBe("offer");
  });

  it("everything else is held: kept on the phone, neither offered nor deleted", () => {
    // the server does not list the visit for this account (the sixth unfinished one was the old way to lose it)
    expect(classifyKept(undefined)).toBe("hold");
    expect(classifyKept(null)).toBe("hold");
    expect(classifyKept(v("planned", null))).toBe("hold");
    // a record he may have checked, and no recording: sending one would start that record again
    expect(classifyKept(v("review", null))).toBe("hold");
    expect(classifyKept(v("confirmed", null))).toBe("hold");
    expect(classifyKept(v("confirmed", null, true))).toBe("hold");
  });

  it("never says a copy is done with unless the server holds a recording", () => {
    for (const status of ["planned", "recording", "transcribing", "awaiting_transcript", "review", "confirmed"] as const) {
      expect(classifyKept(v(status, null))).not.toBe("saved");
      expect(classifyKept(v(status, null, true))).not.toBe("saved");
    }
  });
});
