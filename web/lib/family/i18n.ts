/**
 * Words for Wei Ling's view (/f), Mr Tan's switches (/p/family) and her recorded reminder (M6). Same pattern as
 * lib/i18n.ts: `en` first, `zhHans` typed against it. The switch names themselves stay in lib/i18n.ts (grant.*).
 * Client-safe.
 *
 * No clinical sentence lives here and nothing judges a reading: Wei Ling sees counts (days, readings, questions),
 * never a number next to a line, never high / normal / good, 偏高 / 正常. Her own words and his are quoted, never
 * rewritten. The Chinese is a draft for review.
 *
 * Counts: a key with a "<key>_one" twin is shown through ftn(locale, key, n), which picks the twin when n is 1
 * ("Not taken: 1 day", not "1 days"). Chinese has no plural, so its twins repeat the same words.
 */
import type { Locale } from "@/lib/i18n";

const en = {
  "f.week": "This week: {from} to {to}",
  "f.doses.title": "Medicine check-ins",
  "f.doses.days": "Took his medicine on {taken} of {due} days",
  "f.doses.days_one": "Took his medicine on {taken} of 1 day",
  "f.doses.missed": "Not taken: {n} days",
  "f.doses.missed_one": "Not taken: 1 day",
  "f.doses.unconfirmed": "Not confirmed: {n} days",
  "f.doses.unconfirmed_one": "Not confirmed: 1 day",
  "f.doses.none": "No medicine due this week yet.",
  "f.bp.title": "Blood pressure log",
  "f.bp.count": "Readings this week: {n}",
  "f.bp.unconfirmed": "Not confirmed: {n} readings",
  "f.bp.unconfirmed_one": "Not confirmed: 1 reading",
  "f.q.title": "Questions",
  "f.q.count": "Waiting for the next visit: {n}",
  "f.visits.title": "Visit transcripts",
  "f.visits.none": "No visit yet.",
  "f.visits.empty": "Nothing kept from this visit.",
  "f.notes.title": "Dad's notes",
  "f.notes.none": "No notes yet.",
  "f.chip.self": "Dad said",
  "f.chip.note": "Dad's note",
  "f.allowed.who": "Only Dad changes these, on his phone.",
  "f.error.load": "Could not get Dad's latest updates. Trying again…",

  "rec.title": "Record a reminder for Dad",
  "rec.explain": "His phone plays it at the reminder time after breakfast ({time}).",
  "rec.current": "Plays now: {which}",
  "rec.yours": "your recording",
  "rec.standIn": "stand-in recording",
  "rec.start": "Start recording",
  "rec.starting": "Starting the microphone…",
  "rec.stop": "Finish",
  "rec.recording": "Recording… {s} s",
  "rec.preview": "Listen",
  "rec.again": "Record again",
  "rec.text": "What you said (optional)",
  "rec.save": "Save for Dad",
  "rec.saving": "Saving…",
  "rec.saved": "Saved. His phone plays your recording at the next reminder.",
  "rec.unavailable": "The microphone is not available on this phone.",
  "rec.error": "It did not save. Your recording is still here: tap Save for Dad again.",
  "rec.error.familyOnly": "Only a family member's phone can record Dad's reminder.",
  "rec.error.empty": "This recording has no sound. Record it again.",

  "clip.her": "Wei Ling's recording",

  "g.title": "What my family can see",
  "g.lead": "Wei Ling sees only what you switch on. You can change it any time.",
  "g.desc.dose_summary": "How many days this week I took my medicine",
  "g.desc.bp_summary": "How many times I measured my blood pressure this week",
  "g.desc.questions_count": "How many questions wait for my next visit",
  "g.desc.no_reply_alert": "Tell her when I do not reply to two reminders",
  "g.desc.visit_transcripts": "What was said at my visits",
  "g.desc.notes": "What I wrote down myself",
  "g.error": "That did not change. Try again.",
  "g.error.load": "Could not read your current switches. Trying again… What you see may be out of date.",
  "g.denied": "Only Mr Tan can change this.",
  "g.link": "What my family can see",
} as const;

