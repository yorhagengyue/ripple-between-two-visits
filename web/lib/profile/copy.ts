/**
 * The fixed words of track C's screens (question list, profile, setting up, the example account, 「我」). Chrome
 * only: no clinical sentence lives here (clinical words on these screens are his own, the clinicians' recorded words,
 * or lib/safety's templates through other modules). Client-safe.
 */
import type { QuestionOrigin as UiQuestionOrigin } from "@/components/ui/QuestionRow";

export type CLocale = "zh-Hans" | "en";
const pick = <T>(locale: CLocale, zh: T, en: T): T => (locale === "zh-Hans" ? zh : en);

/** Store origins -> the list's origin words (components/ui QuestionRow). */
export function uiOrigin(origin: string): UiQuestionOrigin {
  switch (origin) {
    case "refused_question":
      return "refused";
    case "pattern":
      return "pattern";
    case "unidentified_medicine":
      return "unknown_medicine";
    case "preventive":
      return "prevention";
    case "watch_pattern":
      return "watch";
    case "before_you_go":
      return "before_you_go";
    case "reading":
      return "reading";
    default:
      return "own";
  }
}

export function questionsCopy(locale: CLocale) {
  return {
    headlineSome: (n: number) => pick(locale, ["下次就诊", `${n} 个问题`], ["Next visit", n === 1 ? "1 question" : `${n} questions`]),
    headlineNone: pick(locale, ["还没有问题"], ["No questions yet"]),
    stillToAsk: pick(locale, "还没问的", "Still to ask"),
    // the two words under a question: the draft's short ones (ux pass 10-12; real-app 2.11 had 「改一下字」 「这条不问了」)
    change: pick(locale, "改", "Change"),
    skip: pick(locale, "跳过", "Skip"),
    merge: pick(locale, "和上面那条一样，合并", "Same as above: merge"),
    answeredLink: pick(locale, "回答过的", "Answered"),
    skippedLink: pick(locale, "跳过的", "Skipped"),
    preventLink: pick(locale, "预防：筛查和疫苗", "Prevention: screening and vaccines"),
    add: pick(locale, "加一个问题", "Add a question"),
    count: (n: number) => pick(locale, `${n} 个`, `${n}`),
    toastSkipped: pick(locale, "已跳过", "Skipped"),
    toastMerged: pick(locale, "合并了", "Merged"),
    noticeCreated: pick(locale, "加上了。", "Added."),
    noticeMerged: pick(locale, "已在问题单", "Already on your list"),
    noticeReopened: pick(locale, "已放回问题单", "Back on your list"),
    noticeAnswered: pick(locale, "医生已经回答过这个问题。", "Your doctor already answered this question."),
    noticeEdited: pick(locale, "改好了。", "Changed."),
    summaryNote: pick(locale, "记录的摘要，不是你的原话", "A summary on record, not your own words"),
    summaryOf: pick(locale, "记录的摘要：", "Summary on record: "),
    edited: pick(locale, "你改过的字", "Your own words, changed"),
    /** where a question came from, for one a family member put on his list from her side (owner 10-14) */
    fromFamily: pick(locale, "家人加的", "Added by family"),
    justAdded: pick(locale, "刚加上的", "Just added"),
    alreadyThere: pick(locale, "已在问题单", "Already on your list"),
    putBackTag: pick(locale, "放回来了", "Back on the list"),
    changedTag: pick(locale, "刚改过", "Just changed"),
    // add / edit
    addTitle: pick(locale, ["新问题"], ["New question"]),
    editTitle: pick(locale, ["改一下这个问题"], ["Change this question"]),
    yourQuestion: pick(locale, "你的问题", "Your question"),
    placeholder: pick(locale, "写下问题", "Write your question"),
    whoToAsk: pick(locale, "问谁", "Who to ask"),
    doctor: pick(locale, "问医生", "The doctor"),
    pharmacist: pick(locale, "问药剂师", "The pharmacist"),
    addIt: pick(locale, "加上", "Add it"),
    save: pick(locale, "改好了", "Save"),
    tooLong: pick(locale, "字太多了，300 个字以内。", "Too long: 300 characters at most."),
    empty: pick(locale, "先写下你的问题。", "Write your question first."),
    failed: pick(locale, "没有存上，再试一次。", "Not saved. Please try again."),
    // answered / set aside
    answeredTitle: pick(locale, ["回答过的问题"], ["Questions that were answered"]),
    answeredNone: pick(locale, "还没有回答过的问题", "No answered questions yet"),
    doctorSaid: pick(locale, "医生说", "Your doctor said"),
    pharmacistSaid: pick(locale, "药剂师说", "Your pharmacist said"),
    counterSaid: pick(locale, "柜台说", "The counter said"),
    recording: pick(locale, "录音里说", "In the recording"),
    at: (date: string, time: string) => (time ? pick(locale, `${date} · ${time} 处`, `${date} · at ${time}`) : date),
    listen: pick(locale, "听原声", "Listen"),
    skippedTitle: pick(locale, ["跳过的问题"], ["Skipped questions"]),
    skippedNone: pick(locale, "没有跳过的问题", "No skipped questions"),
    putBack: pick(locale, "放回去", "Put back"),
    toastPutBack: pick(locale, "放回去了", "Back on the list"),
    backToList: pick(locale, "问题单", "To ask"),
    // the timeline design (front-end line fe-14, group 14): the parts the new layout adds
    /** the section of answered questions on the list */
    answeredHeading: pick(locale, "已答的", "Answered"),
    // owner 10-14: one list, the doctor's and the pharmacist's questions together, and part of the visit tab
    /** the list's name as a section of the visit tab */
    listName: pick(locale, "问题单", "Questions"),
    /** the small tag on a question for the pharmacist (the one list has no sides) */
    pharmacistTag: pick(locale, "药剂师", "Pharmacist"),
    /** the visit tab shows five: the way to all of them */
    seeAll: (n: number) => pick(locale, `看全部（${n}）`, `See all (${n})`),
    /** the way to the visit tab's list when it could not be read */
    openList: pick(locale, "看问题单", "See the questions"),
    /** asking Ripple now (/p/ask): what the say bar used to open */
    askRipple: pick(locale, "提问", "Ask Ripple"),
  };
}

