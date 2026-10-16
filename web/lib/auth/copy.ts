/**
 * The words of the account screens (track A): sign-up, log-in, recovery, his devices, a new password, a new recovery
 * code. Fixed copy only, Chinese first; never anything clinical. The consent texts themselves are in
 * lib/privacy/consent-texts.ts. Client-safe.
 */
import type { AuthRouteError } from "./api";

export type AccountLocale = "zh-Hans" | "en";

const zh = {
  appName: "Ripple",
  back: "返回",
  next: "下一步",
  stepOf: (n: number, total: number) => `第 ${n} 步，共 ${total} 步`,
  langOther: "English",
  haveAccount: "已经有账号？",
  logIn: "登录",
  noAccount: "还没有账号？",
  signUp: "注册",
  forgot: "忘记密码？用恢复码",
  showPassword: "显示密码",
  hidePassword: "隐藏密码",
  // sign-up
  langTitle: "用哪种语言？",
  langLede: "以后在「我」里也能换。",
  nameTitle: "怎么称呼你？",
  nameLabel: "称呼",
  namePlaceholder: "例如：陈先生",
  nameMissing: "写一个称呼，例如「陈先生」。",
  accountTitle: "给自己设一个账号",
  accountLede: "手机号、名字拼音或者邮箱都可以。登录时用它，不用有邮箱。",
  accountLabel: "账号",
  accountPlaceholder: "例如：chen.tan",
  passwordTitle: "设一个密码",
  passwordLede: "至少 8 个字。不用大写字母，也不用符号。",
  passwordLabel: "密码",
  helperTitle: "现在是谁在点？",
  helperSelf: "我自己",
  helperFamily: "家人帮我操作",
  helperFamilyNote: (name: string) => `接下来两页的「同意」，请${name}本人点。`,
  helperMissing: "选一个。",
  termsAgree: "同意，继续",
  termsFull: "完整的隐私说明",
  assistedNote: (name: string) => `请${name}本人看完，自己点「同意」。`,
  aiAgree: "同意",
  aiDecline: "不同意，也继续用",
  spaceTitle: "从哪里开始？",
  spaceBlank: "从空白开始",
  spaceBlankSub: "我自己用。先填一点资料，再拍药袋、记录就诊。",
  spaceExample: "用陈先生的示例资料",
  spaceExampleSub: "看看怎么用。",
  // real-app 3.11 (line 809): the example account's time zone is fixed; the sign-up says so under that choice
  spaceExampleClock: "示例账号按新加坡时间走，提醒也按新加坡时间发；人在别处也一样。",
  spaceMissing: "选一个。",
  finish: "完成注册",
  signupTooMany: (time: string) => `这台设备今天注册太多次了，${time} 以后再试。`,
  codeTitle: "这是你的恢复码",
  codeLede: "写在纸上，或者拍照交给家人保管。",
  codeWarning: "换了新手机又忘了密码，只能靠这个码。",
  codeOnce: "这个码只显示这一次。",
  codeKept: "我记下了",
  printCard: "打印这张卡",
  print: "打印",
  cardTitle: "Ripple 恢复码",
  cardAccount: "账号",
  cardCode: "恢复码",
  cardUse: "忘了密码时：打开 Ripple，点「忘记密码？用恢复码」，输入账号和这个码。用过以后会换一个新的。",
  // log in
  loginTitle: "登录",
  loginLede: "注册时设的账号：手机号、名字拼音或者邮箱。",
  loginPasswordTitle: "输入密码",
  loginAs: (login: string) => `账号：${login}`,
  otherAccount: "换一个账号",
  notMyPhone: "这不是我的手机",
  notMyPhoneDesc: "关掉浏览器就退出，最长 12 小时。",
  loginButton: "登录",
  lockedTitle: "试错太多次",
  lockedBody: (time: string) => `这台手机 ${time} 以后再试；也可以用恢复码重设密码。`,
  lockedRecover: "用恢复码重设密码",
  lockedOk: "知道了",
  // recovery
  recoverTitle: "重设密码",
  recoverLede: "输入你的账号。有恢复码就用恢复码；事先在「我」里打开过的，也可以请家人帮忙。",
  useRecoveryCode: "用恢复码",
  codeEntryTitle: "输入恢复码",
  codeEntryLede: "注册时那张卡上的 12 个字母和数字，空格和短横可以不写。",
  codeEntryLabel: "恢复码",
  codeNotACode: "恢复码是 12 个字母和数字，再看一下卡上写的。",
  newPasswordTitle: "设一个新密码",
  resetButton: "重设密码",
  resetDoneTitle: "密码重设好了",
  resetDoneLede: "其他手机上的登录都已经退出。刚才那个恢复码不能再用了，这是新的：",
  noRecoveryTail: "两样都找不到，只能注册一个新账号。",
  // his devices, password, code
  devicesTitle: "登录和设备",
  devicesLabel: "登录过的设备",
  deviceUnknown: "一台设备",
  deviceThis: "这台设备 · 正在用",
  deviceSignedIn: (when: string) => `已登录 · 最近用过 ${when}`,
  deviceSignedOut: (when: string) => `已退出 · 最近用过 ${when}`,
  deviceEphemeral: "这不是我的手机",
  deviceSignOut: "退出这台",
  devicesNone: "还没有记下的设备。",
  changePassword: "改密码",
  recoveryCode: "换一个恢复码",
  logout: "退出登录",
  logoutAll: "退出所有设备",
  logoutAllNote: "所有手机和电脑上的登录都会退出，包括这台。",
  passwordPageTitle: "改密码",
  currentPassword: "现在的密码",
  newPassword: "新密码",
  savePassword: "保存新密码",
  passwordDoneTitle: "密码改好了",
  passwordDoneLede: "其他设备上的登录都已经退出，要用新密码再登录。这台手机不用。",
  done: "好",
  codePageTitle: "换一个恢复码",
  codePageLede: "旧的恢复码会作废。先输入你的密码。",
  codePageButton: "生成新的恢复码",
  yourPassword: "你的密码",
  // what the design asks every sign-up and recovery-code screen to say (real-app 2.4)
  passwordForgot: "忘了密码时，用注册最后一步给你的恢复码重设。换了新手机又忘了密码，只能用恢复码。恢复码也找不到，就只能注册一个新账号。",
  codeNoOther: "密码和恢复码都找不到时，只能注册一个新账号。Ripple 不提供邮件、短信或人工重设。",
  recoverNewPhone: "换了新手机又忘了密码，只能用恢复码。",
  // family-assisted reset (real-app 2.4, 3.6)
  askFamily: "请家人帮忙",
  familyHelpTitle: (names: string) => (names ? `请 ${names} 帮忙` : "请家人帮忙"),
  familyHelpLede: (names: string) => `请${names ? ` ${names} ` : "家人"}打开 Ripple，点「帮」。对方的手机上会出现一个 6 位数，请对方念给你听。`,
  familyHelpLimit: "这个数 10 分钟内有效，只能在这台手机上输入。",
  familyCodeLabel: "家人念给你的 6 位数",
  familyCodeBad: "是 6 个数字，请对方再念一遍。",
  familyDoneTitle: "密码重设好了",
  familyDoneLede: (name: string) => `是${name ? ` ${name} ` : "家人"}帮你重设的。其他手机上的登录都已经退出。`,
  goOn: "继续",
  helpPageTitle: "忘记密码时，让家人帮我",
  helpSwitch: (name: string) => `忘记密码时，让 ${name} 帮我`,
  helpSwitchDesc: "打开以后，你忘了密码，可以请对方帮你重设。",
  helpFamilyFallback: "这位家人",
  helpNone: "现在没有已经生效的家人。先邀请家人；对方接受、你确认以后，才能在这里打开。",
  helpToFamily: "去「家人」",
  helpFailed: "没改成，再试一次。",
  helpEntryTitle: "忘记密码时请家人帮忙",
  helpEntryStatus: "一开始是关着的；打开以后，家人能帮你重设密码",
  // 「读给我听」 (only with a real voice)
  readAloud: "读给我听",
  readAloudStop: "停下",
  readAloudFailed: "现在读不出来，过一会儿再试。",
};

