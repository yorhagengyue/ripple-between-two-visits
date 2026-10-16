/**
 * The words of /privacy (隐私说明 / Privacy notice; docs/plan/real-app.md 3.11 告知 「写清：收集什么、为什么、存在哪、保留多久、
 * 谁能看、怎么导出和删除」; hosting.md 5.14 for the backups; C2 track H). Fixed text, never a model's, in step with the
 * sign-up texts (lib/privacy/consent-texts.ts: Tokyo, Singapore, 90 days, Tencent Cloud's Hunyuan since 10-16 where
 * Tencent's pages say, 7 and about 21 days).
 * The data protection officer's name comes from consent-texts.ts (a placeholder until the owner names one). Pure.
 */
import { AUDIO_KEEP_DAYS, BUS_EVENT_KEEP_DAYS, EXAMPLE_IDLE_DAYS, EXPORT_LIMIT_PER_DAY, ORPHAN_GRACE_DAYS, SAFETY_EVENT_KEEP_DAYS } from "./rules";

export type NoticeLocale = "zh-Hans" | "en";

export interface NoticeSection {
  id: string;
  heading: string;
  paragraphs?: string[];
  items?: string[];
  /** term, then what it means (a definition list: narrow screens never scroll sideways) */
  terms?: [string, string][];
}

export interface Notice {
  title: string;
  updated: string;
  intro: string;
  home: string;
  otherLanguage: string;
  sections: NoticeSection[];
  officerHeading: string;
  officerLine: string;
  /** the consent texts as published (track A's sign-up texts, track D's family texts) */
  consentsHeading: string;
  consentsIntro: string;
  versionLine: (version: string) => string;
  hashLabel: string;
  /** the heading over the one consent text that has no title of its own: the sentence his card shows the doctor */
  visitCardTitle: string;
}

/**
 * The version of these words (change it with the words). ".2" (10-10, later the same day): family members see the time
 * of his morning reminder whatever the six switches say (real-app section 10: 「提醒时间不受六个开关管……写进隐私说明」); the
 * links are 10 minutes; event history 7 days; unsaved uploads 2 days; her reminders stay with him; operators' looks are
 * in his export.
 * "2026-10-11" (line bind): family members are linked by typing an account (lib/care/bind.ts), and a linked family
 * member sees four items at once; 「谁能看」 says so in the words of the terms (lib/privacy/consent-texts.ts 2026-10-11).
 * "2026-10-14" (the owner's decision of that day: each of the six switches shows its kind in full while it is on): what a
 * linked family member sees at once is named as the kinds themselves (his medicine each day with the reason when he did
 * not take it, his blood pressure readings, the questions he wants to ask his doctor), not as counts of them; again in
 * the words of the terms (lib/privacy/consent-texts.ts 2026-10-14). Before it was published the 华语 also took the
 * owner's other decision of that day, professional words where it said spoken ones (服药, 就诊, 未回应 for 吃药, 看诊,
 * 没回, and 药品标签 where the label is named as a source; the photo he takes is still of his 药袋), in step with the
 * terms; the English is as it was.
 * "2026-10-15" (the owner's decision of 2026-10-14: visit recordings are transcribed by Tencent Cloud's speech
 * recognition, lib/asr/tencent.ts, and the model writes Ripple's summary of a visit, lib/visit/ripple-summary.ts):
 * 「就诊录音的转写」 said "on our own machine, not given to another company", which is no longer so. It now says who
 * transcribes, where, what is sent and what comes back, how long Tencent keeps a result, and that transcription does
 * not wait for his consent to AI processing (without it there is no visit record); 「AI 处理」 names the summary among
 * what the visit transcript is sent for; 「存什么」 and 「留多久」 name the summary. Everything else is the 2026-10-14
 * words. The 2026-10-14 version is kept word for word (NOTICE_VERSIONS): it is what was published until this one.
 * "2026-10-16" (Hunyuan) and "2026-10-16.2" (label photos read by Tencent Cloud OCR, later the same day): at their
 * entries below.
 */
export const NOTICE_VERSION = "2026-10-16.2";