export function exampleCopy(locale: CLocale) {
  return {
    banner: pick(locale, "示例资料：陈先生（虚构人物）", "Example data: Mr Tan (a made-up person)"),
    bannerMore: pick(locale, "这是什么", "What is this"),
    introTitle: pick(locale, "这是陈先生的示例资料", "This is Mr Tan's example data"),
    introBody: pick(
      locale,
      "他 6 周前第一次就诊，后来开了降压药，今天要去复诊。你可以点「已服药」、提问、看简报，或者去就诊。",
      "He first saw his doctor six weeks ago, was then prescribed a blood pressure tablet, and has a follow-up visit today. You can tap 「Taken」, ask a question, look at the brief, or go to the visit.",
    ),
    gotIt: pick(locale, "知道了", "Got it"),
    tryAsking: pick(locale, "可以这样问", "You could ask"),
    exampleTag: pick(locale, "示例", "Example"),
    // /p/me/example
    pageTitle: pick(locale, ["示例资料"], ["Example data"]),
    pageLede: pick(
      locale,
      "这个账号用的是陈先生的示例资料：虚构人物，六周的记录，按今天的日期铺好。人物、药、读数和就诊都是编的，没有真人的资料。",
      "This account runs on Mr Tan's example data: a made-up person, six weeks of records laid out on today's dates. The people, medicines, readings and visits are invented; nothing here is a real person's.",
    ),
    rowsFrom: pick(locale, "第一次就诊", "First doctor's visit"),
    rowsToday: pick(locale, "今天", "Today"),
    rowsVisit: pick(locale, "计划中的复诊", "Planned follow-up"),
    reseed: pick(locale, "重新铺一遍示例资料", "Lay out the example again"),
    reseedHint: pick(locale, "你点过的、记下的都会清掉，按今天重新铺好六周。", "What you tapped and recorded goes; six weeks are laid out again for today."),
    clear: pick(locale, "清空，从我自己的开始", "Clear it and start with my own"),
    clearHint: pick(locale, "示例资料全部删掉，换成空白的，从建档开始。", "All the example data goes; you start blank, from setting up."),
    notExample: pick(locale, ["这个账号用的是你自己的资料。"], ["This account holds your own data."]),
    working: pick(locale, "正在处理…", "Working…"),
    failed: pick(locale, "没有做成，再试一次。", "That did not work. Please try again."),
    meStatus: pick(locale, "陈先生的六周记录，按今天的日期", "Mr Tan's six weeks, on today's dates"),
    meTitle: pick(locale, "示例资料", "Example data"),
    // 「我」 on the example account: the two rows of real-app 2.23 line 315
    meReseedStatus: pick(locale, "按今天重新铺好六周", "Six weeks laid out again for today"),
    meClearStatus: pick(locale, "示例全部删掉，从建档开始", "The example goes; you start from setting up"),
    reseedTitle: pick(locale, ["重新铺一遍", "示例资料"], ["Lay out the example", "again"]),
    clearTitle: pick(locale, ["清空，", "从我自己的开始"], ["Clear it and start", "with my own"]),
    keep: pick(locale, "不动它", "Leave it as it is"),
  };
}