export type AccountCopy = typeof zh;

const en: AccountCopy = {
  appName: "Ripple",
  back: "Back",
  next: "Next",
  stepOf: (n, total) => `Step ${n} of ${total}`,
  langOther: "华语",
  haveAccount: "Already have an account?",
  logIn: "Log in",
  noAccount: "No account yet?",
  signUp: "Sign up",
  forgot: "Forgot your password? Use your recovery code",
  showPassword: "Show password",
  hidePassword: "Hide password",
  langTitle: "Which language?",
  langLede: "You can change it later under Me.",
  nameTitle: "What should we call you?",
  nameLabel: "Your name",
  namePlaceholder: "e.g. Mr Tan",
  nameMissing: "Write a name, e.g. Mr Tan.",
  accountTitle: "Choose an account name",
  accountLede: "A phone number, your name in letters, or an e-mail address. You log in with it; no e-mail needed.",
  accountLabel: "Account",
  accountPlaceholder: "e.g. chen.tan",
  passwordTitle: "Choose a password",
  passwordLede: "At least 8 characters. No capital letters or symbols needed.",
  passwordLabel: "Password",
  helperTitle: "Who is tapping now?",
  helperSelf: "Myself",
  helperFamily: "A family member is helping me",
  helperFamilyNote: (name) => `On the next two pages, ${name} should tap to agree.`,
  helperMissing: "Choose one.",
  termsAgree: "Agree and continue",
  termsFull: "The full privacy notice",
  assistedNote: (name) => `${name} should read this and tap Agree.`,
  aiAgree: "I agree",
  aiDecline: "No, continue without",
  spaceTitle: "Where to start?",
  spaceBlank: "Start blank",
  spaceBlankSub: "For my own use. A few details first, then labels and visits.",
  spaceExample: "Use Mr Tan's example data",
  spaceExampleSub: "See how it works.",
  spaceExampleClock: "An example account runs on Singapore time, and its reminders come at Singapore time, wherever you are.",
  spaceMissing: "Choose one.",
  finish: "Finish",
  signupTooMany: (time) => `Too many sign-ups from this device today. Try again after ${time}.`,
  codeTitle: "Your recovery code",
  codeLede: "Write it on paper, or take a photo and give it to family to keep.",
  codeWarning: "If you change phones and forget your password, only this code gets you back in.",
  codeOnce: "This code is shown only now.",
  codeKept: "I have kept it",
  printCard: "Print this card",
  print: "Print",
  cardTitle: "Ripple recovery code",
  cardAccount: "Account",
  cardCode: "Recovery code",
  cardUse: "Forgot your password? Open Ripple, tap “Forgot your password? Use your recovery code”, and enter your account and this code. You get a new one after.",
  loginTitle: "Log in",
  loginLede: "The account you chose: a phone number, your name in letters, or an e-mail address.",
  loginPasswordTitle: "Enter your password",
  loginAs: (login) => `Account: ${login}`,
  otherAccount: "Another account",
  notMyPhone: "This is not my phone",
  notMyPhoneDesc: "Signed out when the browser closes, after 12 hours at most.",
  loginButton: "Log in",
  lockedTitle: "Too many wrong tries",
  lockedBody: (time) => `Try again on this phone after ${time}, or reset your password with your recovery code.`,
  lockedRecover: "Reset with my recovery code",
  lockedOk: "OK",
  recoverTitle: "Reset your password",
  recoverLede: "Enter your account. Use your recovery code, or ask family to help if you turned that on under Me beforehand.",
  useRecoveryCode: "Use my recovery code",
  codeEntryTitle: "Enter your recovery code",
  codeEntryLede: "The 12 letters and digits on your card; spaces and dashes can be left out.",
  codeEntryLabel: "Recovery code",
  codeNotACode: "A recovery code is 12 letters and digits. Look at the card again.",
  newPasswordTitle: "Choose a new password",
  resetButton: "Reset password",
  resetDoneTitle: "Your password is reset",
  resetDoneLede: "Every other sign-in has ended. The code you used no longer works; here is the new one:",
  noRecoveryTail: "Without the password and the code, the only way is a new account.",
  devicesTitle: "Sign-in and devices",
  devicesLabel: "Devices you signed in on",
  deviceUnknown: "A device",
  deviceThis: "This device · in use",
  deviceSignedIn: (when) => `Signed in · last used ${when}`,
  deviceSignedOut: (when) => `Signed out · last used ${when}`,
  deviceEphemeral: "Not my phone",
  deviceSignOut: "Sign out",
  devicesNone: "No device recorded yet.",
  changePassword: "Change password",
  recoveryCode: "Make a new recovery code",
  logout: "Log out",
  logoutAll: "Log out of every device",
  logoutAllNote: "Every phone and computer is signed out, this one too.",
  passwordPageTitle: "Change password",
  currentPassword: "Current password",
  newPassword: "New password",
  savePassword: "Save the new password",
  passwordDoneTitle: "Password changed",
  passwordDoneLede: "Every other device is signed out and needs the new password. This phone stays signed in.",
  done: "OK",
  codePageTitle: "Make a new recovery code",
  codePageLede: "The old code stops working. Enter your password first.",
  codePageButton: "Make a new code",
  yourPassword: "Your password",
  passwordForgot: "If you forget your password, reset it with the recovery code you get at the last step. On a new phone with a forgotten password, only the recovery code works. Without the code too, the only way is a new account.",
  codeNoOther: "Without the password and the code, the only way is a new account. Ripple does not reset passwords by e-mail, text message or by hand.",
  recoverNewPhone: "On a new phone with a forgotten password, only the recovery code works.",
  askFamily: "Ask family to help",
  familyHelpTitle: (names) => (names ? `Ask ${names} to help` : "Ask family to help"),
  familyHelpLede: (names) => `Ask ${names || "your family member"} to open Ripple and tap Help. A 6-digit number appears on their phone; have them read it to you.`,
  familyHelpLimit: "The number works for 10 minutes, and only typed on this phone.",
  familyCodeLabel: "The 6 digits read to you",
  familyCodeBad: "It is 6 digits. Ask them to read it again.",
  familyDoneTitle: "Your password is reset",
  familyDoneLede: (name) => `${name || "Your family member"} helped you reset it. Every other sign-in has ended.`,
  goOn: "Continue",
  helpPageTitle: "Family help with a forgotten password",
  helpSwitch: (name) => `Let ${name} help me if I forget my password`,
  helpSwitchDesc: "With this on, they can help you reset a forgotten password.",
  helpFamilyFallback: "this family member",
  helpNone: "No family member is confirmed yet. Invite one first; after they accept and you confirm, you can switch this on here.",
  helpToFamily: "Go to Family",
  helpFailed: "That did not change. Try again.",
  helpEntryTitle: "Family help with a forgotten password",
  helpEntryStatus: "Off to start with; switched on, family can help you reset your password",
  readAloud: "Read it to me",
  readAloudStop: "Stop",
  readAloudFailed: "It cannot be read right now. Try again in a while.",
};

