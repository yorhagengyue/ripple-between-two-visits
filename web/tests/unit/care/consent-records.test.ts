/**
 * The family links' consent records and texts (C2 track D, round two; real-app 3.11 「每条带 kind、decision、version、
 * text_sha256、method、evidence、assisted」, 「改文字就加新版本」, 「家人代操作时……assisted = true」; section 10 「提醒时间不受
 * 六个开关管……写进隐私说明」):
 *   - both family texts have a new version that says what the six switches do not govern (his morning reminder time,
 *     which recording plays) and that she can add a line he must confirm; the first version stays published, word for
 *     word, so a record made under it still finds its words
 *   - line bind, round two: a third version (2026-10-11) whose first paragraph says both ways a link is made (an
 *     invitation: every item off at the start; an account entered: four on); the second stays published too
 *   - the owner's decision of 2026-10-14 (each switch shows its kind in full while it is on): a fourth version, which
 *     names the four items a bound link starts with as the kinds themselves and no longer lists readings and the
 *     questions' words among what stays hidden from her; the third stays published too
 *   - every record the links write goes through track H's writer: the version and hash in force, its text row in
 *     consent_text, the language, and assisted with its note when someone is helping him on his device (what the
 *     request says, else what his sign-up recorded); her own records are never assisted
 *   - the switches change only on an active link: nothing says "granted" for someone he has not confirmed
 *   - leaving is her own action: no ?link=, her own link only, a link that waits for him can be left too
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST as acceptPost } from "@/app/api/family/invites/accept/route";
import { POST as invitePost } from "@/app/api/family/invites/route";
import { POST as confirmPost } from "@/app/api/family/links/[id]/confirm/route";
import { POST as grantsPost } from "@/app/api/family/links/[id]/grants/route";
import { POST as leavePost } from "@/app/api/family/links/[id]/leave/route";
import { POST as revokePost } from "@/app/api/family/links/[id]/revoke/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { FAMILY_CONSENT_TEXTS, FAMILY_CONSENT_VERSION, familyConsentText, familyConsentTextOf } from "@/lib/care/consent";
import { helpedName } from "@/lib/care/links";
import { ASSISTED_NOTE, consentStamp, currentConsent, publishConsentTexts, unpublishedConsents } from "@/lib/privacy/consents";
import { getMemoryStore, MemoryStore } from "@/lib/store/memory";
import type { ConsentRecordRow } from "@/lib/store/types";

const store = getMemoryStore();
const PASSWORD = "a long test password";
const login = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const account = (space: "example" | "blank" | "none", display = "Wei Ling"): Promise<TestAccount> =>
  createAccountWithSpace(store, getAuthProvider(), { login: login(space === "none" ? "w" : "t"), password: PASSWORD, space, display_name: display });
const t = (a: TestAccount) => a.tokens.access_token;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function req(p: string, opts: { token?: string; body?: unknown; lang?: "en" | "zh-Hans" } = {}): NextRequest {
  const cookies = [opts.token ? `rp_at=${opts.token}` : "", opts.lang ? `rp_lang=${opts.lang}` : ""].filter(Boolean).join("; ");
  const headers: Record<string, string> = cookies ? { cookie: cookies } : {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, { method: "POST", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}

async function invited(him: TestAccount): Promise<{ id: string; token: string }> {
  const res = await invitePost(req("/api/family/invites", { token: t(him), body: { family_label: "Wei Ling", relation: "daughter", patient_label: "爸爸" } }));
  expect(res.status).toBe(201);
  const body = (await res.json()) as { link: { id: string }; path: string };
  return { id: body.link.id, token: body.path.replace(/^\/invite\//, "") };
}

const shareRecords = async (him: TestAccount, linkId: string): Promise<ConsentRecordRow[]> =>
  (await store.listConsentRecords(him.userId, { kind: "family_share" })).filter((c) => (c.evidence as { link_id?: string } | null)?.link_id === linkId);

/** The first version's hashes, as recorded before the second version existed: these words never change. */
const FIRST_VERSION: Record<string, string> = {
  "family_accept|zh-Hans": "629561abcbfdaea6fc011f4d8d08a82d83fa78ba2bffdf0336636c25f2420038",
  "family_accept|en": "92ab3f4a7e47b5d1c6e4d8459e6a02ad4046e069b57f70089fa9e2eca6c7868f",
  "family_share|zh-Hans": "fd2aa1e589221dcd419062c5aa1959686c65f85d13121db3759cbf5cf6975da4",
  "family_share|en": "1a673b8a5cb2d1cba333a893b734a6fcfb3fb0f56600ab4f2c17c84b918fd125",
};

