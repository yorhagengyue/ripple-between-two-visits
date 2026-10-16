"use client";

/**
 * His recording kept on the phone while he records (real-app 2.13: 「每 10 秒把已经录下的 WAV 块写进浏览器本地（IndexedDB），以看诊
 * 编号为键。页面被关、手机没电，再打开 /p/visit 时出一张卡『上次的录音（12 分 30 秒）还没传，现在传』」; 2.14: 「上传失败：录音留在手机
 * 上……上传完成以后，手机上那份清掉」). Client only: the PCM blocks the recorder hands over (lib/visit/wav for the WAV).
 * Nothing here leaves the phone; the upload is the page's (./upload-recording.ts).
 *
 * Three rules (C2 track V):
 *   1. A copy belongs to one account. IndexedDB is per origin, not per sign-in, so every row carries `owner`, a
 *      one-way stand-in for his space (lib/blob/prefix.ts, the same value his upload paths start with; never his scope
 *      or user id), and every read asks for one owner: someone else signed in on the same phone neither sees nor
 *      touches his copies.
 *   2. The whole recording is on the phone, not only its full 10 s: the page flushes the keeper when he ends the visit,
 *      when the page goes to the background or is closed, and before any upload. A page that is going away cannot
 *      wait for anything, so a write is issued in the very call that asks for it: the connection is opened and the
 *      recording's counters are read once, when the recording starts, and a chunk is then one transaction with two
 *      puts and no read in between.
 *   3. A copy leaves the phone only with the server's own word, while he is signed in: dropConfirmed, which needs the
 *      recording's path as the server has it on the visit; and, for a long recording sent in parts (track R, below),
 *      the source's dropBefore, which needs the path the server answered for the part that ends there. There is no
 *      other delete here: not for a visit missing from a list, not for a failed upload, not a button. Logging out is
 *      the one other exit, and it is not in this file: track O's lib/offline/forget.ts deletes the whole database then
 *      (real-app 2.25: 「退出登录时……没传完的录音……全部清掉」); the connection kept here closes itself when that deletion
 *      asks (onversionchange), so the logout is not held up.
 *
 * C2 track R (long visits): the copy on the phone is what is uploaded, a part at a time.
 *   - A chunk is kept as what the WAV will hold: 16-bit samples at 16 kHz (half the room of the recorder's floats; a
 *     three-hour recording is about 350 MB on the phone). Chunks kept before this (floats at the microphone's rate)
 *     are still read.
 *   - The page no longer holds the whole recording in memory. What the phone has not taken stays with the keeper (a
 *     browser without IndexedDB, a phone that is full) and is written again at every flush; the upload reads the phone
 *     and those chunks together (keptSource), so nothing recorded is left out while the page lives.
 *   - A long recording is read a part at a time, from the first chunk still on the phone (never the whole recording at
 *     once), and the chunks of a part are dropped once the server confirmed that part. The row of the recording keeps
 *     how much was dropped, so the next part starts at the right sample, after a reload too.
 *
 * Storage: database "ripple-recordings" version 2. Store "kept" holds the PCM chunks by [owner, visitId, seq]; store
 * "kept-meta" holds one small row per recording by [owner, visitId] (how long, how many chunks, how much of its start
 * is already dropped), so listing what is kept never reads the audio. Version 1's store "chunks" (keyed by visit only,
 * 10-10, never deployed) is left as it is: not read, not deleted.
 *
 * Every call fails soft: a browser without IndexedDB (or a private window that refuses it) records as before, only
 * without the copy.
 */
import { RECORDINGS_DB } from "@/lib/visit/recordings-db";
import { concatFloat32, concatInt16, encodeWav, floatToInt16, resampleLinear, TARGET_SAMPLE_RATE } from "@/lib/visit/wav";

/** shared with lib/offline/forget.ts (track O: logging out deletes this database, real-app 2.25) */
const DB_NAME = RECORDINGS_DB;
const DB_VERSION = 2;
const CHUNKS = "kept";
const META = "kept-meta";

export interface PendingRecording {
  visitId: string;
  durationMs: number;
  chunks: number;
}

export interface KeptChunk {
  /** 16-bit samples at 16 kHz (track R); a chunk kept before that is floats at the microphone's rate */
  pcm: Int16Array | Float32Array;
  rate: number;
  /** its place in the recording (the stores number the chunks as they are issued) */
  seq?: number;
}

