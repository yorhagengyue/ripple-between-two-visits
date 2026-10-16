/**
 * The safety rule of binding by account, on her writes (line bind; lib/care/ack.ts, the integrator's corrected rule).
 *
 * A link is unacknowledged only when his account carries the mark that a family member bound it (family_bound, by:
 * "family") and he has no family_share granted record naming it. While it is, she may read what the four default
 * switches show, and nothing she does reaches his phone: her voice reminder (a new recording, or an older clip of hers
 * chosen again) and a fact she proposes are refused with 409 link_not_acknowledged, and nothing is stored. His 「知道了」,
 * or a switch he changes, opens them. Every other link behaves as before this rule existed: an invitation he confirmed,
 * a link he bound himself, and a link made straight through the store with no record at all.
 *
 * Round two (the integrator, 2026-10-11): before he has answered she gets nothing beyond the four items. Her home
 * carries no reminder (its words, whose voice, its time); the list of what his phone plays and the sound of a clip are
 * refused the same way (the recording may be another family member's voice); and no upload link is signed for her.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as bindPost } from "@/app/api/family/bind/route";
import { POST as seenPost } from "@/app/api/family/bind/seen/route";
import { POST as acceptPost } from "@/app/api/family/invites/accept/route";
import { POST as invitePost } from "@/app/api/family/invites/route";
import { POST as confirmPost } from "@/app/api/family/links/[id]/confirm/route";
import { POST as grantsPost } from "@/app/api/family/links/[id]/grants/route";
import { GET as sharedGet } from "@/app/api/family/shared/route";
import { GET as viewGet } from "@/app/api/family/view/route";
import { POST as factsPost } from "@/app/api/profile/facts/route";
import { GET as audioGet } from "@/app/api/reminders/[id]/audio/route";
import { POST as clipUse } from "@/app/api/reminders/[id]/use/route";
import { GET as remindersGet, POST as remindersPost } from "@/app/api/reminders/route";
import { POST as uploadPost } from "@/app/api/upload-url/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { blobPrefix, blobUserTag, getBlobStore } from "@/lib/blob";
import { getBus, type BusEvent } from "@/lib/bus";
import { linkAcknowledged } from "@/lib/care/ack";
import { DIRECT_GRANTS } from "@/lib/care/bind";
import type { FamilyHomeData } from "@/lib/care/home-types";
import { hashToken } from "@/lib/care/tokens";
import { getMemoryStore } from "@/lib/store/memory";
import { encodeWav } from "@/lib/visit/wav";

const store = getMemoryStore();
const PASSWORD = "a long test password";
const savedEnv = { ...process.env };
let blobDir: string;

beforeAll(() => {
  blobDir = mkdtempSync(path.join(tmpdir(), "ripple-bind-ack-"));
  process.env.BLOB_LOCAL_DIR = blobDir;
  delete process.env.BLOB_DRIVER;
  process.env.SPEECH_PROVIDER = "devfake";
});
afterAll(() => {
  process.env = savedEnv;
  rmSync(blobDir, { recursive: true, force: true });
});

const login = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const elder = () => createAccountWithSpace(store, getAuthProvider(), { login: login("t"), password: PASSWORD, space: "example", display_name: "陈先生" });
const family = (display = "Wei Ling") => createAccountWithSpace(store, getAuthProvider(), { login: login("w"), password: PASSWORD, space: "none", display_name: display });
const t = (a: TestAccount) => a.tokens.access_token;
const shown = (a: TestAccount) => (a.login.kind === "username" ? a.login.username : a.login.email);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function req(p: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}): NextRequest {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.cookie = `rp_at=${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, { method: opts.body === undefined ? "GET" : "POST", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}

async function bind(who: TestAccount, account: string): Promise<string> {
  const res = await bindPost(req("/api/family/bind", { token: t(who), body: { account } }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { link: { id: string } }).link.id;
}

/** A short WAV with sound, uploaded into his space as her reminder file (what POST /api/upload-url?link= hands her). */
async function upload(him: TestAccount, her: TestAccount): Promise<string> {
  const pcm = new Float32Array(16000).map((_, i) => Math.sin(i / 8) * 0.3);
  const p = `${blobPrefix({ id: him.userId, kind: "account" })}/reminders/${blobUserTag(her.userId)}-${randomUUID()}.wav`;
  await getBlobStore().putObject("audio", p, encodeWav(pcm, 16000), "audio/wav");
  return p;
}

