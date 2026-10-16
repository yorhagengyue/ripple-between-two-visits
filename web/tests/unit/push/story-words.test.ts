/**
 * No story word, no id and no clinical word on a lock screen: every push text the app can send, in both languages
 * (docs/plan/real-app.md 5.6 H3, line 1103: 「账号上…推送文字里都没有 Day \d+、第\d+天、加入码、跳转菜单、调试行 … 单元扫推送文字」;
 * 2.24 通知一览, lines 317-330: the six notices, their lock-screen words and where a tap lands; the lock-screen rule in
 * lib/push/payload.ts).
 *
 * "Every push text" is an enumeration that a new push cannot slip past:
 *   - the kinds are read from the source of the NoticeKind and PushKind unions and must equal the table below;
 *   - every file that imports the notice or the payload module is in a table with what it does, and every
 *     notice-shaped literal in the code is in one of the builders listed, with the kinds its source names;
 *   - the fixed words (OWN_WORDS, FALLBACK_WORDS, VISIT_READY_WORDS, the `notice.*` and `slotMed.*` sentences, the
 *     service worker's own fallback) are scanned as words;
 *   - each kind is then built by its real builder for an example account (Mr Tan's example on 2026-10-09, his
 *     amlodipine set to all four parts of the day so every slot's reminder exists; his daughter 「Wei Ling」 who calls
 *     him 「爸爸」) and sent by the real web push sender to a local push service: what is scanned is the payload a phone
 *     opens (tests/support/push-service.ts), not the notice the server holds.
 *
 * What a payload may not carry: /Day\s*\d+/i, /第\s*\d+\s*天/, a story or demo word, any date in its words, a date in
 * its tag other than his own today, a date of the demo template his layout has no day for, a uuid in its words, his
 * or her user id (his is his scope's id) anywhere, a care link's id anywhere but the address of a notice to her (and
 * the tag of his own 「已经接受」 notice: his own link, on his own phone, in a field that is never shown), a join code,
 * `?session=`, a medicine's name (the knowledge base's, his own list's, Chinese ones), a dose or a reading.
 *
 * A person's label reaches three lock screens: how she calls him (her "no reply" alert, 「爸爸在重设密码」) and his name
 * for her (「Wei Ling 已经接受」). Each is built again with labels that hold a medicine's name, a dose, a reading and a
 * medicine he typed himself (the lock-screen rule replaces the whole notice with the plain fallback words), and with a
 * day number (a person's own word, not the demo's story: it goes out as typed, and the sentence around it is clean).
 *
 * Recorded decisions followed where they differ from 2.24's table:
 *   - web/progress/d.md 「Wei Ling 已经接受」点开落在今天页的确认卡: the tap lands on /p/today?confirm=1 (2.24: /p/family).
 *   - web/progress/a.md 「8 爸爸在重设密码 通知」: the tap lands on /f?link=<her link> (2.24: /f), so her link's id is in
 *     the address of both notices to her, and nowhere else.
 *
 * The film crew's cues (lib/crew/filming-account.ts) build the reminder and the alert for a filming account, which
 * lives on the story's own dates by design (5.4): its tags carry those dates, its words are the same sentences.
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { announceFamilyHelp, mayHelpReset, RESET_HELP_KIND, resetHelpWords } from "@/lib/auth/family-reset-notice";
import { familyRecipients, mayNotifyFamily, mayTellFamily } from "@/lib/care/recipients";
// owner 10-16: 「爸爸跟 Ripple 说了一件可能要留意的事」 (lib/care/told.ts), built by his own emergency ask
import { tellFamily, TOLD_KIND, type TellResult } from "@/lib/care/told";
import { createMockLlm } from "@/lib/llm";
import { ask } from "@/lib/safety/pipeline";
import { filmingRef, findFilming, fireReminder, markFilming, moveForward, seedToMoment, simulateNoReply } from "@/lib/crew/filming-account";
import { bpWindows, runBpDay } from "@/lib/daily/bp-run";
import type { BpPlan } from "@/lib/daily/bp-schedule";
import { scopeSlotSchedule } from "@/lib/daily/cells";
import { dt, type DailyKey } from "@/lib/daily/i18n";
import { DELIVERY } from "@/lib/daily/no-reply";
import { SLOT_ORDER } from "@/lib/daily/slots";
import { DAILY_BP_JOB, DAILY_DOSES_JOB } from "@/lib/jobs/daily";
import { registerNoticeSender } from "@/lib/jobs/notify";
import { acceptedWords, FAMILY_ACCEPTED, notifyInviteAccepted } from "@/lib/push/accepted";
import { VISIT_READY_WORDS } from "@/lib/push/copy";
import { sendOwnPush } from "@/lib/push/own";
import { FALLBACK_WORDS, lockScreenProblems, OWN_WORDS, sitePath } from "@/lib/push/payload";
import { createWebPushSender, storeSubscriptions } from "@/lib/push/sender";
import { medName } from "@/lib/session/today";
import { MemoryStore } from "@/lib/store/memory";
import type { DaySlot, SessionRow } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { EXAMPLE_TODAY_DAY } from "@/lib/story/example";
import { loadTemplate } from "@/lib/story/seed";
import { careEntryStore } from "@/lib/subject/care";
import { filmingEntry } from "@/lib/subject/filming";
import { noticeScope, pushEntryStore } from "@/lib/subject/push";
import { zonedTimeToUtcMs } from "@/lib/time/clock";
import { setTestClock } from "@/lib/time/now";
import { startVisit } from "@/lib/visit/pipeline";
import { notifyVisitReady, VISIT_READY } from "@/lib/visit/ready-notice";
import { startPushService, type PushMessage, type PushService, type TestPhone } from "../../support/push-service";

type Locale = "zh-Hans" | "en";
const LOCALES: Locale[] = ["zh-Hans", "en"];
const WEB = process.cwd();
const read = (file: string) => readFileSync(path.join(WEB, file), "utf8");

// ---------------------------------------------------------------- the table: every kind a phone can get

type Who = "him" | "her";

interface KindRow {
  /** the row of 2.24 it is (or the push a person asks for themselves: 2.6, 2.23) */
  what: string;
  /** whose phone */
  to: Who[];
  /** the files that build it */
  builders: string[];
  /** whose label its words carry, if any */
  label: "how she calls him" | "his name for her" | null;
}

const KINDS: Record<string, KindRow> = {
  dose_first: { what: "吃药提醒, the first reminder of a slot", to: ["him"], builders: ["lib/daily/dose-run.ts", "lib/crew/filming-account.ts"], label: null },
  dose_second: { what: "吃药提醒, the second reminder of a slot", to: ["him"], builders: ["lib/daily/dose-run.ts", "lib/crew/filming-account.ts"], label: null },
  family_no_reply: { what: "两次没回, to a family member whose switch is on", to: ["her"], builders: ["lib/daily/dose-run.ts", "lib/crew/filming-account.ts"], label: "how she calls him" },
  bp_due: { what: "量血压", to: ["him"], builders: ["lib/daily/bp-run.ts"], label: null },
  visit_ready: { what: "看诊记录好了", to: ["him"], builders: ["lib/visit/ready-notice.ts"], label: null },
  // line bind (only add): lib/push/bound.ts sends 「… 绑定了你的账号」 under this kind (its own delivery row and words; tests/unit/care/bind-notice.test.ts)
  family_accepted: { what: "家人接受了", to: ["him"], builders: ["lib/push/accepted.ts", "lib/push/bound.ts"], label: "his name for her" },
  family_reset_help: { what: "爸爸在重设密码", to: ["her"], builders: ["lib/auth/family-reset-notice.ts"], label: "how she calls him" },
  // owner 10-16: to every family member bound to him whatever his switches, when Ripple answers his own message on the
  // emergency route; the tap opens the conversation (/f/alert/told), the lock screen says nothing of what was said
  family_told: { what: "爸爸跟 Ripple 说了一件可能要留意的事", to: ["her"], builders: ["lib/care/told.ts"], label: "how she calls him" },
  welcome: { what: "「提醒已经开好了」, right after a phone subscribes", to: ["him", "her"], builders: ["lib/push/own.ts"], label: null },
  test: { what: "「发一条试试」", to: ["him", "her"], builders: ["lib/push/own.ts"], label: null },
};
const OWN_KINDS = ["welcome", "test"];