/** One recording being kept: its chunks go after the ones already there. */
export interface KeptWriter {
  /** how many chunks the recording already had on the phone when this writer was made (its first chunk's number) */
  readonly base?: number;
  /**
   * One more chunk. The write is issued before this returns (a page being closed still gets it out); the promise says
   * whether it reached the phone. `at`: which chunk of this writer it is, 0 for its first (track R: a chunk the phone
   * refused is written again in its own place); without it, the next one.
   */
  append(pcm: Int16Array | Float32Array, rate: number, at?: number): Promise<boolean>;
}

/** Where the kept copies live: the browser's IndexedDB (below), or memory in a test. */
export interface KeptDb {
  /** start, or go on, keeping a recording (null: this browser cannot keep anything) */
  writer(owner: string, visitId: string): Promise<KeptWriter | null>;
  /** this owner's recordings (never another owner's) */
  list(owner: string): Promise<PendingRecording[]>;
  /**
   * one recording's chunks, in the order they were kept, from the first one still on the phone. `upTo`: stop once this
   * many 16 kHz samples are read (a long recording is never read whole)
   */
  read(owner: string, visitId: string, upTo?: number): Promise<KeptChunk[]>;
  /** forget one recording; only dropConfirmed calls it */
  remove(owner: string, visitId: string): Promise<void>;
  /** track R: how many 16 kHz samples of the recording's start are no longer on the phone (0: the copy is whole) */
  dropped?(owner: string, visitId: string): Promise<number>;
  /** track R: forget the chunks before `seq`, which held `samples` 16 kHz samples; only a source's dropBefore calls it */
  removeBefore?(owner: string, visitId: string, seq: number, samples: number): Promise<void>;
}

interface ChunkRow {
  owner: string;
  visitId: string;
  seq: number;
  rate: number;
  pcm: Int16Array | Float32Array;
  at: number;
}

interface MetaRow {
  owner: string;
  visitId: string;
  chunks: number;
  durationMs: number;
  updatedAt: number;
  /** track R: 16 kHz samples of the recording's start already dropped from the phone (unset: none) */
  dropped?: number;
}

/** A chunk's samples as the WAV holds them: 16-bit at 16 kHz (a float chunk is resampled by itself, as it always was). */
export function chunkSamples(c: Pick<KeptChunk, "pcm" | "rate">): Int16Array {
  if (c.pcm instanceof Int16Array && c.rate === TARGET_SAMPLE_RATE) return c.pcm;
  const floats = c.pcm instanceof Int16Array ? Float32Array.from(c.pcm, (s) => s / 0x8000) : c.pcm;
  return floatToInt16(c.rate === TARGET_SAMPLE_RATE ? floats : resampleLinear(floats, c.rate, TARGET_SAMPLE_RATE));
}

/** How many 16 kHz samples a chunk holds, without converting it. */
function chunkLength(c: Pick<KeptChunk, "pcm" | "rate">): number {
  return c.rate === TARGET_SAMPLE_RATE ? c.pcm.length : Math.floor(c.pcm.length / (c.rate / TARGET_SAMPLE_RATE));
}

/** One connection for the page's life (a write at the last moment has no time to open one). */
let connection: Promise<IDBDatabase | null> | null = null;
/**
 * The database was deleted under this page (he logged out in another tab: lib/offline/forget.ts): this page keeps
 * nothing more, or a recording still running here would put the database back on a phone he has left.
 */
let forgotten = false;

function open(): Promise<IDBDatabase | null> {
  if (forgotten) return Promise.resolve(null);
  connection ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS, { keyPath: ["owner", "visitId", "seq"] });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: ["owner", "visitId"] });
      };
      req.onsuccess = () => {
        const db = req.result;
        // another tab wants a newer version, or the browser closed it: the next call opens again
        const forget = () => {
          connection = null;
        };
        db.onversionchange = (e) => {
          // let go at once, so a logout's deletion (or a newer build's upgrade) in another tab is not held up
          db.close();
          forget();
          if (e.newVersion === null) forgotten = true;
        };
        db.onclose = forget;
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  }).then((db) => {
    if (!db) connection = null; // not available now: asked again next time
    return db;
  });
  return connection;
}

