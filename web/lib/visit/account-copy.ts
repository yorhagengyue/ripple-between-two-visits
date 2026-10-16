/**
 * The words of his own visit screens on a real account (C2 track F; elder UI, components/ui): where he is, the
 * consent card's frame, recording, waiting for the text, the one-line-at-a-time review and its summary. Labels and
 * fixed sentences only: what the doctor, the counter or the pharmacist said is shown verbatim from the record, and
 * Ripple's clinical sentences come from lib/safety. Dates are real dates ("10月12日 周一"), never "Day N". Client-safe.
 */
import type { UtteranceRole } from "@/lib/store/types";

export type AccountLocale = "zh-Hans" | "en";

const zh = {
  "visit.sample": "示例就诊 · 回放",
  // C2 track V: the sample replay's label, on every screen of that replay (real-app 4.6)
  "visit.sampleLabel": "示例回放",
  // C2 track V: an empty visit list (real-app 2.25) and the fixed line of a server without transcription (2.14)
  "visit.empty": "暂无就诊记录",
  // owner 10-14: the visit tab's one button (the card for the doctor, at the clinic; the place is no longer asked)
  "visit.start": "开始就诊",
  "visit.noService": "暂时没有转写 · 录音会保存，之后出文字",
  // C2 track V: a planned follow-up has its own row (real-app 4.4; its date reads 「大约 11月20日」, 2.15)
  "visit.planned.today": "今天的复诊（计划）",
  "visit.planned.about": "大约 {date}的复诊（计划）",
  "visit.planned.on": "{date}的复诊（计划）",
  // C2 track V: 「我约的日子」 (real-app 2.15): the planned follow-up's day, set to the day he booked
  "visit.planned.book": "我约的日子",
  "visit.book.title": "哪一天去复诊？",
  "visit.book.sub": "选你约好的那一天。现在记的是：{label}",
  "visit.book.save": "存好",
  "visit.book.failed": "没存上。再试一次。",
  // C2 track V (real-app 2.12): the brief for the doctor; since 10-14 a row of the visit tab, with the next visit
  "visit.before": "就诊简报",
  "visit.beforeSub": "这段时间的血压、服药情况和问题",
  "visit.unfinished": "未完成的就诊",
  "visit.unfinished.recording": "{date} · 录到一半",
  "visit.unfinished.transcribing": "{date} · 正在整理成文字",
  "visit.unfinished.awaiting": "{date} · 录音已存，等转写",
  // C2 track V: the server used up its attempts (lib/visit/transcript-tries.ts); the review says the same
  "visit.unfinished.failed": "{date} · 录音没能转成文字",
  "visit.unfinished.review": "{date} · 还没认完",
  "visit.unfinished.end": "接着结束",
  "visit.unfinished.open": "去看",
  "visit.past.row": "{date} · {place}",
  "visit.consentNote": "录音保留 90 天，可改为一直保留；存在你自己的记录里",
  "visit.declined": "这次不录音。",
  "visit.declinedSub": "可以拍处方单和药袋，回家也能看。",
  "visit.declinedPhoto": "拍药袋",
  "visit.back": "返回",
  // C2 track V: the second button of the card for the doctor (real-app 2.12: the tap is recorded as the doctor's no)
  "visit.decline": "医生不同意",
  "visit.declineFailed": "「医生不同意」尚未记录。",
  // C2 track V: an unfinished visit opened again (nothing is recording on this screen)
  "visit.reopened": "{date}的就诊尚未结束。",
  "visit.reopened.looking": "正在找这次的录音……",
  "visit.reopened.saved": "录音已经存好，还没整理成文字。",
  "visit.reopened.none": "这台手机上没有这次的录音。",
  "visit.reopened.noneSub": "用别的手机录的，在那台手机上打开「就诊」，还能传上来。",
  "visit.reopened.endEmpty": "结束本次就诊",
  // C2 track V: no microphone (nothing on the screen looks like a recording)
  "visit.mic.denied": "手机没让用麦克风，现在没有在录音。",
  "visit.mic.deniedSub": "在手机的「设置」里找到这个浏览器，把「麦克风」打开，再点「再试一次」。",
  "visit.mic.unavailable": "这台手机用不了麦克风，现在没有在录音。",
  "visit.mic.unavailableSub": "可以换一台手机再试，或者拍处方单和药袋。",
  // the fixed sentence of real-app 2.13 (no promise of text right after: the text comes when a service is connected)
  "visit.noCaptions": "没有实时字幕 · 录音照常保存",
  "visit.captionsDown": "转写服务现在没有回应，这次没有字幕：录音照常保存，录完以后再出文字。",
  "visit.captionsStopped": "字幕停了：转写服务没有回应。录音照常在录，录完以后再出文字。",
  "visit.captionsLate": "字幕慢了一点，录音照常在录。",
  "visit.captionLost": "有一句没出字幕，录音里有，录完以后会整理出来。",
  "visit.sampleCaptions": "示例回放：字幕来自录好的示例。",
  "visit.saving": "正在存录音……",
  "visit.transcribing": "正在整理成文字……",
  "visit.uploadFailed": "录音没传上去，还在手机上。",
  "visit.uploadAgain": "再传一次",
  "visit.failed": "未成功，录音还在。请稍后再试。",
  "visit.tryAgain": "再试一次",
  "visit.resumeTitle": "上次的录音（{min} 分 {sec} 秒）还没传。",
  "visit.resumeSend": "现在传",
  // C2 track R (long visits): how far the saving of a long recording is, in minutes (never a part number); and what
  // he is told before a recording could no longer be kept or sent: the phone's room, and a recording left running
  "visit.savingProgress": "已经存好 {done} 分钟，一共 {total} 分钟。",
  "visit.room.low": "这台手机剩下的地方，大约只够再录 {min} 分钟。",
  "visit.room.none": "这台手机存满了，先清出一些地方再录。",
  "visit.room.soon": "手机快存满了，大约还能录 {min} 分钟。",
  "visit.room.full": "手机存满了：先别关这一页，录完马上传。",
  "visit.limit.soon": "录音已经很长了，再过大约 {min} 分钟会自己停下并存好。",
  // C2 track V: Today's row for a visit that waits for its text (real-app 2.14)
  "today.visit": "就诊",
  "today.visitWaiting": "{date}的就诊 · 录音已存，等转写",
  "today.visitFailed": "{date}的就诊 · 录音没能转成文字",

  "review.context": "{date}的就诊",
  "review.awaiting": "录音已存，还没有文字。",
  "review.awaitingSub": "录音（{min} 分 {sec} 秒）已经存好。转写接上以后会出文字，到时候通知你。",
  "review.awaitingNoAudio": "本次就诊暂无录音和文字。",
  "review.listenRecording": "听录音",
  "review.empty": "没有录到声音",
  "review.emptySub": "这次没有听到说话，不算就诊。如果你说过话，可能是麦克风没有声音进来：看看耳机或麦克风开着没有，再录一次。",
  "review.ask.doctor": "这句是医生说的吗？",
  "review.ask.dispenser": "这句是柜台说的吗？",
  "review.ask.pharmacist": "这句是药剂师说的吗？",
  "review.yes.doctor": "是，医生说的",
  "review.yes.dispenser": "是，柜台说的",
  "review.yes.pharmacist": "是，药剂师说的",
  "review.no": "不是",
  "review.unsure": "不记得",
  "review.inferred.doctor": "好像是医生说的",
  "review.inferred.dispenser": "好像是柜台说的",
  "review.inferred.pharmacist": "好像是药剂师说的",
  "review.youAsked": "你问：",
  "review.onYourList": "问题单上：",
  "review.checks.section": "你说到的，和你的记录",
  "review.checks.said": "就诊时说到：",
  "review.listen": "听这一句",
  "review.noClip": "这一句没有录音片段",
  "review.translationPending": "中文翻译还没有：先听原声。",
  "review.translationTag": "翻译 · 以原话为准",
  "review.summaryTitle": "认好了。",
  "review.summarySub": "{n} 件你认了「是」。下面每一件都能改。",
  "review.confirmedTitle": "记好了",
  "review.save": "就这样，存好",
  "review.change": "改一下",
  "review.verdict.right": "医生说",
  "review.verdict.right.dispenser": "柜台说",
  "review.verdict.right.pharmacist": "药剂师说",
  "review.verdict.wrong": "你说不对 · 已加进问题单",
  "review.verdict.unsure": "不记得",
  "review.verdict.none": "还没认",
  "review.next.meds": "看我的药物",
  "review.next.medsSub": "医生开的药在「我的药物」里，等你拍药袋。",
  "review.next.today": "回到今天",
  "review.retainUntil": "录音留到 {date}",
  "review.keptForever": "录音一直保留",
  "review.keepOn": "一直保留这段录音",
  "review.keepOff": "不用一直保留",
  // the transcript could not be made (the server used up its attempts): the recording is still his
  "review.transcriptFailed": "这段录音没能转成文字。",
  "review.transcriptFailedSub": "录音（{min} 分 {sec} 秒）还在，可以听，也可以自己记一句。",
  // 「先自己记一句」: his own note about a visit that waits for its text (never the doctor's words)
  "review.ownNote.label": "先自己记一句",
  "review.ownNote.placeholder": "写一句你想记住的话",
  "review.ownNote.hint": "这是你自己的笔记，不算医生说的。",
  "review.ownNote.save": "保存",
  "review.ownNote.failed": "未能保存，再试一次。",
  "review.ownNote.section": "你自己记的",
  "review.ownNote.tag": "本人记的",
  // his consent to AI processing is off now: said on the review, with the way to change it. In the present tense: the
  // sentence is about his setting as it is, not about how this visit's record was made (a visit made while it was on
  // keeps its points and its translations)
  "review.aiOff": "AI 处理现在没开：就诊的事项只按固定规则找，医生的英文原话不翻译。",
  "review.aiOffChange": "去「我」里改",
  // round three: how THIS visit's record was made (kept with the visit), in the past tense: it stays true whatever his
  // setting is today, and is not said about a visit that was made with AI on
  "review.aiOffMade": "本次就诊做记录时 AI 处理没开：事项只按固定规则找，医生的英文原话没有翻译。",
  // the example account's sample visit, on every screen of its review
  "review.sample": "示例回放",
  "review.sampleNote": "示例：陈先生的就诊",
  // 「哪几句是我说的」 (real-app 2.15): the lines whose speaker nobody could tell
  "review.mine.section": "哪几句是你说的？",
  "review.mine.sub": "这几句没听出是谁说的。",
  "review.mine.yes": "是我说的",
  "review.mine.undo": "不是我说的",
  "review.mine.stateYes": "你说的",
  "review.mine.stateNo": "没听出是谁说的",
  // the follow-up planned from this visit (real-app 2.15): 「大约 11月20日」, changed to the day he booked
  "review.followUp.section": "复诊",
  "review.followUp.approx": "大约 {date}",
  "review.followUp.booked": "{date} · 你约的日子",
  "review.followUp.change": "改成我约的日子",
  "review.followUp.label": "你约的是哪一天？",
  "review.followUp.save": "就这一天",
  "review.followUp.cancel": "不改了",
  "review.followUp.bad": "这一天不行。选今天或以后的日子。",
} as const;