/** Every file that imports the notice module or the payload module, and what it does with it. */
const FILES: Record<string, { builds: string[]; why: string }> = {
  "lib/daily/dose-run.ts": { builds: ["dose_first", "dose_second", "family_no_reply"], why: "the medicine day's job" },
  "lib/daily/bp-run.ts": { builds: ["bp_due"], why: "the blood pressure day's job" },
  "lib/visit/ready-notice.ts": { builds: ["visit_ready"], why: "a waiting visit got its record" },
  "lib/push/accepted.ts": { builds: ["family_accepted"], why: "she accepted his invitation" },
  "lib/push/bound.ts": { builds: ["family_accepted"], why: "line bind: she bound his account by typing it (the same notice kind, its own words)" },
  "lib/auth/family-reset-notice.ts": { builds: ["family_reset_help"], why: "he asks her to help him reset his password" },
  "lib/crew/filming-account.ts": { builds: ["dose_first", "dose_second", "family_no_reply"], why: "the film crew's cues on a filming account" },
  "lib/push/own.ts": { builds: ["welcome", "test"], why: "the pushes a person asks for themselves" },
  "lib/push/payload.ts": { builds: [], why: "the payload itself: it copies the kind it is given" },
  "lib/push/sender.ts": { builds: [], why: "the transport: sends what it is handed" },
  "lib/push/register.ts": { builds: [], why: "registers the sender" },
  "lib/asr/pending.ts": { builds: [], why: "hands its send function to notifyVisitReady" },
  "lib/auth/service.ts": { builds: [], why: "hands its send function to announceFamilyHelp" },
  "lib/care/facts.ts": { builds: [], why: "no push: borrows the lock-screen rule to refuse a dose or a reading in a fact she proposes" },
  "lib/care/told.ts": { builds: ["family_told"], why: "owner 10-16: Ripple answered his own message on the emergency route; his family is told" },
};

// ---------------------------------------------------------------- what a payload may not carry

const DAY_EN = /Day\s*\d+/gi;
const DAY_ZH = /第\s*\d+\s*天/g;
/** Words of the story and of the demo's tools (H3: 加入码、跳转菜单、调试行). */
const STORY_WORDS = /\b(?:story|demo|sandbox|backstage|director|filming|debug|jump to|join code|session)\b|故事|演示|沙盒|后台|导演|拍摄|调试|跳转|加入码/gi;
const DATE_WORDS = /\d{4}-\d{2}-\d{2}|\d{1,2}\s*月\s*\d{1,2}\s*日|\b\d{1,2}(?:st|nd|rd|th)? (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}\b/g;
const ISO_DATE = /\d{4}-\d{2}-\d{2}/g;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** A demo session's join code: six of the store's join alphabet (lib/store/memory.ts JOIN_ALPHABET), standing alone. */
const JOIN_CODE = /(?<![A-Za-z0-9])[A-HJ-NP-Z2-9]{6}(?![A-Za-z0-9])/g;
/** Medicine names, doses and readings, written here without the app's own lists (the lock-screen rule is asked too). */
const MEDICINE = /amlodipine|norvasc|ibuprofen|losartan|paracetamol|panadol|氨氯地平|络活喜|布洛芬|氯沙坦|扑热息痛|降压灵/gi;
const DOSE = /\d\s*(?:mg|mcg|ml|毫克|微克|毫升|粒|片|颗|tablets?|pills?)|[一二两三四五六七八九十半]\s*(?:粒|片|颗)/gi;
const READING = /\d{2,3}\s*\/\s*\d{2,3}/g;
const CHINESE_NAMES = ["氨氯地平", "布洛芬", "氯沙坦", "络活喜"];

const TEMPLATE_D0 = loadTemplate("mr-tan").meta.d0;
const TEMPLATE_DATES = [...new Set(read("fixtures/timeline.seed.json").match(ISO_DATE) ?? [])].sort();

/** What is known about the people a payload is about (never to be named in it). */
interface People {
  /** his date today on his own clock (the only date a tag may carry) */
  today: string;
  d0: string;
  /** user ids: his (his scope's id) and every family member's */
  userIds: string[];
  /** every care link of his */
  linkIds: string[];
  /** the medicine names on his own list */
  medicines: string[];
}

interface Payload {
  v: number;
  kind: string;
  title: string;
  body: string;
  url: string;
  tag: string;
  renotify: boolean;
  delivery: string | null;
  lang: string;
  sent_at: string;
}

const PAYLOAD_KEYS = ["body", "delivery", "kind", "lang", "renotify", "sent_at", "tag", "title", "url", "v"];
const hits = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => m[0]);

/** What is wrong with a title and body as words on a lock screen. Empty: nothing. */
function wordProblems(title: string, body: string, medicines: readonly string[] = []): string[] {
  const words = `${title}\n${body}`;
  const out: string[] = [];
  for (const [name, re] of [
    ["Day N", DAY_EN],
    ["第N天", DAY_ZH],
    ["a story word", STORY_WORDS],
    ["a date", DATE_WORDS],
    ["a uuid", UUID],
    ["a join code", JOIN_CODE],
    ["a medicine", MEDICINE],
    ["a dose", DOSE],
    ["a reading", READING],
  ] as const) {
    for (const h of hits(words, re)) out.push(`words: ${name} 「${h}」`);
  }
  // the app's own rule, with his list and the Chinese names
  for (const p of [...lockScreenProblems(title, [...medicines, ...CHINESE_NAMES]), ...lockScreenProblems(body, [...medicines, ...CHINESE_NAMES])]) out.push(`words: the lock-screen rule finds ${p}`);
  if (!title.trim()) out.push("words: no title");
  return out;
}

/** What is wrong with one payload a phone opened. Empty: nothing. Each line starts with the field it is about. */
function payloadProblems(p: Payload, people: People): string[] {
  const out = wordProblems(p.title, p.body, people.medicines);
  const text = JSON.stringify(p);
  for (const h of [...hits(text, DAY_EN), ...hits(text, DAY_ZH)]) if (!out.some((o) => o.includes(`「${h}」`))) out.push(`payload: 「${h}」`);
  if (Object.keys(p).sort().join() !== PAYLOAD_KEYS.join()) out.push(`payload: its fields are ${Object.keys(p).sort().join()}`);
  // ids of people: nowhere
  for (const id of people.userIds) if (text.includes(id)) out.push(`payload: a user id (${Object.entries(p).filter(([, v]) => String(v).includes(id)).map(([k]) => k).join()})`);
  // a care link's id: the address of a notice to her, and nothing else
  const toHer = KINDS[p.kind]?.to.join() === "her";
  for (const id of people.linkIds) {
    for (const [field, value] of Object.entries(p)) {
      if (!String(value).includes(id)) continue;
      if (field === "url" && toHer) continue;
      out.push(`${field}: a care link's id`);
    }
  }
  // dates: none of the template's that he has no day for; in the tag only his own today
  const own = new Set(Array.from({ length: EXAMPLE_TODAY_DAY + 1 }, (_, k) => storyDate(people.d0, k)));
  const { sent_at: _sent, ...rest } = p;
  for (const d of hits(JSON.stringify(rest), ISO_DATE)) {
    if (TEMPLATE_DATES.includes(d) && !own.has(d)) out.push(`payload: the template's date ${d}`);
    else if (d !== people.today) out.push(`payload: a date that is not his today (${d})`);
  }
  // the address: a path on this site, his pages or hers, never a demo session
  if (sitePath(p.url) !== p.url) out.push(`url: not a path on this site (${p.url})`);
  // (owner 10-16: 「爸爸跟 Ripple 说了…」 lands on the conversation itself, /f/alert/told: her pages are /f and under it)
  if (!/^\/(?:p\/|f(?:\/|\?|$))/.test(p.url)) out.push(`url: neither his pages nor hers (${p.url})`);
  if (/[?&]session=|rp_session|demo-/.test(`${p.url} ${p.tag}`)) out.push("url: a demo session");
  for (const [field, value] of [
    ["url", p.url],
    ["tag", p.tag],
  ] as const) {
    for (const h of hits(value, JOIN_CODE)) out.push(`${field}: a join code 「${h}」`);
  }
  if (p.v !== 1) out.push("payload: v");
  if (!["zh-Hans", "en"].includes(p.lang)) out.push("payload: lang");
  if (!(p.kind in KINDS)) out.push(`payload: a kind that is not in the table (${p.kind})`);
  return out;
}

