/**
 * The words of binding by account (line bind; lib/care/bind.ts): her form on /f, his field on 「邀请家人」, his card on
 * Today and on her page under 「家人」, and the sentence that stands in the place of her recorder. Client-safe.
 *
 * The 华语 sentences are the owner's wording (D:/ripple-c2/frontend/line-prompts/bind.txt); the English stands beside
 * them in the same plain register. Where a sentence of the brief is drawn as two parts (the card's body: who and when on
 * the entry, what she sees in the box), it is split at a full stop and not a word is changed.
 *
 * The owner's decision of 2026-10-14 (each of the six switches shows its kind in full while it is on): the two sentences
 * that list what a bound family member sees at once (herBody, boundSees) named counts, 「这周吃药的天数、量了几次血压、
 * 有几个问题要问医生」. They now name the kinds, in the words of the consent text of that day (lib/care/consent.ts
 * 2026-10-14); his card, which he reads after someone has already bound his account, says the first kind out in full.
 * The same day's other decision (professional words, not spoken ones) reached her sentence first and then his: 每日服药情况,
 * 未服药, 待问医生, 两次提醒均未回应, 就诊, where they said 每天吃药, 没吃, 要问医生, 提醒两次没回, 看诊.
 */
import type { Locale } from "@/lib/i18n";
import { fillHer } from "./copy";

const zh = {
  // ---- her form: /f while she follows nobody
  herTitle: "填长辈的账号",
  herBody: "填他注册 Ripple 用的账号。绑定后你能看到他的服药、血压和要问医生的问题；两次提醒都没回应时会通知你。他随时可以解除。",
  herField: "长辈的账号",
  herPlaceholder: "例如 chen.tan",
  herCalls: "你怎么称呼他",
  callsDad: "爸爸",
  callsMum: "妈妈",
  callsName: "用他的名字",
  bind: "绑定",
  herNoAccount: "他还没有账号？先在他的手机上帮他注册，再回来填。",
  herEmpty: "先填上长辈的账号。",
  herSelf: "这是你自己的账号。这里填长辈的账号。",
  // ---- what the binding is refused with, in words (both sides)
  notFound: "没有找到这个账号。看看有没有打错。",
  bothFamily: "这个账号也是子女的账号，绑定不了。",
  bothElder: "这个账号也是长辈的账号，绑定不了。",
  tooMany: "试的次数太多了，请在 {time} 以后再试。",
  tooManySoon: "试的次数太多了，请过一会儿再试。",
  failed: "没绑成，再试一次。",
  // he removed her before: her own binding is refused (round two; the integrator's wording)
  herRemoved: "{He}已经解除了和你的绑定。想再绑定，请{him}在自己的手机上填你的账号。",
  // ---- the place of her recorder while he has not answered
  locked: "等{he}在自己的手机上点了「知道了」，你就可以给{him}录提醒。",
  // the same, where she adds a line to his details (her screen says it under the form when the server refuses)
  lockedFact: "等{he}在自己的手机上点了「知道了」，你就可以给{him}补充资料。",
  // ---- his side: 「邀请家人」, the direct way first
  hisTitle: "填家人的账号",
  hisBody: "填她注册 Ripple 时用的账号。填好就绑定，她马上能看到下面四项；就诊录音和你的笔记要你自己打开。",
  hisField: "家人的账号",
  hisEmpty: "先填上家人的账号。",
  hisSelf: "这是你自己的账号。这里填家人的账号。",
  hisInvite: "她还没有账号？发一个邀请链接给她。",
  // ---- his card: a family member bound his account and he has not answered
  boundTitle: "{name} 绑定了你的账号",
  boundSomeone: "有人",
  boundWho: "账号 {login}，{when}。",
  boundWhoEmail: "用邮箱注册的账号，{when}。",
  boundSees: "她现在能看到：每日服药情况（药物名称、服药时间、未服药的原因）、血压读数、待问医生的问题；两次提醒均未回应时会通知她。",
  boundNot: "就诊录音和你的笔记她看不到。",
  boundOk: "知道了",
  boundRemove: "不认识这个人，解除",
  // how such a link is said on its row and under the title of her page, in the place of 「已确认」
  boundState: "绑定了你的账号，等你看一下",
  // the first version of a directly bound link's switches (his list of changes)
  historyBound: "第 1 版：填账号绑定时，开着这几项",
  // ---- round two (the integrator's wording)
  // her way back to the form: the quiet button on her ended screens, the row under 「我的」 (also the form's quiet line
  // when she opens it from there), and the form's way back
  bindAnother: "绑定另一位长辈",
  bindMore: "再绑定一位长辈",
  bindBack: "返回",
  // his page of a person who bound his account herself and whom he removed without ever answering
  strangerRemoved: "这个人自己绑定了你的账号，你已经解除。",
};