const zh1014: Notice = {
  title: "隐私说明",
  updated: "最后更新：2026年10月14日",
  intro: "这一页说清楚：Ripple 存你的哪些资料、为什么存、存在哪、留多久、谁能看，以及你怎么导出和删除。",
  home: "‹ 回到 Ripple",
  otherLanguage: "English",
  sections: [
    {
      id: "what",
      heading: "存什么",
      items: [
        "账号：用户名或邮箱、称呼、语言。密码只在登录服务里，Ripple 看不到。",
        "你记录的：服药情况、血压、待问医生的问题、笔记、你问 Ripple 的话。",
        "就诊：录音、逐字稿、医生交代的事，以及你认过的「谁说的」。",
        "药：药袋的照片和上面的字，你自己输入的药。",
        "你填的资料：年龄、诊所、作息这些。",
        "家人：和你绑定的是谁、给她打开了哪几项、她什么时候看过，还有她录给你的提醒。",
        "同意记录：你同意过什么、哪一版的文字、什么时候。",
      ],
    },
    {
      id: "why",
      heading: "为什么存",
      paragraphs: [
        "为了在两次就诊之间陪你：提醒服药，记录血压，把医生、药剂师、药品标签和官方单张的原话讲给你听，把你的问题带回给医生。",
        "Ripple 不给医疗建议。不拿你的资料去卖，也不拿来做广告。",
      ],
    },
    {
      id: "where",
      heading: "存在哪",
      terms: [
        ["数据库和文件", "Supabase，在日本东京。录音和照片放在只有服务器能打开的私有空间里，要听要看时才发一个 10 分钟内有效的链接。"],
        ["Ripple 的服务器", "在新加坡。"],
        ["AI 处理", "只在你同意以后：你问的话、就诊的逐字稿、药袋的照片、要翻译的医生原话，交给 DeepSeek 的模型处理，处理在中国。不同意就不发。在「我」→「AI 处理」随时能改。"],
        ["就诊录音的转写", "在我们自己的机器上做，不交给别的公司。"],
      ],
      paragraphs: ["所以你的资料会离开新加坡：数据库在日本；同意 AI 处理以后，要处理的那一部分会到中国。"],
    },
    {
      id: "how-long",
      heading: "留多久",
      terms: [
        ["就诊录音和每句的片段", `就诊那天起留 ${AUDIO_KEEP_DAYS} 天，到期自动删掉；你选了「一直保留」的不删。删的时候，逐字稿和医生交代的事留着。`],
        ["逐字稿、医生交代的事、服药记录、血压、笔记、问题、你的资料、家人看过的记录、同意记录", "一直留着，直到你删除账号。"],
        ["提问的检查记录（里面有你问的原话）", `${SAFETY_EVENT_KEEP_DAYS} 天，只用来排查故障和计数。`],
        ["家人录给你的提醒", "跟着你的账号留着。她删除自己的账号以后，录音还在你这里，只留她的称呼。"],
        ["让你的手机和家人的页面保持同步的事件记录", `每个人最多 200 条，最长 ${BUS_EVENT_KEEP_DAYS} 天。`],
        ["上传了但没有存进记录的文件（比如拍了没确认的药袋照片）", `满 ${ORPHAN_GRACE_DAYS} 天以后自动删除。`],
        ["示例账号", `${EXAMPLE_IDLE_DAYS} 天不用，自动删除（拍摄用的账号除外）。`],
        ["导出的文件", "不留在服务器上：做好就直接给你的手机。文件里录音和照片的下载链接 24 小时内有效。"],
        ["删除账号以后", "数据库和存储里的资料马上删掉；Supabase 自带的备份最长 7 天、我们自己的加密备份最长约 21 天以后自然消失。"],
      ],
    },
    {
      id: "who",
      heading: "谁能看",
      items: [
        "你自己。",
        "和你绑定的家人。你填了家人的账号，或者家人填了你的账号，就绑定了：家人马上能看到每日服药情况（药物名称、服药时间、未服药的原因）、血压读数、待问医生的问题，两次提醒均未回应时会收到通知；就诊录音和你的笔记要你自己打开。每一项你都可以随时关掉，也可以解除绑定。用邀请链接请来的家人，要你确认是她以后才看得到，每一项一开始都是关着的。她每看一次，你都能在「我的数据」里看到。",
        "有一样不归这六个开关管：早上提醒的时间。和你绑定的家人可以给你录一段提醒（家人自己填你的账号绑上的，要等你点过「知道了」），所以不管开关怎么设，她都看得到你早上第一次提醒在几点（比如 8:45），和现在给你放的是哪一段提醒录音。你停止分享以后，这些她也看不到了。",
        "运维人员：只在排查故障时看，每次都留下记录：谁、什么时候、为什么。这些记录在你导出的文件里看得到。",
        "我们不把你的资料交给别人。",
      ],
    },
    {
      id: "your-choices",
      heading: "你能做什么",
      items: [
        `导出：「我」→「我的数据」→「导出我的资料」，一天最多 ${EXPORT_LIMIT_PER_DAY} 次。`,
        "就诊录音：「我」→「我的数据」→「就诊录音留多久」，每次就诊都能选「一直保留」。",
        "AI 处理：「我」→「AI 处理」，随时开关。",
        "删除账号：「我」→「删除账号」，要输入密码，删了不能恢复。",
      ],
    },
    {
      id: "logs",
      heading: "日志",
      paragraphs: ["服务器的日志只记哪个页面、成没成、用了多久、出错的代码，用户只记一串打乱的编号；不记你说的话、问的话和医生的原话。"],
    },
  ],
  officerHeading: "数据保护负责人",
  officerLine: "关于你的资料，找：",
  consentsHeading: "你同意过的文字",
  consentsIntro: "注册、选 AI 处理、用示例资料、就诊前请医生同意录音、选一直保留录音、邀请和接受家人、让家人帮你重设密码时，屏上给你看的就是下面这几段。你同意的时候，我们记下是哪一版、这段文字的指纹（sha256），所以以后能对得上。改了文字就是新的一版，旧的一版不会变。",
  versionLine: (version: string) => `版本 ${version}`,
  hashLabel: "核对用的指纹（sha256）",
  visitCardTitle: "就诊前给医生看的那一句（英文）",
};

