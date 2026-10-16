/**
 * The guards for real accounts (C2 F1, item G; real-app H1, H2, H4, H5): an account's responses, links and events never
 * carry its scope id; its upload paths use an opaque prefix; the demo's operations answer 404; the browser's sentences
 * never become a visit record (extract 404); and her reads through a care link write nothing of his.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as briefGet } from "@/app/api/brief/route";
import { POST as clockPost } from "@/app/api/clock/route";
import { POST as cuePost } from "@/app/api/director/cue/route";
import { GET as dosesGet, POST as dosesPost } from "@/app/api/doses/route";
import { GET as eventsGet } from "@/app/api/events/route";
import { GET as familyViewGet } from "@/app/api/family/view/route";
import { GET as medsGet } from "@/app/api/meds/route";
import { GET as notesGet, POST as notesPost } from "@/app/api/notes/route";
import { GET as remindersGet } from "@/app/api/reminders/route";
import { POST as resetPost } from "@/app/api/session/reset/route";
import { GET as sessionGet } from "@/app/api/session/route";
import { POST as uploadPost } from "@/app/api/upload-url/route";
import { POST as extractPost } from "@/app/api/visits/[id]/extract/route";
import { GET as visitGet } from "@/app/api/visits/[id]/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { blobPrefix } from "@/lib/blob";
import { publish } from "@/lib/bus";
import { getMemoryStore } from "@/lib/store/memory";
import { agreedLink } from "../../support/agreed-link";

const store = getMemoryStore();
const decoder = new TextDecoder();
const savedEnv = { ...process.env };
let blobDir: string;
let him: TestAccount;

beforeAll(async () => {
  blobDir = mkdtempSync(path.join(tmpdir(), "ripple-guards-"));
  process.env.BLOB_LOCAL_DIR = blobDir;
  delete process.env.BLOB_DRIVER;
  him = await createAccountWithSpace(store, getAuthProvider(), { login: `t${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
});
afterAll(() => {
  process.env = savedEnv;
  rmSync(blobDir, { recursive: true, force: true });
});

function req(p: string, opts: { token?: string; body?: unknown; method?: string; cookies?: Record<string, string>; signal?: AbortSignal } = {}): NextRequest {
  const jar = { ...(opts.cookies ?? {}), ...(opts.token ? { rp_at: opts.token } : {}) };
  const cookie = Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("an account's responses carry no scope id", () => {
  it("the everyday reads and writes answer him without his id anywhere", async () => {
    const t = him.tokens.access_token;
    const responses = [
      await dosesGet(req("/api/doses", { token: t })),
      await dosesPost(req("/api/doses", { token: t, body: { medication_id: "med-amlodipine", slot: "morning", state: "taken" } })),
      await notesGet(req("/api/notes", { token: t })),
      await notesPost(req("/api/notes", { token: t, body: { text: "a little tired today" } })),
      await medsGet(req("/api/meds", { token: t })),
      await remindersGet(req("/api/reminders", { token: t })),
      await briefGet(req("/api/brief", { token: t })),
      await visitGet(req("/api/visits/v1", { token: t }), params("v1")),
    ];
    for (const r of responses) {
      const text = await r.text();
      expect(r.status, text.slice(0, 200)).toBeLessThan(300);
      expect(text, text.slice(0, 200)).not.toContain(him.userId);
    }
  });

  it("an upload path and link use the account's opaque prefix, never its id", async () => {
    const r = await uploadPost(req("/api/upload-url", { token: him.tokens.access_token, body: { kind: "label", content_type: "image/png" } }));
    const text = await r.text();
    expect(r.status, text).toBe(200);
    expect(text).not.toContain(him.userId);
    const prefix = blobPrefix({ id: him.userId, kind: "account" });
    expect(prefix).toMatch(/^a[0-9a-f]{31}$/);
    expect((JSON.parse(text) as { path: string }).path.startsWith(`${prefix}/labels/`)).toBe(true);
    // a demo session's prefix is its id, as before
    expect(blobPrefix({ id: "demo-x", kind: "sandbox" })).toBe("demo-x");
  });

  it("his event stream: no id on the connected line, no say, no session id, and none of the demo's clock events (H4)", async () => {
    const abort = new AbortController();
    const res = await eventsGet(req("/api/events", { token: him.tokens.access_token, signal: abort.signal }));
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    let text = decoder.decode((await reader.read()).value);
    expect(text).toContain(": connected\n");
    expect(text).not.toContain(him.userId);
    publish(him.userId, "clock.changed", "Story clock moved", { session: { id: him.userId } });
    const ev = publish(him.userId, "note.logged", `Noted for Day 42: "his words" (${him.userId})`, { note: { session_id: him.userId, text: "his words" } });
    while (!text.includes(`id: ${ev.id}`)) text += decoder.decode((await reader.read()).value);
    abort.abort();
    expect(text).not.toContain(him.userId);
    expect(text).not.toContain("clock.changed");
    const frame = JSON.parse(text.split("\n").filter((l) => l.startsWith("data: ")).at(-1)!.slice(6));
    expect(frame).toMatchObject({ type: "note.logged", session_id: "", say: "" });
  });
});

describe("the demo's operations are not an account's (H2, H5)", () => {
  it("the story clock, the director's cue, a reset and the session row answer 404, with or without the crew cookie", async () => {
    const t = him.tokens.access_token;
    for (const cookies of [{}, { rp_crew: "anything" }] as Record<string, string>[]) {
      const rs = [
        await clockPost(req("/api/clock", { token: t, cookies, body: { day: 3 } })),
        await cuePost(req("/api/director/cue", { token: t, cookies, body: { cue: "reminder" } })),
        await resetPost(req("/api/session/reset", { token: t, cookies, body: {} })),
        await sessionGet(req("/api/session", { token: t, cookies })),
      ];
      for (const r of rs) expect(await r.json()).toEqual({ error: "not_found" });
      expect(rs.map((r) => r.status)).toEqual([404, 404, 404, 404]);
    }
    // his story clock did not move
    expect((await store.getSession(him.userId))!.story_day).toBe(42);
  });

  it("POST /api/visits/[id]/extract: sentences from the browser never become an account's visit record", async () => {
    const r = await extractPost(req("/api/visits/v3/extract", { token: him.tokens.access_token, body: { utterances: [{ t_start_ms: 0, t_end_ms: 1000, text: "Doctor: take two tablets" }] } }), params("v3"));
    expect(r.status).toBe(404);
    expect(await store.listUtterances(him.userId, "v3")).toEqual([]);
  });
});

describe("her reads through a care link write nothing of his", () => {
  it("GET /api/family/view?link= settles no 'no reply' and adds no row", async () => {
    const dad = await createAccountWithSpace(store, getAuthProvider(), { login: `d${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
    const her = await createAccountWithSpace(store, getAuthProvider(), { login: `w${randomUUID().slice(0, 10)}`, password: "a long test password", space: "none" });
    const hash = `h-${randomUUID()}`;
    const inv = await store.createInvite({ patient_id: dad.userId, invite_token_hash: hash, invite_expires_at: "2099-01-01T00:00:00.000Z" }, { dose_summary: true, no_reply_alert: true });
    const linkId = inv.ok ? inv.link.id : "";
    await store.acceptInvite(hash, her.userId, "Wei Ling");
    await store.confirmLink(linkId, dad.userId, true);
    // the two records an invitation he confirmed carries (without them her view is the alert-only form: lib/care/reconsent.ts)
    await agreedLink(store, { id: linkId, patient_id: dad.userId, family_id: her.userId });
    const before = await store.listDoses(dad.userId);
    const r = await familyViewGet(req(`/api/family/view?link=${linkId}`, { token: her.tokens.access_token }));
    const text = await r.text();
    expect(r.status, text).toBe(200);
    expect(text).not.toContain(dad.userId);
    expect((JSON.parse(text) as { grants: { dose_summary: boolean; notes: boolean } }).grants).toMatchObject({ dose_summary: true, notes: false });
    expect(await store.listDoses(dad.userId)).toEqual(before);
  });
});