/** Her three writes that reach his phone, each tried once: the statuses, and the error each answered with. */
async function herWrites(him: TestAccount, her: TestAccount, linkId: string, oldClip: string): Promise<{ record: [number, string?]; again: [number, string?]; fact: [number, string?] }> {
  const record = await remindersPost(req(`/api/reminders?link=${linkId}`, { token: t(her), body: { audio_path: await upload(him, her) }, headers: { "x-ripple-devfake-fixture": "reminder" } }));
  const again = await clipUse(req(`/api/reminders/${oldClip}/use?link=${linkId}`, { token: t(her), body: {} }), params(oldClip));
  const fact = await factsPost(req(`/api/profile/facts?link=${linkId}`, { token: t(her), body: { kind: "condition", text: "爸爸有高血压" } }));
  const err = async (r: Response) => ((await r.json()) as { error?: string }).error;
  return { record: [record.status, await err(record)], again: [again.status, await err(again)], fact: [fact.status, await err(fact)] };
}

/** What of hers is in his space: her clips and her proposals. */
async function hersInHisSpace(him: TestAccount, her: TestAccount): Promise<{ clips: number; facts: number }> {
  return {
    clips: (await store.listReminderClips(him.userId)).filter((c) => c.by_user_id === her.userId).length,
    facts: (await store.listProfileFacts(him.userId)).filter((f) => f.entered_by_user_id === her.userId).length,
  };
}

/** A clip of hers from before (an earlier link that has ended): still hers by her user id. */
async function olderClip(him: TestAccount, her: TestAccount): Promise<string> {
  return (await store.addReminderClip(him.userId, { by: "an-earlier-link", audio_path: await upload(him, her), plays_at: "after_breakfast", text: "爸，记得吃药。", lang: "zh-Hans", by_user_id: her.userId, by_label: "Wei Ling", link_id: null })).id;
}

const REFUSED = { record: [409, "link_not_acknowledged"], again: [409, "link_not_acknowledged"], fact: [409, "link_not_acknowledged"] };
const PASSED = { record: [201, undefined], again: [200, undefined], fact: [201, undefined] };

/**
 * What she reaches of the reminder his phone plays (round two): whether her home carries it, the list (GET
 * /api/reminders), the sound of one clip, and the upload link for a recording of her own.
 */
async function reminderReach(her: TestAccount, linkId: string, clipId: string): Promise<{ home: boolean; list: number; sound: number; upload: number }> {
  const home = (await (await viewGet(req(`/api/family/view?link=${linkId}`, { token: t(her) }))).json()) as FamilyHomeData;
  const list = await remindersGet(req(`/api/reminders?link=${linkId}`, { token: t(her) }));
  const sound = await audioGet(req(`/api/reminders/${clipId}/audio?link=${linkId}`, { token: t(her) }), params(clipId));
  const upload = await uploadPost(req(`/api/upload-url?link=${linkId}`, { token: t(her), body: { kind: "reminder", content_type: "audio/wav" } }));
  return { home: home.reminder !== null, list: list.status, sound: sound.status, upload: upload.status };
}
const CLOSED = { home: false, list: 409, sound: 409, upload: 409 };
const OPEN = { home: true, list: 200, sound: 200, upload: 200 };

function capture(channel: string): { events: BusEvent[]; stop(): void } {
  const events: BusEvent[] = [];
  const stop = getBus().subscribe(channel, (e) => events.push(e));
  return { events, stop };
}

