/**
 * The family texts asked again (the owner, 2026-10-14; lib/care/reconsent.ts): the texts of that day widened what each
 * switch shows her, so a link that came about under an earlier version shows her the alert-only form until both of them
 * have agreed to the text in force. Through the real routes on the process-wide memory store:
 *
 *   records of 2026-10-11       her home, 「留意」, her month, the shared list, the long press and the questions route all
 *                               read his switches as if only the no-reply alert were on, and her screens say why; his
 *                               switches stay as they are in the store; her live stream cuts the switches his events carry
 *   his card                    shows on his side; 「同意」 alone leaves her view cut; her 「同意新的说明」 too opens it
 *   a link bound under 10-14    not affected at all: everything at once, no card (her binding, before and after his
 *                               「知道了」, as the owner's local preview binds a fresh pair at every start)
 *   a link with no record       counts as not agreed by either
 *   one she bound under 10-11   he never answered: only her card (his is the 「知道了」 card), and after it the four
 *                               default items, as a link she binds today
 *   the judges' demo            never asked: a story session's family phone reads through the session, not a care link,
 *                               and sees what its switches say
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as eventsGet } from "@/app/api/events/route";
import { POST as explainAddPost } from "@/app/api/explain/add/route";
import { POST as explainPost } from "@/app/api/explain/route";
import { POST as bindPost } from "@/app/api/family/bind/route";
import { POST as seenPost } from "@/app/api/family/bind/seen/route";
import { POST as agreePost } from "@/app/api/family/links/[id]/agree/route";
import { POST as grantsPost } from "@/app/api/family/links/[id]/grants/route";
import { POST as questionsPost } from "@/app/api/family/questions/route";
import { GET as viewGet } from "@/app/api/family/view/route";
import { FamilyApp } from "@/components/family/FamilyApp";
import { HerAgreeCard } from "@/components/family/Reconsent";
import { ReconsentCard } from "@/components/his-family/ReconsentCard";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { linkAcknowledged } from "@/lib/care/ack";
import { DIRECT_GRANTS } from "@/lib/care/bind";
import { FAMILY_CONSENT_VERSION, familyConsentText, familyConsentTextOf } from "@/lib/care/consent";
import { herSwitches } from "@/lib/care/her-page";
import { herSide } from "@/lib/care/her-stream";
import { sharedItems } from "@/lib/care/her-view";
import type { FamilyHomeData } from "@/lib/care/home-types";
import { patientLinks } from "@/lib/care/links";
import { monthShown } from "@/lib/care/month";
import { alertOnly, consentOf, isHeld, linkConsent, linkWaitingForHim } from "@/lib/care/reconsent";
import { rcc } from "@/lib/care/reconsent-copy";
import { closedToday } from "@/lib/care/reconsent-later";
import { herRecord } from "@/lib/care/record";
import type { PatientLinkView } from "@/lib/care/types";
import { doseRef } from "@/lib/explain/subjects";
import { createFamilyStream } from "@/lib/family/events";
import { FAMILY_MEMBER, NO_GRANTS, type FamilyViewData } from "@/lib/family/types";
import { RENEW_FRAME } from "@/lib/guard/stream";
import { getMemoryStore } from "@/lib/store/memory";
import type { CareLinkRow, ConsentKind, FamilyGrantItems, SessionRow } from "@/lib/store/types";
import { resolveSubject, selfSubject, type Subject } from "@/lib/subject";
import { bindEntryStore } from "@/lib/subject/bind";
import { careEntryStore } from "@/lib/subject/care";
import { setTestClock } from "@/lib/time/now";

// a server render has no app router: the cards that read the page again get one that does nothing
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, forward() {}, prefetch() {} }),
}));

const store = getMemoryStore();
const PASSWORD = "a long test password";
const NOW = "2026-10-14T10:00:00+08:00";
const ALL: FamilyGrantItems = { dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: true, notes: true };
const ALERT: FamilyGrantItems = { ...NO_GRANTS, no_reply_alert: true };
/** his words and numbers, in nothing else of his records */
const NOTE = "今天下午散步四十分钟，膝盖有点酸";
const QUESTION = "饭后散步会不会影响降压药的效果";
const READING = { systolic: 151, diastolic: 97 };
const LINE_ZH = "爸爸那边的分享说明更新了。等你们两位都确认新的说明以后，这里才会显示详细记录。";

