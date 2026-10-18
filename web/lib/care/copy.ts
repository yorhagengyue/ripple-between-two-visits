/**
 * Words for the family screens on real accounts (C2 track D): her phone (the daughter brief A-I) and his /p/family
 * (the elder brief 16-20). Client-safe, pure. Same pattern as lib/family/i18n.ts: `en` and `zh-Hans`, every sentence a
 * fixed template with names and times filled in.
 *
 * Never clinical, never judging: his answers, his readings and his questions are said as he recorded them (the owner's
 * decision of 2026-10-14: each of the six switches shows its kind in full while it is on; until then the first three
 * were worded as "whether and how many": no reason, no reading, no question's words), never compared with anything and
 * never explained; nothing here tells him or her what to do about his health. Plain statements, no question marks in
 * titles, no 「·」 chains, no all-caps labels, no arrows.
 */
import type { Locale } from "@/lib/i18n";
import type { DaySlot, FamilyGrantItems } from "@/lib/store/types";
import type { HomeState, TimelineLine } from "./home-types";
import type { LinkState } from "./types";

export type CareLocale = Locale;
type Grant = keyof FamilyGrantItems;

const zh = (l: CareLocale) => l === "zh-Hans";

// ---------------------------------------------------------------- how her screens speak of him

/**
 * Her word for him that says he or she: the family words (爸爸 / 妈妈 and the rest of the owner's list of 10-14, the
 * English ones beside them). Anything else (a name she typed, his own name the link carries) says neither: her screens
 * then use the word itself where a pronoun would stand, and never guess.
 */
const HE_WORDS = new Set(["爸爸", "父亲", "爷爷", "外公", "姥爷", "公公", "叔叔", "伯伯", "舅舅", "哥哥", "老公", "先生", "dad", "father", "grandpa", "grandfather", "uncle", "brother", "husband"]);
const SHE_WORDS = new Set(["妈妈", "母亲", "奶奶", "外婆", "姥姥", "婆婆", "阿姨", "姑姑", "姨妈", "姐姐", "老婆", "太太", "mum", "mom", "mother", "grandma", "grandmother", "aunt", "auntie", "sister", "wife"]);

/** "he" / "she" for one of the family words (the English ones in any case: "Dad", "Mum"), null for anything else. */
export function elderSex(word: string | null | undefined): "he" | "she" | null {
  const w = (word ?? "").trim().toLowerCase();
  return HE_WORDS.has(w) ? "he" : SHE_WORDS.has(w) ? "she" : null;
}

/**
 * How her screens refer to him, from her word for him (his link's label) and the page's language. Each is a fill-in of
 * her sentences ({dad}, {he}, {his}, {him}; {He}, {His} at the head of an English sentence; {himself}):
 *
 *   dad       her word, as today: the label as she gave it (in either language), else 爸爸 / Dad
 *   he, him   他 / 她, he / him / she / her (her word may be 华语 or English: 妈妈 and Mum both say 她 / she); for a
 *             name, the name itself
 *   his       他的 / 她的, his / her; for a name, 「阿嬷的」 / "Ah Ma's"
 *   himself   himself / herself; for a name "themselves", the one English word that does not guess (华语: 他自己 /
 *             她自己 / 「阿嬷自己」)
 *
 * The same answer for the label and for the word it gives (`dad`), so a screen that only holds the word asks with it.
 */
export type ElderWords = { dad: string; he: string; his: string; him: string; He: string; His: string; himself: string };

export function elderWords(label: string | null | undefined, locale: CareLocale): ElderWords {
  const dad = label?.trim() || (zh(locale) ? "爸爸" : "Dad");
  const sex = elderSex(dad);
  if (zh(locale)) {
    const he = sex === "he" ? "他" : sex === "she" ? "她" : dad;
    return { dad, he, his: `${he}的`, him: he, He: he, His: `${he}的`, himself: `${he}自己` };
  }
  if (sex === "he") return { dad, he: "he", his: "his", him: "him", He: "He", His: "His", himself: "himself" };
  if (sex === "she") return { dad, he: "she", his: "her", him: "her", He: "She", His: "Her", himself: "herself" };
  const Dad = dad.charAt(0).toUpperCase() + dad.slice(1);
  return { dad, he: dad, his: `${dad}'s`, him: dad, He: Dad, His: `${Dad}'s`, himself: "themselves" };
}