export type AccountKey = keyof typeof zh;

const en: Record<AccountKey, string> = {
  "visit.sample": "Sample visit · replay",
  "visit.sampleLabel": "Sample replay",
  "visit.empty": "No visits yet",
  "visit.start": "Start the visit",
  "visit.noService": "No transcription for now · recordings are saved, the words come later",
  "visit.planned.today": "Today's follow-up (planned)",
  "visit.planned.about": "Follow-up around {date} (planned)",
  "visit.planned.on": "Follow-up on {date} (planned)",
  "visit.planned.book": "The day I booked",
  "visit.book.title": "Which day is your follow-up?",
  "visit.book.sub": "Pick the day you booked. Now it says: {label}",
  "visit.book.save": "Save",
  "visit.book.failed": "That was not saved. Try again.",
  "visit.before": "Visit brief",
  "visit.beforeSub": "Your readings, doses and questions since the last visit",
  "visit.unfinished": "Visits not finished",
  "visit.unfinished.recording": "{date} · recording stopped half way",
  "visit.unfinished.transcribing": "{date} · turning it into text",
  "visit.unfinished.awaiting": "{date} · recording saved, waiting for the text",
  "visit.unfinished.failed": "{date} · the recording could not be turned into text",
  "visit.unfinished.review": "{date} · not checked yet",
  "visit.unfinished.end": "Finish it",
  "visit.unfinished.open": "Open",
  "visit.past.row": "{date} · {place}",
  "visit.consentNote": "Kept for 90 days, or for good if you choose; stored in your own record",
  "visit.declined": "No recording this time.",
  "visit.declinedSub": "You can photograph the prescription and the medicine label.",
  "visit.declinedPhoto": "Photograph the label",
  "visit.back": "Back",
  "visit.decline": "The doctor does not agree",
  "visit.declineFailed": "The doctor's no is not saved yet.",
  "visit.reopened": "The visit on {date} is not finished.",
  "visit.reopened.looking": "Looking for this visit's recording…",
  "visit.reopened.saved": "The recording is saved. It is not text yet.",
  "visit.reopened.none": "This phone has no recording of this visit.",
  "visit.reopened.noneSub": "If you recorded it on another phone, open Visit on that phone: it can still be uploaded from there.",
  "visit.reopened.endEmpty": "End this visit",
  "visit.mic.denied": "The phone did not allow the microphone. Nothing is being recorded.",
  "visit.mic.deniedSub": "In the phone's Settings, find this browser and turn the microphone on, then tap Try again.",
  "visit.mic.unavailable": "This phone cannot use a microphone. Nothing is being recorded.",
  "visit.mic.unavailableSub": "Try again on another phone, or photograph the prescription and the medicine label.",
  "visit.noCaptions": "No live captions · the recording is saved",
  "visit.captionsDown": "The transcription service is not answering, so there are no captions this time: the recording is saved as usual. The text comes after.",
  "visit.captionsStopped": "Captions stopped: the transcription service is not answering. The recording goes on; the text comes after.",
  "visit.captionsLate": "Captions are running a little late; the recording goes on.",
  "visit.captionLost": "One sentence got no caption. It is in the recording and will be in the text afterwards.",
  "visit.sampleCaptions": "Sample replay: the captions come from the recorded example.",
  "visit.saving": "Saving the recording…",
  "visit.transcribing": "Turning it into text…",
  "visit.uploadFailed": "The recording did not upload. It is still on the phone.",
  "visit.uploadAgain": "Upload again",
  "visit.failed": "That did not work. The recording is kept. Try again in a moment.",
  "visit.tryAgain": "Try again",
  "visit.resumeTitle": "Your last recording ({min} min {sec} s) is not uploaded yet.",
  "visit.resumeSend": "Upload it now",
  "visit.savingProgress": "{done} of {total} minutes saved.",
  "visit.room.low": "This phone has room for about {min} more minutes of recording.",
  "visit.room.none": "This phone is full. Make some room before you record.",
  "visit.room.soon": "The phone is nearly full: about {min} more minutes of recording.",
  "visit.room.full": "The phone is full. Keep this page open and upload as soon as you finish.",
  "visit.limit.soon": "This recording is very long: in about {min} minutes it stops by itself and is saved.",
  "today.visit": "Visit",
  "today.visitWaiting": "Visit on {date} · recording saved, waiting for the text",
  "today.visitFailed": "Visit on {date} · the recording could not be turned into text",

  "review.context": "Visit on {date}",
  "review.awaiting": "Recording saved. No text yet.",
  "review.awaitingSub": "The recording ({min} min {sec} s) is saved. Once transcription is connected the text comes, and you will be told.",
  "review.awaitingNoAudio": "This visit has no recording or text yet.",
  "review.listenRecording": "Listen to the recording",
  "review.empty": "Nothing was recorded",
  "review.emptySub": "No speech was heard, so this does not count as a visit. If you did speak, the microphone may have sent no sound: check that the headset or microphone is on and record again.",
  "review.ask.doctor": "Did the doctor say this?",
  "review.ask.dispenser": "Did the clinic counter say this?",
  "review.ask.pharmacist": "Did the pharmacist say this?",
  "review.yes.doctor": "Yes, the doctor did",
  "review.yes.dispenser": "Yes, the counter did",
  "review.yes.pharmacist": "Yes, the pharmacist did",
  "review.no": "No",
  "review.unsure": "Don't remember",
  "review.inferred.doctor": "Maybe the doctor",
  "review.inferred.dispenser": "Maybe the clinic counter",
  "review.inferred.pharmacist": "Maybe the pharmacist",
  "review.youAsked": "You asked: ",
  "review.onYourList": "On your list: ",
  "review.checks.section": "What came up, and your records",
  "review.checks.said": "Said in the visit: ",
  "review.listen": "Listen to this line",
  "review.noClip": "No clip for this line",
  "review.translationPending": "No Chinese translation yet: listen to the original.",
  "review.translationTag": "Translation · the original is what counts",
  "review.summaryTitle": "All checked.",
  "review.summarySub": "You said yes to {n}. You can change any of them.",
  "review.confirmedTitle": "Saved",
  "review.save": "Save these",
  "review.change": "Change",
  "review.verdict.right": "Doctor said",
  "review.verdict.right.dispenser": "Counter said",
  "review.verdict.right.pharmacist": "Pharmacist said",
  "review.verdict.wrong": "You said not right · on your question list",
  "review.verdict.unsure": "Don't remember",
  "review.verdict.none": "Not checked",
  "review.next.meds": "My medicines",
  "review.next.medsSub": "The doctor's new medicine is on your list, waiting for its label.",
  "review.next.today": "Back to today",
  "review.retainUntil": "Recording kept until {date}",
  "review.keptForever": "Recording kept for good",
  "review.keepOn": "Keep this recording for good",
  "review.keepOff": "No need to keep it for good",
  "review.transcriptFailed": "This recording could not be turned into text.",
  "review.transcriptFailedSub": "The recording ({min} min {sec} s) is still here. You can listen to it, or write a line yourself.",
  "review.ownNote.label": "Write a line yourself",
  "review.ownNote.placeholder": "One line you want to remember",
  "review.ownNote.hint": "This is your own note. It does not count as what the doctor said.",
  "review.ownNote.save": "Save the line",
  "review.ownNote.failed": "Not saved. Try again.",
  "review.ownNote.section": "Your own notes",
  "review.ownNote.tag": "Written by you",
  "review.aiOff": "AI processing is off now: a visit's points are found by fixed rules only, and the doctor's English is not translated.",
  "review.aiOffChange": "Change it under Me",
  "review.aiOffMade": "AI processing was off when this visit's record was made: its points were found by fixed rules only, and the doctor's English was not translated.",
  "review.sample": "Sample replay",
  "review.sampleNote": "Example: Mr Tan's visit",
  "review.mine.section": "Which lines were yours?",
  "review.mine.sub": "Ripple could not tell who said these.",
  "review.mine.yes": "I said this",
  "review.mine.undo": "Not me",
  "review.mine.stateYes": "You said this",
  "review.mine.stateNo": "Speaker not known",
  "review.followUp.section": "Follow-up",
  "review.followUp.approx": "About {date}",
  "review.followUp.booked": "{date} · the day you booked",
  "review.followUp.change": "Change to the day I booked",
  "review.followUp.label": "Which day did you book?",
  "review.followUp.save": "This day",
  "review.followUp.cancel": "Leave it",
  "review.followUp.bad": "That day does not work. Choose today or a later day.",
};