export function onboardCopy(locale: CLocale) {
  return {
    progress: (n: number, total: number) => pick(locale, `建档 · 第 ${n} 步，共 ${total} 步`, `Setting up · step ${n} of ${total}`),
    back: pick(locale, "上一步", "Back"),
    next: pick(locale, "下一步", "Next"),
    skip: pick(locale, "跳过", "Skip"),
    save: pick(locale, "改好了", "Save"),
    cancel: pick(locale, "不改了", "Keep it"),
    failed: pick(locale, "没有存上，再试一次。", "Not saved. Please try again."),
    helped: pick(locale, "现在是家人帮你填：这些要你自己点「对」以后才算数。", "A family member is filling this in for you: none of it counts until you tap 「Yes」 yourself."),
    // who
    whoTitle: pick(locale, ["现在是谁在填？"], ["Who is filling this in?"]),
    whoSelf: pick(locale, "我自己填", "I am"),
    whoFamily: pick(locale, "家人帮我填", "My family, for me"),
    whoHint: pick(locale, "注册时说过是家人帮忙操作。", "At sign-up you said a family member was helping."),
    whoLede: pick(locale, "家人填的内容，要等你自己确认。", "What a family member fills in waits for you to confirm it."),
    // clinic
    clinicTitle: pick(locale, ["你常去哪家诊所？"], ["Which clinic do you usually go to?"]),
    clinicLabel: pick(locale, "诊所的名字", "The clinic's name"),
    clinicPlaceholder: pick(locale, "例如：Blossom Family Clinic", "For example: Blossom Family Clinic"),
    clinicLede: pick(locale, "就诊记录的地点会先写它。", "Your visits will say this place unless you change it."),
    // breakfast
    breakfastTitle: pick(locale, ["早饭一般几点吃？"], ["When do you usually have breakfast?"]),
    // the slot's name is lib/daily's (slotMed.morning, 早间药物 since the owner's 10-14 decision), here and below
    breakfastLede: (at: string) => pick(locale, `早间药物，会在 ${at} 提醒你。`, `Your morning medicine reminder will be at ${at}.`),
    breakfastLedeHelped: (at: string) => pick(locale, `他自己点了「对」以后，早间药物会在 ${at} 提醒。`, `Once he taps 「Yes」 himself, his morning medicine reminder will be at ${at}.`),
    otherTime: pick(locale, "别的时间", "Another time"),
    timeLabel: pick(locale, "几点", "Time"),
    // habits
    habitsTitle: pick(locale, ["每个星期有没有固定要做的事？"], ["Anything you do every week?"]),
    habitsLede: pick(locale, "例如星期二、四早上打太极。未服药时，询问原因会先列出这些。", "For example tai chi on Tuesday and Thursday mornings. If a dose is missed, these come first among the reasons."),
    habitsYours: pick(locale, "你的安排", "Your week"),
    habitsNone: pick(locale, "还没有。", "None yet."),
    habitWhat: pick(locale, "做什么", "What"),
    habitOwn: pick(locale, "我自己写", "My own words"),
    habitOwnLabel: pick(locale, "要做的事", "What you do"),
    habitDays: pick(locale, "星期几", "Which days"),
    habitTime: pick(locale, "几点", "What time"),
    habitAdd: pick(locale, "加上这件事", "Add this"),
    habitRemove: pick(locale, "删掉", "Remove"),
    habitIncomplete: pick(locale, "选好做什么、星期几和几点。", "Choose what, which days and what time."),
    // meds
    medsTitle: pick(locale, ["你现在有正在服用的药吗？"], ["Are you taking any medicine now?"]),
    medsLede: pick(locale, "拍一下药袋，Ripple 按药品标签上写的提醒你。", "Take a photo of the bag; Ripple reminds you as the label says."),
    medsPhoto: pick(locale, "去拍药袋", "Photograph the bag"),
    later: pick(locale, "以后再说", "Later"),
    // age
    ageTitle: pick(locale, ["你今年几岁？"], ["How old are you?"]),
    ageLabel: pick(locale, "岁数", "Age"),
    ageInvalid: pick(locale, "写一个 18 到 120 之间的数。", "A number from 18 to 120."),
    // conditions / allergies
    conditionsTitle: pick(locale, ["医生说过你有什么病吗？"], ["Has a doctor told you of any condition?"]),
    conditionsLede: pick(locale, "只是记下来，下次就诊时给医生看。", "Just written down, for your doctor to see next time."),
    allergiesTitle: pick(locale, ["有没有对什么药或食物过敏？"], ["Any allergies to medicines or food?"]),
    own: pick(locale, "我自己说", "In my own words"),
    ownLabel: pick(locale, "你的话", "Your words"),
    ownAdd: pick(locale, "加上", "Add"),
    already: pick(locale, "已记录的", "Already written down"),
    // family
    familyTitle: pick(locale, ["要不要请家人一起看？"], ["Would you like family to see some of it?"]),
    familyLede: pick(locale, "你选她能看什么，开关都在你手里，一开始全关着。", "You choose what she sees; every switch is yours and starts off."),
    familyInvite: pick(locale, "现在邀请", "Invite now"),
    // reminders
    remindersTitle: pick(locale, ["开提醒"], ["Turn on reminders"]),
    remindersLede: (at: string) => pick(locale, `早间药物，${at} 提醒你。手机会问你要不要收通知，点「允许」。`, `Your morning medicine at ${at}. Your phone will ask about notifications: tap 「Allow」.`),
    remindersOn: pick(locale, "开提醒", "Turn on"),
    remindersDone: pick(locale, "提醒开好了：手机刚收到一条「提醒已经开好了」。", "Reminders are on: your phone just got 「Reminders are on」."),
    remindersDenied: pick(
      locale,
      "提醒没开：这台手机不让 Ripple 发通知。要开的话，到手机的设置里允许这个网页发通知。打开 app 时，照样看得到提醒。",
      "Reminders are off: this phone does not let Ripple send notifications. To turn them on, allow this site to send notifications in the phone's settings. You still see the reminders when you open the app.",
    ),
    remindersDismissed: pick(locale, "还没开提醒。想开的时候再点「开提醒」，以后也能在「我 › 提醒和通知」里开。", "Reminders are not on yet. Tap 「Turn on」 when you want them, or later under 「Me › Reminders and notifications」."),
    remindersUnsupported: pick(locale, "这台手机的浏览器发不了提醒：打开 app 时，照样看得到提醒。", "This phone's browser cannot show reminders: you still see them when you open the app."),
    remindersFailed: pick(locale, "提醒没开好。可以再试一次，以后也能在「我 › 提醒和通知」里开。", "Reminders could not be turned on. Try again, or later under 「Me › Reminders and notifications」."),
    remindersHomeTitle: pick(locale, "iPhone 要先把 Ripple 装到主屏幕，才收得到提醒：", "On an iPhone, Ripple has to be on the home screen first to get reminders:"),
    remindersHomeSteps: pick(
      locale,
      ["点浏览器下面的「分享」", "选「添加到主屏幕」", "从主屏幕打开 Ripple，再点「开提醒」"],
      ["Tap 「Share」 at the bottom of the browser", "Choose 「Add to Home Screen」", "Open Ripple from the home screen and tap 「Turn on」"],
    ),
    tryAgain: pick(locale, "再试一次", "Try again"),
    // done
    doneTitle: pick(locale, "建好了。", "All set."),
    doneDetail: pick(locale, "以后在「我 › 我的档案」里随时能改。", "You can change any of it under 「Me › My details」."),
    doneClinic: pick(locale, "常去的诊所", "Clinic"),
    doneBreakfast: pick(locale, "早饭", "Breakfast"),
    doneReminder: pick(locale, "早间药物提醒", "Morning medicine reminder"),
    doneFacts: pick(locale, "记下的事", "Written down"),
    donePending: pick(locale, "等你确认", "Waiting for you"),
    count: (n: number) => pick(locale, `${n} 条`, `${n}`),
    none: pick(locale, "没有", "None"),
    goToday: pick(locale, "去「今天」", "Go to Today"),
  };
}

