/**
 * The words the UI components say by themselves: buttons, states, hints (chrome only). Clinical sentences never
 * come from here: they are the speaker's own words, the label, the leaflet or lib/safety templates, and the page
 * passes them in. Safe to import from client components.
 *
 * Elder side (UI_COPY) and daughter side (FAMILY_COPY). zh-Hans first; the English is the app's English.
 */
import { elderWords, relationWord } from "@/lib/care/copy";
import type { SourceKind, UiLocale } from "./tokens";

/**
 * The four places of his bottom bar (owner, 10-14): 今天, 就诊 (the visits and the questions for them), 记录 (his
 * medicines, his blood pressure, all his records) and 我. 「我」 is a place of the bar, not a circle in the header.
 */
export type TabKey = "today" | "visit" | "records" | "me";

export const TAB_KEYS: readonly TabKey[] = ["today", "visit", "records", "me"];

/** Where each tab goes on the patient phone. */
export const TAB_HREFS: Record<TabKey, string> = {
  today: "/p/today",
  visit: "/p/visit",
  records: "/p/records",
  me: "/p/me",
};

/**
 * The three pages that were tabs of their own until 10-14. A page may still name itself by its old key: the bar then
 * marks the place it belongs to now (the question list is part of 就诊, blood pressure and the medicines of 记录).
 */
export type FormerTabKey = "questions" | "bp" | "meds";

/** What a page passes as the bar's `active`: one of the four places, or one of the three former tabs. */
export type TabPage = TabKey | FormerTabKey;

/** The place of the bar a page belongs to. */
export const TAB_OF: Record<TabPage, TabKey> = {
  today: "today",
  visit: "visit",
  records: "records",
  me: "me",
  questions: "visit",
  bp: "records",
  meds: "records",
};

export interface UiCopy {
  standIn: string;
  herRecording: string;
  listen: string;
  playing: string;
  pause: string;
  listenUnavailable: string;
  change: string;
  undo: string;
  retry: string;
  loading: string;
  back: string;
  me: string;
  langSwitch: string;
  langSwitchLabel: string;
  tabsLabel: string;
  tabs: Record<TabKey, string>;
  /** a tapped tab whose page is still on its way (components/ui/TabWait.tsx): said after a moment */
  tabOpening: string;
  /** the same for 「今天」 (the draft's 通用-1) */
  tabOpeningToday: string;
  /** said in its place after three seconds */
  tabSlow: string;
  call: string;
  done: string;
  /** a done row that records something other than "done" (未服药, 稍后服用): a neutral mark, never the tick */
  noted: string;
  sources: Record<SourceKind, string>;
  inferredDoctor: string;
  asked: string;
  added: string;
  /* ask */
  askPrompt: [string, string];
  heard: string;
  askThis: string;
  sayAgain: string;
  typeInstead: string;
  sayInstead: string;
  micIdle: string;
  micListening: string;
  typePlaceholder: string;
  typeLabel: string;
  /* states */
  offlineTitle: string;
  offlineBody: string;
  micAskTitle: string;
  micAskBody: string;
  micAskButton: string;
  micDeniedTitle: string;
  micDeniedBody: string;
  micUnavailableTitle: string;
  micUnavailableBody: string;
  tapToPlay: string;
  tapToPlayWhy: string;
  /* dose */
  taken: string;
  notTaken: string;
  later: string;
  reasonTitle: string;
  reasonSelf: string;
  /* visit */
  forDoctorKicker: string;
  consentTitle: string;
  consentSub: string;
  consentStart: string;
  consentSkip: string;
  recording: string;
  recordingKeep: string;
  captionsEarlier: string;
  captionsNow: string;
  captured: string;
  capturedItems: string;
  stop: string;
  /* review */
  reviewOf: string;
  reviewAsk: string;
  reviewYes: string;
  reviewNo: string;
  reviewUnsure: string;
  listenThis: string;
  /* blood pressure */
  bpTitle: string;
  bpHint: string;
  bpSys: string;
  bpDia: string;
  bpPul: string;
  bpPulOptional: string;
  bpDelete: string;
  bpNext: string;
  bpSave: string;
  bpSaveEmpty: string;
  bpPulseSaved: string;
  /* switches */
  on: string;
  off: string;
  /* questions */
  askDoctor: string;
  askPharmacist: string;
  notAskedYet: string;
  answered: string;
  /* answers */
  yesNote: string;
  noNote: string;
  /* the timeline draft */
  /** the wide pill of the strip above the tab bar */
  saySpeak: string;
  saySwitchToType: string;
  /** the typing dock's way back to speaking */
  saySwitchToSpeak: string;
  sayType: string;
  /** the button that ends what he is saying (the microphone of the ask screen) */
  sayDone: string;
  /** the seconds left on the undo button: 「12 秒」 */
  secondsLeft: string;
  /** the short 「改」 of a row of actions (the long one, 「改一下」, is `change`) */
  changeShort: string;
  /** under the Chinese of someone's English words */
  translationNote: string;
  listenOriginal: string;
  seeOriginal: string;
  playingNow: string;
  stopPlaying: string;
  /** the grey word for a routine entry on the timeline: 「作息」 */
  routine: string;
}