/** The second version's hashes, as recorded before the third version existed (line bind, round two). */
const SECOND_VERSION: Record<string, string> = {
  "family_accept|zh-Hans": "d37b5aee6795c338b8f0eb189276f5f8716f47da29b54935cfaac441164a48e1",
  "family_accept|en": "f5b30404a2898f7c88feaedfb39262f78aae8bcd209bd873e903409cc37b3714",
  "family_share|zh-Hans": "59090a5c76a1f6530c391ace56ee0c76d0ca6f1ffa70e036d74e5c8c7f49ab91",
  "family_share|en": "ac4d8de090a20bbe61913df9f57e402f3a626b7d27a843917c24a255597ff756",
};

/** The third version's hashes, as recorded before the fourth version existed (the owner's decision of 2026-10-14). */
const THIRD_VERSION: Record<string, string> = {
  "family_accept|zh-Hans": "3f12462a48592cd1e4ea3cea973d3cbae3ff4a1dec4233688268504bbf3381be",
  "family_accept|en": "a8e574d51a8279f69a11a7cf52cacf2e5dd6f8ae5cc3a212d1f0a6da78e5638a",
  "family_share|zh-Hans": "a7d6e1304f1c60455cabd028497708a9f87f5634b79529185c26b82b55f82443",
  "family_share|en": "3412e7e191bd0ae9b9cba555a3736bfedf787900eacbc564e5adee238a28a8bb",
};

