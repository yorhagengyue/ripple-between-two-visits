/**
 * UI words for the medicine screens (M3), same pattern as lib/i18n.ts: add to `en` first, `zhHans` is typed
 * against it. Source chips (医生说 / 药袋 / 单张 ...) and the page titles come from lib/i18n.ts.
 *
 * UI chrome and the patient's own questions only. No clinical sentence lives here: what a medicine is for, how
 * to take it and the unknown-medicine sentence come from lib/safety (templates, the three checks) or are the
 * label's, the doctor's or the leaflet's own words. The two question texts below are entries for the question
 * list, phrased as his question to the pharmacist; they make no judgement. Client-safe.
 */
import type { Locale } from "@/lib/i18n";

const en = {
  "meds.add": "Photograph a label",
  "meds.empty": "No medicines on your list yet.",
  "meds.open": "Open",

  "origin.prescription": "From the doctor",
  "origin.self_bought": "Bought myself",
  "origin.relative": "From a relative",
  "origin.supplement": "Supplements",

  "status.awaiting_label": "Awaiting label",
  "status.label_confirmed": "Label confirmed",
  "status.pharmacist_checked": "Checked by pharmacist",
  "status.unverified": "Not checked",
  "status.unidentified": "Not identified",

  "name.unknown": "A medicine Ripple can't identify",

  "card.purpose": "What it is for",
  "card.howToTake": "How to take it",
  "card.leaflet": "From the leaflet",
  "card.unknown": "Ripple can't identify this",
  "card.awaiting": "Awaiting label",
  "card.awaitingBody": "How to take it will come from your medicine label. Photograph the label and check it.",
  "card.photograph": "Photograph the label",
  "card.relabel": "New label? Photograph it again",
  "card.original": "On the label: {text}",
  "card.questionFor": "On your question list for the pharmacist",
  "card.questionAnswered": "Answered",
  "card.questionOpen": "Not answered yet",
  "card.answer": "The answer",
  "card.pickAnswer": "Which line from the recording answers this question?",
  "card.thisIsAnswer": "This answers it",
  "card.linking": "Saving…",
  "card.whoSaid": "Choose who said this line",
  "card.answerUnnamed": "Answer saved. Nobody is named as the speaker, so this line is not shown here.",
  "card.answerNotShown": "Answer saved. This line is not shown here.",
  "speaker.pharmacist": "The pharmacist",
  "speaker.doctor": "The doctor",
  "speaker.dispenser": "The clinic counter",
  "speaker.unsure": "Not sure",
  "card.hiddenParts": "{n} leaflet part is waiting for review and is not shown.",
  "card.hiddenPartsMany": "{n} leaflet parts are waiting for review and are not shown.",
  "card.back": "My medicines",

  "chip.ripple": "Ripple",
  "chip.records": "Your records",
  "chip.recording": "Recording",
  "chip.standIn": "stand-in voice",
  "chip.draft": "draft wording",
  "chip.at": "at {time}",

  "ask.title": "Ask about this",
  "ask.placeholder": "Type your question",
  "ask.send": "Ask",
  "ask.sending": "Asking…",
  "ask.purpose": "What is this medicine for?",
  "ask.missed": "What if I forget a dose?",
  "ask.together": "Can I take it with my other medicines?",
  "ask.added": "Added to your question list.",
  "ask.error": "Couldn't ask just now. Try again.",
  "ask.limit": "Too many questions for now. Try again later.",

  "add.title": "Photograph a label",
  "add.forMed": "Label for {name}",
  "add.originQ": "Where is this medicine from?",
  "add.photoQ": "Photograph the label or the box",
  "add.takePhoto": "Take a photo",
  "add.samples": "No label at hand? Use a sample photo:",
  "add.sample.amlodipine": "Clinic label (amlodipine)",
  "add.sample.ibuprofen": "Painkiller box (ibuprofen)",
  "add.sample.relative_box": "Box from a relative",
  "add.uploading": "Sending the photo…",
  "add.reading": "Reading the label…",
  "add.checkQ": "Check each line against the label",
  "add.checkHint": "Tap “Right” on each line that matches what is printed.",
  "add.field.drug_text": "Medicine",
  "add.field.strength": "Strength",
  "add.field.directions": "How to take (label)",
  "add.field.dispensed": "Dispensed on",
  "add.field.clinic": "Clinic",
  "add.notOnLabel": "Not on the label",
  "add.right": "Right",
  "add.isRight": "Right ✓",
  "add.save": "Save to my medicines",
  "add.saving": "Saving…",
  "add.retake": "Retake the photo",
  "add.unreadable": "Ripple couldn't read this photo. Try again with the label flat and in good light.",
  "add.failed": "Something went wrong. Try again.",
  "add.mismatch": "This label is for a different medicine.",
  "add.done": "Saved",
  "add.openCard": "Open the medicine card",
  "add.another": "Photograph another label",
  "add.questionAdded": "Added to your question list for the pharmacist:",

  // question list entries (his questions, phrased in the first person; no judgement)
  "question.otherMeds": "ask the pharmacist about taking this with my other medicines",
  "question.unknown": "What is this medicine? The box says: {name}",
} as const;