/** How she calls him on her screens: his link's word for himself, else 爸爸 / Dad (elderWords' `dad`). */
export function dadWord(label: string | null | undefined, locale: CareLocale): string {
  return elderWords(label, locale).dad;
}

/**
 * A sentence of hers with the words for him filled in, from `vars.dad` (her word, as dadWord gives it; without one,
 * 爸爸 / Dad), and the caller's other names (`{n}`, `{time}`); a name not given stays as it is. What hc, rc, mc, bc and
 * familyCopy fill with.
 */
export function fillHer(template: string, locale: CareLocale, vars: Record<string, string | number> = {}): string {
  const all: Record<string, string | number> = { ...vars, ...elderWords(typeof vars.dad === "string" ? vars.dad : null, locale) };
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.prototype.hasOwnProperty.call(all, name) ? String(all[name]) : whole));
}

/** "08:45" -> "8:45" */
export function hm(t: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  return m ? `${Number(m[1])}:${m[2]}` : t;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const WD_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WD_ONE_ZH = ["日", "一", "二", "三", "四", "五", "六"];

/** "2026-10-10" -> 「10月10日」 / "10 Oct" */
export function dayWords(iso: string, locale: CareLocale): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return zh(locale) ? `${mo}月${d}日` : `${d} ${MONTHS[mo - 1]}`;
}

/** 「10月10日 周六」 / "Sat 10 Oct" */
export function dateLine(iso: string, locale: CareLocale): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const wd = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return zh(locale) ? `${dayWords(iso, locale)} ${WD_ZH[wd]}` : `${WD_EN[wd]} ${dayWords(iso, locale)}`;
}

export function weekdayShort(i: number, locale: CareLocale): string {
  return zh(locale) ? WD_ONE_ZH[i] : WD_EN[i];
}

export function weekdayLong(i: number, locale: CareLocale): string {
  return zh(locale) ? WD_ZH[i] : WD_EN[i];
}

const SLOT_MED: Record<CareLocale, Record<DaySlot, string>> = {
  "zh-Hans": { morning: "早间药物", midday: "午间药物", evening: "晚间药物", night: "睡前药物" },
  en: { morning: "morning medicine", midday: "midday medicine", evening: "evening medicine", night: "bedtime medicine" },
};
const SLOT_PART: Record<CareLocale, Record<DaySlot, string>> = {
  "zh-Hans": { morning: "早间", midday: "午间", evening: "晚间", night: "睡前" },
  en: { morning: "this morning", midday: "at midday", evening: "this evening", night: "at bedtime" },
};

export const slotMed = (slot: DaySlot, locale: CareLocale) => SLOT_MED[locale][slot];
export const slotPart = (slot: DaySlot, locale: CareLocale) => SLOT_PART[locale][slot];

const list = (items: string[], locale: CareLocale) => (zh(locale) ? items.join("、") : items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : (items[0] ?? ""));

// ------------------------------------------------------------------ her home (brief B)

export interface HeadlineInput {
  state: HomeState;
  dad: string;
  slot: DaySlot | null;
  /** HH:MM of the answer (taken / missed / mixed) */
  at: string | null;
  /** HH:MM of the slot's first reminder */
  first: string | null;
}