function done(tx: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

function request<T>(req: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

const allOf = (owner: string, visitId: string) => IDBKeyRange.bound([owner, visitId, 0], [owner, visitId, Number.MAX_SAFE_INTEGER]);

/**
 * Track R: how much of each recording's start this page knows to be dropped from the phone. A chunk's write puts the
 * recording's row whole and cannot read it first (rule 2), so the count it writes comes from here: what the row said
 * when the writer was made, and every drop this page made since (moved in the same tick the drop's transaction is
 * made: IndexedDB runs the transactions on these stores in the order they were made, so a chunk written after a drop
 * began always carries that drop). A chunk written after a part was dropped (one the phone refused earlier, written
 * again) then never takes the count back.
 */
const droppedHere = new Map<string, number>();
const recordingKey = (owner: string, visitId: string) => JSON.stringify([owner, visitId]);

/** The browser's store. Not exported: the page reaches it only through the functions below. */
const browserDb: KeptDb = {
  async writer(owner, visitId) {
    const first = await open();
    if (!first) return null;
    let db = first;
    let prev: MetaRow | null = null;
    try {
      prev = ((await request(db.transaction(META, "readonly").objectStore(META).get([owner, visitId]))) as MetaRow | undefined) ?? null;
    } catch {
      return null;
    }
    // what is kept of this recording so far; a chunk's number and the totals come from here, not from a read
    const base = prev?.chunks ?? 0;
    const state = { chunks: base, durationMs: prev?.durationMs ?? 0 };
    const k = recordingKey(owner, visitId);
    droppedHere.set(k, Math.max(droppedHere.get(k) ?? 0, prev?.dropped ?? 0));
    /** this writer's chunks already counted in the totals (one written again is not counted twice) */
    const counted = new Set<number>();
    let next = 0;
    const put = (pcm: Int16Array | Float32Array, rate: number, index: number): Promise<boolean> => {
      const tx = db.transaction([CHUNKS, META], "readwrite");
      const at = Date.now();
      tx.objectStore(CHUNKS).put({ owner, visitId, seq: base + index, rate, pcm, at } satisfies ChunkRow);
      if (!counted.has(index)) {
        counted.add(index);
        state.chunks = Math.max(state.chunks, base + index + 1);
        state.durationMs += (pcm.length / rate) * 1000;
      }
      const dropped = droppedHere.get(k) ?? 0;
      tx.objectStore(META).put({ owner, visitId, chunks: state.chunks, durationMs: state.durationMs, updatedAt: at, ...(dropped ? { dropped } : {}) } satisfies MetaRow);
      const finished = done(tx);
      // commit now, without waiting for the puts' answers to come back to the page: a page that is being closed, or
      // frozen for the back button, never hears them, and the transaction would be left open and thrown away
      try {
        tx.commit?.();
      } catch {
        // already committing
      }
      return finished;
    };
    return {
      base,
      append(pcm, rate, at) {
        const index = at ?? next;
        next = Math.max(next, index + 1);
        try {
          return put(pcm, rate, index);
        } catch {
          // the connection went away (another tab upgraded the database, the browser closed it): once more on a new one
          return open()
            .then((again) => {
              if (!again) return false;
              db = again;
              return put(pcm, rate, index);
            })
            .catch(() => false);
        }
      },
    };
  },
  async list(owner) {
    const db = await open();
    if (!db) return [];
    try {
      const rows = await request(db.transaction(META, "readonly").objectStore(META).getAll(IDBKeyRange.bound([owner, ""], [owner, "￿"])));
      return ((rows as MetaRow[] | null) ?? []).map((m) => ({ visitId: m.visitId, durationMs: Math.round(m.durationMs), chunks: m.chunks }));
    } catch {
      return [];
    }
  },
  async read(owner, visitId, upTo) {
    const db = await open();
    if (!db) return [];
    try {
      if (upTo === undefined) {
        const rows = await request(db.transaction(CHUNKS, "readonly").objectStore(CHUNKS).getAll(allOf(owner, visitId)));
        return ((rows as ChunkRow[] | null) ?? []).sort((a, b) => a.seq - b.seq).map((r) => ({ pcm: r.pcm, rate: r.rate, seq: r.seq }));
      }
      // a long recording: one chunk after another, in key order (which is seq order), and no further than asked
      return await new Promise<KeptChunk[]>((resolve) => {
        const out: KeptChunk[] = [];
        let have = 0;
        const req = db.transaction(CHUNKS, "readonly").objectStore(CHUNKS).openCursor(allOf(owner, visitId));
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor || have >= upTo) return resolve(out);
          const r = cursor.value as ChunkRow;
          out.push({ pcm: r.pcm, rate: r.rate, seq: r.seq });
          have += chunkLength(r);
          cursor.continue();
        };
        req.onerror = () => resolve(out);
      });
    } catch {
      return [];
    }
  },
  async remove(owner, visitId) {
    const db = await open();
    if (!db) return;
    try {
      const tx = db.transaction([CHUNKS, META], "readwrite");
      tx.objectStore(CHUNKS).delete(allOf(owner, visitId));
      tx.objectStore(META).delete([owner, visitId]);
      await done(tx);
      droppedHere.delete(recordingKey(owner, visitId));
    } catch {
      // nothing kept, or the browser refuses: nothing to do
    }
  },
  async dropped(owner, visitId) {
    const db = await open();
    if (!db) return 0;
    try {
      const meta = (await request(db.transaction(META, "readonly").objectStore(META).get([owner, visitId]))) as MetaRow | undefined | null;
      return meta?.dropped ?? 0;
    } catch {
      return 0;
    }
  },
  async removeBefore(owner, visitId, seq, samples) {
    const db = await open();
    if (!db || seq <= 0) return;
    try {
      // the chunks and the count of what they held go in one transaction: a part is either still there, or dropped
      // and counted
      const tx = db.transaction([CHUNKS, META], "readwrite");
      const metaStore = tx.objectStore(META);
      const k = recordingKey(owner, visitId);
      // A chunk this page writes from this moment on (one the phone refused earlier, written again as the page goes to
      // the background) is queued behind this transaction and puts the row whole: it must carry the new count, or it
      // would take the count back after the chunks are gone. So the count this page writes moves now, in the same
      // tick the transaction is made, not when its answer comes back.
      const known = droppedHere.get(k);
      if (known !== undefined) droppedHere.set(k, known + samples);
      let before: number | null = null;
      const get = metaStore.get([owner, visitId]);
      get.onsuccess = () => {
        const meta = get.result as MetaRow | undefined;
        if (!meta) return;
        tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([owner, visitId, 0], [owner, visitId, seq], false, true));
        before = meta.dropped ?? 0;
        metaStore.put({ ...meta, dropped: before + samples } satisfies MetaRow);
        // what the row says from now on
        droppedHere.set(k, before + samples);
      };
      // the transaction did not go through: the chunks are still there and the row says what it said
      if (!(await done(tx))) {
        const was = before ?? known;
        if (was === undefined) droppedHere.delete(k);
        else droppedHere.set(k, was);
      }
    } catch {
      // the browser refuses: the chunks stay, and are dropped the next time the server's list is read
    }
  },
};