const login = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const elder = () => createAccountWithSpace(store, getAuthProvider(), { login: login("t"), password: PASSWORD, space: "example", display_name: "陈先生" });
const family = () => createAccountWithSpace(store, getAuthProvider(), { login: login("w"), password: PASSWORD, space: "none", display_name: "Wei Ling" });
const t = (a: TestAccount) => a.tokens.access_token;
const shown = (a: TestAccount) => (a.login.kind === "username" ? a.login.username : a.login.email);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function req(p: string, opts: { token?: string; body?: unknown; signal?: AbortSignal } = {}): NextRequest {
  const headers: Record<string, string> = opts.token ? { cookie: `rp_at=${opts.token}` } : {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, { method: opts.body === undefined ? "GET" : "POST", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: opts.signal });
}

beforeAll(() => {
  setTestClock({ at: NOW, frozen: true });
});
afterAll(() => setTestClock(null));

// ------------------------------------------------------------------ the world

interface World {
  him: TestAccount;
  her: TestAccount;
  link: CareLinkRow;
  scope: SessionRow;
  reading: string;
}

/** His readings, a note and a question of today, in words and numbers nothing else holds. */
async function hisDay(him: TestAccount): Promise<{ scope: SessionRow; reading: string }> {
  const scope = (await store.getSession(him.userId))!;
  const reading = (await store.addBp(him.userId, { day: scope.story_day, slot: "morning", ...READING, created_at: new Date(Date.parse(NOW) - 3600_000).toISOString() })).id;
  await store.addNote(him.userId, { day: scope.story_day, text: NOTE, source: "typed" });
  await store.addQuestion(him.userId, { for: "doctor", origin: "own", text: QUESTION, lang: "zh-Hans" });
  return { scope: (await store.getSession(him.userId))!, reading };
}

/** A link made straight through the store, every switch as given, and no record at all (yet). */
async function storeLink(him: TestAccount, her: TestAccount, items: FamilyGrantItems = ALL): Promise<CareLinkRow> {
  const inv = await store.createInvite({ patient_id: him.userId, patient_label: "爸爸", family_label: "Wei Ling", invite_token_hash: randomUUID(), invite_expires_at: "2099-01-01T00:00:00.000Z" }, items);
  if (!inv.ok) throw new Error(inv.code);
  const acc = await store.acceptInvite(inv.link.invite_token_hash!, her.userId, "Wei Ling");
  if (!acc.ok) throw new Error(acc.code);
  const ok = await store.confirmLink(inv.link.id, him.userId, true);
  if (!ok.ok) throw new Error(ok.code);
  return ok.link;
}

/** A record as an older version of the app wrote it: the version, the hash of that version's words, the link it names. */
async function oldRecord(kind: Extract<ConsentKind, "family_share" | "family_accept">, userId: string, scopeId: string | null, linkId: string, method: string, version = "2026-10-11"): Promise<void> {
  const words = familyConsentTextOf(kind, version, "zh-Hans")!;
  await store.addConsentRecord({ user_id: userId, scope_id: scopeId, kind, decision: "granted", version, text_sha256: words.sha256, method, evidence: { link_id: linkId, locale: "zh-Hans" } });
}

/** An invitation he confirmed under 2026-10-11: his record and hers, both of that version; every switch on. */
async function oldWorld(): Promise<World> {
  const him = await elder();
  const her = await family();
  const day = await hisDay(him);
  const link = await storeLink(him, her);
  await oldRecord("family_accept", her.userId, null, link.id, "invite_screen");
  await oldRecord("family_share", him.userId, him.userId, link.id, "family_confirm");
  return { him, her, link, ...day };
}

