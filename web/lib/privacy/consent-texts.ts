/**
 * The consent texts he agrees to (docs/plan/real-app.md 3.11), as published: a kind, a version, a locale, the words, and
 * the sha256 of exactly those words. Track A owns this file; client-safe (the sign-up screens show these words).
 *
 * How it is used:
 *   - the sign-up screens show `title` and `paragraphs` (a paragraph starting with "· " is a list item);
 *   - a consent record (store.addConsentRecord) carries `version` and `sha256` of the text he saw, and the server writes
 *     the text itself once into consent_text (store.putConsentText: insert only, the same version can never change);
 *   - lib/privacy (track H) and the deploy script read CONSENT_TEXTS to publish them and to compare hashes.
 *
 * Changing a text means a NEW version (add an entry, keep the old one: records point at it), and a new sha256:
 * tests/unit/privacy/consent-texts.test.ts recomputes every hash and prints the right one.
 *
 * The data protection officer is a placeholder until the owner names one (C2 架构审核, 还开着的决定): 「YoRHa2 团队」.
 * Never clinical: these say what is stored, where, for how long, who sees it, and what goes to the model.
 */
import type { ConsentKind } from "@/lib/store/types";

export type ConsentLocale = "zh-Hans" | "en";

/** The kinds the sign-up screens show (the rest are recorded by other tracks with their own texts). */
export type SignupConsentKind = "terms_privacy" | "ai_processing" | "example_data";

export interface ConsentText {
  kind: ConsentKind;
  version: string;
  locale: ConsentLocale;
  title: string;
  /** as shown, in order; a paragraph starting with "· " is a list item */
  paragraphs: readonly string[];
  /** exactly what is hashed and stored (consent_text.text): the title, then the paragraphs, blank lines between */
  text: string;
  /** hex sha256 of `text` (UTF-8) */
  sha256: string;
}

/** Who answers questions about his data (placeholder until the owner decides). */
export const DATA_PROTECTION_OFFICER: Record<ConsentLocale, string> = { "zh-Hans": "YoRHa2 团队", en: "the YoRHa2 team" };

/** The version each sign-up text is at now. */
export const CURRENT_CONSENT_VERSIONS: Record<SignupConsentKind, string> = {
  // 2026-10-11: 「谁能看」 says what binding by account does (the entries are at the end of DRAFTS)
  // 2026-10-14: 「谁能看」 names what a linked family member sees as the kinds themselves, not counts of them, and the
  //             华语 says 服药, 就诊, 未回应, and 药品标签 for the label as a source (the owner's decisions of that day; the
  //             entries are at the end of DRAFTS)
  terms_privacy: "2026-10-14",
  // 2026-10-15: visit recordings are transcribed by Tencent Cloud's speech recognition (said as a fact, outside what his
  //             yes sends), and the visit transcript also goes to the model for Ripple's summary (the entries are at the
  //             end of DRAFTS)
  // 2026-10-16: the model is Tencent Cloud's Hunyuan (TokenHub, Singapore site), no longer DeepSeek (the owner: 「模型本身用
  //             混元。把 DeepSeek 直接去掉。」): where and how long as Tencent's pages say, label photos to no model (the
  //             entries are at the end of DRAFTS)
  // 2026-10-16.2: label photos are read by Tencent Cloud OCR in Singapore after his yes, no Hunyuan model sees them, and
  //             what Ripple keeps of them (the owner's decision later the same day; the entries are at the end of DRAFTS)
  ai_processing: "2026-10-16.2",
  example_data: "2026-10-10",
};

interface Draft {
  kind: SignupConsentKind;
  version: string;
  locale: ConsentLocale;
  title: string;
  paragraphs: readonly string[];
  sha256: string;
}

/** The canonical text of a consent: what is hashed and stored. */
export function consentBody(title: string, paragraphs: readonly string[]): string {
  return [title, ...paragraphs].join("\n\n");
}

