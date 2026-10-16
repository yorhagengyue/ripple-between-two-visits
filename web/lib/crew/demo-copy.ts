/**
 * Words of the demo's own phone pages added in the C2 follow-up round (track E): the judge sandbox and the crew's filming
 * session keep the older components (components/daily, components/visit, components/family, components/brief), and the
 * problems the owner's review found were first fixed on accounts only. The sentences here are the demo side of those
 * fixes. None of them is clinical: counts, states and what the app did; a doctor's words are always quoted from the record.
 * Client-safe, pure.
 */
import type { Locale } from "@/lib/i18n";

const EN = {
  // Today: today's questions and answers stay after a refresh (real-app 12 「刷新以后，之前的问答全没了」)
  "ask.earlier": "Asked today ({n})",
  "ask.earlier.one": "Asked today (1)",
  "ask.earlier.noAnswer": "No answer was kept for this one.",
  // the review (real-app 12 「看诊回顾点『不对』悄悄删掉医生交代」, 「看诊回顾确认后不能再改」)
  "review.disputed": "He said: not right",
  "review.disputed.kept": "The words are kept as they were said, and a question about them is on the list for the next visit.",
  "review.disputed.emergency": "The words are kept and still used for emergencies; a question about them is on the list for the next visit.",
  "review.nothingRecorded": "Nothing was recorded this time, so it does not count as a visit. Go back to Visit to record again.",
  "review.changeHint": "Confirmed. You can still change an answer below; each change is kept.",
  "review.changed": "Changed {n} times",
  "review.changed.one": "Changed once",
  "review.changing": "Saving…",
  // his question list can be changed by him (real-app 12 「问题单不能加、删、标『问过了』」)
  "q.add.title": "Add a question",
  "q.add.placeholder": "In your own words",
  "q.add.who": "Who is it for",
  "q.add.doctor": "For the doctor",
  "q.add.pharmacist": "For the pharmacist",
  "q.add.save": "Add",
  "q.add.created": "Added to your list.",
  "q.add.merged": "The same question is on your list already: it stays one question.",
  "q.add.reopened": "This one was set aside; it is back on your list.",
  "q.add.answered": "This one has an answer already: it is on your list with that answer.",
  "q.edit": "Change the words",
  "q.edit.save": "Save",
  "q.skip": "Don't ask this",
  "q.reopen": "Put it back",
  "q.failed": "That did not go through. Try again.",
  // today's readings can be corrected and deleted (real-app 12 「血压记错不能删改」)
  "bp.edit": "Change",
  "bp.delete": "Delete",
  "bp.edit.top": "Top number",
  "bp.edit.bottom": "Bottom number",
  "bp.edit.save": "Save",
  "bp.cancel": "Cancel",
  "bp.delete.ask": "Delete this reading?",
  "bp.delete.yes": "Delete it",
  "bp.failed": "That did not go through. Check the two numbers and try again.",
  // a visit that already happened, watched again (real-app 12 「重放一次已经确认过的看诊，不改原来那次的标签」)
  "visit.rewatch": "Watching this visit again. Nothing here changes the record of the visit itself.",
  "visit.rewatch.tag": "watched again",
  // the visit screen without a microphone (real-app 10, 12 「没有麦克风时计时停在 0:00」)
  "visit.noMic": "No microphone",
  "visit.kicker.notRecording": "Visit · not recording",
  "visit.noMic.replay": "This browser gave no microphone, so nothing is being recorded. The lines below are the sample replay of this visit, not a recording.",
  "visit.noMic.nothing": "This browser gave no microphone, so nothing is being recorded and no words will appear. End the visit, allow the microphone, then start again.",
  // her page (real-app 12 「她录的提醒存完听不回、删不掉」, 「本周」和「今天」)
  "rec.mine": "Your recordings",
  "rec.mine.playing": "Dad's phone plays this one",
  "rec.mine.listen": "Listen",
  "rec.mine.delete": "Delete",
  "rec.mine.deleting": "Deleting…",
  "rec.mine.deleted": "Deleted. Dad's phone plays your next newest recording, or the stand-in voice when none is left.",
  "rec.mine.failed": "It could not be deleted. Try again.",
  "rec.mine.saidAs": "You wrote: ",
  "f.doses.noneYet": "No check-in this week so far.",
} as const;

export type DemoKey = keyof typeof EN;

const ZH: Record<DemoKey, string> = {
  "ask.earlier": "今天问过的（{n}）",
  "ask.earlier.one": "今天问过的（1）",
  "ask.earlier.noAnswer": "这一条没有存下回答。",
  "review.disputed": "他说不对",
  "review.disputed.kept": "原话照留，已经加进下次就诊的问题单。",
  "review.disputed.emergency": "原话照留，遇到急症时照常用这句话；已经加进下次看诊的问题单。",
  "review.nothingRecorded": "这次没有录到话，不算一次就诊。可以回到「就诊」再录一次。",
  "review.changeHint": "已确认。下面每一条还可以改，改动会留记录。",
  "review.changed": "改过 {n} 次",
  "review.changed.one": "改过 1 次",
  "review.changing": "正在保存…",
  "q.add.title": "加一个问题",
  "q.add.placeholder": "用你自己的话写",
  "q.add.who": "问谁",
  "q.add.doctor": "问医生",
  "q.add.pharmacist": "问药剂师",
  "q.add.save": "加入问题单",
  "q.add.created": "已加入问题单。",
  "q.add.merged": "问题单里已经有这一条，还是一条。",
  "q.add.reopened": "这一条之前说不问了，现在放回问题单了。",
  "q.add.answered": "这一条已经有回答，在问题单里连回答一起看。",
  "q.edit": "改一下",
  "q.edit.save": "存好",
  "q.skip": "不问了",
  "q.reopen": "放回去",
  "q.failed": "没改成，再试一次。",
  "bp.edit": "改",
  "bp.delete": "删",
  "bp.edit.top": "上面的数",
  "bp.edit.bottom": "下面的数",
  "bp.edit.save": "存好",
  "bp.cancel": "不改了",
  "bp.delete.ask": "删掉这次读数吗？",
  "bp.delete.yes": "删掉",
  "bp.failed": "没改成。看一下两个数，再试一次。",
  "visit.rewatch": "这是重看一次这次就诊。原来那次的记录不会变。",
  "visit.rewatch.tag": "重看",
  "visit.noMic": "没有麦克风",
  "visit.kicker.notRecording": "就诊 · 没有在录音",
  "visit.noMic.replay": "这个浏览器没有给麦克风，现在没有在录音。下面的字是这次就诊的示例回放，不是录音。",
  "visit.noMic.nothing": "这个浏览器没有给麦克风，现在没有在录音，也不会出字。请先结束，打开麦克风以后再开始。",
  "rec.mine": "你录的提醒",
  "rec.mine.playing": "爸爸的手机现在放这一段",
  "rec.mine.listen": "听一下",
  "rec.mine.delete": "删掉这段",
  "rec.mine.deleting": "正在删…",
  "rec.mine.deleted": "删掉了。爸爸的手机改放你上一段录音；一段都没有了，就放代录音。",
  "rec.mine.failed": "没删掉，再试一次。",
  "rec.mine.saidAs": "你写的：",
  "f.doses.noneYet": "本周尚未记录。",
};

/** A demo sentence in the phone's language; {name} placeholders are filled from `vars`. */
export function demoText(locale: Locale, key: DemoKey, vars: Record<string, string | number> = {}): string {
  const text: string = (locale === "en" ? EN : ZH)[key];
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}