export type BindKey = keyof typeof zh;

const en: Record<BindKey, string> = {
  herTitle: "Enter your elder's account",
  herBody: "Type the account he signed up with. You will see his medicines, readings and questions, and be told when two reminders go unanswered. He can remove you any time.",
  herField: "Your elder's account",
  herPlaceholder: "e.g. chen.tan",
  herCalls: "What you call him",
  callsDad: "Dad",
  callsMum: "Mum",
  callsName: "Use his name",
  bind: "Link",
  herNoAccount: "He has no account yet? Help him sign up on his phone first, then come back and type it here.",
  herEmpty: "Type your elder's account first.",
  herSelf: "That is your own account. Type your elder's account here.",
  notFound: "No such account was found. Check the spelling.",
  bothFamily: "That account is a family member's account too. It cannot be linked.",
  bothElder: "That account is an elder's account too. It cannot be linked.",
  tooMany: "Too many tries. Please try again after {time}.",
  tooManySoon: "Too many tries. Please try again in a while.",
  failed: "That did not link. Try again.",
  herRemoved: "{He} has removed the link with you. To link again, ask {him} to enter your account on {his} own phone.",
  locked: "Once {he} taps “Got it” on {his} own phone, you can record a reminder for {him}.",
  lockedFact: "Once {he} taps “Got it” on {his} own phone, you can add to {his} details.",
  hisTitle: "Enter a family member's account",
  hisBody: "Type the account she signed up to Ripple with. Once you link, she can see the four items below at once; your visit recordings and your notes stay off until you turn them on yourself.",
  hisField: "Family member's account",
  hisEmpty: "Type the family member's account first.",
  hisSelf: "That is your own account. Type the family member's account here.",
  hisInvite: "She has no account yet? Send her an invitation link.",
  boundTitle: "{name} linked to your account",
  boundSomeone: "Someone",
  boundWho: "Account {login}, {when}.",
  boundWhoEmail: "An e-mail account, {when}.",
  boundSees: "She can now see: your medicine each day (which medicine, when, and the reason when you did not take it), your blood pressure readings, and the questions you want to ask your doctor; and she is told when two reminders get no reply.",
  boundNot: "She cannot see your visit recordings or your notes.",
  boundOk: "Got it",
  boundRemove: "I do not know this person. Remove",
  boundState: "Linked to your account; waiting for you to look",
  historyBound: "Version 1: when the account was linked, these were on",
  bindAnother: "Link another elder",
  bindMore: "Link one more elder",
  bindBack: "Back",
  strangerRemoved: "This person linked to your account by themselves. You have removed them.",
};

const messages: Record<Locale, Record<BindKey, string>> = { "zh-Hans": zh, en };

/**
 * One sentence, its names filled in. Her sentences about him that she reads once a link is there (locked, lockedFact,
 * herRemoved) say him by `vars.dad`, her word for him (lib/care/copy.ts fillHer; without it 他 / he). Her form's own
 * sentences, written before she has said how she calls him (herBody, herCalls, callsName, herNoAccount), say 他.
 */
export function bc(locale: Locale, key: BindKey, vars: Record<string, string | number> = {}): string {
  return fillHer(messages[locale]?.[key] ?? zh[key], locale, vars);
}

/**
 * What POST /api/family/bind refused with, in words for the side that asked. `time`: when a limit opens again (「10:35」).
 * `dad`: on her side, the word her form sends for him (爸爸 / 妈妈, Dad / Mum), so that 「他已经解除了…」 says her word's
 * 他 / 她.
 */
export function bindRefusal(locale: Locale, side: "family" | "patient", error: string | undefined, time?: string, dad?: string | null): string {
  switch (error) {
    case "account_not_found":
      return bc(locale, "notFound");
    case "bind_self":
      return bc(locale, side === "family" ? "herSelf" : "hisSelf");
    case "bind_wrong_kind":
      return bc(locale, side === "family" ? "bothFamily" : "bothElder");
    case "too_many":
      return time ? bc(locale, "tooMany", { time }) : bc(locale, "tooManySoon");
    case "bind_removed":
      // only her side is ever refused with it; his own binding is his own act
      return side === "family" ? bc(locale, "herRemoved", dad ? { dad } : {}) : bc(locale, "failed");
    default:
      return bc(locale, "failed");
  }
}