const view = async (her: TestAccount, linkId: string): Promise<FamilyHomeData> => {
  const res = await viewGet(req(`/api/family/view?link=${encodeURIComponent(linkId)}`, { token: t(her) }));
  expect(res.status).toBe(200);
  return (await res.json()) as FamilyHomeData;
};
const agree = (who: TestAccount, linkId: string) => agreePost(req(`/api/family/links/${encodeURIComponent(linkId)}/agree`, { token: t(who), body: {} }), params(linkId));
const explain = (her: TestAccount, linkId: string, body: unknown) => explainPost(req(`/api/explain?link=${encodeURIComponent(linkId)}`, { token: t(her), body }));
const explainAdd = (her: TestAccount, linkId: string, body: unknown) => explainAddPost(req(`/api/explain/add?link=${encodeURIComponent(linkId)}`, { token: t(her), body }));
const addQuestion = (her: TestAccount, linkId: string, entry: string) => questionsPost(req(`/api/family/questions?link=${encodeURIComponent(linkId)}`, { token: t(her), body: { entry } }));

/** Her request's subject, as the routes and pages resolve it (lib/subject/resolve.ts). */
async function hersNow(her: TestAccount, linkId: string): Promise<Subject> {
  const r = await resolveSubject({ querySession: null, queryLink: linkId, cookieSession: null, cookieView: null, accessToken: t(her) }, { allowFamily: true }, { store, auth: () => getAuthProvider() });
  if (!r.ok) throw new Error(r.error);
  return r.subject;
}

/** His links as his pages list them, and the one whose card his pages show (null: none). */
async function hisCard(him: TestAccount): Promise<PatientLinkView | null> {
  const scope = (await store.getSession(him.userId))!;
  const own = selfSubject(store, scope, him.userId).store;
  const views = await patientLinks(own, careEntryStore(store), scope, him.userId, Date.parse(NOW));
  return linkWaitingForHim(own, bindEntryStore(store), him.userId, views);
}

/** What the copy of her home holds of his records (the words and numbers only his day has). */
const holdsHisDay = (home: FamilyHomeData) => {
  const text = JSON.stringify(home);
  return { note: home.notesShared, question: text.includes(QUESTION), reading: (home.bp?.readings ?? []).some((r) => r.systolic === READING.systolic && r.diastolic === READING.diastolic) };
};

// ------------------------------------------------------------------ the rule

describe("the rule, from the records", () => {
  const share = (linkId: string, version: string, decision: "granted" | "withdrawn" = "granted") => ({ decision, version, evidence: { link_id: linkId } });
  it("each side with records: its latest names the link and is granted under the version in force", () => {
    expect(FAMILY_CONSENT_VERSION).toBe("2026-10-14");
    expect(consentOf("L", [share("L", "2026-10-11")], [share("L", "2026-10-11")])).toEqual({ his: false, hers: false });
    expect(consentOf("L", [share("L", "2026-10-11"), share("L", "2026-10-14")], [share("L", "2026-10-11")])).toEqual({ his: true, hers: false });
    expect(consentOf("L", [share("L", "2026-10-14")], [share("L", "2026-10-14")])).toEqual({ his: true, hers: true });
    // another link's record says nothing about this one; a withdrawal is not an agreement
    expect(consentOf("L", [share("M", "2026-10-14")], [share("L", "2026-10-14")]).his).toBe(true);
    expect(consentOf("L", [share("L", "2026-10-14"), share("L", "2026-10-14", "withdrawn")], [share("L", "2026-10-14")]).his).toBe(false);
  });

  it("a side with no record has nothing to renew when the other side has one (a link bound by account); no record at all: neither", () => {
    // she typed his account: her record, none of his
    expect(consentOf("L", [], [share("L", "2026-10-14")])).toEqual({ his: true, hers: true });
    expect(consentOf("L", [], [share("L", "2026-10-11")])).toEqual({ his: true, hers: false });
    // he typed hers: his record, none of hers
    expect(consentOf("L", [share("L", "2026-10-11")], [])).toEqual({ his: false, hers: true });
    // made straight through the store
    expect(consentOf("L", [], [])).toEqual({ his: false, hers: false });
    expect(isHeld({ his: true, hers: false })).toBe(true);
    expect(isHeld({ his: true, hers: true })).toBe(false);
    expect(isHeld(null)).toBe(false);
    expect(alertOnly(ALL)).toEqual(ALERT);
    expect(alertOnly({ ...ALL, no_reply_alert: false })).toEqual(NO_GRANTS);
  });
});

// ------------------------------------------------------------------ records of 2026-10-11

