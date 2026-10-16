/**
 * Owner 10-16 (「直接把功能做出来，通知相应的对话」; lib/care/told.ts): when Ripple answers HIS OWN message on the emergency
 * route, every family member bound to him is told, with the conversation, whatever his sharing switches say.
 *
 *   the trigger      his own 995 answer and his own sign kept for his doctor (chest pain, a reading above his doctor's
 *                    number) tell her; someone else's crisis, self-harm (while TELL_FAMILY_ON_SELF_HARM is off) and an
 *                    ordinary answer do not; demo scopes never
 *   what she gets    one delivery per link and ask (never twice), the push in her language with nothing of what was said
 *                    on the lock screen and the tap on the conversation, the content-free hint on her own link's stream
 *   every link       with every switch off as with switches on (the baseline)
 *   what she reads   his words, when he said them, and Ripple's answer as he saw it (his doctor's line named as theirs),
 *                    from the chat rows, or from the safety record before they are written; through her own family store
 *   her screens      her 「留意」 card and her home's line, the conversation page's words; the push's tap may be marked
 *                    opened by her, the sender lets it through on her link alone (no switch)
 *
 * Mr Tan's example account laid out on Fri 16 Oct 2026 at 10:00 in Singapore (his doctor's warning line R2 is from the
 * first visit), the developer test clock, frozen; the memory store; the offline composer (no model).
 */
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AlertScreen } from "@/components/family/AlertScreen";
import { ToldConversation, ToldHomeLine } from "@/components/family/ToldCard";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { accessItemWords } from "@/lib/care/access-log";
import { hc } from "@/lib/care/her-copy";
import { familyHome } from "@/lib/care/home";
import { familyRecipients, mayTellFamily } from "@/lib/care/recipients";
import { familyAlarm, TELL_FAMILY_ON_SELF_HARM, tellFamily, TOLD_KIND, toldNotices, type TellInput, type TellResult } from "@/lib/care/told";
import { familyEvent } from "@/lib/family/events";
import { NO_GRANTS } from "@/lib/family/types";
import type { Notice } from "@/lib/jobs/notify";
import { createMockLlm } from "@/lib/llm";
import { HER_KINDS } from "@/lib/push/deliveries";
import { payloadFromNotice } from "@/lib/push/payload";
import { createWebPushSender } from "@/lib/push/sender";
import { ask } from "@/lib/safety/pipeline";
import { SIGNAL_RECORDED, TEMPLATES } from "@/lib/safety/templates";
import { recordAskTurn } from "@/lib/safety/turns";
import type { AskResult, Locale } from "@/lib/safety/types";
import { getMemoryStore } from "@/lib/store/memory";
import type { FamilyGrantItems, SessionRow } from "@/lib/store/types";
import { scopedStore } from "@/lib/subject/scoped-store";
import { setTestClock } from "@/lib/time/now";
import { agreedLink } from "../../support/agreed-link";

// a server render has no app router: the screens that read themselves again get one that does nothing
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, forward() {}, prefetch() {} }),
}));

const store = getMemoryStore();
const auth = getAuthProvider();
const AT = "2026-10-16T10:00:00+08:00";
const R2 = "If your reading at home is above 180 on top, or you get chest pain, weakness on one side, or your speech becomes slurred, go to A&E or call 995.";
const TIGHT = "my chest feels tight after climbing the stairs";
const ALL_ON: FamilyGrantItems = { ...NO_GRANTS, dose_summary: true, no_reply_alert: true, bp_summary: true, questions_count: true, notes: true, visit_transcripts: true };

let him: TestAccount;
let her: TestAccount;
let son: TestAccount;
/** her link: every switch OFF */
let herLink: string;
/** his son's link: every switch on */
let sonLink: string;

async function scope(): Promise<SessionRow> {
  const s = await store.getSession(him.userId);
  if (!s) throw new Error("no scope");
  return s;
}