export function profileCopy(locale: CLocale) {
  return {
    title: pick(locale, ["我的档案"], ["My details"]),
    pendingTitle: (n: number) => pick(locale, ["家人写了", `${n} 条，请你看一下。`], ["Your family wrote", n === 1 ? "1 thing. Please check it." : `${n} things. Please check them.`]),
    wrote: (who: string) => pick(locale, `${who}${/[一-鿿]$/.test(who) ? "" : " "}写了：`, `${who} wrote:`),
    familyWho: (label: string | null) => (label && label !== "family" ? label : pick(locale, "家人", "Your family")),
    isRight: pick(locale, "对吗？", "Is that right?"),
    yes: pick(locale, "对", "Yes"),
    change: pick(locale, "改一下", "Change"),
    no: pick(locale, "不对", "No"),
    saveChange: pick(locale, "改好了", "Save"),
    name: pick(locale, "称呼", "Name"),
    age: pick(locale, "年龄", "Age"),
    clinic: pick(locale, "常去的诊所", "Clinic"),
    breakfast: pick(locale, "早饭", "Breakfast"),
    reminder: pick(locale, "早间药物提醒", "Morning medicine reminder"),
    habits: pick(locale, "固定要做的事", "Regular habits"),
    conditions: pick(locale, "医生说过的病", "Conditions a doctor told you of"),
    allergies: pick(locale, "过敏", "Allergies"),
    languages: pick(locale, "语言", "Languages"),
    home: pick(locale, "住在", "Lives in"),
    other: pick(locale, "别的", "Other"),
    notYet: pick(locale, "还没写", "Not yet"),
    bySelf: pick(locale, "你自己写的", "You wrote it"),
    byFamilyConfirmed: (who: string) => pick(locale, `本人确认（${who}写的）`, `Confirmed by you (${who} wrote it)`),
    byFamilyChanged: (who: string) => pick(locale, `你改过（${who}写的）`, `Changed by you (${who} wrote it)`),
    fromVisit: pick(locale, "就诊时记录的", "From a visit"),
    exampleSource: pick(locale, "示例资料", "Example data"),
    failed: pick(locale, "没有存上，再试一次。", "Not saved. Please try again."),
    setUp: pick(locale, "接着建档", "Continue setting up"),
  };
}