/** A store in memory with the browser store's rules (unit tests; also what the rules above mean, in a few lines). */
export function memoryKeptDb(): KeptDb & { size(): number } {
  const rows = new Map<string, { owner: string; visitId: string; chunks: Map<number, KeptChunk>; issued: number; durationMs: number; dropped: number }>();
  const key = (owner: string, visitId: string) => JSON.stringify([owner, visitId]);
  const ordered = (row: { chunks: Map<number, KeptChunk> } | undefined) => [...(row?.chunks.entries() ?? [])].sort((a, b) => a[0] - b[0]).map(([seq, c]) => ({ ...c, seq }));
  return {
    async writer(owner, visitId) {
      const base = rows.get(key(owner, visitId))?.issued ?? 0;
      const counted = new Set<number>();
      let next = 0;
      return {
        base,
        append(pcm, rate, at) {
          const index = at ?? next;
          next = Math.max(next, index + 1);
          const k = key(owner, visitId);
          const row = rows.get(k) ?? { owner, visitId, chunks: new Map<number, KeptChunk>(), issued: 0, durationMs: 0, dropped: 0 };
          row.chunks.set(base + index, { pcm, rate });
          if (!counted.has(index)) {
            counted.add(index);
            row.issued = Math.max(row.issued, base + index + 1);
            row.durationMs += (pcm.length / rate) * 1000;
          }
          rows.set(k, row);
          return Promise.resolve(true);
        },
      };
    },
    async list(owner) {
      return [...rows.values()].filter((r) => r.owner === owner).map((r) => ({ visitId: r.visitId, chunks: r.issued, durationMs: Math.round(r.durationMs) }));
    },
    async read(owner, visitId, upTo) {
      const all = ordered(rows.get(key(owner, visitId)));
      if (upTo === undefined) return all;
      const out: KeptChunk[] = [];
      let have = 0;
      for (const c of all) {
        if (have >= upTo) break;
        out.push(c);
        have += chunkLength(c);
      }
      return out;
    },
    async remove(owner, visitId) {
      rows.delete(key(owner, visitId));
    },
    async dropped(owner, visitId) {
      return rows.get(key(owner, visitId))?.dropped ?? 0;
    },
    async removeBefore(owner, visitId, seq, samples) {
      const row = rows.get(key(owner, visitId));
      if (!row || seq <= 0) return;
      for (const s of [...row.chunks.keys()]) if (s < seq) row.chunks.delete(s);
      row.dropped += samples;
    },
    size: () => rows.size,
  };
}