/** The one big sentence for today's medicine (B1-B5). */
export function headline(h: HeadlineInput, locale: CareLocale): string {
  const med = h.slot ? slotMed(h.slot, locale) : zh(locale) ? "药物" : "medicine";
  const part = h.slot ? slotPart(h.slot, locale) : "";
  const at = h.at ? hm(h.at) : "";
  if (zh(locale)) {
    switch (h.state) {
      case "before":
        return `${med}将于 ${hm(h.first ?? "")} 提醒。`;
      case "reminding":
        return `已提醒${h.dad}，暂未回应。`;
      case "taken":
        return `${h.dad}已于 ${at} 服用${med}。`;
      case "missed":
        return `${h.dad}记录：今天${part}未服药。`;
      case "mixed":
        return `${h.dad}已于 ${at} 记录${med}。`;
      case "no_reply":
        return `${h.dad}尚未回应${med}提醒。`;
      case "not_logged":
        return `${med}尚未记录。`;
      case "untracked":
        return `今天${med}无记录：当时${h.dad}尚未开始使用 Ripple。`;
      case "answered":
        return `${h.dad}已于 ${at} 回应${med}提醒。`;
      case "no_meds":
        return `${h.dad}今天没有需要记录的药物。`;
    }
  }
  const w = elderWords(h.dad, locale);
  switch (h.state) {
    case "before":
    return `${w.His} ${med} reminder comes at ${hm(h.first ?? "")}.`;
    case "reminding":
      return `${h.dad} was just reminded and hasn't answered yet.`;
    case "taken":
      return `${h.dad} took ${w.his} ${med} at ${at}.`;
    case "missed":
      return `${h.dad} says ${w.he} didn't take it ${part}.`;
    case "mixed":
      return `${h.dad} logged ${w.his} ${med} at ${at}.`;
    case "no_reply":
      return `${h.dad} hasn't answered about ${w.his} ${med}.`;
    case "not_logged":
      return `${w.His} ${med} isn't logged yet.`;
    case "untracked":
      return `No record of today's ${med}: ${h.dad} hadn't started using Ripple yet.`;
    case "answered":
      return `${h.dad} answered the ${med} reminder at ${at}.`;
    case "no_meds":
      return `${h.dad} has no medicine to log today.`;
  }
}

/**
 * The line under the headline. One line is the v3 draft's (fe-d): before the reminder, when it is not her recording
 * that will play, 「今天早上还没有记录。」 (B1), where there was no line.
 */
export function headlineLede(h: HeadlineInput & { yourVoice: boolean; reminded: boolean; perMed: { name: string; mark: string }[] }, locale: CareLocale): string | null {
  const w = elderWords(h.dad, locale);
  switch (h.state) {
    case "taken":
      if (zh(locale)) return h.reminded && h.yourVoice ? `由本人确认。${hm(h.first ?? "")} 的提醒播放的是你的录音。` : "由本人确认。";
      return h.reminded && h.yourVoice ? `${w.He} tapped it ${w.himself}. The ${hm(h.first ?? "")} reminder played your recording.` : `${w.He} tapped it ${w.himself}.`;
    case "missed":
      return zh(locale) ? "由本人记录为未服药。" : `${w.He} logged it as not taken ${w.himself}.`;
    case "mixed":
      return h.perMed.map((m) => `${m.name} ${markWord(m.mark, locale)}`).join(zh(locale) ? "，" : ", ") + (zh(locale) ? "。" : ".");
    case "reminding":
      return h.yourVoice ? (zh(locale) ? `${hm(h.first ?? "")} 的提醒播放的是你的录音。` : `The ${hm(h.first ?? "")} reminder played your recording.`) : null;
    case "before": {
      if (h.yourVoice) return zh(locale) ? "届时播放你的录音。" : "It will play your recording.";
      const part = h.slot ? slotPart(h.slot, locale) : "";
      return zh(locale) ? `今天${part}暂无记录。` : part ? `Nothing logged yet ${part}.` : "Nothing logged yet.";
    }
    case "no_reply":
      return zh(locale) ? "两次提醒均未回应。" : "Neither reminder got a response.";
    default:
      return null;
  }
}

export function markWord(mark: string, locale: CareLocale): string {
  const z: Record<string, string> = { taken: "已服药", missed: "未服药", no_reply: "未回应", waiting: "待回应", pending: "未到时间", untracked: "无记录", none: "无需记录" };
  const e: Record<string, string> = { taken: "taken", missed: "not taken", no_reply: "no response", waiting: "awaiting response", pending: "not due yet", untracked: "no record", none: "nothing scheduled" };
  return (zh(locale) ? z : e)[mark] ?? mark;
}