describe("a link she bound by typing his account, before he has answered", () => {
  let him: TestAccount;
  let her: TestAccount;
  let linkId: string;
  let old: string;
  beforeAll(async () => {
    him = await elder();
    her = await family();
    old = await olderClip(him, her);
    linkId = await bind(her, shown(him));
  });

  it("she reads what the four default switches show and nothing beyond them: none of his words, nothing of the reminder his phone plays", async () => {
    const res = await viewGet(req(`/api/family/view?link=${linkId}`, { token: t(her) }));
    expect(res.status).toBe(200);
    const text = await res.text();
    const home = JSON.parse(text) as FamilyHomeData;
    expect(home.grants).toEqual(DIRECT_GRANTS);
    // this week's medicine days, how many readings, how many questions; the no-reply alert rides on the first
    expect(home.week?.days).toHaveLength(7);
    expect(home.bp).not.toBeNull();
    expect(home.questions).not.toBeNull();
    expect(home).toMatchObject({ visitsShared: false, notesShared: false });
    const shared = (await (await sharedGet(req(`/api/family/shared?link=${linkId}`, { token: t(her) }))).json()) as { visits?: unknown; notes?: unknown };
    expect(shared.visits).toBeUndefined();
    expect(shared.notes).toBeUndefined();
    // round two: what plays for him now is not hers before he has answered. Not on her home (the clip his phone would
    // play is the older one above, with its words), not as a list, not as sound; and no upload link is signed for her
    expect(home.reminder).toBeNull();
    expect(text).not.toContain("记得吃药");
    expect(await reminderReach(her, linkId, old)).toEqual(CLOSED);
    const list = await remindersGet(req(`/api/reminders?link=${linkId}`, { token: t(her) }));
    expect([list.status, await list.json()]).toEqual([409, { error: "link_not_acknowledged" }]);
    const upload = await uploadPost(req(`/api/upload-url?link=${linkId}`, { token: t(her), body: { kind: "reminder", content_type: "audio/wav" } }));
    expect([upload.status, await upload.json()]).toEqual([409, { error: "link_not_acknowledged" }]);
    // his own phone plays and lists as ever
    expect((await remindersGet(req("/api/reminders", { token: t(him) }))).status).toBe(200);
    expect((await audioGet(req(`/api/reminders/${old}/audio`, { token: t(him) }), params(old))).status).toBe(200);
  });

  it("nothing she does reaches his phone: a recording, an older clip chosen again and a fact are each refused, and nothing is stored", async () => {
    expect(await linkAcknowledged(store, { id: linkId, patient_id: him.userId })).toBe(false);
    const before = await hersInHisSpace(him, her);
    const plays = (await store.listReminderClips(him.userId)).length;
    const mine = capture(him.userId);
    expect(await herWrites(him, her, linkId, old)).toEqual(REFUSED);
    mine.stop();
    expect(await hersInHisSpace(him, her)).toEqual(before);
    expect((await store.listReminderClips(him.userId)).length).toBe(plays);
    // nothing was said on his channel either: his Today has no new clip to play and no 「家人写了 1 条」
    expect(mine.events.map((e) => e.type)).toEqual([]);
  });

  it("he taps 「知道了」: all three pass from then on", async () => {
    expect((await seenPost(req("/api/family/bind/seen", { token: t(him), body: { link: linkId } }))).status).toBe(200);
    expect(await linkAcknowledged(store, { id: linkId, patient_id: him.userId })).toBe(true);
    // and the reminder is hers to see and hear, as for any family member in force
    expect(await reminderReach(her, linkId, old)).toEqual(OPEN);
    const home = (await (await viewGet(req(`/api/family/view?link=${linkId}`, { token: t(her) }))).json()) as FamilyHomeData;
    expect(home.reminder).toMatchObject({ at: expect.stringMatching(/^\d{1,2}:\d{2}$/) });
    const before = await hersInHisSpace(him, her);
    expect(await herWrites(him, her, linkId, old)).toEqual(PASSED);
    expect(await hersInHisSpace(him, her)).toEqual({ clips: before.clips + 2, facts: before.facts + 1 });
  });
});