describe("the family consent texts", () => {
  it("the version in force says what the six switches do not govern, in both languages, for him and for her", () => {
    expect(FAMILY_CONSENT_VERSION).toBe("2026-10-14");
    for (const kind of ["family_accept", "family_share"] as const) {
      const zh = familyConsentText(kind, "zh-Hans");
      const en = familyConsentText(kind, "en");
      expect(zh.version).toBe(FAMILY_CONSENT_VERSION);
      expect(en.version).toBe(FAMILY_CONSENT_VERSION);
      // the registry (track H) reads the same text as the one in force
      expect(currentConsent(kind, "zh-Hans")).toBe(zh);
      expect(consentStamp(kind, "en")).toEqual({ version: FAMILY_CONSENT_VERSION, text_sha256: en.sha256, locale: "en" });
      for (const w of ["不归这些开关管", "早上第一次提醒", "哪一段"]) expect(zh.text, `${kind} zh`).toContain(w);
      for (const w of ["not governed by those switches", "morning reminder", "which"]) expect(en.text, `${kind} en`).toContain(w);
      // she can add a line to his details; it counts only after he confirms it
      expect(zh.text).toContain("补充一条");
      expect(zh.text).toMatch(/确认(以后)?才算数/);
      expect(en.text).toMatch(/add a line to (his|your) details/);
      // the first version's promise 「别的都看不到」 is not repeated as it stood
      expect(zh.text).not.toContain("只看得到");
      expect(en.text).not.toMatch(/sees? only/);
      // never clinical, never a person's name
      expect(`${zh.text}${en.text}`).not.toMatch(/Wei Ling|陈先生|Mr Tan|\bmg\b|mmHg/);
    }
  });

  it("the first version stays published word for word: a record made under it still finds its words", async () => {
    for (const [key, sha] of Object.entries(FIRST_VERSION)) {
      const [kind, locale] = key.split("|") as ["family_accept" | "family_share", "zh-Hans" | "en"];
      const old = familyConsentTextOf(kind, "2026-10-10", locale);
      expect(old?.sha256, key).toBe(sha);
      expect(old!.text).toMatch(locale === "en" ? /only/ : /只看得到/);
    }
    expect(FAMILY_CONSENT_TEXTS.map((x) => x.version)).toEqual([...Array(4).fill("2026-10-10"), ...Array(4).fill("2026-10-10.2"), ...Array(4).fill("2026-10-11"), ...Array(4).fill("2026-10-14")]);
    // both versions go to consent_text, so old rows and new rows are both valid
    const fresh = new MemoryStore();
    const uid = randomUUID();
    await fresh.createAccount({ user_id: uid, login_kind: "username", username: `c${uid.slice(0, 8)}` });
    const oldRow = await fresh.addConsentRecord({ user_id: uid, kind: "family_share", decision: "granted", version: "2026-10-10", text_sha256: FIRST_VERSION["family_share|zh-Hans"], method: "family_confirm" });
    const newRow = await fresh.addConsentRecord({ user_id: uid, kind: "family_share", decision: "granted", ...{ version: FAMILY_CONSENT_VERSION, text_sha256: familyConsentText("family_share", "zh-Hans").sha256 }, method: "family_confirm" });
    await publishConsentTexts(fresh);
    expect(await unpublishedConsents(fresh, [oldRow, newRow])).toEqual([]);
    expect((await fresh.getConsentText("family_share", "2026-10-10", "zh-Hans"))?.text).toContain("只看得到");
    expect((await fresh.getConsentText("family_share", FAMILY_CONSENT_VERSION, "zh-Hans"))?.text).toContain("不归这些开关管");
  });

  // Line bind, round two (2026-10-11): a link can be made by entering an account and then starts with four items on, so
  // the first paragraph of each text (「每一项一开始都是关着的」, 「确认以后……你没打开的，对方看不到」) was no longer true for
  // every link. A third version; the second stays published word for word.
  it("2026-10-11 differs from 2026-10-10.2 in the first paragraph only, which says both ways a link is made", () => {
    for (const [key, sha] of Object.entries(SECOND_VERSION)) {
      const [kind, locale] = key.split("|") as ["family_accept" | "family_share", "zh-Hans" | "en"];
      const old = familyConsentTextOf(kind, "2026-10-10.2", locale)!;
      const now = familyConsentTextOf(kind, "2026-10-11", locale)!;
      expect(old.sha256, `${key}: the second version's hash is ${old.sha256}`).toBe(sha);
      expect(now.title, key).toBe(old.title);
      expect(now.paragraphs.length, key).toBe(old.paragraphs.length);
      expect(now.paragraphs.flatMap((p, i) => (p === old.paragraphs[i] ? [] : [i])), key).toEqual([0]);
      // (it was the one in force until 2026-10-14; it stays published: the next test)
      expect(familyConsentText(kind, locale), key).not.toBe(now);
    }
    const first = (kind: "family_accept" | "family_share", locale: "zh-Hans" | "en") => familyConsentTextOf(kind, "2026-10-11", locale)!.paragraphs[0]!;
    // an invitation: every item off at the start; an account entered: four on; she entered his herself: those four and
    // nothing she does reaches him until he has answered
    for (const w of ["他发邀请请你来的，每一项一开始都是关着的", "填账号绑定的，一开始开着四项", "这周吃药的天数、量了几次血压、有几个问题要问医生，提醒两次没回的时候会通知你", "点了「知道了」或者改了你的开关", "还不能给他录提醒，也不能给他的资料补充"]) {
      expect(first("family_accept", "zh-Hans"), w).toContain(w);
    }
    for (const w of ["你发邀请请来的，要你确认是对方以后才看得到，每一项一开始都是关着的", "填账号绑定的，一开始开着四项", "看诊录音和你的笔记要你自己打开", "点了「知道了」或者改了对方的开关", "还不能给你录提醒，也不能给你的资料补充"]) {
      expect(first("family_share", "zh-Hans"), w).toContain(w);
    }
    for (const w of ["If he invited you, every item starts switched off", "four items start switched on", "two reminders go unanswered", "tap “Got it” on his own phone or change one of your switches", "cannot yet record a reminder for him or add to his details"]) {
      expect(first("family_accept", "en"), w).toContain(w);
    }
    for (const w of ["Someone you invited sees them after you confirm it is them", "starts with four items on", "stay closed until you open them", "tap “Got it” or change one of their switches", "cannot yet record a reminder for you or add to your details"]) {
      expect(first("family_share", "en"), w).toContain(w);
    }
    // the sentences that were no longer true for every link are gone
    expect(first("family_accept", "zh-Hans")).not.toContain("接受以后");
    expect(first("family_share", "zh-Hans")).not.toContain("你没打开的，对方看不到");
    expect(first("family_accept", "en")).not.toContain("Once you accept");
    expect(first("family_share", "en")).not.toContain("Once you confirm");
  });

  // The owner's decision of 2026-10-14: the same six switches, and each one shows its kind in full while it is on
  // (lib/care/home.ts). The texts had said counts (「这周吃药的天数、量了几次血压、有几个问题要问医生」), and hers had listed his
  // readings and what his questions say among what stays hidden. A fourth version; the third stays published word for word.
  it("2026-10-14 differs from 2026-10-11 only where the items are named: the kinds themselves, in full; her hidden list is his notes and recordings", () => {
    const sentences = (p: string) => p.split(/(?<=[。.])\s*/);
    for (const [key, sha] of Object.entries(THIRD_VERSION)) {
      const [kind, locale] = key.split("|") as ["family_accept" | "family_share", "zh-Hans" | "en"];
      const old = familyConsentTextOf(kind, "2026-10-11", locale)!;
      const now = familyConsentTextOf(kind, "2026-10-14", locale)!;
      expect(old.sha256, `${key}: the third version's hash is ${old.sha256}`).toBe(sha);
      expect(now.title, key).toBe(old.title);
      expect(now.paragraphs.length, key).toBe(old.paragraphs.length);
      // his text: the first paragraph, and the one that says what she may add (later the same day: she can put a
      // suggested question on his list, and hold a record for Ripple's explanation); hers: the first, the one that
      // said what stays hidden, and the one that says what she may and may not do
      expect(now.paragraphs.flatMap((p, i) => (p === old.paragraphs[i] ? [] : [i])), key).toEqual(kind === "family_share" ? [0, 2] : [0, 2, 3]);
      // and in the first paragraph one sentence only: the one that names the four items
      const [a, b] = [sentences(old.paragraphs[0]!), sentences(now.paragraphs[0]!)];
      expect(b.length, key).toBe(a.length);
      const changed = b.flatMap((s, i) => (s === a[i] ? [] : [s]));
      expect(changed, key).toHaveLength(1);
      // both texts name the items in the words of the screens (the owner, 10-14: no colloquial words, the family side
      // first, then his)
      expect(changed[0], key).toMatch(locale === "en" ? /four are on at first: (his|your) medicine each day/ : /一开始开着四项：每日服药情况/);
      expect(familyConsentText(kind, locale), key).toBe(now);
    }
    const para = (kind: "family_accept" | "family_share", locale: "zh-Hans" | "en", i: number) => familyConsentTextOf(kind, "2026-10-14", locale)!.paragraphs[i]!;
    // the owner's sentences, word for word
    expect(para("family_share", "zh-Hans", 0)).toContain("一开始开着四项：每日服药情况（药物名称、服药时间、未服药的原因）、血压读数、待问医生的问题，两次提醒均未回应时会通知对方；就诊录音和你的笔记要你自己打开。");
    expect(para("family_share", "en", 0)).toContain(
      "four are on at first: your medicine each day (which medicine, when, and the reason when you did not take it), your blood pressure readings, the questions you want to ask your doctor, and a notice to the other person when two reminders go unanswered; visit recordings and your notes stay off until you turn them on.",
    );
    expect(para("family_accept", "zh-Hans", 0)).toContain("一开始开着四项：每日服药情况（药物名称、服药时间、未服药的原因）、血压读数、待问医生的问题，两次提醒均未回应时会通知你。");
    expect(para("family_accept", "en", 0)).toContain("four are on at first: his medicine each day (which medicine, when, and the reason when he did not take it), his blood pressure readings, the questions he wants to ask his doctor, and a notice to you when two reminders go unanswered.");
    expect(para("family_accept", "zh-Hans", 2)).toBe("他的笔记和就诊录音，他不打开，你就看不到。");
    // what she may add to his list and that Ripple explains a record she holds: said to both of them
    for (const w of ["加入他的问题单", "标明是家人加的", "问不问由他决定", "长按他分享的一条记录", "同意过 AI 处理", "不是医嘱"]) expect(para("family_accept", "zh-Hans", 3), w).toContain(w);
    for (const w of ["add a suggested question for his doctor", "marked as added by family", "only if he has agreed to AI processing", "not medical advice"]) expect(para("family_accept", "en", 3), w).toContain(w);
    for (const w of ["往你的问题单里加一个待问医生的问题", "标明是家人加的", "问不问由你决定", "同意过 AI 处理"]) expect(para("family_share", "zh-Hans", 2), w).toContain(w);
    for (const w of ["add a question for your doctor", "marked as added by family", "only if you have agreed to AI processing"]) expect(para("family_share", "en", 2), w).toContain(w);
    expect(para("family_accept", "en", 2)).toBe("His notes and his visit recordings stay hidden unless he turns them on.");
    // the counts, and the promise that readings and the questions' words stay hidden, are in no text in force
    for (const kind of ["family_accept", "family_share"] as const) {
      const zh = familyConsentText(kind, "zh-Hans").text;
      const en = familyConsentText(kind, "en").text;
      for (const w of ["这周吃药的天数", "量了几次血压", "有几个问题要问医生", "血压读数、问题的内容"]) expect(zh, `${kind}: ${w}`).not.toContain(w);
      // and no spoken word for his medicine, his visits or a reminder left unanswered (the owner, 10-14)
      for (const w of ["吃药", "没吃", "没回", "看诊"]) expect(zh, `${kind}: ${w}`).not.toContain(w);
      for (const w of ["how many days", "how many blood pressure readings", "how many questions", "what his questions say"]) expect(en, `${kind}: ${w}`).not.toContain(w);
      // what he keeps closed until he opens it is still said, and both ways a link is made, and his 「知道了」
      for (const w of ["就诊录音", "笔记", "每一项一开始都是关着的", "「知道了」"]) expect(zh, `${kind}: ${w}`).toContain(w);
      for (const w of ["visit recordings", "notes", "every item starts switched off", "“Got it”"]) expect(en, `${kind}: ${w}`).toContain(w);
    }
  });
});

