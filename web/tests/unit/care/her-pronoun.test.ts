/**
 * Her screens say him the way she calls him (her link's label, `patient_label`): 爸爸 is 他, 妈妈 is 她, and a name she
 * typed (or his own name, which the link carries when she chose none) stands where a pronoun would, never guessed
 * (lib/care/copy.ts elderWords; every copy file of hers fills {dad}, {he}, {his}, {him} from it).
 *
 *   the table      the owner's family words and their English ones (Dad, Mum…), in either language; a name for itself;
 *                  the name word itself as she gave it, as before
 *   every word     each sentence of hers (her-copy, 留意's, the calendar's, the binding's she reads, the components'
 *                  own, her home's sentences, the long press's family set) with 妈妈: no 爸爸 and no 他; in English with
 *                  Mum: no Dad and no he / his / him; with a name: no pronoun at all
 *   her screens    drawn with the label 妈妈 (her home, 留意, the shared list, her reminder, the bind result, the
 *                  invitation, 我的's pieces): the same, his own words in 「」 apart
 * With 爸爸 every sentence is what it was (the other tests of her screens hold that).
 *
 * Mr Tan's example account laid out on Tue 13 Oct 2026 (morning reminders 08:45 / 09:15), his daughter's link labelled
 * 妈妈 (the test's whole point: the account is his, the word is hers), the developer test clock, frozen.
 */
import { randomUUID } from "node:crypto";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AlertScreen } from "@/components/family/AlertScreen";
import { FamilyApp } from "@/components/family/FamilyApp";
import { NotShared } from "@/components/family/HerShared";
import { LeaveButton, NotificationsPage, PhonePage, PhoneRow } from "@/components/family/HerBits";
import { acceptError } from "@/components/family/InviteScreen";
import { RecordFeed, shownEntries } from "@/components/family/RecordFeed";
import { ReminderLocked } from "@/components/family/ReminderLocked";
import { ReminderStudio } from "@/components/family/ReminderStudio";
import { ResetHelpScreen } from "@/components/family/ResetHelp";
import { WaitingForDad } from "@/components/family/WaitingForDad";
import { FamilyError, FamilyHomeSkeleton, InviteAccept, NoReplyAlert, ReminderRecorder, SharedSection } from "@/components/family-ui";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { bc, bindRefusal } from "@/lib/care/bind-copy";
import { dadWord, elderSex, elderWords, grantName, headline, headlineLede, privacyLine, sharedHeadline, timelineWords } from "@/lib/care/copy";
import { hc, herKeys } from "@/lib/care/her-copy";
import { herPaths, homeHeadline, sharedItems, timelineItems } from "@/lib/care/her-view";
import { familyHome } from "@/lib/care/home";
import type { FamilyHomeData, HomeState, TimelineLine } from "@/lib/care/home-types";
import { linesWords, mc, monthKeys } from "@/lib/care/month-copy";
import { herRecord } from "@/lib/care/record";
import { allRecordStrings, rc } from "@/lib/care/record-copy";
import { herReminders } from "@/lib/care/reminders";
import { answerDose } from "@/lib/daily/doses";
import { factWords, holdWords } from "@/lib/explain/copy";
import { NO_GRANTS } from "@/lib/family/types";
import type { Locale } from "@/lib/i18n";
import { MemoryStore } from "@/lib/store/memory";
import type { CareLinkRow, FamilyGrantItems, SessionRow } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";
import { familyCopy } from "@/lib/ui/copy";

// a server render has no app router: the screens that read themselves again get one that does nothing
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, forward() {}, prefetch() {} }),
}));

const LOCALES: Locale[] = ["zh-Hans", "en"];
const MUM = "妈妈";
const KEYS: (keyof FamilyGrantItems)[] = ["dose_summary", "bp_summary", "questions_count", "no_reply_alert", "visit_transcripts", "notes"];
const ALL: FamilyGrantItems = { dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: true, notes: true };
const TZ = "Asia/Singapore";
const SGT = (hhmm: string) => `2026-10-13T${hhmm}:00+08:00`;

/** Someone's words in their marks (his own words, 「是她」 on his button) are not what the screen says of him. */
const unquoted = (s: string) => s.replace(/「[^」]*」|“[^”]*”|"[^"]*"/g, "");
/** 他 about him, and 爸爸 (其他 is "other", not him) */
const ZH_HE = /(?<!其)他|爸爸/;
/** he / his / him and Dad, in English */
const EN_HE = /\b(he|his|him|himself|dad)\b/i;
/** any pronoun at all (her word is a name: none may be guessed) */
const ZH_ANY = /(?<!其)他|她|爸爸/;
const EN_ANY = /\b(he|his|him|himself|she|her|hers|herself|dad|mum)\b/i;
/** a fill-in left unfilled */
const HOLE = /\{(dad|he|his|him|He|His|himself)\}/;

