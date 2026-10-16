/**
 * The blood pressure screens' own words (design group 03 of the timeline draft; web/progress/fe-03.md). Client-safe.
 *
 * The app's sentences stay where they were (lib/daily/i18n.ts `bp.*` and `today.bp.*`, lib/ui/copy.ts): 「记下了：142/88」,
 * 「正在改 142/88」, 「删掉了：138/82」, 「这次没量」, 「医生说多久量一次」, 「医生还没给过数字，这里只记录。」 and the rest. Here are only
 * the words of what the new layout adds: the week view (its heading, the two week buttons, the chart's caption, the
 * facts of a past week), the row for today, the undo strip after a reading, the delete button on the edit screen, the
 * tag on a sentence he has not confirmed, the line under the loading bars and the error screen's second button.
 *
 * Nothing here judges a reading: no word about a number being high, low, good or normal, and no word that compares
 * a reading with the doctor's number (lib/safety/judgement.ts judgementHits; tests/unit/daily/bp-week.test.ts scans
 * both languages). The draft's 「不低于 135/85 的 13 次」 is therefore not on these screens: that count is the brief's,
 * for the doctor (lib/summary/bp.ts).
 *
 * Owner 10-15 (the demo video's second scene: 「量完显示今天超过了异常值」): after a reading outside the target his doctor
 * set, the card under it says so with the doctor's own numbers, who gave them and when (「超出了林医生定的目标」 / "outside
 * the target Dr Lim set": lib/daily/bp-target.ts, the target he confirmed), and asks him to hold a button and say what
 * happened today (components/bp/BpOutsideTarget.tsx). The same scan holds for these words: "outside", never "above",
 * "high" or 偏高.
 */
import type { Locale } from "@/lib/i18n";

const zh = {
  /** the header's grey line on the week view, after today's date */
  byWeek: "按周看",
  prevWeek: "上一周",
  nextWeek: "下一周",
  /** 「9月14日–9月20日」 */
  weekRange: "{from}–{to}",
  /** the week that holds today */
  weekCount: "本周 {n} 次",
  /** a week that has passed (owner 10-14: 记录 / 测量, not 记了 / 量) */
  weekCountPast: "记录 {n} 次",
  weekCountPastMissed: "记录 {n} 次，未确认 {m} 次",
  weekEmpty: "这一周没有读数。",
  chartLabel: "这一周的血压读数",
  /** whose numbers the dashed lines are (never a name: the record only knows 「医生」) */
  capTwo: "两条虚线是医生 {date}说的 {s}/{d}{at}。",
  capOne: "虚线是医生 {date}说的 {s}{at}。",
  capTwoInferred: "两条虚线是 {date}说的 {s}/{d}{at}，好像是医生说的。",
  capOneInferred: "虚线是 {date}说的 {s}{at}，好像是医生说的。",
  /** inside the caption: where in the recording */
  capAt: "（录音 {time}）",
  /** when the bars carry no numbers (several readings on a day, or neighbours too close) */
  capBelow: "每一次的读数列在下面。",
  avgOf: "{n} 次的平均",
  highestTop: "上面的数最高",
  today: "今天",
  noneToday: "暂无读数",
  /** a reading of today above the doctor's warning line, named over his words: 「今天 晚上 8:00 记录的 185/112」 */
  relayOf: "今天 {time} 记录的 {reading}",
  notConfirmedYet: "你尚未确认这一句",
  /** under the keypad (the draft's grey line under the three rows): the app's own hint, then what the three short words are */
  recordHint: "照血压计屏幕输入",
  deleteThis: "删掉这次读数",
  deleteSkipped: "删掉这一条",
  /** his own entry on a line */
  you: "你",
  undoSaved: "{reading}",
  undoSkipped: "本次未测量",
  /** the way on from the screen after a reading (ux pass 10-12, round 4; its 「提问」 is the round Ask button since 10-15) */
  seeWeek: "看这一周",
  loadingSlow: "还在打开，网络有点慢",
  /** the error screen's second button (its two sentences are the app's own: lib/subject/unavailable.ts) */
  errToday: "先看今天",
  // ---- owner 10-15: the card after a reading outside the target his doctor set (components/bp/BpOutsideTarget.tsx)
  /** 「152/96 超出了林医生定的目标」 */
  outsideTitle: "{reading} 超出了{doctor}定的目标",
  /** 「目标是 135/85（9月3日定）。」: who set it is in the title above */
  outsideSource: "目标是 {target}（{date}定）。",
  /** the doctor without a name on record, in the title */
  yourDoctor: "医生",
  tellHold: "按住，告诉 Ripple 今天发生了什么",
  tellHoldHint: "说话的时候一直按住按钮。",
  tellListening: "正在听……说完松开",
  tellListeningShort: "正在听……",
  tellCancel: "上滑取消",
  tellCancelNow: "松开取消",
  tellMic: "麦克风：",
  tellMaking: "正在把你的话写下来……",
  tellNoted: "记下了：",
  tellAdding: "正在加一个下次就诊要问的问题……",
  tellAdded: "已加到下次就诊的问题单：",
  tellUpdated: "下次就诊的问题，按你刚说的重写了：",
  tellAlready: "问题单里已经有这一条：",
  tellKept: "关于这次读数的问题保持不变：",
  tellSee: "看问题单",
  tellAgain: "再说一次",
  tellType: "改用打字",
  tellTypeLabel: "今天发生了什么？",
  tellSave: "记下",
  tellMicOff: "麦克风打不开，可以改用打字。",
  tellNothing: "没有听到说话。请按住按钮再说一次，或者改用打字。",
  tellFailed: "没有记下，请再试一次。",
};

