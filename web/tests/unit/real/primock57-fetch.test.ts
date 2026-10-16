/**
 * scripts/data/fetch_primock57.mjs without the network: strict parsing of untrusted input (LFS pointers, WAV headers,
 * TextGrid transcripts, notes, consultation ids), the no-clip mixer, verified downloads (size + sha256, retries,
 * timeouts, nothing half-written left behind), the GitHub token (GH_TOKEN, GITHUB_TOKEN or `gh auth token`; never
 * printed, only sent to api.github.com, dropped on a 401), rate limits, atomic writes that survive a busy target on
 * Windows and skip unchanged files, and a whole run against a fake copy of the repository (manifest, derived files,
 * idempotent rerun that rewrites nothing, refusing a tampered file).
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { rename as fsRename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  API_BASE,
  API_CALLS_PER_RUN,
  DEFAULT_IDS,
  FetchError,
  MEDIA_BASE,
  RAW_BASE,
  decodeText,
  downloadVerified,
  encodeWavMono16,
  getContentFile,
  githubApi,
  isDefaultSelection,
  validRef,
  gitBlobSha1,
  resolveGithubToken,
  tokenStatusLine,
  withRetries,
  writeAtomic,
  writeIfChanged,
  mixPcm16,
  parseArgs,
  parseConsultationId,
  parseLfsPointer,
  parseTextGrid,
  parseWav,
  readMonoPcm16,
  readNote,
  run,
  sha256Hex,
  stripTranscriptTags,
  toUtterances,
  verifyLocal,
} from "@/scripts/data/fetch_primock57.mjs";

const TMP = mkdtempSync(path.join(tmpdir(), "ripple-primock57-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
let tmpCount = 0;
const freshDir = () => {
  const d = path.join(TMP, `t${++tmpCount}`);
  mkdirSync(d, { recursive: true });
  return d;
};

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const quiet = () => {};

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;
function fakeFetch(route: Route) {
  const calls: { url: string; auth: string | null }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const h = new Headers(init?.headers);
    calls.push({ url, auth: h.get("authorization") });
    return route(url, init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const bytesResponse = (b: Uint8Array, status = 200, extra: Record<string, string> = {}) =>
  new Response(new Uint8Array(b), { status, headers: { "content-length": String(b.byteLength), ...extra } });
const jsonResponse = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
const b64 = (b: Uint8Array | string) => Buffer.from(b).toString("base64");

/** A WAV with arbitrary fmt values and optional chunks before the data chunk. */
function rawWav(o: { format?: number; channels?: number; rate?: number; bits?: number; data: Buffer; before?: { id: string; body: Buffer }[]; extensible?: boolean; blockAlign?: number }) {
  const channels = o.channels ?? 1;
  const bits = o.bits ?? 16;
  const rate = o.rate ?? 16000;
  const blockAlign = o.blockAlign ?? channels * (bits / 8);
  const fmtBody = Buffer.alloc(o.extensible ? 40 : 16);
  fmtBody.writeUInt16LE(o.extensible ? 0xfffe : (o.format ?? 1), 0);
  fmtBody.writeUInt16LE(channels, 2);
  fmtBody.writeUInt32LE(rate, 4);
  fmtBody.writeUInt32LE(rate * blockAlign, 8);
  fmtBody.writeUInt16LE(blockAlign, 12);
  fmtBody.writeUInt16LE(bits, 14);
  if (o.extensible) {
    fmtBody.writeUInt16LE(22, 16);
    fmtBody.writeUInt16LE(o.format ?? 1, 24); // sub-format GUID starts with the format code
  }
  const chunk = (id: string, body: Buffer) => {
    const h = Buffer.alloc(8);
    h.write(id, 0, "ascii");
    h.writeUInt32LE(body.length, 4);
    return Buffer.concat([h, body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const parts = [chunk("fmt ", fmtBody), ...(o.before ?? []).map((c) => chunk(c.id, c.body)), chunk("data", o.data)];
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(4 + body.length, 4);
  head.write("WAVE", 8, "ascii");
  return Buffer.concat([head, body]);
}
const pcm = (samples: number[]) => {
  const b = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => b.writeInt16LE(s, i * 2));
  return b;
};

/** A long-format TextGrid like PriMock57's (CRLF, trailing spaces, tier named "Speaker"). */
function textGrid(intervals: [number, number, string][], opts: { declared?: number } = {}) {
  const end = intervals.length ? intervals[intervals.length - 1][1] : 1;
  const lines = [
    'File type = "ooTextFile"',
    'Object class = "TextGrid"',
    "",
    "xmin = 0 ",
    `xmax = ${end} `,
    "tiers? <exists> ",
    "size = 1 ",
    "item []: ",
    "\titem [1]:",
    '\t\tclass = "IntervalTier" ',
    '\t\tname = "Speaker" ',
    "\t\txmin = 0 ",
    `\t\txmax = ${end} `,
    `\t\tintervals: size = ${opts.declared ?? intervals.length} `,
  ];
  intervals.forEach(([a, b, t], i) => {
    lines.push(`\t\tintervals [${i + 1}]:`, `\t\t\txmin = ${a} `, `\t\t\txmax = ${b} `, `\t\t\ttext = "${t.replace(/"/g, '""')}" `);
  });
  return lines.join("\r\n") + "\r\n";
}

describe("consultation ids and CLI options", () => {
  it("accepts dayN_consultationNN and refuses anything that could leave the folder", () => {
    expect(parseConsultationId("day3_consultation08")).toEqual({ id: "day3_consultation08", day: 3, consultation: 8 });
    for (const bad of ["day6_consultation01", "day1_consultation00", "day1_consultation16", "../day1_consultation01", "day1_consultation01/../x", "day1_consultation1", "DAY1_consultation01", ""]) {
      expect(() => parseConsultationId(bad), bad).toThrow(/not a PriMock57 consultation id/);
    }
  });

  it("defaults to the five chosen consultations, one per day, and validates --ids / --ref", () => {
    const d = parseArgs([]);
    expect(d).toEqual({ ids: [...DEFAULT_IDS], ref: "main", dryRun: false, check: false, help: false, useGh: true, manifest: null });
    expect(parseArgs(["--no-gh"]).useGh).toBe(false);
    expect(new Set(DEFAULT_IDS.map((id: string) => id.slice(0, 4))).size).toBe(5);
    expect(parseArgs(["--ids", "day3_consultation08, day1_consultation06", "--ref", COMMIT, "--dry-run"])).toMatchObject({
      ids: ["day1_consultation06", "day3_consultation08"],
      ref: COMMIT,
      dryRun: true,
    });
    expect(parseArgs(["--check"]).check).toBe(true);
    expect(() => parseArgs(["--ids", "day1_consultation06,day1_consultation06"])).toThrow(/duplicates/);
    expect(() => parseArgs(["--ids", "../../etc"])).toThrow(/not a PriMock57 consultation id/);
    expect(() => parseArgs(["--ids"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--ref", "--dry-run"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--force"])).toThrow(/unknown option/);
  });

  it("B3: --ids other than the default five never overwrite the committed manifest (needs --manifest elsewhere)", () => {
    const web = path.join(tmpdir(), "ripple-fetch-args-web");
    const committed = path.join(web, "fixtures", "real", "primock57.manifest.json");
    // a real fetch of another selection without --manifest is refused before anything is fetched
    expect(() => parseArgs(["--ids", "day1_consultation06"], web, web)).toThrow(/needs --manifest/);
    expect(() => parseArgs(["--ids", "day1_consultation06,day3_consultation08"], web, web)).toThrow(/primock57\.manifest\.json is committed/);
    // ... and --manifest may not be the committed file (relative or absolute, any case on Windows)
    expect(() => parseArgs(["--ids", "day1_consultation06", "--manifest", committed], web, web)).toThrow(/must not be/);
    expect(() => parseArgs(["--ids", "day1_consultation06", "--manifest", "fixtures/real/primock57.manifest.json"], web, web)).toThrow(/must not be/);
    expect(() => parseArgs(["--ids", "day1_consultation06", "--manifest", "x.txt"], web, web)).toThrow(/\.json file/);
    // elsewhere is fine, resolved from the working folder
    expect(parseArgs(["--ids", "day1_consultation06", "--manifest", "out/one.json"], web, web).manifest).toBe(path.resolve(web, "out/one.json"));
    // the default five in another order, a dry run and --check need nothing extra
    expect(parseArgs(["--ids", [...DEFAULT_IDS].reverse().join(",")], web, web).manifest).toBeNull();
    expect(parseArgs(["--ids", "day1_consultation06", "--dry-run"], web, web).dryRun).toBe(true);
    expect(parseArgs(["--ids", "day1_consultation06", "--check"], web, web).check).toBe(true);
    expect(isDefaultSelection([...DEFAULT_IDS])).toBe(true);
    expect(isDefaultSelection(DEFAULT_IDS.slice(1))).toBe(false);
  });

  it("B3: a bad --ref is a usage error (exit 2) before any token or network", () => {
    expect(() => parseArgs(["--ref", "x;rm"])).toThrow(/bad --ref/);
    expect(() => parseArgs(["--ref", "a b"])).toThrow(/bad --ref/);
    expect(parseArgs(["--ref", COMMIT]).ref).toBe(COMMIT);
    expect(parseArgs(["--ref", "v1.0/rc"]).ref).toBe("v1.0/rc");
    expect(validRef("main")).toBe(true);
  });
});

describe("hashes and the Git LFS pointer", () => {
  it("computes git blob ids like git does", () => {
    expect(gitBlobSha1(new Uint8Array(0))).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    expect(gitBlobSha1(Buffer.from("hello\n"))).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
    expect(sha256Hex(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("parses a v1 pointer strictly", () => {
    const oid = "a".repeat(64);
    const good = `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 14653484\n`;
    expect(parseLfsPointer(good)).toEqual({ oid, size: 14653484 });
    expect(parseLfsPointer(Buffer.from(good.trimEnd()))).toEqual({ oid, size: 14653484 });
    const bad = [
      good.replace("spec/v1", "spec/v2"),
      good.replace(oid, "A".repeat(64)),
      good.replace(oid, "a".repeat(63)),
      good.replace("sha256:", "sha1:"),
      good.replace("size 14653484", "size 0"),
      good.replace("size 14653484", "size -1"),
      good.replace("size 14653484", "size 0123"),
      good.replace("\nsize 14653484\n", "\n"),
      `${good}ext-0-foo sha256:${oid}\n`,
      good.replace(/\n/g, "\r\n"),
      `${"x".repeat(2000)}`,
    ];
    for (const b of bad) expect(() => parseLfsPointer(b), JSON.stringify(b).slice(0, 80)).toThrow();
  });
});

describe("WAV headers (untrusted input)", () => {
  it("walks the chunks: data after a LIST chunk with an odd size, and WAVE_FORMAT_EXTENSIBLE PCM", () => {
    const data = pcm([1, -2, 3, -4]);
    const w = rawWav({ data, before: [{ id: "LIST", body: Buffer.from("INFOabc") }] });
    const info = parseWav(w);
    expect(info).toMatchObject({ sampleRate: 16000, channels: 1, bitsPerSample: 16, frames: 4, dataBytes: 8 });
    expect(Array.from(readMonoPcm16(w).samples)).toEqual([1, -2, 3, -4]);
    expect(parseWav(rawWav({ data, extensible: true })).frames).toBe(4);
  });

  it("refuses what it cannot read safely", () => {
    const data = pcm([1, 2]);
    const truncated = rawWav({ data: pcm([1, 2, 3, 4]) }).subarray(0, 50);
    const cases: [Buffer, RegExp][] = [
      [Buffer.from("not a wav at all"), /not a RIFF\/WAVE/],
      [truncated, /truncated/],
      [rawWav({ data, format: 3, bits: 32 }), /not PCM/],
      [rawWav({ data, extensible: true, format: 3 }), /not PCM/],
      [rawWav({ data: Buffer.from([1, 2]), bits: 8 }), /8-bit/],
      [rawWav({ data: pcm([1, 2, 3]), channels: 3 }), /channels/],
      [rawWav({ data, blockAlign: 4 }), /block align/],
      [rawWav({ data: Buffer.from([1, 2, 3]) }), /whole number of frames/],
    ];
    for (const [buf, re] of cases) expect(() => parseWav(buf), String(re)).toThrow(re);
    const noData = Buffer.from(rawWav({ data }));
    noData.write("junk", noData.indexOf("data"), "ascii");
    expect(() => parseWav(noData)).toThrow(/no data chunk/);
  });

  it("takes the louder side of a two-channel file and says which", () => {
    const interleaved = pcm([0, 100, 0, -200, 1, 300]);
    const w = rawWav({ data: interleaved, channels: 2 });
    const r = readMonoPcm16(w);
    expect(r.channelUsed).toBe(1);
    expect(Array.from(r.samples)).toEqual([100, -200, 300]);
  });

  it("writes a canonical 44-byte header that reads back", () => {
    const s = Int16Array.from([0, 32767, -32768, 5]);
    const w = encodeWavMono16(s, 16000);
    expect(w.length).toBe(44 + 8);
    expect(w.toString("ascii", 0, 4)).toBe("RIFF");
    expect(w.readUInt32LE(4)).toBe(36 + 8);
    expect(parseWav(w)).toMatchObject({ sampleRate: 16000, channels: 1, bitsPerSample: 16, dataOffset: 44, frames: 4 });
    expect(Array.from(readMonoPcm16(w).samples)).toEqual([0, 32767, -32768, 5]);
  });
});

describe("mixing doctor + patient into one mono track", () => {
  it("sums exactly (gain 1) when the sum fits, zero-padding the shorter track at the end", () => {
    const r = mixPcm16([Int16Array.from([1000, -2000, 3000]), Int16Array.from([10, 20])]);
    expect(Array.from(r.samples)).toEqual([1010, -1980, 3000]);
    expect(r).toMatchObject({ gain: 1, peakIn: 3000, peakOut: 3000, clipped: 0, paddedSamples: [0, 1] });
  });

  it("scales the whole file by one gain instead of clipping when the sum overflows", () => {
    const a = Int16Array.from([30000, 20000, -32768, 0]);
    const b = Int16Array.from([30000, 1000, -32768, 7]);
    const r = mixPcm16([a, b]);
    expect(r.peakIn).toBe(65536);
    expect(r.gain).toBe(32767 / 65536);
    expect(r.clipped).toBe(0);
    expect(r.peakOut).toBe(32767);
    expect(Array.from(r.samples)).toEqual([Math.round(60000 * r.gain), Math.round(21000 * r.gain), -32767, Math.round(7 * r.gain)]);
    for (const v of r.samples) expect(Math.abs(v)).toBeLessThanOrEqual(32767);
    // the order of the inputs does not change the result
    expect(Array.from(mixPcm16([b, a]).samples)).toEqual(Array.from(r.samples));
  });

  it("refuses an empty mix", () => {
    expect(() => mixPcm16([])).toThrow(/nothing to mix/);
  });
});

describe("TextGrid transcripts", () => {
  it("parses PriMock57's long format: CRLF, empty intervals, doubled quotes, text over several lines, tags", () => {
    let tg = textGrid([
      [0, 1.25, ""],
      [1.25, 3.5, 'He said "take two" <UNSURE>maybe</UNSURE>'],
      [3.5, 4, "<UNIN/>"],
      [4, 6.123456, "line one\nline two"],
    ]);
    tg = "\ufeff" + tg; // decodeText drops a UTF-8 BOM before parsing
    const parsed = parseTextGrid(decodeText(Buffer.from(tg, "utf8")));
    expect(parsed.xmax).toBe(6.123456);
    expect(parsed.tiers).toHaveLength(1);
    expect(parsed.tiers[0].name).toBe("Speaker");
    expect(parsed.tiers[0].intervals.map((x: { text: string }) => x.text)).toEqual([
      "",
      'He said "take two" <UNSURE>maybe</UNSURE>',
      "<UNIN/>",
      "line one\nline two",
    ]);
    expect(parsed.tiers[0].intervals[3]).toMatchObject({ xmin: 4, xmax: 6.123456 });
  });

  it("refuses malformed transcripts", () => {
    expect(() => parseTextGrid("hello")).toThrow(/long-format Praat TextGrid/);
    expect(() => parseTextGrid('File type = "ooTextFile short"\nObject class = "TextGrid"\n')).toThrow(/long-format/);
    expect(() => parseTextGrid(textGrid([[0, 1, "a"]], { declared: 2 }))).toThrow(/declares 2 intervals, has 1/);
    expect(() => parseTextGrid(textGrid([[0, 1, "a"], [2, 1.5, "b"]]))).toThrow(/ends before it starts/);
    expect(() => parseTextGrid(textGrid([[2, 3, "a"], [0, 1, "b"]]))).toThrow(/out of order/);
    expect(() => parseTextGrid(textGrid([[0, 1, "a"]]).replace("xmin = 0 \r\n\t\t\txmax", "xmin = abc \r\n\t\t\txmax"))).toThrow(/not a number/);
    expect(() => parseTextGrid(textGrid([[0, 1, "a"]]).replace('text = "a" ', 'text = "a'))).toThrow(/unterminated string/);
    expect(() => parseTextGrid('File type = "ooTextFile"\nObject class = "TextGrid"\n\nxmin = 0\nxmax = 1\n')).toThrow(/no interval tier/);
  });

  it("decodes UTF-8 (with or without BOM) and UTF-16 with a BOM, and refuses broken UTF-8", () => {
    expect(decodeText(Buffer.from("\ufeffabc 中文", "utf8"))).toBe("abc 中文");
    expect(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("abc 中文", "utf16le")]))).toBe("abc 中文");
    expect(() => decodeText(Buffer.from([0x61, 0xff, 0x62]))).toThrow();
  });

  it("strips the transcriber tags", () => {
    expect(stripTranscriptTags("<UNIN/> Sorry <UNSURE>to hear</UNSURE> that.  <INAUDIBLE_SPEECH/>")).toBe("Sorry to hear that.");
    expect(stripTranscriptTags("<UNIN/>")).toBe("");
    expect(stripTranscriptTags("<NEW_TAG/> words")).toBe("words");
  });

  it("merges both channels into one time-ordered utterance list in the fixtures/visits shape", () => {
    const doctor = parseTextGrid(textGrid([[0, 1, ""], [1, 2.5, "How can I help?"], [2.5, 3, "<UNIN/>"], [6, 8, "Take <UNSURE>one</UNSURE> tablet."]]));
    const patient = parseTextGrid(textGrid([[0, 3, ""], [3, 5.9996, 'I said "hard to breathe".'], [5.9996, 9, ""]]));
    const u = toUtterances("day1_consultation06", { doctor, patient }, { commit: COMMIT, sources: { doctor: "transcripts/d.TextGrid", patient: "transcripts/p.TextGrid" } });
    expect(u.meta).toMatchObject({ dataset: "PriMock57", consultation: "day1_consultation06", commit: COMMIT, licence: "CC-BY-4.0", intervals_without_words: 1 });
    expect(u.utterances).toEqual([
      { id: "day1_consultation06-u001", t_start_ms: 1000, t_end_ms: 2500, speaker_cluster: 0, speaker: "doctor", lang: "en-GB", text: "How can I help?", text_raw: "How can I help?" },
      { id: "day1_consultation06-u002", t_start_ms: 3000, t_end_ms: 6000, speaker_cluster: 1, speaker: "patient", lang: "en-GB", text: 'I said "hard to breathe".', text_raw: 'I said "hard to breathe".' },
      { id: "day1_consultation06-u003", t_start_ms: 6000, t_end_ms: 8000, speaker_cluster: 0, speaker: "doctor", lang: "en-GB", text: "Take one tablet.", text_raw: "Take <UNSURE>one</UNSURE> tablet." },
    ]);
    const visit = JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "visits", "v1.utterances.json"), "utf8")) as { utterances: Record<string, unknown>[] };
    for (const k of Object.keys(visit.utterances[0])) expect(u.utterances[0]).toHaveProperty(k);
  });
});