/** What a screen says, as text (tags out, entities back). */
const said = (html: string) =>
  html
    .replace(/<[^>]+>/g, "\n")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
const draw = (el: ReactElement) => said(renderToStaticMarkup(el));

/** Every line of `text` that still says him as 爸爸 / 他 (or, in English, Dad / he), his quoted words apart. */
function sayingHim(text: string, locale: Locale): string[] {
  const re = locale === "en" ? EN_HE : ZH_HE;
  return text.split("\n").filter((line) => re.test(unquoted(line)) || HOLE.test(line));
}
function sayingAny(text: string, locale: Locale): string[] {
  const re = locale === "en" ? EN_ANY : ZH_ANY;
  return text.split("\n").filter((line) => re.test(unquoted(line)) || HOLE.test(line));
}
/**
 * Her word for him when a sentence is asked for on its own: 妈妈 on a 华语 page, the bind form's English chip "Mum" on an
 * English one (the screens drawn below use the link's own label, 妈妈, in either language, as the app does).
 */
const mum = (locale: Locale) => (locale === "en" ? "Mum" : MUM);

describe("the scan itself", () => {
  it("finds 爸爸 / 他 and Dad / he, leaves his quoted words and 其他 alone, and a pronoun of either kind for a name", () => {
    expect(sayingHim("你现在看不到他的记录了。", "zh-Hans")).toHaveLength(1);
    expect(sayingHim("打电话给爸爸", "zh-Hans")).toHaveLength(1);
    expect(sayingHim("Call Dad", "en")).toHaveLength(1);
    expect(sayingHim("Once he confirms", "en")).toHaveLength(1);
    expect(sayingHim("{his}笔记", "zh-Hans")).toHaveLength(1);
    expect(sayingHim("妈妈说：「他说的」", "zh-Hans")).toEqual([]);
    expect(sayingHim("其他原因", "zh-Hans")).toEqual([]);
    expect(sayingHim("This week", "en")).toEqual([]);
    expect(sayingAny("她的记录", "zh-Hans")).toHaveLength(1);
    expect(sayingAny("Her notes", "en")).toHaveLength(1);
    // the sentences as they were, with 爸爸: what this file would catch
    expect(sayingHim(hc("zh-Hans", "endedBody"), "zh-Hans")).toHaveLength(1);
    expect(sayingHim(familyCopy("en", null).inviteWaitTitle, "en")).toHaveLength(1);
  });
});

describe("the helper: how her screens refer to him", () => {
  it("华语: the owner's family words say 他 or 她; anything else stands for itself", () => {
    for (const w of ["爸爸", "父亲", "爷爷", "外公", "姥爷", "公公", "叔叔", "伯伯", "舅舅", "哥哥", "老公", "先生"]) {
      expect(elderWords(w, "zh-Hans"), w).toMatchObject({ dad: w, he: "他", his: "他的", him: "他" });
      expect(elderSex(w), w).toBe("he");
    }
    for (const w of ["妈妈", "母亲", "奶奶", "外婆", "姥姥", "婆婆", "阿姨", "姑姑", "姨妈", "姐姐", "老婆", "太太"]) {
      expect(elderWords(w, "zh-Hans"), w).toMatchObject({ dad: w, he: "她", his: "她的", him: "她" });
      expect(elderSex(w), w).toBe("she");
    }
    // a name (or his own name on a link where she chose none, or a title with a name): never guessed
    expect(elderWords("阿嬷", "zh-Hans")).toEqual({ dad: "阿嬷", he: "阿嬷", his: "阿嬷的", him: "阿嬷", He: "阿嬷", His: "阿嬷的", himself: "阿嬷自己" });
    expect(elderWords("陈先生", "zh-Hans")).toMatchObject({ dad: "陈先生", he: "陈先生", his: "陈先生的" });
    expect(elderWords(" 林美玲 ", "zh-Hans")).toMatchObject({ dad: "林美玲", he: "林美玲", his: "林美玲的" });
    expect(elderSex("阿嬷")).toBeNull();
    // no word at all: 爸爸, as her screens always said
    expect(elderWords(null, "zh-Hans")).toEqual({ dad: "爸爸", he: "他", his: "他的", him: "他", He: "他", His: "他的", himself: "他自己" });
    expect(elderWords("  ", "zh-Hans").dad).toBe("爸爸");
  });

  it("English: he / his / him, she / her / her, a name for itself; the word itself as she gave it, in either language", () => {
    expect(elderWords("Dad", "en")).toEqual({ dad: "Dad", he: "he", his: "his", him: "him", He: "He", His: "His", himself: "himself" });
    expect(elderWords("Mum", "en")).toEqual({ dad: "Mum", he: "she", his: "her", him: "her", He: "She", His: "Her", himself: "herself" });
    expect(elderWords("Ah Ma", "en")).toEqual({ dad: "Ah Ma", he: "Ah Ma", his: "Ah Ma's", him: "Ah Ma", He: "Ah Ma", His: "Ah Ma's", himself: "themselves" });
    expect(elderWords(null, "en")).toMatchObject({ dad: "Dad", he: "he", his: "his" });
    expect(elderWords("Mom", "en")).toMatchObject({ dad: "Mom", he: "she" });
    expect(elderWords("grandma", "en")).toMatchObject({ dad: "grandma", he: "she", His: "Her" });
    // the name word is the label as today, whichever language she gave it in; the pronoun follows it on both pages
    expect(elderWords("爸爸", "en")).toMatchObject({ dad: "爸爸", he: "he", his: "his" });
    expect(elderWords("妈妈", "en")).toMatchObject({ dad: "妈妈", he: "she", his: "her" });
    expect(elderWords("Dad", "zh-Hans")).toMatchObject({ dad: "Dad", he: "他" });
    expect(elderWords("Mum", "zh-Hans")).toMatchObject({ dad: "Mum", he: "她" });
    expect(elderWords("阿嬷", "en")).toMatchObject({ dad: "阿嬷", his: "阿嬷's" });
    expect(dadWord("妈妈", "en")).toBe("妈妈");
    expect(dadWord(null, "en")).toBe("Dad");
    // a screen that holds only her word asks with it and gets the same answer
    for (const label of ["爸爸", "妈妈", "Dad", "Mum", "阿嬷", "Ah Ma", null])
      for (const l of LOCALES) expect(elderWords(elderWords(label, l).dad, l), `${label} ${l}`).toEqual(elderWords(label, l));
  });
});