const en1014: Notice = {
  title: "Privacy notice",
  updated: "Last updated: 14 October 2026",
  intro: "This page says what Ripple keeps about you, why, where, for how long, who can see it, and how you export and delete it.",
  home: "‹ Back to Ripple",
  otherLanguage: "中文",
  sections: [
    {
      id: "what",
      heading: "What we keep",
      items: [
        "Your account: your username or e-mail address, the name we call you, your language. Your password stays with the sign-in service; Ripple never sees it.",
        "What you record: doses, blood pressure readings, questions for your doctor, notes, what you ask Ripple.",
        "Visits: recordings, transcripts, what the doctor asked you to do, and who said what as you confirmed it.",
        "Medicines: photos of labels and the words on them, medicines you typed in yourself.",
        "The details you enter: your age, clinic, daily routine and so on.",
        "Family: who is linked to you, which items are switched on for them, when they looked, and the reminders they recorded for you.",
        "Consents: what you agreed to, which version of the words, and when.",
      ],
    },
    {
      id: "why",
      heading: "Why",
      paragraphs: [
        "To keep you company between visits: reminders for your medicine, your blood pressure record, the original words of your doctor, pharmacist, label and official leaflets, and your questions taken back to your doctor.",
        "Ripple gives no medical advice. Your data is never sold and never used for advertising.",
      ],
    },
    {
      id: "where",
      heading: "Where",
      terms: [
        ["Database and files", "Supabase, in Tokyo, Japan. Recordings and photos are in private storage that only the server can open; a link that works for 10 minutes is made when you play or view one."],
        ["Ripple's server", "In Singapore."],
        ["AI processing", "Only after you agree: what you ask, visit transcripts, label photos and the doctor's words to be translated go to DeepSeek's model, which processes them in China. If you say no, nothing is sent. Change it any time under Me → AI processing."],
        ["Transcribing visit recordings", "Done on our own machine, not by another company."],
      ],
      paragraphs: ["So your data leaves Singapore: the database is in Japan, and once you agree to AI processing, the parts it works on go to China."],
    },
    {
      id: "how-long",
      heading: "How long",
      terms: [
        ["Visit recordings and each sentence's clip", `${AUDIO_KEEP_DAYS} days from the visit, then deleted by themselves, unless you chose to keep one for good. The transcript and what the doctor asked you to do stay.`],
        ["Transcripts, what the doctor asked you to do, doses, blood pressure, notes, questions, your details, your family's views, consents", "Until you delete your account."],
        ["The checks behind each answer (they hold your own question)", `${SAFETY_EVENT_KEEP_DAYS} days, only to look into faults and to count.`],
        ["Reminders a family member recorded for you", "Kept with your account. If they delete their own account, the recordings stay with you, with only the name you know them by."],
        ["The event history that keeps your phone and your family's page in step", `At most 200 events per person, none older than ${BUS_EVENT_KEEP_DAYS} days.`],
        ["Files that were uploaded but never saved into a record (a label photo you did not confirm, for example)", `Deleted by themselves once they are ${ORPHAN_GRACE_DAYS} days old.`],
        ["Example accounts", `Deleted after ${EXAMPLE_IDLE_DAYS} days without use (filming accounts excepted).`],
        ["Exported files", "Not kept on the server: made and handed straight to your phone. The recording and photo links in the file work for 24 hours."],
        ["After you delete your account", "Your data leaves the database and storage at once; Supabase's own backups expire within 7 days and our encrypted backups within about 21 days."],
      ],
    },
    {
      id: "who",
      heading: "Who can see it",
      items: [
        "You.",
        "Family members linked to you. When you enter a family member's account, or they enter yours, you are linked: they can at once see your medicine each day (which medicine, when, and the reason when you did not take it), your blood pressure readings and the questions you want to ask your doctor, and they are told when two reminders go unanswered; visit recordings and your notes stay closed until you open them. You can switch any item off or remove the link at any time. A family member you invited with a link sees something only after you confirm it is them, and every item starts switched off. Every time they look, it shows under My data.",
        "One thing is not governed by the six switches: the time of your morning reminder. A family member linked to you can record a reminder for you (one who linked by entering your account can do so once you have tapped “Got it”), so whatever the switches say, they can see what time your first morning reminder comes (8:45, for example) and which reminder recording plays for you now. Once you stop sharing, they can no longer see these either.",
        "The people who run the service, only when fixing a fault, and every look is logged: who, when and why. These log entries are in the file you export.",
        "We do not give your data to anyone else.",
      ],
    },
    {
      id: "your-choices",
      heading: "What you can do",
      items: [
        `Export: Me → My data → Export my data, up to ${EXPORT_LIMIT_PER_DAY} times a day.`,
        "Visit recordings: Me → My data → How long visit recordings are kept; you can keep any visit's recording for good.",
        "AI processing: Me → AI processing, on or off any time.",
        "Delete your account: Me → Delete my account, with your password; it cannot be undone.",
      ],
    },
    {
      id: "logs",
      heading: "Logs",
      paragraphs: [
        "The server's logs keep only which page, whether it worked, how long it took and an error code, with a scrambled number for the user; never what you said or asked, and never the doctor's words.",
      ],
    },
  ],
  officerHeading: "Data protection officer",
  officerLine: "For anything about your data, contact:",
  consentsHeading: "The texts you agree to",
  consentsIntro: "When you sign up, choose about AI processing, use the example data, ask your doctor before a visit is recorded, keep a recording for good, invite or accept a family member, or let a family member help you reset your password, these are the words on the screen. When you agree, we record which version and the fingerprint (sha256) of exactly these words, so they can always be matched. A changed text is a new version; an old version never changes.",
  versionLine: (version: string) => `Version ${version}`,
  hashLabel: "Fingerprint for checking (sha256)",
  visitCardTitle: "The sentence your doctor reads before a visit is recorded",
};