export const UI_COPY: Record<UiLocale, UiCopy> = {
  "zh-Hans": {
    standIn: "代录音",
    herRecording: "家人的录音",
    listen: "听",
    playing: "正在播",
    pause: "暂停",
    listenUnavailable: "录音暂时放不了",
    change: "改一下",
    undo: "撤销",
    retry: "再试一次",
    loading: "正在载入",
    back: "返回",
    me: "我",
    langSwitch: "中/EN",
    langSwitchLabel: "切换语言：English",
    tabsLabel: "主菜单",
    // owner 10-14: four places, each an icon over its word (components/ui/TabBar.tsx)
    tabs: { today: "今天", visit: "就诊", records: "记录", me: "我" },
    tabOpening: "正在打开……",
    tabOpeningToday: "正在打开今天的记录…",
    tabSlow: "还在打开，网络有点慢。",
    call: "打",
    done: "已完成",
    noted: "已记录",
    sources: {
      doctor: "医生说",
      dispenser: "柜台说",
      pharmacist: "药剂师说",
      label: "药品标签",
      leaflet: "单张写着",
      family: "家人说",
      self: "我说的",
      ripple: "Ripple",
    },
    inferredDoctor: "好像是医生说的",
    asked: "你问",
    added: "已加入下次就诊的问题单",
    askPrompt: ["想问什么，", "按一下说。"],
    heard: "听到你说",
    askThis: "问这句",
    sayAgain: "重新说",
    typeInstead: "我想打字",
    sayInstead: "我想用说的",
    micIdle: "按一下开始说，说完再按一下",
    micListening: "正在听，说完再按一下",
    typePlaceholder: "想说什么、问什么",
    typeLabel: "打字问",
    offlineTitle: "现在没有网络。",
    offlineBody: "已经记录的都还在，可以查看。要问新问题，等有网络再问。",
    micAskTitle: "要用麦克风",
    micAskBody: "点下面的按钮，手机会问能不能用麦克风，请点「允许」。",
    micAskButton: "打开麦克风",
    micDeniedTitle: "麦克风被关掉了",
    micDeniedBody: "在手机的「设置」里找到这个浏览器，把「麦克风」打开，再回来。也可以先打字。",
    micUnavailableTitle: "这台手机用不了麦克风",
    micUnavailableBody: "可以打字问，一样会记录下来。",
    tapToPlay: "点一下，听家人的提醒",
    tapToPlayWhy: "手机要你先点一下，才能放声音。",
    // owner 10-14: professional words. 「稍后」 alone on the button: 「稍后服用」 wraps to two lines in a row of three at
    // 390px (the slot's buttons: 23px text in a 77px column); the toast and the rows say 「稍后服用」
    taken: "已服药",
    notTaken: "未服药",
    later: "稍后",
    reasonTitle: "未服药原因",
    reasonSelf: "其他原因",
    forDoctorKicker: "FOR THE DOCTOR",
    consentTitle: "录音",
    consentSub: "请医生看这一句",
    consentStart: "医生同意了，开始录",
    consentSkip: "这次不录",
    recording: "录音中",
    recordingKeep: "手机放在桌上就好，屏幕不会关。",
    captionsEarlier: "刚才",
    captionsNow: "现在",
    captured: "已记录",
    capturedItems: "{n} 件事",
    stop: "录完了",
    reviewOf: "第 {i} 件 / 共 {n} 件",
    reviewAsk: "这句是医生说的吗？",
    reviewYes: "是，医生说的",
    reviewNo: "不是",
    reviewUnsure: "不记得",
    listenThis: "听这一句",
    bpTitle: "记录血压",
    bpHint: "照着血压计屏幕上的数输：",
    bpSys: "上面的数",
    bpDia: "下面的数",
    bpPul: "脉搏",
    bpPulOptional: "可以不填",
    bpDelete: "删一个",
    bpNext: "下一个",
    bpSave: "保存 {sys}/{dia}",
    bpSaveEmpty: "输入上下两个数",
    bpPulseSaved: "脉搏 {pul}",
    on: "开",
    off: "关",
    askDoctor: "问医生",
    askPharmacist: "问药剂师",
    notAskedYet: "尚未询问",
    answered: "已询问",
    yesNote: "要，记下来",
    noNote: "不用",
    saySpeak: "按一下说",
    saySwitchToType: "改用打字",
    saySwitchToSpeak: "改用说的",
    sayType: "打字",
    sayDone: "说完了",
    secondsLeft: "{n} 秒",
    changeShort: "改",
    translationNote: "中文翻译，以英文原话为准",
    listenOriginal: "听原声",
    seeOriginal: "看原文",
    playingNow: "正在播放",
    stopPlaying: "停",
    routine: "作息",
  },
  en: {
    standIn: "stand-in recording",
    herRecording: "Your family's recording",
    listen: "Listen",
    playing: "Playing",
    pause: "Pause",
    listenUnavailable: "The recording can't play right now",
    change: "Change",
    undo: "Undo",
    retry: "Try again",
    loading: "Loading",
    back: "Back",
    me: "Me",
    langSwitch: "中/EN",
    langSwitchLabel: "Switch language: 中文",
    tabsLabel: "Main",
    // four places at 18px on a 360px phone: the longest, 「Records」, takes about 70 of its 90px
    tabs: { today: "Today", visit: "Visits", records: "Records", me: "Me" },
    tabOpening: "Opening…",
    tabOpeningToday: "Opening today's record…",
    tabSlow: "Still opening. The network is a little slow.",
    call: "Call",
    done: "Done",
    noted: "Noted",
    sources: {
      doctor: "Doctor said",
      dispenser: "Clinic counter said",
      pharmacist: "Pharmacist said",
      label: "The label says",
      leaflet: "The leaflet says",
      family: "Your family said",
      self: "You said",
      ripple: "Ripple",
    },
    inferredDoctor: "Probably the doctor",
    asked: "You asked",
    added: "In the questions for your next visit",
    askPrompt: ["Want to ask something?", "Tap and speak."],
    heard: "I heard",
    askThis: "Ask this",
    sayAgain: "Say it again",
    typeInstead: "I'd rather type",
    sayInstead: "I'd rather speak",
    micIdle: "Tap to start, tap again when you finish",
    micListening: "Listening. Tap again when you finish",
    typePlaceholder: "Say or ask anything",
    typeLabel: "Type a question",
    offlineTitle: "No internet right now.",
    offlineBody: "Everything already saved is still here to read. New questions wait until you are back online.",
    micAskTitle: "The microphone is needed",
    micAskBody: "Tap the button below. The phone asks whether Ripple may use the microphone: tap Allow.",
    micAskButton: "Turn on the microphone",
    micDeniedTitle: "The microphone is switched off",
    micDeniedBody: "In the phone's Settings, find this browser and switch Microphone on, then come back. You can type for now.",
    micUnavailableTitle: "This phone can't use a microphone",
    micUnavailableBody: "Type your question instead. It is kept the same way.",
    tapToPlay: "Tap to hear your family's reminder",
    tapToPlayWhy: "The phone needs one tap before it plays sound.",
    taken: "Taken",
    notTaken: "Not yet",
    later: "Later",
    reasonTitle: "Reason",
    reasonSelf: "I'll say it",
    forDoctorKicker: "FOR THE DOCTOR",
    consentTitle: "Recording",
    consentSub: "Show the doctor this line",
    consentStart: "The doctor agreed: record",
    consentSkip: "Not this time",
    recording: "Recording",
    recordingKeep: "Leave the phone on the table. The screen stays on.",
    captionsEarlier: "Earlier",
    captionsNow: "Now",
    captured: "Kept so far",
    capturedItems: "{n} things",
    stop: "Finished",
    reviewOf: "{i} of {n}",
    reviewAsk: "Did the doctor say this?",
    reviewYes: "Yes, the doctor",
    reviewNo: "No",
    reviewUnsure: "Not sure",
    listenThis: "Hear this line",
    bpTitle: "Blood pressure",
    bpHint: "Type the numbers on the monitor's screen:",
    bpSys: "Top number",
    bpDia: "Bottom number",
    bpPul: "Pulse",
    bpPulOptional: "optional",
    bpDelete: "Delete",
    bpNext: "Next",
    bpSave: "Save {sys}/{dia}",
    bpSaveEmpty: "Enter both numbers",
    bpPulseSaved: "pulse {pul}",
    on: "On",
    off: "Off",
    askDoctor: "For the doctor",
    askPharmacist: "For the pharmacist",
    notAskedYet: "Not asked yet",
    answered: "Answered",
    yesNote: "Yes, note it",
    noNote: "No",
    saySpeak: "Tap to speak",
    saySwitchToType: "Type instead",
    saySwitchToSpeak: "Speak instead",
    sayType: "Type",
    sayDone: "Done",
    secondsLeft: "{n} s",
    changeShort: "Change",
    translationNote: "Chinese translation; the English words are the original",
    listenOriginal: "Hear it",
    seeOriginal: "See label",
    playingNow: "playing",
    stopPlaying: "Stop",
    routine: "routine",
  },
};

