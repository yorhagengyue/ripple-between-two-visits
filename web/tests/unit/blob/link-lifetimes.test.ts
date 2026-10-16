/**
 * How long a signed link lives (C2 track H; docs/plan/real-app.md 3.9 「浏览器只拿服务端签的 10 分钟链接」, 3.11 导出: the
 * files inside his export carry 24-hour links):
 *   - the constants: uploads and reads 10 minutes, the export 24 hours, and nothing can ask for more than 24 hours
 *   - both drivers sign a read link for exactly the seconds asked: the local one stops at 10 minutes, the Supabase one
 *     asks Storage for 600 s (and 86400 s for the export, never more)
 *   - uploads: the local driver's link stops at 10 minutes; Supabase Storage fixes its upload links at 2 hours and takes
 *     no lifetime, which the driver reports truthfully in expiresAt (the one place the 10 minutes cannot be met)
 *   - every call site in app/, components/ and lib/ passes a named lifetime; the two that hand a link to the
 *     transcription service (not to a browser) are listed with their reason. A new call with its own number fails here.
 *   - GET /api/me/export/recording hands his player a fresh 10-minute link for every play
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as readGET } from "@/app/api/blob/read/route";
import { GET as recordingGET } from "@/app/api/me/export/recording/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import {
  MAX_LINK_SECONDS,
  READ_LINK_SECONDS,
  SUPABASE_UPLOAD_LINK_SECONDS,
  UPLOAD_LINK_SECONDS,
  blobPrefix,
  createLocalBlobStore,
  createSupabaseBlobStore,
  getBlobStore,
} from "@/lib/blob";
import { clampExpiry } from "@/lib/blob/validate";
import { recordingListenPath } from "@/lib/privacy/links";
import { EXPORT_LINK_SECONDS } from "@/lib/privacy/rules";
import { getMemoryStore } from "@/lib/store/memory";
import { FAKE_STORAGE_URL, FakeStorage } from "./fake-storage";
import { wavBytes } from "./fixtures";

const WEB = fileURLToPath(new URL("../../../", import.meta.url));
const savedEnv = { ...process.env };
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ripple-h-links-"));
  process.env.BLOB_LOCAL_DIR = dir;
  delete process.env.BLOB_DRIVER;
  delete process.env.BLOB_SIGNING_SECRET;
});
afterAll(() => {
  process.env = savedEnv;
  rmSync(dir, { recursive: true, force: true });
});

describe("the lifetimes", () => {
  it("uploads and reads 10 minutes, the export 24 hours, and never more than that", () => {
    expect(UPLOAD_LINK_SECONDS).toBe(600);
    expect(READ_LINK_SECONDS).toBe(600);
    expect(EXPORT_LINK_SECONDS).toBe(24 * 3600);
    expect(MAX_LINK_SECONDS).toBe(EXPORT_LINK_SECONDS);
    expect(clampExpiry(READ_LINK_SECONDS)).toBe(600);
    expect(clampExpiry(EXPORT_LINK_SECONDS)).toBe(86_400);
    expect(clampExpiry(7 * 24 * 3600)).toBe(86_400);
    expect(clampExpiry(0)).toBe(1);
    expect(() => clampExpiry(Number.NaN)).toThrow();
  });
});

describe("the local driver", () => {
  it("a read link works for 10 minutes and not a second longer; an upload link the same", async () => {
    let now = Date.parse("2026-10-10T03:00:00.000Z");
    const store = createLocalBlobStore({ dir, secret: Buffer.from("test-secret"), now: () => now });
    await store.putObject("audio", "links/visits/v1/recording-1.wav", wavBytes(), "audio/wav");
    const read = await store.signedReadUrl("audio", "links/visits/v1/recording-1.wav", READ_LINK_SECONDS);
    const token = new URL(read, "http://localhost").searchParams.get("token");
    const upload = await store.signedUploadUrl("audio", "links/visits/v1/recording-2.wav", "audio/wav", UPLOAD_LINK_SECONDS);
    expect(upload.expiresAt).toBe("2026-10-10T03:10:00.000Z");
    const upToken = new URL(upload.url, "http://localhost").searchParams.get("token");

    now += 599_000;
    expect(store.readToken(token)).toEqual({ bucket: "audio", path: "links/visits/v1/recording-1.wav" });
    await expect(store.acceptUpload(upToken, "audio/wav", wavBytes())).resolves.toMatchObject({ path: "links/visits/v1/recording-2.wav" });
    now += 2_000; // 10 minutes and a second after signing
    expect(() => store.readToken(token)).toThrow(/expired/i);
    await expect(store.acceptUpload(upToken, "audio/wav", wavBytes())).rejects.toMatchObject({ code: "token_expired" });

    // asking for a week gives a day at most
    const long = await store.signedReadUrl("audio", "links/visits/v1/recording-1.wav", 7 * 24 * 3600);
    const longToken = new URL(long, "http://localhost").searchParams.get("token");
    now += 24 * 3600 * 1000 - 1000;
    expect(store.readToken(longToken)).toMatchObject({ bucket: "audio" });
    now += 2_000;
    expect(() => store.readToken(longToken)).toThrow(/expired/i);
  });
});

describe("the Supabase driver", () => {
  it("asks Storage to sign a read link for the seconds given: 600 for a page, 86400 for the export, never more", async () => {
    const storage = new FakeStorage();
    const store = createSupabaseBlobStore({ url: FAKE_STORAGE_URL, serviceKey: "k", fetch: storage.fetch, now: () => Date.parse("2026-10-10T03:00:00.000Z") });
    await store.putObject("audio", "links/a.wav", wavBytes(), "audio/wav");
    const asked = async (seconds: number) => {
      storage.calls.length = 0;
      await store.signedReadUrl("audio", "links/a.wav", seconds);
      return (storage.calls.find((c) => c.path.startsWith("/object/sign/"))!.body as { expiresIn: number }).expiresIn;
    };
    expect(await asked(READ_LINK_SECONDS)).toBe(600);
    expect(await asked(EXPORT_LINK_SECONDS)).toBe(86_400);
    expect(await asked(7 * 24 * 3600)).toBe(86_400);
  });

  it("an upload link's lifetime is Storage's own (2 hours, no lifetime can be sent): the driver says so, it does not pretend 10 minutes", async () => {
    const storage = new FakeStorage();
    const store = createSupabaseBlobStore({ url: FAKE_STORAGE_URL, serviceKey: "k", fetch: storage.fetch, now: () => Date.parse("2026-10-10T03:00:00.000Z") });
    const link = await store.signedUploadUrl("audio", "links/b.wav", "audio/wav", UPLOAD_LINK_SECONDS);
    expect(SUPABASE_UPLOAD_LINK_SECONDS).toBe(7200);
    expect(link.expiresAt).toBe("2026-10-10T05:00:00.000Z");
    const call = storage.calls.find((c) => c.path.startsWith("/object/upload/sign/"))!;
    expect(call.body).toBeUndefined(); // the sign-upload endpoint takes no body: there is no lifetime to ask for
  });
});

/** A call site that hands a link to something other than a browser, with the reason it is not one of the named lifetimes. */
const NOT_FOR_A_BROWSER: Record<string, string> = {
  "lib/asr/pending.ts": "the recording's link goes to the transcription service (server to server), which may fetch it minutes into a long queue",
  "app/api/asr/jobs/route.ts": "the recording's link goes to the transcription service (server to server), which may fetch it minutes into a long queue",
};
const NAMED = /^(READ_LINK_SECONDS|UPLOAD_LINK_SECONDS|EXPORT_LINK_SECONDS)$/;