describe("a link whose records are 2026-10-11", () => {
  let w: World;
  beforeAll(async () => {
    w = await oldWorld();
  });

  it("her home is the alert-only form and says why; his switches are as he left them", async () => {
    const home = await view(w.her, w.link.id);
    expect(home.grants).toEqual(ALERT);
    expect(home.reconsent).toEqual({ his: false, hers: false });
    expect([home.week, home.bp, home.questions, home.lastRecord]).toEqual([null, null, null, null]);
    expect(holdsHisDay(home)).toEqual({ note: false, question: false, reading: false });
    expect((await store.getFamilyGrant(w.him.userId, w.link.id))?.items).toEqual(ALL);
    // the line, in both languages
    expect(rcc("zh-Hans", "line", { dad: "爸爸" })).toBe(LINE_ZH);
    expect(rcc("en", "line", { dad: "Dad" })).toBe("Dad's sharing terms were updated. Detailed records show again once you have both agreed to the new terms.");
    expect(rcc("en", "line", { dad: "dad" }).startsWith("Dad's")).toBe(true);
  });

  it("「留意」, her month and the shared list read the same switches: the alert alone", async () => {
    const subject = await hersNow(w.her, w.link.id);
    expect(subject.consent).toEqual({ his: false, hers: false });
    const { items, version } = await herSwitches(subject.store, subject.scope, w.link.id);
    expect(items).toEqual(ALERT);
    const record = await herRecord(subject.store, subject.scope, { link: w.link, userId: w.her.userId, grants: items, version, locale: "zh-Hans", acknowledged: true }, Date.parse(NOW));
    expect(record.entries.filter((e) => e.kind !== "no_reply")).toEqual([]);
    expect(record.shown.filter((k) => k !== "no_reply_alert")).toEqual([]);
    expect(JSON.stringify(record)).not.toMatch(new RegExp(`${NOTE}|${QUESTION}|${READING.systolic}/${READING.diastolic}`));
    // her calendar has nothing to show (the page sends her home), the list of his items shows the alert alone
    expect(monthShown(items)).toEqual([]);
    expect(sharedItems(items, "zh-Hans", null).filter((s) => s.shared).map((s) => s.grant)).toEqual(["no_reply_alert"]);
  });

  it("the long press reads nothing of his, and nothing of hers reaches his list", async () => {
    for (const body of [
      { subject_type: "bp", subject_ref: w.reading },
      { subject_type: "bp_week", subject_ref: "" },
      { subject_type: "dose", subject_ref: doseRef("2026-10-14", "morning") },
      { subject_type: "med", subject_ref: "med-amlodipine" },
      { subject_type: "next_visit", subject_ref: "" },
    ]) {
      const res = await explain(w.her, w.link.id, body);
      expect(res.status, body.subject_type).toBe(404);
    }
    const before = (await store.listQuestions(w.him.userId)).length;
    expect((await explainAdd(w.her, w.link.id, { subject_type: "med", subject_ref: "med-amlodipine" })).status).toBe(403);
    const res = await addQuestion(w.her, w.link.id, "missed:2026-10-14:morning");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not_shared" });
    expect((await store.listQuestions(w.him.userId)).length).toBe(before);
  });

  it("her home draws the line, and her card with her text in force and one button", async () => {
    const home = await view(w.her, w.link.id);
    const text = familyConsentText("family_accept", "zh-Hans");
    const html = renderToStaticMarkup(createElement(FamilyApp, { locale: "zh-Hans", linkId: w.link.id, since: 0, tz: "Asia/Singapore", initial: home, langHref: "/x", herText: { title: text.title, paragraphs: text.paragraphs } }));
    expect(html).toContain(LINE_ZH);
    expect(html).toContain('data-testid="family-reconsent-card"');
    expect(html).toContain(text.title);
    for (const p of text.paragraphs) expect(html).toContain(p);
    expect(html).toContain("同意新的说明");
    // the card alone, in English: the English text and button
    const en = familyConsentText("family_accept", "en");
    const card = renderToStaticMarkup(createElement(HerAgreeCard, { locale: "en", linkId: w.link.id, text: { title: en.title, paragraphs: en.paragraphs } }));
    expect(card).toContain("Agree to the new terms");
    expect(card).toContain(en.title);
  });

  it("her live stream: a switch he turns on reaches her cut, and so does what follows it", async () => {
    const abort = new AbortController();
    const res = await eventsGet(req(`/api/events?link=${encodeURIComponent(w.link.id)}`, { token: t(w.her), signal: abort.signal }));
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const frames = () =>
      text
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => JSON.parse(l.slice(6)) as { type: string; data: { grant?: { items: FamilyGrantItems; version: number }; changed?: Record<string, boolean>; dose?: unknown } });
    const until = async (n: number) => {
      for (let i = 0; i < 40 && frames().filter((f) => f.type === "family_grant.changed").length < n; i++) text += decoder.decode((await reader.read()).value);
    };
    await until(1);
    // the first frame: her switches as her store reads them
    expect(frames()[0].data.grant?.items).toEqual(ALERT);
    // he turns his notes off and on again: each change he makes goes out with the switches cut
    const before = (await store.getFamilyGrant(w.him.userId, w.link.id))!.version ?? 0;
    expect((await grantsPost(req(`/api/family/links/${w.link.id}/grants`, { token: t(w.him), body: { items: { notes: false } } }), params(w.link.id))).status).toBe(200);
    expect((await grantsPost(req(`/api/family/links/${w.link.id}/grants`, { token: t(w.him), body: { items: { notes: true } } }), params(w.link.id))).status).toBe(200);
    await until(3);
    abort.abort();
    const changes = frames().filter((f) => f.type === "family_grant.changed").slice(1);
    expect(changes.map((f) => f.data.grant?.version)).toEqual([before + 1, before + 2]);
    for (const f of changes) {
      expect(f.data.grant?.items).toEqual(ALERT);
      expect(f.data.changed).toEqual({});
    }
    expect(text).not.toContain(NOTE);
  });

  it("the stream's own filter is the cut: a dose he logs is only a hint, never which medicine or what he answered", () => {
    const stream = createFamilyStream(ALL, { linkId: "L", version: 3, switches: alertOnly });
    expect(stream.grants()).toEqual(ALERT);
    const ev = (id: number, type: string, data: unknown) => ({ id, type, session_id: "S", at: NOW, say: "", data }) as Parameters<typeof stream.view>[0];
    const grant = stream.view(ev(1, "family_grant.changed", { grant: { member: "L", items: ALL, version: 4 }, changed: { notes: true, no_reply_alert: true } }));
    expect(grant.event?.data).toMatchObject({ grant: { items: ALERT, version: 4 }, changed: { no_reply_alert: true } });
    expect((grant.event?.data as { changed: object }).changed).not.toHaveProperty("notes");
    const dose = stream.view(ev(2, "dose.logged", { dose: { medication_id: "med-amlodipine", day: 1, slot: "morning", state: "taken" } }));
    expect(dose).toEqual({ kind: "hint", event: expect.objectContaining({ data: {} }) });
    expect(stream.view(ev(3, "note.logged", { note: { text: NOTE } })).kind).toBe("dropped");
    stream.adopt(ALL, 9);
    expect(stream.grants()).toEqual(ALERT);
  });
});