export type MedsKey = keyof typeof en;

const zhHans: Record<MedsKey, string> = {
  "meds.add": "拍药袋",
  "meds.empty": "药单里还没有药。",
  "meds.open": "打开",

  "origin.prescription": "医生开的",
  "origin.self_bought": "自己买的",
  "origin.relative": "亲戚带的",
  "origin.supplement": "保健品",

  "status.awaiting_label": "等药袋确认",
  "status.label_confirmed": "药袋已确认",
  "status.pharmacist_checked": "药剂师已核对",
  "status.unverified": "未核对",
  "status.unidentified": "认不出",

  "name.unknown": "Ripple 认不出的药",

  "card.purpose": "用途",
  "card.howToTake": "用法",
  "card.leaflet": "单张要点",
  "card.unknown": "Ripple 认不出这个药",
  "card.awaiting": "等药袋确认",
  "card.awaitingBody": "用法以药袋为准。拍下药袋、逐项对过之后会补上。",
  "card.photograph": "拍药袋",
  "card.relabel": "药袋换了？重新拍",
  "card.original": "药袋原文：{text}",
  "card.questionFor": "已在问题单里，问药剂师",
  "card.questionAnswered": "已回答",
  "card.questionOpen": "尚未回答",
  "card.answer": "回答",
  "card.pickAnswer": "录音里哪一句回答了这个问题？",
  "card.thisIsAnswer": "就是这句",
  "card.linking": "正在保存…",
  "card.whoSaid": "选出说这句话的人",
  "card.answerUnnamed": "回答已存。没有选出是谁说的，这句先不在这里显示。",
  "card.answerNotShown": "回答已存，这句先不在这里显示。",
  "speaker.pharmacist": "药剂师",
  "speaker.doctor": "医生",
  "speaker.dispenser": "诊所柜台",
  "speaker.unsure": "不确定",
  "card.hiddenParts": "有 {n} 段单张内容在等审核，暂不显示。",
  "card.hiddenPartsMany": "有 {n} 段单张内容在等审核，暂不显示。",
  "card.back": "我的药",

  "chip.ripple": "Ripple",
  "chip.records": "你的记录",
  "chip.recording": "录音",
  "chip.standIn": "代录音",
  "chip.draft": "草稿措辞",
  "chip.at": "{time} 处",

  "ask.title": "问这个",
  "ask.placeholder": "打字提问",
  "ask.send": "问",
  "ask.sending": "正在问…",
  "ask.purpose": "这个药是做什么的？",
  "ask.missed": "忘了吃怎么办？",
  "ask.together": "可以和我其他的药一起吃吗？",
  "ask.added": "已加入问题单。",
  "ask.error": "现在问不了，请再试一次。",
  "ask.limit": "问得太多了，请晚一点再试。",

  "add.title": "拍药袋",
  "add.forMed": "{name} 的药袋",
  "add.originQ": "这个药是哪里来的？",
  "add.photoQ": "拍药袋或药盒",
  "add.takePhoto": "拍照",
  "add.samples": "手边没有药袋？用示例照片：",
  "add.sample.amlodipine": "诊所药袋（amlodipine）",
  "add.sample.ibuprofen": "止痛药盒（ibuprofen）",
  "add.sample.relative_box": "亲戚带的药盒",
  "add.uploading": "正在传照片…",
  "add.reading": "正在读药袋…",
  "add.checkQ": "对着药袋，逐项核对",
  "add.checkHint": "和药袋上印的一样，就按「对」。",
  "add.field.drug_text": "药名",
  "add.field.strength": "规格",
  "add.field.directions": "用法（药袋）",
  "add.field.dispensed": "配药日期",
  "add.field.clinic": "诊所",
  "add.notOnLabel": "药袋上没有",
  "add.right": "对",
  "add.isRight": "对 ✓",
  "add.save": "写进我的药",
  "add.saving": "正在保存…",
  "add.retake": "重拍",
  "add.unreadable": "Ripple 读不出这张照片。把药袋放平、光线亮一点再拍一次。",
  "add.failed": "出了点问题，请再试一次。",
  "add.mismatch": "这个药袋是另一种药的。",
  "add.done": "已保存",
  "add.openCard": "打开这种药的卡",
  "add.another": "再拍一个",
  "add.questionAdded": "已加进问题单（问药剂师）：",

  "question.otherMeds": "这个药和我其他的药一起吃，要问药剂师",
  "question.unknown": "这盒药是什么？盒子上写着：{name}",
};

const messages: Record<Locale, Record<MedsKey, string>> = { en, "zh-Hans": zhHans };

export function mt(locale: Locale, key: MedsKey, vars?: Record<string, string | number>): string {
  const template = messages[locale][key] ?? en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole));
}

/** "2026-09-01" -> "1 Sep 2026" / "2026年9月1日" */
export function formatDate(locale: Locale, iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (locale === "zh-Hans") return `${y}年${mo}月${d}日`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[mo - 1]} ${y}`;
}

/** 42000 -> "0:42" (time point in a visit recording) */
export function formatClipTime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
