/**
 * UI words for the daily screens (M4): Today's check-in and answer card, blood pressure, the question list, the
 * reminder and the family alert. Same pattern as lib/i18n.ts and lib/meds/i18n.ts: `en` first, `zhHans` is typed
 * against it. Source chips reuse lib/i18n.ts (医生说 / 药袋 ...) and lib/visit/strings.ts (推断：医生).
 *
 * No clinical sentence lives here. Reason chips are his answers to "why not today?", not advice. The pattern
 * wording only describes his own log (which mornings he missed and which routine falls on those days); it never
 * proposes a time or a change. No judgement words (high, normal, good, 偏高, 正常) anywhere: the blood pressure
 * screen only records and puts his readings next to the doctor's own number. Client-safe.
 */
import type { Locale } from "@/lib/i18n";

const en = {
  "ask.title": "Say or ask something",
  "ask.placeholder": "Type a sentence",
  "ask.send": "Send",
  "ask.sending": "Sending…",
  "ask.error": "It did not go through. Try again.",
  "ask.limit": "That is a lot of questions this hour. Try again later.",
  "ask.added": "On the question list for your next visit",
  "ask.you": "You",

  "answer.original": "On the label: {text}",
  "answer.play": "Play",
  "answer.playing": "Playing",
  "answer.standIn": "stand-in recording",
  "answer.at": "at {time}",

  "chip.records": "Your records",
  "chip.recording": "Recording",
  "chip.ripple": "Ripple",

  "dose.reason.title": "What happened this morning?",
  "dose.reason.forgot": "Forgot",
  "dose.reason.away": "I was out",
  "dose.reason.not_with_me": "Medicine not with me",
  "dose.reason.own": "In my own words",
  "dose.reason.placeholder": "Type what happened",
  "dose.reason.save": "Save",
  "dose.reason.saved": "Reason: {reason}",
  "dose.undo.recorded": "{state}",
  "dose.undo": "Undo",
  "dose.state.later": "Later (not confirmed yet)",
  "dose.state.noReply": "No reply after two reminders (not confirmed)",
  "dose.reminderAt": "Ripple asks you at {time}",

  "reminder.tag": "Reminder",
  "reminder.second": "Second reminder",
  "reminder.play": "Play Wei Ling's reminder",
  "reminder.question": "Did you take this morning's medicine?",

  "bp.doctorNumber": "The number the doctor gave",
  "bp.lineLabel": "Doctor's number {s}/{d}",
  "bp.onlyRecord": "Your readings are recorded here.",
  "bp.readings": "Your readings",
  "bp.chart": "Readings over time",
  "bp.empty": "No readings yet.",
  "bp.unconfirmed": "Not confirmed",
  "bp.slot.morning": "Morning",
  "bp.slot.midday": "Midday",
  "bp.slot.evening": "Evening",
  "bp.slot.night": "Night",
  "bp.measuring": "What the doctor said about measuring",
  "bp.record.title": "Record a reading",
  "bp.record.top": "Top number",
  "bp.record.bottom": "Bottom number",
  "bp.record.save": "Save",
  "bp.record.saved": "Recorded",
  "bp.record.invalid": "Fill in both numbers.",
  "bp.unit": "mmHg",

  "q.forDoctor": "For the doctor",
  "q.forPharmacist": "For the pharmacist",
  "q.origin.own": "My own question",
  "q.origin.before_you_go": "From a visit",
  "q.origin.refused_question": "Ripple did not answer this",
  "q.origin.pattern": "A pattern in my log",
  "q.origin.unidentified_medicine": "A medicine Ripple can't identify",
  // his own "not sure" from the understanding checklist (M5): on the list it reads as his own question
  "q.origin.understanding_check": "My own question",
  "q.origin.other": "Question",
  // wave B: a seeded question whose words are a summary, not what he typed (q-extra-tablet before he asks it himself)
  "q.recordedSummary": "Recorded summary, not my own words",
  "q.summaryOf": "Recorded summary: ",
  "q.status.open": "Waiting for the next visit",
  "q.status.answered": "Answered",
  "q.status.skipped": "Skipped",
  "q.empty": "No questions yet.",
  "q.brief": "Open the visit brief",

  "pattern.all": "All {n} mornings I missed were {routine} days ({weekdays}): {dates}.",
  "pattern.some": "{n} of the {total} mornings I missed were {routine} days ({weekdays}): {dates}.",
  "pattern.evidence": "{n} of the {total} missed mornings were on {routine} days ({weekdays}): {dates}",

  "alerts.title": "Reminders with no reply",
  "alerts.item": "Dad did not reply to two reminders: {name}, {slot} of {date}.",

  // ---- C2 track B (accounts): the slots of the day, and the lock-screen words (no medicine name, no dose, no reading)
  "slot.morning": "Morning",
  "slot.midday": "Midday",
  "slot.evening": "Evening",
  "slot.night": "Bedtime",
  "slotMed.morning": "Morning medicine",
  "slotMed.midday": "Midday medicine",
  "slotMed.evening": "Evening medicine",
  "slotMed.night": "Bedtime medicine",
  "notice.dose.body": "Not logged yet",
  "notice.family.title": "{who} hasn't answered about the {slotMed}",
  "notice.family.body": "Neither reminder, at {first} or {second}, got a reply.",
  "notice.family.who": "Your family member",
  // C2 track B, second round: the reminder strip on his other pages (components/daily/elder/DueReminder.tsx)
  "due.go": "Log it on Today",
  "notice.bp.title": "Time to measure your blood pressure",
  "notice.bp.body": "Open Ripple to record it",

  // ---- C2 track B (accounts): Today, the dose answers, the blood pressure line and page, the countdown
  "today.slot.coming": "{slotMed} · reminder at {time}",
  "today.slot.pending": "{slotMed} · not logged",
  "today.slot.noReply": "{slotMed} · not logged by {time}",
  "today.slot.change": "{slotMed} · change",
  "today.slot.notTaken": "{slotMed} · not taken",
  "today.slot.untracked": "{slotMed} · log it now",
  "today.slot.yesterday": "Yesterday's {slotMedLower} · not logged",
  "today.later.title": "Again at {time}",
  "today.later.noTime": "Log it later",
  "today.done.title": "Logged",
  "today.done.taken": "Taken {time}",
  "today.done.missed": "Not taken",
  "today.done.reason": "Why: {reason}",
  "today.allDone": "Today's medicine is logged",
  "today.later.next": "Ripple asks again",
  "today.closed.first": "Reminder sent",
  "today.closed.second": "Asked again",
  "today.med.dispensed": "dispensed {date}",
  "today.med.awaitingLabel": "Awaiting label",
  "today.routine": "routine",
  "today.undo.taken": "Taken",
  "today.undo.missed": "Not taken",
  "today.undo.later": "Later",
  "today.undo.reason": "Not taken · {reason}",
  "today.row.taken": "{part} · logged {time}",
  "today.row.missed": "{part} · not taken · logged {time}",
  "today.row.later": "{part} · later (not confirmed yet)",
  "today.row.noReply": "{part} · not logged ({time})",
  "today.row.coming": "Reminder at {time}",
  "today.row.logNow": "Log it",
  "today.row.yesterday": "Yesterday · {slotMed}",
  "today.herEyes": "{names} will see: {state}",
  "today.herEyes.taken": "taken today",
  "today.herEyes.missed": "not taken today",
  "today.herEyes.later": "not confirmed yet",
  "today.reminder.from": "{name}'s reminder",
  "today.reminder.fromDefault": "Your family's reminder",
  "today.reminder.listen": "Hear {name}",
  "today.reminder.listenDefault": "Hear the reminder",
  // C2 track D (only add; real-app 3.10 「他的提醒卡写『Wei Ling 的录音』」): whose recording it is, by the name on the link
  "today.reminder.recording": "{name}'s recording",
  "today.reminder.recordingDefault": "Your family's recording",
  "today.reminder.unavailable": "The recording can't play. Her words are on the screen.",
  "today.noMeds.title": "No medicines yet",
  "today.noMeds.label": "Photograph a label",
  "today.noMeds.visit": "Go to the visit",
  "today.noSlot.ask": "When do you take {name}?",
  "today.noSlot.hint": "The label does not say a time. Choose yours.",
  "today.noSlot.save": "That's when",
  "today.slotChosen": "Your chosen time",
  "today.reason.ownLabel": "In your own words",
  "today.error": "It did not go through. Try again.",
  "today.bp.label": "Blood pressure",
  "today.bp.dueNow": "Time to measure ({part})",
  "today.bp.dueLater": "From {time}",
  "today.bp.done": "{part}: measured, {time}",
  "today.bp.notMeasured": "{part}: not measured this time",
  "today.bp.record": "Record one",
  "today.bp.count": "{n} today",
  "today.next.label": "Next visit",
  "today.next.today": "Today",
  "today.next.tomorrow": "Tomorrow · {date}",
  "today.next.inDays": "{date} · in {n} days",
  "today.next.questions": "For the doctor",
  "today.next.questionsN": "{n}",
  "today.next.brief": "Visit brief",
  "today.next.visit": "{when} · visit",
  "today.next.visitToday": "{when} · visit",
  "today.next.visitInDays": "{when} · visit in {n} days",
  "today.next.questionsWait": "Questions: {n}",
  "today.next.seeQuestions": "See the question list",
  // C2 track B, second round: a planned follow-up's day (real-app 2.15) and a medicine waiting for its label (2.16)
  "today.next.about": "About {date}",
  "today.next.aboutInDays": "About {date} · in {n} days",
  "today.next.on": "{date}",
  "today.next.booked": "The day I booked",
  "today.next.change": "Change the day",
  "today.newMed.label": "Photograph the new medicine's bag",
  "today.next.briefReady": "Visit brief",
  "today.next.start": "Start the visit",
  "today.heading": "Your day",
  // the one-time notice after setting up (/p/today?setup=done; owner's tidy of 10-13)
  "today.setup.title": "All set",
  "today.setup.hint": "You can change it in Me › My details",
  "today.setup.ok": "Got it",
  // owner 10-14: his month at the top of Today (components/daily/elder/OwnMonth.tsx): what each mark of a day means,
  // the chosen day's rows; the words of her month (lib/care/month-copy.ts), said to him
  "today.month.legend": "What the marks mean",
  "today.month.taken": "All taken",
  "today.month.missed": "One not taken",
  "today.month.noReply": "No response",
  "today.month.pending": "Not logged yet",
  "today.month.visit": "Visit",
  "today.month.planned": "Planned visit",
  "today.month.today": "Today",
  "today.month.backToday": "Back to today",
  "today.month.empty": "Nothing recorded on this day",
  "today.month.st.taken": "Taken",
  "today.month.st.missed": "Not taken",
  "today.month.st.noReply": "No response",
  "today.month.st.waiting": "No answer yet",
  "today.month.st.pending": "Not yet",
  "today.month.st.untracked": "No record",
  "bp.page.noTarget": "No number from the doctor yet · record only",
  "bp.page.saved": "Recorded {s}/{d}",
  "bp.page.pulse": "Pulse {n}",
  "bp.page.today": "Today's readings",
  "bp.page.earlier": "Earlier readings",
  "bp.page.delete": "Delete",
  "bp.page.deleted": "Deleted: {reading}",
  "bp.page.changeTitle": "Change this reading",
  "bp.page.changing": "Changing {reading}",
  "bp.page.skip": "Not measured this time",
  "bp.page.skipped": "Recorded · not measured",
  "bp.page.plan": "How often, as the doctor said",
  "bp.page.planToday": "Today: {parts}",
  "bp.page.planDone": "{part}, measured",
  "bp.page.planNotMeasured": "{part}, not measured this time",
  "bp.page.planDue": "from {time}",
  "bp.page.planNone": "Not today",
  "bp.page.planEnded": "The days the doctor gave for measuring have passed.",
  "bp.page.cancel": "Keep it as it is",
  "bp.page.next": "Record another",
  // C2 track B (fix round 10-11): a reading from yesterday (real-app 6.2: when "yesterday"; components/daily/elder/BpYesterday.tsx)
  "bp.yesterday.open": "Add yesterday's",
  "bp.yesterday.title": "A reading from yesterday",
  "bp.yesterday.which": "Yesterday was {date}. Choose when it was measured:",
  "bp.yesterday.typing": "Yesterday ({date}), {part}. Type the two numbers:",
  "bp.yesterday.saved": "Yesterday ({date}), {part}",
  "bp.yesterday.otherPart": "Choose the other time",
  "bp.yesterday.cancel": "Not now",
} as const;

