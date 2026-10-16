/**
 * Two rows of the notification table (C2 track I, follow-up; real-app 2.20 step 4, 2.24):
 *
 *   家人接受了   she accepts his invitation -> his phone gets 「Wei Ling 已经接受」 once (a reminder_delivery row in his
 *                space), no clinical word on the lock screen, the tap lands on Today's confirm card (/p/today?confirm=1;
 *                C2 track D, round two: real-app 2.20 step 4) and marks the row opened; a
 *                phone he never turned reminders on for gets nothing.
 *   她看到通知   her tap on her "no reply" alert marks that row opened through her link; she can mark nothing else
 *                (not his reminders, not another link's alert, nothing once her link ended), and he cannot mark hers.
 *
 * Through the real routes and the registered web push sender, against the local push service
 * (tests/support/push-service.ts), on the process-wide memory store.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as acceptPost } from "@/app/api/family/invites/accept/route";
import { POST as invitePost } from "@/app/api/family/invites/route";
import { POST as confirmPost } from "@/app/api/family/links/[id]/confirm/route";
import { POST as revokePost } from "@/app/api/family/links/[id]/revoke/route";
import { POST as openedPost } from "@/app/api/push/opened/route";
import { GET as statusGet } from "@/app/api/push/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { registerNoticeSender } from "@/lib/jobs/notify";
import { acceptedWords, notifyInviteAccepted } from "@/lib/push/accepted";
import { lockScreenProblems, payloadFromNotice } from "@/lib/push/payload";
import { topicOf } from "@/lib/push/send";
import { createWebPushSender, MAX_HOLD_S, storeSubscriptions } from "@/lib/push/sender";
import { getMemoryStore } from "@/lib/store/memory";
import { familySubject, ScopeViolation } from "@/lib/subject";
import { hasPushSubscription, pushEntryStore } from "@/lib/subject/push";
import { setTestClock } from "@/lib/time/now";
import { startPushService, type PushMessage, type PushService, type TestPhone } from "../../support/push-service";

const store = getMemoryStore();
const auth = getAuthProvider();
let service: PushService;

const id = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const account = (space: "example" | "blank" | "none", locale: "zh-Hans" | "en" = "zh-Hans"): Promise<TestAccount> =>
  createAccountWithSpace(store, auth, { login: id("a"), password: "a long test password", space, locale });

function call(path: string, token: string | null, body?: unknown): NextRequest {
  const headers: Record<string, string> = {};
  if (token) headers.cookie = `rp_at=${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${path}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const params = (linkId: string) => ({ params: Promise.resolve({ id: linkId }) });

async function invite(him: TestAccount, label: string): Promise<{ linkId: string; token: string }> {
  const res = await invitePost(call("/api/family/invites", him.tokens.access_token, { family_label: label, relation: "daughter", patient_label: "爸爸" }));
  expect(res.status).toBe(201);
  const body = (await res.json()) as { link: { id: string }; path: string };
  return { linkId: body.link.id, token: body.path.replace(/^\/invite\//, "") };
}

async function accept(her: TestAccount, token: string): Promise<number> {
  return (await acceptPost(call("/api/family/invites/accept", her.tokens.access_token, { token }))).status;
}

async function phoneFor(who: TestAccount, label: string): Promise<TestPhone> {
  const phone = service.newPhone({ label });
  await store.savePushSubscription({ user_id: who.userId, endpoint: phone.endpoint, ...phone.keys });
  return phone;
}

const toPhone = (phone: TestPhone, from: number): PushMessage[] => service.messages.slice(from).filter((m) => m.phone === phone.id);

beforeAll(async () => {
  service = await startPushService();
  setTestClock({ at: "2026-10-13T19:30:00+08:00", frozen: true });
  registerNoticeSender(createWebPushSender({ port: () => storeSubscriptions(pushEntryStore(store)) }));
});
afterAll(async () => {
  registerNoticeSender(null);
  setTestClock(null);
  await service.close();
});

describe("家人接受了: 「Wei Ling 已经接受」 to his phone", () => {
  it("she accepts: one push to his phone, a delivery row in his space, the tap lands on Today's confirm card and is recorded", async () => {
    const him = await account("example");
    const her = await account("none");
    const hisPhone = await phoneFor(him, "his");
    const herPhone = await phoneFor(her, "hers");
    const { linkId, token } = await invite(him, "Wei Ling");
    const from = service.messages.length;
    expect(await accept(her, token)).toBe(200);

    const got = toPhone(hisPhone, from);
    expect(got).toHaveLength(1);
    const today = (await store.getSession(him.userId))!.story_day;
    const rows = (await store.listDeliveries(him.userId)).filter((d) => d.kind === "family_accepted");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ref: linkId, slot: "accept", day: today, opened_at: null });
    expect(got[0].payload).toEqual({
      v: 1,
      kind: "family_accepted",
      title: "Wei Ling 已经接受",
      body: "点开确认一下：你确认以前，对方什么都看不到。",
      url: "/p/today?confirm=1",
      tag: `family-accepted-${linkId}`,
      renotify: false,
      delivery: rows[0].id,
      lang: "zh-Hans",
      sent_at: expect.any(String),
    });
    expect(got[0]).toMatchObject({ status: 201, ttl: MAX_HOLD_S, urgency: "high", topic: topicOf(`family-accepted-${linkId}`) });
    // nothing about his health, no id of his space or of her
    expect(got[0].text).not.toMatch(/amlodipine|氨氯地平|mg|血压|药/i);
    expect(got[0].text).not.toContain(him.userId);
    expect(got[0].text).not.toContain(her.userId);
    // her own phone gets nothing about it
    expect(toPhone(herPhone, from)).toEqual([]);

    // the same link again (a retry, a second server): nothing more
    const link = (await store.getCareLink(linkId))!;
    expect(await notifyInviteAccepted(link)).toEqual({ recorded: false, sent: 0 });
    expect(toPhone(hisPhone, from)).toHaveLength(1);

    // his tap: opened_at on that row; his notifications page lists it; her token cannot mark it
    setTestClock({ at: "2026-10-13T19:31:00+08:00", frozen: true });
    expect((await openedPost(call("/api/push/opened", her.tokens.access_token, { delivery: rows[0].id }))).status).toBe(404);
    const opened = await openedPost(call("/api/push/opened", him.tokens.access_token, { delivery: rows[0].id }));
    expect(await opened.json()).toEqual({ recorded: true, opened_at: "2026-10-13T11:31:00.000Z" });
    const recent = ((await (await statusGet(call("/api/push", him.tokens.access_token))).json()) as { recent: { kind: string; slot: string; opened_at: string | null }[] }).recent;
    expect(recent.filter((r) => r.kind === "family_accepted")).toEqual([expect.objectContaining({ slot: "accept", opened_at: "2026-10-13T11:31:00.000Z" })]);
    setTestClock({ at: "2026-10-13T19:30:00+08:00", frozen: true });
  });

  it("he never turned reminders on (no subscription): the row is recorded, nothing is sent; her acceptance stands", async () => {
    const him = await account("blank");
    const her = await account("none");
    const { linkId, token } = await invite(him, "Wei Ling");
    const from = service.messages.length;
    expect(await accept(her, token)).toBe(200);
    expect(service.messages.slice(from)).toEqual([]);
    expect((await store.listDeliveries(him.userId)).filter((d) => d.kind === "family_accepted" && d.ref === linkId)).toHaveLength(1);
    expect((await store.getCareLink(linkId))?.status).toBe("accepted");
  });

  it("his language; a name he typed that reads like a medicine or a dose never reaches the lock screen", async () => {
    const him = await account("example", "en");
    const her = await account("none");
    const hisPhone = await phoneFor(him, "his en");
    const a = await invite(him, "Wei Ling");
    let from = service.messages.length;
    expect(await accept(her, a.token)).toBe(200);
    expect(toPhone(hisPhone, from)[0].payload).toMatchObject({ title: "Wei Ling has accepted", body: "Open to confirm. Until you do, they see nothing.", lang: "en" });

    const other = await account("none");
    const b = await invite(him, "Amlodipine 5 mg");
    from = service.messages.length;
    expect(await accept(other, b.token)).toBe(200);
    const p = toPhone(hisPhone, from)[0].payload!;
    expect(p).toMatchObject({ kind: "family_accepted", title: "A reminder from Ripple", body: "Open Ripple to see it", url: "/p/today?confirm=1" });
    expect(JSON.stringify(p)).not.toMatch(/amlodipine|5 mg/i);
  });

  it("the words: his own name for her, else 「家人」; nothing the lock-screen rule objects to; only an accepted link", async () => {
    expect(acceptedWords("Wei Ling", "zh-Hans").title).toBe("Wei Ling 已经接受");
    expect(acceptedWords("  ", "zh-Hans").title).toBe("家人 已经接受");
    expect(acceptedWords(null, "en").title).toBe("Your family member has accepted");
    for (const locale of ["zh-Hans", "en"] as const) {
      const w = acceptedWords("Wei Ling", locale);
      expect(lockScreenProblems(w.title)).toEqual([]);
      expect(lockScreenProblems(w.body)).toEqual([]);
    }
    const him = await account("blank");
    const { linkId } = await invite(him, "Wei Ling");
    const invited = (await store.getCareLink(linkId))!;
    expect(await notifyInviteAccepted(invited)).toEqual({ recorded: false, sent: 0 });
    expect((await store.listDeliveries(him.userId)).filter((d) => d.kind === "family_accepted")).toEqual([]);
    // an id that is no account's space, a store that fails: never an exception
    expect(await notifyInviteAccepted({ ...invited, status: "accepted", patient_id: "nobody" })).toEqual({ recorded: false, sent: 0 });
    expect(
      await notifyInviteAccepted(
        { ...invited, status: "accepted" },
        {
          scopeFor: async () => {
            throw new Error("down");
          },
        },
      ),
    ).toEqual({ recorded: false, sent: 0 });
  });
});

describe("whether a notice can reach her at all (his switches screen says so)", () => {
  it("no phone of hers: false; one phone: true; a store that fails: nothing is claimed", async () => {
    const her = await account("none");
    expect(await hasPushSubscription(her.userId, store)).toBe(false);
    const phone = await phoneFor(her, "hers");
    expect(await hasPushSubscription(her.userId, store)).toBe(true);
    await store.deleteOwnPushSubscription(her.userId, phone.endpoint);
    expect(await hasPushSubscription(her.userId, store)).toBe(false);
    const broken = { listPushSubscriptions: async () => Promise.reject(new Error("down")) } as unknown as typeof store;
    expect(await hasPushSubscription(her.userId, broken)).toBe(true);
  });
});

describe("她看到通知: her tap on her alert is recorded, and nothing else of his can be", () => {
  let him: TestAccount;
  let her: TestAccount;
  let aunt: TestAccount;
  let linkId: string;
  let auntLink: string;
  let today: number;

  beforeAll(async () => {
    him = await account("example");
    her = await account("none");
    aunt = await account("none");
    const a = await invite(him, "Wei Ling");
    linkId = a.linkId;
    expect(await accept(her, a.token)).toBe(200);
    expect((await confirmPost(call(`/api/family/links/${linkId}/confirm`, him.tokens.access_token, { yes: true }), params(linkId))).status).toBe(200);
    const b = await invite(him, "Aunt Mei");
    auntLink = b.linkId;
    expect(await accept(aunt, b.token)).toBe(200);
    expect((await confirmPost(call(`/api/family/links/${auntLink}/confirm`, him.tokens.access_token, { yes: true }), params(auntLink))).status).toBe(200);
    today = (await store.getSession(him.userId))!.story_day;
  });

  it("the payload her phone gets carries the delivery id (and still no id of his space)", () => {
    const built = payloadFromNotice({
      kind: "family_no_reply",
      to: { role: "family", userId: her.userId, linkId },
      title: "爸爸尚未回应早上的药提醒",
      body: "8:45 和 9:15 两次提醒均未回应。",
      url: `/f?link=${linkId}`,
      tag: "no-reply-x",
      ttlS: 3600,
      deliveryId: "delivery-1",
      scopeId: him.userId,
      locale: "zh-Hans",
    });
    expect(built.payload.delivery).toBe("delivery-1");
    expect(JSON.stringify(built.payload)).not.toContain(him.userId);
  });

  it("through her link: opened_at on her alert (the first tap's time stays); without the link, or another row: nothing", async () => {
    const alert = (await store.recordDelivery(him.userId, { kind: "family_no_reply", ref: linkId, day: today, slot: "morning" })).delivery;
    const auntAlert = (await store.recordDelivery(him.userId, { kind: "family_no_reply", ref: auntLink, day: today, slot: "morning" })).delivery;
    const dose = (await store.recordDelivery(him.userId, { kind: "dose_first", ref: "dose", day: today, slot: "morning" })).delivery;
    const t = her.tokens.access_token;
    const path = `/api/push/opened?link=${linkId}`;

    // she has no space of her own: without her link the route has nowhere to look
    expect((await openedPost(call("/api/push/opened", t, { delivery: alert.id }))).status).toBe(404);
    // his reminder, the other family member's alert, an unknown id: 404, nothing written
    for (const other of [dose.id, auntAlert.id, "delivery-nope"]) {
      const res = await openedPost(call(path, t, { delivery: other }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "delivery_not_found" });
    }
    // a link that is not hers
    expect((await openedPost(call(`/api/push/opened?link=${auntLink}`, t, { delivery: auntAlert.id }))).status).toBe(404);
    expect((await store.listDeliveries(him.userId, { fromDay: today, toDay: today })).filter((d) => d.opened_at)).toEqual([]);

    setTestClock({ at: "2026-10-13T19:47:00+08:00", frozen: true });
    const res = await openedPost(call(path, t, { delivery: alert.id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: true, opened_at: "2026-10-13T11:47:00.000Z" });
    setTestClock({ at: "2026-10-13T19:55:00+08:00", frozen: true });
    expect(await (await openedPost(call(path, t, { delivery: alert.id }))).json()).toEqual({ recorded: true, opened_at: "2026-10-13T11:47:00.000Z" });
    const after = await store.listDeliveries(him.userId, { fromDay: today, toDay: today });
    expect(after.filter((d) => d.opened_at).map((d) => d.id)).toEqual([alert.id]);

    // he cannot mark her alert from his phone, with or without her link in the address
    expect((await openedPost(call("/api/push/opened", him.tokens.access_token, { delivery: auntAlert.id }))).status).toBe(404);
    expect((await openedPost(call(`/api/push/opened?link=${auntLink}`, him.tokens.access_token, { delivery: auntAlert.id }))).status).toBe(404);
    // his own page does not list her alert among his reminders
    const recent = ((await (await statusGet(call("/api/push", him.tokens.access_token))).json()) as { recent: { kind: string }[] }).recent;
    expect(recent.map((r) => r.kind)).not.toContain("family_no_reply");
    setTestClock({ at: "2026-10-13T19:30:00+08:00", frozen: true });
  });

  it("the family-mode store itself: that one mark, and still no other write of his", async () => {
    const scope = (await store.getSession(him.userId))!;
    const link = (await store.getCareLink(linkId))!;
    const fam = familySubject(store, scope, her.userId, link).store;
    const mine = (await store.recordDelivery(him.userId, { kind: "family_no_reply", ref: linkId, day: today, slot: "evening" })).delivery;
    const his = (await store.recordDelivery(him.userId, { kind: "dose_second", ref: "dose", day: today, slot: "evening" })).delivery;
    const aunts = (await store.recordDelivery(him.userId, { kind: "family_no_reply", ref: auntLink, day: today, slot: "evening" })).delivery;
    await expect(fam.markDeliveryOpened(scope.id, his.id)).rejects.toBeInstanceOf(ScopeViolation);
    await expect(fam.markDeliveryOpened(scope.id, aunts.id)).rejects.toBeInstanceOf(ScopeViolation);
    await expect(fam.markDeliveryOpened(scope.id, "delivery-nope")).rejects.toBeInstanceOf(ScopeViolation);
    await expect(fam.markDeliveryOpened("another-scope", mine.id)).rejects.toBeInstanceOf(ScopeViolation);
    await expect(fam.recordDelivery(scope.id, { kind: "family_no_reply", ref: linkId, day: today, slot: "night" })).rejects.toBeInstanceOf(ScopeViolation);
    await expect(fam.logDose(scope.id, { medication_id: "med-amlodipine", day: today, slot: "morning", state: "taken" } as never)).rejects.toBeInstanceOf(ScopeViolation);
    expect((await fam.markDeliveryOpened(scope.id, mine.id)).opened_at).not.toBeNull();
  });

  it("once he stops sharing: her tap is refused (403) and writes nothing", async () => {
    const alert = (await store.recordDelivery(him.userId, { kind: "family_no_reply", ref: linkId, day: today, slot: "night" })).delivery;
    expect((await revokePost(call(`/api/family/links/${linkId}/revoke`, him.tokens.access_token, {}), params(linkId))).status).toBe(200);
    const res = await openedPost(call(`/api/push/opened?link=${linkId}`, her.tokens.access_token, { delivery: alert.id }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "link_not_active" });
    expect((await store.listDeliveries(him.userId)).find((d) => d.id === alert.id)?.opened_at).toBeNull();
  });
});