/** One section of a version, the others as they are. */
function withSections(base: Notice, updated: string, changed: Record<string, Partial<NoticeSection>>): Notice {
  return { ...base, updated, sections: base.sections.map((s) => (changed[s.id] ? { ...s, ...changed[s.id] } : s)) };
}

const section = (n: Notice, id: string): NoticeSection => n.sections.find((s) => s.id === id)!;

/** 2026-10-15: Tencent Cloud transcribes the visit recordings; the model writes Ripple's summary. */
const zh1015: Notice = withSections(zh1014, "最后更新：2026年10月15日", {
  what: {
    items: section(zh1014, "what").items!.map((item) =>
      item.startsWith("就诊：") ? "就诊：录音、逐字稿、医生交代的事、Ripple 根据录音整理的总结（未经确认），以及你认过的「谁说的」。" : item,
    ),
  },
  where: {
    terms: section(zh1014, "where").terms!.map(([term, value]): [string, string] =>
      term === "AI 处理"
        ? [term, "只在你同意以后：你问的话、就诊的逐字稿（用来找出医生交代的事，并在录音时和就诊结束后写出 Ripple 的总结）、药袋的照片、要翻译的医生原话，交给 DeepSeek 的模型处理，处理在中国。不同意就不发，也没有 Ripple 的总结。在「我」→「AI 处理」随时能改。"]
        : term === "就诊录音的转写"
          ? [
              term,
              "交给腾讯云的语音识别服务做，在新加坡。录音的时候，每说完一句（以停顿为界）就把这一句的录音发过去，转成字幕；就诊结束时，把存好的录音分成每段不超过 100 秒发过去，转成就诊记录。转出的文字发回 Ripple，腾讯云把每一段的转写结果保留 24 小时。转写不需要你同意 AI 处理：没有它就没有就诊记录。",
            ]
          : [term, value],
    ),
  },
  "how-long": {
    terms: section(zh1014, "how-long").terms!.map(([term, value]) =>
      term.startsWith("逐字稿、医生交代的事、") ? ([term.replace("逐字稿、医生交代的事、", "逐字稿、医生交代的事、Ripple 的就诊总结、"), value] as [string, string]) : [term, value],
    ),
  },
});