/** His recordings still on this phone. */
export function pendingRecordings(owner: string, db: KeptDb = browserDb): Promise<PendingRecording[]> {
  if (!owner) return Promise.resolve([]);
  return db.list(owner);
}

/** One visit's kept recording as a 16 kHz mono WAV (null when nothing is kept). A long one is read through keptSource instead. */
export async function keptRecording(owner: string, visitId: string, db: KeptDb = browserDb): Promise<Blob | null> {
  if (!owner) return null;
  const rows = await db.read(owner, visitId);
  if (!rows.length) return null;
  const bytes = encodeWav(concatInt16(rows.map(chunkSamples)), TARGET_SAMPLE_RATE);
  return new Blob([bytes.buffer as ArrayBuffer], { type: "audio/wav" });
}

/** What the server says about the visit's recording: the path saved on the visit (GET /api/visits/[id], or the page's own data). */
export interface UploadProof {
  serverAudioPath: string | null | undefined;
}

/**
 * Forget a visit's kept recording, the only way there is: the server holds a recording on that visit. Without a path
 * from the server nothing is deleted and the answer is false. (real-app 2.14: the phone copy goes once the upload is
 * complete, and not before.)
 */
export async function dropConfirmed(owner: string, visitId: string, proof: UploadProof, db: KeptDb = browserDb): Promise<boolean> {
  if (!owner || typeof proof?.serverAudioPath !== "string" || proof.serverAudioPath.trim() === "") return false;
  await db.remove(owner, visitId);
  return true;
}

// ---------------------------------------------------------------------------------- track R: the copy as an upload's source

/** What the server answered for a part of the recording: the path it registered (POST /api/visits/[id]/parts). */
export interface PartProof {
  serverPartPath: string | null | undefined;
}

/**
 * One visit's recording as the upload reads it (./upload-recording.ts): by sample, a stretch at a time. A position is
 * a 16 kHz sample counted from the start of the whole recording, also after its first parts were dropped from the phone.
 */
export interface KeptSource {
  /** samples of the recording's start that are no longer on this phone (confirmed by the server, then dropped) */
  startSample: number;
  /** the recording's length as the phone counted it while keeping, ms (for the words on the screen; read() is exact) */
  totalMs: number;
  /** up to `count` samples from `from` on (fewer, or none, at the recording's end); `from` is never before startSample */
  read(from: number, count: number): Promise<Int16Array>;
  /**
   * Forget the chunks that end at or before `sample`: that stretch is on the server. Needs the path the server answered
   * for the part that ends there; without it nothing is deleted and the answer is false.
   */
  dropBefore(sample: number, proof: PartProof): Promise<boolean>;
}

/**
 * The recording kept on this phone for one visit, with the chunks the keeper still holds in memory (`unsaved`: what the
 * phone has not taken; a chunk that is in both counts once). Null when there is nothing at all.
 */
