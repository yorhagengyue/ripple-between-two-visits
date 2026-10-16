/**
 * Every word of the long press (owner's decision of 10-14, modelled on his iOS app's Explain sheet and its first-time
 * coach: RippleApp/Explain/ExplainSheet.swift, LongPressCoach.swift), in 华语 and English: the sheet's own words, the
 * coach, and the short factual lines lib/explain/evidence.ts builds from his records (「Ripple 查看了什么」 and the
 * sentence at the top when no model wrote one).
 *
 * The lines here only state what a record holds: a number he typed, a date, a count, who said a line and when. The one
 * comparison is with the doctor's own number, in the doctor's own direction (「低于 135/85」: below, or not below; the
 * warning line: above), as lib/summary/bp.ts counts it. Nothing here says what to take, names an illness, or says how he
 * is. Client-safe.
 *
 * Two readers (owner's decision of 10-14: the long press is on the family side too). Every function here takes the
 * reader as its last argument (subjects.ts WordsViewer), and each set of words has two versions side by side:
 *   his    the elder's own words, addressed to him (「你」); since the owner's decision of 10-14 in professional words too
 *          (已服 / 未服 / 未回应, 测量, 就诊, 尚未记录; 早间 / 午间 / 晚间 / 睡前 through lib/daily/i18n.ts), still short
 *   hers   the same facts for a family member who reads through her care link: about him in the third person (how she
 *          calls him, 「爸爸」; in English that name and "he / his", or "she / her" when her word is 妈妈, the word itself
 *          when it is a name: lib/care/copy.ts elderWords) and in the family side's vocabulary: 已服药 / 未服药 /
 *          未回应, 血压测量, 就诊, 待问医生, 医生已答复; 早间 / 午间 / 晚间 / 睡前; "Taken / Not taken / No response",
 *          "blood pressure reading", "clinic visit". Never 「你」 for him, never the old elder words 吃了 / 没吃 / 没回 / 看诊.
 *          tests/unit/explain/family-viewer.test.ts holds every one of her lines to this.
 */
import { elderWords } from "@/lib/care/copy";
import { clockWords, dt, shortDay, shortTime, type DailyKey } from "@/lib/daily/i18n";
import type { DaySlot } from "@/lib/store/types";
import type { HoldLocale, WordsViewer } from "./subjects";

const pick = <T>(locale: HoldLocale, zh: T, en: T): T => (locale === "zh-Hans" ? zh : en);

const SELF: WordsViewer = { kind: "self" };

/** "dad" -> "Dad" at the head of an English sentence (a name she typed stays as she typed it otherwise). */
const capFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "1 reading" / "3 readings" */
const n1 = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------- the sheet, the hidden button, the coach

export function holdWords(locale: HoldLocale, viewer: WordsViewer = SELF) {
  const his = {
    /** the hidden button every held element carries (keyboard, screen reader) */
    ask: pick(locale, "问 Ripple", "Ask Ripple"),
    sheetTitle: pick(locale, "Ripple 的解读", "Ripple's read"),
    close: pick(locale, "关", "Close"),
    loading: pick(locale, "正在看…", "Looking…"),
    /** SSE (owner 10-15): Ripple is writing the sentence (its words follow as they come) */
    writing: pick(locale, "正在写…", "Writing…"),
    failed: pick(locale, "现在看不了，过一会儿再试。", "Can't look right now. Try again in a while."),
    retry: pick(locale, "再试一次", "Try again"),
    gone: pick(locale, "这条记录找不到了。", "This record is no longer there."),
    checked: pick(locale, "Ripple 查看了什么", "What Ripple checked"),
    sources: pick(locale, "医生和药袋的原话", "The doctor's and the label's own words"),
    disclaimer: pick(locale, "来自你的记录和医生的原话，不是医疗建议。", "From your records and your doctor's own words. Not medical advice."),
    add: pick(locale, "加入问题单", "Add to my questions"),
    added: pick(locale, "已加入问题单", "Added to your questions"),
    onList: pick(locale, "已在问题单中", "Already on your questions"),
    // hers only: he set these words aside, and her tap does not put them back (his own add puts his question back)
    aside: pick(locale, "你先放一边了", "You set it aside"),
    addFailed: pick(locale, "未能加入，请再试一次。", "Not added. Try again."),
    askMore: pick(locale, "继续提问", "Ask one more thing"),
    coachTitle: pick(locale, "按住任何一样东西，Ripple 帮你看", "Hold anything. Ripple investigates."),
    coachBody: pick(
      locale,
      "药物、血压、就诊、问题，按住半秒。Ripple 会找出医生说过的话和你的记录。",
      "A medicine, a reading, a visit, a question: hold it for half a second. Ripple finds what your doctor said and what your records show.",
    ),
    coachSmall: pick(locale, "没有聊天框，对什么好奇就按住它。", "No chat box. No AI button. Just hold the thing you're curious about."),
    coachOk: pick(locale, "知道了", "Got it"),
  };
  if (viewer.kind !== "family") return his;
  // hers: the sheet's own words stay; what speaks to him, or of his list as "yours", is said about him. The coach and
  // 「再问一句」 are his side's only (her sheet draws neither).
  const dad = viewer.dad;
  const hers: typeof his = {
    ...his,
    loading: pick(locale, "正在查看…", "Looking…"),
    failed: pick(locale, "暂时无法查看，请稍后再试。", "Can't look right now. Try again in a while."),
    gone: pick(locale, "这条记录已不存在，或未分享。", "This record is no longer there, or is not shared."),
    sources: pick(locale, "医生原话与药品标签", "The doctor's own words and the label"),
    disclaimer: pick(locale, `根据${dad}同意分享的记录写成，不是医嘱。`, `Written from the records ${dad} agreed to share. Not medical advice.`),
    // the question may be for the doctor or for the pharmacist (HoldRead.ask.for): the button names the list, not the person
    // the words of her 「留意」 (lib/care/record-copy.ts addBtn, added)
    add: pick(locale, "加入问题单", "Add to the question list"),
    added: pick(locale, "已加入问题单", "On the question list"),
    onList: pick(locale, "已在问题单中", "Already on the question list"),
    aside: pick(locale, `${dad}已将这个问题搁置`, `${dad} has set this question aside`),
    addFailed: pick(locale, "未能加入，请再试一次。", "Not added. Try again."),
  };
  return hers;
}

/**
 * The question 「加进问题单」 puts on his list: the thing's name in a fixed frame (he can change the words on the list).
 * Hers: a question about him for the doctor (or the pharmacist, when the thing is the pharmacist's to explain: `who`),
 * in the family side's register (the name is the family sheet's own).
 */