describe("the links' consent records go through the one writer", () => {
  it("accept, confirm, switches, stop: each stamped with the text in force, its text row there, the language kept", async () => {
    const him = await account("example", "陈先生");
    const her = await account("none");
    const inv = await invited(him);
    expect((await acceptPost(req("/api/family/invites/accept", { token: t(her), body: { token: inv.token }, lang: "en" }))).status).toBe(200);
    const hers = (await store.listConsentRecords(her.userId, { kind: "family_accept" })).at(-1)!;
    expect(hers).toMatchObject({ decision: "granted", method: "invite_screen", scope_id: null, assisted: false, version: FAMILY_CONSENT_VERSION, text_sha256: familyConsentText("family_accept", "en").sha256 });
    expect(hers.evidence).toEqual({ link_id: inv.id, locale: "en" });

    expect((await confirmPost(req(`/api/family/links/${inv.id}/confirm`, { token: t(him), body: { yes: true } }), params(inv.id))).status).toBe(200);
    expect((await grantsPost(req(`/api/family/links/${inv.id}/grants`, { token: t(him), body: { items: { dose_summary: true } } }), params(inv.id))).status).toBe(200);
    expect((await revokePost(req(`/api/family/links/${inv.id}/revoke`, { token: t(him) }), params(inv.id))).status).toBe(200);
    const his = await shareRecords(him, inv.id);
    expect(his.map((c) => `${c.decision}:${c.method}`)).toEqual(["granted:family_confirm", "granted:family_switches", "withdrawn:family_stop"]);
    const zh = familyConsentText("family_share", "zh-Hans");
    for (const c of his) {
      expect(c).toMatchObject({ version: FAMILY_CONSENT_VERSION, text_sha256: zh.sha256, assisted: false, scope_id: him.userId });
      expect(c.evidence).toMatchObject({ link_id: inv.id, locale: "zh-Hans" });
      expect(c.evidence).not.toHaveProperty("assisted_note");
    }
    expect(his[1].evidence).toMatchObject({ version: 2, items: { dose_summary: true, notes: false } });
    // every hash has its text row, without the hourly job having run
    expect(await unpublishedConsents(store, [hers, ...his])).toEqual([]);
  });

  it("someone helping him on his device: assisted = true with the note; without a word from the request, what his sign-up recorded", async () => {
    const him = await account("example", "陈先生");
    const her = await account("none");
    const inv = await invited(him);
    await acceptPost(req("/api/family/invites/accept", { token: t(her), body: { token: inv.token } }));
    // the request says so
    expect((await confirmPost(req(`/api/family/links/${inv.id}/confirm`, { token: t(him), body: { yes: true, assisted: true } }), params(inv.id))).status).toBe(200);
    let last = (await shareRecords(him, inv.id)).at(-1)!;
    expect(last.assisted).toBe(true);
    expect(last.evidence).toMatchObject({ assisted_note: ASSISTED_NOTE, link_id: inv.id });
    // nothing said: his sign-up was not assisted
    await grantsPost(req(`/api/family/links/${inv.id}/grants`, { token: t(him), body: { items: { notes: true } } }), params(inv.id));
    last = (await shareRecords(him, inv.id)).at(-1)!;
    expect(last.assisted).toBe(false);
    // his sign-up was made with someone helping: the default follows it, and the request can still say he is alone now
    await store.addConsentRecord({ user_id: him.userId, scope_id: him.userId, kind: "terms_privacy", decision: "granted", version: "dev", method: "signup_screen", assisted: true });
    await grantsPost(req(`/api/family/links/${inv.id}/grants`, { token: t(him), body: { items: { notes: false } } }), params(inv.id));
    last = (await shareRecords(him, inv.id)).at(-1)!;
    expect(last).toMatchObject({ assisted: true, method: "family_switches" });
    expect(last.evidence).toMatchObject({ assisted_note: "在他的设备上，有人协助" });
    await grantsPost(req(`/api/family/links/${inv.id}/grants`, { token: t(him), body: { items: { notes: true }, assisted: false } }), params(inv.id));
    expect((await shareRecords(him, inv.id)).at(-1)!.assisted).toBe(false);
    expect((await revokePost(req(`/api/family/links/${inv.id}/revoke`, { token: t(him), body: { assisted: true } }), params(inv.id))).status).toBe(200);
    last = (await shareRecords(him, inv.id)).at(-1)!;
    expect(last).toMatchObject({ decision: "withdrawn", assisted: true });
    // her own records are hers alone
    expect((await store.listConsentRecords(her.userId, { kind: "family_accept" })).every((c) => c.assisted === false)).toBe(true);
  });

  it("the confirm card's line 「请陈先生本人点」 shows only for an account whose sign-up was made with someone helping", async () => {
    const alone = await account("blank", "陈先生");
    expect(await helpedName(store, alone.userId)).toBeNull();
    const helped = await account("blank", "陈先生");
    await store.addConsentRecord({ user_id: helped.userId, scope_id: helped.userId, kind: "terms_privacy", decision: "granted", version: "dev", method: "signup_screen", assisted: true });
    expect(await helpedName(store, helped.userId)).toBe("陈先生");
  });

  it("the switches change only once he has confirmed her: 409 link_not_active before, and no record says granted", async () => {
    const him = await account("example", "陈先生");
    const her = await account("none");
    const inv = await invited(him);
    const early = await grantsPost(req(`/api/family/links/${inv.id}/grants`, { token: t(him), body: { items: { dose_summary: true } } }), params(inv.id));
    expect(early.status).toBe(409);
    expect(await early.json()).toEqual({ error: "link_not_active" });
    await acceptPost(req("/api/family/invites/accept", { token: t(her), body: { token: inv.token } }));
    expect((await grantsPost(req(`/api/family/links/${inv.id}/grants`, { token: t(him), body: { items: { dose_summary: true } } }), params(inv.id))).status).toBe(409);
    expect(await shareRecords(him, inv.id)).toEqual([]);
    expect((await store.getFamilyGrant(him.userId, inv.id))?.items).toMatchObject({ dose_summary: false });
    expect((await store.listGrantHistory(inv.id)).map((h) => h.version)).toEqual([1]);
  });
});

