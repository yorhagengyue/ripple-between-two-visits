/**
 * Local blob driver: round trip, signed links (expiry, tampering, wrong operation), WebM refused at
 * every door, removePrefix folder semantics, and the reset wiring. Files go to a temp folder.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as readGET } from "@/app/api/blob/read/route";
import { PUT as uploadPUT } from "@/app/api/blob/upload/route";
import {
  BlobError,
  blobDriver,
  createLocalBlobStore,
  getBlobStore,
  getLocalBlobStore,
  removeSessionBlobs,
  sniffContentType,
  type LocalBlobStore,
} from "@/lib/blob";
import { signToken, verifyToken } from "@/lib/blob/token";
import { resetSession } from "@/lib/session/ops";
import { getMemoryStore } from "@/lib/store/memory";
import { equalBytes, labelPng, wavBytes, webmBytes } from "./fixtures";

const BASE = "http://localhost:3200";
let dir: string;
const savedEnv = { ...process.env };

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ripple-blob-"));
  process.env.BLOB_LOCAL_DIR = dir;
  delete process.env.BLOB_DRIVER;
  delete process.env.BLOB_SIGNING_SECRET;
});

afterAll(() => {
  process.env = savedEnv;
  rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.useRealTimers();
});

const store = (): LocalBlobStore => getLocalBlobStore()!;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (err) {
    if (err instanceof BlobError) return err.code;
    throw err;
  }
}

function put(url: string, body: Uint8Array, contentType: string | null): NextRequest {
  const headers: Record<string, string> = {};
  if (contentType) headers["content-type"] = contentType;
  return new NextRequest(new URL(url, BASE), { method: "PUT", headers, body: Buffer.from(body) });
}

function get(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(url, BASE), { method: "GET", headers });
}

/** Change one character of a base64url string. */
const flip = (s: string, i: number): string => s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);

describe("driver selection", () => {
  it("defaults to local, accepts supabase, refuses anything else", () => {
    expect(blobDriver({})).toBe("local");
    expect(blobDriver({ BLOB_DRIVER: " Local " })).toBe("local");
    expect(blobDriver({ BLOB_DRIVER: "SUPABASE" })).toBe("supabase");
    expect(() => blobDriver({ BLOB_DRIVER: "s3" })).toThrow(BlobError);
    expect(getBlobStore().driver).toBe("local");
  });

  it("supabase without keys is not_configured, and never echoes values", () => {
    try {
      getBlobStore({ BLOB_DRIVER: "supabase", SUPABASE_URL: "https://example.invalid" });
      expect.unreachable();
    } catch (err) {
      expect((err as BlobError).code).toBe("not_configured");
      expect((err as Error).message).not.toContain("example.invalid");
    }
  });

  it("the local routes answer 404 when the driver is supabase", async () => {
    process.env.BLOB_DRIVER = "supabase";
    process.env.SUPABASE_URL = "https://example.invalid";
    process.env.SUPABASE_SERVICE_KEY = "not-a-real-key";
    try {
      expect((await uploadPUT(put("/api/blob/upload?token=x", wavBytes(), "audio/wav"))).status).toBe(404);
      expect((await readGET(get("/api/blob/read?token=x"))).status).toBe(404);
    } finally {
      delete process.env.BLOB_DRIVER;
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_KEY;
    }
  });
});