export function askAboutText(locale: HoldLocale, name: string, viewer: WordsViewer = SELF, who: "doctor" | "pharmacist" = "doctor"): string {
  if (viewer.kind === "family") return pick(locale, `关于${name}，想请${who === "pharmacist" ? "药剂师" : "医生"}说明。`, `About ${name}: please explain.`);
  return pick(locale, `想问问：${name}`, `I want to ask about: ${name}`);
}

/** Where a medicine came from, for her: the medicine list's words (「医生开的」, 「亲戚带的」) in the family side's register. */
export function familyOriginWords(locale: HoldLocale, origin: string): string {
  const zh: Record<string, string> = { prescription: "医生处方。", self_bought: "自行购买。", relative: "亲属提供。", supplement: "保健品。" };
  const en: Record<string, string> = { prescription: "Prescribed by the doctor.", self_bought: "Bought without a prescription.", relative: "Given by a relative.", supplement: "A supplement." };
  return pick(locale, zh[origin] ?? "来源未记录。", en[origin] ?? "Origin not recorded.");
}

// ---------------------------------------------------------------- the lines built from his records

export type Clinician = "doctor" | "dispenser" | "pharmacist";

export function factWords(locale: HoldLocale, viewer: WordsViewer = SELF) {
  return viewer.kind === "family" ? herFactWords(locale, viewer.dad) : hisFactWords(locale);
}

