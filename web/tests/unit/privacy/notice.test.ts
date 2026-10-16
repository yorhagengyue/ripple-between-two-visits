/**
 * The words of /privacy (lib/privacy/notice.ts; docs/plan/real-app.md 3.11 告知 「写清：收集什么、为什么、存在哪、保留多久、谁能看、
 * 怎么导出和删除」; C2 track H), held to what the code does:
 *   - both languages have the same sections, and say where the data is (Tokyo, Singapore, DeepSeek in China and only
 *     with consent), that it leaves Singapore, and who answers for it
 *   - every number comes from the rules the jobs use (90 days, 30 days, 7 days, 2 days, 3 exports, 10-minute links)
 *   - who can see: himself, family linked to him (line bind, 2026-10-11: what a link by account shows at once and what
 *     stays closed, in the words of the terms he agrees to), operators with a log he can see in his export; and the one
 *     thing a family member sees whatever the six switches say, the time of his morning reminder (real-app section 10:
 *     「提醒时间不受六个开关管……写进隐私说明」), which is what lib/care/home.ts hands her
 *   - the version changes with the words
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { READ_LINK_SECONDS } from "@/lib/blob";
import { currentConsentText } from "@/lib/privacy/consent-texts";
import { createHash } from "node:crypto";
import { NOTICE_VERSION, NOTICE_VERSIONS, privacyNotice, type Notice } from "@/lib/privacy/notice";
import { AUDIO_KEEP_DAYS, BUS_EVENT_KEEP_DAYS, EXAMPLE_IDLE_DAYS, EXPORT_LIMIT_PER_DAY, EXPORT_LINK_SECONDS, ORPHAN_GRACE_DAYS, SAFETY_EVENT_KEEP_DAYS } from "@/lib/privacy/rules";
import { TENCENT_ASR_DEFAULTS } from "@/lib/asr/tencent";

const zh = privacyNotice("zh-Hans");
const en = privacyNotice("en");
const words = (n: Notice) =>
  [n.title, n.intro, ...n.sections.flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.items ?? []), ...(s.terms ?? []).flat()]), n.officerHeading, n.officerLine, n.consentsIntro].join("\n");
const section = (n: Notice, id: string) => {
  const s = n.sections.find((x) => x.id === id)!;
  return [...(s.paragraphs ?? []), ...(s.items ?? []), ...(s.terms ?? []).flat()].join("\n");
};

describe("the privacy notice", () => {
  it("both languages have the same sections in the same order, each with something in it", () => {
    const ids = ["what", "why", "where", "how-long", "who", "your-choices", "logs"];
    expect(zh.sections.map((s) => s.id)).toEqual(ids);
    expect(en.sections.map((s) => s.id)).toEqual(ids);
    for (const id of ids) {
      const a = zh.sections.find((s) => s.id === id)!;
      const b = en.sections.find((s) => s.id === id)!;
      expect((a.items ?? []).length, id).toBe((b.items ?? []).length);
      expect((a.terms ?? []).length, id).toBe((b.terms ?? []).length);
      expect((a.paragraphs ?? []).length, id).toBe((b.paragraphs ?? []).length);
      expect(section(zh, id).length).toBeGreaterThan(10);
    }
  });

  it("where: Tokyo, Singapore, Tencent Cloud's Hunyuan only with consent and where Tencent says, and that the data leaves Singapore", () => {
    for (const w of ["东京", "新加坡", "腾讯云的混元模型", "不同的国家或地区", "最多保留 30 天", "不同意就不发", "离开新加坡", "10 分钟"]) expect(section(zh, "where"), w).toContain(w);
    for (const w of ["Tokyo", "Singapore", "Tencent Cloud's Hunyuan model", "different countries or regions", "up to 30 days", "If you say no, nothing is sent", "leaves Singapore", "10 minutes"]) expect(section(en, "where"), w).toContain(w);
    expect(READ_LINK_SECONDS).toBe(600);
  });

  it("how long: every number is the rule the jobs run on", () => {
    expect([AUDIO_KEEP_DAYS, SAFETY_EVENT_KEEP_DAYS, EXAMPLE_IDLE_DAYS, BUS_EVENT_KEEP_DAYS, ORPHAN_GRACE_DAYS, EXPORT_LIMIT_PER_DAY, EXPORT_LINK_SECONDS]).toEqual([90, 90, 30, 7, 2, 3, 86_400]);
    const z = section(zh, "how-long");
    const e = section(en, "how-long");
    for (const w of ["留 90 天", "一直保留", "90 天，只用来排查故障", "最多 200 条，最长 7 天", "满 2 天以后自动删除", "30 天不用", "24 小时内有效", "7 天", "21 天", "只留她的称呼"]) expect(z, w).toContain(w);
    for (const w of ["90 days from the visit", "keep one for good", "At most 200 events per person, none older than 7 days", "once they are 2 days old", "30 days without use", "24 hours", "7 days", "21 days", "stay with you"]) expect(e, w).toContain(w);
    expect(section(zh, "your-choices")).toContain("一天最多 3 次");
    expect(section(en, "your-choices")).toContain("up to 3 times a day");
    // an export leaves nothing on the server, and the notice says so
    expect(z).toContain("不留在服务器上");
    expect(e).toContain("Not kept on the server");
  });

  it("who can see: him, family linked to him, operators with a log he can read; and the reminder time, whatever the six switches say", () => {
    const z = section(zh, "who");
    const e = section(en, "who");
    for (const w of ["你自己", "和你绑定的家人", "就诊录音和你的笔记要你自己打开", "每一项你都可以随时关掉，也可以解除绑定", "谁、什么时候、为什么", "导出的文件里看得到", "不把你的资料交给别人"]) expect(z, w).toContain(w);
    for (const w of ["You.", "Family members linked to you", "visit recordings and your notes stay closed until you open them", "You can switch any item off or remove the link at any time", "who, when and why", "in the file you export", "do not give your data to anyone else"]) expect(e, w).toContain(w);
    // what a link by account shows is said in the words of the terms he agrees to (lib/privacy/consent-texts.ts
    // terms_privacy, the paragraph 「谁能看」), so the page and the text he agreed to cannot drift apart
    for (const [n, locale, from, to] of [
      [z, "zh-Hans", "和你绑定的家人。", "也可以解除绑定。"],
      [e, "en", "When you enter a family member's account", "remove the link at any time."],
    ] as const) {
      const terms = currentConsentText("terms_privacy", locale).paragraphs.join("\n");
      const said = terms.slice(terms.indexOf(from), terms.indexOf(to) + to.length);
      expect(said.length, locale).toBeGreaterThan(60);
      expect(n, locale).toContain(said);
    }
    // the sentence the design asks for (real-app section 10 「提醒时间不受六个开关管」)
    for (const w of ["不归这六个开关管", "早上提醒的时间", "不管开关怎么设", "停止分享以后，这些她也看不到了"]) expect(z, w).toContain(w);
    for (const w of ["not governed by the six switches", "the time of your morning reminder", "whatever the switches say", "Once you stop sharing, they can no longer see these"]) expect(e, w).toContain(w);
    // and it is what her page gets: the reminder with its time, set outside every switch check
    const home = readFileSync(fileURLToPath(new URL("../../../lib/care/home.ts", import.meta.url)), "utf8");
    expect(home).toMatch(/out\.reminder = \{[^}]*at: scopeSlotSchedule\(scope, "morning"\)\.first/);
  });

  it("fixed words: no clinical sentence, no placeholder left, and the version carries this change", () => {
    for (const n of [zh, en]) {
      expect(words(n)).not.toMatch(/TODO|TBD|待定|lorem/i);
      expect(words(n)).not.toMatch(/\bmg\b|毫克|should take|应该吃/);
    }
    // 2026-10-14 (the owner's decision of that day): 「谁能看」 names what a linked family member sees as the kinds
    // themselves, in full, not as counts of them (kept in 2026-10-15 and 2026-10-16)
    expect(NOTICE_VERSION).toBe("2026-10-16.2");
    expect(zh.updated).toContain("2026年10月16日");
    expect(en.updated).toContain("16 October 2026");
    expect(section(zh, "who")).toContain("每日服药情况（药物名称、服药时间、未服药的原因）、血压读数、待问医生的问题");
    expect(section(en, "who")).toContain("your medicine each day (which medicine, when, and the reason when you did not take it), your blood pressure readings and the questions you want to ask your doctor");
    expect(section(zh, "who")).not.toMatch(/吃药的天数|量了几次血压|有几个问题/);
    // the same day's other decision: professional words, not spoken ones, all through the 华语 page (the photo he takes is
    // still of his 药袋; the label as a source is 药品标签)
    expect(words(zh)).not.toMatch(/吃药|没吃|没回|看诊|药袋上|药袋和/);
    expect(section(zh, "why")).toContain("药品标签和官方单张的原话");
    expect(section(en, "who")).not.toMatch(/how many/);
    expect(zh.visitCardTitle.length).toBeGreaterThan(4);
    expect(en.visitCardTitle.length).toBeGreaterThan(10);
  });

  // The owner's decision of 2026-10-14: Tencent Cloud transcribes the visit recordings (lib/asr/tencent.ts) and the
  // model writes Ripple's summary (lib/visit/ripple-summary.ts). "On our own machine, not given to another company" is
  // no longer so: a new version; 2026-10-14 stays word for word.
  it("2026-10-15: who transcribes, where, what is sent and kept; the summary; 2026-10-14 kept word for word", () => {
    const old = { "zh-Hans": "440ceeea7caa0effaab78cef591ca3740e846cb6ec7ce74abb8fb981543a516e", en: "69e8c0e6687dcd2f85ac033d4992afec7cf641aeff078d1b96a7d54927fb8df9" } as const;
    for (const locale of ["zh-Hans", "en"] as const) {
      expect(createHash("sha256").update(JSON.stringify(privacyNotice(locale, "2026-10-14")), "utf8").digest("hex"), locale).toBe(old[locale]);
    }
    expect(Object.keys(NOTICE_VERSIONS)).toEqual(["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-16.2"]);
    const term = (n: Notice, name: string) => (n.sections.find((s) => s.id === "where")!.terms ?? []).find(([t]) => t === name)?.[1] ?? "";
    const tzh = term(zh, "就诊录音的转写");
    for (const w of ["腾讯云的语音识别服务", "新加坡", "以停顿为界", "每段不超过 100 秒", "转出的文字发回 Ripple", "保留 24 小时", "不需要你同意 AI 处理"]) expect(tzh, w).toContain(w);
    const ten = term(en, "Transcribing visit recordings");
    for (const w of ["Tencent Cloud's speech recognition service", "Singapore", "a pause ends it", "pieces of up to 100 seconds", "The text comes back to Ripple", "for 24 hours", "does not need your agreement to AI processing"]) expect(ten, w).toContain(w);
    for (const n of [zh, en]) expect(words(n)).not.toMatch(/自己的机器上做|不交给别的公司|our own machine|not by another company/);
    // the words of the old version are still there to read
    expect(term(privacyNotice("zh-Hans", "2026-10-14"), "就诊录音的转写")).toBe("在我们自己的机器上做，不交给别的公司。");
    // the summary: what the transcript is sent to the model for, kept as long as the transcript, and gone with a no
    expect(term(zh, "AI 处理")).toContain("写出 Ripple 的总结");
    expect(term(zh, "AI 处理")).toContain("不同意就不发，也没有 Ripple 的总结");
    expect(term(en, "AI processing")).toContain("to write Ripple's summary while you record and when the visit ends");
    expect(section(zh, "what")).toContain("Ripple 根据录音整理的总结（未经确认）");
    expect(section(en, "what")).toContain("Ripple's summary of what was said (not confirmed)");
    expect(section(zh, "how-long")).toContain("Ripple 的就诊总结");
    expect(section(en, "how-long")).toContain("Ripple's visit summaries");
    // the numbers it states are the code's: the pieces of the whole visit, and the region
    expect(TENCENT_ASR_DEFAULTS).toMatchObject({ pieceMs: 100_000, region: "ap-singapore" });
  });

  // The owner's decision of 2026-10-16: 「模型本身用混元。把 DeepSeek 直接去掉。」 A new version whose AI processing line and
  // 「存在哪」 paragraph name Tencent Cloud's Hunyuan and say where and how long in Tencent's words; 2026-10-15 stays word for
  // word (it named DeepSeek).
  it("2026-10-16: the model is Tencent Cloud's Hunyuan, where and how long as Tencent says, no label photos; 2026-10-15 kept as it was", () => {
    // in force until 2026-10-16.2 (the test below); its AI processing line is unchanged there
    expect(privacyNotice("en", "2026-10-16")).toBe(NOTICE_VERSIONS["2026-10-16"].en);
    const term = (n: Notice, name: string) => (n.sections.find((s) => s.id === "where")!.terms ?? []).find(([t]) => t === name)?.[1] ?? "";
    expect(term(zh, "AI 处理")).toContain("交给腾讯云的混元模型处理。腾讯云写明，处理用的算力按可用情况来自不同的国家或地区，所以不一定在新加坡；一般最多保留 30 天。药袋的照片不交给模型。");
    expect(term(en, "AI processing")).toContain("go to Tencent Cloud's Hunyuan model. Tencent Cloud says the computing resources it uses come from different countries or regions, depending on availability, so not necessarily Singapore, and it generally keeps them for up to 30 days. Label photos are not sent to the model.");
    expect(section(zh, "where")).toContain("要处理的那一部分可能在别的国家或地区处理");
    expect(section(en, "where")).toContain("the parts it works on may be processed in other countries or regions");
    for (const n of [zh, en]) expect(words(n)).not.toMatch(/DeepSeek/i);
    // the 10-15 words are still there to read, DeepSeek and all
    expect(term(privacyNotice("zh-Hans", "2026-10-15"), "AI 处理")).toContain("交给 DeepSeek 的模型处理，处理在中国");
    // the rest is the 10-15 text
    const s16 = privacyNotice("en", "2026-10-16").sections.filter((s) => s.id !== "where");
    const s15 = privacyNotice("en", "2026-10-15").sections.filter((s) => s.id !== "where");
    expect(s16).toEqual(s15);
  });

  // The owner's decision of 2026-10-16, later the same day: label photos are read by Tencent Cloud OCR. One more line under
  // 「存在哪」, right after the AI processing line (which stays as it was: no model sees a photo); everything else as
  // 2026-10-16, which stays published.
  it("2026-10-16.2: label photos read by Tencent Cloud OCR in Singapore after his yes, and what Ripple keeps; the rest as 2026-10-16", () => {
    expect(privacyNotice("en")).toBe(privacyNotice("en", "2026-10-16.2"));
    expect(privacyNotice("zh-Hans")).toBe(privacyNotice("zh-Hans", "2026-10-16.2"));
    const terms = (n: Notice) => n.sections.find((s) => s.id === "where")!.terms ?? [];
    for (const [locale, ai, name] of [["zh-Hans", "AI 处理", "药袋照片的文字识别"], ["en", "AI processing", "Reading label photos"]] as const) {
      const before = privacyNotice(locale, "2026-10-16");
      const now = privacyNotice(locale, "2026-10-16.2");
      const names = terms(now).map(([t]) => t);
      expect(names.indexOf(name), locale).toBe(names.indexOf(ai) + 1);
      expect(terms(now).filter(([t]) => t !== name), locale).toEqual(terms(before));
      expect(now.sections.filter((s) => s.id !== "where"), locale).toEqual(before.sections.filter((s) => s.id !== "where"));
      expect(now.updated, locale).toBe(before.updated);
    }
    const zhOcr = terms(zh).find(([t]) => t === "药袋照片的文字识别")![1];
    for (const w of ["只在你同意 AI 处理以后", "腾讯云的文字识别服务（OCR）", "在新加坡", "读出的字发回 Ripple", "照片不交给混元模型", "没有写具体天数", "Ripple 不存读出的整段文字", "你确认或改过的内容", "不同意就不读照片"]) expect(zhOcr, w).toContain(w);
    const enOcr = terms(en).find(([t]) => t === "Reading label photos")![1];
    for (const w of ["Only after you agree to AI processing", "Tencent Cloud's text recognition service (OCR)", "in Singapore", "the words come back to Ripple", "The photo goes to no Hunyuan model", "without giving a number of days", "Ripple does not keep the whole text it reads", "what you confirm or correct is saved", "If you say no, no photo is read"]) expect(enOcr, w).toContain(w);
    // the unconfirmed photo's deletion is the one 「留多久」 states
    expect(section(zh, "how-long")).toContain("拍了没确认的药袋照片");
    expect(section(en, "how-long")).toMatch(/label photo you did not confirm/);
  });
});