export async function keptSource(owner: string, visitId: string, opts: { unsaved?: readonly KeptChunk[]; db?: KeptDb } = {}): Promise<KeptSource | null> {
  const db = opts.db ?? browserDb;
  const extra = [...(opts.unsaved ?? [])].filter((c) => c.pcm.length > 0);
  const start = owner ? ((await db.dropped?.(owner, visitId)) ?? 0) : 0;
  const listed = owner ? (await db.list(owner)).find((k) => k.visitId === visitId) : undefined;
  if (!listed && !extra.length) return null;
  const extraMs = extra.reduce((ms, c) => ms + (chunkLength(c) / TARGET_SAMPLE_RATE) * 1000, 0);
  // the phone's count covers every chunk the keeper issued, the refused ones too; with no row the memory is all there is
  const totalMs = listed ? Math.max(listed.durationMs, extraMs) : extraMs;
  let startSample = start;
  /** the chunks of the last read with where each starts: what dropBefore goes by */
  let table: { seq: number; from: number; length: number; onPhone: boolean }[] = [];

  /** the phone's chunks from the first one still there, far enough to reach `to`, with the memory's merged in by number */
  const chunksTo = async (to: number): Promise<{ seq: number; from: number; samples: Int16Array; onPhone: boolean }[]> => {
    const onPhone = owner ? await db.read(owner, visitId, Math.max(0, to - startSample)) : [];
    const bySeq = new Map<number, { samples: Int16Array; onPhone: boolean }>();
    onPhone.forEach((c, i) => bySeq.set(c.seq ?? i, { samples: chunkSamples(c), onPhone: true }));
    // a refused chunk belongs before every later one; the ones after the last chunk read are needed only when the
    // phone's copy ends before `to`
    const lastRead = onPhone.length ? Math.max(...bySeq.keys()) : -1;
    const phoneSamples = [...bySeq.values()].reduce((n, c) => n + c.samples.length, 0);
    const phoneEnded = phoneSamples < to - startSample;
    extra.forEach((c, i) => {
      const seq = c.seq ?? lastRead + 1 + i;
      if (bySeq.has(seq)) return;
      if (seq < lastRead || phoneEnded) bySeq.set(seq, { samples: chunkSamples(c), onPhone: false });
    });
    let from = startSample;
    return [...bySeq.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([seq, c]) => {
        const row = { seq, from, samples: c.samples, onPhone: c.onPhone };
        from += c.samples.length;
        return row;
      });
  };

  return {
    get startSample() {
      return startSample;
    },
    totalMs,
    async read(from, count) {
      if (count <= 0 || from < startSample) return new Int16Array(0);
      const chunks = await chunksTo(from + count);
      table = chunks.map((c) => ({ seq: c.seq, from: c.from, length: c.samples.length, onPhone: c.onPhone }));
      const runs: Int16Array[] = [];
      for (const c of chunks) {
        const a = Math.max(from, c.from);
        const b = Math.min(from + count, c.from + c.samples.length);
        if (b > a) runs.push(c.samples.subarray(a - c.from, b - c.from));
      }
      return concatInt16(runs);
    },
    async dropBefore(sample, proof) {
      if (!owner || typeof proof?.serverPartPath !== "string" || proof.serverPartPath.trim() === "") return false;
      if (sample <= startSample || !db.removeBefore) return false;
      // which chunks end at or before the sample: from the last read when it reached that far, else read again
      const covers = table.length > 0 && table[0].from === startSample && table[table.length - 1].from + table[table.length - 1].length >= sample;
      const rows = covers ? table : (await chunksTo(sample)).map((c) => ({ seq: c.seq, from: c.from, length: c.samples.length, onPhone: c.onPhone }));
      let upTo = -1;
      let samples = 0;
      for (const r of rows) {
        if (r.from + r.length > sample) break;
        // a chunk the phone never took is not on it to drop: everything from there on stays
        if (!r.onPhone) break;
        upTo = r.seq;
        samples += r.length;
      }
      if (upTo < 0) return false;
      await db.removeBefore(owner, visitId, upTo + 1, samples);
      startSample += samples;
      table = [];
      return true;
    },
  };
}