export type FamilyKey = keyof typeof en;

const zhHans: Record<FamilyKey, string> = {
  "f.week": "本周：{from}到{to}",
  "f.doses.title": "服药情况",
  "f.doses.days": "{due} 天中 {taken} 天已服药",
  "f.doses.days_one": "1 天中 {taken} 天已服药",
  "f.doses.missed": "未服药：{n} 天",
  "f.doses.missed_one": "未服药：1 天",
  "f.doses.unconfirmed": "未确认：{n} 天",
  "f.doses.unconfirmed_one": "未确认：1 天",
  "f.doses.none": "本周暂无需要服用的药物。",
  "f.bp.title": "血压记录",
  "f.bp.count": "本周测量 {n} 次",
  "f.bp.unconfirmed": "未确认：{n} 次",
  "f.bp.unconfirmed_one": "未确认：1 次",
  "f.q.title": "问题",
  "f.q.count": "有 {n} 个问题待下次就诊时问",
  "f.visits.title": "就诊记录",
  "f.visits.none": "暂无就诊记录。",
  "f.visits.empty": "本次就诊没有留下内容。",
  "f.notes.title": "爸爸记下的话",
  "f.notes.none": "还没有笔记。",
  "f.chip.self": "爸爸说",
  "f.chip.note": "爸爸记的",
  "f.allowed.who": "这些开关只有爸爸能在他的手机上改。",
  "f.error.load": "没能取到爸爸的最新情况，正在重试…",

  "rec.title": "给爸爸录一段提醒",
  "rec.explain": "早饭后的提醒时间（{time}）他的手机会播放这段录音。",
  "rec.current": "现在播放的是：{which}",
  "rec.yours": "你的录音",
  "rec.standIn": "代录音",
  "rec.start": "开始录音",
  "rec.starting": "正在打开麦克风…",
  "rec.stop": "录好了",
  "rec.recording": "正在录音… {s} 秒",
  "rec.preview": "听一下",
  "rec.again": "重录",
  "rec.text": "你说了什么（可不填）",
  "rec.save": "存下来给爸爸",
  "rec.saving": "正在保存…",
  "rec.saved": "存好了。下次提醒时，他的手机会播放你的录音。",
  "rec.unavailable": "这台手机用不了麦克风。",
  "rec.error": "没存上。录音还在，再点一次「存下来给爸爸」。",
  "rec.error.familyOnly": "只有家人的手机能给爸爸录提醒。",
  "rec.error.empty": "这段录音没有声音，请重录。",

  "clip.her": "女儿的录音",

  "g.title": "家人能看到什么",
  "g.lead": "Wei Ling 只看得到你打开的项目，随时可以改。",
  "g.desc.dose_summary": "本周服药天数",
  "g.desc.bp_summary": "本周测量血压次数",
  "g.desc.questions_count": "下次就诊待问的问题数",
  "g.desc.no_reply_alert": "两次提醒均未回应时通知她",
  "g.desc.visit_transcripts": "就诊时说的话",
  "g.desc.notes": "我自己记下的话",
  "g.error": "没改成，再试一次。",
  "g.error.load": "没能读到现在的开关，正在重试…下面显示的可能不是最新的。",
  "g.denied": "只有陈先生本人能改。",
  "g.link": "家人能看到什么",
};

const messages: Record<Locale, Record<FamilyKey, string>> = { en, "zh-Hans": zhHans };

export function ft(locale: Locale, key: FamilyKey, vars?: Record<string, string | number>): string {
  const template = messages[locale][key] ?? en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole));
}

/** A count: the key's "_one" twin when n is 1 (and the twin exists), else the key itself; {n} is filled in. */
export function ftn(locale: Locale, key: FamilyKey, n: number, vars?: Record<string, string | number>): string {
  const one = `${key}_one`;
  const pick = n === 1 && Object.prototype.hasOwnProperty.call(en, one) ? (one as FamilyKey) : key;
  return ft(locale, pick, { n, ...(vars ?? {}) });
}

export function allFamilyStrings(locale: Locale): string[] {
  return Object.values(messages[locale]);
}