describe("clinician notes", () => {
  const note = (o: Record<string, unknown>) => Buffer.from(JSON.stringify(o));
  it("checks the note belongs to the consultation and cleans the complaint", () => {
    expect(readNote(note({ day: 3, consultation: 8, presenting_complaint: "I have\u0007 a  cough\n", note: "x" }), { day: 3, consultation: 8 })).toEqual({
      presentingComplaint: "I have a cough",
    });
    expect(() => readNote(note({ day: 3, consultation: 9, presenting_complaint: "a", note: "x" }), { day: 3, consultation: 8 })).toThrow(/expected 3\/8/);
    expect(() => readNote(Buffer.from("{nope"), { day: 1, consultation: 1 })).toThrow(/not valid JSON/);
    expect(() => readNote(note({ day: 1, consultation: 1 }), { day: 1, consultation: 1 })).toThrow(/presenting_complaint/);
    expect(() => readNote(Buffer.from("[]"), { day: 1, consultation: 1 })).toThrow(/not an object/);
  });
});

describe("verified downloads", () => {
  const body = Buffer.from("x".repeat(5000));
  const expectOk = { size: body.length, sha256: sha256Hex(body) };
  const URL_ = `${MEDIA_BASE}/${COMMIT}/audio/a.wav`;
  const ctxFor = (impl: typeof fetch, retries = 0) => ({ fetchImpl: impl, log: quiet, retries, backoffMs: 0 });
  const leftovers = (dir: string) => readdirSync(dir).filter((n) => n.endsWith(".part"));

  it("streams to .part, checks size and sha256, then renames into place (no token sent)", async () => {
    const dir = freshDir();
    const dest = path.join(dir, "a.wav");
    const f = fakeFetch(() => bytesResponse(body));
    const got = await downloadVerified({ ...ctxFor(f.impl), token: "secret-token" }, URL_, dest, expectOk);
    expect(got).toBe(body.length);
    expect(readFileSync(dest).equals(body)).toBe(true);
    expect(leftovers(dir)).toEqual([]);
    expect(f.calls.map((c) => c.auth)).toEqual([null]);
  });

  it("retries a 5xx, but not a 404", async () => {
    const dir = freshDir();
    let n = 0;
    const flaky = fakeFetch(() => (++n === 1 ? new Response("busy", { status: 503 }) : bytesResponse(body)));
    await downloadVerified(ctxFor(flaky.impl, 2), URL_, path.join(dir, "a.wav"), expectOk);
    expect(flaky.calls).toHaveLength(2);
    const missing = fakeFetch(() => new Response("no", { status: 404 }));
    await expect(downloadVerified(ctxFor(missing.impl, 3), URL_, path.join(dir, "b.wav"), expectOk)).rejects.toThrow(/HTTP 404/);
    expect(missing.calls).toHaveLength(1);
  });

  it("keeps nothing when the size or sha256 is wrong, even after retries", async () => {
    const dir = freshDir();
    const dest = path.join(dir, "a.wav");
    const corrupt = Buffer.from(body);
    corrupt[10] = 0x79;
    const f = fakeFetch(() => bytesResponse(corrupt));
    await expect(downloadVerified(ctxFor(f.impl, 1), URL_, dest, expectOk)).rejects.toThrow(/sha256 .* does not match/);
    expect(f.calls).toHaveLength(2);
    expect(existsSync(dest)).toBe(false);
    expect(leftovers(dir)).toEqual([]);

    const short = fakeFetch(() => new Response(new Uint8Array(body.subarray(0, 100))));
    await expect(downloadVerified(ctxFor(short.impl), URL_, dest, expectOk)).rejects.toThrow(/got 100 bytes, expected 5000/);
    const long = fakeFetch(() => new Response(new Uint8Array(Buffer.concat([body, body]))));
    await expect(downloadVerified(ctxFor(long.impl), URL_, dest, expectOk)).rejects.toThrow(/more than 5000 bytes/);
    const lying = fakeFetch(() => bytesResponse(body, 200, { "content-length": "4999" }));
    await expect(downloadVerified(ctxFor(lying.impl), URL_, dest, expectOk)).rejects.toThrow(/Content-Length 4999/);
    expect(existsSync(dest)).toBe(false);
    expect(leftovers(dir)).toEqual([]);
  });

  it("gives up on a stalled body instead of hanging, and cleans up", async () => {
    const dir = freshDir();
    const dest = path.join(dir, "a.wav");
    const f = fakeFetch(
      () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(body.subarray(0, 10)));
              // never closes
            },
          }),
        ),
    );
    await expect(downloadVerified(ctxFor(f.impl), URL_, dest, { ...expectOk, stallMs: 50 })).rejects.toThrow(/timed out.*no data for 50 ms/);
    expect(existsSync(dest)).toBe(false);
    expect(leftovers(dir)).toEqual([]);
  });

  it("replaces a corrupted file already on disk", async () => {
    const dir = freshDir();
    const dest = path.join(dir, "a.wav");
    writeFileSync(dest, "garbage");
    await downloadVerified(ctxFor(fakeFetch(() => bytesResponse(body)).impl), URL_, dest, expectOk);
    expect(readFileSync(dest).equals(body)).toBe(true);
  });

  it("refuses a bad expectation before touching the network", async () => {
    const f = fakeFetch(() => bytesResponse(body));
    await expect(downloadVerified(ctxFor(f.impl), URL_, path.join(freshDir(), "a"), { size: 0, sha256: expectOk.sha256 })).rejects.toThrow(/bad expected size/);
    await expect(downloadVerified(ctxFor(f.impl), URL_, path.join(freshDir(), "a"), { size: 5, sha256: "abc" })).rejects.toThrow(/bad expected sha256/);
    expect(f.calls).toHaveLength(0);
  });
});