const TABLE: Record<AccountLocale, Record<AccountKey, string>> = { "zh-Hans": zh, en };

export function at(locale: AccountLocale, key: AccountKey, vars: Record<string, string | number> = {}): string {
  let s = TABLE[locale][key] ?? TABLE["zh-Hans"][key];
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** The clinician a review line asks about: the counter and the pharmacist have their own words; anyone else is the doctor. */
export function reviewSpeaker(role: UtteranceRole): "doctor" | "dispenser" | "pharmacist" {
  return role === "dispenser" || role === "pharmacist" ? role : "doctor";
}

// ------------------------------------------------------------------ dates (real dates, never "Day N")

const WEEK_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const WEEK_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(iso: string): { y: number; m: number; d: number; w: number } {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { y, m, d, w: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** "10月12日" / "12 Oct" */
export function shortDate(iso: string, locale: AccountLocale): string {
  const p = parts(iso);
  return locale === "en" ? `${p.d} ${MONTH_EN[p.m - 1]}` : `${p.m}月${p.d}日`;
}

/** "10月12日 周一" / "Mon 12 Oct" */
export function dayLabel(iso: string, locale: AccountLocale): string {
  const p = parts(iso);
  return locale === "en" ? `${WEEK_EN[p.w]} ${p.d} ${MONTH_EN[p.m - 1]}` : `${p.m}月${p.d}日 ${WEEK_ZH[p.w]}`;
}

/** "上午 9:30" / "9:30 am" from "09:30" */
export function clockLabel(hhmm: string, locale: AccountLocale): string {
  const [h, m] = hhmm.split(":").map(Number);
  const mm = String(m).padStart(2, "0");
  if (locale === "en") return `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? "am" : "pm"}`;
  const part = h < 12 ? "上午" : h < 18 ? "下午" : "晚上";
  return `${part} ${h > 12 ? h - 12 : h}:${mm}`;
}

/** The top line of his screen: "10月12日 周一 · 上午 9:30" / "Mon 12 Oct · 9:30 am". */
export function metaLine(iso: string, hhmm: string | null, locale: AccountLocale): string {
  return hhmm ? `${dayLabel(iso, locale)} · ${clockLabel(hhmm, locale)}` : dayLabel(iso, locale);
}

/** Where in a recording: "0:49", "12:30". */
export function clipTimeLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Minutes and seconds of a duration, for 「12 分 30 秒」. */
export function minSec(ms: number): { min: number; sec: number } {
  const s = Math.max(0, Math.round(ms / 1000));
  return { min: Math.floor(s / 60), sec: s % 60 };
}