// ---------------------------------------------------------------- a household, and one day of every push

const TODAY = "2026-10-09"; // a Friday: d0 2026-08-28, four days after the template's
const D0 = storyDate(TODAY, -EXAMPLE_TODAY_DAY);
const sg = (time: string, date = TODAY) => zonedTimeToUtcMs(date, time);
const at = (ms: number) => setTestClock({ at: ms, frozen: true });
const login = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const TYPED_MEDICINE = "降压灵";

/** A person's label that must not reach a lock screen as it is, and the piece of it that must not be there. */
interface Hostile {
  id: string;
  label: string;
  piece: string;
}
const CLINICAL: Hostile[] = [
  { id: "a medicine's name", label: "爸爸 Amlodipine", piece: "Amlodipine" },
  { id: "a medicine's Chinese name", label: "爸爸氨氯地平", piece: "氨氯地平" },
  { id: "a dose", label: "Dad 5 mg", piece: "5 mg" },
  { id: "a count of tablets", label: "爸爸一粒", piece: "一粒" },
  { id: "a reading", label: "Dad 150/95", piece: "150/95" },
  { id: "a medicine he typed on his own list", label: `爸爸${TYPED_MEDICINE}`, piece: TYPED_MEDICINE },
];
const STORY: Hostile[] = [
  { id: "a day number", label: "Dad Day 12", piece: "Day 12" },
  { id: "a story day", label: "爸爸第12天", piece: "第12天" },
];

interface Member {
  /** null: the realistic one (Wei Ling, who calls him 爸爸 / Dad) */
  hostile: Hostile | null;
  her: TestAccount;
  linkId: string;
  phone: TestPhone;
}

interface World {
  locale: Locale;
  store: MemoryStore;
  him: TestAccount;
  hisPhone: TestPhone;
  members: Member[];
  people: People;
  visitId: string;
  requestId: string;
  /** every push of the day, as the phones opened them */
  got: PushMessage[];
}

const SLOT_WORDS: Record<DaySlot, { zh: string; en: string; first: string; second: string }> = {
  morning: { zh: "早间药物", en: "Morning medicine", first: "8:45", second: "9:15" },
  midday: { zh: "午间药物", en: "Midday medicine", first: "12:45", second: "13:15" },
  evening: { zh: "晚间药物", en: "Evening medicine", first: "18:45", second: "19:15" },
  night: { zh: "睡前药物", en: "Bedtime medicine", first: "21:30", second: "22:00" },
};

let service: PushService;
const worlds = {} as Record<Locale, World>;

function useSender(store: MemoryStore): void {
  registerNoticeSender(
    createWebPushSender({
      port: () => storeSubscriptions(pushEntryStore(store)),
      mayNotify: (to, kind) => mayNotifyFamily(to, kind, { store: careEntryStore(store) }),
      mayHelpReset: (to) => mayHelpReset(to, { store: careEntryStore(store) }),
      mayTell: (to) => mayTellFamily(to, { store: careEntryStore(store) }),
    }),
  );
}