/** The headline when his medicine is not shared: the first item he does share, or the empty state. */
export function sharedHeadline(input: { dad: string; bp: number | null; questions: number | null; visits: boolean; notes: boolean; noReplyOn: boolean }, locale: CareLocale): string {
  const { dad } = input;
  const w = elderWords(dad, locale);
  if (input.bp !== null) return zh(locale) ? `${dad}本周测量血压 ${input.bp} 次。` : `${dad} measured ${w.his} blood pressure ${input.bp} ${input.bp === 1 ? "time" : "times"} this week.`;
  if (input.questions !== null) return zh(locale) ? `${dad}有 ${input.questions} 个问题待问医生。` : `${dad} has ${input.questions} ${input.questions === 1 ? "question" : "questions"} for the doctor.`;
  if (input.visits || input.notes) return zh(locale) ? `${dad}分享了${w.his}记录。` : `${dad} shares some of ${w.his} records.`;
  if (input.noReplyOn) return zh(locale) ? `${dad}未回应提醒时会通知你。` : `You'll be told when ${dad} doesn't answer a reminder.`;
  return zh(locale) ? `${dad}尚未开启任何一项。` : `${dad} hasn't switched anything on yet.`;
}

// ---- her home's detail (the owner's decision of 2026-10-14: each switch shows its kind in full). His words and his
// numbers as he recorded them; nothing here says what a number means.

/**
 * The quiet line under today's sentence when he gave a reason for a dose he did not take: his words as stored. One
 * reason for the slot is said once; different reasons, each with its medicine. null: he gave none.
 */
export function missedReasonLine(cells: readonly { name: string; reason: string | null }[], locale: CareLocale): string | null {
  const given = cells.filter((c) => c.reason);
  if (!given.length) return null;
  const reasons = [...new Set(given.map((c) => c.reason))];
  if (reasons.length === 1) return zh(locale) ? `未服药原因：${reasons[0]}` : `Reason given: ${reasons[0]}`;
  return given.map((c) => (zh(locale) ? `${c.name}：${c.reason}` : `${c.name}: ${c.reason}`)).join(zh(locale) ? "；" : "; ");
}

/** A reading as the row's value: 「142/88」. */
export const bpWords = (r: { systolic: number; diastolic: number }) => `${r.systolic}/${r.diastolic}`;

/**
 * The small line under her blood pressure row: when the latest reading was taken (`when` comes worded: 「今天 8:20」,
 * 「昨天早上」), the pulse when he recorded one, and how many readings this week.
 */
export function bpLine(input: { when: string; pulse: number | null; count: number }, locale: CareLocale): string {
  if (zh(locale)) return `${input.when}${input.pulse !== null ? `，脉搏 ${input.pulse}` : ""}。本周测量 ${input.count} 次。`;
  const when = input.when.replace(/^./, (c) => c.toUpperCase());
  return `${when}${input.pulse !== null ? `, pulse ${input.pulse}` : ""}. ${input.count} ${input.count === 1 ? "reading" : "readings"} this week.`;
}

/** One waiting question as a small line under 「要问医生的」: its own words; one for the pharmacist says so. */
export function questionLine(q: { for: "doctor" | "pharmacist"; text: string }, locale: CareLocale): string {
  if (q.for !== "pharmacist") return q.text;
  return zh(locale) ? `待问药剂师：${q.text}` : `For the pharmacist: ${q.text}`;
}

