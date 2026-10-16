/**
 * The consent texts (lib/privacy/consent-texts.ts, track A): every published text's sha256 is the hash of exactly its
 * words, a (kind, version, locale) appears once, each sign-up kind has its current version in both languages, and the
 * texts say what real-app 3.11 requires (the model and where it processes: Tencent Cloud's Hunyuan since 10-16, where
 * Tencent's pages say; DeepSeek in China before; where data is stored, the placeholder officer).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONSENT_TEXTS,
  CURRENT_CONSENT_VERSIONS,
  DATA_PROTECTION_OFFICER,
  consentBody,
  consentText,
  currentConsentText,
  type SignupConsentKind,
} from "@/lib/privacy/consent-texts";
import { OCR_REGION } from "@/lib/vision/ocr";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("consent texts", () => {
  it("each sha256 is the hash of exactly its text (a changed text needs a new version and its new hash)", () => {
    for (const t of CONSENT_TEXTS) {
      expect(t.text, `${t.kind} ${t.version} ${t.locale}`).toBe(consentBody(t.title, t.paragraphs));
      expect(t.sha256, `${t.kind} ${t.version} ${t.locale}: the right sha256 is ${sha(t.text)}`).toBe(sha(t.text));
    }
  });

  it("a kind, version and locale is published once", () => {
    const keys = CONSENT_TEXTS.map((t) => `${t.kind}|${t.version}|${t.locale}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every sign-up kind has its current version in Chinese and English", () => {
    for (const kind of Object.keys(CURRENT_CONSENT_VERSIONS) as SignupConsentKind[]) {
      for (const locale of ["zh-Hans", "en"] as const) {
        const t = currentConsentText(kind, locale);
        expect(t.version).toBe(CURRENT_CONSENT_VERSIONS[kind]);
        expect(consentText(kind, t.version, locale)).toBe(t);
      }
    }
    expect(consentText("terms_privacy", "1999-01-01", "en")).toBeNull();
  });

  it("the AI text names Tencent Cloud's Hunyuan, where and how long as Tencent says, and lists what is sent; refusing keeps the app working", () => {
    const zh = currentConsentText("ai_processing", "zh-Hans").text;
    const en = currentConsentText("ai_processing", "en").text;
    for (const word of ["腾讯云的混元模型", "不同的国家或地区", "不一定在新加坡", "最多保留 30 天", "你问的话", "逐字稿", "翻译", "不同意也照样能用"]) expect(zh).toContain(word);
    for (const word of ["Tencent Cloud's Hunyuan model", "different countries or regions", "not necessarily processed in Singapore", "up to 30 days", "what you ask", "transcripts", "translated", "If you say no"]) expect(en).toContain(word);
    expect(`${zh}\n${en}`).not.toMatch(/DeepSeek/i);
  });

  // The owner's decision of 2026-10-16: 「模型本身用混元。把 DeepSeek 直接去掉。」 The AI text got a new version: Hunyuan named,
  // where and how long in Tencent's words (TokenHub's Singapore site), the label-photo line gone (no Hunyuan model reads
  // images); every other paragraph is the 2026-10-15 one, and the older versions stay published word for word.
  it("ai_processing 2026-10-16: Hunyuan, Tencent's words on where and how long, no label photos; the rest as 2026-10-15; older versions still published", () => {
    // in force until 2026-10-16.2 (label photos read by Tencent Cloud OCR: the test below), published word for word
    const PUBLISHED = { "zh-Hans": "bdf8d552d8d70c195b9c53a8a80410320f3342ef2448e4ed71739f4920434bb4", en: "e3181994e683126561fec73870596321503a3a5c8ecac6324edc1f47f84019a9" } as const;
    for (const locale of ["zh-Hans", "en"] as const) {
      const before = consentText("ai_processing", "2026-10-15", locale)!;
      const now = consentText("ai_processing", "2026-10-16", locale)!;
      expect(now.sha256, locale).toBe(PUBLISHED[locale]);
      expect(sha(now.text), locale).toBe(now.sha256);
      expect(now.title, locale).toBe(before.title);
      // the list without the photo line, then the new paragraph on where and how long, then the 10-15 paragraphs
      const photo = before.paragraphs.findIndex((p) => /药袋的照片|photos of medicine labels/.test(p));
      const kept = before.paragraphs.filter((_, i) => i !== 0 && i !== photo);
      expect(now.paragraphs.filter((p, i) => i !== 0 && !/腾讯云写明|Tencent Cloud says/.test(p)), locale).toEqual(kept);
      expect(now.paragraphs[0], locale).not.toBe(before.paragraphs[0]);
      expect(now.text, locale).not.toMatch(/药袋的照片，用来|photos of medicine labels, to read/);
      expect(before.paragraphs[0], locale).toMatch(/DeepSeek/);
      expect(consentText("ai_processing", "2026-10-10", locale), locale).not.toBeNull();
    }
    expect(consentText("ai_processing", "2026-10-16", "zh-Hans")!.paragraphs[0]).toBe("你同意以后，下面这些内容会发给腾讯云的混元模型处理：");
    expect(consentText("ai_processing", "2026-10-16", "en")!.paragraphs[0]).toBe("If you agree, these are sent to Tencent Cloud's Hunyuan model to be processed:");
    // nothing Tencent's pages do not say: no claim that the model processes in Singapore or in mainland China
    for (const locale of ["zh-Hans", "en"] as const) {
      const where = consentText("ai_processing", "2026-10-16", locale)!.paragraphs.find((p) => /腾讯云写明|Tencent Cloud says/.test(p))!;
      expect(where, locale).not.toMatch(/处理在中国|中国大陆|mainland/);
      expect(where, locale).toMatch(/不一定在新加坡|not necessarily processed in Singapore/);
    }
  });

  it("the terms say where data is, how long, who sees it, export and deletion, and the officer", () => {
    const zh = currentConsentText("terms_privacy", "zh-Hans").text;
    const en = currentConsentText("terms_privacy", "en").text;
    for (const word of ["东京", "新加坡", "90 天", "家人", "导出", "删除", "7 天", "21 天", DATA_PROTECTION_OFFICER["zh-Hans"]]) expect(zh).toContain(word);
    for (const word of ["Tokyo", "Singapore", "90 days", "family", "export", "delete", "7 days", "21 days", DATA_PROTECTION_OFFICER.en]) expect(en).toContain(word);
  });

  // The owner's decision of 2026-10-16, later the same day: label photos are read by Tencent Cloud OCR (lib/vision/ocr.ts),
  // still only after his yes. The AI text got a new version with one paragraph more, after the one on what the model does:
  // who reads the photo and where, that no Hunyuan model sees it, what Tencent's OCR module says about keeping it (no
  // number of days), and what Ripple keeps. Every other paragraph is the 2026-10-16 one; that version stays published.
  it("ai_processing 2026-10-16.2: label photos read by Tencent Cloud OCR in Singapore after his yes, what is kept; the rest as 2026-10-16", () => {
    expect(CURRENT_CONSENT_VERSIONS.ai_processing).toBe("2026-10-16.2");
    for (const locale of ["zh-Hans", "en"] as const) {
      const before = consentText("ai_processing", "2026-10-16", locale)!;
      const now = consentText("ai_processing", "2026-10-16.2", locale)!;
      expect(currentConsentText("ai_processing", locale), locale).toBe(now);
      expect(sha(now.text), locale).toBe(now.sha256);
      expect(now.title, locale).toBe(before.title);
      const added = now.paragraphs.findIndex((p) => /^药袋的照片：|^Photos of medicine labels:/.test(p));
      expect(added, locale).toBe(before.paragraphs.findIndex((p) => /^模型只能|^The model only picks/.test(p)) + 1);
      expect(now.paragraphs.filter((_, i) => i !== added), locale).toEqual([...before.paragraphs]);
    }
    const zh = consentText("ai_processing", "2026-10-16.2", "zh-Hans")!.paragraphs.find((p) => p.startsWith("药袋的照片："))!;
    const en = consentText("ai_processing", "2026-10-16.2", "en")!.paragraphs.find((p) => p.startsWith("Photos of medicine labels:"))!;
    for (const w of ["你同意以后", "腾讯云的文字识别服务（OCR）", "在新加坡", "照片不交给混元模型", "读出的字发回 Ripple", "没有写具体天数", "Ripple 不存读出的整段文字", "药名、规格、用法、配药日期和诊所", "你确认或改过的内容", "只有服务器能打开的私有空间"]) expect(zh, w).toContain(w);
    for (const w of ["once you agree", "Tencent Cloud's text recognition service (OCR)", "in Singapore", "the photo goes to no Hunyuan model", "the words come back to Ripple", "without giving a number of days", "Ripple does not keep the whole text it reads", "the medicine, strength, directions, dispensing date and clinic", "saves what you confirm or correct", "private storage that only the server can open"]) expect(en, w).toContain(w);
    // the list of what goes to the model still has no photo; saying no still means typing the label
    for (const locale of ["zh-Hans", "en"] as const) {
      const t = currentConsentText("ai_processing", locale);
      expect(t.paragraphs.filter((p) => p.startsWith("· ")).join(" "), locale).not.toMatch(/照片|photo/i);
      expect(t.text, locale).toMatch(/药袋照片上的字要你自己输入|you type the label text yourself/);
    }
    // the code it describes: the reader's region, and his consent asked before any reader (lib/meds/write.ts)
    expect(OCR_REGION).toBe("ap-singapore");
    const write = readFileSync(fileURLToPath(new URL("../../../lib/meds/write.ts", import.meta.url)), "utf8");
    expect(write.indexOf("aiConsent(store, session)")).toBeGreaterThan(-1);
    expect(write.indexOf("aiConsent(store, session)")).toBeLessThan(write.indexOf("readLabelText("));
  });

  // Line bind, 2026-10-11: binding by account (lib/care/bind.ts) shows a linked family member four items at once, so
  // 「你确认过的家人，只能看你打开的那几项」 was no longer true. The terms got a new version; the old one stays published
  // word for word, because the records of everyone who agreed to it point at it.
  it("terms 2026-10-11 differ from 2026-10-10 in one paragraph, 「谁能看」, and 2026-10-10 is still published as it was", () => {
    const FIRST = { "zh-Hans": "52f8a0840609b9d835ffab7d6efd4c4159ea9efeed1e3cddcc3ad045e76d8bae", en: "481f91ffac0d49d3d90c5cf05b0916665a080ee7d6912677d9158ca11d55f8fe" } as const;
    for (const locale of ["zh-Hans", "en"] as const) {
      const old = consentText("terms_privacy", "2026-10-10", locale)!;
      const now = consentText("terms_privacy", "2026-10-11", locale)!;
      expect(old.sha256, locale).toBe(FIRST[locale]);
      expect(now.title, locale).toBe(old.title);
      expect(now.paragraphs.length, locale).toBe(old.paragraphs.length);
      expect(now.paragraphs.flatMap((p, i) => (p === old.paragraphs[i] ? [] : [i])), locale).toEqual([3]);
    }
    const zh = consentText("terms_privacy", "2026-10-11", "zh-Hans")!.paragraphs[3]!;
    const en = consentText("terms_privacy", "2026-10-11", "en")!.paragraphs[3]!;
    // what he is told: a link is made by either of them typing the other's account, what she sees at once, what stays
    // closed, and that he can switch anything off or remove the link
    for (const word of ["谁能看：你自己", "你填了家人的账号，或者家人填了你的账号，就绑定了", "这周吃药的天数", "量了几次血压", "有几个问题要问医生", "提醒两次没回的时候会收到通知", "看诊录音和你的笔记要你自己打开", "随时关掉", "解除绑定", "每次查看都会留下记录"]) expect(zh, word).toContain(word);
    for (const word of ["Who can see it: you", "When you enter a family member's account, or they enter yours, you are linked", "at once", "took your medicine", "blood pressure readings", "questions are waiting for the doctor", "two reminders go unanswered", "stay closed until you open them", "switch any item off or remove the link", "every look is logged"]) expect(en, word).toContain(word);
    expect(zh).not.toContain("你确认过的家人");
    expect(en).not.toContain("you have confirmed");
  });

  // The owner's decision of 2026-10-14: the same six switches, and each one shows its kind in full while it is on
  // (lib/care/home.ts). 「谁能看」 had named counts (the days, how many readings, how many questions). The terms got a new
  // version; 2026-10-11 stays published word for word, because the records of everyone who agreed to it point at it.
  // The owner's other decision of that day (professional words, not spoken ones) reached the 华语 of this version before
  // it was published: 「存什么」 and 「留多久」 say 服药, 就诊 where they said 吃药, 看诊, and the line about where Ripple's
  // words come from names the label as 药品标签 (the photo he takes is still of his 药袋). The English differs in 「谁能看」
  // only.
  it("terms 2026-10-14 differ from 2026-10-11 in one sentence of 「谁能看」: what a linked family member sees, named in full; the 华语 in professional words; 2026-10-11 is still published as it was", () => {
    const SECOND = { "zh-Hans": "b94703af75bfbadc25aa4de10a14d7b718a881665602c63a8df35f6e84559ae8", en: "1df71b1ad4aeda9960ff00acbe3ecc785dbd9805c5405e5b3fcb76b33582763b" } as const;
    expect(CURRENT_CONSENT_VERSIONS.terms_privacy).toBe("2026-10-14");
    const sentences = (p: string) => p.split(/(?<=[。.])\s*/);
    for (const locale of ["zh-Hans", "en"] as const) {
      const old = consentText("terms_privacy", "2026-10-11", locale)!;
      const now = consentText("terms_privacy", "2026-10-14", locale)!;
      expect(old.sha256, locale).toBe(SECOND[locale]);
      expect(now.title, locale).toBe(old.title);
      expect(now.paragraphs.length, locale).toBe(old.paragraphs.length);
      expect(now.paragraphs.flatMap((p, i) => (p === old.paragraphs[i] ? [] : [i])), locale).toEqual(locale === "zh-Hans" ? [0, 2, 3, 5] : [3]);
      const [a, b] = [sentences(old.paragraphs[3]!), sentences(now.paragraphs[3]!)];
      expect(b.length, locale).toBe(a.length);
      expect(b.filter((s, i) => s !== a[i]), locale).toHaveLength(1);
      expect(currentConsentText("terms_privacy", locale), locale).toBe(now);
    }
    const zh = consentText("terms_privacy", "2026-10-14", "zh-Hans")!.paragraphs[3]!;
    const en = consentText("terms_privacy", "2026-10-14", "en")!.paragraphs[3]!;
    for (const word of ["家人马上能看到每日服药情况（药物名称、服药时间、未服药的原因）、血压读数、待问医生的问题", "两次提醒均未回应时会收到通知", "就诊录音和你的笔记要你自己打开", "随时关掉", "解除绑定", "每次查看都会留下记录"]) expect(zh, word).toContain(word);
    // the other three 华语 paragraphs that changed: the same facts, in the professional words
    const zhAll = consentText("terms_privacy", "2026-10-14", "zh-Hans")!;
    expect(zhAll.paragraphs[0]).toBe("存什么：你记录的服药情况、血压、问题和笔记；就诊的录音和逐字稿；药袋的照片；你自己填的资料。");
    expect(zhAll.paragraphs[2]).toContain("就诊录音从就诊那天起留 90 天");
    expect(zhAll.paragraphs[5]).toContain("只来自医生、药剂师、药品标签或官方单张的原话");
    for (const word of ["吃药", "没吃", "没回", "看诊"]) expect(zhAll.text, word).not.toContain(word);
    for (const word of ["they can at once see your medicine each day (which medicine, when, and the reason when you did not take it), your blood pressure readings and the questions you want to ask your doctor", "two reminders go unanswered", "stay closed until you open them", "switch any item off or remove the link", "every look is logged"]) {
      expect(en, word).toContain(word);
    }
    // the counts are gone from the text in force
    for (const word of ["这周吃药的天数", "量了几次血压", "有几个问题要问医生"]) expect(zh, word).not.toContain(word);
    for (const word of ["how many days", "how many blood pressure readings", "how many questions"]) expect(en, word).not.toContain(word);
  });

  // The owner's decision of 2026-10-14: visit recordings are transcribed by Tencent Cloud's speech recognition, and the
  // model writes Ripple's summary of what was said. The AI text got a new version; 2026-10-10 stays published word for
  // word, because the records of everyone who agreed to it point at it (and their yes still counts: nothing asks again).
  it("ai_processing 2026-10-15: Tencent's transcription said as a fact outside his yes, the summary among what his yes sends; 2026-10-10 still published as it was", () => {
    const FIRST = { "zh-Hans": "ee325d64ad7989a154d7c737070cfa9ef368ed0841613a447fc9bbb69713965b", en: "56be326a59b1a7cf12499f14b090fcc78113cd4ab70f17d7bf4a00c174d805fb" } as const;
    for (const locale of ["zh-Hans", "en"] as const) {
      const old = consentText("ai_processing", "2026-10-10", locale)!;
      const now = consentText("ai_processing", "2026-10-15", locale)!;
      expect(old.sha256, locale).toBe(FIRST[locale]);
      expect(sha(old.text), locale).toBe(FIRST[locale]);
      expect(now.title, locale).toBe(old.title);
      // in force from 10-15 to 10-16 (the 10-16 version replaced it: the test above)
      expect(sha(now.text), locale).toBe(now.sha256);
    }
    const zh = consentText("ai_processing", "2026-10-15", "zh-Hans")!;
    const en = consentText("ai_processing", "2026-10-15", "en")!;
    // the transcription: who, where, what goes and what comes back, and that it does not wait for this yes
    const tzh = zh.paragraphs.find((p) => p.startsWith("就诊录音转成文字"))!;
    for (const w of ["腾讯云的语音识别服务", "新加坡", "一句一句发过去", "分段发过去", "转出的文字发回 Ripple", "不需要你同意 AI 处理"]) expect(tzh, w).toContain(w);
    const ten = en.paragraphs.find((p) => p.startsWith("Visit recordings are turned into text"))!;
    for (const w of ["Tencent Cloud's speech recognition service", "Singapore", "each stretch of speech is sent as you finish it", "in pieces", "the text comes back to Ripple", "does not need your agreement to AI processing"]) expect(ten, w).toContain(w);
    // not in the list of what his yes sends (that list is DeepSeek's)
    expect(zh.paragraphs.filter((p) => p.startsWith("· ")).join(" ")).not.toContain("腾讯云");
    expect(en.paragraphs.filter((p) => p.startsWith("· ")).join(" ")).not.toContain("Tencent");
    // the summary: what the transcript is also sent for, marked as not confirmed, and gone when he says no
    expect(zh.text).toContain("写出 Ripple 的总结（几条要点，标明未经确认，不当作医生的原话）");
    expect(zh.text).toContain("没有 Ripple 的总结");
    expect(en.text).toContain("to write Ripple's summary while you record and when the visit ends (a few short points, marked as not confirmed, never taken as the doctor's words)");
    expect(en.text).toContain("there is no Ripple summary");
    // the owner's professional words of 10-14
    for (const word of ["吃药", "没吃", "看诊"]) expect(zh.text, word).not.toContain(word);
  });
});
