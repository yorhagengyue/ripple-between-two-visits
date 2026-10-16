/**
 * The words of 「我 › 提醒和通知」 (/p/me/notifications; C2 track I; real-app 2.6, 2.23, brief 通用状态). Client-safe.
 * Plain statements, no judgement, no clinical words: what a reminder looks like, what to tap, what happened. The
 * button and its result share the name (「开提醒」 -> 「提醒已经开好了」, 「发一条试试」 -> 「发出去了」).
 */
export type PushPageLocale = "zh-Hans" | "en";

/**
 * C2 track F (only add): the notice 「就诊记录已生成」 (real-app 2.14, 2.24; 「看诊记录好了」 before 10-14), to him when a visit that waited for its
 * transcript has its record. Lock-screen words: that there is a record to look at, never a word of what was said, no
 * medicine, no number. The title is also the notice's name in 「最近的提醒」 below.
 */
export const VISIT_READY_WORDS: Record<PushPageLocale, { title: string; body: string }> = {
  "zh-Hans": { title: "就诊记录已生成", body: "请打开 Ripple 确认。" },
  en: { title: "Your visit record is ready", body: "Open Ripple to check it." },
};

const zh = {
  pageTitle: "提醒和通知",
  back: "我",
  checking: "正在看这台手机能不能收提醒",
  // states
  defaultTitle: ["提醒还没开。"],
  defaultLede: "打开以后，到了服药的时间，手机会响一下。锁屏上只写「早间药物 · 尚未记录」，不写药名。",
  turnOn: "开提醒",
  turningOn: "正在开…",
  askHint: "点了以后，手机会问要不要允许通知，点「允许」。",
  onTitle: ["提醒开着。"],
  onLede: "到了时间，这台手机会响一下。锁屏上不写药名。",
  offTitle: ["这台手机的提醒关着。"],
  offLede: "通知已经允许了。点「开提醒」，这台手机就会收到提醒。",
  deniedTitle: ["提醒没开：", "打开 app 时", "才看得到。"],
  deniedLede: "这台手机不让 Ripple 发通知。要收到提醒，在手机的设置里打开：",
  deniedAndroid: "安卓：点地址栏右边的 ⋮ → 设置 → 网站设置 → 通知，允许这个网站。",
  deniedIos: "iPhone：打开「设置」→「通知」→ Ripple，打开「允许通知」。",
  retry: "再试一次",
  retryStill: "还是没开。按上面的说明在设置里打开以后，再点「再试一次」。",
  iosTitle: ["iPhone 要先把", "Ripple 加到主屏幕，", "才收得到提醒。"],
  iosLede: "苹果手机只给放在主屏幕上的网页 app 发通知。三步：",
  iosStep1: "点屏幕下方的分享按钮（方框加向上的箭头）。",
  iosStep2: "往下找，点「添加到主屏幕」，再点「添加」。",
  iosStep3: "回到主屏幕，点 Ripple 的图标打开，再进这一页点「开提醒」。",
  unsupportedTitle: ["这个浏览器收不到提醒。"],
  unsupportedLede: "打开 app 时，提醒照样出现在「今天」页上。想在锁屏上收到，换用手机自带的浏览器：安卓用 Chrome，iPhone 用 Safari。",
  // what comes
  whatLabel: "会收到的提醒",
  slotLine: (first: string, second: string) => `${first}，未回应时 ${second} 再次提醒`,
  noMeds: "暂无需要服用的药物。添加药物以后，到时间会提醒你。",
  lockLabel: "锁屏上写",
  lockValue: "「早间药物 · 尚未记录」",
  recentLabel: "最近的提醒",
  recentOpened: (t: string) => `${t} 点开了`,
  recentNotOpened: "没点开",
  first: "第一次",
  second: "第二次",
  bp: "该测量血压了",
  // C2 track I (own line): the row of 「Wei Ling 已经接受」 in 最近的提醒
  accepted: "家人接受了邀请",
  today: "今天",
  yesterday: "昨天",
  // actions and what they did
  test: "发一条试试",
  testing: "正在发…",
  testSent: "发出去了，看一下手机顶上。",
  testNone: "没发出去：这台手机的订阅可能过期了。点「关掉这台手机的提醒」，再点「开提醒」。",
  turnOff: "关掉这台手机的提醒",
  turningOff: "正在关…",
  turnedOff: "这台手机的提醒关掉了。",
  turnedOn: "提醒已经开好了。",
  turnedOnSent: "提醒已经开好了。刚才发了一条试试，手机顶上应该出现了。",
  failed: "没开成：试发的那一条提醒没有到这台手机。再点一次「开提醒」。",
  install: "装到主屏",
  installHint: "装到主屏以后，Ripple 像别的 app 一样从主屏幕打开。",
  // C2 track I, follow-up (real-app 2.6): 「我」 says where this phone's reminders stand, in one line
  meTitle: "提醒和通知",
  meWaiting: "服药的时间到了，手机怎么响",
  meOn: "提醒开着",
  meOff: "提醒还没开",
  meDenied: "提醒没开：打开 app 时才看得到",
  meIos: "iPhone 要先把 Ripple 加到主屏幕",
  meUnsupported: "这个浏览器收不到提醒",
  meRetryStill: "还是没开。在手机的设置里允许通知以后，再点「再试一次」。怎么设，点上面那一行。",
  installing: "正在装…",
  installed: "装好了。以后从主屏幕上的 Ripple 图标打开。",
  iosShort: "iPhone 要先把 Ripple 加到主屏幕，才收得到提醒。三步：",
};