// ------------------------------------------------------------------ the two cards

describe("his card, then hers", () => {
  it("his card shows; after his 「同意」 alone her view is still cut; after hers too, everything at once", async () => {
    const w = await oldWorld();
    // his side: the card, with her name, his text in force and the two buttons
    const card = await hisCard(w.him);
    expect(card?.id).toBe(w.link.id);
    const share = familyConsentText("family_share", "zh-Hans");
    const html = renderToStaticMarkup(createElement(ReconsentCard, { locale: "zh-Hans", link: card!, paragraphs: share.paragraphs, helped: null, date: "2026-10-14", dock: false }));
    expect(html).toContain("Wei Ling能看到的内容更新了");
    for (const p of share.paragraphs) expect(html).toContain(p);
    expect(html).toContain('data-testid="reconsent-ok"');
    expect(html).toContain("同意");
    expect(html).toContain("先不");
    // 「先不」 keeps the card closed for his date only
    expect(closedToday("2026-10-14", "2026-10-14")).toBe(true);
    expect(closedToday("2026-10-13", "2026-10-14")).toBe(false);
    expect(closedToday(undefined, "2026-10-14")).toBe(false);

    // his 「同意」: his record under the text in force, as his confirmation writes it
    const his = await agree(w.him, w.link.id);
    expect(his.status).toBe(200);
    expect(await his.json()).toEqual({ ok: true, written: true });
    const mine = (await store.listConsentRecords(w.him.userId, { kind: "family_share" })).filter((r) => (r.evidence as { link_id?: string }).link_id === w.link.id);
    expect(mine.at(-1)).toMatchObject({ decision: "granted", version: FAMILY_CONSENT_VERSION, text_sha256: familyConsentText("family_share", "zh-Hans").sha256, method: "family_confirm", evidence: { link_id: w.link.id, renews: "2026-10-11" } });
    expect(await hisCard(w.him)).toBeNull();
    // she has not agreed: still the alert-only form, and her card still there
    const still = await view(w.her, w.link.id);
    expect(still.grants).toEqual(ALERT);
    expect(still.reconsent).toEqual({ his: true, hers: false });
    expect(holdsHisDay(still)).toEqual({ note: false, question: false, reading: false });

    // her 「同意新的说明」: her record under the text in force, with the method of her acceptance
    const hers = await agree(w.her, w.link.id);
    expect(hers.status).toBe(200);
    expect(await hers.json()).toEqual({ ok: true, written: true });
    const herRecords = (await store.listConsentRecords(w.her.userId, { kind: "family_accept" })).filter((r) => (r.evidence as { link_id?: string }).link_id === w.link.id);
    expect(herRecords.at(-1)).toMatchObject({ decision: "granted", version: FAMILY_CONSENT_VERSION, method: "invite_screen", assisted: false, evidence: { link_id: w.link.id, renews: "2026-10-11" } });

    // everything at once, as he switched it: his readings, his note, his question
    const open = await view(w.her, w.link.id);
    expect(open.grants).toEqual(ALL);
    expect(open.reconsent).toBeUndefined();
    expect(holdsHisDay(open)).toEqual({ note: true, question: true, reading: true });
    expect((await explain(w.her, w.link.id, { subject_type: "bp", subject_ref: w.reading })).status).toBe(200);
    // past the switch: an item that is not there is 404, not 403
    expect((await addQuestion(w.her, w.link.id, "no-such-entry")).status).toBe(404);
    // a second tap writes nothing; someone else's tap finds no link of theirs
    expect(await (await agree(w.her, w.link.id)).json()).toEqual({ ok: true, written: false });
    expect(await (await agree(w.him, w.link.id)).json()).toEqual({ ok: true, written: false });
    const stranger = await family();
    expect((await agree(stranger, w.link.id)).status).toBe(404);
  });

  it("her stream, opened while the link waited, ends with the renew frame once both have agreed", async () => {
    const w = await oldWorld();
    const subject = await hersNow(w.her, w.link.id);
    const grant = await subject.store.getFamilyGrant(subject.scope.id, w.link.id);
    expect(grant?.items).toEqual(ALERT);
    const stream = createFamilyStream(grant!.items, { linkId: w.link.id, version: grant!.version ?? 0, switches: subject.store.switches });
    const side = herSide({ store: subject.store, scope: subject.scope, link: subject.link!, userId: w.her.userId, stream, grant, pushView: false, consent: subject.consent });
    expect(await side.check()).toBeNull();
    await agree(w.him, w.link.id);
    expect(await side.check()).toBeNull();
    await agree(w.her, w.link.id);
    expect(await side.check()).toEqual({ frame: RENEW_FRAME, end: true, changed: false });
    // the next one is not cut
    const fresh = await hersNow(w.her, w.link.id);
    expect(fresh.consent).toEqual({ his: true, hers: true });
    expect(fresh.store.switches).toBeNull();
    expect((await fresh.store.getFamilyGrant(fresh.scope.id, w.link.id))?.items).toEqual(ALL);
  });
});

