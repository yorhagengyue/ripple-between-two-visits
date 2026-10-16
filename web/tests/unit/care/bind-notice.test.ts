/**
 * 「Wei Ling 绑定了你的账号」: the notice to his phone when a family member binds his account by typing it (line bind;
 * lib/push/bound.ts). Through the real bind route and the registered web push sender, against the local push service
 * (tests/support/push-service.ts), on the process-wide memory store:
 *
 *   once per link, to his own phones only; her phone gets nothing, and he gets nothing for a link he bound himself
 *   the lock-screen words, in his language; the tap lands on Today's card (/p/today?confirm=1)
 *   a delivery row of its own kind in his space (family_bound, slot "bind"), which his notifications page does not list
 *   a name that reads like a medicine never reaches the lock screen; a name that is not a name is not on the link at all
 *   in confirm mode it is the invitation's own notice instead, 「Wei Ling 已经接受」
 *   never throws
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as bindPost } from "@/app/api/family/bind/route";
import { POST as openedPost } from "@/app/api/push/opened/route";
import { GET as statusGet } from "@/app/api/push/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { registerNoticeSender } from "@/lib/jobs/notify";
import { BIND_SLOT, BOUND_URL, boundWords, FAMILY_BOUND, notifyFamilyBound } from "@/lib/push/bound";
import { HIS_KINDS } from "@/lib/push/deliveries";
import { FALLBACK_WORDS, lockScreenProblems } from "@/lib/push/payload";
import { topicOf } from "@/lib/push/send";
import { createWebPushSender, MAX_HOLD_S, storeSubscriptions } from "@/lib/push/sender";
import { getMemoryStore } from "@/lib/store/memory";
import { pushEntryStore } from "@/lib/subject/push";
import { startPushService, type PushMessage, type PushService, type TestPhone } from "../../support/push-service";

const store = getMemoryStore();
const auth = getAuthProvider();
let service: PushService;

const id = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const elder = (locale: "zh-Hans" | "en" = "zh-Hans"): Promise<TestAccount> => createAccountWithSpace(store, auth, { login: id("t"), password: "a long test password", space: "example", locale, display_name: "陈先生" });
const family = (display: string | null = "Wei Ling", loginName = id("w")): Promise<TestAccount> => createAccountWithSpace(store, auth, { login: loginName, password: "a long test password", space: "none", display_name: display });
const shown = (a: TestAccount) => (a.login.kind === "username" ? a.login.username : a.login.email);

function call(path: string, token: string | null, body?: unknown): NextRequest {
  const headers: Record<string, string> = {};
  if (token) headers.cookie = `rp_at=${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${path}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function bind(who: TestAccount, account: string): Promise<string> {
  const res = await bindPost(call("/api/family/bind", who.tokens.access_token, { account }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { link: { id: string } }).link.id;
}

async function phoneFor(who: TestAccount, label: string): Promise<TestPhone> {
  const phone = service.newPhone({ label });
  await store.savePushSubscription({ user_id: who.userId, endpoint: phone.endpoint, ...phone.keys });
  return phone;
}
const toPhone = (phone: TestPhone, from: number): PushMessage[] => service.messages.slice(from).filter((m) => m.phone === phone.id);
const boundRows = async (him: TestAccount) => (await store.listDeliveries(him.userId)).filter((d) => d.kind === FAMILY_BOUND);

beforeAll(async () => {
  service = await startPushService();
  registerNoticeSender(createWebPushSender({ port: () => storeSubscriptions(pushEntryStore(store)) }));
});
afterAll(async () => {
  registerNoticeSender(null);
  await service.close();
});

describe("she binds his account: 「Wei Ling 绑定了你的账号」 to his phone", () => {
  it("one push to his phone, a delivery row of its own kind in his space, the tap lands on Today's card; nothing to her phone, nothing twice", async () => {
    const him = await elder();
    const her = await family();
    const hisPhone = await phoneFor(him, "his");
    const herPhone = await phoneFor(her, "hers");
    const from = service.messages.length;
    const linkId = await bind(her, shown(him));

    const got = toPhone(hisPhone, from);
    expect(got).toHaveLength(1);
    const rows = await boundRows(him);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "family_bound", ref: linkId, slot: BIND_SLOT, day: (await store.getSession(him.userId))!.story_day, opened_at: null });
    expect(got[0].payload).toEqual({
      v: 1,
      // the family notice kind that exists; what happened is on the delivery row (lib/push/bound.ts says why)
      kind: "family_accepted",
      title: "Wei Ling 绑定了你的账号",
      body: "点开看看对方能看到什么。不认识就解除。",
      url: "/p/today?confirm=1",
      tag: `family-bound-${linkId}`,
      renotify: false,
      delivery: rows[0].id,
      lang: "zh-Hans",
      sent_at: expect.any(String),
    });
    expect(BOUND_URL).toBe("/p/today?confirm=1");
    expect(got[0]).toMatchObject({ status: 201, ttl: MAX_HOLD_S, urgency: "high", topic: topicOf(`family-bound-${linkId}`) });
    // nothing about his health, no id of his space or of her
    expect(got[0].text).not.toMatch(/amlodipine|氨氯地平|mg|血压|药/i);
    expect(got[0].text).not.toContain(him.userId);
    expect(got[0].text).not.toContain(her.userId);
    expect(toPhone(herPhone, from)).toEqual([]);

    // the same request again, and the same link told again (a retry, a second server): nothing more
    await bind(her, shown(him));
    expect(await notifyFamilyBound((await store.getCareLink(linkId))!)).toEqual({ recorded: false, sent: 0 });
    expect(toPhone(hisPhone, from)).toHaveLength(1);
    expect(await boundRows(him)).toHaveLength(1);

    // not one of the kinds his notifications page lists, so it is not shown there under words that are another notice's,
    // and its tap is not marked (the card on Today is what he answers)
    expect(HIS_KINDS.has(FAMILY_BOUND)).toBe(false);
    const recent = ((await (await statusGet(call("/api/push", him.tokens.access_token))).json()) as { recent: { kind: string }[] }).recent;
    expect(recent.filter((r) => r.kind === "family_bound" || r.kind === "family_accepted")).toEqual([]);
    const opened = await openedPost(call("/api/push/opened", him.tokens.access_token, { delivery: rows[0].id }));
    expect([opened.status, await opened.json()]).toEqual([404, { error: "delivery_not_found" }]);
  });

  it("his language", async () => {
    const him = await elder("en");
    const her = await family();
    const hisPhone = await phoneFor(him, "his en");
    const from = service.messages.length;
    await bind(her, shown(him));
    expect(toPhone(hisPhone, from).map((m) => m.payload)).toEqual([expect.objectContaining({ title: "Wei Ling linked to your account", body: "Open to see what they can see. Remove them if you do not know them.", lang: "en", url: "/p/today?confirm=1" })]);
  });

  it("he never turned reminders on (no subscription): the row is recorded, nothing is sent, the binding stands", async () => {
    const him = await elder();
    const her = await family();
    const from = service.messages.length;
    const linkId = await bind(her, shown(him));
    expect(service.messages.slice(from)).toEqual([]);
    expect((await boundRows(him)).map((d) => d.ref)).toEqual([linkId]);
    expect((await store.getCareLink(linkId))?.status).toBe("active");
  });

  it("a link he bound himself sends nothing to anyone", async () => {
    const him = await elder();
    const her = await family();
    await phoneFor(him, "his own");
    await phoneFor(her, "hers own");
    const from = service.messages.length;
    await bind(him, shown(her));
    expect(service.messages.slice(from)).toEqual([]);
    expect(await boundRows(him)).toEqual([]);
  });
});

describe("the name on his lock screen is one she chose herself", () => {
  it("a name that reads like a medicine: the plain fallback words go out instead", async () => {
    const him = await elder();
    const her = await family("Amlodipine");
    const hisPhone = await phoneFor(him, "his");
    const from = service.messages.length;
    const linkId = await bind(her, shown(him));
    const p = toPhone(hisPhone, from)[0].payload!;
    expect(p).toMatchObject({ ...FALLBACK_WORDS["zh-Hans"], url: "/p/today?confirm=1", tag: `family-bound-${linkId}` });
    expect(JSON.stringify(p)).not.toMatch(/amlodipine/i);
  });

  it("a name that is not a name (a number to call, a sentence) is not on the link: her account name stands there", async () => {
    const him = await elder();
    const her = await family("紧急：请打 9123 4567", id("weiling"));
    const hisPhone = await phoneFor(him, "his");
    const from = service.messages.length;
    const linkId = await bind(her, shown(him));
    expect((await store.getCareLink(linkId))?.family_label).toBe(her.account.username);
    const p = toPhone(hisPhone, from)[0].payload!;
    expect(p.title).toBe(`${her.account.username} 绑定了你的账号`);
    expect(JSON.stringify(p)).not.toMatch(/9123|紧急/);
  });

  it("the words themselves: clean on a lock screen, with a plain stand-in for no name", () => {
    expect(boundWords("Wei Ling", "zh-Hans")).toEqual({ title: "Wei Ling 绑定了你的账号", body: "点开看看对方能看到什么。不认识就解除。" });
    expect(boundWords("Wei Ling", "en")).toEqual({ title: "Wei Ling linked to your account", body: "Open to see what they can see. Remove them if you do not know them." });
    expect(boundWords(null, "zh-Hans").title).toBe("有人 绑定了你的账号");
    expect(boundWords("   ", "en").title).toBe("Someone linked to your account");
    expect(boundWords("x".repeat(60), "en").title).toBe(`${"x".repeat(40)} linked to your account`);
    for (const locale of ["zh-Hans", "en"] as const) {
      for (const name of ["Wei Ling", null]) {
        const w = boundWords(name, locale);
        expect([...lockScreenProblems(w.title), ...lockScreenProblems(w.body)]).toEqual([]);
        expect(`${w.title}${w.body}`).not.toMatch(/[{}]|undefined|null/);
      }
    }
  });
});

describe("when it is not sent, and that it never throws", () => {
  it("a link that is not in force, a patient that is nobody's space, a store that fails: nothing sent, nothing thrown", async () => {
    const him = await elder();
    const her = await family();
    const linkId = await bind(her, shown(him));
    const link = (await store.getCareLink(linkId))!;
    expect(await notifyFamilyBound({ ...link, id: randomUUID(), status: "accepted" })).toEqual({ recorded: false, sent: 0 });
    expect(await notifyFamilyBound({ ...link, id: randomUUID(), patient_id: "nobody" })).toEqual({ recorded: false, sent: 0 });
    expect(
      await notifyFamilyBound(
        { ...link, id: randomUUID() },
        {
          scopeFor: async () => {
            throw new Error("the store is away");
          },
        },
      ),
    ).toEqual({ recorded: false, sent: 0 });
    // a sender that fails: the row says it was due, the answer says nothing went
    expect(
      await notifyFamilyBound(
        { ...link, id: randomUUID() },
        {
          send: async () => {
            throw new Error("push is away");
          },
        },
      ),
    ).toEqual({ recorded: false, sent: 0 });
    expect(await boundRows(him)).toHaveLength(2);
  });

  it("FAMILY_BIND_MODE=confirm: his phone gets the invitation's own notice, 「Wei Ling 已经接受」, and no bound one", async () => {
    const saved = process.env.FAMILY_BIND_MODE;
    process.env.FAMILY_BIND_MODE = "confirm";
    try {
      const him = await elder();
      const her = await family();
      const hisPhone = await phoneFor(him, "his");
      const from = service.messages.length;
      const linkId = await bind(her, shown(him));
      expect(toPhone(hisPhone, from).map((m) => m.payload)).toEqual([expect.objectContaining({ kind: "family_accepted", title: "Wei Ling 已经接受", url: "/p/today?confirm=1", tag: `family-accepted-${linkId}` })]);
      expect(await boundRows(him)).toEqual([]);
      expect((await store.listDeliveries(him.userId)).filter((d) => d.kind === "family_accepted").map((d) => [d.ref, d.slot])).toEqual([[linkId, "accept"]]);
    } finally {
      if (saved === undefined) delete process.env.FAMILY_BIND_MODE;
      else process.env.FAMILY_BIND_MODE = saved;
    }
  });
});
