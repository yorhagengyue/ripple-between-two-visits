/**
 * Upload links on the running server (spec section 2, POST /api/upload-url): the browser-side PUT goes
 * straight to the signed link, WebM is refused, and a session reset deletes the session's files.
 * With BLOB_DRIVER=local (the default) the files sit under web/.data/blob/<bucket>/<path>.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { api, createSession, CREW_HEADERS } from "./helpers";

// C2 (lib/crew/gate.ts): the story clock and reset are the film crew's; this file's request fixture carries the crew key
test.use({ extraHTTPHeaders: CREW_HEADERS });

const LABEL_PNG = path.join(__dirname, "..", "fixtures", "labels", "amlodipine.png");

function wav(samples = 160): Buffer {
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write("WAVEfmt ", 8, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(16_000, 24);
  buf.writeUInt32LE(32_000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(samples * 2, 40);
  return buf;
}

const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01]);

// the same folder the server uses (lib/blob localBlobDir): BLOB_LOCAL_DIR when the run sets it (test files outside
// the repo), else web/.data/blob
const localFile = (bucket: string, objectPath: string) =>
  path.join(process.env.BLOB_LOCAL_DIR?.trim() ? path.resolve(process.env.BLOB_LOCAL_DIR.trim()) : path.join(__dirname, "..", ".data", "blob"), bucket, ...objectPath.split("/"));

test("label photo and visit recording upload through signed links; WebM refused; reset deletes them", async ({ request }) => {
  const s = await createSession(request);

  const labelLink = await (await request.post(`/api/upload-url?session=${s.id}`, { data: { kind: "label", content_type: "image/png" } })).json();
  expect(labelLink.bucket).toBe("labels");
  expect(labelLink.path.startsWith(`${s.id}/labels/`)).toBe(true);
  const png = readFileSync(LABEL_PNG);
  const putLabel = await request.fetch(labelLink.url, { method: labelLink.method, headers: labelLink.headers, data: png });
  expect(putLabel.status()).toBe(200);

  const recLink = await (
    await request.post(`/api/upload-url?session=${s.id}`, { data: { kind: "recording", content_type: "audio/wav", visit_id: "v2" } })
  ).json();
  expect(recLink.bucket).toBe("audio");
  const putRec = await request.fetch(recLink.url, { method: recLink.method, headers: recLink.headers, data: wav() });
  expect(putRec.status()).toBe(200);

  // WebM: refused when asking for a link, and refused when sent down a WAV link
  const webmLink = await request.post(`/api/upload-url?session=${s.id}`, {
    data: { kind: "recording", content_type: "audio/webm;codecs=opus", visit_id: "v2" },
  });
  expect(webmLink.status()).toBe(415);
  const disguised = await request.fetch(recLink.url, { method: "PUT", headers: { "content-type": "audio/wav" }, data: WEBM });
  expect(disguised.status()).toBe(415);
  const relabelled = await request.fetch(recLink.url, { method: "PUT", headers: { "content-type": "audio/webm" }, data: WEBM });
  expect(relabelled.status()).toBe(415);

  const local = String(labelLink.url).startsWith("/api/blob/upload");
  if (local) {
    expect(existsSync(localFile("labels", labelLink.path))).toBe(true);
    expect(readFileSync(localFile("audio", recLink.path)).subarray(0, 4).toString("ascii")).toBe("RIFF");
  }

  await api(request, "/api/session/reset", s.id);
  if (local) {
    expect(existsSync(localFile("labels", labelLink.path))).toBe(false);
    expect(existsSync(localFile("audio", recLink.path))).toBe(false);
  }
});
