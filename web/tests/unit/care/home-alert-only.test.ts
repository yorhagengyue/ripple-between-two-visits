/**
 * Her home when he has switched on only 「两次提醒没回时通知她」 (no_reply_alert) and 「每天吃药了没有」 (dose_summary) is
 * off (C2 track D, lib/care/home.ts; found by track I): while an alert is open her home shows the alert as it does with
 * the dose switch on — 「爸爸尚未回应早上的药提醒。」, the amber state, the alert's timeline — and still never a medicine name,
 * a taken / not-taken state or the week. Once he answers after the window, it says only that he answered.
 *
 * Mr Tan's example account laid out on Tue 13 Oct 2026 07:30 (morning reminders 08:45 / 09:15, window closes 09:45);
 * the jobs run through track B's runDoseDay; the developer test clock, frozen.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { familyHome } from "@/lib/care/home";
import type { FamilyHomeData } from "@/lib/care/home-types";
import { homeHeadline, timelineItems } from "@/lib/care/her-view";
import { answerDose } from "@/lib/daily/doses";
import { runDoseDay, type LinkWithSwitch } from "@/lib/daily/dose-run";
import { NO_GRANTS } from "@/lib/family/types";
import { MemoryStore } from "@/lib/store/memory";
import type { CareLinkRow, FamilyGrantItems, SessionRow } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";

const store = new MemoryStore();
const auth = getAuthProvider();
const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;
const TZ = "Asia/Singapore";
const ALERT_ONLY: FamilyGrantItems = { ...NO_GRANTS, no_reply_alert: true };
const ALERT_AND_DOSES: FamilyGrantItems = { ...NO_GRANTS, no_reply_alert: true, dose_summary: true };
/** the reason he gives at 10:05 for not taking it, in words nothing else in his records holds */
const REASON = "去喝早茶了，回来再吃";
/**
 * what the dose switch would share: a medicine's name, an answer state, a dose mark; and, since the owner's decision of
 * 2026-10-14, the reason of a dose he did not take (the cell's field and his words)
 */
const DOSE_WORDS = /Amlodipine|"taken"|"missed"|"mixed"|吃了|没吃|"reason"|去喝早茶了/;
/** her home without her own reminder (hers to see whatever his switches; the stand-in says 「早餐吃了吗」) */
const hisPart = (h: FamilyHomeData) => JSON.stringify({ ...h, reminder: null });

function setClock(iso: string): number {
  setTestClock({ at: iso, frozen: true });
  return Date.parse(iso);
}

let him: TestAccount;
let link: CareLinkRow;

async function scope(): Promise<SessionRow> {
  const s = await store.getSession(him.userId);
  if (!s) throw new Error("no scope");
  return s;
}

async function home(grants: FamilyGrantItems, now: number): Promise<FamilyHomeData> {
  return familyHome(store, await scope(), { link, grants }, now);
}

async function tick(at: string): Promise<void> {
  const now = setClock(at);
  const links = async (): Promise<LinkWithSwitch[]> => [{ link: (await store.getCareLink(link.id))!, noReplyAlert: true, locale: "zh-Hans" }];
  await runDoseDay(store, await scope(), now, { links, send: async () => ({ sent: 1 }) });
}