/** His own words: addressed to him, as his screens speak. Not to be changed for the family side (hers are below). */
function hisFactWords(locale: HoldLocale) {
  const zh = locale === "zh-Hans";
  const day = (iso: string) => shortDay(locale, iso);
  const clock = (hhmm: string) => clockWords(locale, hhmm);
  const part = (slot: DaySlot) => dt(locale, `slot.${slot}` as DailyKey);
  const slotMed = (slot: DaySlot) => dt(locale, `slotMed.${slot}` as DailyKey);
  const who = (c: Clinician | null) =>
    c === "pharmacist" ? pick(locale, "药剂师", "the pharmacist") : c === "dispenser" ? pick(locale, "柜台", "the counter staff") : pick(locale, "医生", "your doctor");
  const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const about = (approx: boolean) => (approx ? pick(locale, "大约 ", "about ") : "");
  const week = (current: boolean) => pick(locale, current ? "这周" : "那一周", current ? "This week" : "That week");
  const list = (xs: string[]) => xs.join(zh ? "、" : ", ");

  return {
    day,
    clock,
    part,
    slotMed,
    who,
    list,

    // ---- blood pressure
    bpName: (s: number, d: number, date: string) => pick(locale, `血压 ${s}/${d} · ${day(date)}`, `Blood pressure ${s}/${d}, ${day(date)}`),
    bpNoneName: (date: string, slot: DaySlot) => pick(locale, `${day(date)} ${part(slot)} 未测量`, `${day(date)}, ${part(slot).toLowerCase()}: not measured`),
    /** `time`: HH:MM for a reading of today; an earlier one says its part of the day (a laid-out record has no clock time of its own) */
    bpReading: (s: number, d: number, date: string, slot: DaySlot, time: string | null) =>
      pick(locale, `本次：${s}/${d}，${day(date)} ${time ? clock(time) : part(slot)} 记录。`, `This reading: ${s}/${d}, recorded ${day(date)}, ${time ? clock(time) : part(slot).toLowerCase()}.`),
    bpNotMeasured: (date: string, slot: DaySlot) => pick(locale, `${day(date)} ${part(slot)}未测量。`, `${day(date)}, ${part(slot).toLowerCase()}: no reading was taken.`),
    doctorTarget: (s: number, d: number, date: string) =>
      pick(locale, `医生的数字：低于 ${s}/${d}（${day(date)} 就诊时说的）。`, `Your doctor's number: below ${s}/${d} (said at the visit on ${day(date)}).`),
    noTarget: pick(locale, "记录里尚无医生给的血压数字。", "Your records hold no blood-pressure number from your doctor yet."),
    doctorWarning: (t: number, date: string) =>
      pick(locale, `医生的警示线：上面的数字超过 ${t}（${day(date)} 就诊时说的）。`, `Your doctor's warning line: a top number above ${t} (said at the visit on ${day(date)}).`),
    weekReadings: (current: boolean, from: string, to: string, n: number, s: number, d: number) =>
      pick(locale, `${week(current)}（${day(from)}到${day(to)}）测量 ${n} 次，平均 ${s}/${d}。`, `${week(current)} (${day(from)} to ${day(to)}): ${n1(n, "reading", "readings")}, average ${s}/${d}.`),
    weekNone: (current: boolean, from: string, to: string) =>
      pick(locale, `${week(current)}（${day(from)}到${day(to)}）暂无读数。`, `${week(current)} (${day(from)} to ${day(to)}): no readings yet.`),
    weekSkipped: (n: number) => pick(locale, `有 ${n} 次未测量。`, `${n1(n, "time", "times")} not measured.`),
    notBelow: (k: number) =>
      k === 0
        ? pick(locale, "都低于医生的数字。", "All were below your doctor's number.")
        : pick(locale, `其中 ${k} 次不低于医生的数字。`, `${k} of them ${k === 1 ? "was" : "were"} not below your doctor's number.`),
    bpName_week: (from: string, to: string) => pick(locale, `血压 · ${day(from)}到${day(to)}`, `Blood pressure, ${day(from)} to ${day(to)}`),
    vBpNotBelow: (s: number, d: number, ts: number, td: number) =>
      pick(locale, `这次 ${s}/${d}，不低于医生说的 ${ts}/${td}。`, `This reading, ${s}/${d}, is not below the ${ts}/${td} your doctor said.`),
    vBpBelow: (s: number, d: number, ts: number, td: number) =>
      pick(locale, `这次 ${s}/${d}，低于医生说的 ${ts}/${td}。`, `This reading, ${s}/${d}, is below the ${ts}/${td} your doctor said.`),
    vBpNoTarget: (s: number, d: number) =>
      pick(locale, `本次记录为 ${s}/${d}。记录里尚无医生给的数字，可以问医生。`, `This reading is ${s}/${d}. Your records hold no number from your doctor to set it against; you can ask your doctor.`),
    vBpAboveWarning: (s: number, t: number) =>
      pick(locale, `这次上面的数字是 ${s}，超过医生说的 ${t}。医生的原话在下面。`, `The top number of this reading, ${s}, is above the ${t} your doctor said. Your doctor's own words are below.`),
    vBpNotMeasured: (date: string, slot: DaySlot) => pick(locale, `${day(date)} ${part(slot)}没有读数。`, `There is no reading for ${day(date)}, ${part(slot).toLowerCase()}.`),
    vWeekTarget: (current: boolean, n: number, s: number, d: number, k: number, ts: number, td: number) =>
      pick(
        locale,
        `${week(current)}测量 ${n} 次，平均 ${s}/${d}；${k} 次不低于医生说的 ${ts}/${td}。`,
        `${week(current)}: ${n1(n, "reading", "readings")}, average ${s}/${d}; ${k} not below the ${ts}/${td} your doctor said.`,
      ),
    vWeekNoTarget: (current: boolean, n: number, s: number, d: number) =>
      pick(locale, `${week(current)}测量 ${n} 次，平均 ${s}/${d}。记录里尚无医生给的数字。`, `${week(current)}: ${n1(n, "reading", "readings")}, average ${s}/${d}. Your records hold no number from your doctor yet.`),
    vWeekNone: (current: boolean) => pick(locale, `${week(current)}暂无血压读数。`, `${week(current)}: no blood-pressure readings yet.`),

    // ---- a medicine
    labelDispensed: (date: string) => pick(locale, `药袋：${day(date)} 配药。`, `Label: dispensed ${day(date)}.`),
    labelChecked: pick(locale, "药袋已核对。", "The label has been checked."),
    labelNone: pick(locale, "尚未拍药袋。", "No label photographed yet."),
    labelTyped: pick(locale, "药袋是你自己填写的，尚未核对。", "You typed the label in yourself; it has not been checked."),
    medUnknown: pick(locale, "这盒药尚未被识别。", "Nobody has identified this medicine yet."),
    medSlots: (slots: DaySlot[], fromLabel: boolean) =>
      pick(locale, `服药时间：${list(slots.map(part))}（${fromLabel ? "依药品标签" : "你选的"}）。`, `When: ${list(slots.map((s) => part(s).toLowerCase()))} (${fromLabel ? "from the label" : "your choice"}).`),
    medNoSlots: pick(locale, "尚未设定服药时间。", "No time of day set yet."),
    labelUnchecked: pick(locale, "药袋尚未核对。", "The label has not been checked yet."),
    spokeAbout: (c: Clinician, date: string) => pick(locale, `${who(c)} ${day(date)} 说过这个药。`, `${cap(who(c))} spoke about it on ${day(date)}.`),
    nobodySpoke: pick(locale, "记录里没有医生或药剂师说这个药的话。", "Your records hold nothing your doctor or pharmacist said about it."),
    doses7: (c: { due: number; taken: number; missed: number; unconfirmed: number }, all: boolean) => {
      const lead = pick(locale, all ? "最近 7 天（所有药物）" : "最近 7 天", all ? "Last 7 days (all medicines)" : "Last 7 days");
      if (c.due === 0) return pick(locale, `${lead}无需记录。`, `${lead}: nothing was due.`);
      const rest = [
        c.missed ? pick(locale, `未服 ${c.missed} 次`, `${c.missed} not taken`) : "",
        c.unconfirmed ? pick(locale, `未回应 ${c.unconfirmed} 次`, `${c.unconfirmed} with no reply`) : "",
      ].filter(Boolean);
      return pick(
        locale,
        `${lead}：应服 ${c.due} 次，已服 ${c.taken} 次${rest.length ? `，${rest.join("，")}` : ""}。`,
        `${lead}: ${c.due} due, ${c.taken} taken${rest.length ? `, ${rest.join(", ")}` : ""}.`,
      );
    },
    vMedSlots: (name: string, slots: DaySlot[], fromLabel: boolean) =>
      pick(
        locale,
        `${name}：${fromLabel ? "药品标签所示时间为" : "你选的时间为"}${list(slots.map(part))}。`,
        `${name}: ${fromLabel ? "the label says" : "you chose"} ${list(slots.map((s) => part(s).toLowerCase()))}.`,
      ),
    vMedDoses: (c: { due: number; taken: number }) => pick(locale, `最近 7 天应服 ${c.due} 次，已服 ${c.taken} 次。`, `Last 7 days: ${c.taken} of ${c.due} taken.`),
    vMedThin: (name: string) =>
      pick(locale, `记录里关于 ${name} 的内容还不多，可以问医生或药剂师。`, `Your records do not say much about ${name} yet; you can ask your doctor or pharmacist.`),

    // ---- one part of one day's medicine
    doseName: (date: string, slot: DaySlot) => pick(locale, `${day(date)} ${slotMed(slot)}`, `${slotMed(slot)}, ${day(date)}`),
    cellTaken: (med: string, time: string | null) => pick(locale, `${med}：${time ? `${shortTime(time)} ` : ""}记录为已服药。`, `${med}: logged as taken${time ? ` at ${shortTime(time)}` : ""}.`),
    cellMissed: (med: string, reason: string | null) => pick(locale, `${med}：记录为未服药${reason ? `，原因：${reason}` : ""}。`, `${med}: logged as not taken${reason ? ` (reason: ${reason})` : ""}.`),
    cellLater: (med: string) => pick(locale, `${med}：选择稍后服用，尚未确认。`, `${med}: “later”, not confirmed yet.`),
    cellNoReply: (med: string, closes: string) => pick(locale, `${med}：截至 ${shortTime(closes)} 未回应。`, `${med}: no reply by ${shortTime(closes)}.`),
    cellOpen: (med: string) => pick(locale, `${med}：尚未记录。`, `${med}: not logged yet.`),
    reminders: (first: string, second: string, closes: string) =>
      pick(
        locale,
        `提醒：${shortTime(first)}，${shortTime(second)} 再次提醒，${shortTime(closes)} 截止。`,
        `Reminders at ${shortTime(first)} and ${shortTime(second)}; the window closes at ${shortTime(closes)}.`,
      ),
    vDoseTaken: (date: string, slot: DaySlot, time: string | null) =>
      pick(locale, `${day(date)}${slotMed(slot)}，记录为已服药${time ? `（${shortTime(time)}）` : ""}。`, `${slotMed(slot)} on ${day(date)}: logged as taken${time ? ` at ${shortTime(time)}` : ""}.`),
    vDoseMissed: (date: string, slot: DaySlot, reason: string | null) =>
      pick(locale, `${day(date)}${slotMed(slot)}，记录为未服药${reason ? `，原因：${reason}` : ""}。`, `${slotMed(slot)} on ${day(date)}: logged as not taken${reason ? ` (reason: ${reason})` : ""}.`),
    vDoseOpen: (date: string, slot: DaySlot) => pick(locale, `${day(date)}${slotMed(slot)}尚未记录。`, `${slotMed(slot)} on ${day(date)}: not logged yet.`),
    vDoseNoReply: (date: string, slot: DaySlot, closes: string) =>
      pick(locale, `${day(date)}${slotMed(slot)}，截至 ${shortTime(closes)} 未回应。`, `${slotMed(slot)} on ${day(date)}: no reply by ${shortTime(closes)}.`),
    vDoseMixed: (date: string, slot: DaySlot, n: number, taken: number, missed: number, open: number) =>
      pick(
        locale,
        `${day(date)}${slotMed(slot)}共 ${n} 种：已服 ${taken} 种，未服 ${missed} 种，尚未记录 ${open} 种。`,
        `${slotMed(slot)} on ${day(date)}, ${n1(n, "medicine", "medicines")}: ${taken} taken, ${missed} not taken, ${open} not logged.`,
      ),

    // ---- a visit
    visitName: (date: string, planned: boolean) => pick(locale, `${day(date)} 就诊${planned ? "（计划）" : ""}`, `${planned ? "Planned visit" : "Visit"}, ${day(date)}`),
    visitWhere: (date: string, place: string) => (place ? pick(locale, `${day(date)}，在 ${place}。`, `${day(date)}, at ${place}.`) : pick(locale, `${day(date)}。`, `${day(date)}.`)),
    visitLines: (n: number) => (n === 0 ? pick(locale, "尚无确认过的话。", "No confirmed lines yet.") : pick(locale, `确认过的话：${n} 句。`, `Confirmed lines: ${n}.`)),
    visitMeds: (names: string[]) => pick(locale, `这次开的药：${list(names)}。`, `Medicines from this visit: ${list(names)}.`),
    visitAnswered: (n: number) => pick(locale, `回答了你 ${n} 个问题。`, `${n} of your questions answered.`),
    recordingKept: pick(locale, "录音还在。", "The recording is kept."),
    recordingDeleted: pick(locale, "录音已经删了，文字还在。", "The recording was deleted; the text is kept."),
    visitReview: pick(locale, "尚未全部确认。", "Not all lines are confirmed yet."),
    visitWaiting: pick(locale, "录音已保存，文字尚未生成。", "The recording is saved; the text is not ready yet."),
    plannedWhen: (date: string, days: number, approx: boolean) =>
      days <= 0
        ? pick(locale, "就是今天。", "It is today.")
        : pick(locale, `${about(approx)}${day(date)}，还有 ${days} 天。`, `${cap(`${about(approx)}${day(date)}`)}, ${n1(days, "day", "days")} away.`),
    visitPlace: (place: string) => pick(locale, `地点：${place}。`, `Where: ${place}.`),
    questionsWaiting: (n: number) =>
      n === 0 ? pick(locale, "问题单里现在没有问题。", "No questions on your list right now.") : pick(locale, `问题单里有 ${n} 个问题等着问。`, `${n1(n, "question waits", "questions wait")} on your list.`),
    lastVisit: (date: string | null) => (date ? pick(locale, `上次就诊：${day(date)}。`, `Last visit: ${day(date)}.`) : pick(locale, "之前没有就诊记录。", "No earlier visit on record.")),
    vVisit: (date: string, n: number) => pick(locale, `${day(date)} 这次就诊，确认过的话有 ${n} 句。`, `The visit on ${day(date)} has ${n1(n, "confirmed line", "confirmed lines")}.`),
    vVisitEmpty: (date: string) =>
      pick(locale, `${day(date)} 这次就诊，记录里尚无确认过的话，可以问医生。`, `The visit on ${day(date)}: your records hold no confirmed lines from it yet; you can ask your doctor.`),
    vVisitPlanned: (date: string, days: number, approx: boolean, q: number) =>
      pick(
        locale,
        `${days > 0 ? `这次就诊尚未进行（${about(approx)}${day(date)}）。` : "这次就诊就在今天。"}${q ? `问题单里有 ${q} 个问题等着问。` : "问题单里现在没有问题。"}`,
        `${days > 0 ? `This visit has not happened yet (${about(approx)}${day(date)}).` : "This visit is today."} ${q ? `${n1(q, "question waits", "questions wait")} on your list.` : "No questions on your list right now."}`,
      ),

    // ---- one line of a visit's record
    lineName: (c: Clinician | null, date: string) =>
      c ? pick(locale, `${who(c)} ${day(date)} 说的话`, `What ${who(c)} said on ${day(date)}`) : pick(locale, `${day(date)} 就诊时的一句话`, `A line from the visit on ${day(date)}`),
    lineWhen: (date: string, at: string) =>
      pick(locale, `${day(date)} 就诊${at ? `，录音 ${at}` : ""}。`, `Visit on ${day(date)}${at ? `, ${at} into the recording` : ""}.`),
    lineConfirmed: pick(locale, "你确认过这句。", "You confirmed this line."),
    lineUnconfirmed: pick(locale, "这句你尚未确认。", "You have not confirmed this line yet."),
    lineDisputed: pick(locale, "你标过这句「不是」。", "You marked this line “not right”."),
    lineClip: pick(locale, "有录音，可以听原声。", "The recording of it can be played."),
    lineNoClip: pick(locale, "这句没有录音。", "No recording of this line."),
    lineIsTarget: (s: number, d: number) => pick(locale, `这是医生给的血压数字：低于 ${s}/${d}。`, `This is your doctor's blood-pressure number: below ${s}/${d}.`),
    lineIsWarning: (t: number) => pick(locale, `这是医生的警示线：上面的数字超过 ${t}。`, `This is your doctor's warning line: a top number above ${t}.`),
    vLineConfirmed: (c: Clinician | null, date: string) =>
      pick(locale, `这是${who(c)} ${day(date)} 就诊时的原话，你确认过。`, `These are ${who(c)}'s own words from the visit on ${day(date)}; you confirmed them.`),
    vLineUnconfirmed: (date: string) =>
      pick(locale, `这是 ${day(date)} 就诊时录到的一句话，你尚未确认是谁说的。`, `This line was recorded at the visit on ${day(date)}; you have not confirmed who said it.`),

    // ---- a question on his list
    questionAdded: (date: string | null, c: "doctor" | "pharmacist") =>
      date ? pick(locale, `${day(date)} 加入问题单，问${who(c)}。`, `Put on your list on ${day(date)}, for ${who(c)}.`) : pick(locale, `在问题单里，问${who(c)}。`, `On your list, for ${who(c)}.`),
    questionRefused: pick(locale, "这是 Ripple 不能回答的问题。", "Ripple could not answer this one."),
    questionPattern: pick(locale, "这是 Ripple 从你的记录里看到的规律。", "A pattern Ripple saw in your records."),
    questionOpen: pick(locale, "尚未询问。", "Not asked yet."),
    questionAnswered: (c: Clinician | null, date: string | null) =>
      pick(locale, `${who(c)}${date ? ` ${day(date)} ` : ""}回答过。`, `Answered by ${who(c)}${date ? ` on ${day(date)}` : ""}.`),
    questionSkipped: pick(locale, "你先放一边了。", "You set it aside."),
    nextVisit: (date: string | null, approx: boolean) =>
      date ? pick(locale, `下次就诊：${about(approx)}${day(date)}。`, `Next visit: ${about(approx)}${day(date)}.`) : pick(locale, "尚无下次就诊的日期。", "No next visit date yet."),
    vQuestionOpen: (c: "doctor" | "pharmacist", date: string | null) =>
      date
        ? pick(locale, `这个问题在问题单里，等 ${day(date)} 就诊时问${who(c)}。`, `This question is on your list for ${who(c)}, for the visit on ${day(date)}.`)
        : pick(locale, `这个问题在问题单里，等下次就诊时问${who(c)}。`, `This question is on your list for ${who(c)}, for your next visit.`),
    vQuestionAnswered: (c: Clinician | null, date: string | null) =>
      pick(locale, `这个问题${who(c)}${date ? ` ${day(date)} ` : ""}回答过，原话在下面。`, `${cap(who(c))} answered this${date ? ` on ${day(date)}` : ""}; the words are below.`),
    vQuestionSkipped: pick(locale, "这个问题你先放一边了。", "You set this question aside."),

    // ---- the next visit
    nextName: (date: string | null, approx: boolean) => (date ? pick(locale, `下次就诊 · ${about(approx)}${day(date)}`, `Next visit, ${about(approx)}${day(date)}`) : pick(locale, "下次就诊", "Next visit")),
    vNext: (date: string, days: number, approx: boolean, q: number) =>
      pick(
        locale,
        `下次就诊${approx ? "大约" : ""}在 ${day(date)}${days > 0 ? `，还有 ${days} 天` : "，就是今天"}。${q ? `问题单里有 ${q} 个问题等着问。` : "问题单里现在没有问题。"}`,
        `Your next visit is ${about(approx)}${day(date)}${days > 0 ? `, ${n1(days, "day", "days")} away` : ", today"}. ${q ? `${n1(q, "question waits", "questions wait")} on your list.` : "No questions on your list right now."}`,
      ),
    vNextNone: pick(locale, "记录里尚无下次就诊的日期，可以问医生。", "Your records hold no date for a next visit; you can ask your doctor."),

    // ---- only her sheet needs these (his sentences above already carry them): kept here so the two sets have one shape
    /** after a sentence, when the quoted words are shown under it */
    quotedBelow: pick(locale, "原话在下面。", "The words are below."),
    /** a planned visit, without the count of his questions */
    vVisitPlannedBare: (date: string, days: number, approx: boolean) =>
      pick(locale, days > 0 ? `这次就诊尚未进行（${about(approx)}${day(date)}）。` : "这次就诊就在今天。", days > 0 ? `This visit has not happened yet (${about(approx)}${day(date)}).` : "This visit is today."),
    /** a visit to the pharmacy counter, as her sheet's head names it (his head says 就诊 for every visit: visitName) */
    pharmacyName: (date: string, planned: boolean) => pick(locale, `${day(date)} 就诊${planned ? "（计划）" : ""}`, `${planned ? "Planned visit" : "Visit"}, ${day(date)}`),
  };
}