/** One example account and its family, one day: every kind of push, built by its own builder, sent by the real sender. */
async function household(locale: Locale): Promise<World> {
  const store = new MemoryStore();
  const auth = getAuthProvider();
  useSender(store);
  const from = service.messages.length;
  at(sg("07:00"));
  const him = await createAccountWithSpace(store, auth, { login: login("h"), password: "a long test password", space: "example", locale });
  // every part of the day has a reminder, and one medicine on his list is a name he typed himself
  await store.updateMed(him.userId, "med-amlodipine", { dose_slots: [...SLOT_ORDER], dose_slots_source: "patient" });
  await store.upsertMed(him.userId, { id: "med-typed", drug_id: null, origin: "supplement", status: "label_confirmed", label: { text: TYPED_MEDICINE, drug: TYPED_MEDICINE } });
  const hisPhone = service.newPhone({ label: "his" });
  await store.savePushSubscription({ user_id: him.userId, endpoint: hisPhone.endpoint, ...hisPhone.keys });

  // his family: Wei Ling, and one member for each label that must not reach a lock screen as it is
  const members: Member[] = [];
  for (const hostile of [null, ...CLINICAL, ...STORY]) {
    const her = await createAccountWithSpace(store, auth, { login: login("f"), password: "a long test password", space: "none", locale });
    const phone = service.newPhone({ label: hostile ? hostile.id : "hers" });
    await store.savePushSubscription({ user_id: her.userId, endpoint: phone.endpoint, ...phone.keys });
    const hash = randomUUID();
    const invited = await store.createInvite(
      { patient_id: him.userId, relation: "daughter", family_label: hostile ? hostile.label : "Wei Ling", patient_label: hostile ? hostile.label : locale === "en" ? "Dad" : "爸爸", invite_token_hash: hash, invite_expires_at: "2099-01-01T00:00:00.000Z" },
      { no_reply_alert: true },
    );
    if (!invited.ok) throw new Error(invited.code);
    // she accepts (lib/care/links.ts acceptInviteAs: the store's step, then his phone is told), he confirms, and he
    // turns on 「忘记密码时，让她帮我」 for her
    const accepted = await store.acceptInvite(hash, her.userId);
    if (!accepted.ok) throw new Error(accepted.code);
    expect(await notifyInviteAccepted(accepted.link, { scopeFor: (id) => noticeScope(id, store) })).toEqual({ recorded: true, sent: 1 });
    const confirmed = await store.confirmLink(invited.link.id, him.userId, true);
    if (!confirmed.ok) throw new Error(confirmed.code);
    const helper = await store.setLinkResetHelper(invited.link.id, him.userId, true);
    if (!helper.ok) throw new Error(helper.code);
    members.push({ hostile, her, linkId: invited.link.id, phone });
  }

  // the pushes a person asks for: his, and Wei Ling's
  at(sg("07:05"));
  for (const kind of ["welcome", "test"] as const) {
    expect(await sendOwnPush(store, him.userId, kind, { locale, patient: true })).toMatchObject({ sent: 1 });
    expect(await sendOwnPush(store, members[0].her.userId, kind, { locale, patient: false })).toMatchObject({ sent: 1 });
  }

  // the day: the blood pressure plan's two parts (the example has none of the doctor's: the job's own pass is handed one),
  // and each slot's first reminder, second reminder and close
  const scope = (await store.getSession(him.userId))!;
  const plan: BpPlan = {
    words: { text: "Measure it every morning and evening.", itemId: "plan", visitId: "v2", visitDay: 8, visitDate: storyDate(D0, 8), utteranceId: null, tStartMs: null, clipUrl: null, standIn: false, recordedAt: scope.tracking_since! },
    kind: "daily",
    perWeek: null,
    parts: ["morning", "evening"],
    fromDay: 9,
    toDay: null,
  };
  const steps: { ms: number; run: (ms: number) => Promise<unknown> }[] = [];
  for (const w of bpWindows(scope, plan, EXAMPLE_TODAY_DAY)) steps.push({ ms: w.remindMs, run: async (ms) => runBpDay(store, (await store.getSession(him.userId))!, ms, { plan, locale }) });
  for (const slot of SLOT_ORDER) {
    const s = scopeSlotSchedule(scope, slot);
    for (const time of [s.first, s.second, s.closes]) steps.push({ ms: sg(time), run: (ms) => DAILY_DOSES_JOB.run({ store, nowMs: ms, holder: "test" }) });
  }
  steps.sort((a, b) => a.ms - b.ms);
  for (const step of steps) {
    at(step.ms);
    await step.run(step.ms);
  }
  // the scheduled blood pressure job itself never reminds him: the example holds no frequency the doctor gave
  expect(await DAILY_BP_JOB.run({ store, nowMs: sg("23:00"), holder: "test" })).toMatchObject({ reminded: 0, sent: 0 });

  // the evening: a visit he recorded has its record, and he asks his family to help him reset his password
  at(sg("23:10"));
  const now = (await store.getSession(him.userId))!;
  const visit = await startVisit(store, now, { mode: "record", consent: { given: true } });
  expect(await notifyVisitReady(store, now, visit, { locale })).toEqual({ recorded: true, sent: 1 });
  const request = await store.createResetRequest({ user_id: him.userId, device_hash: "d".repeat(64), expires_at: new Date(sg("23:20")).toISOString() });
  const helpers = await store.listCareLinks({ patient_id: him.userId, status: ["active"] });
  expect(await announceFamilyHelp(store, now, helpers, request, 600)).toBe(members.length);

  // owner 10-16: late in the evening he tells Ripple his chest feels tight: Ripple keeps it for his doctor with when to
  // call 995, and every family member bound to him is told (his own ask, through the pipeline, offline)
  at(sg("23:15"));
  let told: Promise<TellResult> | null = null;
  const answer = await ask(
    { sessionId: him.userId, text: "my chest feels tight after climbing the stairs", locale: "en", role: "patient" },
    {
      store,
      llm: createMockLlm(),
      checker: null,
      checkerReason: "test",
      publish: () => {},
      costGuard: null,
      tellFamily: (input) => (told = tellFamily(input, { recipients: (id) => familyRecipients(id, { store: careEntryStore(store) }), publish: () => {} })),
    },
  );
  expect(answer.route).toBe("emergency");
  expect(await told).toEqual({ links: members.length, recorded: members.length, sent: members.length });

  registerNoticeSender(null);
  const meds = await store.listMeds(him.userId);
  const people: People = {
    today: TODAY,
    d0: D0,
    userIds: [him.userId, ...members.map((m) => m.her.userId)],
    linkIds: members.map((m) => m.linkId),
    medicines: [...new Set(meds.flatMap((m) => [medName(m), m.label?.drug ?? "", m.drug_id ?? ""]).filter(Boolean))],
  };
  return { locale, store, him, hisPhone, members, people, visitId: visit.id, requestId: request.id, got: service.messages.slice(from) };
}

beforeAll(async () => {
  service = await startPushService();
  for (const locale of LOCALES) worlds[locale] = await household(locale);
}, 120_000);
afterAll(async () => {
  registerNoticeSender(null);
  setTestClock(null);
  await service.close();
});

const payloadOf = (m: PushMessage) => m.payload as unknown as Payload;
const toPhone = (w: World, phone: TestPhone, kind?: string) => w.got.filter((m) => m.phone === phone.id && (!kind || m.payload?.kind === kind)).map(payloadOf);
const wei = (w: World) => w.members[0];

// ================================================================= the list is complete (read from the source)