beforeAll(async () => {
  setClock(SGT("2026-10-13", "07:30"));
  him = await createAccountWithSpace(store, auth, { login: `d${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  const her = await createAccountWithSpace(store, auth, { login: `w${randomUUID().slice(0, 10)}`, password: "a long test password", space: "none" });
  const inv = await store.createInvite(
    { patient_id: him.userId, patient_label: "爸爸", invite_token_hash: randomUUID(), invite_expires_at: "2099-01-01T00:00:00.000Z" },
    ALERT_ONLY,
  );
  if (!inv.ok) throw new Error(inv.code);
  const acc = await store.acceptInvite(inv.link.invite_token_hash!, her.userId, "Wei Ling");
  if (!acc.ok) throw new Error(acc.code);
  const ok = await store.confirmLink(inv.link.id, him.userId, true);
  if (!ok.ok) throw new Error(ok.code);
  link = ok.link;
});

afterAll(() => setTestClock(null));

describe("only the no-reply switch on", () => {
  it("before the window closes: no alert, so nothing of his medicine (the switch's own sentence)", async () => {
    await tick(SGT("2026-10-13", "08:45"));
    const h = await home(ALERT_ONLY, Date.parse(SGT("2026-10-13", "08:50")));
    expect(h.status).toBeNull();
    expect(h.noReply).toBeNull();
    expect(h.week).toBeNull();
    expect(h.timeline).toEqual([]);
    expect(homeHeadline(h, "爸爸", "zh-Hans", TZ).title).toBe("爸爸未回应提醒时会通知你。");
  });

  it("an open alert: titled 「爸爸尚未回应早上的药提醒。」 in amber, the alert's timeline, no names, no states, no week", async () => {
    await tick(SGT("2026-10-13", "09:15"));
    await tick(SGT("2026-10-13", "09:45"));
    const now = Date.parse(SGT("2026-10-13", "09:46"));
    const h = await home(ALERT_ONLY, now);
    expect(h.status?.state).toBe("no_reply");
    const head = homeHeadline(h, "爸爸", "zh-Hans", TZ);
    expect(head).toMatchObject({ title: "爸爸尚未回应早间药物提醒。", detail: "两次提醒均未回应。", tone: "chk" });
    expect(homeHeadline(h, "Dad", "en", TZ).title).toBe("Dad hasn't answered about his morning medicine.");
    expect(h.noReply).toMatchObject({ answeredSince: false, answer: null });
    expect(h.noReply?.sentAt).toBeTruthy();
    expect(h.noReply?.slot.cells).toEqual([]);
    expect(h.status?.slot?.cells).toEqual([]);
    expect(h.timeline.map((l) => [l.kind, l.unanswered ?? false])).toEqual([
      ["reminded", true],
      ["reminded_again", true],
      ["told_you", false],
    ]);
    expect(timelineItems(h.timeline, { tz: TZ, locale: "zh-Hans", yourVoice: false, herWords: null }).map((i) => `${i.when} ${i.what}${i.tag ? `，${i.tag}` : ""}`)).toEqual([
      "8:45 已提醒，未回应",
      "9:15 再次提醒，未回应",
      "9:45 记录为未回应，已通知你",
    ]);
    expect(h.week).toBeNull();
    expect(h.lastRecord).toBeNull();
    expect(hisPart(h)).not.toMatch(DOSE_WORDS);

    // the same moment with the dose switch on as well: the same headline, plus what that switch shares
    const both = await home(ALERT_AND_DOSES, now);
    expect(homeHeadline(both, "爸爸", "zh-Hans", TZ).title).toBe("爸爸尚未回应早间药物提醒。");
    expect(both.week).not.toBeNull();
    expect(both.noReply?.slot.cells.map((c) => c.name)).toEqual(["Amlodipine"]);
  });

  it("he answers at 10:02: 「爸爸 10:02 回了早上的药提醒。」, a neutral line, and still not what he answered", async () => {
    const now = setClock(SGT("2026-10-13", "10:02"));
    await answerDose(store, await scope(), { medication_id: "med-amlodipine", slot: "morning", state: "taken" }, now);
    const h = await home(ALERT_ONLY, now);
    expect(h.status?.state).toBe("answered");
    expect(homeHeadline(h, "爸爸", "zh-Hans", TZ)).toMatchObject({ title: "爸爸已于 10:02 回应早间药物提醒。", tone: "quiet" });
    expect(homeHeadline(h, "Dad", "en", TZ).title).toBe("Dad answered the morning medicine reminder at 10:02.");
    expect(h.noReply).toMatchObject({ answeredSince: true, answer: null });
    expect(h.timeline.map((l) => l.kind)).toEqual(["reminded", "reminded_again", "told_you", "answered"]);
    expect(timelineItems(h.timeline, { tz: TZ, locale: "zh-Hans", yourVoice: false, herWords: null }).at(-1)).toMatchObject({ when: "10:02", what: "已回应提醒", tone: "quiet" });
    expect(h.week).toBeNull();
    expect(hisPart(h)).not.toMatch(DOSE_WORDS);

    // with the dose switch on, the same answer is said as it is
    expect(homeHeadline(await home(ALERT_AND_DOSES, now), "爸爸", "zh-Hans", TZ).title).toBe("爸爸已于 10:02 服用早间药物。");
  });

  // The owner's decision of 2026-10-14 widened what 「每天吃药的情况」 shows (the reason of a dose he did not take).
  // Alert-only mode is exactly what it was: that he answered and when, never what he answered and never why.
  it("at 10:05 he says he did not take it, and why: alert-only still says only that he answered; the reason is the dose switch's", async () => {
    const now = setClock(SGT("2026-10-13", "10:05"));
    await answerDose(store, await scope(), { medication_id: "med-amlodipine", slot: "morning", state: "missed", reason: "own_words", reason_text: REASON }, now);
    const h = await home(ALERT_ONLY, now);
    expect(h.status?.state).toBe("answered");
    expect(homeHeadline(h, "爸爸", "zh-Hans", TZ)).toMatchObject({ title: "爸爸已于 10:05 回应早间药物提醒。", tone: "quiet" });
    expect(h.noReply).toMatchObject({ answeredSince: true, answer: null });
    expect(h.noReply?.slot.cells).toEqual([]);
    expect(h.status?.slot?.cells).toEqual([]);
    expect(h.timeline.map((l) => l.kind)).toEqual(["reminded", "reminded_again", "told_you", "answered"]);
    expect(h.week).toBeNull();
    expect(hisPart(h)).not.toMatch(DOSE_WORDS);

    // the same moment with the dose switch on as well: what he answered, and the reason he gave, on the medicine's cell
    const both = await home(ALERT_AND_DOSES, now);
    expect(both.status?.state).toBe("missed");
    expect(both.status?.slot?.cells).toEqual([expect.objectContaining({ name: "Amlodipine", mark: "missed", reason: REASON })]);
    expect(both.noReply?.slot.cells.map((c) => c.reason)).toEqual([REASON]);
    // the dose switch alone (no alert): the reason is there too; it never needed the alert
    const doses = await home({ ...NO_GRANTS, dose_summary: true }, now);
    expect(doses.noReply).toBeNull();
    expect(doses.status?.slot?.cells.map((c) => c.reason)).toEqual([REASON]);
  });

  it("both switches off: no alert on her home at all", async () => {
    const h = await home({ ...NO_GRANTS }, Date.parse(SGT("2026-10-13", "10:05")));
    expect(h.status).toBeNull();
    expect(h.noReply).toBeNull();
    expect(h.timeline).toEqual([]);
  });
});