export type DailyKey = keyof typeof en;

const zhHans: Record<DailyKey, string> = {
  "ask.title": "想说什么、问什么",
  "ask.placeholder": "打字说一句",
  "ask.send": "发送",
  "ask.sending": "正在发送…",
  "ask.error": "没发出去，再试一次。",
  "ask.limit": "这个小时问得太多了，请稍后再试。",
  "ask.added": "已加入下次就诊的问题单",
  "ask.you": "你",

  "answer.original": "药袋原文：{text}",
  "answer.play": "播放",
  "answer.playing": "正在播放",
  "answer.standIn": "代录音",
  "answer.at": "{time} 处",

  "chip.records": "你的记录",
  "chip.recording": "录音",
  "chip.ripple": "Ripple",

  // owner 10-14: the reason after 未服药, its field and its button in professional words (the codes stay)
  "dose.reason.title": "未服药原因",
  "dose.reason.forgot": "忘记服用",
  "dose.reason.away": "外出",
  "dose.reason.not_with_me": "药物不在身边",
  "dose.reason.own": "其他原因",
  "dose.reason.placeholder": "请输入原因",
  "dose.reason.save": "保存",
  "dose.reason.saved": "原因：{reason}",
  "dose.undo.recorded": "{state}",
  "dose.undo": "撤销",
  "dose.state.later": "稍后服用（尚未确认）",
  "dose.state.noReply": "两次提醒均未回应（未确认）",
  "dose.reminderAt": "Ripple {time} 来问你",

  "reminder.tag": "提醒",
  "reminder.second": "第二次提醒",
  "reminder.play": "播放女儿的提醒",
  "reminder.question": "今天的早间药物服用了吗？",

  "bp.doctorNumber": "医生说过的数字",
  "bp.lineLabel": "医生说的数 {s}/{d}",
  "bp.onlyRecord": "这里记录你的读数。",
  "bp.readings": "你的读数",
  "bp.chart": "读数走势",
  "bp.empty": "暂无读数。",
  "bp.unconfirmed": "未确认",
  "bp.slot.morning": "早间",
  "bp.slot.midday": "午间",
  "bp.slot.evening": "晚间",
  "bp.slot.night": "夜间",
  "bp.measuring": "医生说的测量方法",
  "bp.record.title": "记录一次血压",
  "bp.record.top": "上面的数",
  "bp.record.bottom": "下面的数",
  "bp.record.save": "保存",
  "bp.record.saved": "已记录",
  "bp.record.invalid": "两个数都要填。",
  "bp.unit": "mmHg",

  "q.forDoctor": "问医生",
  "q.forPharmacist": "问药剂师",
  "q.origin.own": "自己想问的",
  "q.origin.before_you_go": "就诊时记录的",
  "q.origin.refused_question": "Ripple 没有回答的",
  "q.origin.pattern": "记录里的规律",
  "q.origin.unidentified_medicine": "认不出的药",
  "q.origin.understanding_check": "自己想问的",
  "q.origin.other": "问题",
  "q.recordedSummary": "记录的摘要，不是我的原话",
  "q.summaryOf": "记录的摘要：",
  "q.status.open": "待下次就诊时询问",
  "q.status.answered": "已回答",
  "q.status.skipped": "已搁置",
  "q.empty": "暂无问题。",
  "q.brief": "打开就诊简报",

  // left as they were on 10-14: the pattern question is his own question in his voice (「我漏吃的…」), and its words are
  // read by lib/safety/topics.ts (漏吃 is the "missed" topic) when questions are matched; new words could match differently
  "pattern.all": "我漏吃的 {n} 个早上都在{routine}的日子（{weekdays}）：{dates}。",
  "pattern.some": "我漏吃的 {total} 个早上里，有 {n} 个在{routine}的日子（{weekdays}）：{dates}。",
  "pattern.evidence": "漏吃的 {total} 个早上里，{n} 个在{routine}的日子（{weekdays}）：{dates}",

  "alerts.title": "提醒未回应",
  "alerts.item": "爸爸两次提醒均未回应：{date}{slot}的药物（{name}）。",

  // ---- C2 track B（账号）：一天里的时段，锁屏上的字（不出药名、剂量和读数）。owner 10-14：专业的说法（早间药物、尚未记录）
  "slot.morning": "早间",
  "slot.midday": "午间",
  "slot.evening": "晚间",
  "slot.night": "睡前",
  "slotMed.morning": "早间药物",
  "slotMed.midday": "午间药物",
  "slotMed.evening": "晚间药物",
  "slotMed.night": "睡前药物",
  "notice.dose.body": "尚未记录",
  "notice.family.title": "{who}尚未回应{slotMed}提醒",
  "notice.family.body": "{first} 和 {second} 两次提醒均未回应。",
  "notice.family.who": "家人",
  "due.go": "到今天页记录",
  "notice.bp.title": "该测量血压了",
  "notice.bp.body": "打开 Ripple 记录一次",

  // ---- C2 track B（账号）：今天页、服药的回答、血压那一行和血压页、离下次就诊
  "today.slot.coming": "{slotMed} · {time} 提醒",
  "today.slot.pending": "{slotMed} · 尚未记录",
  "today.slot.noReply": "{slotMed} · 截至 {time} 尚未记录",
  "today.slot.change": "{slotMed} · 改一下",
  "today.slot.notTaken": "{slotMed} · 未服药",
  "today.slot.untracked": "{slotMed} · 现在可以记录",
  "today.slot.yesterday": "昨天{slotMed} · 未记录",
  "today.later.title": "{time} 再次提醒",
  "today.later.noTime": "稍后再记录",
  "today.done.title": "已记录",
  "today.done.taken": "{time} 服用",
  "today.done.missed": "本次未服药",
  "today.done.reason": "原因：{reason}",
  "today.allDone": "今日药物均已记录",
  "today.later.next": "再次提醒",
  "today.closed.first": "已提醒",
  "today.closed.second": "再次提醒",
  "today.med.dispensed": "{date} 配药",
  "today.med.awaitingLabel": "等药袋确认",
  "today.routine": "作息",
  "today.undo.taken": "已服药",
  "today.undo.missed": "未服药",
  "today.undo.later": "稍后服用",
  "today.undo.reason": "未服药 · {reason}",
  "today.row.taken": "{part} · {time} 记录",
  "today.row.missed": "{part} · 未服药 · {time} 记录",
  "today.row.later": "{part} · 稍后服用（尚未确认）",
  "today.row.noReply": "{part} · 未记录（{time}）",
  "today.row.coming": "{time} 提醒你",
  "today.row.logNow": "现在记录",
  "today.row.yesterday": "昨天 · {slotMed}",
  "today.herEyes": "{names} 会看到：{state}",
  "today.herEyes.taken": "今日已服药",
  "today.herEyes.missed": "今日未服药",
  "today.herEyes.later": "尚未确认",
  "today.reminder.from": "{name} 的提醒",
  "today.reminder.fromDefault": "家人的提醒",
  "today.reminder.listen": "听 {name} 说",
  "today.reminder.listenDefault": "听提醒",
  "today.reminder.recording": "{name} 的录音",
  "today.reminder.recordingDefault": "家人的录音",
  "today.reminder.unavailable": "录音放不出来，她的话写在屏幕上。",
  "today.noMeds.title": "暂无药物",
  "today.noMeds.label": "拍药袋",
  "today.noMeds.visit": "记录就诊",
  "today.noSlot.ask": "{name} 什么时候服用？",
  "today.noSlot.hint": "药品标签上没有写服用时间，请你自己选择。",
  "today.noSlot.save": "就这样",
  "today.slotChosen": "你选的时间",
  "today.reason.ownLabel": "其他原因",
  "today.error": "未能记录，请再试一次。",
  "today.bp.label": "测量血压",
  "today.bp.dueNow": "该测量血压了（{part}）",
  "today.bp.dueLater": "{time} 起",
  "today.bp.done": "{part}已测量 · {time}",
  "today.bp.notMeasured": "{part}本次未测量",
  "today.bp.record": "记录一次",
  "today.bp.count": "今天记录 {n} 次",
  "today.next.label": "下次就诊",
  "today.next.today": "今天",
  "today.next.tomorrow": "明天 · {date}",
  "today.next.inDays": "{date} · 还有 {n} 天",
  "today.next.questions": "待问医生",
  "today.next.questionsN": "{n} 个",
  "today.next.brief": "就诊简报",
  "today.next.visit": "{when} 就诊",
  "today.next.visitToday": "{when}就诊",
  "today.next.visitInDays": "{when} 就诊 · 还有 {n} 天",
  "today.next.questionsWait": "{n}问题",
  "today.next.seeQuestions": "看问题单",
  "today.next.about": "大约 {date}",
  "today.next.aboutInDays": "大约 {date} · 还有 {n} 天",
  "today.next.on": "{date}",
  "today.next.booked": "我约的日子",
  "today.next.change": "改日子",
  "today.newMed.label": "拍一下新药的药袋",
  "today.next.briefReady": "就诊简报",
  "today.next.start": "开始就诊",
  "today.heading": "今日安排",
  "today.setup.title": "建好了",
  "today.setup.hint": "以后在「我 › 我的档案」里随时能改",
  "today.setup.ok": "知道了",
  // owner 10-14：今天页顶上他自己的月历，每种标记的意思、选中那天的记录；用词同她的月历（lib/care/month-copy.ts）
  "today.month.legend": "标记的意思",
  "today.month.taken": "全部已服药",
  "today.month.missed": "有未服药",
  "today.month.noReply": "提醒未回应",
  "today.month.pending": "待记录",
  "today.month.visit": "就诊",
  "today.month.planned": "预约就诊",
  "today.month.today": "今天",
  "today.month.backToday": "回到今天",
  "today.month.empty": "这一天没有记录",
  "today.month.st.taken": "已服药",
  "today.month.st.missed": "未服药",
  "today.month.st.noReply": "未回应",
  "today.month.st.waiting": "待回应",
  "today.month.st.pending": "未到时间",
  "today.month.st.untracked": "无记录",
  "bp.page.noTarget": "医生尚未给出数值 · 仅记录",
  "bp.page.saved": "已记录 {s}/{d}",
  "bp.page.pulse": "脉搏 {n}",
  "bp.page.today": "今天的读数",
  "bp.page.earlier": "以前的读数",
  "bp.page.delete": "删掉",
  "bp.page.deleted": "删掉了：{reading}",
  "bp.page.changeTitle": "改这次的读数",
  "bp.page.changing": "正在改 {reading}",
  "bp.page.skip": "本次未测量",
  "bp.page.skipped": "已记录 · 本次未测量",
  "bp.page.plan": "医生说的测量频次",
  "bp.page.planToday": "今天：{parts}",
  "bp.page.planDone": "{part}已测量",
  "bp.page.planNotMeasured": "{part}本次未测量",
  "bp.page.planDue": "{time} 起",
  "bp.page.planNone": "今日无需测量",
  "bp.page.planEnded": "医生说的测量日期已经结束。",
  "bp.page.cancel": "不改了",
  "bp.page.next": "再记录一次",
  "bp.yesterday.open": "补记昨天",
  "bp.yesterday.title": "补记昨天的读数",
  "bp.yesterday.which": "昨天是{date}。请选择测量时间：",
  "bp.yesterday.typing": "昨天（{date}）{part}。输当时的两个数：",
  "bp.yesterday.saved": "昨天（{date}）{part}",
  "bp.yesterday.otherPart": "换一个时候",
  "bp.yesterday.cancel": "不补了",
};