describe("GitHub API", () => {
  const limited = () => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1791516510" } });

  it("sends the token only to api.github.com and explains a rate limit instead of retrying", async () => {
    const f = fakeFetch(limited);
    const err = await githubApi({ fetchImpl: f.impl, log: quiet, token: "tkn", retries: 3, backoffMs: 0 }, "commits/main").catch((e: Error) => e);
    expect(String(err)).toMatch(/rate limit reached \(resets 2026-\d\d-\d\dT[^)]*min\); this token's hourly quota is used up/);
    expect(String(err)).not.toContain("tkn");
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url.startsWith(API_BASE)).toBe(true);
    expect(f.calls[0].auth).toBe("Bearer tkn");
  });

  it("without a token, a rate limit says how to get one: gh auth login, GH_TOKEN or GITHUB_TOKEN", async () => {
    const f = fakeFetch(limited);
    const err = await githubApi({ fetchImpl: f.impl, log: quiet, retries: 3, backoffMs: 0 }, "commits/main").catch((e: Error) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect(String(err)).toMatch(/60 requests an hour and a default run makes 14: log in with `gh auth login`.*GH_TOKEN or GITHUB_TOKEN, or wait/);
    expect(f.calls).toHaveLength(1);
    expect(API_CALLS_PER_RUN).toBe(14);
  });

  it("drops a token the API rejects (401) and asks once more without it, even with no retries left", async () => {
    const f = fakeFetch((_url, init) => (new Headers(init?.headers).get("authorization") ? new Response("bad credentials", { status: 401 }) : jsonResponse({ sha: COMMIT })));
    const logs: string[] = [];
    const ctx: { fetchImpl: typeof fetch; log: (s: string) => void; token?: string; retries: number; backoffMs: number; tokenDropped?: boolean } = {
      fetchImpl: f.impl,
      log: (s) => logs.push(s),
      token: "test-token-rejected-0000000000000000",
      retries: 0,
      backoffMs: 0,
    };
    await expect(githubApi(ctx, "commits/main")).resolves.toEqual({ sha: COMMIT });
    expect(f.calls.map((c) => c.auth)).toEqual(["Bearer test-token-rejected-0000000000000000", null]);
    expect(ctx.token).toBeUndefined();
    expect(ctx.tokenDropped).toBe(true);
    expect(logs.join("\n")).toMatch(/rejected the token \(HTTP 401\)/);
    expect(logs.join("\n")).not.toContain("test-token-rejected");
    // the rest of the run goes without it
    await githubApi(ctx, "commits/main");
    expect(f.calls[2].auth).toBeNull();
    // a 401 without a token is an ordinary error, not retried
    const plain = fakeFetch(() => new Response("no", { status: 401 }));
    await expect(githubApi({ fetchImpl: plain.impl, log: quiet, retries: 3, backoffMs: 0 }, "commits/main")).rejects.toThrow(/HTTP 401/);
    expect(plain.calls).toHaveLength(1);
  });

  it("waits out a short secondary rate limit (Retry-After) and gives up with a clear message on a long one", async () => {
    let n = 0;
    const brief = fakeFetch(() => (++n === 1 ? new Response("slow down", { status: 403, headers: { "retry-after": "0" } }) : jsonResponse({ sha: COMMIT })));
    await expect(githubApi({ fetchImpl: brief.impl, log: quiet, retries: 2, backoffMs: 0 }, "commits/main")).resolves.toEqual({ sha: COMMIT });
    expect(brief.calls).toHaveLength(2);
    const long = fakeFetch(() => new Response("slow down", { status: 429, headers: { "retry-after": "3600" } }));
    await expect(githubApi({ fetchImpl: long.impl, log: quiet, retries: 3, backoffMs: 0 }, "commits/main")).rejects.toThrow(/asks to wait 3600 s \(secondary rate limit\)/);
    expect(long.calls).toHaveLength(1);
    // a plain 403 (no rate-limit headers) is not retried either
    const forbidden = fakeFetch(() => new Response("forbidden", { status: 403 }));
    await expect(githubApi({ fetchImpl: forbidden.impl, log: quiet, retries: 3, backoffMs: 0 }, "commits/main")).rejects.toThrow(/HTTP 403$/);
    expect(forbidden.calls).toHaveLength(1);
  });

  it("withRetries waits at least the server's Retry-After", async () => {
    let n = 0;
    const t0 = Date.now();
    const v = await withRetries(
      async () => {
        if (++n === 1) throw new FetchError("busy", { retryable: true, retryAfterMs: 60 });
        return "ok";
      },
      { retries: 1, backoffMs: 0 },
    );
    expect(v).toBe("ok");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(50);
  });

  it("checks a contents-API file against its git blob id and path; for LFS, reports the object size", async () => {
    const pointer = Buffer.from(`version https://git-lfs.github.com/spec/v1\noid sha256:${"b".repeat(64)}\nsize 21200684\n`);
    const entry = { type: "file", path: "audio/x.wav", encoding: "base64", content: b64(pointer), size: 21200684, sha: gitBlobSha1(pointer) };
    const ok = fakeFetch(() => jsonResponse(entry));
    const ctx = { fetchImpl: ok.impl, log: quiet, retries: 0, backoffMs: 0 };
    const r = await getContentFile(ctx, "audio/x.wav", COMMIT, 1024, { lfs: true });
    expect(r.reportedSize).toBe(21200684);
    expect(parseLfsPointer(r.bytes).size).toBe(21200684);
    await expect(getContentFile(ctx, "audio/x.wav", COMMIT, 1024)).rejects.toThrow(/over limit/);
    const tampered = fakeFetch(() => jsonResponse({ ...entry, sha: "0".repeat(40) }));
    await expect(getContentFile({ ...ctx, fetchImpl: tampered.impl }, "audio/x.wav", COMMIT, 1024, { lfs: true })).rejects.toThrow(/git blob sha1/);
    const elsewhere = fakeFetch(() => jsonResponse({ ...entry, path: "audio/y.wav" }));
    await expect(getContentFile({ ...ctx, fetchImpl: elsewhere.impl }, "audio/x.wav", COMMIT, 1024, { lfs: true })).rejects.toThrow(/returned file audio\/y.wav/);
  });
});