/** One line of today's timeline. `dad`: her word for him (the English lines say he / she by it). */
export function timelineWords(line: TimelineLine, locale: CareLocale, opts: { yourVoice: boolean; dad?: string | null }): string {
  const meds = list(line.meds, locale);
  const He = elderWords(opts.dad, locale).He;
  if (zh(locale)) {
    switch (line.kind) {
      case "reminded":
        return opts.yourVoice ? "已播放你的提醒" : "已提醒";
      case "reminded_again":
        return "再次提醒";
      case "taken":
        return meds ? `本人确认已服药：${meds}` : "本人确认已服药";
      case "missed":
        return meds ? `本人记录未服药：${meds}` : "本人记录未服药";
      case "later":
        return "本人选择稍后服用";
      case "no_reply":
        return "记录为未回应";
      case "told_you":
        return "记录为未回应，已通知你";
      case "late_taken":
        return meds ? `补记已服药：${meds}` : "补记已服药";
      case "late_missed":
        return meds ? `补记未服药：${meds}` : "补记未服药";
      case "answered":
        return "已回应提醒";
    }
  }
  switch (line.kind) {
    case "reminded":
      return opts.yourVoice ? "Your reminder played" : `${He} was reminded`;
    case "reminded_again":
      return "Reminded again";
    case "taken":
      return meds ? `${He} tapped “taken”: ${meds}` : `${He} tapped “taken”`;
    case "missed":
      return meds ? `${He} tapped “not taken”: ${meds}` : `${He} tapped “not taken”`;
    case "later":
      return `${He} tapped “later”`;
    case "no_reply":
      return "Logged as “no reply”";
    case "told_you":
      return "Logged as “no reply”, and you were told";
    case "late_taken":
      return meds ? `${He} logged “taken” later: ${meds}` : `${He} logged “taken” later`;
    case "late_missed":
      return meds ? `${He} logged “not taken” later: ${meds}` : `${He} logged “not taken” later`;
    case "answered":
      return `${He} answered the reminder`;
  }
}

// The owner's decision of 2026-10-14: the first three switches are named for their kind, not for a count of it (they
// were 「每天吃药了没有」, 「这周量了几次血压」, 「有几个问题要问医生」), because each now shows its kind in full. The same
// three names on her list (below) and on his switch screen (TITLE_*); the other three are as they were.
const GRANT_ZH: Record<Grant, string> = {
  dose_summary: "每日服药情况",
  bp_summary: "血压",
  questions_count: "待问医生的问题",
  no_reply_alert: "两次提醒未回应时通知你",
  visit_transcripts: "就诊录音和逐字稿",
  notes: "{he}本人写的笔记",
};
const GRANT_EN: Record<Grant, string> = {
  dose_summary: "Medicine each day",
  bp_summary: "Blood pressure",
  questions_count: "Questions for the doctor",
  no_reply_alert: "Tell you when two reminders get no reply",
  visit_transcripts: "Visit recordings and transcripts",
  notes: "Notes {he} wrote {himself}",
};
/** Her words for each of his switches (the shared-items screen, F1). `dad`: her word for him (「她本人写的笔记」). */
export const grantName = (k: Grant, locale: CareLocale, dad?: string | null) => fillHer((zh(locale) ? GRANT_ZH : GRANT_EN)[k], locale, dad ? { dad } : {});

const SHORT_ZH: Record<Grant, string> = { dose_summary: "服药情况", bp_summary: "血压读数", questions_count: "待问的问题", no_reply_alert: "未回应通知", visit_transcripts: "就诊录音", notes: "{his}笔记" };
const SHORT_EN: Record<Grant, string> = { dose_summary: "{his} medicine", bp_summary: "{his} blood pressure readings", questions_count: "{his} questions", no_reply_alert: "no-reply alerts", visit_transcripts: "{his} visit recordings", notes: "{his} notes" };

/** 「这些是爸爸同意给你看的。他的笔记和看诊录音没有分享。」 (without `grants`: the first sentence alone) */
export function privacyLine(dad: string, grants: FamilyGrantItems | null | undefined, locale: CareLocale): string {
  const off = grants ? (["notes", "visit_transcripts"] as Grant[]).filter((k) => !grants[k]).map((k) => fillHer((zh(locale) ? SHORT_ZH : SHORT_EN)[k], locale, { dad })) : [];
  const first = zh(locale) ? `这些是${dad}同意给你看的。` : `This is what ${dad} agreed to show you.`;
  if (!off.length) return first;
  return zh(locale) ? `${first}${off.join("和")}没有分享。` : `${first} ${list(off, locale).replace(/^./, (c) => c.toUpperCase())} ${off.length > 1 ? "are" : "is"} not shared.`;
}

/** The word under a day's mark on her week: 「已服」「未服」「未回应」; a day without a result is 「待记录」 today, 「未到」 later. */
export function dayWord(mark: string, isToday: boolean, locale: CareLocale): string {
  const z: Record<string, string> = { taken: "已服", missed: "未服", no_reply: "未回应", pending: isToday ? "待记录" : "未到", none: "" };
  const e: Record<string, string> = { taken: "Taken", missed: "Not taken", no_reply: "No response", pending: "Not yet", none: "" };
  return (zh(locale) ? z : e)[mark] ?? "";
}