const messages: Record<Locale, Record<DailyKey, string>> = { en, "zh-Hans": zhHans };

/** Every string of the dictionary in one language, with its key (the word scans in tests). */
export function allDailyStrings(locale: Locale): [DailyKey, string][] {
  return Object.entries(messages[locale]) as [DailyKey, string][];
}

export function dt(locale: Locale, key: DailyKey, vars?: Record<string, string | number>): string {
  const template = messages[locale][key] ?? en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-08" -> "8 Sep" / "9月8日" */
export function shortDay(locale: Locale, iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [mo, d] = [Number(m[2]), Number(m[3])];
  return locale === "zh-Hans" ? `${mo}月${d}日` : `${d} ${MONTHS[mo - 1]}`;
}

/** "2026-09-01" -> "1 Sep 2026" / "2026年9月1日" */
export function longDay(locale: Locale, iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return locale === "zh-Hans" ? `${y}年${mo}月${d}日` : `${d} ${MONTHS[mo - 1]} ${y}`;
}

/** 43320 -> "0:43" (time point in a visit recording) */
export function clipTime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const WEEKDAY_ZH: Record<string, string> = { Sun: "周日", Mon: "周一", Tue: "周二", Wed: "周三", Thu: "周四", Fri: "周五", Sat: "周六" };

/** C2 track B: "08:45" -> "8:45" (a time inside a sentence that already says which part of the day). */
export function shortTime(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  return m ? `${Number(m[1])}:${m[2]}` : hhmm;
}

/** C2 track B: a time on its own, "20:15" -> 「晚上 8:15」 / "8:15 pm" (the elder side's way of saying a time). */
export function clockWords(locale: Locale, hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return hhmm;
  const h = Number(m[1]);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (locale === "en") return `${h12}:${m[2]} ${h < 12 ? "am" : "pm"}`;
  const part = h < 5 ? "凌晨" : h < 12 ? "早上" : h < 13 ? "中午" : h < 18 ? "下午" : "晚上";
  return `${part} ${h12}:${m[2]}`;
}

/** C2 track B: the real date as the top line says it, "2026-10-12" -> 「10月12日 周一」 / "Mon 12 Oct". */
export function dateWords(locale: Locale, iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  const en = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][wd];
  return locale === "zh-Hans" ? `${mo}月${d}日 ${WEEKDAY_ZH[en]}` : `${en} ${d} ${MONTHS[mo - 1]}`;
}

/** ["Tue", "Thu"] -> "Tue, Thu" / "周二、周四" */
export function weekdayList(locale: Locale, days: string[]): string {
  return locale === "zh-Hans" ? days.map((d) => WEEKDAY_ZH[d] ?? d).join("、") : days.join(", ");
}