describe("round trip", () => {
  it("stores and returns WAV and PNG bytes with their content type, under web/.data/blob/<bucket>/<path>", async () => {
    const wav = wavBytes(400);
    await store().putObject("audio", "sess-rt/visits/v1/segments/u1.wav", wav, "audio/wav");
    const got = await store().getObject("audio", "sess-rt/visits/v1/segments/u1.wav");
    expect(got && equalBytes(got.bytes, wav)).toBe(true);
    expect(got?.contentType).toBe("audio/wav");
    expect(existsSync(path.join(dir, "audio", "sess-rt", "visits", "v1", "segments", "u1.wav"))).toBe(true);

    const png = labelPng();
    await store().putObject("labels", "sess-rt/labels/a.png", png, "image/png");
    const label = await store().getObject("labels", "sess-rt/labels/a.png");
    expect(label && equalBytes(label.bytes, png)).toBe(true);
    expect(label?.contentType).toBe("image/png");
  });

  it("overwrites in place and returns null for a missing object", async () => {
    await store().putObject("audio", "sess-rt/x.wav", wavBytes(10), "audio/wav");
    await store().putObject("audio", "sess-rt/x.wav", wavBytes(20), "audio/wav");
    expect((await store().getObject("audio", "sess-rt/x.wav"))?.bytes.byteLength).toBe(44 + 40);
    expect(await store().getObject("audio", "sess-rt/nope.wav")).toBeNull();
  });

  it("refuses bad buckets, paths, types, extensions and bytes", async () => {
    const wav = wavBytes();
    const s = store();
    expect(await code(s.putObject("video" as never, "a/b.wav", wav, "audio/wav"))).toBe("invalid_bucket");
    for (const bad of ["../escape.wav", "a/../b.wav", "/abs.wav", "a\\b.wav", "a//b.wav", "a/.hidden.wav", "", "a/b.wav/"]) {
      expect(await code(s.putObject("audio", bad, wav, "audio/wav")), bad).toBe("invalid_path");
    }
    expect(await code(s.putObject("labels", "a/b.wav", wav, "audio/wav"))).toBe("unsupported_content_type");
    expect(await code(s.putObject("audio", "a/b.png", wav, "audio/wav"))).toBe("content_mismatch");
    expect(await code(s.putObject("audio", "a/b.wav", labelPng(), "audio/wav"))).toBe("content_mismatch");
    expect(await code(s.putObject("labels", "a/b.jpg", labelPng(), "image/jpeg"))).toBe("content_mismatch");
  });

  it("knows the formats by their leading bytes", () => {
    expect(sniffContentType(wavBytes())).toBe("audio/wav");
    expect(sniffContentType(labelPng())).toBe("image/png");
    expect(sniffContentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffContentType(new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")]))).toBe("image/webp");
    expect(sniffContentType(webmBytes())).toBe("audio/webm");
    expect(sniffContentType(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("audio/webm is refused", () => {
  it("as a declared type, with or without codec parameters", async () => {
    for (const ct of ["audio/webm", "audio/webm;codecs=opus", "video/webm", "AUDIO/WEBM"]) {
      expect(await code(store().putObject("audio", "s/a.wav", webmBytes(), ct)), ct).toBe("unsupported_content_type");
      expect(await code(store().signedUploadUrl("audio", "s/a.wav", ct, 60)), ct).toBe("unsupported_content_type");
    }
  });

  it("as bytes behind an audio/wav label", async () => {
    expect(await code(store().putObject("audio", "s/a.wav", webmBytes(), "audio/wav"))).toBe("unsupported_content_type");
  });

  it("at the upload route: a WAV link carrying audio/webm, or WebM bytes sent as audio/wav", async () => {
    const link = await store().signedUploadUrl("audio", "sess-webm/a.wav", "audio/wav", 60);
    const asWebm = await uploadPUT(put(link.url, webmBytes(), "audio/webm"));
    expect(asWebm.status).toBe(415);
    expect((await asWebm.json()).error).toBe("unsupported_content_type");
    const disguised = await uploadPUT(put(link.url, webmBytes(), "audio/wav"));
    expect(disguised.status).toBe(415);
    expect(await store().getObject("audio", "sess-webm/a.wav")).toBeNull();
  });
});

describe("signed links through the local routes", () => {
  it("upload link: PUT the bytes with the given headers, then read them back via a read link (and a range)", async () => {
    const wav = wavBytes(800);
    const link = await store().signedUploadUrl("audio", "sess-link/visits/v2/segments/v2-u08.wav", "audio/wav", 60);
    expect(link.method).toBe("PUT");
    expect(link.url.startsWith("/api/blob/upload?token=")).toBe(true);
    expect(link.headers).toEqual({ "content-type": "audio/wav" });
    expect(Date.parse(link.expiresAt) - Date.now()).toBeLessThanOrEqual(60_000);

    const res = await uploadPUT(put(link.url, wav, link.headers["content-type"]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bucket: "audio", path: "sess-link/visits/v2/segments/v2-u08.wav", bytes: wav.byteLength });

    const readUrl = await store().signedReadUrl("audio", "sess-link/visits/v2/segments/v2-u08.wav", 60);
    expect(readUrl.startsWith("/api/blob/read?token=")).toBe(true);
    const read = await readGET(get(readUrl));
    expect(read.status).toBe(200);
    expect(read.headers.get("content-type")).toBe("audio/wav");
    expect(equalBytes(new Uint8Array(await read.arrayBuffer()), wav)).toBe(true);

    const part = await readGET(get(readUrl, { range: "bytes=0-11" }));
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 0-11/${wav.byteLength}`);
    expect(Buffer.from(await part.arrayBuffer()).toString("latin1")).toBe("RIFF" + Buffer.from(wav.slice(4, 8)).toString("latin1") + "WAVE");
    expect((await readGET(get(readUrl, { range: "bytes=999999-" }))).status).toBe(416);
  });

  it("a read link for a missing object is refused up front", async () => {
    expect(await code(store().signedReadUrl("audio", "sess-link/missing.wav", 60))).toBe("not_found");
  });

  it("an upload link sent with a different allowed type is a mismatch, not a write", async () => {
    const link = await store().signedUploadUrl("labels", "sess-link/labels/p.png", "image/png", 60);
    const res = await uploadPUT(put(link.url, labelPng(), "image/jpeg"));
    expect(res.status).toBe(415);
    expect((await res.json()).error).toBe("content_mismatch");
    expect((await uploadPUT(put(link.url, labelPng(), null))).status).toBe(415);
  });

  it("expired links are refused (403 token_expired), for upload and read", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T08:00:00Z"));
    const up = await store().signedUploadUrl("audio", "sess-exp/a.wav", "audio/wav", 600);
    await store().putObject("audio", "sess-exp/b.wav", wavBytes(), "audio/wav");
    const rd = await store().signedReadUrl("audio", "sess-exp/b.wav", 600);
    vi.setSystemTime(new Date("2026-10-09T08:09:59Z"));
    expect((await readGET(get(rd))).status).toBe(200);
    vi.setSystemTime(new Date("2026-10-09T08:10:00Z"));
    const late = await uploadPUT(put(up.url, wavBytes(), "audio/wav"));
    expect(late.status).toBe(403);
    expect((await late.json()).error).toBe("token_expired");
    const lateRead = await readGET(get(rd));
    expect(lateRead.status).toBe(403);
    expect((await lateRead.json()).error).toBe("token_expired");
    expect(await store().getObject("audio", "sess-exp/a.wav")).toBeNull();
  });

  it("tampered, swapped or missing tokens are refused (403 bad_token)", async () => {
    const a = await store().signedUploadUrl("audio", "sess-tamper/a.wav", "audio/wav", 60);
    const b = await store().signedUploadUrl("audio", "sess-other/b.wav", "audio/wav", 60);
    const tokenA = new URL(a.url, BASE).searchParams.get("token")!;
    const tokenB = new URL(b.url, BASE).searchParams.get("token")!;
    const [bodyA, sigA] = tokenA.split(".");
    const [bodyB] = tokenB.split(".");
    // a payload naming another session's path, with A's signature
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(bodyA, "base64url").toString()), p: "sess-victim/x.wav" })).toString("base64url");
    const attempts = [
      `${flip(bodyA, 5)}.${sigA}`,
      `${bodyA}.${flip(sigA, 3)}`,
      `${bodyB}.${sigA}`,
      `${forged}.${sigA}`,
      `${bodyA}`,
      "",
    ];
    for (const t of attempts) {
      const res = await uploadPUT(put(`/api/blob/upload?token=${encodeURIComponent(t)}`, wavBytes(), "audio/wav"));
      expect(res.status, t).toBe(403);
      expect((await res.json()).error).toBe("bad_token");
    }
    expect(await store().getObject("audio", "sess-victim/x.wav")).toBeNull();

    // an upload token is not a read token, and the other way round
    await store().putObject("audio", "sess-tamper/r.wav", wavBytes(), "audio/wav");
    const readUrl = await store().signedReadUrl("audio", "sess-tamper/r.wav", 60);
    expect((await readGET(get(`/api/blob/read?token=${tokenA}`))).status).toBe(403);
    expect((await uploadPUT(put(readUrl.replace("/api/blob/read", "/api/blob/upload"), wavBytes(), "audio/wav"))).status).toBe(403);
  });

  it("a token signed with another secret is refused", () => {
    const mine = randomBytes(32);
    const theirs = randomBytes(32);
    const token = signToken(theirs, { v: 1, op: "get", b: "audio", p: "s/a.wav", exp: Math.floor(Date.now() / 1000) + 60 });
    expect(() => verifyToken(mine, token, "get")).toThrow(/signature/);
    expect(verifyToken(theirs, token, "get").p).toBe("s/a.wav");
  });

  it("BLOB_SIGNING_SECRET makes links valid across store instances (several processes)", async () => {
    const secretStoreA = createLocalBlobStore({ dir, secret: Buffer.from("shared-test-secret") });
    const secretStoreB = createLocalBlobStore({ dir, secret: Buffer.from("shared-test-secret") });
    const link = await secretStoreA.signedUploadUrl("audio", "sess-shared/a.wav", "audio/wav", 60);
    const saved = await secretStoreB.acceptUpload(new URL(link.url, BASE).searchParams.get("token"), "audio/wav", wavBytes());
    expect(saved.path).toBe("sess-shared/a.wav");
  });
});

// ---- C2 track H: what only the local driver does when it lists (both drivers' shared behaviour: listing.test.ts)
describe("listing on disk", () => {
  it("a half-written upload and a stray file with an unusable name are not listed; an emptied folder leaves no trace", async () => {
    const s = store();
    await s.putObject("audio", "sessL/visits/v1/recording-1.wav", wavBytes(), "audio/wav");
    await s.putObject("audio", "sessL/visits/v1/segments/u1.wav", wavBytes(), "audio/wav");
    // what putObject leaves for a moment while it writes, and a file nobody uploaded through the app
    writeFileSync(path.join(dir, "audio", "sessL", "visits", "v1", ".recording-2.wav.abc123.tmp"), "half");
    writeFileSync(path.join(dir, "audio", "sessL", "visits", "v1", "has space.wav"), "stray");
    mkdirSync(path.join(dir, "audio", ".trash"), { recursive: true });
    expect((await s.listFiles("audio", "sessL")).map((f) => f.path)).toEqual(["sessL/visits/v1/recording-1.wav", "sessL/visits/v1/segments/u1.wav"]);
    expect(await s.listPrefixes("audio")).not.toContain(".trash");
    expect(await s.listPrefixes("audio")).toContain("sessL");

    // the last file of segments/ goes: the folder goes with it; v1/ still holds files, so it stays
    expect(await s.removeObjects("audio", ["sessL/visits/v1/segments/u1.wav"])).toBe(1);
    expect(existsSync(path.join(dir, "audio", "sessL", "visits", "v1", "segments"))).toBe(false);
    expect(existsSync(path.join(dir, "audio", "sessL", "visits", "v1"))).toBe(true);
    expect(await s.removePrefix("audio", "sessL")).toBe(2); // the recording and the stray file; the .tmp is not counted
    expect(existsSync(path.join(dir, "audio", "sessL"))).toBe(false);
    expect(existsSync(path.join(dir, "audio"))).toBe(true);
  });

  it("the last-written time is the file's own, in whole milliseconds", async () => {
    const s = store();
    await s.putObject("labels", "sessL/labels/p.png", labelPng(), "image/png");
    const at = new Date("2026-10-01T08:30:00.000Z");
    utimesSync(path.join(dir, "labels", "sessL", "labels", "p.png"), at, at);
    expect(await s.listFiles("labels", "sessL")).toEqual([{ path: "sessL/labels/p.png", lastModifiedMs: at.getTime() }]);
    expect(await s.removePrefix("labels", "sessL")).toBe(1);
  });
});

describe("removePrefix", () => {
  it("removes everything under <prefix>/ at any depth, and nothing that merely starts with the same letters", async () => {
    const s = store();
    await s.putObject("audio", "sessA/visits/v1/recording-1.wav", wavBytes(), "audio/wav");
    await s.putObject("audio", "sessA/visits/v1/segments/u1.wav", wavBytes(), "audio/wav");
    await s.putObject("audio", "sessA/reminders/r.wav", wavBytes(), "audio/wav");
    await s.putObject("audio", "sessAB/visits/v1/segments/u1.wav", wavBytes(), "audio/wav");
    await s.putObject("labels", "sessA/labels/p.png", labelPng(), "image/png");

    expect(await s.removePrefix("audio", "sessA")).toBe(3);
    expect(await s.getObject("audio", "sessA/visits/v1/recording-1.wav")).toBeNull();
    expect(await s.getObject("audio", "sessA/reminders/r.wav")).toBeNull();
    expect(await s.getObject("audio", "sessAB/visits/v1/segments/u1.wav")).not.toBeNull();
    expect(await s.getObject("labels", "sessA/labels/p.png")).not.toBeNull(); // other bucket untouched

    expect(await s.removePrefix("labels", "sessA/")).toBe(1);
    expect(await s.removePrefix("audio", "sessA")).toBe(0);
    expect(await s.removePrefix("audio", "never-existed")).toBe(0);
  });

  it("refuses empty, absolute and parent prefixes", async () => {
    for (const bad of ["", "/", "..", "../sessAB", "/sessAB", "a\\b"]) {
      expect(await code(store().removePrefix("audio", bad)), bad).toBe("invalid_path");
    }
    expect(await store().getObject("audio", "sessAB/visits/v1/segments/u1.wav")).not.toBeNull();
  });

  it("removeSessionBlobs clears both buckets of one session", async () => {
    await store().putObject("audio", "sessC/a.wav", wavBytes(), "audio/wav");
    await store().putObject("labels", "sessC/labels/p.png", labelPng(), "image/png");
    expect(await removeSessionBlobs("sessC")).toEqual({ audio: 1, labels: 1 });
  });

  it("resetting a session deletes its recordings and photos, not another session's", async () => {
    const memory = getMemoryStore();
    const mine = await memory.createSession({ ttl_hours: 1 });
    const other = await memory.createSession({ ttl_hours: 1 });
    await store().putObject("audio", `${mine.id}/visits/v1/recording-1.wav`, wavBytes(), "audio/wav");
    await store().putObject("labels", `${mine.id}/labels/p.png`, labelPng(), "image/png");
    await store().putObject("labels", `${other.id}/labels/p.png`, labelPng(), "image/png");
    await resetSession(getMemoryStore(), mine.id);
    expect(await store().getObject("audio", `${mine.id}/visits/v1/recording-1.wav`)).toBeNull();
    expect(await store().getObject("labels", `${mine.id}/labels/p.png`)).toBeNull();
    expect(await store().getObject("labels", `${other.id}/labels/p.png`)).not.toBeNull();
    expect(existsSync(path.join(dir, "audio", mine.id))).toBe(false);
  });
});