/**
 * 「我」 (real-app 2.23): the rows of its own that are track C's (称呼, 语言, 早饭时间和提醒, 退出登录) and the screens behind
 * the first three. The times' part names (早间药物 …) come from lib/daily/i18n, like everywhere else.
 */
export function meCopy(locale: CLocale) {
  return {
    me: pick(locale, "我", "Me"),
    notYet: pick(locale, "还没写", "Not yet"),
    save: pick(locale, "改好了", "Save"),
    cancel: pick(locale, "不改了", "Keep it"),
    failed: pick(locale, "没有存上，再试一次。", "Not saved. Please try again."),
    // 称呼
    nameRow: pick(locale, "称呼", "What to call you"),
    nameTitle: pick(locale, ["怎么称呼你？"], ["What should we call you?"]),
    nameLabel: pick(locale, "称呼", "Name"),
    namePlaceholder: pick(locale, "例如：陈先生", "For example: Mr Tan"),
    nameEmpty: pick(locale, "先写上称呼。", "Write a name first."),
    nameTooLong: pick(locale, "太长了，40 个字以内。", "Too long: 40 characters at most."),
    // 语言
    langRow: pick(locale, "语言", "Language"),
    langTitle: pick(locale, ["用哪种语言？"], ["Which language?"]),
    langLede: pick(locale, "屏上的字和提醒都用这种语言。医生和药品标签的原话不翻译。", "The screens and your reminders use it. Your doctor's words and the label stay as they are."),
    langName: (l: CLocale) => (l === "zh-Hans" ? "华语" : "English"),
    langNow: pick(locale, "现在用的", "In use now"),
    // 早饭时间和提醒
    timesRow: pick(locale, "早饭时间和提醒", "Breakfast time and reminders"),
    timesStatus: (breakfast: string | null, morning: string) =>
      breakfast ? pick(locale, `早饭 ${breakfast} · 早间药物 ${morning} 提醒`, `Breakfast ${breakfast} · morning medicine at ${morning}`) : pick(locale, `早饭还没写 · 早间药物 ${morning} 提醒`, `Breakfast not set · morning medicine at ${morning}`),
    timesTitle: pick(locale, ["早饭时间和提醒"], ["Breakfast time", "and reminders"]),
    timesLede: pick(locale, "服药提醒按这些时间响起。未回应时，30 分钟后再提醒一次。", "Your medicine reminders come at these times. With no answer, Ripple asks once more 30 minutes later."),
    breakfast: pick(locale, "早饭", "Breakfast"),
    remindAt: pick(locale, "几点提醒", "When you are reminded"),
    sourceOwn: pick(locale, "你定的时间", "The time you set"),
    sourceRoutine: (slot: string) =>
      slot === "morning" ? pick(locale, "跟着早饭，晚 15 分钟", "15 minutes after breakfast") : slot === "night" ? pick(locale, "跟着你的作息，睡前半小时", "From your routine: half an hour before bed") : pick(locale, "跟着你的作息，饭后 15 分钟", "From your routine: 15 minutes after the meal"),
    sourceApp: pick(locale, "你还没定，Ripple 先用这个时间", "Not set by you yet: Ripple uses this time for now"),
    phoneRow: pick(locale, "这台手机收不收得到提醒", "Whether this phone gets the reminders"),
    phoneValue: pick(locale, "提醒和通知", "Reminders and notifications"),
    slotTitle: (slotMed: string) => pick(locale, [`${slotMed}，`, "几点提醒你？"], [`${slotMed}:`, "when should Ripple remind you?"]),
    slotAgain: (second: string) => pick(locale, `未回应时，${second} 再提醒一次。`, `With no answer, Ripple asks once more at ${second}.`),
    slotRange: (from: string, to: string) => pick(locale, `这一格的提醒时间要在 ${from} 到 ${to} 之间。`, `This reminder has to be between ${from} and ${to}.`),
    slotClear: (slot: string) => (slot === "morning" ? pick(locale, "跟着早饭的时间", "Follow breakfast again") : pick(locale, "用原来的时间", "Use the earlier time")),
    // 退出登录
    logoutStatus: pick(locale, "这台手机退出，记录都还在", "Signs this phone out; your records stay"),
  };
}

/** A path on this site to go back to (one leading slash, no scheme, no protocol-relative //), else Today. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/p/today";
  return next;
}

/** The 「中/EN」 link of his screens: switch to the other language and come back to `path`. */
export function langHref(locale: CLocale, path: string): string {
  const to = locale === "en" ? "zh-Hans" : "en";
  return `/api/profile/lang?to=${to}&next=${encodeURIComponent(safeNext(path))}`;
}