/** The string members of an exported union type, another union named in it expanded. */
function unionMembers(file: string, name: string, known: Record<string, string[]> = {}): string[] {
  const m = new RegExp(`export type ${name}\\s*=([^;]+);`).exec(read(file));
  if (!m) throw new Error(`${file} has no exported type ${name}`);
  const body = m[1].replace(/\/\/[^\n]*/g, "");
  const out = [...body.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  for (const [other, members] of Object.entries(known)) if (new RegExp(`\\b${other}\\b`).test(body)) out.push(...members);
  return out.sort();
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(WEB, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(WEB, rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}
const SOURCES = ["lib", "app", "components"].flatMap(sourceFiles).sort();

const importsNoticeOrPayload = (file: string, src: string) =>
  /from\s+"@\/lib\/jobs\/notify"|from\s+"@\/lib\/push\/payload"/.test(src) || (file.startsWith("lib/jobs/") && /from\s+"\.\/notify"/.test(src)) || (file.startsWith("lib/push/") && /from\s+"\.\/payload"/.test(src));

/** A notice or payload being written out: `kind` (or `kind: <expr>`), then `to: {…}` when it is a notice, then `title:`. */
const NOTICE_LITERAL = /\bkind(?::\s*([^\n]+?))?,\s*\n\s*(?:to:\s*\{[^\n]*\},\s*\n\s*)?title:/g;
/** The same with the `to` it is for: a notice, wherever it is written. */
const NOTICE_WRITTEN = /\bkind(?::\s*[^\n]+?)?,\s*\n\s*to:\s*\{[^\n]*\},\s*\n\s*title:/;
const KIND_CONSTANTS: Record<string, string> = { VISIT_READY, FAMILY_ACCEPTED, RESET_HELP_KIND, TOLD_KIND };

/** The kinds a kind expression names: its string literals, DELIVERY.x, and the three exported constants (of `a ? b : c`, b and c). */
function kindsNamed(whole: string): string[] {
  const expr = whole.includes("?") ? whole.slice(whole.indexOf("?") + 1) : whole;
  const out = [...expr.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  for (const m of expr.matchAll(/\bDELIVERY\.(\w+)/g)) out.push((DELIVERY as Record<string, string>)[m[1]] ?? `DELIVERY.${m[1]}?`);
  for (const [name, value] of Object.entries(KIND_CONSTANTS)) if (new RegExp(`\\b${name}\\b`).test(expr)) out.push(value);
  return out;
}

/** The kinds of every notice-shaped literal in a source file; "?" for one this test cannot read. */
function kindsBuilt(src: string): { literals: number; kinds: string[] } {
  const kinds = new Set<string>();
  let literals = 0;
  for (const m of src.matchAll(NOTICE_LITERAL)) {
    literals += 1;
    let expr = m[1];
    if (expr === undefined) {
      // `kind,`: the nearest `const kind = …;` before it, else a parameter typed as a union of literals
      const before = src.slice(0, m.index);
      expr = [...before.matchAll(/\b(?:const|let)\s+kind(?::\s*\w+)?\s*=\s*([^;]+);/g)].at(-1)?.[1] ?? [...before.matchAll(/\bkind:\s*((?:"[a-z_]+"\s*\|\s*)+"[a-z_]+")/g)].at(-1)?.[1] ?? "";
    }
    // the payload copies the kind it was handed
    if (/^(?:input|notice)\.kind$/.test(expr.trim())) continue;
    const named = kindsNamed(expr);
    if (!named.length) kinds.add(`? (${expr.trim().slice(0, 60)})`);
    for (const k of named) kinds.add(k);
  }
  return { literals, kinds: [...kinds].sort() };
}

describe("the list of pushes is complete", () => {
  const noticeKinds = unionMembers("lib/jobs/notify.ts", "NoticeKind");
  const pushKinds = unionMembers("lib/push/payload.ts", "PushKind", { NoticeKind: noticeKinds });

  it("the kinds in the NoticeKind and PushKind unions are exactly the table's", () => {
    expect(noticeKinds).toEqual(["bp_due", "dose_first", "dose_second", "family_accepted", "family_no_reply", "family_reset_help", "family_told", "visit_ready"]);
    expect(pushKinds).toEqual([...noticeKinds, ...OWN_KINDS].sort());
    expect(Object.keys(KINDS).sort()).toEqual(pushKinds);
    // the six notices of 2.24 (the medicine reminder is two kinds), the reset help, the owner's 10-16 family_told, and the
    // two a person asks for
    expect(noticeKinds).toHaveLength(8);
  });

  it("every file that imports the notice or the payload module is in the table, and no other file writes a notice out", () => {
    const importing = SOURCES.filter((f) => importsNoticeOrPayload(f, read(f)));
    expect(importing).toEqual(Object.keys(FILES).sort());
    // a notice written out anywhere in the code (kind, to, title) is in one of the builders; lib/push/own.ts writes
    // payloads, not notices, and is on the list above through its import
    const writing = SOURCES.filter((f) => NOTICE_WRITTEN.test(read(f)));
    expect(writing).toEqual(Object.keys(FILES).filter((f) => FILES[f].builds.length > 0 && f !== "lib/push/own.ts").sort());
    expect(SOURCES.length).toBeGreaterThan(300);
  });

  it("each builder's source names exactly the kinds the table gives it; the others write none", () => {
    for (const [file, row] of Object.entries(FILES)) {
      const built = kindsBuilt(read(file));
      expect(built.kinds, file).toEqual([...row.builds].sort());
      if (row.builds.length) expect(built.literals, file).toBeGreaterThan(0);
    }
    // and the table's two views agree: a kind's builders are the files that build it
    for (const [kind, row] of Object.entries(KINDS)) {
      expect(Object.keys(FILES).filter((f) => FILES[f].builds.includes(kind)).sort(), kind).toEqual([...row.builders].sort());
    }
    // the reader can fail: a kind it does not know shows as "?", a new literal shows as itself
    expect(kindsBuilt('const n: Notice = {\n  kind: SOMETHING_NEW,\n  to: { role: "patient", userId },\n  title: "x",\n};').kinds).toEqual(["? (SOMETHING_NEW)"]);
    expect(kindsBuilt('send({\n  kind: "weekly_summary",\n  to: { role: "patient", userId },\n  title: "x",\n});').kinds).toEqual(["weekly_summary"]);
  });

  it("the fixed words: every table and sentence a push is made of, each clean as words", () => {
    const words: [string, string, string][] = [];
    // the pushes a person asks for
    expect(Object.keys(OWN_WORDS).sort()).toEqual(["family", "patient"]);
    for (const who of ["patient", "family"] as const) {
      expect(Object.keys(OWN_WORDS[who]).sort()).toEqual(["en", "zh-Hans"]);
      for (const locale of LOCALES) {
        expect(Object.keys(OWN_WORDS[who][locale]).sort()).toEqual(["test", "welcome"]);
        for (const kind of ["welcome", "test"] as const) words.push([`OWN_WORDS.${who}.${locale}.${kind}`, OWN_WORDS[who][locale][kind].title, OWN_WORDS[who][locale][kind].body]);
      }
    }
    expect(Object.keys(FALLBACK_WORDS).sort()).toEqual(["en", "zh-Hans"]);
    expect(Object.keys(VISIT_READY_WORDS).sort()).toEqual(["en", "zh-Hans"]);
    for (const locale of LOCALES) {
      words.push([`FALLBACK_WORDS.${locale}`, FALLBACK_WORDS[locale].title, FALLBACK_WORDS[locale].body]);
      words.push([`VISIT_READY_WORDS.${locale}`, VISIT_READY_WORDS[locale].title, VISIT_READY_WORDS[locale].body]);
      // a name left empty: the sentence's own stand-in for the person
      for (const empty of [null, "", "   "]) {
        words.push([`acceptedWords(${JSON.stringify(empty)}, ${locale})`, acceptedWords(empty, locale).title, acceptedWords(empty, locale).body]);
        words.push([`resetHelpWords(${JSON.stringify(empty)}, ${locale})`, resetHelpWords(empty, locale).title, resetHelpWords(empty, locale).body]);
      }
    }
    // the jobs' sentences: every notice.* key there is, and the four slots
    const i18n = read("lib/daily/i18n.ts");
    const noticeKeys = [...new Set([...i18n.matchAll(/"(notice\.[a-z.]+)"/gi)].map((m) => m[1]))].sort();
    expect(noticeKeys).toEqual(["notice.bp.body", "notice.bp.title", "notice.dose.body", "notice.family.body", "notice.family.title", "notice.family.who"]);
    expect([...new Set([...i18n.matchAll(/"slotMed\.([a-z]+)"/g)].map((m) => m[1]))].sort()).toEqual([...SLOT_ORDER].sort());
    for (const locale of LOCALES) {
      for (const slot of SLOT_ORDER) {
        const slotMed = dt(locale, `slotMed.${slot}` as DailyKey);
        expect(slotMed).toBe(SLOT_WORDS[slot][locale === "en" ? "en" : "zh"]);
        words.push([`dose ${slot} ${locale}`, slotMed, dt(locale, "notice.dose.body")]);
        words.push([
          `family ${slot} ${locale}`,
          dt(locale, "notice.family.title", { who: dt(locale, "notice.family.who"), slotMed: slotMed.toLowerCase() }),
          dt(locale, "notice.family.body", { first: SLOT_WORDS[slot].first, second: SLOT_WORDS[slot].second }),
        ]);
      }
      words.push([`bp ${locale}`, dt(locale, "notice.bp.title"), dt(locale, "notice.bp.body")]);
    }
    expect(words).toHaveLength(8 + 2 + 2 + 12 + 16 + 2);
    for (const [name, title, body] of words) expect(wordProblems(title, body, [TYPED_MEDICINE]).map((p) => `${name}: ${p}`)).toEqual([]);
    // no sentence is left with a hole in it
    for (const [name, title, body] of words) expect(`${title}${body}`, name).not.toMatch(/[{}]|undefined|null/);
  });

  it("the service worker shows the payload's own words, and only 「Ripple」 when a push cannot be read", () => {
    const sw = read("public/sw.js");
    expect(sw).toContain('readPayload(event) || { title: "Ripple", body: "", url: HOME, tag: "ripple", kind: null }');
    expect(sw).toContain("self.registration.showNotification(p.title, options)");
    expect([...sw.matchAll(/showNotification\(/g)]).toHaveLength(1);
    expect(wordProblems("Ripple", "")).toEqual([]);
  });
});

// ================================================================= every kind, as the phones opened it

/** The words and the fields each kind must have for Wei Ling's father's household (2.24, and the recorded decisions). */
function expected(w: World): Record<string, { phone: TestPhone; payloads: Omit<Payload, "delivery" | "sent_at" | "v" | "lang">[]; delivery: boolean }> {
  const zh = w.locale === "zh-Hans";
  const her = wei(w);
  const dad = zh ? "爸爸" : "Dad";
  const dose = (kind: string) =>
    SLOT_ORDER.map((slot) => ({
      kind,
      title: zh ? SLOT_WORDS[slot].zh : SLOT_WORDS[slot].en,
      body: zh ? "尚未记录" : "Not logged yet",
      url: `/p/today?remind=dose-${slot}`,
      tag: `dose-${TODAY}-${slot}`,
      renotify: kind === "dose_second",
    }));
  return {
    dose_first: { phone: w.hisPhone, delivery: true, payloads: dose("dose_first") },
    dose_second: { phone: w.hisPhone, delivery: true, payloads: dose("dose_second") },
    family_no_reply: {
      phone: her.phone,
      delivery: true,
      payloads: SLOT_ORDER.map((slot) => ({
        kind: "family_no_reply",
        title: zh ? `爸爸尚未回应${SLOT_WORDS[slot].zh}提醒` :`Dad hasn't answered about the ${SLOT_WORDS[slot].en.toLowerCase()}`,
        body: zh ? `${SLOT_WORDS[slot].first} 和 ${SLOT_WORDS[slot].second} 两次提醒均未回应。` : `Neither reminder, at ${SLOT_WORDS[slot].first} or ${SLOT_WORDS[slot].second}, got a reply.`,
        url: `/f?link=${her.linkId}`,
        tag: `no-reply-${TODAY}-${slot}`,
        renotify: false,
      })),
    },
    bp_due: {
      phone: w.hisPhone,
      delivery: true,
      payloads: (["morning", "evening"] as const).map((part) => ({
        kind: "bp_due",
        title: zh ? "该测量血压了" : "Time to measure your blood pressure",
        body: zh ? "打开 Ripple 记录一次" : "Open Ripple to record it",
        url: "/p/bp",
        tag: `bp-${TODAY}-${part}`,
        renotify: false,
      })),
    },
    visit_ready: {
      phone: w.hisPhone,
      delivery: true,
      payloads: [{ kind: "visit_ready", title: zh ? "就诊记录已生成" : "Your visit record is ready", body: zh ? "请打开 Ripple 确认。" : "Open Ripple to check it.", url: `/p/visit/${w.visitId}/review`, tag: `visit-ready-${w.visitId}`, renotify: false }],
    },
    family_accepted: {
      phone: w.hisPhone,
      delivery: true,
      payloads: [
        {
          kind: "family_accepted",
          title: zh ? "Wei Ling 已经接受" : "Wei Ling has accepted",
          body: zh ? "点开确认一下：你确认以前，对方什么都看不到。" : "Open to confirm. Until you do, they see nothing.",
          url: "/p/today?confirm=1",
          tag: `family-accepted-${her.linkId}`,
          renotify: false,
        },
      ],
    },
    family_reset_help: {
      phone: her.phone,
      delivery: true,
      payloads: [{ kind: "family_reset_help", title: zh ? "爸爸在重设密码" : `${dad} is resetting their password`, body: zh ? "打开 Ripple 看看" : "Open Ripple to see it", url: `/f?link=${her.linkId}`, tag: `reset-help-${w.requestId}`, renotify: false }],
    },
    // owner 10-16: nothing of what he said or of Ripple's answer; the tap opens that conversation
    family_told: {
      phone: her.phone,
      delivery: true,
      payloads: [
        {
          kind: "family_told",
          title: zh ? "爸爸跟 Ripple 说了一件可能要留意的事" : "Dad told Ripple something that may need attention",
          body: zh ? "点开看看他说了什么、Ripple 怎么回他的。" : "Open to see what he said and what Ripple told him.",
          url: expect.stringMatching(new RegExp(`^/f/alert/told[?]link=${her.linkId}&id=delivery-[0-9a-f-]{36}$`)) as unknown as string,
          tag: expect.stringMatching(/^told-/) as unknown as string,
          renotify: false,
        },
      ],
    },
  };
}

/**
 * The one place outside an address where a care link's id is allowed: the tag of 「Wei Ling 已经接受」 on his own phone
 * (the exception, with its reasons and the check that it is the only one, is the test 「her link's id: …」 below).
 */
const linkIdInAcceptedTag = (p: Payload, problem: string) => p.kind === "family_accepted" && problem === "tag: a care link's id";

for (const locale of LOCALES) {
  describe(`every push of one day on an example account, as the phones opened it (${locale})`, () => {
    it("every kind in the table reached the phone it is for, and no kind outside the table was sent", () => {
      const w = worlds[locale];
      expect(w.got.every((m) => m.status === 201 && m.problem === null && m.payload !== null)).toBe(true);
      const realistic = w.got.filter((m) => m.phone === w.hisPhone.id || m.phone === wei(w).phone.id).map(payloadOf);
      expect([...new Set(realistic.map((p) => p.kind))].sort()).toEqual(Object.keys(KINDS).sort());
      for (const [kind, row] of Object.entries(KINDS)) {
        expect(toPhone(w, w.hisPhone, kind).length > 0, `${kind} on his phone`).toBe(row.to.includes("him"));
        expect(toPhone(w, wei(w).phone, kind).length > 0, `${kind} on her phone`).toBe(row.to.includes("her"));
      }
      // nothing of hers on his phone, nothing of his on hers; the other family members get only what a family member gets
      for (const m of w.members.slice(1)) expect([...new Set(toPhone(w, m.phone).map((p) => p.kind))].sort()).toEqual(["family_no_reply", "family_reset_help", "family_told"]);
    });

    it("the words and the fields of each notice are the designed ones (2.24), with the delivery id and nothing else", () => {
      const w = worlds[locale];
      for (const [kind, want] of Object.entries(expected(w))) {
        const got = toPhone(w, want.phone, kind).filter((p) => kind !== "family_accepted" || p.tag.endsWith(wei(w).linkId));
        expect(got.map(({ kind: k, title, body, url, tag, renotify }) => ({ kind: k, title, body, url, tag, renotify })), kind).toEqual(want.payloads);
        for (const p of got) {
          expect(p, kind).toMatchObject({ v: 1, lang: locale });
          expect(p.delivery, kind).toMatch(/^delivery-[0-9a-f-]{36}$/);
          expect(Object.keys(p).sort()).toEqual(PAYLOAD_KEYS);
        }
      }
      // the two a person asks for: his about his reminders, hers about being told; no delivery row behind them
      for (const [who, phone, url] of [
        ["patient", w.hisPhone, "/p/me/notifications"],
        ["family", wei(w).phone, "/f"],
      ] as const) {
        for (const kind of ["welcome", "test"] as const) {
          expect(toPhone(w, phone, kind)).toEqual([{ v: 1, kind, title: OWN_WORDS[who][locale][kind].title, body: OWN_WORDS[who][locale][kind].body, url, tag: `ripple-${kind}`, renotify: true, delivery: null, lang: locale, sent_at: expect.any(String) }]);
        }
      }
      if (locale === "zh-Hans") {
        // 2.6: the welcome he sees arrive
        expect(toPhone(w, w.hisPhone, "welcome")[0].title).toBe("提醒已经开好了");
      }
    });

    it("no payload of the realistic household carries a story word, a date that is not his today, an id of a person, a join code, or a clinical word", () => {
      const w = worlds[locale];
      const realistic = w.got.filter((m) => m.phone === w.hisPhone.id || m.phone === wei(w).phone.id);
      // his phone also got 「… 已经接受」 for the other family members: those carry their labels and are read further down
      const mine = realistic.map(payloadOf).filter((p) => p.kind !== "family_accepted" || p.tag.endsWith(wei(w).linkId));
      expect(mine.length).toBe(8 + 2 + 1 + 1 + 2 + 4 + 1 + 2 + 1);
      const found = mine.flatMap((p) => payloadProblems(p, w.people).filter((problem) => !linkIdInAcceptedTag(p, problem)).map((problem) => `${p.kind} ${p.tag}: ${problem}`));
      expect(found).toEqual([]);
      // the raw text a phone opened, once more, for the ids (nothing rides along outside the fields)
      for (const m of realistic) {
        for (const id of w.people.userIds) expect(m.text, String(m.payload?.kind)).not.toContain(id);
        expect(m.text).not.toMatch(/session=|demo-/);
      }
      // his medicine names were really known to the sender: the scan had something to find
      expect(w.people.medicines).toEqual(expect.arrayContaining(["Amlodipine", "Ibuprofen", TYPED_MEDICINE]));
    });

    // A care link's id is in two places and no third: the address of the notices to her (her pages carry it the same
    // way), and the tag of 「Wei Ling 已经接受」 on HIS phone (lib/push/accepted.ts: one notice per link, so a second family
    // member's does not replace the first; it is his own link, the id his own /p/family/<id> address carries, and a tag
    // is never shown). Neither is forbidden by the payload's rule (no scope id, no user id).
    it("her link's id: in the address of the notices to her, in the tag of his own 「已经接受」, and nowhere else in any payload", () => {
      const w = worlds[locale];
      const found = w.got.map(payloadOf).flatMap((p) =>
        payloadProblems(p, w.people)
          .filter((problem) => problem.endsWith("a care link's id") && !linkIdInAcceptedTag(p, problem))
          .map((problem) => `${p.kind}: ${problem}`),
      );
      expect(found).toEqual([]);
      // and the tag case is really there (so the exception above is used, not vacuous)
      const inTag = w.got.map(payloadOf).filter((p) => payloadProblems(p, w.people).some((problem) => linkIdInAcceptedTag(p, problem)));
      expect(new Set(inTag.map((p) => p.kind))).toEqual(new Set(["family_accepted"]));
    });

    it("her link's id is in the address of her alert and of 「爸爸在重设密码」 (so the scan above had it to find), and in no words", () => {
      const w = worlds[locale];
      for (const m of w.members) {
        for (const kind of ["family_no_reply", "family_reset_help"]) {
          const got = toPhone(w, m.phone, kind);
          expect(got.length, `${kind} to ${m.hostile?.id ?? "Wei Ling"}`).toBe(kind === "family_no_reply" ? 4 : 1);
          for (const p of got) {
            expect(p.url).toBe(`/f?link=${m.linkId}`);
            expect(`${p.title}${p.body}${p.tag}`).not.toContain(m.linkId);
          }
        }
      }
    });
  });

  describe(`a person's label on a lock screen (${locale})`, () => {
    /** The three notices that carry the label of the family member `m`: two on her phone, one on his. */
    const labelled = (w: World, m: Member): Payload[] => [
      ...toPhone(w, m.phone, "family_no_reply"),
      ...toPhone(w, m.phone, "family_reset_help"),
      ...toPhone(w, m.phone, "family_told"),
      ...toPhone(w, w.hisPhone, "family_accepted").filter((p) => p.tag.endsWith(m.linkId)),
    ];

    it("the three kinds that carry a label are the ones the table says, and each was built for every label", () => {
      const w = worlds[locale];
      expect(Object.keys(KINDS).filter((k) => KINDS[k].label !== null).sort()).toEqual(["family_accepted", "family_no_reply", "family_reset_help", "family_told"]);
      for (const m of w.members) expect(labelled(w, m).map((p) => p.kind), m.hostile?.id ?? "Wei Ling").toEqual(["family_no_reply", "family_no_reply", "family_no_reply", "family_no_reply", "family_reset_help", "family_told", "family_accepted"]);
      // the realistic label is on the lock screen as it is: the fallback is not what every label gets
      for (const p of labelled(w, wei(w))) expect(p.title).toMatch(/爸爸|Dad|Wei Ling/);
    });

    for (const hostile of CLINICAL) {
      it(`a label holding ${hostile.id} (「${hostile.label}」): the plain fallback words go out instead, on all three`, () => {
        const w = worlds[locale];
        const m = w.members.find((x) => x.hostile === hostile)!;
        for (const p of labelled(w, m)) {
          expect({ title: p.title, body: p.body }, p.kind).toEqual(FALLBACK_WORDS[locale]);
          expect(JSON.stringify(p).toLowerCase(), p.kind).not.toContain(hostile.piece.toLowerCase());
          expect(payloadProblems(p, w.people).filter((problem) => !linkIdInAcceptedTag(p, problem)), p.kind).toEqual([]);
          // the address and the tag stay the notice's own: she still lands on her page, he on his card
          if (p.kind === "family_told") expect(p.url.startsWith(`/f/alert/told?link=${m.linkId}&id=`)).toBe(true);
          else expect(p.url).toBe(p.kind === "family_accepted" ? "/p/today?confirm=1" : `/f?link=${m.linkId}`);
        }
      });
    }

    // A label is the person's own word for someone. The lock-screen rule (lib/push/payload.ts lockScreenProblems) takes
    // medicine names, doses and readings out of it, as above. A day number in a label (「爸爸第12天」) is not the demo's
    // story reaching an account (H3 is about what the app itself writes: every sentence of its own is scanned above): it
    // is what that person typed, and it goes out as typed. Asserted here so the behaviour is on record.
    for (const hostile of STORY) {
      for (const kind of ["family_no_reply", "family_reset_help", "family_told", "family_accepted"]) {
        it(`${kind}: a label holding ${hostile.id} (「${hostile.label}」) goes out as the person typed it; nothing else in the words is a story word`, () => {
          const w = worlds[locale];
          const m = w.members.find((x) => x.hostile === hostile)!;
          const got = labelled(w, m).filter((p) => p.kind === kind);
          expect(got.length).toBeGreaterThan(0);
          for (const p of got) {
            expect(`${p.title}\n${p.body}`).toContain(hostile.piece);
            // with the label's own piece taken out, the app's sentence around it is clean
            const without = (text: string) => text.split(hostile.piece).join("");
            expect(wordProblems(without(p.title), without(p.body), w.people.medicines)).toEqual([]);
          }
        });
      }
    }

    it("each of those notices with a day number in its label was really built and sent, and nothing but the label's own piece is flagged", () => {
      const w = worlds[locale];
      for (const hostile of STORY) {
        const m = w.members.find((x) => x.hostile === hostile)!;
        expect(labelled(w, m).map((p) => p.kind)).toEqual(["family_no_reply", "family_no_reply", "family_no_reply", "family_no_reply", "family_reset_help", "family_told", "family_accepted"]);
        // nothing else is wrong with them: no medicine, dose or reading that would have brought the fallback anyway
        for (const p of labelled(w, m)) {
          expect(wordProblems(p.title, p.body, w.people.medicines).filter((problem) => !/^words: (?:Day N|第N天) /.test(problem)), `${p.kind} 「${p.title}」`).toEqual([]);
          expect(payloadProblems(p, w.people).filter((problem) => !/^words: (?:Day N|第N天) /.test(problem) && !linkIdInAcceptedTag(p, problem)), p.kind).toEqual([]);
        }
      }
    });
  });
}

// ================================================================= the film crew's cues

describe("the film crew's cues on a filming account: the same sentences, the story's own dates in the tag", () => {
  it("the reminder popped twice and the simulated no-reply: his two reminders and her alert, clean but for the story's date", async () => {
    for (const locale of LOCALES) {
      const store = new MemoryStore();
      const auth = getAuthProvider();
      useSender(store);
      try {
        const real = Date.parse("2026-10-10T14:00:00+08:00");
        at(real);
        const him = await createAccountWithSpace(store, auth, { login: login("j"), password: "a long test password", space: "example", locale });
        const her = await createAccountWithSpace(store, auth, { login: login("f"), password: "a long test password", space: "none", locale });
        const hash = randomUUID();
        const invited = await store.createInvite({ patient_id: him.userId, family_label: "Wei Ling", patient_label: locale === "en" ? "Dad" : "爸爸", relation: "daughter", invite_token_hash: hash, invite_expires_at: "2099-01-01T00:00:00.000Z" }, { no_reply_alert: true });
        if (!invited.ok) throw new Error(invited.code);
        const accepted = await store.acceptInvite(hash, her.userId);
        if (!accepted.ok) throw new Error(accepted.code);
        const confirmed = await store.confirmLink(invited.link.id, him.userId, true);
        if (!confirmed.ok) throw new Error(confirmed.code);
        const hisPhone = service.newPhone({ label: "his (filming)" });
        const herPhone = service.newPhone({ label: "hers (filming)" });
        await store.savePushSubscription({ user_id: him.userId, endpoint: hisPhone.endpoint, ...hisPhone.keys });
        await store.savePushSubscription({ user_id: her.userId, endpoint: herPhone.endpoint, ...herPhone.keys });

        // the director lays the account out to the hero evening (Day 29) and moves on to the next morning's reminder
        await markFilming(store, (await store.getSession(him.userId))!);
        const subject = (await findFilming(filmingRef(him.userId), filmingEntry(store)))!;
        await seedToMoment(subject, { scene: "d29-hero" }, real);
        await moveForward(subject, { time: "08:45" }, real);
        const from = service.messages.length;
        expect(await fireReminder(subject, {}, real, { locale })).toMatchObject({ kind: "dose_first", date: "2026-09-23", sent: 1 });
        expect(await fireReminder(subject, {}, real, { locale })).toMatchObject({ kind: "dose_second", sent: 1 });
        expect(await simulateNoReply(subject, {}, real, { locale, recipients: (id) => familyRecipients(id, { store: careEntryStore(store) }) })).toMatchObject({ slot: "morning", date: "2026-09-23", family: 1 });

        const got = service.messages.slice(from);
        const zh = locale === "zh-Hans";
        expect(got.map((m) => [m.label, m.status, m.payload?.kind, m.payload?.title, m.payload?.body, m.payload?.url, m.payload?.tag])).toEqual([
          ["his (filming)", 201, "dose_first", zh ? "早间药物" : "Morning medicine", zh ? "尚未记录" : "Not logged yet", "/p/today?remind=dose-morning", "dose-2026-09-23-morning"],
          ["his (filming)", 201, "dose_second", zh ? "早间药物" : "Morning medicine", zh ? "尚未记录" : "Not logged yet", "/p/today?remind=dose-morning", "dose-2026-09-23-morning"],
          [
            "hers (filming)",
            201,
            "family_no_reply",
            zh ? "爸爸尚未回应早间药物提醒" : "Dad hasn't answered about the morning medicine",
            zh ? "8:45 和 9:15 两次提醒均未回应。" : "Neither reminder, at 8:45 or 9:15, got a reply.",
            `/f?link=${invited.link.id}`,
            "no-reply-2026-09-23-morning",
          ],
        ]);
        // a filming account's today is the story's (5.4): that date is its own; everything else as on any account
        const meds = await store.listMeds(him.userId);
        const people: People = { today: "2026-09-23", d0: TEMPLATE_D0, userIds: [him.userId, her.userId], linkIds: [invited.link.id], medicines: meds.map((m) => medName(m)) };
        expect(got.flatMap((m) => payloadProblems(payloadOf(m), people).map((p) => `${String(m.payload?.kind)}: ${p}`))).toEqual([]);
      } finally {
        registerNoticeSender(null);
      }
    }
  }, 60_000);
});

// ================================================================= controls: the scan can fail

describe("controls", () => {
  const people: People = { today: TODAY, d0: D0, userIds: ["0b0e4f6e-58a5-4b0a-9a39-0d2f1c9e7a11"], linkIds: ["7c1f6f0a-2d0b-4c0e-8a55-6f1b2a3c4d5e"], medicines: ["Amlodipine", TYPED_MEDICINE] };
  const good: Payload = { v: 1, kind: "dose_first", title: "早间药物", body: "尚未记录", url: "/p/today?remind=dose-morning", tag: `dose-${TODAY}-morning`, renotify: false, delivery: "delivery-1", lang: "zh-Hans", sent_at: "2026-10-09T00:45:00.000Z" };

  it("a clean payload has no problem; each planted value is found, in the field it was planted in", () => {
    expect(payloadProblems(good, people)).toEqual([]);
    expect(payloadProblems({ ...good, kind: "family_no_reply", title: "爸爸尚未回应早间药物提醒", body: "8:45 和 9:15 两次提醒均未回应。", url: `/f?link=${people.linkIds[0]}`, tag: `no-reply-${TODAY}-morning` }, people)).toEqual([]);
    const planted: [Partial<Payload>, string][] = [
      [{ title: "Day 41 提醒" }, "words: Day N 「Day 41」"],
      [{ body: "第 41 天还没记" }, "words: 第N天 「第 41 天」"],
      [{ title: "day12" }, "words: Day N 「day12」"],
      [{ body: "演示里的提醒" }, "words: a story word 「演示」"],
      [{ body: "Join code K7M2QX" }, "words: a join code 「K7M2QX」"],
      [{ body: "10月9日 的药" }, "words: a date 「10月9日」"],
      [{ body: "9 Oct medicine" }, "words: a date 「9 Oct」"],
      [{ title: people.userIds[0] }, "words: a uuid"],
      [{ title: "Amlodipine 还没记" }, "words: a medicine 「Amlodipine」"],
      [{ title: `${TYPED_MEDICINE}还没记` }, `words: the lock-screen rule finds ${TYPED_MEDICINE}`],
      [{ body: "早上 5 mg" }, "words: a dose"],
      [{ body: "早上吃一粒" }, "words: a dose"],
      [{ body: "今天 150/95" }, "words: a reading"],
      [{ tag: `dose-${people.userIds[0]}` }, "payload: a user id (tag)"],
      [{ url: `/p/today?u=${people.userIds[0]}` }, "payload: a user id (url)"],
      [{ tag: `family-accepted-${people.linkIds[0]}` }, "tag: a care link's id"],
      [{ url: `/f?link=${people.linkIds[0]}` }, "url: a care link's id"],
      [{ tag: "dose-2026-08-24-morning" }, "payload: the template's date 2026-08-24"],
      [{ tag: "dose-2026-10-08-morning" }, "payload: a date that is not his today (2026-10-08)"],
      [{ url: "https://evil.example/p/today" }, "url: not a path on this site"],
      [{ url: "/demo" }, "url: neither his pages nor hers"],
      [{ url: "/p/today?session=demo-1" }, "url: a demo session"],
      [{ tag: "K7M2QX" }, "tag: a join code 「K7M2QX」"],
      [{ kind: "weekly_summary" }, "payload: a kind that is not in the table"],
      [{ scope: "x" } as Partial<Payload>, "payload: its fields are"],
    ];
    for (const [change, want] of planted) {
      const found = payloadProblems({ ...good, ...change }, people);
      expect(found.some((f) => f.startsWith(want)), `${JSON.stringify(change)} -> ${JSON.stringify(found)}`).toBe(true);
    }
  });

  it("the join-code pattern is the demo's: a real sandbox's code matches it, an account has none", async () => {
    const store = new MemoryStore();
    const demo = await store.createSession({ ttl_hours: 1 });
    expect(hits(`Join ${demo.join_code} now`, JOIN_CODE)).toEqual([demo.join_code]);
    expect(wordProblems("早上的药", `加入码 ${demo.join_code}`).length).toBeGreaterThan(0);
    for (const locale of LOCALES) expect(((await worlds[locale].store.getSession(worlds[locale].him.userId)) as SessionRow).join_code).toBeNull();
    // the template's dates are strays for this household's layout, so the date check had something to refuse
    expect(TEMPLATE_DATES).toContain(TEMPLATE_D0);
    expect(TEMPLATE_D0 < D0).toBe(true);
  });
});