/** The shape both sets have (his `who` is typed by its own words: here it is any words). */
export type FactWords = Omit<ReturnType<typeof hisFactWords>, "who"> & { who: (c: Clinician | null) => string };

const HER_PART: Record<DaySlot, string> = { morning: "早间", midday: "午间", evening: "晚间", night: "睡前" };
const HER_SLOT_MED: Record<DaySlot, string> = { morning: "早间药物", midday: "午间药物", evening: "晚间药物", night: "睡前药物" };

/**
 * Her words: the same facts, each key of his set, about him in the third person and in the family side's vocabulary
 * (see the header). `dad` is how she calls him. Typed against his set, so a line added there has to be written here too.
 */
function herFactWords(locale: HoldLocale, dad: string): FactWords {
  const zh = locale === "zh-Hans";
  // how her English says him: he / his, she / her, or her word itself when it is a name (lib/care/copy.ts elderWords)
  const w = elderWords(dad, locale);
  const day = (iso: string) => shortDay(locale, iso);
  /** a time by the 24-hour clock in 华语 (no 早上 / 晚上 in front of it), "8:15 pm" in English */
  const clock = (hhmm: string) => (zh ? shortTime(hhmm) : clockWords(locale, hhmm));
  const part = (slot: DaySlot) => (zh ? HER_PART[slot] : dt(locale, `slot.${slot}` as DailyKey));
  const slotMed = (slot: DaySlot) => (zh ? HER_SLOT_MED[slot] : dt(locale, `slotMed.${slot}` as DailyKey));
  const who = (c: Clinician | null) =>
    c === "pharmacist" ? pick(locale, "药剂师", "the pharmacist") : c === "dispenser" ? pick(locale, "药房柜台", "the counter staff") : pick(locale, "医生", `${w.his} doctor`);
  const cap = capFirst;
  const Dad = capFirst(dad);
  const about = (approx: boolean) => (approx ? pick(locale, "约 ", "about ") : "");
  const week = (current: boolean) => pick(locale, current ? "本周" : "该周", current ? "This week" : "That week");
  const list = (xs: string[]) => xs.join(zh ? "、" : ", ");
  const waiting = (q: number) => (q ? pick(locale, `有 ${q} 个问题待问医生。`, `${n1(q, "question waits", "questions wait")} on ${w.his} list.`) : pick(locale, "目前没有待问医生的问题。", `No questions on ${w.his} list right now.`));

  return {
    day,
    clock,
    part,
    slotMed,
    who,
    list,

    // ---- blood pressure
    bpName: (s, d, date) => pick(locale, `血压 ${s}/${d} · ${day(date)}`, `Blood pressure ${s}/${d}, ${day(date)}`),
    bpNoneName: (date, slot) => pick(locale, `${day(date)} ${part(slot)} 未测量血压`, `${day(date)}, ${part(slot).toLowerCase()}: not measured`),
    bpReading: (s, d, date, slot, time) =>
      pick(locale, `本次血压测量：${s}/${d}，记录于 ${day(date)} ${time ? clock(time) : part(slot)}。`, `This blood pressure reading: ${s}/${d}, recorded ${day(date)}, ${time ? clock(time) : part(slot).toLowerCase()}.`),
    bpNotMeasured: (date, slot) => pick(locale, `${day(date)} ${part(slot)}未测量血压。`, `${day(date)}, ${part(slot).toLowerCase()}: no blood pressure reading was taken.`),
    doctorTarget: (s, d, date) => pick(locale, `医生给出的数值：低于 ${s}/${d}（${day(date)} 就诊时所述）。`, `${w.His} doctor's number: below ${s}/${d} (said at the clinic visit on ${day(date)}).`),
    noTarget: pick(locale, "记录中尚无医生给出的血压数值。", `${w.His} records hold no blood-pressure number from ${w.his} doctor yet.`),
    doctorWarning: (t, date) => pick(locale, `医生的警示线：收缩压超过 ${t}（${day(date)} 就诊时所述）。`, `${w.His} doctor's warning line: a top number above ${t} (said at the clinic visit on ${day(date)}).`),
    weekReadings: (current, from, to, n, s, d) =>
      pick(locale, `${week(current)}（${day(from)}至${day(to)}）血压测量 ${n} 次，平均 ${s}/${d}。`, `${week(current)} (${day(from)} to ${day(to)}): ${n1(n, "blood pressure reading", "blood pressure readings")}, average ${s}/${d}.`),
    weekNone: (current, from, to) => pick(locale, `${week(current)}（${day(from)}至${day(to)}）暂无血压测量。`, `${week(current)} (${day(from)} to ${day(to)}): no blood pressure readings yet.`),
    weekSkipped: (n) => pick(locale, `另有 ${n} 次未测量。`, `${n1(n, "time", "times")} not measured.`),
    notBelow: (k) =>
      k === 0 ? pick(locale, "均低于医生给出的数值。", `All were below ${w.his} doctor's number.`) : pick(locale, `其中 ${k} 次不低于医生给出的数值。`, `${k} of them ${k === 1 ? "was" : "were"} not below ${w.his} doctor's number.`),
    bpName_week: (from, to) => pick(locale, `血压 · ${day(from)}至${day(to)}`, `Blood pressure, ${day(from)} to ${day(to)}`),
    vBpNotBelow: (s, d, ts, td) => pick(locale, `本次血压测量 ${s}/${d}，不低于医生所说的 ${ts}/${td}。`, `This blood pressure reading, ${s}/${d}, is not below the ${ts}/${td} ${w.his} doctor said.`),
    vBpBelow: (s, d, ts, td) => pick(locale, `本次血压测量 ${s}/${d}，低于医生所说的 ${ts}/${td}。`, `This blood pressure reading, ${s}/${d}, is below the ${ts}/${td} ${w.his} doctor said.`),
    vBpNoTarget: (s, d) =>
      pick(locale, `本次血压测量为 ${s}/${d}。记录中尚无医生给出的数值，可向医生咨询。`, `This blood pressure reading is ${s}/${d}. ${w.His} records hold no number from ${w.his} doctor to set it against; ${w.his} doctor can be asked.`),
    // the pointer to the quoted words is added only when they are shown (quotedBelow): they are his visit record's
    vBpAboveWarning: (s, t) => pick(locale, `本次收缩压为 ${s}，超过医生所说的 ${t}。`, `The top number of this blood pressure reading, ${s}, is above the ${t} ${w.his} doctor said.`),
    vBpNotMeasured: (date, slot) => pick(locale, `${day(date)} ${part(slot)}没有血压测量记录。`, `There is no blood pressure reading for ${day(date)}, ${part(slot).toLowerCase()}.`),
    vWeekTarget: (current, n, s, d, k, ts, td) =>
      pick(
        locale,
        `${week(current)}血压测量 ${n} 次，平均 ${s}/${d}；${k} 次不低于医生所说的 ${ts}/${td}。`,
        `${week(current)}: ${n1(n, "blood pressure reading", "blood pressure readings")}, average ${s}/${d}; ${k} not below the ${ts}/${td} ${w.his} doctor said.`,
      ),
    vWeekNoTarget: (current, n, s, d) =>
      pick(
        locale,
        `${week(current)}血压测量 ${n} 次，平均 ${s}/${d}。记录中尚无医生给出的数值。`,
        `${week(current)}: ${n1(n, "blood pressure reading", "blood pressure readings")}, average ${s}/${d}. ${w.His} records hold no number from ${w.his} doctor yet.`,
      ),
    vWeekNone: (current) => pick(locale, `${week(current)}暂无血压测量。`, `${week(current)}: no blood pressure readings yet.`),

    // ---- a medicine
    labelDispensed: (date) => pick(locale, `药品标签：${day(date)} 配药。`, `Label: dispensed ${day(date)}.`),
    labelChecked: pick(locale, "药品标签已核对。", "The label has been checked."),
    labelNone: pick(locale, "尚未拍摄药品标签。", "No label photographed yet."),
    labelTyped: pick(locale, `药品标签由${dad}本人填写，尚未核对。`, `${Dad} typed the label in ${w.himself}; it has not been checked.`),
    medUnknown: pick(locale, "该药物尚未被识别。", "Nobody has identified this medicine yet."),
    medSlots: (slots, fromLabel) =>
      pick(locale, `服药时间：${list(slots.map(part))}（${fromLabel ? "依药品标签" : `${dad}本人选择`}）。`, `When: ${list(slots.map((s) => part(s).toLowerCase()))} (${fromLabel ? "from the label" : `${w.his} choice`}).`),
    medNoSlots: pick(locale, "尚未设定服药时间。", "No time of day set yet."),
    labelUnchecked: pick(locale, "药品标签尚未核对。", "The label has not been checked yet."),
    spokeAbout: (c, date) => pick(locale, `${who(c)}于 ${day(date)} 谈到该药物。`, `${cap(who(c))} spoke about it on ${day(date)}.`),
    nobodySpoke: pick(locale, "记录中没有医生或药剂师关于该药物的原话。", `${w.His} records hold nothing ${w.his} doctor or pharmacist said about it.`),
    doses7: (c, all) => {
      const lead = pick(locale, all ? "最近 7 天（全部药物）" : "最近 7 天", all ? "Last 7 days (all medicines)" : "Last 7 days");
      if (c.due === 0) return pick(locale, `${lead}无需记录。`, `${lead}: nothing was due.`);
      const rest = [c.missed ? pick(locale, `未服药 ${c.missed} 次`, `${c.missed} not taken`) : "", c.unconfirmed ? pick(locale, `未回应 ${c.unconfirmed} 次`, `${c.unconfirmed} with no response`) : ""].filter(Boolean);
      return pick(
        locale,
        `${lead}：应服 ${c.due} 次，已服药 ${c.taken} 次${rest.length ? `，${rest.join("，")}` : ""}。`,
        `${lead}: ${c.due} due, ${c.taken} taken${rest.length ? `, ${rest.join(", ")}` : ""}.`,
      );
    },
    vMedSlots: (name, slots, fromLabel) =>
      pick(
        locale,
        `${name}：${fromLabel ? "药品标签所示服药时间为" : `${dad}本人选择的服药时间为`}${list(slots.map(part))}。`,
        `${name}: ${fromLabel ? "the label says" : `${w.he} chose`} ${list(slots.map((s) => part(s).toLowerCase()))}.`,
      ),
    vMedDoses: (c) => pick(locale, `最近 7 天应服 ${c.due} 次，已服药 ${c.taken} 次。`, `Last 7 days: ${c.taken} of ${c.due} taken.`),
    vMedThin: (name) => pick(locale, `记录中关于 ${name} 的内容尚少，可向医生或药剂师咨询。`, `${w.His} records do not say much about ${name} yet; ${w.his} doctor or pharmacist can be asked.`),

    // ---- one part of one day's medicine
    doseName: (date, slot) => pick(locale, `${day(date)} ${slotMed(slot)}`, `${slotMed(slot)}, ${day(date)}`),
    cellTaken: (med, time) => pick(locale, `${med}：已服药${time ? `，记录于 ${shortTime(time)}` : ""}。`, `${med}: Taken${time ? `, logged at ${shortTime(time)}` : ""}.`),
    cellMissed: (med, reason) => pick(locale, `${med}：未服药${reason ? `，原因：${reason}` : ""}。`, `${med}: Not taken${reason ? ` (reason given: ${reason})` : ""}.`),
    cellLater: (med) => pick(locale, `${med}：选择稍后服用，尚未确认。`, `${med}: “later”, not confirmed yet.`),
    cellNoReply: (med, closes) => pick(locale, `${med}：截至 ${shortTime(closes)} 未回应。`, `${med}: No response by ${shortTime(closes)}.`),
    cellOpen: (med) => pick(locale, `${med}：尚未记录。`, `${med}: not logged yet.`),
    reminders: (first, second, closes) =>
      pick(
        locale,
        `提醒时间：${shortTime(first)}，${shortTime(second)} 再次提醒，${shortTime(closes)} 截止。`,
        `Reminders at ${shortTime(first)} and ${shortTime(second)}; the window closes at ${shortTime(closes)}.`,
      ),
    vDoseTaken: (date, slot, time) =>
      pick(locale, `${day(date)}${slotMed(slot)}：已服药${time ? `（${shortTime(time)}）` : ""}。`, `${slotMed(slot)} on ${day(date)}: Taken${time ? `, logged at ${shortTime(time)}` : ""}.`),
    vDoseMissed: (date, slot, reason) =>
      pick(locale, `${day(date)}${slotMed(slot)}：未服药${reason ? `，原因：${reason}` : ""}。`, `${slotMed(slot)} on ${day(date)}: Not taken${reason ? ` (reason given: ${reason})` : ""}.`),
    vDoseOpen: (date, slot) => pick(locale, `${day(date)}${slotMed(slot)}尚未记录。`, `${slotMed(slot)} on ${day(date)}: not logged yet.`),
    vDoseNoReply: (date, slot, closes) => pick(locale, `${day(date)}${slotMed(slot)}：截至 ${shortTime(closes)} 未回应。`, `${slotMed(slot)} on ${day(date)}: No response by ${shortTime(closes)}.`),
    vDoseMixed: (date, slot, n, taken, missed, open) =>
      pick(
        locale,
        `${day(date)}${slotMed(slot)}共 ${n} 种：已服药 ${taken} 种，未服药 ${missed} 种，尚未记录 ${open} 种。`,
        `${slotMed(slot)} on ${day(date)}, ${n1(n, "medicine", "medicines")}: ${taken} taken, ${missed} not taken, ${open} not logged.`,
      ),

    // ---- a visit
    visitName: (date, planned) => pick(locale, `${day(date)} 就诊${planned ? "（预约）" : ""}`, `${planned ? "Planned clinic visit" : "Clinic visit"}, ${day(date)}`),
    visitWhere: (date, place) => (place ? pick(locale, `${day(date)}，${place}。`, `${day(date)}, at ${place}.`) : pick(locale, `${day(date)}。`, `${day(date)}.`)),
    visitLines: (n) => (n === 0 ? pick(locale, "尚无已确认的原话。", "No confirmed lines yet.") : pick(locale, `已确认的原话：${n} 句。`, `Confirmed lines: ${n}.`)),
    visitMeds: (names) => pick(locale, `本次就诊所开药物：${list(names)}。`, `Medicines from this clinic visit: ${list(names)}.`),
    visitAnswered: (n) => pick(locale, `答复了${dad}的 ${n} 个问题。`, `${n} of ${w.his} questions answered.`),
    recordingKept: pick(locale, "录音已保存。", "The recording is kept."),
    recordingDeleted: pick(locale, "录音已删除，文字仍保留。", "The recording was deleted; the text is kept."),
    visitReview: pick(locale, "尚未全部确认。", "Not all lines are confirmed yet."),
    visitWaiting: pick(locale, "录音已保存，文字尚未生成。", "The recording is saved; the text is not ready yet."),
    plannedWhen: (date, days, approx) =>
      days <= 0 ? pick(locale, "就在今天。", "It is today.") : pick(locale, `${about(approx)}${day(date)}，距今 ${days} 天。`, `${cap(`${about(approx)}${day(date)}`)}, ${n1(days, "day", "days")} away.`),
    visitPlace: (place) => pick(locale, `地点：${place}。`, `Where: ${place}.`),
    questionsWaiting: (n) => waiting(n),
    lastVisit: (date) => (date ? pick(locale, `上次就诊：${day(date)}。`, `Last clinic visit: ${day(date)}.`) : pick(locale, "此前没有就诊记录。", "No earlier clinic visit on record.")),
    vVisit: (date, n) => pick(locale, `${day(date)} 就诊，已确认的原话共 ${n} 句。`, `The clinic visit on ${day(date)} has ${n1(n, "confirmed line", "confirmed lines")}.`),
    vVisitEmpty: (date) =>
      pick(locale, `${day(date)} 就诊，记录中尚无已确认的原话，可向医生咨询。`, `The clinic visit on ${day(date)}: ${w.his} records hold no confirmed lines from it yet; ${w.his} doctor can be asked.`),
    vVisitPlanned: (date, days, approx, q) =>
      pick(
        locale,
        `${days > 0 ? `本次就诊尚未进行（${about(approx)}${day(date)}）。` : "本次就诊就在今天。"}${waiting(q)}`,
        `${days > 0 ? `This clinic visit has not happened yet (${about(approx)}${day(date)}).` : "This clinic visit is today."} ${waiting(q)}`,
      ),

    // ---- one line of a visit's record
    lineName: (c, date) =>
      c ? pick(locale, `${who(c)} ${day(date)} 的原话`, `What ${who(c)} said on ${day(date)}`) : pick(locale, `${day(date)} 就诊中的一句话`, `A line from the clinic visit on ${day(date)}`),
    lineWhen: (date, at) => pick(locale, `${day(date)} 就诊${at ? `，录音 ${at}` : ""}。`, `Clinic visit on ${day(date)}${at ? `, ${at} into the recording` : ""}.`),
    lineConfirmed: pick(locale, `${dad}已确认这句话。`, `${Dad} confirmed this line.`),
    lineUnconfirmed: pick(locale, `${dad}尚未确认这句话。`, `${Dad} has not confirmed this line yet.`),
    lineDisputed: pick(locale, `${dad}将这句话标为「不是」。`, `${Dad} marked this line “not right”.`),
    lineClip: pick(locale, "有录音，可播放原声。", "The recording of it can be played."),
    lineNoClip: pick(locale, "这句话没有录音。", "No recording of this line."),
    lineIsTarget: (s, d) => pick(locale, `这是医生给出的血压数值：低于 ${s}/${d}。`, `This is ${w.his} doctor's blood-pressure number: below ${s}/${d}.`),
    lineIsWarning: (t) => pick(locale, `这是医生的警示线：收缩压超过 ${t}。`, `This is ${w.his} doctor's warning line: a top number above ${t}.`),
    vLineConfirmed: (c, date) =>
      pick(locale, `这是${who(c)} ${day(date)} 就诊时的原话，${dad}已确认。`, `These are ${who(c)}'s own words from the clinic visit on ${day(date)}; ${dad} confirmed them.`),
    vLineUnconfirmed: (date) =>
      pick(locale, `这是 ${day(date)} 就诊时录到的一句话，${dad}尚未确认说话人。`, `This line was recorded at the clinic visit on ${day(date)}; ${dad} has not confirmed who said it.`),

    // ---- a question on his list
    questionAdded: (date, c) =>
      date ? pick(locale, `${day(date)} 列入问题单，待问${who(c)}。`, `Put on ${w.his} list on ${day(date)}, for ${who(c)}.`) : pick(locale, `已列入问题单，待问${who(c)}。`, `On ${w.his} list, for ${who(c)}.`),
    questionRefused: pick(locale, "这是 Ripple 无法回答的问题。", "Ripple could not answer this one."),
    questionPattern: pick(locale, `这是 Ripple 从${dad}的记录中归纳出的规律。`, `A pattern Ripple saw in ${w.his} records.`),
    questionOpen: pick(locale, "尚未询问。", "Not asked yet."),
    questionAnswered: (c, date) => pick(locale, `${who(c)}已${date ? `于 ${day(date)} ` : ""}答复。`, `Answered by ${who(c)}${date ? ` on ${day(date)}` : ""}.`),
    questionSkipped: pick(locale, `${dad}已暂时搁置。`, `${Dad} set it aside.`),
    nextVisit: (date, approx) => (date ? pick(locale, `下次就诊：${about(approx)}${day(date)}。`, `Next clinic visit: ${about(approx)}${day(date)}.`) : pick(locale, "尚无下次就诊日期。", "No next clinic visit date yet.")),
    vQuestionOpen: (c, date) =>
      date
        ? pick(locale, `该问题在问题单中，待 ${day(date)} 就诊时问${who(c)}。`, `This question is on ${w.his} list for ${who(c)}, for the clinic visit on ${day(date)}.`)
        : pick(locale, `该问题在问题单中，待下次就诊时问${who(c)}。`, `This question is on ${w.his} list for ${who(c)}, for ${w.his} next clinic visit.`),
    // 「原话见下方」 is added only when the answer's words are shown (quotedBelow): they are his visit record's
    vQuestionAnswered: (c, date) => pick(locale, `${who(c)}已${date ? `于 ${day(date)} ` : ""}答复该问题。`, `${cap(who(c))} answered this${date ? ` on ${day(date)}` : ""}.`),
    vQuestionSkipped: pick(locale, `该问题${dad}已暂时搁置。`, `${Dad} set this question aside.`),

    // ---- the next visit
    nextName: (date, approx) => (date ? pick(locale, `下次就诊 · ${about(approx)}${day(date)}`, `Next clinic visit, ${about(approx)}${day(date)}`) : pick(locale, "下次就诊", "Next clinic visit")),
    vNext: (date, days, approx, q) =>
      pick(
        locale,
        `下次就诊${approx ? "约" : ""}在 ${day(date)}${days > 0 ? `，距今 ${days} 天` : "，就在今天"}。${waiting(q)}`,
        `${w.His} next clinic visit is ${about(approx)}${day(date)}${days > 0 ? `, ${n1(days, "day", "days")} away` : ", today"}. ${waiting(q)}`,
      ),
    vNextNone: pick(locale, "记录中尚无下次就诊日期，可向医生咨询。", `${w.His} records hold no date for a next clinic visit; ${w.his} doctor can be asked.`),

    quotedBelow: pick(locale, "原话见下方。", "The words are below."),
    vVisitPlannedBare: (date, days, approx) =>
      pick(
        locale,
        days > 0 ? `本次就诊尚未进行（${about(approx)}${day(date)}）。` : "本次就诊就在今天。",
        days > 0 ? `This clinic visit has not happened yet (${about(approx)}${day(date)}).` : "This clinic visit is today.",
      ),
    pharmacyName: (date, planned) => pick(locale, `${day(date)} 药房取药${planned ? "（预约）" : ""}`, `${planned ? "Planned pharmacy visit" : "Pharmacy visit"}, ${day(date)}`),
  };
}

/** Who a quoted source is by, for the model's reading of it (never shown: the sheet draws the source with its own head line). */
export function sourceBy(kind: "doctor" | "dispenser" | "pharmacist" | "label" | "leaflet" | "records" | "recording"): string {
  return { doctor: "the doctor said", dispenser: "the clinic counter said", pharmacist: "the pharmacist said", label: "the medicine label says", leaflet: "the official leaflet says", records: "his own records", recording: "said at a visit (speaker not confirmed)" }[kind];
}