describe("GitHub token: GH_TOKEN, then GITHUB_TOKEN, then gh auth token; never printed", () => {
  const GH = "gho_" + "a1B2".repeat(9);
  const PAT = "github_pat_" + "Z9y8".repeat(20);
  const execOk = (out: string) => {
    const calls: { file: string; args: string[] }[] = [];
    const exec = async (file: string, args: string[]) => {
      calls.push({ file, args });
      return out;
    };
    return { exec, calls };
  };
  const execFail = (code?: string) => async () => {
    throw Object.assign(new Error(`spawn gh ${code ?? "exit 1"}`), code ? { code } : { code: 1 });
  };

  it("takes GH_TOKEN first, then GITHUB_TOKEN, without asking gh", async () => {
    const e = execOk(GH);
    expect(await resolveGithubToken({ env: { GH_TOKEN: ` ${PAT}\n`, GITHUB_TOKEN: GH }, exec: e.exec })).toEqual({ token: PAT, source: "GH_TOKEN" });
    expect(await resolveGithubToken({ env: { GH_TOKEN: "  ", GITHUB_TOKEN: PAT }, exec: e.exec })).toEqual({ token: PAT, source: "GITHUB_TOKEN" });
    expect(e.calls).toHaveLength(0);
  });

  it("falls back to the GitHub CLI's login (no shell, github.com only)", async () => {
    const e = execOk(`${GH}\n`);
    expect(await resolveGithubToken({ env: {}, exec: e.exec })).toEqual({ token: GH, source: "gh auth token" });
    expect(e.calls).toEqual([{ file: "gh", args: ["auth", "token", "--hostname", "github.com"] }]);
  });

  it("goes without a token when gh is missing, not logged in, prints junk, or --no-gh is given", async () => {
    expect(await resolveGithubToken({ env: {}, exec: execFail("ENOENT") })).toMatchObject({ token: undefined, source: null, note: "GitHub CLI (gh) not found" });
    expect(await resolveGithubToken({ env: {}, exec: execFail() })).toMatchObject({ token: undefined, source: null });
    for (const junk of ["", "\n", "two\nlines-of-token-text-here", "has spaces in the token text here", "short"]) {
      expect(await resolveGithubToken({ env: {}, exec: execOk(junk).exec }), JSON.stringify(junk)).toMatchObject({ token: undefined, source: null });
    }
    const e = execOk(GH);
    expect(await resolveGithubToken({ env: {}, exec: e.exec, useGh: false })).toEqual({ token: undefined, source: null, note: "--no-gh" });
    expect(e.calls).toHaveLength(0);
  });

  it("refuses a malformed GH_TOKEN / GITHUB_TOKEN instead of ignoring it, without echoing it", async () => {
    const bad = "not a token at all, it has spaces";
    const err = await resolveGithubToken({ env: { GH_TOKEN: bad }, exec: execOk(GH).exec }).catch((x: Error) => x);
    expect(String(err)).toMatch(/GH_TOKEN is set but does not look like a GitHub token/);
    expect(String(err)).not.toContain("spaces");
    await expect(resolveGithubToken({ env: { GITHUB_TOKEN: "abc\ndef-ghi-jkl-mno-pqr" } })).rejects.toThrow(/GITHUB_TOKEN is set but/);
  });

  it("reports where the token came from, never the value", () => {
    expect(tokenStatusLine({ token: GH, source: "gh auth token" })).toBe("GitHub token: set (gh auth token)");
    expect(tokenStatusLine({ token: PAT, source: "GH_TOKEN" })).toBe("GitHub token: set (GH_TOKEN)");
    const none = tokenStatusLine({ token: undefined, source: null, note: "GitHub CLI (gh) not found" });
    expect(none).toMatch(/^GitHub token: not set \(GitHub CLI \(gh\) not found\); without one the GitHub API allows 60 requests an hour/);
    for (const line of [tokenStatusLine({ token: GH, source: "gh auth token" }), tokenStatusLine({ token: PAT, source: "GITHUB_TOKEN" })]) {
      expect(line).not.toContain(GH);
      expect(line).not.toContain(PAT);
      expect(line).not.toContain("a1B2");
    }
  });

  it("no token-shaped literal in this track's files, so a secret scanner on push has nothing to flag", () => {
    // GitHub's own token formats: ghp_/gho_/ghu_/ghs_/ghr_ + 36 base62 characters, and fine-grained github_pat_.
    const shapes = [/\bgh[pousr]_[A-Za-z0-9]{36,}/, /\bgithub_pat_[A-Za-z0-9_]{22,}/];
    expect(shapes[0].test("ghp_" + "x".repeat(36)), "probe catches a classic-format token").toBe(true);
    expect(shapes[1].test("github_pat_" + "x".repeat(22)), "probe catches a fine-grained token").toBe(true);
    const web = process.cwd();
    const files = [
      "scripts/data/fetch_primock57.mjs",
      ...["tests/unit/real", "fixtures/real"].flatMap((d) => readdirSync(path.join(web, d)).map((n) => `${d}/${n}`)),
    ].filter((rel) => statSync(path.join(web, ...rel.split("/"))).isFile());
    expect(files.length).toBeGreaterThanOrEqual(6);
    const hits = files.flatMap((rel) =>
      readFileSync(path.join(web, ...rel.split("/")), "utf8")
        .split(/\r?\n/)
        .flatMap((line, i) => (shapes.some((re) => re.test(line)) ? [`${rel}:${i + 1}`] : [])),
    );
    expect(hits).toEqual([]);
  });
});

