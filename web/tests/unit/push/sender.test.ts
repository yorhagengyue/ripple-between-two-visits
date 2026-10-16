/**
 * Web push from the server to a phone (C2 track I; real-app 2.24, 8.10 push/subscribe): the sender against a local
 * push service that checks VAPID and opens each message like a real one (tests/support/push-service.ts).
 *
 *   - one row per endpoint; a 404/410 answer removes that subscription, a 500 keeps it, an endpoint off the allow-list
 *     is never called;
 *   - the lock screen never shows a medicine name, a dose or a reading (the fallback words go instead);
 *   - the scheduled job end to end (track B's daily.doses through registerNoticeSender): 08:45 his first reminder,
 *     09:15 the second with the same tag (it replaces the first, and alerts again), 09:45 her alert reaches her phone
 *     only while his switch is on, checked again at send time (track D's mayNotifyFamily); nothing twice.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { mayNotifyFamily } from "@/lib/care/recipients";
import { DAILY_DOSES_JOB } from "@/lib/jobs/daily";
import { registerNoticeSender, type Notice } from "@/lib/jobs/notify";
import { buildPayload, FALLBACK_WORDS, lockScreenProblems, payloadFromNotice, sitePath } from "@/lib/push/payload";
import { topicOf } from "@/lib/push/send";
import { createWebPushSender, ownSubscriptions, pushToUser, storeSubscriptions } from "@/lib/push/sender";
import { MemoryStore } from "@/lib/store/memory";
import { careEntryStore } from "@/lib/subject/care";
import { pushEntryStore } from "@/lib/subject/push";
import { ScopeViolation } from "@/lib/subject/scoped-store";
import { setTestClock } from "@/lib/time/now";
import { startPushService, type PushService } from "../../support/push-service";

let service: PushService;
beforeAll(async () => {
  service = await startPushService();
});
afterAll(async () => {
  await service.close();
  setTestClock(null);
  registerNoticeSender(null);
});

const auth = getAuthProvider();
const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;

function payloadText(words: { title: string; body: string }) {
  return buildPayload({ kind: "test", ...words, url: "/p/today", tag: "t", locale: "zh-Hans" });
}

describe("pushToUser: every phone of one person", () => {
  it("201 counts; 410 and 404 remove that phone; 500 keeps it; an endpoint off the allow-list is never called", async () => {
    const store = new MemoryStore();
    const uid = randomUUID();
    const ok = service.newPhone({ label: "ok" });
    const gone = service.newPhone({ label: "gone" });
    const lost = service.newPhone({ label: "lost" });
    const broken = service.newPhone({ label: "broken" });
    gone.answer = 410;
    lost.answer = 404;
    broken.answer = 500;
    for (const p of [ok, gone, lost, broken]) await store.savePushSubscription({ user_id: uid, endpoint: p.endpoint, ...p.keys });
    await store.savePushSubscription({ user_id: uid, endpoint: "https://evil.example/collect", ...ok.keys });
    const before = service.messages.length;
    const counts = await pushToUser(storeSubscriptions(store), uid, payloadText({ title: "早上的药", body: "还没记" }), { ttlS: 3600, topic: "dose-x" });
    expect(counts).toEqual({ sent: 1, gone: 2, failed: 1, refused: 1, off: false });
    expect((await store.listPushSubscriptions(uid)).map((s) => s.endpoint).sort()).toEqual([broken.endpoint, ok.endpoint, "https://evil.example/collect"].sort());
    const seen = service.messages.slice(before);
    expect(seen.map((m) => m.label).sort()).toEqual(["broken", "gone", "lost", "ok"]);
    const m = seen.find((x) => x.label === "ok")!;
    expect(m).toMatchObject({ status: 201, problem: null, ttl: 3600, urgency: "high", topic: topicOf("dose-x") });
    expect(m.payload).toMatchObject({ v: 1, kind: "test", title: "早上的药", body: "还没记", url: "/p/today", tag: "t" });
  });

  it("no keys here: nothing sent (off); a person's own port never reaches another person's phones", async () => {
    const store = new MemoryStore();
    const uid = randomUUID();
    const other = randomUUID();
    const p = service.newPhone();
    await store.savePushSubscription({ user_id: other, endpoint: p.endpoint, ...p.keys });
    expect(await pushToUser(storeSubscriptions(store), other, payloadText({ title: "a", body: "b" }), { ttlS: 60 }, { vapid: () => null })).toMatchObject({ sent: 0, off: true });
    expect(await pushToUser(ownSubscriptions(store, uid), other, payloadText({ title: "a", body: "b" }), { ttlS: 60 })).toMatchObject({ sent: 0 });
  });

  it("the jobs' narrow store lists and removes phones and does nothing else", async () => {
    const store = new MemoryStore();
    const narrow = pushEntryStore(store);
    expect(await narrow.listPushSubscriptions(randomUUID())).toEqual([]);
    expect(() => (narrow as unknown as MemoryStore).listMeds("x")).toThrow(ScopeViolation);
    expect(() => (narrow as unknown as MemoryStore).getAccount("x")).toThrow(ScopeViolation);
  });
});

describe("the lock screen never shows a medicine name, a dose or a reading", () => {
  it("track B's sentences pass; names (Chinese too), doses and readings do not", () => {
    for (const ok of ["早间药物", "尚未记录", "爸爸尚未回应早间药物提醒", "8:45 和 9:15 两次提醒均未回应。", "该测量血压了", "打开 Ripple 记录一次", "Morning medicine", "Not logged yet"]) {
      expect(lockScreenProblems(ok), ok).toEqual([]);
    }
    expect(lockScreenProblems("Amlodipine 还没记")).toContain("amlodipine");
    expect(lockScreenProblems("记得吃氨氯地平")).toContain("氨氯地平");
    expect(lockScreenProblems("Take your Norvasc")).toContain("norvasc");
    expect(lockScreenProblems("早上 5 mg")).toContain("dose");
    expect(lockScreenProblems("早上吃一粒")).toContain("dose");
    expect(lockScreenProblems("今天 150/95")).toContain("reading");
    expect(lockScreenProblems("Grandpa's pills", ["Grandpa's pills"])).toHaveLength(1);
  });

  it("a notice that fails is sent with the fallback words, never its own; the url stays on this site", () => {
    const notice: Notice = {
      kind: "family_no_reply",
      to: { role: "family", userId: "u", linkId: "l" },
      title: "Amlodipine爸爸尚未回应早上的药提醒",
      body: "x",
      url: "https://evil.example/",
      tag: "no-reply-2026-10-13-morning",
      ttlS: 21600,
      deliveryId: "delivery-1",
      scopeId: "scope-secret",
      locale: "zh-Hans",
    };
    const built = payloadFromNotice(notice);
    expect(built.replaced).toBe(true);
    expect(built.payload).toMatchObject({ title: FALLBACK_WORDS["zh-Hans"].title, body: FALLBACK_WORDS["zh-Hans"].body, url: "/p/today", delivery: "delivery-1" });
    expect(JSON.stringify(built.payload)).not.toContain("scope-secret");
    expect(sitePath("/f?link=abc")).toBe("/f?link=abc");
    for (const bad of ["//evil.example/x", "https://evil.example/", "/\\evil", "javascript:alert(1)"]) expect(sitePath(bad), bad).toBeNull();
  });
});

describe("the scheduled job end to end: his reminders, her alert", () => {
  let store: MemoryStore;
  let him: TestAccount;
  let her: TestAccount;
  let linkId: string;
  let hisPhone: ReturnType<PushService["newPhone"]>;
  let herPhone: ReturnType<PushService["newPhone"]>;

  const tick = async (iso: string) => {
    setTestClock({ at: iso, frozen: true });
    return DAILY_DOSES_JOB.run({ store, nowMs: Date.parse(iso), holder: "test" });
  };
  const toPhone = (id: string, from: number) => service.messages.slice(from).filter((m) => m.phone === id);

  beforeEach(() => {
    registerNoticeSender(
      createWebPushSender({
        port: () => storeSubscriptions(pushEntryStore(store)),
        mayNotify: (to, kind) => mayNotifyFamily(to, kind, { store: careEntryStore(store) }),
      }),
    );
  });
  afterEach(() => registerNoticeSender(null));

  beforeAll(async () => {
    store = new MemoryStore();
    setTestClock({ at: SGT("2026-10-12", "10:00"), frozen: true });
    him = await createAccountWithSpace(store, auth, { login: `i${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
    her = await createAccountWithSpace(store, auth, { login: `w${randomUUID().slice(0, 10)}`, password: "a long test password", space: "none" });
    const inv = await store.createInvite(
      { patient_id: him.userId, patient_label: "爸爸", invite_token_hash: randomUUID(), invite_expires_at: "2099-01-01T00:00:00.000Z" },
      { dose_summary: true, no_reply_alert: false },
    );
    if (!inv.ok) throw new Error(inv.code);
    linkId = inv.link.id;
    const acc = await store.acceptInvite(inv.link.invite_token_hash!, her.userId, "Wei Ling");
    if (!acc.ok) throw new Error(acc.code);
    const ok = await store.confirmLink(linkId, him.userId, true);
    if (!ok.ok) throw new Error(ok.code);
    hisPhone = service.newPhone({ label: "his" });
    herPhone = service.newPhone({ label: "hers" });
    await store.savePushSubscription({ user_id: him.userId, endpoint: hisPhone.endpoint, ...hisPhone.keys });
    await store.savePushSubscription({ user_id: her.userId, endpoint: herPhone.endpoint, ...herPhone.keys });
  });

  it("08:44 nothing; 08:45 his phone gets 「早间药物」「尚未记录」 with the delivery id, no medicine name, no scope id", async () => {
    const from = service.messages.length;
    expect(await tick(SGT("2026-10-13", "08:44"))).toMatchObject({ first: 0, sent: 0 });
    expect(await tick(SGT("2026-10-13", "08:45"))).toMatchObject({ first: 1, sent: 1 });
    expect(await tick(SGT("2026-10-13", "08:46"))).toMatchObject({ first: 0, sent: 0 });
    const got = toPhone(hisPhone.id, from);
    expect(got).toHaveLength(1);
    const delivery = (await store.listDeliveries(him.userId, { fromDay: 43, toDay: 43 })).find((d) => d.kind === "dose_first")!;
    expect(got[0].payload).toEqual({
      v: 1,
      kind: "dose_first",
      title: "早间药物",
      body: "尚未记录",
      url: "/p/today?remind=dose-morning",
      tag: "dose-2026-10-13-morning",
      renotify: false,
      delivery: delivery.id,
      lang: "zh-Hans",
      sent_at: expect.any(String),
    });
    expect(got[0]).toMatchObject({ ttl: 3600, urgency: "high", topic: topicOf("dose-2026-10-13-morning") });
    expect(got[0].text).not.toMatch(/amlodipine|氨氯地平|5 ?mg/i);
    expect(got[0].text).not.toContain(him.userId);
    expect(toPhone(herPhone.id, from)).toEqual([]);
  });

  it("09:15 the second reminder: the same tag (it replaces the first) and it alerts again", async () => {
    const from = service.messages.length;
    expect(await tick(SGT("2026-10-13", "09:15"))).toMatchObject({ second: 1, sent: 1 });
    const got = toPhone(hisPhone.id, from);
    expect(got.map((m) => [m.payload?.kind, m.payload?.tag, m.payload?.renotify, m.payload?.title])).toEqual([["dose_second", "dose-2026-10-13-morning", true, "早间药物"]]);
  });

  it("09:45 with his switch off: settled as no reply, nothing reaches her; switched on: her alert reaches her phone, once", async () => {
    let from = service.messages.length;
    expect(await tick(SGT("2026-10-13", "09:45"))).toMatchObject({ settled: 1, family: 0 });
    expect(toPhone(herPhone.id, from)).toEqual([]);
    expect((await store.listDeliveries(him.userId, { fromDay: 43, toDay: 43 })).filter((d) => d.kind === "family_no_reply")).toEqual([]);

    await store.setFamilyGrant(him.userId, linkId, { no_reply_alert: true });
    from = service.messages.length;
    expect(await tick(SGT("2026-10-13", "09:46"))).toMatchObject({ family: 1, sent: 1 });
    const got = toPhone(herPhone.id, from);
    expect(got).toHaveLength(1);
    expect(got[0].payload).toMatchObject({
      kind: "family_no_reply",
      title: "爸爸尚未回应早间药物提醒",
      body: "8:45 和 9:15 两次提醒均未回应。",
      url: `/f?link=${encodeURIComponent(linkId)}`,
      tag: "no-reply-2026-10-13-morning",
      // her tap marks this row opened through her link (POST /api/push/opened?link=)
      delivery: (await store.listDeliveries(him.userId, { fromDay: 43, toDay: 43 })).find((d) => d.kind === "family_no_reply")!.id,
    });
    // real-app 2.24: no push is held longer than an hour, whatever the job asked for
    expect(got[0].ttl).toBe(3600);
    expect(got[0].text).not.toMatch(/amlodipine|氨氯地平|mg/i);
    expect(toPhone(hisPhone.id, from)).toEqual([]);
    expect(await tick(SGT("2026-10-13", "09:47"))).toMatchObject({ family: 0, sent: 0 });
  });

  it("her alert recorded but his switch off by the time it is sent: nothing goes (checked at send time)", async () => {
    const sender = createWebPushSender({ port: () => storeSubscriptions(store), mayNotify: (to, kind) => mayNotifyFamily(to, kind, { store: careEntryStore(store) }) });
    await store.setFamilyGrant(him.userId, linkId, { no_reply_alert: false });
    const from = service.messages.length;
    const notice: Notice = {
      kind: "family_no_reply",
      to: { role: "family", userId: her.userId, linkId },
      title: "爸爸尚未回应早上的药提醒",
      body: "8:45 和 9:15 两次提醒均未回应。",
      url: `/f?link=${linkId}`,
      tag: "no-reply-x",
      ttlS: 60,
      deliveryId: "d",
      scopeId: him.userId,
      locale: "zh-Hans",
    };
    expect(await sender(notice, store)).toEqual({ sent: 0 });
    // and a link that is not his and hers never sends, whatever the switch
    await store.setFamilyGrant(him.userId, linkId, { no_reply_alert: true });
    expect(await sender({ ...notice, to: { role: "family", userId: him.userId, linkId } }, store)).toEqual({ sent: 0 });
    expect(await sender(notice, store)).toEqual({ sent: 1 });
    expect(toPhone(herPhone.id, from)).toHaveLength(1);
  });

  it("an old phone of his unsubscribed at the push service (410): the job's next send removes it", async () => {
    const extra = service.newPhone({ label: "old phone" });
    extra.answer = 410;
    await store.savePushSubscription({ user_id: him.userId, endpoint: extra.endpoint, ...extra.keys });
    expect(await tick(SGT("2026-10-14", "08:45"))).toMatchObject({ first: 1, sent: 1 });
    expect((await store.listPushSubscriptions(him.userId)).map((s) => s.endpoint)).toEqual([hisPhone.endpoint]);
  });
});