const en1015: Notice = withSections(en1014, "Last updated: 15 October 2026", {
  what: {
    items: section(en1014, "what").items!.map((item) =>
      item.startsWith("Visits:") ? "Visits: recordings, transcripts, what the doctor asked you to do, Ripple's summary of what was said (not confirmed), and who said what as you confirmed it." : item,
    ),
  },
  where: {
    terms: section(en1014, "where").terms!.map(([term, value]): [string, string] =>
      term === "AI processing"
        ? [
            term,
            "Only after you agree: what you ask, visit transcripts (to find what the doctor asked you to do, and to write Ripple's summary while you record and when the visit ends), label photos and the doctor's words to be translated go to DeepSeek's model, which processes them in China. If you say no, nothing is sent, and there is no summary. Change it any time under Me → AI processing.",
          ]
        : term === "Transcribing visit recordings"
          ? [
              term,
              "Done by Tencent Cloud's speech recognition service, in Singapore. While you record, each stretch of speech is sent as you finish it (a pause ends it) and comes back as a caption; when the visit ends, the saved recording is sent in pieces of up to 100 seconds and comes back as the visit's record. The text comes back to Ripple; Tencent Cloud keeps each piece's result for 24 hours. Transcribing does not need your agreement to AI processing: without it there is no visit record.",
            ]
          : [term, value],
    ),
  },
  "how-long": {
    terms: section(en1014, "how-long").terms!.map(([term, value]) =>
      term.startsWith("Transcripts, what the doctor asked you to do, ") ? ([term.replace("Transcripts, what the doctor asked you to do, ", "Transcripts, what the doctor asked you to do, Ripple's visit summaries, "), value] as [string, string]) : [term, value],
    ),
  },
});

/**
 * 2026-10-16 (in force): the model is Tencent Cloud's Hunyuan, no longer DeepSeek (the owner: 「模型本身用混元。把 DeepSeek 直接
 * 去掉。」), on TokenHub's international Singapore site. The AI processing line names Hunyuan, says where and how long in
 * Tencent's own words (computing resources in different countries or regions as available, so not necessarily
 * Singapore; generally kept up to 30 days) and no longer lists label photos (no Hunyuan model reads images); the
 * paragraph under 「存在哪」 says so too. The ai_processing consent text of the same day gives the pages. Everything else is
 * the 2026-10-15 text.
 */
const zh1016: Notice = withSections(zh1015, "最后更新：2026年10月16日", {
  where: {
    terms: section(zh1015, "where").terms!.map(([term, value]): [string, string] =>
      term === "AI 处理"
        ? [term, "只在你同意以后：你问的话、就诊的逐字稿（用来找出医生交代的事，并在录音时和就诊结束后写出 Ripple 的总结）、要翻译的医生原话，交给腾讯云的混元模型处理。腾讯云写明，处理用的算力按可用情况来自不同的国家或地区，所以不一定在新加坡；一般最多保留 30 天。药袋的照片不交给模型。不同意就不发，也没有 Ripple 的总结。在「我」→「AI 处理」随时能改。"]
        : [term, value],
    ),
    paragraphs: ["所以你的资料会离开新加坡：数据库在日本；同意 AI 处理以后，要处理的那一部分可能在别的国家或地区处理。"],
  },
});