/**
 * Collects the recorder's blocks and keeps them as one chunk every `everyMs` (10 s). `flush()` keeps what is left and
 * resolves when everything handed over so far is on the phone: the page calls it when he ends the visit, when the page
 * is hidden or closed, and before an upload. Each chunk's write is issued in the call that makes the chunk (the store
 * numbers the chunks as they are issued), so a page that is going away loses nothing it was told to keep. Returns the
 * listener to hand the recorder.
 *
 * Track R: a chunk is cut as 16-bit samples at 16 kHz. One the phone did not take stays here, in memory, and is written
 * again, in its own place, at every flush: `unsaved()` are those chunks (all of them in a browser that keeps nothing),
 * `refused()` says the phone has a store and turned a chunk down (it is full), `recordedMs()` how much he recorded.
 */
export function chunkKeeper(owner: string, visitId: string, opts: { everyMs?: number; db?: KeptDb; now?: () => number } = {}) {
  const everyMs = opts.everyMs ?? 10_000;
  const db = opts.db ?? browserDb;
  const now = opts.now ?? Date.now;
  let buffer: Float32Array[] = [];
  let rate = TARGET_SAMPLE_RATE;
  let last = now();
  let heardMs = 0;
  // the writer is asked for once, as the recording starts (no owner: nothing is kept, as in a browser without IndexedDB)
  const ready: Promise<KeptWriter | null> = owner ? db.writer(owner, visitId).catch(() => null) : Promise.resolve(null);
  let writer: KeptWriter | null | undefined;
  void ready.then((w) => {
    writer = w;
  });
  /** this keeper's chunks, numbered as they are cut */
  let cut = 0;
  /** cut and not known to be on the phone */
  const held = new Map<number, Int16Array>();
  let turnedDown = false;
  const inFlight = new Set<Promise<boolean>>();
  const write = (index: number, pcm: Int16Array) => {
    const issue = (w: KeptWriter | null) => {
      try {
        return w ? w.append(pcm, TARGET_SAMPLE_RATE, index) : Promise.resolve(false);
      } catch {
        return Promise.resolve(false);
      }
    };
    // the usual case: the writer is there (a moment after the recording starts) and the write goes out in this call;
    // before that, the chunks wait for it, in order
    const sent = (writer !== undefined ? issue(writer) : ready.then(issue)).catch(() => false);
    const tracked: Promise<boolean> = sent
      .then((ok) => {
        if (ok) held.delete(index);
        else if (writer) turnedDown = true;
        return ok;
      })
      .finally(() => inFlight.delete(tracked));
    inFlight.add(tracked);
  };
  const cutNow = () => {
    if (!buffer.length) return;
    const floats = concatFloat32(buffer);
    const pcm = floatToInt16(rate === TARGET_SAMPLE_RATE ? floats : resampleLinear(floats, rate, TARGET_SAMPLE_RATE));
    buffer = [];
    last = now();
    const index = cut++;
    held.set(index, pcm);
    write(index, pcm);
  };
  const flush = async (): Promise<void> => {
    cutNow();
    await Promise.all([...inFlight]);
    // what the phone did not take: once more, each in its own place (a phone that made room takes them now)
    const again = [...held.keys()].sort((a, b) => a - b);
    if (again.length && writer) {
      for (const index of again) {
        const pcm = held.get(index);
        if (pcm) write(index, pcm);
      }
      await Promise.all([...inFlight]);
    }
  };
  const listener = (block: Float32Array, sampleRate: number) => {
    // one recording has one sample rate; should it ever change, the blocks so far are kept at theirs
    if (sampleRate !== rate && buffer.length) void flush();
    rate = sampleRate;
    buffer.push(block.slice());
    heardMs += (block.length / sampleRate) * 1000;
    if (now() - last >= everyMs) void flush();
  };
  return {
    listener,
    flush,
    /** the chunks this keeper cut that are not on the phone, in order, each with its place in the recording */
    unsaved(): KeptChunk[] {
      const base = writer?.base ?? 0;
      return [...held.entries()].sort((a, b) => a[0] - b[0]).map(([index, pcm]) => ({ pcm, rate: TARGET_SAMPLE_RATE, seq: base + index }));
    },
    /** the phone can keep recordings and did not take a chunk (it is full): what is held here is in this page only */
    refused(): boolean {
      return turnedDown && held.size > 0;
    },
    /** how much he has recorded through this keeper, ms */
    recordedMs(): number {
      return heardMs;
    },
  };
}
