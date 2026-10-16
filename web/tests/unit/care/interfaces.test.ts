/**
 * Track D's interfaces for the other tracks (C2): who may get a family notice (track I), his view of when she looked
 * (track H's 查看记录 and his /p/family), and ending every link before an account is deleted (track H).
 */
import { createHash, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { getBus, type BusEvent } from "@/lib/bus";
import { accessItemWords, accessWords, ACCESS_THROTTLE_MS, careAccessEntries, logLook } from "@/lib/care/access-log";
import { endLinksOf } from "@/lib/care/end";
import { familyRecipients, mayNotifyFamily, recipientsFrom } from "@/lib/care/recipients";
import { getMemoryStore } from "@/lib/store/memory";
import type { CareLinkRow } from "@/lib/store/types";
import { careEntryStore } from "@/lib/subject/care";

const store = getMemoryStore();
const entry = careEntryStore(store);
const login = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const PASSWORD = "a long test password";

async function account(space: "blank" | "none", locale: string | null = null): Promise<TestAccount> {
  return createAccountWithSpace(store, getAuthProvider(), { login: login(space === "none" ? "f" : "p"), password: PASSWORD, space, locale });
}

/** An invited link of his, accepted by her and confirmed by him unless `until` says otherwise. */
async function link(him: TestAccount, her: TestAccount | null, until: "invited" | "accepted" | "active" = "active"): Promise<CareLinkRow> {
  const token = randomUUID();
  const hash = createHash("sha256").update(token).digest("hex");
  const made = await store.createInvite({ patient_id: him.userId, family_label: "Wei Ling", patient_label: "爸爸", relation: "daughter", invite_token_hash: hash, invite_expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() });
  if (!made.ok) throw new Error(made.code);
  if (until === "invited" || !her) return made.link;
  const accepted = await store.acceptInvite(hash, her.userId, "Wei Ling");
  if (!accepted.ok) throw new Error(accepted.code);
  if (until === "accepted") return accepted.link;
  const confirmed = await store.confirmLink(made.link.id, him.userId, true);
  if (!confirmed.ok) throw new Error(confirmed.code);
  return confirmed.link;
}

function capture(channel: string): { events: BusEvent[]; stop(): void } {
  const events: BusEvent[] = [];
  const stop = getBus().subscribe(channel, (e) => events.push(e));
  return { events, stop };
}

describe("recipients of a family notice (track I)", () => {
  let him: TestAccount;
  let her: TestAccount;
  let herEn: TestAccount;
  beforeAll(async () => {
    him = await account("blank");
    her = await account("none");
    herEn = await account("none", "en");
  });

  it("the rule: only active links with a family member, her language, his switch for that link", () => {
    const base = { family_label: "Wei Ling", patient_label: "爸爸", confirmed_at: "2026-10-10T01:00:00.000Z" };
    const links = [
      { ...base, id: "l1", status: "active" as const, family_id: "u1" },
      { ...base, id: "l2", status: "accepted" as const, family_id: "u2" },
      { ...base, id: "l3", status: "invited" as const, family_id: null },
      { ...base, id: "l4", status: "active" as const, family_id: "u4" },
    ];
    const out = recipientsFrom(links, new Map([["l1", { no_reply_alert: true }], ["l4", null]]), new Map([["u4", "en"]]));
    expect(out).toEqual([
      { userId: "u1", linkId: "l1", label: "Wei Ling", patientLabel: "爸爸", locale: "zh-Hans", noReplyAlert: true, confirmedAt: base.confirmed_at },
      { userId: "u4", linkId: "l4", label: "Wei Ling", patientLabel: "爸爸", locale: "en", noReplyAlert: false, confirmedAt: base.confirmed_at },
    ]);
  });

  it("reads his active links through the care store; the switch decides noReplyAlert", async () => {
    const active = await link(him, her);
    await link(him, herEn, "accepted");
    await link(him, null, "invited");
    await store.setFamilyGrant(him.userId, active.id, { no_reply_alert: true });
    const out = await familyRecipients(him.userId, { store: entry });
    expect(out.map((r) => [r.userId, r.linkId, r.noReplyAlert, r.locale])).toEqual([[her.userId, active.id, true, "zh-Hans"]]);
  });

  it("mayNotifyFamily: active, his and hers, and the switch on now; false otherwise (never throws)", async () => {
    const h = await account("blank");
    const w = await account("none");
    const l = await link(h, w);
    const to = { scopeId: h.userId, userId: w.userId, linkId: l.id };
    expect(await mayNotifyFamily(to, "family_no_reply", { store: entry })).toBe(false); // every switch starts off
    await store.setFamilyGrant(h.userId, l.id, { no_reply_alert: true });
    expect(await mayNotifyFamily(to, "family_no_reply", { store: entry })).toBe(true);
    expect(await mayNotifyFamily({ ...to, userId: him.userId }, "family_no_reply", { store: entry })).toBe(false);
    expect(await mayNotifyFamily({ ...to, scopeId: him.userId }, "family_no_reply", { store: entry })).toBe(false);
    expect(await mayNotifyFamily({ ...to, linkId: "no-such-link" }, "family_no_reply", { store: entry })).toBe(false);
    await store.revokeLink(l.id, h.userId, "patient");
    expect(await mayNotifyFamily(to, "family_no_reply", { store: entry })).toBe(false);
  });
});

describe("when she looked (his view; track H)", () => {
  it("logs one look per link, route and sections every ten minutes; his list is newest first, per link", async () => {
    const him = await account("blank");
    const her = await account("none");
    const l = await link(him, her);
    const look = { linkId: l.id, userId: her.userId, label: "Wei Ling", route: "/f", items: ["dose_summary", "bp_summary"] };
    const now = Date.now();
    expect(await logLook(store, him.userId, look, now)).toBe(true);
    expect(await logLook(store, him.userId, { ...look, items: ["bp_summary", "dose_summary"] }, now + 1000)).toBe(false);
    expect(await logLook(store, him.userId, { ...look, items: ["dose_summary"] }, now + 2000)).toBe(true);
    expect(await logLook(store, him.userId, look, now + ACCESS_THROTTLE_MS + 5000)).toBe(true);
    const all = await careAccessEntries(store, { id: him.userId });
    expect(all).toHaveLength(3);
    expect(all.map((e) => e.at)).toEqual([...all.map((e) => e.at)].sort().reverse());
    expect(all.every((e) => e.linkId === l.id && e.who === "Wei Ling" && e.route === "/f")).toBe(true);
    expect(await careAccessEntries(store, { id: him.userId }, { linkId: "another" })).toEqual([]);
    expect(await careAccessEntries(store, { id: him.userId }, { limit: 1 })).toHaveLength(1);
  });

  it("says who looked at what and when, in his language and his time zone", () => {
    const e = { at: "2026-10-10T11:40:00.000Z", who: "Wei Ling", items: ["dose_summary", "bp_summary"] };
    // the owner's decision of 2026-10-14: under the blood pressure and questions switches she looks at the readings and
    // the questions themselves, and his list of her looks says so (it said 「量血压次数」, 「问题个数」)
    expect(accessWords(e, "zh-Hans")).toBe("Wei Ling 看了你的服药情况、血压读数，10月10日 晚上 7:40");
    expect(accessWords(e, "en")).toBe("Wei Ling looked at your medicine check-ins, your blood pressure readings, 10 Oct 7:40 pm");
    expect(accessItemWords(["questions_count"], "zh-Hans")).toBe("你的待问医生的问题");
    expect(accessItemWords(["questions_count"], "en")).toBe("your questions for the doctor");
    expect(accessWords({ ...e, who: null, items: [] }, "zh-Hans")).toBe("家人 看了你分享的内容，10月10日 晚上 7:40");
    expect(accessItemWords(["notes", "notes", "unknown"], "zh-Hans")).toBe("你的笔记");
  });
});

describe("ending every link before an account goes (track H)", () => {
  it("revokes his invited, accepted and active links and leaves her own; each with its event on his channel", async () => {
    const him = await account("blank");
    const her = await account("none");
    const other = await account("blank");
    const a = await link(him, her);
    const b = await link(him, await account("none"), "accepted");
    const c = await link(him, null, "invited");
    const closed = await link(him, await account("none"));
    await store.revokeLink(closed.id, him.userId, "patient");
    const hers = await link(other, him); // he is someone else's family member too
    const mine = capture(him.userId);
    const theirs = capture(other.userId);
    try {
      expect(await endLinksOf(him.userId, { store: entry })).toEqual({ revoked: 3, left: 1 });
    } finally {
      mine.stop();
      theirs.stop();
    }
    for (const id of [a.id, b.id, c.id]) expect((await store.getCareLink(id))?.status).toBe("revoked");
    expect((await store.getCareLink(hers.id))).toMatchObject({ status: "revoked", revoked_by: "family" });
    expect(mine.events.filter((e) => e.type === "care_link.revoked").map((e) => (e.data as { link: { id: string } }).link.id).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(theirs.events.map((e) => [e.type, (e.data as { link: { id: string } }).link.id])).toEqual([["care_link.left", hers.id]]);
    expect(await endLinksOf(him.userId, { store: entry })).toEqual({ revoked: 0, left: 0 });
  });

  it("the care store offers the care flow's methods only", () => {
    expect(() => (entry as unknown as { listMeds: (id: string) => unknown }).listMeds("x")).toThrow(/care flow/);
  });
});
