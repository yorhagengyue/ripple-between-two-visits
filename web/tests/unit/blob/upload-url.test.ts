/**
 * POST /api/upload-url (spec section 2): the server picks bucket and path under the session, refuses
 * WebM and any type outside the bucket's list, and the returned link really takes the upload.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PUT as uploadPUT } from "@/app/api/blob/upload/route";
import { POST as uploadUrlPOST } from "@/app/api/upload-url/route";
import { getBlobStore, pathInSession, planUpload, uploadUrlBody } from "@/lib/blob";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { equalBytes, labelPng, wavBytes, webmBytes } from "./fixtures";

const BASE = "http://localhost:3200";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
let dir: string;
let session: SessionRow;
const savedEnv = { ...process.env };

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "ripple-upload-url-"));
  process.env.BLOB_LOCAL_DIR = dir;
  delete process.env.BLOB_DRIVER;
  session = await getMemoryStore().createSession({ ttl_hours: 1 });
});

afterAll(() => {
  process.env = savedEnv;
  rmSync(dir, { recursive: true, force: true });
});

function ask(body: unknown, sessionId: string | null = session.id): NextRequest {
  const q = sessionId ? `?session=${sessionId}` : "";
  return new NextRequest(`${BASE}/api/upload-url${q}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/upload-url", () => {
  it("needs a session", async () => {
    expect((await uploadUrlPOST(ask({ kind: "label", content_type: "image/png" }, null))).status).toBe(400);
    expect((await uploadUrlPOST(ask({ kind: "label", content_type: "image/png" }, "no-such-session"))).status).toBe(404);
  });

  it("label photo: labels bucket, path under the session, link that takes the PNG", async () => {
    const res = await uploadUrlPOST(ask({ kind: "label", content_type: "image/png" }));
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.bucket).toBe("labels");
    expect(out.path).toMatch(new RegExp(`^${session.id}/labels/${UUID}\\.png$`));
    expect(out.method).toBe("PUT");
    expect(out.headers).toEqual({ "content-type": "image/png" });
    expect(out.max_bytes).toBe(10 * 1024 * 1024);
    expect(Date.parse(out.expires_at)).toBeGreaterThan(Date.now());

    const png = labelPng();
    const up = await uploadPUT(
      new NextRequest(new URL(out.url, BASE), { method: "PUT", headers: out.headers, body: Buffer.from(png) }),
    );
    expect(up.status).toBe(200);
    const stored = await getBlobStore().getObject("labels", out.path);
    expect(stored && equalBytes(stored.bytes, png)).toBe(true);
  });

  it("jpeg and webp labels get their own extension", async () => {
    const jpg = await (await uploadUrlPOST(ask({ kind: "label", content_type: "image/jpeg" }))).json();
    expect(jpg.path).toMatch(/\.jpg$/);
    const webp = await (await uploadUrlPOST(ask({ kind: "label", content_type: "image/webp" }))).json();
    expect(webp.path).toMatch(/\.webp$/);
  });

  it("segment, recording and reminder: audio bucket, audio/wav, paths per visit", async () => {
    const seg = await (await uploadUrlPOST(ask({ kind: "segment", content_type: "audio/wav", visit_id: "v2", utterance_id: "v2-u08" }))).json();
    expect(seg).toMatchObject({ bucket: "audio", path: `${session.id}/visits/v2/segments/v2-u08.wav` });
    expect(seg.max_bytes).toBe(50 * 1024 * 1024);
    const seg2 = await (await uploadUrlPOST(ask({ kind: "segment", content_type: "audio/wav", visit_id: "v2" }))).json();
    expect(seg2.path).toMatch(new RegExp(`^${session.id}/visits/v2/segments/${UUID}\\.wav$`));
    const rec = await (await uploadUrlPOST(ask({ kind: "recording", content_type: "audio/wav", visit_id: "v1" }))).json();
    expect(rec.path).toMatch(new RegExp(`^${session.id}/visits/v1/recording-${UUID}\\.wav$`));
    const rem = await (await uploadUrlPOST(ask({ kind: "reminder", content_type: "audio/wav" }))).json();
    expect(rem.path).toMatch(new RegExp(`^${session.id}/reminders/${UUID}\\.wav$`));

    const wav = wavBytes();
    const up = await uploadPUT(new NextRequest(new URL(rec.url, BASE), { method: "PUT", headers: rec.headers, body: Buffer.from(wav) }));
    expect(up.status).toBe(200);
    // the same link refuses WebM bytes
    const bad = await uploadPUT(new NextRequest(new URL(seg.url, BASE), { method: "PUT", headers: seg.headers, body: Buffer.from(webmBytes()) }));
    expect(bad.status).toBe(415);
  });

  it("refuses audio/webm (415) for every audio kind, with or without codecs", async () => {
    for (const kind of ["segment", "recording", "reminder"]) {
      for (const ct of ["audio/webm", "audio/webm;codecs=opus", "video/webm", "audio/ogg", "audio/mpeg", "audio/x-wav"]) {
        const res = await uploadUrlPOST(ask({ kind, content_type: ct, visit_id: "v1" }));
        expect(res.status, `${kind} ${ct}`).toBe(415);
        expect((await res.json()).error).toBe("unsupported_content_type");
      }
    }
  });

  it("refuses types outside each bucket's list (415)", async () => {
    expect((await uploadUrlPOST(ask({ kind: "label", content_type: "audio/wav" }))).status).toBe(415);
    expect((await uploadUrlPOST(ask({ kind: "label", content_type: "image/gif" }))).status).toBe(415);
    expect((await uploadUrlPOST(ask({ kind: "label", content_type: "image/svg+xml" }))).status).toBe(415);
    expect((await uploadUrlPOST(ask({ kind: "recording", content_type: "image/png", visit_id: "v1" }))).status).toBe(415);
  });

  it("needs a real visit for segment and recording; the browser cannot name the path", async () => {
    const noVisit = await uploadUrlPOST(ask({ kind: "recording", content_type: "audio/wav" }));
    expect(noVisit.status).toBe(400);
    const unknown = await uploadUrlPOST(ask({ kind: "segment", content_type: "audio/wav", visit_id: "v99" }));
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error).toBe("visit_not_found");
    expect((await uploadUrlPOST(ask({ kind: "label", content_type: "image/png", path: "other/x.png" }))).status).toBe(400);
    expect((await uploadUrlPOST(ask({ kind: "segment", content_type: "audio/wav", visit_id: "../v1" }))).status).toBe(400);
    expect((await uploadUrlPOST(ask({ kind: "label", content_type: "image/png", utterance_id: "u1" }))).status).toBe(400);
    expect((await uploadUrlPOST(ask({ kind: "video", content_type: "audio/wav" }))).status).toBe(400);
  });
});

describe("planUpload and pathInSession", () => {
  it("every planned path starts with the session id", () => {
    for (const kind of ["segment", "recording", "reminder"] as const) {
      const plan = planUpload("s1", uploadUrlBody.parse({ kind, content_type: "audio/wav", visit_id: "v1" }));
      expect(plan.path.startsWith("s1/")).toBe(true);
      expect(pathInSession("s1", plan.path)).toBe(true);
      expect(pathInSession("s", plan.path)).toBe(false);
    }
    expect(pathInSession("s1", "s1/../s2/x.wav")).toBe(false);
    expect(pathInSession("s1", "s2/x.wav")).toBe(false);
  });
});