describe("writing files: atomic, retried when Windows has the target open, skipped when unchanged", () => {
  const busy = (code: string) => Object.assign(new Error(`${code}: operation not permitted, rename`), { code });

  it("writeIfChanged leaves an identical file alone (same mtime) and rewrites a different one", async () => {
    const dir = freshDir();
    const file = path.join(dir, "mixed.wav");
    expect(await writeIfChanged(file, Buffer.from("abc"))).toBe(true);
    const past = new Date("2026-01-02T03:04:05Z");
    utimesSync(file, past, past);
    expect(await writeIfChanged(file, Buffer.from("abc"))).toBe(false);
    expect(statSync(file).mtimeMs).toBe(past.getTime());
    expect(await writeIfChanged(file, "abd")).toBe(true);
    expect(readFileSync(file, "utf8")).toBe("abd");
    expect(readdirSync(dir)).toEqual(["mixed.wav"]);
  });

  it("retries a rename that Windows refuses for a moment (EPERM / EBUSY / EACCES)", async () => {
    const dir = freshDir();
    const file = path.join(dir, "a.json");
    writeFileSync(file, "old");
    let n = 0;
    const renameImpl = async (from: string, to: string) => {
      n++;
      if (n === 1) throw busy("EPERM");
      if (n === 2) throw busy("EBUSY");
      if (n === 3) throw busy("EACCES");
      await fsRename(from, to);
    };
    await writeAtomic(file, "new", { renameImpl, retryDelaysMs: [1, 1, 1, 1] });
    expect(n).toBe(4);
    expect(readFileSync(file, "utf8")).toBe("new");
    expect(readdirSync(dir)).toEqual(["a.json"]);
  });

  it("gives up with a plain message when the target stays open, keeping the old file and no temp file", async () => {
    const dir = freshDir();
    const file = path.join(dir, "a.wav");
    writeFileSync(file, "old");
    let n = 0;
    const renameImpl = async () => {
      n++;
      throw busy("EBUSY");
    };
    await expect(writeAtomic(file, "new", { renameImpl, retryDelaysMs: [1, 1] })).rejects.toThrow(/could not replace .*a\.wav \(EBUSY\); is it open in another program\?/);
    expect(n).toBe(3);
    expect(readFileSync(file, "utf8")).toBe("old");
    expect(readdirSync(dir)).toEqual(["a.wav"]);
  });

  it("does not retry other errors", async () => {
    const dir = freshDir();
    let n = 0;
    const renameImpl = async () => {
      n++;
      throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
    };
    await expect(writeAtomic(path.join(dir, "b.json"), "x", { renameImpl, retryDelaysMs: [1, 1] })).rejects.toThrow(/ENOSPC/);
    expect(n).toBe(1);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("a whole run against a fake copy of the repository", () => {
  const IDS = ["day1_consultation01", "day2_consultation03"];
  const LICENSE = Buffer.from("# Creative Commons Attribution 4.0 International\n\nlicence text\n");
  const tracks: Record<string, Buffer> = {
    "audio/day1_consultation01_doctor.wav": encodeWavMono16(Int16Array.from([30000, 100, -5, 0, 0]), 16000),
    "audio/day1_consultation01_patient.wav": encodeWavMono16(Int16Array.from([30000, 200, 5, 1]), 16000),
    "audio/day2_consultation03_doctor.wav": encodeWavMono16(Int16Array.from([10, 20, 30]), 16000),
    "audio/day2_consultation03_patient.wav": encodeWavMono16(Int16Array.from([1, 2, 3]), 16000),
  };
  const texts: Record<string, Buffer> = {};
  for (const id of IDS) {
    texts[`transcripts/${id}_doctor.TextGrid`] = Buffer.from(textGrid([[0, 0.1, "Hello, <UNSURE>how</UNSURE> can I help?"], [0.1, 0.3, ""]]));
    texts[`transcripts/${id}_patient.TextGrid`] = Buffer.from(textGrid([[0, 0.15, ""], [0.15, 0.3, "<UNIN/> I have a cough."]]));
    const [, day, num] = /^day(\d)_consultation(\d\d)$/.exec(id)!;
    texts[`notes/${id}.json`] = Buffer.from(JSON.stringify({ day: Number(day), consultation: Number(num), presenting_complaint: "I have a cough", note: "Plan: rest.", highlights: [] }));
  }

  function repo(opts: { tamper?: string } = {}) {
    return fakeFetch((url) => {
      if (url === `${API_BASE}/commits/main`) return jsonResponse({ sha: COMMIT });
      const apiPrefix = `${API_BASE}/contents/`;
      const refSuffix = `?ref=${COMMIT}`;
      if (url.startsWith(apiPrefix) && url.endsWith(refSuffix)) {
        const p = decodeURIComponent(url.slice(apiPrefix.length, -refSuffix.length));
        if (p === "LICENSE.md") return jsonResponse({ type: "file", path: p, encoding: "base64", content: b64(LICENSE), size: LICENSE.length, sha: gitBlobSha1(LICENSE) });
        if (p === "transcripts" || p === "notes") {
          return jsonResponse(
            Object.entries(texts)
              .filter(([k]) => k.startsWith(`${p}/`))
              .map(([k, v]) => ({ type: "file", name: k.split("/")[1], path: k, size: v.length, sha: gitBlobSha1(v) })),
          );
        }
        const wav = tracks[p];
        if (wav) {
          const ptr = Buffer.from(`version https://git-lfs.github.com/spec/v1\noid sha256:${sha256Hex(wav)}\nsize ${wav.length}\n`);
          return jsonResponse({ type: "file", path: p, encoding: "base64", content: b64(ptr), size: wav.length, sha: gitBlobSha1(ptr) });
        }
        return new Response("not found", { status: 404 });
      }
      const media = `${MEDIA_BASE}/${COMMIT}/`;
      if (url.startsWith(media) && tracks[url.slice(media.length)]) {
        const p = url.slice(media.length);
        const b = Buffer.from(tracks[p]);
        if (opts.tamper === p) b[b.length - 1] ^= 0xff;
        return bytesResponse(b);
      }
      const raw = `${RAW_BASE}/${COMMIT}/`;
      if (url.startsWith(raw) && texts[url.slice(raw.length)]) return bytesResponse(texts[url.slice(raw.length)]);
      return new Response("not found", { status: 404 });
    });
  }

  it("downloads, verifies, mixes without clipping, writes the manifest; a rerun downloads nothing and changes nothing", async () => {
    const web = freshDir();
    const f = repo();
    const ctx = { fetchImpl: f.impl, log: quiet, retries: 0, backoffMs: 0, token: "tkn" };
    const r = await run({ ids: IDS, ref: "main", dryRun: false, web }, ctx);
    expect(r.commit).toBe(COMMIT);
    const manifestPath = path.join(web, "fixtures", "real", "primock57.manifest.json");
    const manifestText = readFileSync(manifestPath, "utf8");
    const m = JSON.parse(manifestText);
    expect(m.dataset.commit).toBe(COMMIT);
    expect(m.licence).toMatchObject({ id: "CC-BY-4.0", url: "https://creativecommons.org/licenses/by/4.0/" });
    expect(m.consultations.map((c: { id: string }) => c.id)).toEqual(IDS);
    expect(m.totals).toMatchObject({ consultations: 2, files: 14, source_files: 10, derived_files: 4 });

    const c1 = m.consultations[0];
    expect(c1.mix).toEqual({ gain: 32767 / 60000, peak_in: 60000, peak_out: 32767, clipped_samples: 0, padded_samples: { doctor: 0, patient: 1 } });
    const root = path.join(web, ".data", "real", "primock57");
    const mixed = readMonoPcm16(readFileSync(path.join(root, "mixed", "day1_consultation01.wav")));
    const g = 32767 / 60000;
    expect(Array.from(mixed.samples)).toEqual([32767, Math.round(300 * g), 0, Math.round(1 * g), 0]);
    expect(m.consultations[1].mix).toMatchObject({ gain: 1, peak_in: 33, clipped_samples: 0 });
    expect(Array.from(readMonoPcm16(readFileSync(path.join(root, "mixed", "day2_consultation03.wav"))).samples)).toEqual([11, 22, 33]);

    const utt = JSON.parse(readFileSync(path.join(root, "transcripts", "day1_consultation01.utterances.json"), "utf8"));
    expect(utt.utterances.map((u: { speaker: string; text: string }) => [u.speaker, u.text])).toEqual([
      ["doctor", "Hello, how can I help?"],
      ["patient", "I have a cough."],
    ]);
    expect(c1.presenting_complaint).toBe("I have a cough");
    expect(c1.why_selected).toBe("chosen with --ids");

    // every byte on disk is what the manifest says
    expect((await verifyLocal(m, web)).problems).toEqual([]);
    // the token went to the API only
    for (const call of f.calls) expect(call.auth === null || call.url.startsWith(API_BASE), call.url).toBe(true);
    expect(f.calls.some((c) => c.auth === "Bearer tkn")).toBe(true);

    expect(r).toMatchObject({ derivedWritten: 4, derivedUnchanged: 0, manifestWritten: true });

    // a rerun downloads nothing and rewrites nothing: derived files and the manifest keep their bytes and mtime
    const derivedPaths = m.consultations.flatMap((c: { files: { path: string; derived?: boolean }[] }) =>
      c.files.filter((x) => x.derived).map((x) => path.join(root, ...x.path.split("/"))),
    );
    expect(derivedPaths).toHaveLength(4);
    const past = new Date("2026-01-02T03:04:05Z");
    for (const p of [...derivedPaths, manifestPath]) utimesSync(p, past, past);
    const again = repo();
    const r2 = await run({ ids: IDS, ref: "main", dryRun: false, web }, { fetchImpl: again.impl, log: quiet, retries: 0, backoffMs: 0 });
    expect(r2.downloaded).toBe(0);
    expect(r2).toMatchObject({ derivedWritten: 0, derivedUnchanged: 4, manifestWritten: false });
    expect(again.calls.some((c) => c.url.startsWith(MEDIA_BASE) || c.url.startsWith(RAW_BASE))).toBe(false);
    expect(readFileSync(manifestPath, "utf8")).toBe(manifestText);
    for (const p of [...derivedPaths, manifestPath]) expect(statSync(p).mtimeMs, p).toBe(past.getTime());

    // a derived file damaged on disk is rewritten (and only that one)
    const mixedPath = path.join(root, "mixed", "day2_consultation03.wav");
    const good = readFileSync(mixedPath);
    writeFileSync(mixedPath, Buffer.concat([good.subarray(0, good.length - 2), Buffer.from([0x7f, 0x7f])]));
    const r3 = await run({ ids: IDS, ref: "main", dryRun: false, web }, { fetchImpl: repo().impl, log: quiet, retries: 0, backoffMs: 0 });
    expect(r3).toMatchObject({ downloaded: 0, derivedWritten: 1, derivedUnchanged: 3, manifestWritten: false });
    expect(readFileSync(mixedPath).equals(good)).toBe(true);
    expect((await verifyLocal(m, web)).problems).toEqual([]);
  });

  it("B3: with manifest set, the run writes that file and leaves the committed manifest path alone", async () => {
    const web = freshDir();
    const elsewhere = path.join(web, "out", "selection.json");
    const r = await run({ ids: IDS, ref: "main", dryRun: false, web, manifest: elsewhere }, { fetchImpl: repo().impl, log: quiet, retries: 0, backoffMs: 0 });
    expect(r.manifestWritten).toBe(true);
    expect(JSON.parse(readFileSync(elsewhere, "utf8")).consultations.map((c: { id: string }) => c.id)).toEqual(IDS);
    expect(existsSync(path.join(web, "fixtures", "real", "primock57.manifest.json"))).toBe(false);
  });

  it("stops on a tampered recording and leaves no partial file", async () => {
    const web = freshDir();
    const bad = "audio/day2_consultation03_patient.wav";
    await expect(run({ ids: IDS, ref: "main", dryRun: false, web }, { fetchImpl: repo({ tamper: bad }).impl, log: quiet, retries: 0, backoffMs: 0 })).rejects.toThrow(
      /sha256 .* does not match/,
    );
    const audio = path.join(web, ".data", "real", "primock57", "audio");
    expect(existsSync(path.join(audio, "day2_consultation03_patient.wav"))).toBe(false);
    expect(readdirSync(audio).filter((n) => n.endsWith(".part"))).toEqual([]);
    expect(existsSync(path.join(web, "fixtures", "real", "primock57.manifest.json"))).toBe(false);
  });

  it("dry run reads the pointers and downloads nothing", async () => {
    const web = freshDir();
    const f = repo();
    const r = await run({ ids: IDS, ref: COMMIT, dryRun: true, web }, { fetchImpl: f.impl, log: quiet, retries: 0, backoffMs: 0 });
    expect(r.dryRun).toBe(true);
    expect(r.audioTotal).toBe(Object.values(tracks).reduce((s, b) => s + b.length, 0));
    expect(f.calls.some((c) => c.url.startsWith(MEDIA_BASE) || c.url.startsWith(RAW_BASE))).toBe(false);
    expect(f.calls.some((c) => c.url.includes("/commits/"))).toBe(false); // a 40-hex ref is used as is
    expect(existsSync(path.join(web, ".data"))).toBe(false);
  });
});

describe("verifyLocal", () => {
  it("reports missing, resized, altered and escaping files", async () => {
    const web = freshDir();
    const root = path.join(web, "local");
    mkdirSync(path.join(root, "audio"), { recursive: true });
    const good = Buffer.from("good");
    writeFileSync(path.join(root, "audio", "a.wav"), good);
    writeFileSync(path.join(root, "audio", "b.wav"), "longer than said");
    writeFileSync(path.join(root, "audio", "c.wav"), "same");
    const f = (p: string, b: Buffer | string) => ({ path: p, bytes: Buffer.from(b).length, sha256: sha256Hex(Buffer.from(b)) });
    const manifest = {
      local_root: "local",
      consultations: [
        { files: [f("audio/a.wav", good), f("audio/missing.wav", "x"), { ...f("audio/b.wav", "short"), sha256: sha256Hex(Buffer.from("short")) }, f("audio/c.wav", "diff"), f("../outside.wav", "x")] },
      ],
    };
    const r = await verifyLocal(manifest, web);
    expect(r.problems).toEqual([
      "audio/missing.wav: missing",
      "audio/b.wav: 16 bytes, manifest says 5",
      "audio/c.wav: sha256 differs from the manifest",
      "../outside.wav: outside local",
    ]);
  });
});