export function accountCopy(locale: AccountLocale): AccountCopy {
  return locale === "en" ? en : zh;
}

/** A refusal from the account routes, in his words. `time` is when a lock or a limit ends ("10:35"). */
export function errorWords(error: AuthRouteError | string, locale: AccountLocale, time?: string): string {
  const z = locale !== "en";
  const t = time ?? (z ? "过一会儿" : "a while");
  switch (error) {
    case "login_empty":
      return z ? "写一个账号。" : "Write an account name.";
    case "username_invalid":
      return z ? "账号用字母、数字和 . _ -，3 到 32 个，开头是字母或数字。" : "Use letters, digits and . _ - (3 to 32), starting with a letter or digit.";
    case "username_reserved":
      return z ? "这个名字留给系统用了，换一个。" : "That name is reserved. Choose another.";
    case "email_invalid":
      return z ? "这个邮箱好像写错了。" : "That e-mail address looks wrong.";
    case "email_reserved_domain":
      return z ? "这个邮箱不能用，换一个。" : "That address cannot be used. Choose another.";
    case "login_taken":
      return z ? "这个账号已经有人用了，换一个。" : "Someone already uses that name. Choose another.";
    case "password_short":
      return z ? "至少要 8 个字。" : "At least 8 characters.";
    case "password_long":
      return z ? "太长了：字母最多 72 个，中文最多 24 个字。" : "Too long: 72 letters at most (24 Chinese characters).";
    case "password_common":
      return z ? "这个密码太常见，容易被猜到，换一个。" : "That password is too common and easy to guess. Choose another.";
    case "password_like_login":
      return z ? "密码不能和账号一样。" : "The password cannot be the same as the account.";
    case "consent_version":
      return z ? "说明刚更新过，请再看一遍。" : "The text was just updated. Please read it again.";
    case "consent_required":
      return z ? "要先同意才能注册。" : "You need to agree first.";
    case "invalid_credentials":
      return z ? "账号或密码不对。" : "The account or password is not right.";
    case "invalid_recovery":
      return z ? "账号或恢复码不对。" : "The account or recovery code is not right.";
    case "wrong_password":
      return z ? "密码不对。" : "That password is not right.";
    case "locked":
      return z ? `试错太多次，${t} 以后再试。` : `Too many wrong tries. Try again after ${t}.`;
    case "too_many":
      return z ? `试得太多了，${t} 以后再试。` : `Too many tries. Try again after ${t}.`;
    case "not_signed_in":
      return z ? "登录已经过期，请再登录一次。" : "You have been signed out. Please log in again.";
    case "device_not_found":
      return z ? "找不到这台设备，刷新一下。" : "That device is not there any more. Refresh.";
    case "help_unavailable":
      return z
        ? "这台手机现在用不了家人帮忙：要在你登录过的手机上，而且事先在「我」里打开过。可以用恢复码。"
        : "Family help cannot be used on this phone now: it needs a phone you have signed in on, and the switch turned on under Me beforehand. You can use your recovery code.";
    case "invalid_family_code":
      return z ? "账号或这 6 位数不对，或者已经过了 10 分钟。可以再请家人帮一次。" : "The account or the 6 digits are not right, or the 10 minutes have passed. You can ask your family again.";
    case "link_not_found":
    case "link_not_active":
      return z ? "这位家人现在不在你的家人里了，刷新一下。" : "This family member is no longer linked. Refresh.";
    case "helper_off":
    case "no_request":
      return z ? "现在没有要帮的重设。" : "There is no reset to help with right now.";
    case "tts_unavailable":
      return z ? "现在读不出来，过一会儿再试。" : "It cannot be read right now. Try again in a while.";
    default:
      return z ? "没办成，再试一次。" : "That did not work. Try again.";
  }
}

/** "10:35" in Singapore time, for a lock's end. */
export function clockTime(iso: string | null | undefined, locale: AccountLocale): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return new Intl.DateTimeFormat(locale === "en" ? "en-SG" : "zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" }).format(d);
}

/** "10月10日 20:15" / "10 Oct 20:15" in Singapore time, for his devices page. */
export function dayAndTime(iso: string, locale: AccountLocale): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "zh-CN", {
    month: locale === "en" ? "short" : "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Singapore",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return locale === "en" ? `${get("day")} ${get("month")} ${get("hour")}:${get("minute")}` : `${get("month")}月${get("day")}日 ${get("hour")}:${get("minute")}`;
}
