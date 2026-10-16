/**
 * GET /api/family/alerts through her care link (?link=) keeps to what his switches share (C2 track D; the same rule as
 * her home, lib/care/home.ts familyHome, and lib/care/hide.ts):
 *   only 「两次提醒没回时通知她」 on    each alert sent to her: that there was no reply, when, whether he answered since
 *                                     and when. Never which medicine, what he answered or why
 *   「每天吃药的情况」 on as well      the slot's medicines by name, his answer now (taken, missed, no reply) and, for a
 *                                     dose he did not take, the reason he gave in his words (the owner's decision of
 *                                     2026-10-14: what her home shows, lib/care/home.ts cellReason)
 *   never, whatever is on            the reason's code (dose_log.reason: "forgot", "own_words")
 *   the no-reply switch off          { on: false, alerts: [] }
 *
 * Through the real route on the process-wide memory store and the memory identity provider. Mr Tan's example account
 * laid out on Tue 13 Oct 2026 07:30 (morning reminders 08:45 / 09:15, window closes 09:45); the jobs run through track
 * B's runDoseDay; the developer test clock, frozen.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as alertsGet } from "@/app/api/family/alerts/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { herAlerts } from "@/lib/care/alerts";
import { familyHome } from "@/lib/care/home";
import { answerDose } from "@/lib/daily/doses";
import { runDoseDay, type LinkWithSwitch } from "@/lib/daily/dose-run";
import type { FamilyNoReplyAlert } from "@/lib/daily/no-reply";
import { NO_GRANTS } from "@/lib/family/types";
import { getMemoryStore } from "@/lib/store/memory";
import type { FamilyGrantItems, SessionRow } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";
import { agreedLink } from "../../support/agreed-link";

const store = getMemoryStore();
const auth = getAuthProvider();
const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;
const AML = "med-amlodipine";
const ALERT_ONLY: FamilyGrantItems = { ...NO_GRANTS, no_reply_alert: true };
const ALERT_AND_DOSES: FamilyGrantItems = { ...NO_GRANTS, no_reply_alert: true, dose_summary: true };
/** the reason he types at 10:20, in words nothing else in his records holds */
const OWN_WORDS = "去喝早茶了，回来再吃";
/** what the dose switch shares: a medicine (its name or its id), an answer, a reason (the cell's fields and his words) */
const DOSE_WORDS = /Amlodipine|med-amlodipine|"taken"|"missed"|"mixed"|"unconfirmed"|"mark"|"reason"|吃了|没吃|忘了|去喝早茶了/;
/** what no switch shares on this route: the reason's code, and track B's own field names */
const CODE_WORDS = /forgot|own_words|"later"|"undone"|"reasonText"|"state"/;

function setClock(iso: string): number {
  setTestClock({ at: iso, frozen: true });
  return Date.parse(iso);
}

let him: TestAccount;
let her: TestAccount;
let linkId: string;

async function scope(): Promise<SessionRow> {
  const s = await store.getSession(him.userId);
  if (!s) throw new Error("no scope");
  return s;
}

async function tick(at: string): Promise<void> {
  const now = setClock(at);
  const links = async (): Promise<LinkWithSwitch[]> => [{ link: (await store.getCareLink(linkId))!, noReplyAlert: true, locale: "zh-Hans" }];
  await runDoseDay(store, await scope(), now, { links, send: async () => ({ sent: 1 }) });
}

function ask(who: TestAccount, query = `?link=${encodeURIComponent(linkId)}`): Promise<Response> {
  return alertsGet(new NextRequest(`http://localhost/api/family/alerts${query}`, { headers: { cookie: `rp_at=${who.tokens.access_token}` } }));
}

interface Cell {
  medicationId: string;
  name: string;
  mark: string;
  reason: string | null;
  answeredAt: string | null;
}

async function hers(): Promise<{ text: string; body: { on: boolean; alerts: (Record<string, unknown> & { cells: Cell[] })[] } }> {
  const res = await ask(her);
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  const text = await res.text();
  return { text, body: JSON.parse(text) };
}

/** the same slot's cells on her home at this moment, with both switches on: what the route's cells must agree with */
async function homeCells(now: number): Promise<(string | null)[][]> {
  const home = await familyHome(store, await scope(), { link: { id: linkId, patient_label: "爸爸" }, grants: ALERT_AND_DOSES, acknowledged: true }, now);
  return (home.noReply?.slot.cells ?? []).map((c) => [c.medicationId, c.name, c.mark, c.reason]);
}

