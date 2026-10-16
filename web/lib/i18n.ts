/**
 * Tiny dictionary i18n for zh-Hans and en. No library.
 *
 *   import { t } from "@/lib/i18n";
 *   t("zh-Hans", "nav.meds")              // "我的药"
 *   t("en", "common.dayN", { n: 29 })     // "Day 29"
 *
 * Every page defaults to en (the owner, 10-15: 「每次登录都默认英文，除非用户自己修改」: a person's own language comes back
 * from the rp_lang cookie his sign-in writes from his account, or from 「我 › 语言」); judge, backstage and director pages too.
 * Add keys to `en` first: `zhHans` is typed against it, so a missing translation fails typecheck.
 * UI chrome only. Clinical sentences never come from here (they come from lib/safety templates,
 * kb/patient_text.json, or the speaker's own words; see .codebuddy/rules/never-cross).
 * Safe to import from client components.
 */

export const LOCALES = ["zh-Hans", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_PATIENT_LOCALE: Locale = "en";
export const DEFAULT_STAFF_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "rp_lang";

const en = {
  "app.name": "Ripple",
  "app.tagline": "Keeps what your doctor said, and what you want to ask next time.",

  "nav.today": "Today",
  "nav.visit": "Visit",
  "nav.meds": "My medicines",
  "nav.bp": "Blood pressure",
  "nav.questions": "Questions",
  "nav.brief": "Visit brief",
  "nav.family": "Family",
  "nav.backstage": "Backstage",
  "nav.director": "Director",
  "nav.try": "Try it",
  "nav.eval": "Evaluation",
  "nav.how": "How it works",

  // bottom tab bar on the phone: five columns at 18px, so the English labels are short
  "tab.today": "Today",
  "tab.visit": "Visit",
  "tab.meds": "Meds",
  "tab.bp": "BP",
  "tab.questions": "To ask",

  "role.patient": "Mr Tan",
  "role.family": "Wei Ling (daughter)",
  "role.backstage": "Backstage",
  "role.director": "Director",
  "role.judge": "Judge",

  "source.doctor": "Doctor said",
  "source.dispenser": "Clinic counter said",
  "source.pharmacist": "Pharmacist said",
  "source.label": "Medicine label",
  "source.leaflet": "Leaflet",
  "source.self": "You said",
  "source.family": "Wei Ling said",

  "dose.taken": "Taken",
  "dose.missed": "Not taken",
  "dose.later": "Later",
  "dose.unconfirmed": "Not confirmed",

  "common.dayN": "Day {n}",
  "common.loading": "Loading…",
  "common.retry": "Try again",
  "common.back": "Back",
  "common.close": "Close",
  "common.confirm": "Confirm",
  "common.cancel": "Cancel",
  "common.switchLanguage": "中文",
  "common.offline": "Reconnecting…",

  // ---- M0 shells (session, today card, reminder, jump menu)
  "live.connecting": "Connecting…",
  "live.open": "Live",
  "live.closed": "Disconnected",
  "debug.session": "Session {code}",
  "debug.role": "as {role}",
  "jump.title": "Jump",
  "jump.pages": "Pages",
  "jump.days": "Story day",
  "jump.join": "Join another session",
  "jump.reset": "Reset this session",
  "today.title": "Today",
  "today.medsKicker": "This morning's medicine",
  "today.doseQuestion": "Did you take this morning's medicine?",
  "today.noDoseDue": "No medicine to check today.",
  "today.openQuestions": "{n} questions waiting for your next visit",
  "dose.recorded": "Recorded: {state}",
  "dose.notYet": "Not recorded yet",
  "med.awaitingLabel": "Waiting for the label",
  "reminder.tag": "Reminder",
  "reminder.close": "Close",
  "reminder.noDose": "No medicine is due right now.",
  "noSession.title": "Not in a session yet",
  "noSession.body": "Join the filming session with its code, or start your own sandbox.",
  "noSession.join": "Enter a join code",
  "noSession.sandbox": "Start my own sandbox",
  "noSession.starting": "Preparing your sandbox…",
  "startSession.crewKey": "A filming session needs the film crew's key. Your own sandbox stays as it is.",
  "startSession.crewKeyLink": "Crew sign-in",
  "startSession.failed": "Could not start a session. Try again.",
  "join.title": "Join a session",
  "join.code": "Join code",
  "join.role": "This device is",
  "join.submit": "Join",
  "join.notFound": "No session has this code.",
  "join.failed": "Could not join. Try again.",
  "shell.comingIn": "This screen is built in {module}.",
  "page.visitReview": "After-visit review",
  "page.medDetail": "Medicine",
  "page.medAdd": "Photograph a label",
  "family.title": "Dad's updates",
  "family.allowed": "What Dad lets you see",
  "family.doseToday": "This morning's medicine: {state}",
  "family.hidden": "Dad has not turned this on.",
  "grant.dose_summary": "Medicine check-ins",
  "grant.bp_summary": "Blood pressure log",
  "grant.questions_count": "Number of questions",
  "grant.no_reply_alert": "Alert when reminders get no reply",
  "grant.visit_transcripts": "Visit transcripts",
  "grant.notes": "Notes",
  "grant.on": "On",
  "grant.off": "Off",
} as const;

export type MessageKey = keyof typeof en;

const zhHans: Record<MessageKey, string> = {
  "app.name": "Ripple",
  "app.tagline": "记下医生说的话，也记下你下次想问的。",

  "nav.today": "今天",
  "nav.visit": "就诊",
  "nav.meds": "我的药",
  "nav.bp": "血压",
  "nav.questions": "问题单",
  "nav.brief": "就诊简报",
  "nav.family": "家人",
  "nav.backstage": "后台",
  "nav.director": "导演",
  "nav.try": "自己问",
  "nav.eval": "评测",
  "nav.how": "怎么做的",

  "tab.today": "今天",
  "tab.visit": "就诊",
  "tab.meds": "我的药",
  "tab.bp": "血压",
  "tab.questions": "问题单",

  "role.patient": "陈先生",
  "role.family": "女儿 Wei Ling",
  "role.backstage": "后台",
  "role.director": "导演",
  "role.judge": "评委",

  "source.doctor": "医生说",
  "source.dispenser": "柜台说",
  "source.pharmacist": "药剂师说",
  "source.label": "药品标签",
  "source.leaflet": "单张",
  "source.self": "本人说",
  "source.family": "女儿说",

  // owner 10-14: professional words; 「稍后」 alone on the third button of a row of three (as lib/ui/copy.ts later)
  "dose.taken": "已服药",
  "dose.missed": "未服药",
  "dose.later": "稍后",
  "dose.unconfirmed": "未确认",

  "common.dayN": "第{n}天",
  "common.loading": "加载中…",
  "common.retry": "再试一次",
  "common.back": "返回",
  "common.close": "关闭",
  "common.confirm": "确认",
  "common.cancel": "取消",
  "common.switchLanguage": "English",
  "common.offline": "正在重新连接…",

  "live.connecting": "连接中…",
  "live.open": "已连接",
  "live.closed": "已断开",
  "debug.session": "场次 {code}",
  "debug.role": "身份 {role}",
  "jump.title": "跳转",
  "jump.pages": "页面",
  "jump.days": "故事里的日子",
  "jump.join": "加入别的场次",
  "jump.reset": "重置这个场次",
  "today.title": "今天",
  "today.medsKicker": "今日早间药物",
  "today.doseQuestion": "今天的早间药物服用了吗？",
  "today.noDoseDue": "今日没有需要核对的药物。",
  "today.openQuestions": "有 {n} 个问题待下次就诊时询问",
  "dose.recorded": "记录：{state}",
  "dose.notYet": "尚未记录",
  "med.awaitingLabel": "等药袋确认",
  "reminder.tag": "提醒",
  "reminder.close": "关闭",
  "reminder.noDose": "目前没有需要服用的药物。",
  "noSession.title": "还没有加入场次",
  "noSession.body": "输入拍摄场次的加入码，或者开一个自己的沙盒。",
  "noSession.join": "输入加入码",
  "noSession.sandbox": "开一个自己的沙盒",
  "noSession.starting": "正在准备你的沙盒…",
  "startSession.crewKey": "开拍摄场次要先输入拍摄组口令。你自己的沙盒不受影响。",
  "startSession.crewKeyLink": "拍摄组登录",
  "startSession.failed": "没能开始场次，请再试一次。",
  "join.title": "加入场次",
  "join.code": "加入码",
  "join.role": "这台设备是",
  "join.submit": "加入",
  "join.notFound": "找不到这个加入码。",
  "join.failed": "加入失败，请再试一次。",
  "shell.comingIn": "这一页在 {module} 做。",
  "page.visitReview": "就诊后回顾",
  "page.medDetail": "这种药",
  "page.medAdd": "拍药袋",
  "family.title": "爸爸的情况",
  "family.allowed": "爸爸允许你看的",
  "family.doseToday": "今日早间药物：{state}",
  "family.hidden": "爸爸没有打开这一项。",
  "grant.dose_summary": "服药情况",
  "grant.bp_summary": "血压记录",
  "grant.questions_count": "问题数量",
  "grant.no_reply_alert": "提醒未回应时通知",
  "grant.visit_transcripts": "就诊记录",
  "grant.notes": "笔记",
  "grant.on": "开",
  "grant.off": "关",
};

export const messages: Record<Locale, Record<MessageKey, string>> = { en, "zh-Hans": zhHans };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Cookie / query value -> Locale, or the fallback. Accepts "zh", "zh-CN", "zh-SG" as zh-Hans. */
export function toLocale(value: string | null | undefined, fallback: Locale): Locale {
  if (!value) return fallback;
  if (isLocale(value)) return value;
  const v = value.toLowerCase();
  if (v.startsWith("zh")) return "zh-Hans";
  if (v.startsWith("en")) return "en";
  return fallback;
}

export function otherLocale(locale: Locale): Locale {
  return locale === "en" ? "zh-Hans" : "en";
}

/** Look up a key and fill {placeholders}. Unknown placeholders are left as written. */
export function t(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  const template = messages[locale][key] ?? messages.en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

/** Bind a locale once: const tr = translator("zh-Hans"); tr("nav.today"). */
export function translator(locale: Locale) {
  return (key: MessageKey, vars?: Record<string, string | number>) => t(locale, key, vars);
}