// ------------------------------------------------------------------ his side (elder brief 16-20)

const RELATION_ZH: Record<string, string> = { daughter: "女儿", son: "儿子", wife: "太太", husband: "先生", other: "家人" };
const RELATION_EN: Record<string, string> = { daughter: "daughter", son: "son", wife: "wife", husband: "husband", other: "family" };
export const RELATIONS = ["daughter", "son", "wife", "husband", "other"] as const;

export function relationWord(rel: string | null | undefined, locale: CareLocale): string {
  const r = (rel ?? "").trim();
  if (!r) return zh(locale) ? "家人" : "family";
  return (zh(locale) ? RELATION_ZH : RELATION_EN)[r] ?? r;
}

/** 「女儿 Wei Ling」 / "Wei Ling (daughter)" */
export function whoWords(label: string | null, rel: string | null, locale: CareLocale): string {
  const name = label?.trim() || (zh(locale) ? "家人" : "Family member");
  if (!rel) return name;
  return zh(locale) ? `${relationWord(rel, locale)} ${name}` : `${name} (${relationWord(rel, locale)})`;
}

/**
 * What she will see with each switch on (his switch screen: 写清楚她会看到什么). The owner's decision of 2026-10-14: the
 * first three say the whole of their kind (they said 「只有吃了、没吃、没回，没有原因」, 「只有次数，没有读数」, 「只有个数，
 * 没有内容」); her list says the same three lines (lib/care/her-copy.ts see_*).
 */
const SEES_ZH: Record<Grant, string> = {
  dose_summary: "药物名称、服药时间、未服药的原因",
  bp_summary: "每次的读数和时间",
  questions_count: "问题的原文，和下次就诊的日期",
  no_reply_alert: "她的手机收到一条通知，不写药名",
  visit_transcripts: "她能看医生的原话，听原声",
  notes: "她看得到你写的原文",
};
const SEES_EN: Record<Grant, string> = {
  dose_summary: "Which medicine, when, and the reason when one was not taken",
  bp_summary: "Each reading and its time",
  questions_count: "The questions' own words, and the date of the next visit",
  no_reply_alert: "Her phone gets a notice, with no medicine named",
  visit_transcripts: "She can read the doctor's own words and hear them",
  notes: "She sees what you wrote, word for word",
};
const TITLE_ZH: Record<Grant, string> = {
  dose_summary: "每日服药情况",
  bp_summary: "血压",
  questions_count: "待问医生的问题",
  no_reply_alert: "两次提醒未回应时通知她",
  visit_transcripts: "就诊录音和逐字稿",
  notes: "我本人写的笔记",
};
const TITLE_EN: Record<Grant, string> = {
  dose_summary: "Medicine each day",
  bp_summary: "Blood pressure",
  questions_count: "Questions for the doctor",
  no_reply_alert: "Tell her when two reminders get no reply",
  visit_transcripts: "My visit recordings and transcripts",
  notes: "Notes I wrote myself",
};
export const switchTitle = (k: Grant, locale: CareLocale) => (zh(locale) ? TITLE_ZH : TITLE_EN)[k];
export const switchSees = (k: Grant, locale: CareLocale) => (zh(locale) ? SEES_ZH : SEES_EN)[k];

export function linkStateWords(state: LinkState, locale: CareLocale): string {
  const z: Record<LinkState, string> = {
    invited: "邀请已发出，等她接受",
    accepted: "她接受了，等你确认",
    active: "已确认",
    declined: "你说不是她",
    expired: "邀请过期了",
    revoked: "已停止分享",
    left: "她不再看了",
  };
  const e: Record<LinkState, string> = {
    invited: "Invitation sent; waiting for her",
    accepted: "She accepted; waiting for you",
    active: "Confirmed",
    declined: "You said it was not her",
    expired: "The invitation expired",
    revoked: "Sharing stopped",
    left: "She stopped looking",
  };
  return (zh(locale) ? z : e)[state];
}