const en1016: Notice = withSections(en1015, "Last updated: 16 October 2026", {
  where: {
    terms: section(en1015, "where").terms!.map(([term, value]): [string, string] =>
      term === "AI processing"
        ? [
            term,
            "Only after you agree: what you ask, visit transcripts (to find what the doctor asked you to do, and to write Ripple's summary while you record and when the visit ends) and the doctor's words to be translated go to Tencent Cloud's Hunyuan model. Tencent Cloud says the computing resources it uses come from different countries or regions, depending on availability, so not necessarily Singapore, and it generally keeps them for up to 30 days. Label photos are not sent to the model. If you say no, nothing is sent, and there is no summary. Change it any time under Me → AI processing.",
          ]
        : [term, value],
    ),
    paragraphs: ["So your data leaves Singapore: the database is in Japan, and once you agree to AI processing, the parts it works on may be processed in other countries or regions."],
  },
});

/**
 * 2026-10-16.2 (in force; the owner's decision later on 16 October): label photos are read by Tencent Cloud OCR in
 * Singapore (lib/vision/ocr.ts), still only after his yes to AI processing. 「存在哪」 gets one more line after the AI
 * processing one (which already says label photos go to no model, and stays as it was): who reads the photo, where, what
 * Tencent's OCR module says about keeping it (no number of days: none is given), what Ripple keeps (the fields he confirms
 * or corrects; never the whole transcription; the photo in the private storage, an unconfirmed one deleted as 「留多久」
 * says) and what a no means. The ai_processing consent text of the same version gives the pages. Everything else is the
 * 2026-10-16 text.
 */
const OCR_TERM = { "zh-Hans": "药袋照片的文字识别", en: "Reading label photos" } as const;

const withOcrTerm = (base: Notice, aiTerm: string, term: string, value: string): Notice =>
  withSections(base, base.updated, {
    where: { terms: section(base, "where").terms!.flatMap(([t, v]): [string, string][] => (t === aiTerm ? [[t, v], [term, value]] : [[t, v]])) },
  });

const zh10162: Notice = withOcrTerm(zh1016, "AI 处理", OCR_TERM["zh-Hans"], "只在你同意 AI 处理以后：照片交给腾讯云的文字识别服务（OCR），在新加坡读出上面的字，读出的字发回 Ripple；照片不交给混元模型。腾讯云写明，这些照片只为提供这项服务而保留，保留到用完为止，没有写具体天数。Ripple 不存读出的整段文字：药名、规格、用法、配药日期和诊所拿给你一项项核对，存下的是你确认或改过的内容；照片存在上面说的私有空间里，拍了没确认的照片按「留多久」里写的删掉。不同意就不读照片，药品标签上的字由你自己输入。");

const en10162: Notice = withOcrTerm(en1016, "AI processing", OCR_TERM.en, "Only after you agree to AI processing: the photo goes to Tencent Cloud's text recognition service (OCR), in Singapore, which reads the words on it; the words come back to Ripple. The photo goes to no Hunyuan model. Tencent Cloud says it keeps such images only as long as it needs them for the service, without giving a number of days. Ripple does not keep the whole text it reads: the medicine, strength, directions, dispensing date and clinic are shown to you to check one by one, and what you confirm or correct is saved; the photo is kept in the private storage above, and a photo you never confirm is deleted as How long says. If you say no, no photo is read and you type the label's words yourself.");

/** Every published version of these words, both languages: the one in force is NOTICE_VERSION; the older ones word for word. */
export const NOTICE_VERSIONS: Readonly<Record<string, { "zh-Hans": Notice; en: Notice }>> = {
  "2026-10-14": { "zh-Hans": zh1014, en: en1014 },
  "2026-10-15": { "zh-Hans": zh1015, en: en1015 },
  "2026-10-16": { "zh-Hans": zh1016, en: en1016 },
  "2026-10-16.2": { "zh-Hans": zh10162, en: en10162 },
};

export function privacyNotice(locale: NoticeLocale, version: string = NOTICE_VERSION): Notice {
  const v = NOTICE_VERSIONS[version] ?? NOTICE_VERSIONS[NOTICE_VERSION];
  return locale === "en" ? v.en : v["zh-Hans"];
}