describe("every sentence of hers, with her word 妈妈", () => {
  /** her-copy's one sentence that is about no one she follows (she has no link: whoever will invite her) */
  const NO_LINK = new Set(["noLinkBody"]);

  it("her-copy: no 爸爸, no 他; in English no Dad, no he / his / him; with a name, no pronoun", () => {
    for (const locale of LOCALES) {
      for (const key of herKeys()) {
        if (NO_LINK.has(key)) continue;
        const text = hc(locale, key, { dad: mum(locale) });
        expect(sayingHim(text, locale), `${locale} ${key}: ${text}`).toEqual([]);
        const named = hc(locale, key, { dad: locale === "en" ? "Ah Ma" : "阿嬷" });
        expect(sayingAny(named, locale), `${locale} ${key}: ${named}`).toEqual([]);
      }
    }
    expect(hc("zh-Hans", "endedBody", { dad: MUM })).toBe("你现在看不到她的记录了。想再看，请她在自己的手机上重新绑定你。");
    expect(hc("zh-Hans", "endedBody", { dad: "阿嬷" })).toBe("你现在看不到阿嬷的记录了。想再看，请阿嬷在自己的手机上重新绑定你。");
    expect(hc("en", "notSeen", { dad: "Mum" })).toBe("Her notes and her visit recordings stay hidden unless she turns them on.");
    expect(hc("en", "factKind_clinic", { dad: "Ah Ma" })).toBe("Ah Ma's usual clinic");
    // with 爸爸 (or no word), as it was
    expect(hc("zh-Hans", "endedBody", { dad: "爸爸" })).toBe("你现在看不到他的记录了。想再看，请他在自己的手机上重新绑定你。");
    expect(hc("zh-Hans", "notSeen")).toBe("他的笔记和就诊录音，需本人开启后才会向你显示。");
    expect(hc("en", "waitNote", { dad: "Dad" })).toBe("Once he confirms, he chooses on his phone what you can see, one item at a time.");
  });

  it("留意's, the calendar's and the binding's sentences she reads", () => {
    for (const locale of LOCALES) {
      for (const [key] of allRecordStrings(locale)) expect(sayingHim(rc(locale, key, { dad: mum(locale) }), locale), `${locale} ${key}`).toEqual([]);
      for (const key of monthKeys()) expect(sayingHim(mc(locale, key, { dad: mum(locale) }), locale), `${locale} ${key}`).toEqual([]);
      expect(sayingHim(linesWords(3, mum(locale), locale), locale)).toEqual([]);
      for (const key of ["locked", "lockedFact", "herRemoved"] as const) expect(sayingHim(bc(locale, key, { dad: mum(locale) }), locale), `${locale} ${key}`).toEqual([]);
      expect(sayingHim(bindRefusal(locale, "family", "bind_removed", undefined, mum(locale)), locale)).toEqual([]);
    }
    expect(rc("en", "addLocked", { dad: "Mum" })).toBe("Once Mum taps “Got it” on her own phone, this can go on the question list.");
    expect(bc("zh-Hans", "locked", { dad: MUM })).toBe("等她在自己的手机上点了「知道了」，你就可以给她录提醒。");
    expect(bindRefusal("zh-Hans", "family", "bind_removed", undefined, MUM)).toBe("她已经解除了和你的绑定。想再绑定，请她在自己的手机上填你的账号。");
    // her chip 「用他的名字」 sends no word: the plain sentence
    expect(bindRefusal("zh-Hans", "family", "bind_removed")).toBe("他已经解除了和你的绑定。想再绑定，请他在自己的手机上填你的账号。");
  });

  it("the components' own words (familyCopy): every one, in both languages", () => {
    for (const locale of LOCALES) {
      // her word as the link carries it (妈妈, in either language), and the English chip's word on an English page
      for (const word of new Set([MUM, mum(locale)])) {
        const copy = familyCopy(locale, word);
        const all = Object.values(copy).flatMap((v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v : Object.values(v as Record<string, string>)));
        for (const words of all) expect(sayingHim(String(words), locale), `${locale} ${word}: ${words}`).toEqual([]);
      }
      const named = familyCopy(locale, locale === "en" ? "Ah Ma" : "阿嬷");
      for (const words of Object.values(named).flat()) if (typeof words === "string") expect(sayingAny(words, locale), `${locale}: ${words}`).toEqual([]);
    }
    expect(familyCopy("zh-Hans", MUM).inviteTitle).toBe("{name}邀请你看她的 Ripple");
    expect(familyCopy("zh-Hans", MUM).recTips[0]).toBe("叫她平时的称呼，像平常说话一样。");
    expect(familyCopy("en", "Mum").recTitle).toBe("Record a sentence. Mum hears it every day at {time}.");
    expect(familyCopy("en", MUM).inviteWaitTitle).toBe("妈妈 has been told. She confirms it's you on her phone.");
    // 爸爸, as it was
    expect(familyCopy("zh-Hans", "爸爸").sharedLead).toBe("这些由爸爸决定，他随时能改。");
    expect(familyCopy("en", null).call).toBe("Call Dad");
  });

  it("her home's sentences (lib/care/copy.ts): every state of today, the shared headline, the timeline, the names of his switches", () => {
    const STATES: HomeState[] = ["before", "reminding", "taken", "missed", "mixed", "no_reply", "not_logged", "untracked", "answered", "no_meds"];
    const KINDS: TimelineLine["kind"][] = ["reminded", "reminded_again", "taken", "missed", "later", "no_reply", "told_you", "late_taken", "late_missed", "answered"];
    for (const locale of LOCALES) {
      const dad = mum(locale);
      for (const state of STATES) {
        const h = { state, dad, slot: "morning" as const, at: "08:52", first: "08:45" };
        expect(sayingHim(headline(h, locale), locale), `${locale} ${state}`).toEqual([]);
        for (const yourVoice of [true, false]) expect(sayingHim(headlineLede({ ...h, yourVoice, reminded: true, perMed: [{ name: "Amlodipine", mark: "taken" }] }, locale) ?? "", locale), `${locale} ${state}`).toEqual([]);
      }
      for (const input of [
        { bp: 3, questions: null, visits: false, notes: false, noReplyOn: false },
        { bp: null, questions: 2, visits: false, notes: false, noReplyOn: false },
        { bp: null, questions: null, visits: true, notes: false, noReplyOn: false },
        { bp: null, questions: null, visits: false, notes: false, noReplyOn: true },
        { bp: null, questions: null, visits: false, notes: false, noReplyOn: false },
      ])
        expect(sayingHim(sharedHeadline({ dad, ...input }, locale), locale)).toEqual([]);
      for (const kind of KINDS) for (const yourVoice of [true, false]) expect(sayingHim(timelineWords({ at: SGT("08:45"), kind, meds: ["Amlodipine"] }, locale, { yourVoice, dad }), locale), `${locale} ${kind}`).toEqual([]);
      for (const k of KEYS) expect(sayingHim(grantName(k, locale, dad), locale), `${locale} ${k}`).toEqual([]);
      expect(sayingHim(privacyLine(dad, NO_GRANTS, locale), locale)).toEqual([]);
    }
    expect(headline({ state: "taken", dad: "Mum", slot: "morning", at: "08:52", first: "08:45" }, "en")).toBe("Mum took her morning medicine at 8:52.");
    expect(headlineLede({ state: "taken", dad: "Mum", slot: "morning", at: "08:52", first: "08:45", yourVoice: false, reminded: false, perMed: [] }, "en")).toBe("She tapped it herself.");
    expect(headlineLede({ state: "missed", dad: "Ah Ma", slot: "morning", at: "08:52", first: "08:45", yourVoice: false, reminded: false, perMed: [] }, "en")).toBe("Ah Ma logged it as not taken themselves.");
    expect(sharedHeadline({ dad: MUM, bp: null, questions: null, visits: true, notes: false, noReplyOn: false }, "zh-Hans")).toBe("妈妈分享了她的记录。");
    expect(grantName("notes", "zh-Hans", MUM)).toBe("她本人写的笔记");
    expect(privacyLine(MUM, NO_GRANTS, "zh-Hans")).toBe("这些是妈妈同意给你看的。她的笔记和就诊录音没有分享。");
    expect(privacyLine("Mum", NO_GRANTS, "en")).toBe("This is what Mum agreed to show you. Her notes and her visit recordings are not shared.");
    // with 爸爸, as it was
    expect(headline({ state: "taken", dad: "Dad", slot: "morning", at: "08:52", first: "08:45" }, "en")).toBe("Dad took his morning medicine at 8:52.");
    expect(timelineWords({ at: SGT("08:45"), kind: "answered", meds: [] }, "en", { yourVoice: false })).toBe("He answered the reminder");
    expect(grantName("notes", "zh-Hans")).toBe("他本人写的笔记");
  });

  it("the long press's family words (lib/explain/copy.ts): in English, her he / his by her word", () => {
    const lines = (dad: string): string[] => {
      const w = factWords("en", { kind: "family", dad });
      return [
        w.who("doctor"),
        w.doctorTarget(135, 85, "2026-10-01"),
        w.noTarget,
        w.doctorWarning(180, "2026-10-01"),
        w.notBelow(0),
        w.notBelow(2),
        w.vBpNotBelow(147, 93, 135, 85),
        w.vBpBelow(120, 80, 135, 85),
        w.vBpNoTarget(147, 93),
        w.vBpAboveWarning(185, 180),
        w.vWeekTarget(true, 5, 140, 88, 2, 135, 85),
        w.vWeekNoTarget(true, 5, 140, 88),
        w.labelTyped,
        w.medSlots(["morning"], false),
        w.nobodySpoke,
        w.vMedSlots("Amlodipine", ["morning"], false),
        w.vMedThin("Amlodipine"),
        w.visitAnswered(1),
        w.vVisitEmpty("2026-10-01"),
        w.lineIsTarget(135, 85),
        w.lineIsWarning(180),
        w.lineConfirmed,
        w.lineUnconfirmed,
        w.lineDisputed,
        w.vLineConfirmed("doctor", "2026-10-01"),
        w.vLineUnconfirmed("2026-10-01"),
        w.questionAdded("2026-10-01", "doctor"),
        w.questionAdded(null, "doctor"),
        w.questionPattern,
        w.questionSkipped,
        w.vQuestionOpen("doctor", "2026-10-20"),
        w.vQuestionOpen("doctor", null),
        w.vQuestionSkipped,
        w.questionsWaiting(2),
        w.questionsWaiting(0),
        w.vNext("2026-10-20", 6, false, 2),
        w.vNextNone,
        w.vVisitPlanned("2026-10-20", 6, false, 1),
      ];
    };
    for (const line of lines("Mum")) expect(sayingHim(line, "en"), line).toEqual([]);
    for (const line of lines("Ah Ma")) expect(sayingAny(line, "en"), line).toEqual([]);
    expect(lines("Mum")).toContain("Mum typed the label in herself; it has not been checked.");
    expect(lines("Mum")).toContain("Her next clinic visit is 20 Oct, 6 days away. 2 questions wait on her list.");
    expect(lines("Dad")).toContain("His next clinic visit is 20 Oct, 6 days away. 2 questions wait on his list.");
    for (const [k, v] of Object.entries(holdWords("en", { kind: "family", dad: "Mum" }))) expect(sayingHim(String(v), "en"), k).toEqual([]);
    for (const [k, v] of Object.entries(holdWords("zh-Hans", { kind: "family", dad: MUM }))) expect(sayingHim(String(v), "zh-Hans"), k).toEqual([]);
  });
});