// ------------------------------------------------------------------ links that are not asked again, and one with no record

describe("a link bound under the text in force", () => {
  it("her binding: everything the bound link starts with, at once, before and after his 「知道了」; no card on either side", async () => {
    const him = await elder();
    const her = await family();
    await hisDay(him);
    const bound = await bindPost(req("/api/family/bind", { token: t(her), body: { account: shown(him), label: "爸爸" } }));
    expect(bound.status).toBe(200);
    const id = ((await bound.json()) as { link: { id: string } }).link.id;
    // before his answer: the four default items in full (the 10-14 text says so), not the alert-only form
    const first = await view(her, id);
    expect(first.grants).toEqual(DIRECT_GRANTS);
    expect(first.reconsent).toBeUndefined();
    expect(holdsHisDay(first)).toEqual({ note: false, question: true, reading: true });
    expect(await hisCard(him)).toBeNull();
    // his 「知道了」, as the owner's local preview taps it for him at every start
    expect((await seenPost(req("/api/family/bind/seen", { token: t(him), body: { link: id } }))).status).toBe(200);
    const after = await view(her, id);
    expect(after.grants).toEqual(DIRECT_GRANTS);
    expect(after.reconsent).toBeUndefined();
    expect(await hisCard(him)).toBeNull();
    expect(await linkConsent(store, { id, patient_id: him.userId, family_id: her.userId })).toEqual({ his: true, hers: true });
  });
});