export function uiCopy(locale: UiLocale): UiCopy {
  return UI_COPY[locale] ?? UI_COPY["zh-Hans"];
}

/** "{n} 件事" → "5 件事". Unknown names stay as they are. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole));
}

/** Undo bar: 12 s by default (tone v2 rule 04); never shorter than 10 s. */
export const UNDO_DEFAULT_MS = 12_000;
export const UNDO_MIN_MS = 10_000;

export function clampUndoMs(ms: number | undefined): number {
  if (ms === undefined || !Number.isFinite(ms)) return UNDO_DEFAULT_MS;
  return Math.max(UNDO_MIN_MS, Math.round(ms));
}

/** 0..1, anything else clamps. */
export function clampFraction(n: number | undefined, fallback = 0): number {
  if (n === undefined || !Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

/* ------------------------------------------------------------------ daughter side ---- */

/**
 * The words the daughter-side components say by themselves. A sentence that was here before the v3 relay is the one
 * written then; the keys added with the relay name elements the draft introduced (Ripple-Daughter-v3). Sentences that
 * carry his name or a time are templates: {name}, {time}; and every word for him is one: {dad} (爸爸 / Dad), {he},
 * {his}, {him} ({He}, {His} at the head of an English sentence), filled by familyCopy from how she calls him.
 */
export interface FamilyCopy {
  dadToday: string;
  me: string;
  /** her bottom bar, the iOS app's four tabs (owner 10-14) */
  tabs: { home: string; week: string; notice: string; me: string };
  tabsLabel: string;
  record: string;
  call: string;
  gotIt: string;
  retry: string;
  loading: string;
  back: string;
  backHome: string;
  login: string;
  sharedTitle: string;
  sharedLead: string;
  sharedYes: string;
  sharedNo: string;
  sharedOn: string;
  sharedBy: string;
  privacy: string;
  noReplyTag: string;
  noReplyNote: string;
  lastRecord: string;
  whatItWas: string;
  seeMorning: string;
  weekLabel: string;
  /** Monday first: 一 二 三 四 五 六 日 */
  weekdays: [string, string, string, string, string, string, string];
  /** the three rows of her home, named while their values load */
  loadingRows: [string, string, string];
  /* recorder */
  recTitle: string;
  recTips: [string, string, string];
  recStart: string;
  recStop: string;
  recCancel: string;
  recRecording: string;
  recLiveTitle: string;
  recLiveBody: string;
  recDone: string;
  recListen: string;
  recPause: string;
  recAgain: string;
  recDelete: string;
  recUse: string;
  recSaving: string;
  recSaved: string;
  recSavedMark: string;
  recSavedTitle: string;
  recCardShows: string;
  recDeleted: string;
  recMicTitle: string;
  recMicBody: string;
  recMicAskButton: string;
  recMicLater: string;
  recMicDeniedTitle: string;
  recMicDenied: string;
  recError: string;
  recPlaysAt: string;
  recHerVoice: string;
  recOwnVoice: string;
  recStandInNow: string;
  recCurrent: string;
  recMine: string;
  /* invite */
  inviteKicker: string;
  inviteTitle: string;
  inviteLead: string;
  inviteSees: string;
  inviteAccept: string;
  inviteNotNow: string;
  inviteWaitTitle: string;
  inviteWaitBody: string;
  inviteDoneTitle: string;
  inviteDoneBody: string;
  inviteOpenHome: string;
  inviteUsedTitle: string;
  inviteUsedBody: string;
  inviteUsedNote: string;
  inviteError: string;
  /* states */
  emptyTitle: string;
  errorTitle: string;
  notShared: string;
}

export const FAMILY_COPY: Record<UiLocale, FamilyCopy> = {
  "zh-Hans": {
    dadToday: "{dad}今天",
    me: "我的",
    tabs: { home: "主页", week: "日历", notice: "留意", me: "我的" },
    tabsLabel: "主要页面",
    record: "录一段新的提醒",
    call: "打电话给{dad}",
    gotIt: "我知道了",
    retry: "再试一次",
    loading: "正在载入",
    back: "返回",
    backHome: "回到首页",
    login: "登录",
    sharedTitle: "{dad}让你看到的",
    sharedLead: "这些由{dad}决定，{he}随时能改。",
    sharedYes: "{dad}同意给你看的",
    sharedNo: "没有分享",
    sharedOn: "开",
    sharedBy: "这些开关只有{dad}能在{his}手机上改。",
    privacy: "这些是{dad}同意给你看的。",
    noReplyTag: "提醒未回应",
    noReplyNote: "Ripple 不会替{him}记药，也不会一直响。要不要打电话，你来决定。",
    lastRecord: "{he}上一次记录",
    whatItWas: "记的是",
    seeMorning: "看今天早上",
    weekLabel: "这一周",
    weekdays: ["一", "二", "三", "四", "五", "六", "日"],
    loadingRows: ["血压", "待问医生", "下次就诊"],
    recTitle: "录一句话，每天 {time} 放给{dad}听。",
    recTips: ["叫{him}平时的称呼，像平常说话一样。", "一两句就好，说慢一点。", "刚录好的，先听一遍再决定。"],
    recStart: "开始录",
    recStop: "录完了",
    recCancel: "不录了",
    recRecording: "正在录",
    recLiveTitle: "在录了，慢慢说。",
    recLiveBody: "说完按「录完了」。",
    recDone: "刚录好的，先听一遍再决定。",
    recListen: "听一遍",
    recPause: "停一下",
    recAgain: "重录",
    recDelete: "删掉这段",
    recUse: "就用这段",
    recSaving: "正在保存…",
    recSaved: "已经换成这段。明天 {time} 开始放这段。",
    recSavedMark: "已经换成这段",
    recSavedTitle: "明天 {time} 开始放这段。",
    recCardShows: "{dad}的卡上会显示",
    recDeleted: "删掉了。{dad}那边继续放原来的提醒。",
    recMicTitle: "录音要用麦克风。",
    recMicBody: "点下面的按钮，手机会问你，请点「允许」。",
    recMicAskButton: "打开麦克风",
    recMicLater: "先不录",
    recMicDeniedTitle: "麦克风被关掉了。",
    recMicDenied: "在手机的设置里给这个浏览器打开麦克风，再回来录。",
    recError: "没存上。录音还在，再点一次「就用这段」。",
    recPlaysAt: "每天 {time} 放给{him}",
    recHerVoice: "你的提醒",
    recOwnVoice: "你录的",
    recStandInNow: "代录音",
    recCurrent: "现在放的",
    recMine: "我录过的",
    inviteKicker: "家人邀请",
    inviteTitle: "{name}邀请你看{his} Ripple",
    inviteLead: "接受以后，你只看得到{he}在自己的手机上为你打开的项目。每一项都要等{him}打开。",
    inviteSees: "{he}打开以后，你能看到",
    inviteAccept: "接受",
    inviteNotNow: "先不要",
    inviteWaitTitle: "已经告诉{dad}了，等{he}在手机上确认是你。",
    inviteWaitBody: "{his}手机上会出现你的名字和账号。{he}点「是她」以前，你什么都看不到。",
    inviteDoneTitle: "好了，{dad}确认是你。",
    inviteDoneBody: "以后打开 Ripple 就能看到{he}今天的情况。",
    inviteOpenHome: "看{dad}今天的情况",
    inviteUsedTitle: "这个邀请用不了了",
    inviteUsedBody: "一个邀请只能用一次。请{dad}在{his}手机上再发一个。",
    inviteUsedNote: "如果你已经接受过，直接登录就好。",
    inviteError: "现在连不上，邀请还在。请再试一次。",
    emptyTitle: "这里还没有内容。",
    errorTitle: "没能取到{dad}的最新情况。",
    notShared: "没有分享",
  },
  en: {
    dadToday: "{dad} today",
    me: "Me",
    tabs: { home: "Home", week: "Calendar", notice: "Notice", me: "Me" },
    tabsLabel: "Main screens",
    record: "Record a new reminder",
    call: "Call {dad}",
    gotIt: "Got it",
    retry: "Try again",
    loading: "Loading",
    back: "Back",
    backHome: "Back to home",
    login: "Log in",
    sharedTitle: "What {dad} lets you see",
    sharedLead: "{dad} decides these and can change them any time.",
    sharedYes: "{dad} agreed to share this",
    sharedNo: "Not shared",
    sharedOn: "On",
    sharedBy: "Only {dad} changes these, on {his} phone.",
    privacy: "These are what {dad} agreed to share with you.",
    noReplyTag: "No reply to the reminder",
    noReplyNote: "Ripple won't log {his} medicine for {him} and won't keep ringing. Whether to call is up to you.",
    lastRecord: "{His} last entry",
    whatItWas: "What {he} logged",
    seeMorning: "See this morning",
    weekLabel: "This week",
    weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    loadingRows: ["Blood pressure this week", "Questions for the doctor", "Next visit"],
    recTitle: "Record a sentence. {dad} hears it every day at {time}.",
    recTips: ["Call {him} what you always call {him}, as you normally talk.", "One or two sentences, slowly.", "Just recorded. Listen to it first, then decide."],
    recStart: "Record",
    recStop: "Done",
    recCancel: "Don't record",
    recRecording: "Recording",
    recLiveTitle: "Recording. Take your time.",
    recLiveBody: "Tap Done when you have said it.",
    recDone: "Just recorded. Listen to it first, then decide.",
    recListen: "Listen",
    recPause: "Pause",
    recAgain: "Record again",
    recDelete: "Delete this one",
    recUse: "Use this one",
    recSaving: "Saving…",
    recSaved: "Switched to this one. It plays from tomorrow at {time}.",
    recSavedMark: "Switched to this one",
    recSavedTitle: "It plays from tomorrow at {time}.",
    recCardShows: "{dad}'s card will show",
    recDeleted: "Deleted. {dad}'s phone keeps the earlier reminder.",
    recMicTitle: "Recording needs the microphone.",
    recMicBody: "Tap below and allow it when the phone asks.",
    recMicAskButton: "Turn on the microphone",
    recMicLater: "Not now",
    recMicDeniedTitle: "The microphone is off.",
    recMicDenied: "Allow it for this browser in the phone's settings, then come back.",
    recError: "It didn't save. Your recording is still here: tap Use this one again.",
    recPlaysAt: "Plays to {him} every day at {time}",
    recHerVoice: "Your reminder",
    recOwnVoice: "Recorded by you",
    recStandInNow: "Stand-in voice",
    recCurrent: "Playing now",
    recMine: "My recordings",
    inviteKicker: "Family invitation",
    inviteTitle: "{name} invited you to see {his} Ripple",
    inviteLead: "Once you accept, you see only the items {he} switches on for you, on {his} own phone. Each one waits for {him}.",
    inviteSees: "Once {he} switches them on, you can see",
    inviteAccept: "Accept",
    inviteNotNow: "Not now",
    inviteWaitTitle: "{dad} has been told. {He} confirms it's you on {his} phone.",
    inviteWaitBody: "Your name and account show on {his} phone. Until {he} taps \"It's her\", you see nothing.",
    inviteDoneTitle: "Done. {dad} confirmed it's you.",
    inviteDoneBody: "Open Ripple any time to see how {his} day is going.",
    inviteOpenHome: "See {dad}'s day",
    inviteUsedTitle: "This invite can't be used",
    inviteUsedBody: "An invite works only once. Ask {dad} to send a new one from {his} phone.",
    inviteUsedNote: "If you already accepted it, just log in.",
    inviteError: "Can't connect right now. The invite is still valid: try again.",
    emptyTitle: "Nothing here yet.",
    errorTitle: "Couldn't get {dad}'s latest updates.",
    notShared: "Not shared",
  },
};

/**
 * Her side's words in one language, said of him the way she calls him: `dad` is her word for him (his link's label,
 * or dadWord's), and {dad}, {he}, {his}, {him} in the sentences above are filled from it (lib/care/copy.ts elderWords:
 * 「妈妈」 gives 她 and 她的, a name stands where a pronoun would). null: no link in sight (her pages outside a link,
 * the design gallery): 爸爸 / Dad. {time} and {name} stay for the caller.
 */
export function familyCopy(locale: UiLocale, dad: string | null | undefined): FamilyCopy {
  const raw = FAMILY_COPY[locale] ?? FAMILY_COPY["zh-Hans"];
  const who = elderWords(dad, locale);
  const words = (t: string) => fill(t, who);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) out[key] = typeof value === "string" ? words(value) : Array.isArray(value) ? value.map((v) => (typeof v === "string" ? words(v) : v)) : value;
  return out as unknown as FamilyCopy;
}

// ---------------------------------------------------------------- C2 track S (round 2): family words from the care link
//
// real-app 6.16 「『女儿 Wei Ling』『Wei Ling said』改成按链接拼」 (3.10 line 747: 链接上的关系加称呼). The fixed words above used to
// say 女儿 / Wei Ling whoever the family member was; they are neutral now (家人 / your family), and a screen that knows the
// care link words her from it: the relation he chose (lib/care/copy.ts relationWord: 女儿, 儿子, 太太, 先生, 家人) and the name
// he gave her. A link with no relation reads 家人; no name, the relation alone.

const named = (name: string | null | undefined): string | null => (name && name.trim() ? name.trim() : null);

/** Whose recording a reminder is: 「女儿的录音」, 「儿子的录音」, 「家人的录音」 / "Your daughter's recording". */
export function familyRecordingWords(locale: UiLocale, relation?: string | null): string {
  const rel = relationWord(relation, locale);
  return locale === "en" ? `Your ${rel}'s recording` : `${rel}的录音`;
}

/** Who said a family line: 「女儿 Wei Ling 说」, 「家人说」 / "Wei Ling (daughter) said", "Your family said". */
export function familySaidWords(locale: UiLocale, relation?: string | null, name?: string | null): string {
  const n = named(name);
  const rel = relationWord(relation, locale);
  if (locale === "en") return n ? `${relation ? `${n} (${rel})` : n} said` : `Your ${rel} said`;
  return n ? `${relation ? `${rel} ${n}` : n} 说` : `${rel}说`;
}

/** The big button when the browser will not play by itself: 「点一下，听 Wei Ling 的提醒」, 「点一下，听女儿的提醒」. */
export function tapToHearWords(locale: UiLocale, relation?: string | null, name?: string | null): string {
  const n = named(name);
  const rel = relationWord(relation, locale);
  if (locale === "en") return n ? `Tap to hear ${n}'s reminder` : `Tap to hear your ${rel}'s reminder`;
  return n ? `点一下，听 ${n} 的提醒` : `点一下，听${rel}的提醒`;
}