function sources(d: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(d)) {
    const p = path.join(d, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** The last argument of each signedReadUrl( / signedUploadUrl( call in a source text. */
function lifetimes(src: string): string[] {
  const out: string[] = [];
  const re = /\.(signedReadUrl|signedUploadUrl)\(/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 1;
    let i = re.lastIndex;
    let last = "";
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i];
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") depth--;
      if (depth === 0) break;
      if (ch === "," && depth === 1) last = "";
      else last += ch;
    }
    out.push(last.trim());
  }
  return out;
}

describe("every place that signs a link", () => {
  it("passes a named lifetime (10 minutes, or the export's 24 hours); the two server-to-server links are the listed exceptions", () => {
    const files = ["app", "components", "lib"].flatMap((r) => sources(path.join(WEB, r)));
    expect(files.length).toBeGreaterThan(400);
    const seen: string[] = [];
    const offenders: string[] = [];
    for (const f of files) {
      const rel = path.relative(WEB, f).split(path.sep).join("/");
      if (rel.startsWith("lib/blob/")) continue; // the drivers themselves
      const found = lifetimes(readFileSync(f, "utf8"));
      if (!found.length) continue;
      seen.push(rel);
      for (const arg of found) {
        if (NAMED.test(arg)) continue;
        if (rel in NOT_FOR_A_BROWSER && arg === "3600") continue;
        offenders.push(`${rel}: ${arg}`);
      }
    }
    expect(offenders, "a signed link's lifetime must be READ_LINK_SECONDS, UPLOAD_LINK_SECONDS or EXPORT_LINK_SECONDS").toEqual([]);
    // the scan really reads the call sites
    for (const must of ["app/api/upload-url/route.ts", "lib/privacy/export.ts", "components/visit/elder/pages.tsx", "app/p/me/export/recordings/page.tsx", "app/api/me/export/recording/route.ts", ...Object.keys(NOT_FOR_A_BROWSER)]) {
      expect(seen, must).toContain(must);
    }
    expect(lifetimes('x.signedReadUrl("audio", f(a, b), 3600).catch(() => null)')).toEqual(["3600"]);
    expect(lifetimes("await blob.signedUploadUrl(plan.bucket, plan.path, plan.contentType, UPLOAD_LINK_SECONDS);")).toEqual(["UPLOAD_LINK_SECONDS"]);
  });
});

describe("GET /api/me/export/recording", () => {
  const login = () => `l${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const req = (p: string, token?: string) => new NextRequest(`http://localhost:3590${p}`, { headers: token ? { cookie: `rp_at=${token}` } : {} });

  it("redirects his player to a fresh 10-minute link to his own recording; nobody else's, no stand-in, 404 once the file is gone", async () => {
    const store = getMemoryStore();
    const him = await createAccountWithSpace(store, getAuthProvider(), { login: login(), password: "a long test password", space: "blank" });
    const other = await createAccountWithSpace(store, getAuthProvider(), { login: login(), password: "a long test password", space: "blank" });
    const scope = him.scope!;
    const recording = `${blobPrefix(scope)}/visits/v-1/recording-${randomUUID()}.wav`;
    await getBlobStore().putObject("audio", recording, wavBytes(800), "audio/wav");
    await store.upsertVisit(scope.id, { id: "v-1", kind: "follow_up", place: "", day: 0, status: "review", audio_path: recording });
    await store.upsertVisit(scope.id, { id: "v-2", kind: "follow_up", place: "", day: 0, status: "review", audio_path: "visits/clips/v1-u08.wav" });

    expect(recordingListenPath("v-1")).toBe("/api/me/export/recording?visit=v-1");
    const t0 = Date.now();
    const res = await recordingGET(req(recordingListenPath("v-1"), him.tokens.access_token));
    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const location = new URL(res.headers.get("location")!);
    expect(location.origin).toBe("http://localhost:3590");
    expect(location.pathname).toBe("/api/blob/read");
    // the link is for this file and stops in 10 minutes
    const payload = JSON.parse(Buffer.from(location.searchParams.get("token")!.split(".")[0], "base64url").toString("utf8")) as { op: string; p: string; exp: number };
    expect(payload).toMatchObject({ op: "get", p: recording });
    expect(payload.exp * 1000 - t0).toBeGreaterThan(598_000);
    expect(payload.exp * 1000 - t0).toBeLessThanOrEqual(601_000);
    const played = await readGET(new NextRequest(location));
    expect(played.status).toBe(200);
    expect(played.headers.get("content-type")).toBe("audio/wav");

    // signed out, another person, a visit that is not his, a stand-in clip, no visit named
    expect((await recordingGET(req(recordingListenPath("v-1")))).status).toBe(401);
    expect((await recordingGET(req(recordingListenPath("v-1"), other.tokens.access_token))).status).toBe(404);
    expect((await recordingGET(req(recordingListenPath("v-2"), him.tokens.access_token))).status).toBe(404);
    expect((await recordingGET(req(recordingListenPath("nope"), him.tokens.access_token))).status).toBe(404);
    expect((await recordingGET(req("/api/me/export/recording", him.tokens.access_token))).status).toBe(404);
    // the file is gone (its 90 days passed): 404, not a link to nothing
    await getBlobStore().removeObjects("audio", [recording]);
    const gone = await recordingGET(req(recordingListenPath("v-1"), him.tokens.access_token));
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ error: "no_recording" });
  });
});