export type PushPageCopy = typeof zh;

const en: PushPageCopy = {
  pageTitle: "Reminders and notifications",
  back: "Me",
  checking: "Checking whether this phone can get reminders",
  defaultTitle: ["Reminders are off."],
  defaultLede: "Turn them on and your phone will sound when it is time for your medicine. The lock screen only says “Morning medicine · Not logged yet”, never the medicine's name.",
  turnOn: "Turn on reminders",
  turningOn: "Turning on…",
  askHint: "Your phone will ask whether to allow notifications: tap “Allow”.",
  onTitle: ["Reminders are on."],
  onLede: "When it is time, this phone will sound. The lock screen never shows the medicine's name.",
  offTitle: ["Reminders are off on this phone."],
  offLede: "Notifications are allowed. Tap “Turn on reminders” and this phone will get them.",
  deniedTitle: ["Reminders are off:", "you see them only with the app open."],
  deniedLede: "This phone does not let Ripple send notifications. To get reminders, turn them on in the phone's settings:",
  deniedAndroid: "Android: tap ⋮ next to the address bar → Settings → Site settings → Notifications, and allow this site.",
  deniedIos: "iPhone: open Settings → Notifications → Ripple, and turn on Allow Notifications.",
  retry: "Try again",
  retryStill: "Still off. Turn them on in the settings as above, then tap “Try again”.",
  iosTitle: ["On an iPhone, add Ripple to", "the Home Screen to get reminders."],
  iosLede: "iPhones only send notifications to web apps on the Home Screen. Three steps:",
  iosStep1: "Tap the Share button at the bottom of the screen (a square with an arrow).",
  iosStep2: "Scroll down, tap “Add to Home Screen”, then “Add”.",
  iosStep3: "Go to the Home Screen, open Ripple from its icon, come back here and tap “Turn on reminders”.",
  unsupportedTitle: ["This browser cannot get reminders."],
  unsupportedLede: "With the app open, reminders still show on Today. To get them on the lock screen, use the phone's own browser: Chrome on Android, Safari on an iPhone.",
  whatLabel: "Reminders you will get",
  slotLine: (first: string, second: string) => `${first}, and ${second} if there is no answer`,
  noMeds: "No medicines to take yet. Once there are, the reminders come on time.",
  lockLabel: "The lock screen says",
  lockValue: "“Morning medicine · Not logged yet”",
  recentLabel: "Recent reminders",
  recentOpened: (t: string) => `opened ${t}`,
  recentNotOpened: "not opened",
  first: "first",
  second: "second",
  bp: "Time to measure your blood pressure",
  // C2 track I (own line)
  accepted: "A family member accepted your invitation",
  today: "Today",
  yesterday: "Yesterday",
  test: "Send a test",
  testing: "Sending…",
  testSent: "Sent. Look at the top of your phone.",
  testNone: "Not sent: this phone's subscription may have expired. Tap “Turn off on this phone”, then “Turn on reminders”.",
  turnOff: "Turn off on this phone",
  turningOff: "Turning off…",
  turnedOff: "Reminders are off on this phone.",
  turnedOn: "Reminders are on.",
  turnedOnSent: "Reminders are on. A test was just sent: it should be at the top of your phone.",
  failed: "Not turned on: the test reminder did not reach this phone. Tap “Turn on reminders” again.",
  install: "Add to Home Screen",
  installHint: "Once added, Ripple opens from the Home Screen like any other app.",
  // C2 track I, follow-up
  meTitle: "Reminders and notifications",
  meWaiting: "How your phone tells you it is time for your medicine",
  meOn: "Reminders are on",
  meOff: "Reminders are off",
  meDenied: "Reminders are off: you see them only with the app open",
  meIos: "On an iPhone, add Ripple to the Home Screen first",
  meUnsupported: "This browser cannot get reminders",
  meRetryStill: "Still off. Allow notifications in the phone's settings, then tap “Try again”. The row above shows how.",
  installing: "Adding…",
  installed: "Added. From now on, open Ripple from its icon on the Home Screen.",
  iosShort: "On an iPhone, add Ripple to the Home Screen to get reminders. Three steps:",
};

