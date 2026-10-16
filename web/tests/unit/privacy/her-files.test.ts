/**
 * Her recordings carry her tag in the file name (docs/plan/real-app.md 3.10 「录提醒：文件存在他的前缀下，文件名带她的用户编号前缀」,
 * 6.14 「pathInSession 改成 pathOwnedBy(subject, path)」; C2 track H), through the real routes on the memory store, the
 * memory identity provider and the local blob driver in a temporary folder:
 *   - POST /api/upload-url?link= gives her a path in his reminders folder whose file name starts with her tag: a
 *     one-way stand-in, never her user id, and not her own folder's name; his own uploads carry no tag
 *   - through her link only a file she uploaded herself can be registered
 *   - pathOwnedBy: his side owns everything under his prefix; her side only her own reminder recordings
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as acceptPost } from "@/app/api/family/invites/accept/route";
import { POST as invitePost } from "@/app/api/family/invites/route";
import { POST as confirmPost } from "@/app/api/family/links/[id]/confirm/route";
import { POST as remindersPost } from "@/app/api/reminders/route";
import { POST as uploadUrlPost } from "@/app/api/upload-url/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { blobPrefix, blobUserTag, getBlobStore, pathOwnedBy, planUpload, reminderFileOf } from "@/lib/blob";
import { getMemoryStore } from "@/lib/store/memory";
import { encodeWav } from "@/lib/visit/wav";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const store = getMemoryStore();
const savedEnv = { ...process.env };
let blobDir: string;
let him: TestAccount;
let her: TestAccount;
let linkId: string;

const login = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 10)}`;
function req(p: string, opts: { token?: string; body?: unknown } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.token) headers.cookie = `rp_at=${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, { method: opts.body === undefined ? "GET" : "POST", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}
const sound = () => encodeWav(new Float32Array(16000).map((_, i) => Math.sin(i / 8) * 0.3), 16000);

beforeAll(async () => {
  blobDir = mkdtempSync(path.join(tmpdir(), "ripple-h-herfiles-"));
  process.env.BLOB_LOCAL_DIR = blobDir;
  delete process.env.BLOB_DRIVER;
  process.env.SPEECH_PROVIDER = "devfake";
  him = await createAccountWithSpace(store, getAuthProvider(), { login: login("t"), password: "a long test password", space: "blank", display_name: "陈先生" });
  her = await createAccountWithSpace(store, getAuthProvider(), { login: login("w"), password: "a long test password", space: "none", display_name: "Wei Ling" });
  const inv = await invitePost(req("/api/family/invites", { token: him.tokens.access_token, body: { family_label: "Wei Ling", relation: "daughter", patient_label: "爸爸" } }));
  const body = (await inv.json()) as { link: { id: string }; path: string };
  linkId = body.link.id;
  await acceptPost(req("/api/family/invites/accept", { token: her.tokens.access_token, body: { token: body.path.slice("/invite/".length) } }));
  await confirmPost(req(`/api/family/links/${linkId}/confirm`, { token: him.tokens.access_token, body: { yes: true } }), { params: Promise.resolve({ id: linkId }) });
});
afterAll(() => {
  process.env = savedEnv;
  rmSync(blobDir, { recursive: true, force: true });
});

describe("her tag in the file name", () => {
  it("is a one-way stand-in: not her id, not her own folder's name, the same every time, different per person", () => {
    const tag = blobUserTag(her.userId);
    expect(tag).toMatch(/^u[0-9a-f]{31}$/);
    expect(tag).not.toContain(her.userId.replace(/-/g, "").slice(0, 12));
    expect(tag.slice(1)).not.toBe(blobPrefix({ id: her.userId, kind: "account" }).slice(1));
    expect(blobUserTag(her.userId)).toBe(tag);
    expect(blobUserTag(him.userId)).not.toBe(tag);
  });

  it("the upload link through her care link names a file that starts with her tag, in his reminders folder", async () => {
    const res = await uploadUrlPost(req(`/api/upload-url?link=${linkId}`, { token: her.tokens.access_token, body: { kind: "reminder", content_type: "audio/wav" } }));
    expect(res.status).toBe(200);
    const plan = (await res.json()) as { bucket: string; path: string };
    const prefix = blobPrefix({ id: him.userId, kind: "account" });
    expect(plan.bucket).toBe("audio");
    expect(plan.path).toMatch(new RegExp(`^${prefix}/reminders/${blobUserTag(her.userId)}-${UUID}\\.wav$`));
    expect(plan.path).not.toContain(her.userId);
    expect(plan.path).not.toContain(him.userId);
    expect(reminderFileOf(prefix, blobUserTag(her.userId), plan.path)).toBe(true);
    // she may still ask for nothing but a reminder
    expect((await uploadUrlPost(req(`/api/upload-url?link=${linkId}`, { token: her.tokens.access_token, body: { kind: "label", content_type: "image/png" } }))).status).toBe(403);
    // his own uploads are his: no tag
    const own = (await (await uploadUrlPost(req("/api/upload-url", { token: him.tokens.access_token, body: { kind: "reminder", content_type: "audio/wav" } }))).json()) as { path: string };
    expect(own.path).toMatch(new RegExp(`^${prefix}/reminders/${UUID}\\.wav$`));
    // the demo's paths are unchanged
    expect(planUpload("sess-1", { kind: "reminder", content_type: "audio/wav" }).path).toMatch(new RegExp(`^sess-1/reminders/${UUID}\\.wav$`));
  });

  it("through her link she registers the file she uploaded, and no one else's", async () => {
    const prefix = blobPrefix({ id: him.userId, kind: "account" });
    const plan = (await (await uploadUrlPost(req(`/api/upload-url?link=${linkId}`, { token: her.tokens.access_token, body: { kind: "reminder", content_type: "audio/wav" } }))).json()) as { path: string };
    await getBlobStore().putObject("audio", plan.path, sound(), "audio/wav");
    const ok = await remindersPost(req(`/api/reminders?link=${linkId}`, { token: her.tokens.access_token, body: { audio_path: plan.path } }));
    expect(ok.status).toBe(201);
    const row = (await store.listReminderClips(him.userId)).find((c) => c.audio_path === plan.path)!;
    expect(row).toMatchObject({ by_user_id: her.userId, link_id: linkId });

    for (const other of [`${prefix}/reminders/${randomUUID()}.wav`, `${prefix}/reminders/${blobUserTag(him.userId)}-${randomUUID()}.wav`, `${prefix}/visits/v-1/recording-${randomUUID()}.wav`]) {
      await getBlobStore().putObject("audio", other, sound(), "audio/wav");
      const res = await remindersPost(req(`/api/reminders?link=${linkId}`, { token: her.tokens.access_token, body: { audio_path: other } }));
      expect(res.status, other.slice(prefix.length)).toBe(403);
      expect((await res.json()) as { error: string }).toEqual({ error: "path_not_in_session" });
    }
  });
});

describe("pathOwnedBy", () => {
  it("his side owns everything under his prefix; her side only her own reminder recordings", () => {
    const scope = { id: him.userId, kind: "account" as const };
    const prefix = blobPrefix(scope);
    const hers = `${prefix}/reminders/${blobUserTag(her.userId)}-${randomUUID()}.wav`;
    const his = { scope, relation: "self", userId: him.userId };
    const she = { scope, relation: "family", userId: her.userId };
    for (const p of [hers, `${prefix}/reminders/${randomUUID()}.wav`, `${prefix}/visits/v-1/recording-1.wav`, `${prefix}/labels/a.png`]) expect(pathOwnedBy(his, p), p).toBe(true);
    expect(pathOwnedBy({ scope, relation: "system", userId: null }, hers)).toBe(true);
    expect(pathOwnedBy(she, hers)).toBe(true);
    for (const p of [
      `${prefix}/reminders/${randomUUID()}.wav`,
      `${prefix}/reminders/${blobUserTag(him.userId)}-${randomUUID()}.wav`,
      `${prefix}/visits/v-1/recording-1.wav`,
      `${prefix}/labels/a.png`,
      `${blobPrefix({ id: her.userId, kind: "account" })}/reminders/${blobUserTag(her.userId)}-x.wav`,
      `${prefix}/reminders/../reminders/${blobUserTag(her.userId)}-x.wav`,
      `${prefix}x/reminders/${blobUserTag(her.userId)}-x.wav`,
    ]) {
      expect(pathOwnedBy(she, p), p).toBe(false);
    }
    expect(pathOwnedBy({ scope, relation: "family", userId: null }, hers)).toBe(false);
    for (const p of [`${prefix}x/labels/a.png`, `other/${prefix}/labels/a.png`, `${prefix}/../other/a.png`, ""]) expect(pathOwnedBy(his, p), p).toBe(false);
    // a demo session: its id is the prefix
    expect(pathOwnedBy({ scope: { id: "sess-1", kind: "sandbox" as const }, relation: "demo", userId: null }, "sess-1/reminders/a.wav")).toBe(true);
    expect(pathOwnedBy({ scope: { id: "sess-1", kind: "sandbox" as const }, relation: "demo", userId: null }, "sess-12/reminders/a.wav")).toBe(false);
  });
});