describe("leaving is her own action", () => {
  it("no ?link=: her own link ends, her consent is withdrawn; a stranger or he himself gets 404; twice is 409", async () => {
    const him = await account("example", "陈先生");
    const her = await account("none");
    const other = await account("none", "Someone");
    const inv = await invited(him);
    await acceptPost(req("/api/family/invites/accept", { token: t(her), body: { token: inv.token } }));
    await confirmPost(req(`/api/family/links/${inv.id}/confirm`, { token: t(him), body: { yes: true } }), params(inv.id));
    expect((await leavePost(req(`/api/family/links/${inv.id}/leave`, { token: t(other) }), params(inv.id))).status).toBe(404);
    expect((await leavePost(req(`/api/family/links/${inv.id}/leave`, { token: t(him) }), params(inv.id))).status).toBe(404);
    expect((await leavePost(req(`/api/family/links/${inv.id}/leave`), params(inv.id))).status).toBe(401);
    expect((await store.getCareLink(inv.id))?.status).toBe("active");
    expect((await leavePost(req(`/api/family/links/${inv.id}/leave`, { token: t(her) }), params(inv.id))).status).toBe(200);
    expect(await store.getCareLink(inv.id)).toMatchObject({ status: "revoked", revoked_by: "family" });
    const last = (await store.listConsentRecords(her.userId, { kind: "family_accept" })).at(-1)!;
    expect(last).toMatchObject({ decision: "withdrawn", method: "family_leave", version: FAMILY_CONSENT_VERSION, assisted: false });
    const again = await leavePost(req(`/api/family/links/${inv.id}/leave`, { token: t(her) }), params(inv.id));
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "link_closed" });
  });

  it("a link that still waits for his 「是她」 can be left too", async () => {
    const him = await account("example", "陈先生");
    const her = await account("none");
    const inv = await invited(him);
    await acceptPost(req("/api/family/invites/accept", { token: t(her), body: { token: inv.token } }));
    expect((await leavePost(req(`/api/family/links/${inv.id}/leave`, { token: t(her) }), params(inv.id))).status).toBe(200);
    expect(await store.getCareLink(inv.id)).toMatchObject({ status: "revoked", revoked_by: "family" });
  });
});