describe("the other ways a link she bound gets his answer", () => {
  it("he changes a switch without ever tapping 「知道了」: the record of that change is his answer", async () => {
    const him = await elder();
    const her = await family();
    const old = await olderClip(him, her);
    const linkId = await bind(her, shown(him));
    expect(await herWrites(him, her, linkId, old)).toEqual(REFUSED);
    expect(await reminderReach(her, linkId, old)).toEqual(CLOSED);
    expect((await grantsPost(req(`/api/family/links/${linkId}/grants`, { token: t(him), body: { items: { questions_count: false } } }), params(linkId))).status).toBe(200);
    expect(await reminderReach(her, linkId, old)).toEqual(OPEN);
    expect(await herWrites(him, her, linkId, old)).toEqual(PASSED);
  });

  it("each link has its own answer: his 「知道了」 for one family member opens nothing for another", async () => {
    const him = await elder();
    const her = await family();
    const sister = await family("Hui Min");
    const hers = await bind(her, shown(him));
    const sisters = await bind(sister, shown(him));
    expect((await seenPost(req("/api/family/bind/seen", { token: t(him), body: { link: hers } }))).status).toBe(200);
    expect((await factsPost(req(`/api/profile/facts?link=${hers}`, { token: t(her), body: { kind: "other", text: "他喜欢早上去公园" } }))).status).toBe(201);
    const refused = await factsPost(req(`/api/profile/facts?link=${sisters}`, { token: t(sister), body: { kind: "other", text: "他喜欢早上去公园" } }));
    expect([refused.status, await refused.json()]).toEqual([409, { error: "link_not_acknowledged" }]);
  });
});

describe("every other link is acknowledged, as before", () => {
  it("a link he bound himself by typing her account: her writes pass at once", async () => {
    const him = await elder();
    const her = await family();
    const old = await olderClip(him, her);
    const linkId = await bind(him, shown(her));
    expect(await reminderReach(her, linkId, old)).toEqual(OPEN);
    expect(await herWrites(him, her, linkId, old)).toEqual(PASSED);
  });

  it("an invitation he sent, she accepted and he confirmed with 「是她」: her writes pass", async () => {
    const him = await elder();
    const her = await family();
    const old = await olderClip(him, her);
    const inv = (await (await invitePost(req("/api/family/invites", { token: t(him), body: { family_label: "Wei Ling", relation: "daughter", patient_label: "爸爸" } }))).json()) as { link: { id: string }; path: string };
    expect((await acceptPost(req("/api/family/invites/accept", { token: t(her), body: { token: inv.path.slice("/invite/".length) } }))).status).toBe(200);
    expect((await confirmPost(req(`/api/family/links/${inv.link.id}/confirm`, { token: t(him), body: { yes: true } }), params(inv.link.id))).status).toBe(200);
    expect(await reminderReach(her, inv.link.id, old)).toEqual(OPEN);
    expect(await herWrites(him, her, inv.link.id, old)).toEqual(PASSED);
  });

  it("a link made straight through the store, with no mark and no record of his at all: her writes pass, as they always did", async () => {
    const him = await elder();
    const her = await family();
    const old = await olderClip(him, her);
    const hash = hashToken(randomUUID());
    const made = await store.createInvite({ patient_id: him.userId, family_label: "Wei Ling", invite_token_hash: hash, invite_expires_at: new Date(Date.now() + 86_400_000).toISOString() });
    if (!made.ok) throw new Error(made.code);
    expect((await store.acceptInvite(hash, her.userId)).ok).toBe(true);
    expect((await store.confirmLink(made.link.id, him.userId, true)).ok).toBe(true);
    expect(await store.listConsentRecords(him.userId, { kind: "family_share" })).toEqual([]);
    expect((await store.listAccountEvents(him.userId)).filter((e) => e.kind === "family_bound")).toEqual([]);
    expect(await reminderReach(her, made.link.id, old)).toEqual(OPEN);
    expect(await herWrites(him, her, made.link.id, old)).toEqual(PASSED);
  });
});