async function bind(family: TestAccount, label: string, grants: FamilyGrantItems): Promise<string> {
  const inv = await store.createInvite({ patient_id: him.userId, patient_label: label, invite_token_hash: randomUUID(), invite_expires_at: "2099-01-01T00:00:00.000Z" }, grants);
  if (!inv.ok) throw new Error(inv.code);
  const acc = await store.acceptInvite(inv.link.invite_token_hash!, family.userId, "family");
  if (!acc.ok) throw new Error(acc.code);
  const ok = await store.confirmLink(inv.link.id, him.userId, true);
  if (!ok.ok) throw new Error(ok.code);
  await agreedLink(store, ok.link);
  return ok.link.id;
}

beforeAll(async () => {
  setTestClock({ at: AT, frozen: true });
  him = await createAccountWithSpace(store, auth, { login: `t${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  her = await createAccountWithSpace(store, auth, { login: `w${randomUUID().slice(0, 10)}`, password: "a long test password", space: "none" });
  son = await createAccountWithSpace(store, auth, { login: `s${randomUUID().slice(0, 10)}`, password: "a long test password", space: "none" });
  await store.updateAccount(son.userId, { locale: "en" });
  herLink = await bind(her, "爸爸", NO_GRANTS);
  sonLink = await bind(son, "Dad", ALL_ON);
});

afterAll(() => setTestClock(null));

/** One ask of his through the pipeline (offline), with the family-telling captured (and awaited when `tell` is given). */
async function askHim(text: string, locale: Locale, opts: { tell?: (input: TellInput) => Promise<TellResult>; role?: string; sessionId?: string } = {}) {
  const calls: TellInput[] = [];
  const pending: Promise<unknown>[] = [];
  const res = await ask(
    { sessionId: opts.sessionId ?? him.userId, text, locale, role: opts.role ?? "patient" },
    {
      store,
      llm: createMockLlm(),
      checker: null,
      checkerReason: "test",
      publish: () => {},
      costGuard: null,
      tellFamily: (input) => {
        calls.push(input);
        const p = opts.tell ? opts.tell(input) : Promise.resolve(null);
        pending.push(p);
        return p;
      },
    },
  );
  await Promise.all(pending);
  return { res, calls };
}

const ids = (r: AskResult) => r.sentences.map((s) => s.templateId ?? s.sourceId);
/** text as a server render writes it */
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");

describe("the trigger: Ripple's answer to HIS OWN message on the emergency route", () => {
  it("his chest tight after the stairs: kept for his doctor with his doctor's line and when to call 995 -> she is told (signal)", async () => {
    const { res, calls } = await askHim(TIGHT, "en");
    expect(res.route).toBe("emergency");
    expect(ids(res)).toEqual([SIGNAL_RECORDED.id, "visit:v1:R2", "signal_995_chest"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: "signal", eventId: res.events[0].id, scope: { id: him.userId, kind: "account" } });
  });

  it("「胸口痛」 and a reading above his doctor's number: signal; his own emergency: the 995 answer -> emergency", async () => {
    expect((await askHim("胸口痛", "zh-Hans")).calls.map((c) => c.kind)).toEqual(["signal"]);
    expect((await askHim("今天 185/112", "zh-Hans")).calls.map((c) => c.kind)).toEqual(["signal"]);
    const own = await askHim("My chest hurts and my left arm is weak", "en");
    expect(own.res.sentences[0].templateId).toBe("emergency_995");
    expect(own.calls.map((c) => c.kind)).toEqual(["emergency"]);
    expect((await askHim("喘不上气", "zh-Hans")).calls.map((c) => c.kind)).toEqual(["emergency"]);
  });

  it("someone else's crisis is not his: no one is told", async () => {
    const r = await askHim("My husband has chest pain", "en");
    expect(r.res.route).toBe("emergency");
    expect(r.res.sentences[0].templateId).toBe("emergency_995");
    expect(r.calls).toEqual([]);
  });

  it("self-harm, his own words: the helpline answer -> she is told (the owner, 10-16: 「也通知女儿」); someone else's is not", async () => {
    expect(TELL_FAMILY_ON_SELF_HARM).toBe(true);
    for (const [text, locale] of [
      ["I want to end my life", "en"],
      ["我不想活了", "zh-Hans"],
    ] as const) {
      const r = await askHim(text, locale);
      expect(r.res.route, text).toBe("self_harm");
      expect(r.res.sentences[0].templateId, text).toBe("self_harm_995");
      expect(r.calls.map((c) => c.kind), text).toEqual(["self_harm"]);
      expect(r.calls[0].eventId, text).toBe(r.res.events[0].id);
    }
    // what he reports of someone else (his own message, but not about him): the "they" lines, no one is told
    for (const text of ["My dad has been saying he's better off dead", "我爸说他活着没意思"]) {
      const r = await askHim(text, /\p{Script=Han}/u.test(text) ? "zh-Hans" : "en");
      expect(r.res.route, text).toBe("self_harm");
      expect(r.res.sentences[0].templateId, text).toBe("self_harm_995_other");
      expect(r.calls, text).toEqual([]);
    }
    // the one line that would turn it off again still does
    expect(familyAlarm({ route: "self_harm", signals: [], sentences: [] }, { selfHarm: false })).toBeNull();
    expect(familyAlarm({ route: "self_harm", signals: ["third_person"], sentences: [] })).toBeNull();
  });

  it("an ordinary answer, a note, a question about a medicine: no one is told", async () => {
    for (const [text, locale] of [
      ["What is amlodipine for?", "en"],
      ["我今天有点累", "zh-Hans"],
      ["Can I take an extra tablet when my reading is high?", "en"],
    ] as const) {
      const r = await askHim(text, locale);
      expect(r.res.route, text).not.toBe("emergency");
      expect(r.calls, text).toEqual([]);
    }
  });

  it("only his own asks on his own account: another asker, the demo", async () => {
    expect(familyAlarm({ route: "emergency", signals: [], role: "backstage", sentences: [] })).toBeNull();
    expect(familyAlarm({ route: "emergency", signals: [], role: "family", sentences: [] })).toBeNull();
    expect(familyAlarm({ route: "emergency", signals: ["child", "overdose"], sentences: [] })).toBeNull();
    expect(familyAlarm({ route: "explain", signals: [], sentences: [{ templateId: SIGNAL_RECORDED.id }] })).toBeNull();
    const demo = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
    expect((await askHim("我胸口好痛", "zh-Hans", { sessionId: demo.id })).calls).toEqual([]);
  });
});

describe("what she gets: every bound link, whatever the switches", () => {
  const sent: Notice[] = [];
  const events: { type: string; data: unknown }[] = [];
  let first: { res: AskResult; told: TellResult | null };

  beforeAll(async () => {
    // a new conversation (the harness, 10-16, reads today's safety records: the chest questions the tests above left
    // unanswered would count by now, and his fourth chest message of the day would be 995 now)
    await store.pruneSafetyEvents(him.userId, "2100-01-01T00:00:00.000Z");
    let told: TellResult | null = null;
    const { res } = await askHim(TIGHT, "en", {
      tell: async (input) => {
        told = await tellFamily(input, {
          // the real recipients: his active links through the care flow's narrow store, no switch read
          recipients: (id) => familyRecipients(id),
          send: async (n) => {
            sent.push(n);
            return { sent: 1 };
          },
          publish: (_sid, type, _say, data) => events.push({ type, data }),
        });
        return told!;
      },
    });
    first = { res, told };
  });

  it("one notice per link (her switches all off, his son's all on), each recorded once, each pushed", async () => {
    expect(first.told).toEqual({ links: 2, recorded: 2, sent: 2 });
    const rows = (await store.listDeliveries(him.userId)).filter((d) => d.kind === TOLD_KIND);
    expect(rows.map((r) => r.ref).sort()).toEqual([herLink, sonLink].sort());
    for (const r of rows) expect(r.slot).toBe(first.res.events[0].id);
    // the same ask again: nothing recorded, nothing sent
    const again = await tellFamily({ store, scope: await scope(), eventId: first.res.events[0].id, kind: "signal" }, { send: async () => ({ sent: 1 }), publish: () => {} });
    expect(again).toEqual({ links: 2, recorded: 0, sent: 0 });
  });

  it("the push: to her as family, in her language, nothing of what was said on the lock screen, the tap on the conversation", () => {
    expect(sent).toHaveLength(2);
    const toHer = sent.find((n) => n.to.role === "family" && n.to.linkId === herLink)!;
    const toSon = sent.find((n) => n.to.role === "family" && n.to.linkId === sonLink)!;
    expect(toHer).toMatchObject({ kind: "family_told", to: { role: "family", userId: her.userId }, locale: "zh-Hans", title: "爸爸跟 Ripple 说了一件可能要留意的事", ttlS: 3600 });
    expect(toSon).toMatchObject({ kind: "family_told", to: { role: "family", userId: son.userId }, locale: "en", title: "Dad told Ripple something that may need attention" });
    for (const n of [toHer, toSon]) {
      expect(n.url).toBe(`/f/alert/told?link=${encodeURIComponent(n.to.role === "family" ? n.to.linkId : "")}&id=${encodeURIComponent(n.deliveryId)}`);
      const built = payloadFromNotice(n);
      expect(built.replaced).toBe(false);
      // the words a lock screen shows (the ids and the url are random: a uuid like "…b38bc31803a7" once held "180" and
      // failed this under load, 10-16), with the ids and the url taken out
      const shown = JSON.stringify({ ...built.payload, url: "", tag: "", delivery: "", sent_at: "" });
      expect(shown).not.toMatch(/chest|stairs|995|180|胸/);
    }
  });

  it("her open pages are told on her own link's stream, as a content-free hint; another link's and the demo's drop it", () => {
    expect(events.map((e) => e.type)).toEqual(["family.told", "family.told"]);
    const ev = { id: 1, type: "family.told" as const, session_id: him.userId, at: AT, say: "x", data: { link: { id: herLink }, kind: "signal" } };
    expect(familyEvent(ev, NO_GRANTS, herLink)).toEqual({ kind: "hint", event: { id: 1, type: "family.told", session_id: him.userId, at: AT, say: "", data: {} } });
    expect(familyEvent(ev, ALL_ON, sonLink)).toEqual({ kind: "dropped", event: null });
    expect(familyEvent(ev, ALL_ON, null)).toEqual({ kind: "dropped", event: null });
  });

  it("what she reads, before the chat rows are written: his words, when, and Ripple's lines from the safety record", async () => {
    const notices = await toldNotices(store, await scope(), herLink);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ words: TIGHT, lang: "en", answerLang: "en", openedAt: null });
    expect(notices[0].lines.map((l) => l.text)).toEqual([first.res.sentences[0].en, R2, TEMPLATES.signal_995_chest.en]);
  });

  it("once his turn is kept: the same, from the chat rows, his doctor's line named as theirs with its day; through her own family store", async () => {
    const s = await scope();
    await recordAskTurn(store, s.id, { day: s.story_day, text: TIGHT, lang: "en", result: first.res });
    const hers = scopedStore(store, s, "family", { userId: her.userId, linkId: herLink, maskSessionId: true });
    const [n] = await toldNotices(hers, s, herLink);
    expect(n.words).toBe(TIGHT);
    expect(Date.parse(n.at)).toBe(Date.parse(AT));
    expect(n.lines).toEqual([
      { text: "I've noted what you told me (16 Oct, 10:00 am). It goes on the list of things to tell your doctor next time.", lang: "en" },
      { text: R2, lang: "en", by: "doctor", said: s.d0, translation: null },
      { text: TEMPLATES.signal_995_chest.en, lang: "en" },
    ]);
    // his son sees the same conversation through his own link; neither sees the other's notice
    expect((await toldNotices(store, s, sonLink)).map((x) => x.words)).toEqual([TIGHT]);
    expect((await toldNotices(store, s, "another-link")).length).toBe(0);
  });

  it("her home carries today's notice whatever the switches (every one off), with no word of what was said", async () => {
    const home = await familyHome(store, await scope(), { link: { id: herLink, patient_label: "爸爸" }, grants: NO_GRANTS, acknowledged: true }, Date.parse(AT));
    expect(home.told).toEqual({ id: expect.any(String), at: expect.any(String) });
    expect(JSON.stringify(home)).not.toContain("stairs");
  });

  it("her screens: the 「留意」 card, her home's line and the conversation page say what was said and what Ripple answered", async () => {
    const s = await scope();
    const [n] = await toldNotices(store, s, herLink);
    const home = await familyHome(store, s, { link: { id: herLink, patient_label: "爸爸" }, grants: NO_GRANTS, acknowledged: true }, Date.parse(AT));
    const record = { generatedAt: Date.parse(AT), grants: NO_GRANTS, entries: [], acknowledged: true, shown: [], nextVisit: null, count: 0 };
    const screen = renderToStaticMarkup(
      createElement(AlertScreen, { locale: "zh-Hans", linkId: herLink, since: 0, tz: "Asia/Singapore", initial: home, record: record as never, langHref: "/", dad: "爸爸", told: [n] }),
    );
    expect(screen).toContain('data-testid="told-card"');
    expect(screen).toContain(hc("zh-Hans", "toldTitle", { dad: "爸爸" }));
    expect(screen).toContain(`「${TIGHT}」`);
    expect(screen).toContain(esc(R2));
    expect(screen).toContain(esc(TEMPLATES.signal_995_chest.en));
    expect(screen).toContain("医生的原话 · ");
    expect(screen).toContain("今天 10:00");
    expect(screen).toContain(`/f/alert/told?link=${encodeURIComponent(herLink)}&amp;id=${encodeURIComponent(n.id)}`);
    const line = renderToStaticMarkup(createElement(ToldHomeLine, { told: home.told!, linkId: herLink, today: home.today, tz: "Asia/Singapore", locale: "en", dad: "Dad" }));
    expect(line).toContain("Dad told Ripple something that may need attention.");
    expect(line).not.toContain("stairs");
    const page = renderToStaticMarkup(createElement(ToldConversation, { notice: n, today: home.today, tz: "Asia/Singapore", locale: "en", dad: "Dad" }));
    expect(page).toContain(`“${TIGHT}”`);
    expect(page).toContain("He said · Today 10:00");
    expect(page).toContain("Ripple told him");
    expect(page).toContain(esc(R2));
    expect(page).toContain(esc("His doctor's own words"));
    expect(page).toContain(esc(hc("en", "toldNote", { dad: "Dad" })));
    // her look at the conversation, in his 「谁看过」 (lib/care/access-log.ts)
    expect(accessItemWords(["told"], "zh-Hans")).toBe("你的Ripple 对话（可能要留意的那段）");
    expect(accessItemWords(["told"], "en")).toBe("what you told Ripple that may need attention");
  });

  it("her tap marks it opened through her own link (the scoped store and the opened route take this kind)", async () => {
    const s = await scope();
    const row = (await store.listDeliveries(s.id)).find((d) => d.kind === TOLD_KIND && d.ref === herLink)!;
    expect(HER_KINDS.has(TOLD_KIND)).toBe(true);
    const hers = scopedStore(store, s, "family", { userId: her.userId, linkId: herLink, maskSessionId: true });
    expect((await hers.markDeliveryOpened(s.id, row.id)).opened_at).toEqual(expect.any(String));
    const sons = scopedStore(store, s, "family", { userId: son.userId, linkId: sonLink, maskSessionId: true });
    await expect(sons.markDeliveryOpened(s.id, row.id)).rejects.toThrow(/only the alert sent to her own link/);
  });
});

describe("a helpline answer, as she receives it (his own words about hurting himself)", () => {
  let elder: TestAccount;
  let daughter: TestAccount;
  let link: string;
  const sentTo: Notice[] = [];

  beforeAll(async () => {
    elder = await createAccountWithSpace(store, auth, { login: `h${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
    daughter = await createAccountWithSpace(store, auth, { login: `d${randomUUID().slice(0, 10)}`, password: "a long test password", space: "none" });
    const inv = await store.createInvite({ patient_id: elder.userId, patient_label: "爸爸", invite_token_hash: randomUUID(), invite_expires_at: "2099-01-01T00:00:00.000Z" }, NO_GRANTS);
    if (!inv.ok) throw new Error(inv.code);
    const acc = await store.acceptInvite(inv.link.invite_token_hash!, daughter.userId, "family");
    if (!acc.ok) throw new Error(acc.code);
    const ok = await store.confirmLink(inv.link.id, elder.userId, true);
    if (!ok.ok) throw new Error(ok.code);
    await agreedLink(store, ok.link);
    link = ok.link.id;
    const { res } = await askHim("我不想活了", "zh-Hans", {
      sessionId: elder.userId,
      tell: (input) => tellFamily(input, { send: async (n) => (sentTo.push(n), { sent: 1 }), publish: () => {} }),
    });
    const s = (await store.getSession(elder.userId))!;
    await recordAskTurn(store, s.id, { day: s.story_day, text: "我不想活了", lang: "zh-Hans", result: res });
  });

  it("her notice: his words, then Ripple's helpline lines exactly as he saw them (Mandarin, with the Mandarin hotline)", async () => {
    const s = (await store.getSession(elder.userId))!;
    const [n] = await toldNotices(store, s, link);
    expect(n.words).toBe("我不想活了");
    expect(n.answerLang).toBe("zh-Hans");
    // (the harness, 10-16: the ladder's lines after the helplines; "I've let your family know" because she is told)
    expect(n.lines).toEqual(
      ["self_harm_995", "self_harm_sos", "self_harm_mindline", "self_harm_care_corner", "self_harm_here", "self_harm_family_told", "self_harm_doctor"].map((id) => ({
        text: TEMPLATES[id as keyof typeof TEMPLATES].zh,
        lang: "zh-Hans",
      })),
    );
  });

  it("her screens in Chinese and English: the sentence, his words, the helplines, the call button; no clinical line of Ripple's own", async () => {
    const s = (await store.getSession(elder.userId))!;
    const [n] = await toldNotices(store, s, link);
    const home = await familyHome(store, s, { link: { id: link, patient_label: "爸爸" }, grants: NO_GRANTS, acknowledged: true }, Date.parse(AT));
    const record = { generatedAt: Date.parse(AT), grants: NO_GRANTS, entries: [], acknowledged: true, shown: [], nextVisit: null, count: 0 };
    for (const locale of ["zh-Hans", "en"] as const) {
      const dad = locale === "en" ? "Dad" : "爸爸";
      const screen = renderToStaticMarkup(createElement(AlertScreen, { locale, linkId: link, since: 0, tz: "Asia/Singapore", initial: home, record: record as never, langHref: "/", dad, told: [n] }));
      expect(screen, locale).toContain(hc(locale, "toldTitle", { dad }));
      expect(screen, locale).toContain(hc(locale, "toldRippleSaid", { dad }));
      expect(screen, locale).toContain("我不想活了");
      for (const id of ["self_harm_995", "self_harm_sos", "self_harm_mindline", "self_harm_care_corner"] as const) expect(screen, `${locale} ${id}`).toContain(esc(TEMPLATES[id].zh));
      expect(screen, locale).toContain('data-testid="call-dad"');
      // a helpline answer has no doctor's line: nothing is labelled as a clinician's words
      expect(screen, locale).not.toContain(hc(locale, "toldDoctorSaid", { dad }));
      const page = renderToStaticMarkup(createElement(ToldConversation, { notice: n, today: home.today, tz: "Asia/Singapore", locale, dad }));
      expect(page, locale).toContain(esc(hc(locale, "toldNote", { dad })));
    }
  });

  it("the push: her language, the same neutral words, none of his words or of the helplines on the lock screen", () => {
    expect(sentTo).toHaveLength(1);
    const [n] = sentTo;
    expect(n).toMatchObject({ kind: "family_told", locale: "zh-Hans", title: "爸爸跟 Ripple 说了一件可能要留意的事", body: "点开看看他说了什么、Ripple 怎么回他的。" });
    const built = payloadFromNotice(n);
    expect(built.replaced).toBe(false);
    expect(JSON.stringify(built.payload)).not.toMatch(/不想活|995|1767|1771|mindline|SOS/);
    expect(built.payload.url).toBe(`/f/alert/told?link=${encodeURIComponent(link)}&id=${encodeURIComponent(n.deliveryId)}`);
  });
});

describe("the push sender lets it through on her link alone (no switch)", () => {
  it("mayTellFamily: active and theirs -> yes; another person, another scope, an ended link -> no", async () => {
    expect(await mayTellFamily({ scopeId: him.userId, userId: her.userId, linkId: herLink })).toBe(true);
    expect(await mayTellFamily({ scopeId: him.userId, userId: son.userId, linkId: herLink })).toBe(false);
    expect(await mayTellFamily({ scopeId: her.userId, userId: her.userId, linkId: herLink })).toBe(false);
    expect(await mayTellFamily({ scopeId: him.userId, userId: her.userId, linkId: "no-such-link" })).toBe(false);
  });

  it("the sender asks only mayTell for this kind (never the no-reply switch), and stops when her link is not hers", async () => {
    const listed: string[] = [];
    const port = { list: async (id: string) => (listed.push(id), []), remove: async () => {} };
    const mayNotify = vi.fn(async () => false);
    const notice: Notice = {
      kind: "family_told",
      to: { role: "family", userId: her.userId, linkId: herLink },
      title: "爸爸跟 Ripple 说了一件可能要留意的事",
      body: "x",
      url: "/f/alert/told?link=x&id=y",
      tag: "told-1",
      ttlS: 3600,
      deliveryId: "d1",
      scopeId: him.userId,
      locale: "zh-Hans",
    };
    const vapid = () => ({ publicKey: "p", privateKey: "k", subject: "mailto:test@example.com", dev: true }) as never;
    const yes = createWebPushSender({ port: () => port, deps: { vapid }, mayNotify, mayTell: async () => true });
    await yes(notice, store);
    expect(listed).toEqual([her.userId]);
    const no = createWebPushSender({ port: () => port, deps: { vapid }, mayNotify, mayTell: async () => false });
    expect(await no(notice, store)).toEqual({ sent: 0 });
    expect(listed).toEqual([her.userId]);
    expect(mayNotify).not.toHaveBeenCalled();
  });
});

describe("told after his answer to a follow-up question (the harness, 10-16): the conversation before it", () => {
  it("her notice: his first message, Ripple's question and his tap, then Ripple's lines; never told for the question alone", async () => {
    const elder = await createAccountWithSpace(store, auth, { login: `q${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
    const daughter = await createAccountWithSpace(store, auth, { login: `r${randomUUID().slice(0, 10)}`, password: "a long test password", space: "none" });
    const inv = await store.createInvite({ patient_id: elder.userId, patient_label: "Dad", invite_token_hash: randomUUID(), invite_expires_at: "2099-01-01T00:00:00.000Z" }, NO_GRANTS);
    if (!inv.ok) throw new Error(inv.code);
    const acc = await store.acceptInvite(inv.link.invite_token_hash!, daughter.userId, "family");
    if (!acc.ok) throw new Error(acc.code);
    const ok = await store.confirmLink(inv.link.id, elder.userId, true);
    if (!ok.ok) throw new Error(ok.code);
    await agreedLink(store, ok.link);
    const pending: Promise<unknown>[] = [];
    const deps = {
      store,
      llm: createMockLlm(),
      checker: null,
      checkerReason: "test",
      publish: () => {},
      costGuard: null,
      tellFamily: (input: TellInput) => {
        const p = tellFamily(input, { send: async () => ({ sent: 1 }), publish: () => {} });
        pending.push(p);
        return p;
      },
    };
    const first = "What's the most amlodipine a person can take in one go?";
    const asked = await ask({ sessionId: elder.userId, text: first, locale: "en", role: "patient" }, deps);
    expect(asked.followUp?.templateId).toBe("self_harm_confirm");
    await Promise.all(pending);
    expect(pending).toHaveLength(0);
    const s = (await store.getSession(elder.userId))!;
    await recordAskTurn(store, s.id, { day: s.story_day, text: first, lang: "en", result: asked });
    const tapped = await ask({ sessionId: elder.userId, text: "I'd rather not say", locale: "en", role: "patient", reply: { followUpId: asked.followUp!.id, optionIds: ["rather_not"] } }, deps);
    await Promise.all(pending);
    expect(tapped.route).toBe("self_harm");
    await recordAskTurn(store, s.id, { day: s.story_day, text: "I'd rather not say", lang: "en", result: tapped });
    const [n] = await toldNotices(store, s, ok.link.id);
    expect(n.words).toBe(first);
    expect(n.steps).toEqual([{ question: asked.followUp!.en, answer: "I'd rather not say" }]);
    expect(n.lines.map((l) => l.text)).toEqual(tapped.sentences.map((x) => x.en));
    expect(n.lines.map((l) => l.text)).toContain(TEMPLATES.self_harm_family_told.en);
  });
});