describe("a link with no record at all", () => {
  it("counts as not agreed by either: the alert-only form, both cards", async () => {
    const him = await elder();
    const her = await family();
    await hisDay(him);
    const link = await storeLink(him, her);
    expect(await linkConsent(store, link)).toEqual({ his: false, hers: false });
    const home = await view(her, link.id);
    expect(home.grants).toEqual(ALERT);
    expect(home.reconsent).toEqual({ his: false, hers: false });
    expect(holdsHisDay(home)).toEqual({ note: false, question: false, reading: false });
    expect((await hisCard(him))?.id).toBe(link.id);
  });
});

describe("the judges' demo", () => {
  it("is never asked again: a story session's family read shows what its switches say", async () => {
    const s = await store.createSession({ story_day: 29, ttl_hours: 1 });
    await store.setFamilyGrant(s.id, FAMILY_MEMBER, ALL);
    // the demo path (?session=) never reaches the care link's check: no consent read, nothing cut
    const r = await resolveSubject({ querySession: s.id, queryLink: null, cookieSession: null, cookieView: null, accessToken: null }, { allowFamily: true }, { store, auth: () => getAuthProvider() });
    if (!r.ok) throw new Error(r.error);
    expect(r.subject.kind).toBe("demo");
    expect(r.subject.consent).toBeUndefined();
    expect(r.subject.store.switches).toBeNull();
    // Wei Ling's phone in that session: every section its switches open
    const res = await viewGet(req(`/api/family/view?session=${encodeURIComponent(s.id)}`));
    expect(res.status).toBe(200);
    const v = (await res.json()) as FamilyViewData;
    expect(v.grants).toEqual(ALL);
    expect(v.doses).toBeDefined();
    expect(v.bp).toBeDefined();
    expect(v.notes).toBeDefined();
  });
});

describe("a link she bound under 2026-10-11 that he never answered", () => {
  it("only her card (his is 「知道了」); once she agrees, the four default items, as a link she binds today", async () => {
    const him = await elder();
    const her = await family();
    await hisDay(him);
    const link = await storeLink(him, her, DIRECT_GRANTS);
    await store.addAccountEvent(him.userId, "family_bound", { link_id: link.id, by: "family", items: DIRECT_GRANTS });
    await oldRecord("family_accept", her.userId, null, link.id, "direct_bind");
    expect(await linkAcknowledged(store, link)).toBe(false);
    const home = await view(her, link.id);
    expect(home.grants).toEqual(ALERT);
    expect(home.reconsent).toEqual({ his: true, hers: false });
    expect(await hisCard(him)).toBeNull();
    expect((await agree(her, link.id)).status).toBe(200);
    const records = (await store.listConsentRecords(her.userId, { kind: "family_accept" })).filter((r) => (r.evidence as { link_id?: string }).link_id === link.id);
    expect(records.at(-1)).toMatchObject({ version: FAMILY_CONSENT_VERSION, method: "direct_bind" });
    const open = await view(her, link.id);
    expect(open.grants).toEqual(DIRECT_GRANTS);
    expect(open.reconsent).toBeUndefined();
    // still unacknowledged: nothing of hers reaches his phone until his 「知道了」 (lib/care/ack.ts), as before
    expect(await linkAcknowledged(store, link)).toBe(false);
  });
});