beforeAll(async () => {
  setClock(SGT("2026-10-13", "07:30"));
  him = await createAccountWithSpace(store, auth, { login: `d${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  her = await createAccountWithSpace(store, auth, { login: `w${randomUUID().slice(0, 10)}`, password: "a long test password", space: "none" });
  const inv = await store.createInvite(
    { patient_id: him.userId, patient_label: "爸爸", invite_token_hash: randomUUID(), invite_expires_at: "2099-01-01T00:00:00.000Z" },
    ALERT_ONLY,
  );
  if (!inv.ok) throw new Error(inv.code);
  const acc = await store.acceptInvite(inv.link.invite_token_hash!, her.userId, "Wei Ling");
  if (!acc.ok) throw new Error(acc.code);
  const ok = await store.confirmLink(inv.link.id, him.userId, true);
  if (!ok.ok) throw new Error(ok.code);
  linkId = ok.link.id;
  // the two records an invitation he confirmed carries (without them her view is the alert-only form: lib/care/reconsent.ts)
  await agreedLink(store, ok.link);
});

afterAll(() => setTestClock(null));

describe("GET /api/family/alerts?link= with only the no-reply switch on", () => {
  it("an open alert: that there was no reply and when; no medicine, no state, no reason", async () => {
    await tick(SGT("2026-10-13", "08:45"));
    await tick(SGT("2026-10-13", "09:15"));
    await tick(SGT("2026-10-13", "09:45"));
    setClock(SGT("2026-10-13", "09:46"));
    const { text, body } = await hers();
    expect(body.on).toBe(true);
    expect(body.alerts).toEqual([
      {
        deliveryId: expect.any(String),
        linkId,
        day: 42,
        date: "2026-10-13",
        slot: "morning",
        closes: "09:45",
        sentAt: "2026-10-13T01:45:00.000Z",
        openedAt: null,
        cells: [],
        answeredSince: false,
        answeredAt: null,
      },
    ]);
    expect(text).not.toMatch(DOSE_WORDS);
    expect(text).not.toMatch(CODE_WORDS);
  });

  it("at 10:05 he says he did not take it (忘了): only that he answered and when", async () => {
    const now = setClock(SGT("2026-10-13", "10:05"));
    await answerDose(store, await scope(), { medication_id: AML, slot: "morning", state: "missed", reason: "forgot", reason_text: "忘了" }, now);
    const { text, body } = await hers();
    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0]).toMatchObject({ slot: "morning", cells: [], answeredSince: true, answeredAt: "2026-10-13T02:05:00.000Z" });
    expect(text).not.toMatch(DOSE_WORDS);
    expect(text).not.toMatch(CODE_WORDS);
  });
});

describe("with 「每天吃药的情况」 on as well", () => {
  it("the medicine by name, what he answered and the reason in his words, as her home has them; never the reason's code", async () => {
    const now = Date.parse(SGT("2026-10-13", "10:05"));
    await store.setFamilyGrant(him.userId, linkId, { dose_summary: true });
    const { text, body } = await hers();
    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0]).toMatchObject({ answeredSince: true, answeredAt: "2026-10-13T02:05:00.000Z" });
    expect(body.alerts[0].cells).toEqual([{ medicationId: AML, name: "Amlodipine", mark: "missed", reason: "忘了", answeredAt: "2026-10-13T02:05:00.000Z" }]);
    expect(body.alerts[0].cells.map((c) => [c.medicationId, c.name, c.mark, c.reason])).toEqual(await homeCells(now));
    expect(text).not.toMatch(CODE_WORDS);
  });

  it("at 10:20 he writes why in his own words: those words, trimmed as on her home; at 10:30 he took it: no reason", async () => {
    let now = setClock(SGT("2026-10-13", "10:20"));
    await answerDose(store, await scope(), { medication_id: AML, slot: "morning", state: "missed", reason: "own_words", reason_text: `  ${OWN_WORDS}  ` }, now);
    const own = await hers();
    expect(own.body.alerts[0].cells).toEqual([{ medicationId: AML, name: "Amlodipine", mark: "missed", reason: OWN_WORDS, answeredAt: "2026-10-13T02:20:00.000Z" }]);
    expect(own.body.alerts[0].cells.map((c) => [c.medicationId, c.name, c.mark, c.reason])).toEqual(await homeCells(now));
    expect(own.text).not.toMatch(CODE_WORDS);

    now = setClock(SGT("2026-10-13", "10:30"));
    await answerDose(store, await scope(), { medication_id: AML, slot: "morning", state: "taken" }, now);
    expect((await hers()).body.alerts[0].cells).toEqual([{ medicationId: AML, name: "Amlodipine", mark: "taken", reason: null, answeredAt: "2026-10-13T02:30:00.000Z" }]);

    // back to 「没吃」 with his words, for the switches below
    now = setClock(SGT("2026-10-13", "10:31"));
    await answerDose(store, await scope(), { medication_id: AML, slot: "morning", state: "missed", reason: "own_words", reason_text: OWN_WORDS }, now);
  });

  it("the dose switch off again: the cells and the reason go; the no-reply switch off: nothing at all; his own account: 404", async () => {
    await store.setFamilyGrant(him.userId, linkId, { dose_summary: false });
    const alertOnly = await hers();
    expect(alertOnly.body.alerts[0]).toMatchObject({ cells: [], answeredSince: true, answeredAt: "2026-10-13T02:31:00.000Z" });
    expect(alertOnly.text).not.toMatch(DOSE_WORDS);
    expect(alertOnly.text).not.toMatch(CODE_WORDS);

    await store.setFamilyGrant(him.userId, linkId, { no_reply_alert: false, dose_summary: true });
    expect((await hers()).body).toEqual({ on: false, alerts: [] });

    expect((await ask(him, "")).status).toBe(404);
  });
});

describe("herAlerts: a slot with more than one medicine", () => {
  type In = FamilyNoReplyAlert["cells"][number];
  const cell = (id: string, name: string, state: In["state"], reason: string | null, reasonText: string | null, answeredAt: string | null): In => ({ medicationId: id, name, state, reason, reasonText, answeredAt });
  const alert = (cells: In[]): FamilyNoReplyAlert => ({
    deliveryId: "delivery-1",
    linkId: "link-1",
    day: 42,
    date: "2026-10-13",
    slot: "morning",
    closes: "09:45",
    sentAt: "2026-10-13T01:45:00.000Z",
    openedAt: null,
    cells,
    answeredSince: cells.length > 0 && cells.every((c) => c.state === "taken" || c.state === "missed"),
  });

  it("one answered, the others not: still open, no time; 等一下 and an answer taken back read as no reply, with no reason", () => {
    const partly = alert([
      cell("med-a", "Amlodipine", "taken", null, null, "2026-10-13T02:02:00.000Z"),
      cell("med-b", "Losartan", "unconfirmed", "later", "等一下", null),
      cell("med-c", "Metformin", null, null, null, null),
      cell("med-d", "Atorvastatin", "unconfirmed", "no_reply", null, null),
    ]);
    const alone = herAlerts([partly], { dose_summary: false });
    expect(alone).toEqual([{ ...partly, cells: [], answeredAt: null }]);
    expect(JSON.stringify(alone)).not.toMatch(/Amlodipine|Losartan|med-|"taken"|"later"|"reason|等一下/);
    const both = herAlerts([partly], { dose_summary: true });
    expect(both[0].cells).toEqual([
      { medicationId: "med-a", name: "Amlodipine", mark: "taken", reason: null, answeredAt: "2026-10-13T02:02:00.000Z" },
      { medicationId: "med-b", name: "Losartan", mark: "no_reply", reason: null, answeredAt: null },
      { medicationId: "med-c", name: "Metformin", mark: "no_reply", reason: null, answeredAt: null },
      { medicationId: "med-d", name: "Atorvastatin", mark: "no_reply", reason: null, answeredAt: null },
    ]);
    expect(both[0]).toMatchObject({ answeredSince: false, answeredAt: null });
    expect(JSON.stringify(both)).not.toMatch(CODE_WORDS);
  });

  it("all answered: the time of his latest answer, whichever switch; a reason only on the dose he did not take", () => {
    const done = alert([
      cell("med-a", "Amlodipine", "taken", "away", "出门了", "2026-10-13T02:02:00.000Z"),
      cell("med-b", "Losartan", "missed", "away", "出门了", "2026-10-13T02:20:00.000Z"),
      cell("med-c", "Metformin", "missed", "own_words", "   ", "2026-10-13T02:10:00.000Z"),
    ]);
    const alone = herAlerts([done], { dose_summary: false })[0];
    expect(alone).toMatchObject({ cells: [], answeredSince: true, answeredAt: "2026-10-13T02:20:00.000Z" });
    expect(JSON.stringify(alone)).not.toMatch(/出门了|away|"reason/);
    const both = herAlerts([done], { dose_summary: true })[0];
    expect(both).toMatchObject({ answeredSince: true, answeredAt: "2026-10-13T02:20:00.000Z" });
    expect(both.cells.map((c) => [c.name, c.mark, c.reason])).toEqual([
      ["Amlodipine", "taken", null],
      ["Losartan", "missed", "出门了"],
      ["Metformin", "missed", null],
    ]);
    expect(JSON.stringify(both)).not.toMatch(/away|own_words|"reasonText"|"state"/);
  });
});