describe("her screens, drawn with the label 妈妈", () => {
  const store = new MemoryStore();
  let him: TestAccount;
  let her: TestAccount;
  let link: CareLinkRow;
  let now = 0;
  const setClock = (hhmm: string) => {
    setTestClock({ at: SGT(hhmm), frozen: true });
    now = Date.parse(SGT(hhmm));
    return now;
  };
  const scope = async (): Promise<SessionRow> => {
    const s = await store.getSession(him.userId);
    if (!s) throw new Error("no scope");
    return s;
  };
  const home = async (grants: FamilyGrantItems = ALL): Promise<FamilyHomeData> => familyHome(store, await scope(), { link, grants, version: 2, acknowledged: true }, now);
  const paths = () => herPaths(link.id);

  beforeAll(async () => {
    setClock("07:30");
    const auth = getAuthProvider();
    him = await createAccountWithSpace(store, auth, { login: `h${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
    her = await createAccountWithSpace(store, auth, { login: `w${randomUUID().slice(0, 10)}`, password: "a long test password", space: "none" });
    const inv = await store.createInvite({ patient_id: him.userId, patient_label: MUM, invite_token_hash: randomUUID(), invite_expires_at: "2099-01-01T00:00:00.000Z" }, ALL);
    if (!inv.ok) throw new Error(inv.code);
    const acc = await store.acceptInvite(inv.link.invite_token_hash!, her.userId, "Wei Ling");
    if (!acc.ok) throw new Error(acc.code);
    const ok = await store.confirmLink(inv.link.id, him.userId, true);
    if (!ok.ok) throw new Error(ok.code);
    link = ok.link;
    // 08:50: 「没吃」 this morning, with his own words
    setClock("08:50");
    await answerDose(store, await scope(), { medication_id: "med-amlodipine", slot: "morning", state: "missed", reason: "own_words", reason_text: "去公园了，药没带在身上" }, now);
    setClock("09:00");
  });

  afterAll(() => setTestClock(null));

  it("her home (FamilyApp): with everything shared, and with nothing shared", async () => {
    for (const locale of LOCALES) {
      for (const grants of [ALL, NO_GRANTS]) {
        const h = await home(grants);
        expect(h.patientLabel).toBe(MUM);
        const text = draw(createElement(FamilyApp, { locale, linkId: link.id, since: 0, tz: TZ, initial: h, langHref: "/x" }));
        expect(text).toContain(MUM);
        expect(sayingHim(text, locale), `${locale} ${grants === ALL ? "all" : "none"}`).toEqual([]);
      }
    }
    const missed = draw(createElement(FamilyApp, { locale: "zh-Hans", linkId: link.id, since: 0, tz: TZ, initial: await home(ALL), langHref: "/x" }));
    expect(missed).toContain("妈妈记录：今天早间未服药。");
    expect(missed).toContain("妈妈今天");
    expect(missed).toContain("打电话给妈妈");
    const none = draw(createElement(FamilyApp, { locale: "zh-Hans", linkId: link.id, since: 0, tz: TZ, initial: await home(NO_GRANTS), langHref: "/x" }));
    expect(none).toContain("等她打开以后，这里会显示。");
    expect(none).toContain("这些开关只有妈妈能在她的手机上改。");
    expect(none).toContain("她本人写的笔记");
    const all = draw(createElement(FamilyApp, { locale: "en", linkId: link.id, since: 0, tz: TZ, initial: await home(ALL), langHref: "/x" }));
    // her word as she gave it, in English too (the name word is as it was); the pronoun follows it
    expect(all).toContain("妈妈 today");
    expect(all).toContain("Call 妈妈");
    expect(all).toContain("妈妈 says she didn't take it this morning.");
    expect(all).toContain("She logged it as not taken herself.");
    // her home while it loads (I1), and its words when it cannot be read
    for (const locale of LOCALES) {
      const dad = mum(locale);
      const loading = draw(createElement(FamilyHomeSkeleton, { locale, dad, title: hc(locale, "dadToday", { dad }), loadingText: hc(locale, "loading", { dad }), privacy: privacyLine(dad, null, locale) }));
      expect(sayingHim(loading, locale)).toEqual([]);
      expect(sayingHim(draw(createElement(FamilyError, { locale, dad })), locale)).toEqual([]);
    }
  });

  it("留意 (AlertScreen, RecordFeed, the no-reply block)", async () => {
    for (const locale of LOCALES) {
      const h = await home(ALL);
      const record = await herRecord(store, await scope(), { link, userId: her.userId, grants: ALL, version: 2, locale, acknowledged: true }, now);
      const screen = draw(createElement(AlertScreen, { locale, linkId: link.id, since: 0, tz: TZ, initial: h, record, langHref: "/x", dad: MUM }));
      expect(screen).toContain(locale === "en" ? "Needs attention" : "需要留意");
      expect(screen).toContain(locale === "en" ? "妈妈 said: “" : "妈妈说：「");
      expect(sayingHim(screen, locale), locale).toEqual([]);
      // the follow-ups that name him: his list not shared, his set-aside, a link he has not answered yet
      const rows = shownEntries(record.entries, ALL).map((e) => (e.ask ? { ...e, ask: { ...e.ask, aside: true } } : e));
      for (const grants of [ALL, { ...ALL, questions_count: false }]) {
        for (const acknowledged of [true, false]) {
          const feed = draw(createElement(RecordFeed, { entries: rows, today: record.today, locale, tz: TZ, dad: mum(locale), linkId: link.id, grants, acknowledged, calendarHref: "/f/month", shared: true }));
          expect(sayingHim(feed, locale), `${locale} ${grants.questions_count} ${acknowledged}`).toEqual([]);
        }
      }
      expect(sayingHim(draw(createElement(RecordFeed, { entries: [], today: record.today, locale, tz: TZ, dad: mum(locale), linkId: link.id, grants: ALL, acknowledged: true, calendarHref: "/f/month", shared: false })), locale)).toEqual([]);
      // the open block: the morning's timeline, his last entry, the call button, what Ripple will not do
      const lines: TimelineLine[] = [
        { at: "2026-10-13T00:45:00.000Z", kind: "reminded", meds: [], unanswered: true },
        { at: "2026-10-13T01:15:00.000Z", kind: "reminded_again", meds: [], unanswered: true },
        { at: "2026-10-13T01:45:00.000Z", kind: "told_you", meds: [] },
      ];
      const head = homeHeadline({ ...h, status: h.status ? { ...h.status, state: "no_reply" } : h.status }, mum(locale), locale, TZ);
      const block = draw(
        createElement(NoReplyAlert, {
          locale,
          dad: mum(locale),
          title: head.title,
          timeline: timelineItems(lines, { tz: TZ, locale, yourVoice: false, herWords: null, nextAt: "09:15", dad: mum(locale) }),
          lastEntry: { when: "08:20", what: "x" },
        }),
      );
      expect(sayingHim(block, locale), locale).toEqual([]);
    }
    const record = await herRecord(store, await scope(), { link, userId: her.userId, grants: ALL, version: 2, locale: "zh-Hans", acknowledged: true }, now);
    const said = draw(createElement(RecordFeed, { entries: shownEntries(record.entries, ALL), today: record.today, locale: "zh-Hans", tz: TZ, dad: MUM, linkId: link.id, grants: ALL, acknowledged: false, calendarHref: "/f/month", shared: true }));
    expect(said).toContain("妈妈说：「");
    expect(said).toContain("等妈妈在自己的手机上点了「知道了」，才能加入问题单。");
    // an English page with her English chip's word
    const en = await herRecord(store, await scope(), { link, userId: her.userId, grants: ALL, version: 2, locale: "en", acknowledged: false }, now);
    expect(draw(createElement(RecordFeed, { entries: shownEntries(en.entries, ALL), today: en.today, locale: "en", tz: TZ, dad: "Mum", linkId: link.id, grants: ALL, acknowledged: false, calendarHref: "/f/month", shared: true }))).toContain(
      "Once Mum taps “Got it” on her own phone, this can go on the question list.",
    );
  });

  it("the shared list, the calendar's words and 我的's pieces", async () => {
    for (const locale of LOCALES) {
      const dad = mum(locale);
      for (const grants of [ALL, NO_GRANTS]) {
        const items = sharedItems(grants, locale, paths(), dad);
        const list = draw(createElement(SharedSection, { items, locale, dad, heading: hc(locale, "sharedTitle", { dad }), lead: null, note: hc(locale, "onlyDadChanges", { dad }) }));
        expect(sayingHim(list, locale), locale).toEqual([]);
        // the section's own defaults, too
        expect(sayingHim(draw(createElement(SharedSection, { items, locale, dad })), locale), locale).toEqual([]);
      }
      expect(sayingHim(draw(createElement(NotShared, { locale, dad, what: "notes", homeHref: "/f" })), locale)).toEqual([]);
      // the calendar: the day with nothing of his, a visit's confirmed lines, the foot line, the place's name
      expect(sayingHim([mc(locale, "dayEmpty", { dad }), linesWords(1, dad, locale), privacyLine(dad, { ...ALL, notes: false }, locale), familyCopy(locale, dad).tabs.week].join("\n"), locale)).toEqual([]);
      // 我的: its sentence, its rows, the screen that says what leaving does, the phone and the notifications screens
      for (const key of ["meTitle", "sharedTitle", "meFacts", "meOnlyYours", "endedTitle", "leftTitle", "declinedTitle", "leaveTitle", "leaveItem1", "leaveItem2", "leaveItem3", "leaveItem4"] as const) {
        expect(sayingHim(hc(locale, key, { dad }), locale), `${locale} ${key}`).toEqual([]);
      }
      for (const el of [
        createElement(PhoneRow, { linkId: link.id, locale, dad, href: "/f/phone" }),
        createElement(PhonePage, { linkId: link.id, locale, dad, back: "/f/me" }),
        createElement(NotificationsPage, { locale, dad, installHref: "/f/me/install" }),
        createElement(LeaveButton, { linkId: link.id, locale, dad }),
      ])
        expect(sayingHim(draw(el), locale), locale).toEqual([]);
    }
    expect(sharedItems(NO_GRANTS, "zh-Hans", paths(), MUM).find((i) => i.grant === "notes")).toMatchObject({ title: "她本人写的笔记", detail: "她的笔记原文" });
    expect(hc("zh-Hans", "leaveItem2", { dad: MUM })).toBe("你录过的提醒还留在她的 Ripple 里，照旧放给她听。");
  });

  it("her reminder page (ReminderStudio, the recorder's every sentence)", async () => {
    for (const locale of LOCALES) {
      const dad = mum(locale);
      const initial = await herReminders(store, await scope(), link.id, her.userId, "08:45");
      const studio = draw(createElement(ReminderStudio, { locale, linkId: link.id, playsAt: "08:45", tz: TZ, initial, homeHref: "/f", mineHref: "/f/reminder/mine", herLabel: "Wei Ling", dad: MUM, langHref: "/x" }));
      expect(studio).toContain(locale === "en" ? "Record a sentence. 妈妈 hears it every day at 8:45." : "放给妈妈听。");
      expect(sayingHim(studio, locale), locale).toEqual([]);
      for (const state of ["idle", "deleted", "saved", "recorded", "mic-ask", "mic-denied"] as const) {
        const rec = draw(createElement(ReminderRecorder, { state, locale, dad, playsAt: "8:45", saved: { words: null }, current: { words: null, ownVoice: false }, homeHref: "/f" }));
        expect(sayingHim(rec, locale), `${locale} ${state}`).toEqual([]);
      }
    }
    const idle = draw(createElement(ReminderRecorder, { state: "idle", locale: "zh-Hans", dad: MUM, playsAt: "8:45" }));
    expect(idle).toContain("录一句话，每天 8:45 放给妈妈听。");
    expect(idle).toContain("叫她平时的称呼");
  });

  it("the bind result: the refusal, the place of her recorder while she waits for him, the waiting screen", () => {
    for (const locale of LOCALES) {
      const dad = mum(locale);
      expect(sayingHim(bindRefusal(locale, "family", "bind_removed", undefined, dad), locale)).toEqual([]);
      expect(sayingHim(draw(createElement(ReminderLocked, { locale, dad, homeHref: "/f" })), locale), locale).toEqual([]);
      expect(sayingHim(bc(locale, "lockedFact", { dad }), locale)).toEqual([]);
      const waiting = draw(createElement(WaitingForDad, { locale, linkId: link.id, dad, langHref: "/x" }));
      expect(sayingHim(waiting, locale), locale).toEqual([]);
    }
    const waiting = draw(createElement(WaitingForDad, { locale: "zh-Hans", linkId: link.id, dad: MUM, langHref: "/x" }));
    expect(waiting).toContain("已经告诉妈妈了，等她在手机上确认是你。");
    expect(waiting).toContain("她的手机上会出现你的名字和账号。她点「是她」以前，你什么都看不到。");
    expect(draw(createElement(ReminderLocked, { locale: "zh-Hans", dad: MUM, homeHref: "/f" }))).toContain("等她在自己的手机上点了「知道了」，你就可以给她录提醒。");
  });

  it("the invitation she opens, and the screen of his password reset", () => {
    for (const locale of LOCALES) {
      const dad = mum(locale);
      const shares = KEYS.map((k) => ({ title: grantName(k, locale, dad), detail: hc(locale, `see_${k}`, { dad }), shared: false, grant: k }));
      for (const state of ["invite", "waiting", "done", "used", "error"] as const) {
        const screen = draw(createElement(InviteAccept, { state, locale, inviter: dad, shares, notSeen: hc(locale, "notSeen", { dad }), homeHref: "/f", loginHref: "/login" }));
        expect(sayingHim(screen, locale), `${locale} ${state}`).toEqual([]);
      }
      for (const code of ["invite_expired", "invite_used", "invite_not_found", "link_exists", undefined]) expect(sayingHim(acceptError(code, locale, dad), locale), `${locale} ${code}`).toEqual([]);
      expect(sayingHim(draw(createElement(ResetHelpScreen, { locale, linkId: link.id, dad, tz: TZ, onDone: () => {} })), locale), locale).toEqual([]);
    }
    expect(draw(createElement(InviteAccept, { state: "invite", locale: "zh-Hans", inviter: MUM, shares: [] }))).toContain("妈妈邀请你看她的 Ripple");
    expect(acceptError("link_exists", "en", "Mum")).toBe("You already follow her Ripple.");
    expect(draw(createElement(ResetHelpScreen, { locale: "zh-Hans", linkId: link.id, dad: MUM, tz: TZ, onDone: () => {} }))).toContain("妈妈在重设密码，要帮她吗？");
  });
});
