/**
 * 「爸爸在重设密码」: the notice to his helpers when he asks for help (track A; docs/plan/real-app.md 2.24 last row, 2.4
 * step 3; lib/auth/family-reset-notice.ts), built like the scheduled jobs' notices and sent by track I's web push
 * sender against the local push service (tests/support/push-service.ts):
 *   - who: only family members whose link is active and whose helper switch is on;
 *   - once: a reminder_delivery row per helper and request, so nothing goes twice;
 *   - words: 「爸爸在重设密码」 on the lock screen and nothing of his records, never the code, never an account name;
 *     a label that fails the lock-screen rule is replaced by the fallback words;
 *   - the tap lands on /f?link=<her link>;
 *   - checked again at send time: switched off or ended since, nothing goes.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { deviceHash, newDeviceId } from "@/lib/auth/device";
import { issueFamilyResetCode, requestFamilyHelp, setResetHelper } from "@/lib/auth/family-reset";
import { announceFamilyHelp, mayHelpReset, RESET_HELP_KIND, resetHelpNotice, resetHelpWords } from "@/lib/auth/family-reset-notice";
import type { AccountDeps, Me, RequestFacts } from "@/lib/auth/service";
import { registerNoticeSender, type Notice } from "@/lib/jobs/notify";
import { FALLBACK_WORDS, lockScreenProblems, payloadFromNotice } from "@/lib/push/payload";
import { createWebPushSender, storeSubscriptions } from "@/lib/push/sender";
import { MemoryStore } from "@/lib/store/memory";
import { careEntryStore } from "@/lib/subject/care";
import { pushEntryStore } from "@/lib/subject/push";
import { startPushService, type PushService } from "../../support/push-service";

const auth = getAuthProvider();
let service: PushService;
beforeAll(async () => {
  service = await startPushService();
});
afterAll(async () => {
  await service.close();
  registerNoticeSender(null);
});
afterEach(() => vi.restoreAllMocks());

interface World {
  store: MemoryStore;
  d: AccountDeps;
  him: TestAccount;
  her: TestAccount;
  hisPhone: RequestFacts;
  linkId: string;
  herPush: ReturnType<PushService["newPhone"]>;
  hisPush: ReturnType<PushService["newPhone"]>;
  sent: Notice[];
}

const meOf = (a: TestAccount): Me => ({ userId: a.userId, sessionId: null, account: a.account, email: null, ephemeral: false });

/** Him (with a space), her, an active link (how she calls him: `calls`), her phone subscribed, his phone a used device. */
async function world(opts: { calls?: string | null; herLocale?: "zh-Hans" | "en" } = {}): Promise<World> {
  const store = new MemoryStore();
  const him = await createAccountWithSpace(store, auth, { login: `n${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  const her = await createAccountWithSpace(store, auth, { login: `w${randomUUID().slice(0, 10)}`, password: "a long test password", space: "none" });
  if (opts.herLocale) await store.updateAccount(her.userId, { locale: opts.herLocale });
  const hash = randomUUID();
  const inv = await store.createInvite({ patient_id: him.userId, family_label: "Wei Ling", patient_label: opts.calls === undefined ? "爸爸" : opts.calls, invite_token_hash: hash, invite_expires_at: "2099-01-01T00:00:00.000Z" });
  if (!inv.ok) throw new Error(inv.code);
  await store.acceptInvite(hash, her.userId, "Wei Ling");
  await store.confirmLink(inv.link.id, him.userId, true);
  const deviceId = newDeviceId();
  await store.touchKnownDevice(him.userId, deviceHash(deviceId), "iPhone · Safari");
  const herPush = service.newPhone({ label: "hers" });
  const hisPush = service.newPhone({ label: "his" });
  await store.savePushSubscription({ user_id: her.userId, endpoint: herPush.endpoint, ...herPush.keys });
  await store.savePushSubscription({ user_id: him.userId, endpoint: hisPush.endpoint, ...hisPush.keys });
  const sent: Notice[] = [];
  // the real sender (track I's), with the checks reading this test's store
  const sender = createWebPushSender({ port: () => storeSubscriptions(pushEntryStore(store)), mayHelpReset: (to) => mayHelpReset(to, { store: careEntryStore(store) }) });
  const d: AccountDeps = {
    store,
    auth,
    env: { NODE_ENV: "test" },
    sendNotice: async (notice, s) => {
      sent.push(notice);
      return sender(notice, s);
    },
  };
  return { store, d, him, her, hisPhone: { ip: "10.0.0.7", deviceId, knownDevice: true, userAgent: null }, linkId: inv.link.id, herPush, hisPush, sent };
}

const toPhone = (id: string, from: number) => service.messages.slice(from).filter((m) => m.phone === id);

describe("the words", () => {
  it("how she calls him, then 「在重设密码」; 「家人」 without a name; nothing else on the lock screen", () => {
    expect(resetHelpWords("爸爸", "zh-Hans")).toEqual({ title: "爸爸在重设密码", body: "打开 Ripple 看看" });
    expect(resetHelpWords(null, "zh-Hans")).toEqual({ title: "家人在重设密码", body: "打开 Ripple 看看" });
    expect(resetHelpWords("  ", "zh-Hans").title).toBe("家人在重设密码");
    expect(resetHelpWords("Dad", "en")).toEqual({ title: "Dad is resetting their password", body: "Open Ripple to see it" });
    expect(resetHelpWords(undefined, "en").title).toBe("Your family member is resetting their password");
    for (const w of [resetHelpWords("爸爸", "zh-Hans"), resetHelpWords("Dad", "en")]) expect([...lockScreenProblems(w.title), ...lockScreenProblems(w.body)]).toEqual([]);
  });

  it("the notice: to her through her link, lands on /f?link=, lives as long as the request, one tag per request", () => {
    const n = resetHelpNotice({ scopeId: "scope-secret", link: { id: "link-1", family_id: "her-id", patient_label: "爸爸" }, request: { id: "req-9" }, deliveryId: "delivery-3", locale: "zh-Hans", ttlS: 600 });
    expect(n).toEqual({
      kind: "family_reset_help",
      to: { role: "family", userId: "her-id", linkId: "link-1" },
      title: "爸爸在重设密码",
      body: "打开 Ripple 看看",
      url: "/f?link=link-1",
      tag: "reset-help-req-9",
      ttlS: 600,
      deliveryId: "delivery-3",
      scopeId: "scope-secret",
      locale: "zh-Hans",
    });
    const built = payloadFromNotice(n);
    expect(built.replaced).toBe(false);
    expect(built.payload).toMatchObject({ kind: "family_reset_help", title: "爸爸在重设密码", url: "/f?link=link-1", tag: "reset-help-req-9", delivery: "delivery-3", renotify: false });
    expect(JSON.stringify(built.payload)).not.toContain("scope-secret");
  });

  it("a name for him that reads like a medicine or a dose never reaches the lock screen", () => {
    const n = resetHelpNotice({ scopeId: "s", link: { id: "l", family_id: "h", patient_label: "Amlodipine 5 mg" }, request: { id: "r" }, deliveryId: "d", locale: "zh-Hans", ttlS: 600 });
    const built = payloadFromNotice(n);
    expect(built.replaced).toBe(true);
    expect(built.payload).toMatchObject({ title: FALLBACK_WORDS["zh-Hans"].title, body: FALLBACK_WORDS["zh-Hans"].body, url: "/f?link=l" });
  });
});

describe("he asks for help: his helper's phone is told, once", () => {
  it("her phone gets 「爸爸在重设密码」 that opens /f?link=; his own phone gets nothing; no code, no login, no ids in it", async () => {
    const w = await world();
    await setResetHelper(w.d, meOf(w.him), { link_id: w.linkId, on: true });
    const from = service.messages.length;
    const asked = await requestFamilyHelp(w.d, { login: w.him.account.username! }, w.hisPhone);
    expect(asked.ok).toBe(true);
    const got = toPhone(w.herPush.id, from);
    expect(got).toHaveLength(1);
    const request = (await w.store.listResetRequests(w.him.userId)).at(-1)!;
    expect(got[0].payload).toEqual({
      v: 1,
      kind: "family_reset_help",
      title: "爸爸在重设密码",
      body: "打开 Ripple 看看",
      url: `/f?link=${w.linkId}`,
      tag: `reset-help-${request.id}`,
      renotify: false,
      delivery: expect.any(String),
      lang: "zh-Hans",
      sent_at: expect.any(String),
    });
    expect(got[0]).toMatchObject({ status: 201, ttl: 600, urgency: "high" });
    for (const secret of [w.him.userId, w.her.userId, w.him.account.username!, "Amlodipine", "氨氯地平"]) expect(got[0].text).not.toContain(secret);
    expect(toPhone(w.hisPush.id, from)).toEqual([]);
    // the delivery row that makes it "once": in his scope, for her link and this request
    const rows = (await w.store.listDeliveries(w.him.userId)).filter((r) => r.kind === RESET_HELP_KIND);
    expect(rows.map((r) => [r.ref, r.slot])).toEqual([[w.linkId, request.id]]);
    // she then taps 帮: the code is in her page's answer, never in a notice
    const code = await issueFamilyResetCode(w.d, meOf(w.her), w.linkId);
    if (!code.ok) throw new Error("code");
    expect(service.messages.slice(from).some((m) => (m.text ?? "").includes(code.code))).toBe(false);
    expect(toPhone(w.herPush.id, from)).toHaveLength(1);
  });

  it("the same request never tells her twice; a new request tells her again", async () => {
    const w = await world();
    await setResetHelper(w.d, meOf(w.him), { link_id: w.linkId, on: true });
    const from = service.messages.length;
    await requestFamilyHelp(w.d, { login: w.him.account.username! }, w.hisPhone);
    const request = (await w.store.listResetRequests(w.him.userId)).at(-1)!;
    const scope = (await w.store.getSession(w.him.userId))!;
    const helpers = await w.store.listCareLinks({ patient_id: w.him.userId, status: ["active"] });
    expect(await announceFamilyHelp(w.store, scope, helpers, request, 600, w.d.sendNotice)).toBe(0); // already recorded
    expect(toPhone(w.herPush.id, from)).toHaveLength(1);
    await requestFamilyHelp(w.d, { login: w.him.account.username! }, w.hisPhone);
    expect(toPhone(w.herPush.id, from)).toHaveLength(2);
    expect(new Set(toPhone(w.herPush.id, from).map((m) => m.payload?.tag)).size).toBe(2);
  });

  it("only helpers he switched on: a second family member with the switch off is told nothing; her language is hers", async () => {
    const w = await world({ herLocale: "en", calls: "Dad" });
    const other = await createAccountWithSpace(w.store, auth, { login: `j${randomUUID().slice(0, 10)}`, password: "a long test password", space: "none" });
    const hash = randomUUID();
    const inv = await w.store.createInvite({ patient_id: w.him.userId, family_label: "Jun", patient_label: "爸", invite_token_hash: hash, invite_expires_at: "2099-01-01T00:00:00.000Z" });
    if (!inv.ok) throw new Error(inv.code);
    await w.store.acceptInvite(hash, other.userId, "Jun");
    await w.store.confirmLink(inv.link.id, w.him.userId, true);
    const otherPush = service.newPhone({ label: "jun" });
    await w.store.savePushSubscription({ user_id: other.userId, endpoint: otherPush.endpoint, ...otherPush.keys });
    await setResetHelper(w.d, meOf(w.him), { link_id: w.linkId, on: true });
    const from = service.messages.length;
    const asked = await requestFamilyHelp(w.d, { login: w.him.account.username! }, w.hisPhone);
    expect(asked).toMatchObject({ ok: true, helpers: ["Wei Ling"] });
    expect(w.sent.map((n) => n.to)).toEqual([{ role: "family", userId: w.her.userId, linkId: w.linkId }]);
    expect(toPhone(otherPush.id, from)).toEqual([]);
    expect(toPhone(w.herPush.id, from).map((m) => [m.payload?.title, m.payload?.body, m.payload?.lang])).toEqual([["Dad is resetting their password", "Open Ripple to see it", "en"]]);
  });

  it("nothing is announced when asking is refused (the switch off, another phone, an unknown login)", async () => {
    const w = await world();
    const from = service.messages.length;
    expect(await requestFamilyHelp(w.d, { login: w.him.account.username! }, w.hisPhone)).toMatchObject({ status: 403 });
    await setResetHelper(w.d, meOf(w.him), { link_id: w.linkId, on: true });
    expect(await requestFamilyHelp(w.d, { login: w.him.account.username! }, { ...w.hisPhone, deviceId: newDeviceId() })).toMatchObject({ status: 403 });
    expect(await requestFamilyHelp(w.d, { login: "nobody-at-all" }, w.hisPhone)).toMatchObject({ status: 403 });
    expect(w.sent).toEqual([]);
    expect(service.messages.slice(from)).toEqual([]);
    expect((await w.store.listDeliveries(w.him.userId)).filter((r) => r.kind === RESET_HELP_KIND)).toEqual([]);
  });

  it("a sender that fails does not stop him from asking", async () => {
    const w = await world();
    await setResetHelper(w.d, meOf(w.him), { link_id: w.linkId, on: true });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const d: AccountDeps = {
      ...w.d,
      sendNotice: async () => {
        throw new Error("push service down");
      },
    };
    const asked = await requestFamilyHelp(d, { login: w.him.account.username! }, w.hisPhone);
    expect(asked.ok).toBe(true);
    expect((await issueFamilyResetCode(d, meOf(w.her), w.linkId)).ok).toBe(true);
  });
});

describe("checked again right before sending (track I's sender)", () => {
  it("his switch went off, or the link ended, between recording and sending: nothing goes", async () => {
    const w = await world();
    await setResetHelper(w.d, meOf(w.him), { link_id: w.linkId, on: true });
    const sender = createWebPushSender({ port: () => storeSubscriptions(pushEntryStore(w.store)), mayHelpReset: (to) => mayHelpReset(to, { store: careEntryStore(w.store) }) });
    const notice = resetHelpNotice({ scopeId: w.him.userId, link: { id: w.linkId, family_id: w.her.userId, patient_label: "爸爸" }, request: { id: randomUUID() }, deliveryId: "d", locale: "zh-Hans", ttlS: 600 });
    const from = service.messages.length;
    expect(await sender(notice, w.store)).toEqual({ sent: 1 });
    await setResetHelper(w.d, meOf(w.him), { link_id: w.linkId, on: false });
    expect(await sender(notice, w.store)).toEqual({ sent: 0 });
    await setResetHelper(w.d, meOf(w.him), { link_id: w.linkId, on: true });
    // a notice that names someone who is not on that link, or a link that is not his: nothing
    expect(await sender({ ...notice, to: { role: "family", userId: w.him.userId, linkId: w.linkId } }, w.store)).toEqual({ sent: 0 });
    expect(await sender({ ...notice, scopeId: w.her.userId }, w.store)).toEqual({ sent: 0 });
    expect(await sender({ ...notice, to: { role: "family", userId: w.her.userId, linkId: randomUUID() } }, w.store)).toEqual({ sent: 0 });
    await w.store.revokeLink(w.linkId, w.him.userId, "patient");
    expect(await sender(notice, w.store)).toEqual({ sent: 0 });
    expect(toPhone(w.herPush.id, from)).toHaveLength(1);
  });

  it("mayHelpReset: active, his and hers, the switch on; anything else (and a store that fails) is no", async () => {
    const w = await world();
    const to = { scopeId: w.him.userId, userId: w.her.userId, linkId: w.linkId };
    const store = careEntryStore(w.store);
    expect(await mayHelpReset(to, { store })).toBe(false); // off until he turns it on
    await setResetHelper(w.d, meOf(w.him), { link_id: w.linkId, on: true });
    expect(await mayHelpReset(to, { store })).toBe(true);
    expect(await mayHelpReset({ ...to, userId: randomUUID() }, { store })).toBe(false);
    expect(await mayHelpReset({ ...to, scopeId: randomUUID() }, { store })).toBe(false);
    vi.spyOn(w.store, "getCareLink").mockRejectedValue(new Error("down"));
    expect(await mayHelpReset(to, { store: careEntryStore(w.store) })).toBe(false);
  });
});