export function pushPageCopy(locale: PushPageLocale): PushPageCopy {
  return locale === "en" ? en : zh;
}

/**
 * The same instructions as the manual has them (/how; real-app 2.6: 「iOS 只给加到主屏的网页 app 推送，这一条也写进使用
 * 说明」): why the Home Screen, Android's one tap, the iPhone's three steps (the very sentences the phone shows), and
 * what counts as reminders being on.
 */
export interface InstallManual {
  title: string;
  why: string;
  android: string;
  iphoneLead: string;
  iphoneSteps: [string, string, string];
  then: string;
}

export function installManual(locale: PushPageLocale): InstallManual {
  const c = pushPageCopy(locale);
  const steps: [string, string, string] = [c.iosStep1, c.iosStep2, c.iosStep3];
  if (locale === "en") {
    return {
      title: "Reminders on the phone: add Ripple to the Home Screen",
      why: "A reminder is a notification from the phone. iPhones only deliver notifications to a web app that was added to the Home Screen, so on an iPhone Ripple has to be added there first.",
      android: "Android: when the browser offers to install Ripple, an “Add to Home Screen” button appears on Me and on Reminders and notifications. One tap adds it. Reminders also arrive without it.",
      iphoneLead: "iPhone, three steps:",
      iphoneSteps: steps,
      then: "Then tap “Turn on reminders” and allow notifications when the phone asks. Ripple sends “Reminders are on” at once; reminders count as on only when that notice went out to the phone.",
    };
  }
  return {
    title: "手机上的提醒：把 Ripple 装到主屏",
    why: "提醒是手机的通知。苹果手机只给放在主屏幕上的网页 app 发通知，所以 iPhone 要先把 Ripple 加到主屏幕。",
    android: "安卓：浏览器提示可以安装时，「我」和「提醒和通知」里会出现「装到主屏」，点一下就装好。不装也收得到提醒。",
    iphoneLead: "iPhone，三步：",
    iphoneSteps: steps,
    then: "然后点「开提醒」，手机问要不要允许通知，点「允许」。Ripple 马上发一条「提醒已经开好了」，这一条发到了手机，提醒才算开好。",
  };
}