const en: Record<keyof typeof zh, string> = {
  byWeek: "by week",
  prevWeek: "Earlier",
  nextWeek: "Later",
  weekRange: "{from} – {to}",
  weekCount: "{n} this week",
  weekCountPast: "{n} readings",
  weekCountPastMissed: "{n} readings, {m} not confirmed",
  weekEmpty: "No readings in this week.",
  chartLabel: "This week's blood pressure readings",
  capTwo: "The two dashed lines are the doctor's {s}/{d}, said on {date}{at}.",
  capOne: "The dashed line is the doctor's {s}, said on {date}{at}.",
  capTwoInferred: "The two dashed lines are {s}/{d}, said on {date}{at}: probably the doctor.",
  capOneInferred: "The dashed line is {s}, said on {date}{at}: probably the doctor.",
  capAt: " (recording {time})",
  capBelow: "Each reading is in the list after this picture.",
  avgOf: "Average of {n}",
  highestTop: "Largest top number",
  today: "Today",
  noneToday: "No reading yet",
  relayOf: "{reading}, recorded today at {time}",
  notConfirmedYet: "You have not confirmed this sentence yet",
  recordHint: "Copy the numbers from the monitor",
  deleteThis: "Delete this reading",
  deleteSkipped: "Delete this entry",
  you: "You",
  undoSaved: "{reading}",
  undoSkipped: "Not measured",
  seeWeek: "See this week",
  loadingSlow: "Still opening: the network is slow",
  errToday: "Go to Today",
  outsideTitle: "{reading} is outside the target {doctor} set",
  outsideSource: "The target is {target}, set on {date}.",
  yourDoctor: "your doctor",
  tellHold: "Hold to tell Ripple what happened today",
  tellHoldHint: "Keep holding the button while you speak.",
  tellListening: "Listening… let go when you have finished",
  tellListeningShort: "Listening…",
  tellCancel: "Slide up to cancel",
  tellCancelNow: "Let go to cancel",
  tellMic: "Microphone: ",
  tellMaking: "Writing down your words…",
  tellNoted: "Noted:",
  tellAdding: "Adding a question for your next visit…",
  tellAdded: "Added to your questions for the next visit:",
  tellUpdated: "Your question for the next visit, written again from what you just said:",
  tellAlready: "Already on your questions for the next visit:",
  tellKept: "Your question about this reading stays as it is:",
  tellSee: "See your questions",
  tellAgain: "Say it again",
  tellType: "Type instead",
  tellTypeLabel: "What happened today?",
  tellSave: "Save",
  tellMicOff: "The microphone could not be opened. You can type instead.",
  tellNothing: "No words were heard. Hold the button and speak again, or type.",
  tellFailed: "That did not go through. Please try again.",
};

export type BpKey = keyof typeof zh;

const ALL: Record<Locale, Record<BpKey, string>> = { "zh-Hans": zh, en };

/** One of the blood pressure screens' own sentences, with its values filled in. */
export function bpc(locale: Locale, key: BpKey, vars?: Record<string, string | number>): string {
  const template = ALL[locale]?.[key] ?? en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole));
}

/** Every sentence of one language with its key (the word scans in tests). */
export function allBpStrings(locale: Locale): [BpKey, string][] {
  return Object.entries(ALL[locale]) as [BpKey, string][];
}

/** 「这周量了 2 次」 in English reads "1 reading this week" for one. */
export function weekCountWords(locale: Locale, n: number, past = false, missed = 0): string {
  const words = past ? (missed > 0 ? bpc(locale, "weekCountPastMissed", { n, m: missed }) : bpc(locale, "weekCountPast", { n })) : bpc(locale, "weekCount", { n });
  return locale === "en" && n === 1 ? words.replace("1 readings", "1 reading") : words;
}