const DRAFTS: readonly Draft[] = [
  {
    kind: "terms_privacy",
    version: "2026-10-10",
    locale: "zh-Hans",
    title: "我们怎么保管你的资料",
    paragraphs: [
      "存什么：你记下的吃药、血压、问题和笔记；看诊的录音和逐字稿；药袋的照片；你自己填的资料。",
      "存在哪：资料存在 Supabase 的数据库里，在日本东京；Ripple 的服务器在新加坡。录音和照片放在只有服务器能打开的私有空间里。",
      "留多久：看诊录音从看诊那天起留 90 天，你选了「一直保留」的不删；别的记录一直留着，直到你删除账号。示例账号 30 天不用会自动删除。",
      "谁能看：你自己；你确认过的家人，只能看你打开的那几项；排查故障的运维人员，每次查看都会留下记录。",
      "导出和删除：在「我」里能导出全部资料，也能删除账号。删除以后，数据库和存储里的资料马上删掉；Supabase 自带的备份最长 7 天、我们自己的加密备份最长约 21 天以后自然消失。",
      "Ripple 不给医疗建议。屏上关于病和药的话，只来自医生、药剂师、药袋或官方单张的原话，或者固定的说明。",
      "数据保护负责人：YoRHa2 团队。完整的隐私说明在「隐私说明」页。",
    ],
    sha256: "52f8a0840609b9d835ffab7d6efd4c4159ea9efeed1e3cddcc3ad045e76d8bae",
  },
  {
    kind: "terms_privacy",
    version: "2026-10-10",
    locale: "en",
    title: "How we look after your information",
    paragraphs: [
      "What we keep: the doses, blood pressure readings, questions and notes you record; visit recordings and transcripts; photos of medicine labels; the details you enter yourself.",
      "Where: in a Supabase database in Tokyo, Japan; Ripple's server is in Singapore. Recordings and photos are kept in private storage that only the server can open.",
      "How long: a visit recording is kept for 90 days from the visit, unless you choose to keep it; everything else is kept until you delete your account. An example account is deleted after 30 days without use.",
      "Who can see it: you; family members you have confirmed, and only the items you switch on; the people who run the service, when fixing a fault, and every look is logged.",
      "Export and deletion: under Me you can export everything or delete your account. Deleting removes your data from the database and storage at once; Supabase's own backups expire within 7 days and our encrypted backups within about 21 days.",
      "Ripple gives no medical advice. What the screen says about illness and medicines comes only from the doctor's, the pharmacist's, the label's or an official leaflet's own words, or from fixed explanations.",
      "Data protection officer: the YoRHa2 team. The full privacy notice is on the Privacy page.",
    ],
    sha256: "481f91ffac0d49d3d90c5cf05b0916665a080ee7d6912677d9158ca11d55f8fe",
  },
  {
    kind: "ai_processing",
    version: "2026-10-10",
    locale: "zh-Hans",
    title: "要不要让 AI 帮忙？",
    paragraphs: [
      "你同意以后，下面这些内容会发给 DeepSeek 的模型处理，处理在中国：",
      "· 你问的话，和要引用的医生原话、药袋原文",
      "· 看诊的逐字稿，用来找出医生交代的事",
      "· 药袋的照片，用来读出上面的字",
      "· 要翻译成中文的医生原话",
      "模型只能从这些原话里挑句子，不自己说医疗建议。",
      "不同意也照样能用：记录、看诊录音、吃药、血压、家人都照常。只是问一句只给固定的回答和原话，看诊后的事项要你自己一件件确认，药袋上的字要你自己输入，医生的英文原话不翻译成中文。",
      "以后在「我」里随时能改。",
    ],
    sha256: "ee325d64ad7989a154d7c737070cfa9ef368ed0841613a447fc9bbb69713965b",
  },
  {
    kind: "ai_processing",
    version: "2026-10-10",
    locale: "en",
    title: "Can AI help?",
    paragraphs: [
      "If you agree, these are sent to DeepSeek's model, which processes them in China:",
      "· what you ask, with the doctor's words and the label text it may quote",
      "· visit transcripts, to find what the doctor asked you to do",
      "· photos of medicine labels, to read the words on them",
      "· the doctor's words that are translated into Chinese",
      "The model only picks sentences from those original words; it never gives medical advice of its own.",
      "If you say no, Ripple still works: records, visit recordings, doses, blood pressure and family work as usual. Asking gives fixed answers and original words only, you confirm the points from a visit one by one, you type the label text yourself, and the doctor's English is not translated.",
      "You can change this any time under Me.",
    ],
    sha256: "56be326a59b1a7cf12499f14b090fcc78113cd4ab70f17d7bf4a00c174d805fb",
  },
  {
    kind: "example_data",
    version: "2026-10-10",
    locale: "zh-Hans",
    title: "用陈先生的示例资料",
    paragraphs: [
      "陈先生是虚构的人物。他六周的记录按今天的日期铺好，最后一天就是今天。",
      "示例账号 30 天不用会自动删除；在「我」里随时能清空，从你自己的开始。",
      "请不要在示例账号里录真实的健康信息或真人的声音。",
    ],
    sha256: "31bbdf6fe7e7e3674fe70b136d57ccced35b330b4857acd3153f5e0e8b81581e",
  },
  {
    kind: "example_data",
    version: "2026-10-10",
    locale: "en",
    title: "Use Mr Tan's example data",
    paragraphs: [
      "Mr Tan is a made-up person. His six weeks of records are laid out on real dates, ending today.",
      "An example account is deleted after 30 days without use; under Me you can clear it any time and start your own.",
      "Please do not record real health information or real people's voices in an example account.",
    ],
    sha256: "f9b95016f899e0cd3958090949e238c7b134fdb5ca2071c165e07758bff393f5",
  },
  // ---------------------------------------------------------------- terms_privacy 2026-10-11 (kept: records point at it)
  // Line bind (the integrator, 2026-10-11): binding by account (lib/care/bind.ts) made 「你确认过的家人，只能看你打开的那
  // 几项」 untrue: a family member who types his account, or whose account he types, sees four items at once. Every
  // paragraph is the 2026-10-10 one except 「谁能看」. The 2026-10-10 entries above stay exactly as they are: records
  // point at them. An account that agreed to 2026-10-10 is not asked again (there is no such flow).
  {
    kind: "terms_privacy",
    version: "2026-10-11",
    locale: "zh-Hans",
    title: "我们怎么保管你的资料",
    paragraphs: [
      "存什么：你记下的吃药、血压、问题和笔记；看诊的录音和逐字稿；药袋的照片；你自己填的资料。",
      "存在哪：资料存在 Supabase 的数据库里，在日本东京；Ripple 的服务器在新加坡。录音和照片放在只有服务器能打开的私有空间里。",
      "留多久：看诊录音从看诊那天起留 90 天，你选了「一直保留」的不删；别的记录一直留着，直到你删除账号。示例账号 30 天不用会自动删除。",
      "谁能看：你自己；和你绑定的家人。你填了家人的账号，或者家人填了你的账号，就绑定了：家人马上能看到这周吃药的天数、量了几次血压、有几个问题要问医生，提醒两次没回的时候会收到通知；看诊录音和你的笔记要你自己打开。每一项你都可以随时关掉，也可以解除绑定。排查故障的运维人员，每次查看都会留下记录。",
      "导出和删除：在「我」里能导出全部资料，也能删除账号。删除以后，数据库和存储里的资料马上删掉；Supabase 自带的备份最长 7 天、我们自己的加密备份最长约 21 天以后自然消失。",
      "Ripple 不给医疗建议。屏上关于病和药的话，只来自医生、药剂师、药袋或官方单张的原话，或者固定的说明。",
      "数据保护负责人：YoRHa2 团队。完整的隐私说明在「隐私说明」页。",
    ],
    sha256: "b94703af75bfbadc25aa4de10a14d7b718a881665602c63a8df35f6e84559ae8",
  },
  {
    kind: "terms_privacy",
    version: "2026-10-11",
    locale: "en",
    title: "How we look after your information",
    paragraphs: [
      "What we keep: the doses, blood pressure readings, questions and notes you record; visit recordings and transcripts; photos of medicine labels; the details you enter yourself.",
      "Where: in a Supabase database in Tokyo, Japan; Ripple's server is in Singapore. Recordings and photos are kept in private storage that only the server can open.",
      "How long: a visit recording is kept for 90 days from the visit, unless you choose to keep it; everything else is kept until you delete your account. An example account is deleted after 30 days without use.",
      "Who can see it: you; family members linked to you. When you enter a family member's account, or they enter yours, you are linked: they can at once see how many days this week you took your medicine, how many blood pressure readings you took and how many questions are waiting for the doctor, and they are told when two reminders go unanswered; visit recordings and your notes stay closed until you open them. You can switch any item off or remove the link at any time. The people who run the service see it when fixing a fault, and every look is logged.",
      "Export and deletion: under Me you can export everything or delete your account. Deleting removes your data from the database and storage at once; Supabase's own backups expire within 7 days and our encrypted backups within about 21 days.",
      "Ripple gives no medical advice. What the screen says about illness and medicines comes only from the doctor's, the pharmacist's, the label's or an official leaflet's own words, or from fixed explanations.",
      "Data protection officer: the YoRHa2 team. The full privacy notice is on the Privacy page.",
    ],
    sha256: "1df71b1ad4aeda9960ff00acbe3ecc785dbd9805c5405e5b3fcb76b33582763b",
  },
  // ---------------------------------------------------------------- terms_privacy 2026-10-14 (in force)
  // The owner's decision of 2026-10-14: the same six switches, each showing its kind in full while it is on
  // (lib/care/home.ts). 「谁能看」 said a linked family member sees counts (「这周吃药的天数、量了几次血压、有几个问题要问医生」);
  // she sees his medicine each day with the reason when he did not take it, his readings and his questions' words. In
  // 「谁能看」 only the clause that names the items changed; the words are the family consent's of the same day
  // (lib/care/consent.ts 2026-10-14). The owner's other decision of that day (professional words, not spoken ones: 服药,
  // 就诊, 未回应 where it said 吃药, 看诊, 没回, and 药品标签 where the label is named as a source) changed the 华语 of
  // 「存什么」, 「留多久」 and the line about where Ripple's words come from as well, before this version was published (the
  // photo he takes is still of his 药袋); the English is as it was. The
  // entries above stay exactly as they are: records point at them. An account that agreed to an older version is not
  // asked again (there is no such flow).
  {
    kind: "terms_privacy",
    version: "2026-10-14",
    locale: "zh-Hans",
    title: "我们怎么保管你的资料",
    paragraphs: [
      "存什么：你记录的服药情况、血压、问题和笔记；就诊的录音和逐字稿；药袋的照片；你自己填的资料。",
      "存在哪：资料存在 Supabase 的数据库里，在日本东京；Ripple 的服务器在新加坡。录音和照片放在只有服务器能打开的私有空间里。",
      "留多久：就诊录音从就诊那天起留 90 天，你选了「一直保留」的不删；别的记录一直留着，直到你删除账号。示例账号 30 天不用会自动删除。",
      "谁能看：你自己；和你绑定的家人。你填了家人的账号，或者家人填了你的账号，就绑定了：家人马上能看到每日服药情况（药物名称、服药时间、未服药的原因）、血压读数、待问医生的问题，两次提醒均未回应时会收到通知；就诊录音和你的笔记要你自己打开。每一项你都可以随时关掉，也可以解除绑定。排查故障的运维人员，每次查看都会留下记录。",
      "导出和删除：在「我」里能导出全部资料，也能删除账号。删除以后，数据库和存储里的资料马上删掉；Supabase 自带的备份最长 7 天、我们自己的加密备份最长约 21 天以后自然消失。",
      "Ripple 不给医疗建议。屏上关于病和药的话，只来自医生、药剂师、药品标签或官方单张的原话，或者固定的说明。",
      "数据保护负责人：YoRHa2 团队。完整的隐私说明在「隐私说明」页。",
    ],
    sha256: "c4fccb99dc74cf1ed4b84626e545c74924f611f7b775f0198d0757ad7ccf4b49",
  },
  {
    kind: "terms_privacy",
    version: "2026-10-14",
    locale: "en",
    title: "How we look after your information",
    paragraphs: [
      "What we keep: the doses, blood pressure readings, questions and notes you record; visit recordings and transcripts; photos of medicine labels; the details you enter yourself.",
      "Where: in a Supabase database in Tokyo, Japan; Ripple's server is in Singapore. Recordings and photos are kept in private storage that only the server can open.",
      "How long: a visit recording is kept for 90 days from the visit, unless you choose to keep it; everything else is kept until you delete your account. An example account is deleted after 30 days without use.",
      "Who can see it: you; family members linked to you. When you enter a family member's account, or they enter yours, you are linked: they can at once see your medicine each day (which medicine, when, and the reason when you did not take it), your blood pressure readings and the questions you want to ask your doctor, and they are told when two reminders go unanswered; visit recordings and your notes stay closed until you open them. You can switch any item off or remove the link at any time. The people who run the service see it when fixing a fault, and every look is logged.",
      "Export and deletion: under Me you can export everything or delete your account. Deleting removes your data from the database and storage at once; Supabase's own backups expire within 7 days and our encrypted backups within about 21 days.",
      "Ripple gives no medical advice. What the screen says about illness and medicines comes only from the doctor's, the pharmacist's, the label's or an official leaflet's own words, or from fixed explanations.",
      "Data protection officer: the YoRHa2 team. The full privacy notice is on the Privacy page.",
    ],
    sha256: "5ae4aaaf89b0d89d9757212f39dbc0a2eb5d182ec1a19a9a0b9a6d1bb696a68b",
  },
  // ---------------------------------------------------------------- ai_processing 2026-10-15 (kept: records point at it)
  // The owner's decision of 2026-10-14: a visit recording is turned into text by Tencent Cloud's speech recognition (in
  // Singapore; lib/asr/tencent.ts), and the model writes Ripple's summary of what was said while he records and when the
  // visit ends (lib/visit/ripple-summary.ts). The list of what his yes sends to DeepSeek names the summary under the visit
  // transcript; the transcription is said as a fact in a paragraph of its own, because it does not wait for this yes
  // (without it there is no visit record), and the paragraph about saying no names the summary among what he then does
  // without. In the owner's professional words of 10-14 (就诊, 服药, 药品标签 where the label is named as a source; the
  // photo he takes is still of his 药袋). The 2026-10-10 entries above stay exactly as they are: records point at them.
  // His decision stands across versions (lib/safety/consent.ts reads the latest decision, whatever its version): nothing
  // asks him again.
  {
    kind: "ai_processing",
    version: "2026-10-15",
    locale: "zh-Hans",
    title: "要不要让 AI 帮忙？",
    paragraphs: [
      "你同意以后，下面这些内容会发给 DeepSeek 的模型处理，处理在中国：",
      "· 你问的话，和要引用的医生原话、药品标签原文",
      "· 就诊的逐字稿，用来找出医生交代的事，并在录音时和就诊结束后写出 Ripple 的总结（几条要点，标明未经确认，不当作医生的原话）",
      "· 药袋的照片，用来读出上面的字",
      "· 要翻译成中文的医生原话",
      "模型只能从这些原话里挑句子、整理要点，不自己说医疗建议。",
      "就诊录音转成文字，由腾讯云的语音识别服务在新加坡完成：录音时一句一句发过去，就诊结束时把录音分段发过去，转出的文字发回 Ripple。这一项不需要你同意 AI 处理，没有它就没有就诊记录。",
      "不同意也照样能用：记录、就诊录音、服药、血压、家人都照常。只是问一句只给固定的回答和原话，就诊后的事项要你自己一件件确认，没有 Ripple 的总结，药袋照片上的字要你自己输入，医生的英文原话不翻译成中文。",
      "以后在「我」里随时能改。",
    ],
    sha256: "7aa0baccdccc0fb227688d2ec50d764a367d95be73bc33668a417b7da8c0c2b0",
  },
  {
    kind: "ai_processing",
    version: "2026-10-15",
    locale: "en",
    title: "Can AI help?",
    paragraphs: [
      "If you agree, these are sent to DeepSeek's model, which processes them in China:",
      "· what you ask, with the doctor's words and the label text it may quote",
      "· visit transcripts, to find what the doctor asked you to do, and to write Ripple's summary while you record and when the visit ends (a few short points, marked as not confirmed, never taken as the doctor's words)",
      "· photos of medicine labels, to read the words on them",
      "· the doctor's words that are translated into Chinese",
      "The model only picks sentences from those original words and sums up what was said; it never gives medical advice of its own.",
      "Visit recordings are turned into text by Tencent Cloud's speech recognition service, in Singapore: while you record, each stretch of speech is sent as you finish it, and when the visit ends the recording is sent in pieces; the text comes back to Ripple. This does not need your agreement to AI processing: without it there is no visit record.",
      "If you say no, Ripple still works: records, visit recordings, doses, blood pressure and family work as usual. Asking gives fixed answers and original words only, you confirm the points from a visit one by one, there is no Ripple summary, you type the label text yourself, and the doctor's English is not translated.",
      "You can change this any time under Me.",
    ],
    sha256: "df3055d446a97e7e6d4e2aa0522a1e0fdee0ed6e4d8df61fb83e05db1a591a55",
  },
  // ---------------------------------------------------------------- ai_processing 2026-10-16 (kept: records point at it)
  // The owner's decision of 2026-10-16: 「模型本身用混元。把 DeepSeek 直接去掉。」 Every model call goes to Tencent Cloud's
  // Hunyuan on TokenHub's international Singapore site (lib/llm/hunyuan.ts). What changed from 2026-10-15, and why:
  //   - the first paragraph names Hunyuan where it named DeepSeek and no longer gives a place;
  //   - a new paragraph after the list says where and how long, in what Tencent's own pages say and nothing more: the API
  //     page gives the Singapore site's "resource scheduling scope" as "Global"
  //     (https://www.tencentcloud.com/document/product/1300/78941), and the Data Processing and Security Protocol
  //     (https://www.tencentcloud.com/document/product/1300/78953) says computing resources come "from different
  //     countries/regions based on resource availability" and that content is generally kept "for up to 30 days" unless
  //     Zero Data Retention is switched on (it is not, as far as this code knows). Nothing says Singapore, so the text
  //     does not either;
  //   - the label-photo line is gone from the list: no Hunyuan model on the account reads images (10-16, lib/llm/hunyuan.ts
  //     HUNYUAN_VISION_MODEL), so a photo goes to no model; the paragraph about saying no is unchanged (he still types a
  //     label's words himself then).
  // Every other paragraph is the 2026-10-15 one word for word. A deployment on another TokenHub site, or one with a model
  // that reads label photos, needs a new version of this text first. The older entries above stay exactly as they are:
  // records point at them.
  // What this means for an account that already decided: his decision stands across versions (lib/safety/consent.ts
  // reads the latest decision, whatever its version), and there is no flow that asks again for ai_processing
  // (lib/care/reconsent.ts is the family texts' only). So an account that said yes to the DeepSeek text has his words
  // sent to Hunyuan without having seen this one; an account that said no stays off; a new account sees this text.
  {
    kind: "ai_processing",
    version: "2026-10-16",
    locale: "zh-Hans",
    title: "要不要让 AI 帮忙？",
    paragraphs: [
      "你同意以后，下面这些内容会发给腾讯云的混元模型处理：",
      "· 你问的话，和要引用的医生原话、药品标签原文",
      "· 就诊的逐字稿，用来找出医生交代的事，并在录音时和就诊结束后写出 Ripple 的总结（几条要点，标明未经确认，不当作医生的原话）",
      "· 要翻译成中文的医生原话",
      "腾讯云写明：处理用的算力按可用情况来自不同的国家或地区，所以不一定在新加坡处理；这些内容一般最多保留 30 天。",
      "模型只能从这些原话里挑句子、整理要点，不自己说医疗建议。",
      "就诊录音转成文字，由腾讯云的语音识别服务在新加坡完成：录音时一句一句发过去，就诊结束时把录音分段发过去，转出的文字发回 Ripple。这一项不需要你同意 AI 处理，没有它就没有就诊记录。",
      "不同意也照样能用：记录、就诊录音、服药、血压、家人都照常。只是问一句只给固定的回答和原话，就诊后的事项要你自己一件件确认，没有 Ripple 的总结，药袋照片上的字要你自己输入，医生的英文原话不翻译成中文。",
      "以后在「我」里随时能改。",
    ],
    sha256: "bdf8d552d8d70c195b9c53a8a80410320f3342ef2448e4ed71739f4920434bb4",
  },
  {
    kind: "ai_processing",
    version: "2026-10-16",
    locale: "en",
    title: "Can AI help?",
    paragraphs: [
      "If you agree, these are sent to Tencent Cloud's Hunyuan model to be processed:",
      "· what you ask, with the doctor's words and the label text it may quote",
      "· visit transcripts, to find what the doctor asked you to do, and to write Ripple's summary while you record and when the visit ends (a few short points, marked as not confirmed, never taken as the doctor's words)",
      "· the doctor's words that are translated into Chinese",
      "Tencent Cloud says the computing resources it uses come from different countries or regions, depending on availability, so they are not necessarily processed in Singapore; it generally keeps them for up to 30 days.",
      "The model only picks sentences from those original words and sums up what was said; it never gives medical advice of its own.",
      "Visit recordings are turned into text by Tencent Cloud's speech recognition service, in Singapore: while you record, each stretch of speech is sent as you finish it, and when the visit ends the recording is sent in pieces; the text comes back to Ripple. This does not need your agreement to AI processing: without it there is no visit record.",
      "If you say no, Ripple still works: records, visit recordings, doses, blood pressure and family work as usual. Asking gives fixed answers and original words only, you confirm the points from a visit one by one, there is no Ripple summary, you type the label text yourself, and the doctor's English is not translated.",
      "You can change this any time under Me.",
    ],
    sha256: "e3181994e683126561fec73870596321503a3a5c8ecac6324edc1f47f84019a9",
  },
  // ---------------------------------------------------------------- ai_processing 2026-10-16.2 (in force)
  // The owner's decision of 2026-10-16, later the same day: label photos are read by Tencent Cloud OCR (lib/vision/ocr.ts:
  // GeneralAccurateOCR and GeneralBasicOCR on the international site, region ap-singapore; the Data Processing and
  // Security Agreement, https://www.tencentcloud.com/document/product/301/17347 5.1, processes personal data in the service
  // region). The photo is still read only after this yes (lib/meds/write.ts readLabel: aiConsent first). What changed from
  // 2026-10-16: one paragraph, after the one on what the model does: who reads the photo, where, that no Hunyuan model sees
  // it, what Tencent's OCR module says about keeping it (its "Category C" module,
  // https://www.tencentcloud.com/document/product/301/69464: images kept "for as long as it is necessary for the
  // fulfilment of the purpose(s)", no number of days, so none is given here), and what Ripple keeps (the fields he
  // confirms or corrects go onto his medicine, the photo stays in the private labels bucket; the transcription is never
  // stored: lib/meds/write.ts sends only the fields in the read token and the event). Every other paragraph is the
  // 2026-10-16 one word for word; that version stays published as it was (records point at it). His decision stands
  // across versions, as before.
  {
    kind: "ai_processing",
    version: "2026-10-16.2",
    locale: "zh-Hans",
    title: "要不要让 AI 帮忙？",
    paragraphs: [
      "你同意以后，下面这些内容会发给腾讯云的混元模型处理：",
      "· 你问的话，和要引用的医生原话、药品标签原文",
      "· 就诊的逐字稿，用来找出医生交代的事，并在录音时和就诊结束后写出 Ripple 的总结（几条要点，标明未经确认，不当作医生的原话）",
      "· 要翻译成中文的医生原话",
      "腾讯云写明：处理用的算力按可用情况来自不同的国家或地区，所以不一定在新加坡处理；这些内容一般最多保留 30 天。",
      "模型只能从这些原话里挑句子、整理要点，不自己说医疗建议。",
      "药袋的照片：你同意以后，由腾讯云的文字识别服务（OCR）在新加坡读出上面的字，照片不交给混元模型。照片发过去，读出的字发回 Ripple；腾讯云写明，这些照片只为提供这项服务而保留，保留到用完为止，没有写具体天数。Ripple 不存读出的整段文字，只把药名、规格、用法、配药日期和诊所拿给你一项项核对，存下的是你确认或改过的内容；照片存在只有服务器能打开的私有空间里。",
      "就诊录音转成文字，由腾讯云的语音识别服务在新加坡完成：录音时一句一句发过去，就诊结束时把录音分段发过去，转出的文字发回 Ripple。这一项不需要你同意 AI 处理，没有它就没有就诊记录。",
      "不同意也照样能用：记录、就诊录音、服药、血压、家人都照常。只是问一句只给固定的回答和原话，就诊后的事项要你自己一件件确认，没有 Ripple 的总结，药袋照片上的字要你自己输入，医生的英文原话不翻译成中文。",
      "以后在「我」里随时能改。",
    ],
    sha256: "52cd02f88f68c4754a2482ada99caa11b865e75d37fced14f465a39db6984318",
  },
  {
    kind: "ai_processing",
    version: "2026-10-16.2",
    locale: "en",
    title: "Can AI help?",
    paragraphs: [
      "If you agree, these are sent to Tencent Cloud's Hunyuan model to be processed:",
      "· what you ask, with the doctor's words and the label text it may quote",
      "· visit transcripts, to find what the doctor asked you to do, and to write Ripple's summary while you record and when the visit ends (a few short points, marked as not confirmed, never taken as the doctor's words)",
      "· the doctor's words that are translated into Chinese",
      "Tencent Cloud says the computing resources it uses come from different countries or regions, depending on availability, so they are not necessarily processed in Singapore; it generally keeps them for up to 30 days.",
      "The model only picks sentences from those original words and sums up what was said; it never gives medical advice of its own.",
      "Photos of medicine labels: once you agree, the words on them are read by Tencent Cloud's text recognition service (OCR), in Singapore; the photo goes to no Hunyuan model. The photo is sent and the words come back to Ripple; Tencent Cloud says it keeps such images only as long as it needs them for the service, without giving a number of days. Ripple does not keep the whole text it reads: it shows you the medicine, strength, directions, dispensing date and clinic to check one by one, and saves what you confirm or correct. The photo is kept in private storage that only the server can open.",
      "Visit recordings are turned into text by Tencent Cloud's speech recognition service, in Singapore: while you record, each stretch of speech is sent as you finish it, and when the visit ends the recording is sent in pieces; the text comes back to Ripple. This does not need your agreement to AI processing: without it there is no visit record.",
      "If you say no, Ripple still works: records, visit recordings, doses, blood pressure and family work as usual. Asking gives fixed answers and original words only, you confirm the points from a visit one by one, there is no Ripple summary, you type the label text yourself, and the doctor's English is not translated.",
      "You can change this any time under Me.",
    ],
    sha256: "899410fe8339f04d535c9fc413d06965010ae01794400f992d8ce029fe4f489a",
  },
];

/** Every published consent text (all versions, both locales). */
export const CONSENT_TEXTS: readonly ConsentText[] = DRAFTS.map((d) => ({ ...d, text: consentBody(d.title, d.paragraphs) }));

/** One published text, or null (an unknown version). */
export function consentText(kind: ConsentKind, version: string, locale: ConsentLocale): ConsentText | null {
  return CONSENT_TEXTS.find((t) => t.kind === kind && t.version === version && t.locale === locale) ?? null;
}

/** The text a sign-up screen shows now. */
export function currentConsentText(kind: SignupConsentKind, locale: ConsentLocale): ConsentText {
  const t = consentText(kind, CURRENT_CONSENT_VERSIONS[kind], locale);
  if (!t) throw new Error(`no ${kind} text ${CURRENT_CONSENT_VERSIONS[kind]} in ${locale}`);
  return t;
}
