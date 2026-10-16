/**
 * The two consent texts of the family links (C2 track D; real-app 3.11): family_accept (hers, when she accepts an
 * invitation) and family_share (his, when he confirms her and each time he changes what she sees). Server-only (the
 * hash is computed here); the pages show `title` and `paragraphs`. The records of a link made by entering an account
 * (line bind, lib/care/bind.ts) point at the same two texts: hers when she enters his account, his when he enters hers
 * or answers 「知道了」.
 *
 * Same shape and canonical form as track A's sign-up texts (lib/privacy/consent-texts.ts consentBody): the record
 * carries `version` and the sha256 of exactly the words shown. Track H's registry (lib/privacy/consents.ts) gathers
 * these with every other kind, publishes them into consent_text and stamps the records; the links write their records
 * through it (lib/care/links.ts -> recordConsent).
 *
 * Changing a text means a NEW version: append the new entries after the old ones and keep the old ones, so a record
 * made under an older version still finds its words (the registry's current version of a kind is its last entry).
 *   2026-10-10     the first texts: 「只看得到打开的项目」
 *   2026-10-10.2   the same, and what the six switches do not govern (real-app section 10: 「提醒时间不受六个开关管」):
 *                  a confirmed family member sees the time of his first morning reminder and which recording plays,
 *                  because she can record that reminder; and she can add a line to his details, which counts only
 *                  after he confirms it (real-app 3.10 「补档案」)
 *   2026-10-11     the same, and the first paragraph says both ways a link is made (line bind, lib/care/bind.ts): one
 *                  he invited her to starts with every item off; one made by entering an account starts with four
 *                  items on, and a family member who entered his account herself sees those four and nothing else
 *                  until he has answered (lib/care/ack.ts)
 *   2026-10-14     the owner's decision of that day: the same six switches, and each one shows its kind in full while it
 *                  is on (lib/care/home.ts). The sentence that names the four items a bound link starts with says so:
 *                  his medicine each day (which medicine, when, the reason when he did not take it), his blood pressure
 *                  readings, the questions he wants to ask his doctor (it said counts: the days, how many readings, how
 *                  many questions). Her text no longer lists readings and the questions' words among what stays hidden
 *                  until he opens it: only his notes and his visit recordings do. Before it was published, the 华语 of
 *                  both texts also took the same day's other decision (professional words: 服药, 未回应, 就诊, 待问医生
 *                  where they said 吃药, 没回, 看诊, 要问医生), in the same places; nothing else changed.
 *                  A link made under an older version is asked again (the owner, the same day, before real users:
 *                  lib/care/reconsent.ts): until both of them have agreed to this version, her view of him is the
 *                  alert-only form, and each gets a card with their text.
 * Never clinical: who sees what, who changes it, how it ends.
 */
import { createHash } from "node:crypto";
import { consentBody, type ConsentLocale, type ConsentText } from "@/lib/privacy/consent-texts";
import type { ConsentKind } from "@/lib/store/types";

export type FamilyConsentKind = Extract<ConsentKind, "family_accept" | "family_share">;

/** The version in force now (the last entries of DRAFTS). */
export const FAMILY_CONSENT_VERSION = "2026-10-14";

const DRAFTS: { kind: FamilyConsentKind; version: string; locale: ConsentLocale; title: string; paragraphs: string[] }[] = [
  // ---------------------------------------------------------------- 2026-10-10 (kept: records made under it point here)
  {
    kind: "family_accept",
    version: "2026-10-10",
    locale: "zh-Hans",
    title: "接受家人的邀请",
    paragraphs: [
      "接受以后，你只看得到他在自己的手机上为你打开的项目。每一项一开始都是关着的。",
      "血压读数、问题的内容、他的笔记和看诊录音，他不打开，你就看不到。",
      "你不能替他记录吃药或血压，也不能改他的开关。",
      "你每次看，他都看得到是什么时候、看了哪一项。",
      "你可以随时不再看；他也可以随时停止分享。",
    ],
  },
  {
    kind: "family_accept",
    version: "2026-10-10",
    locale: "en",
    title: "Accepting a family invitation",
    paragraphs: [
      "Once you accept, you see only what he switches on for you on his own phone. Every item starts switched off.",
      "His blood pressure readings, what his questions say, his notes and his visit recordings stay hidden unless he turns them on.",
      "You cannot record his medicine or blood pressure for him, and you cannot change his switches.",
      "Each time you look, he can see when, and which item you looked at.",
      "You can stop looking at any time, and he can stop sharing at any time.",
    ],
  },
  {
    kind: "family_share",
    version: "2026-10-10",
    locale: "zh-Hans",
    title: "让家人看到你的记录",
    paragraphs: [
      "确认以后，这位家人只看得到你为对方打开的项目，别的都看不到。",
      "每一项随时能开能关，改了以后对方那边马上跟着变。每次改动都会留下记录。",
      "你随时可以停止分享，对方马上就看不到了。",
    ],
  },
  {
    kind: "family_share",
    version: "2026-10-10",
    locale: "en",
    title: "Letting a family member see your records",
    paragraphs: [
      "Once you confirm, this family member sees only the items you switch on, nothing else.",
      "You can switch each item on or off at any time, and their screen follows at once. Every change is recorded.",
      "You can stop sharing at any time, and they stop seeing anything at once.",
    ],
  },
  // ---------------------------------------------------------------- 2026-10-10.2 (kept: records made under it point here)
  {
    kind: "family_accept",
    version: "2026-10-10.2",
    locale: "zh-Hans",
    title: "接受家人的邀请",
    paragraphs: [
      "接受以后，你看得到的是他在自己的手机上为你打开的项目。每一项一开始都是关着的。",
      "有一样不归这些开关管：他早上第一次提醒的时间。他确认是你以后，你可以给他录一段提醒，所以不管开关怎么设，你都看得到这次提醒在几点，和现在放给他的是哪一段录音。",
      "血压读数、问题的内容、他的笔记和看诊录音，他不打开，你就看不到。",
      "你不能替他记录吃药或血压，也不能改他的开关。你可以给他的资料补充一条，要等他本人确认才算数。",
      "你每次看，他都看得到是什么时候、看了哪一项。",
      "你可以随时不再看；他也可以随时停止分享。",
    ],
  },
  {
    kind: "family_accept",
    version: "2026-10-10.2",
    locale: "en",
    title: "Accepting a family invitation",
    paragraphs: [
      "Once you accept, you see what he switches on for you on his own phone. Every item starts switched off.",
      "One thing is not governed by those switches: the time of his first morning reminder. Once he confirms it is you, you can record a reminder for him, so whatever the switches say, you can see what time that reminder comes and which recording plays for him now.",
      "His blood pressure readings, what his questions say, his notes and his visit recordings stay hidden unless he turns them on.",
      "You cannot record his medicine or blood pressure for him, and you cannot change his switches. You can add a line to his details; it counts only after he confirms it himself.",
      "Each time you look, he can see when, and which item you looked at.",
      "You can stop looking at any time, and he can stop sharing at any time.",
    ],
  },
  {
    kind: "family_share",
    version: "2026-10-10.2",
    locale: "zh-Hans",
    title: "让家人看到你的记录",
    paragraphs: [
      "确认以后，这位家人看得到你为对方打开的项目。你没打开的，对方看不到。",
      "有一样不归这些开关管：早上提醒的时间。对方可以给你录一段提醒，所以不管开关怎么设，对方都看得到你早上第一次提醒在几点，和现在给你放的是哪一段提醒录音。",
      "对方也可以给你的资料补充一条，要你本人确认以后才算数。",
      "每一项随时能开能关，改了以后对方那边马上跟着变。每次改动都会留下记录。",
      "你随时可以停止分享，对方马上就什么都看不到了，提醒的时间也一样。",
    ],
  },
  {
    kind: "family_share",
    version: "2026-10-10.2",
    locale: "en",
    title: "Letting a family member see your records",
    paragraphs: [
      "Once you confirm, this family member sees the items you switch on. What you leave off stays hidden from them.",
      "One thing is not governed by those switches: the time of your morning reminder. They can record a reminder for you, so whatever the switches say, they can see what time your first morning reminder comes and which reminder recording plays for you now.",
      "They can also add a line to your details. It counts only after you confirm it yourself.",
      "You can switch each item on or off at any time, and their screen follows at once. Every change is recorded.",
      "You can stop sharing at any time. They stop seeing anything at once, the reminder time included.",
    ],
  },
  // ---------------------------------------------------------------- 2026-10-11 (kept: records made under it point here)
  // Line bind, round two: a link can now be made by entering an account (lib/care/bind.ts), and such a link starts with
  // four items on. The first paragraph of each text said every item starts off (hers) and that she sees what he
  // switched on after he confirmed (his): untrue for a bound link, whose records point at these texts too. Only the
  // first paragraph changed; it now says both ways in, and what a family member who entered his account herself may do
  // before he has answered (lib/care/ack.ts). The words of that paragraph are line bind's, in the terms' phrasing
  // (lib/privacy/consent-texts.ts terms_privacy 2026-10-11).
  {
    kind: "family_accept",
    version: "2026-10-11",
    locale: "zh-Hans",
    title: "接受家人的邀请",
    paragraphs: [
      "你看得到的是他那边开着的项目。他发邀请请你来的，每一项一开始都是关着的，由他在自己的手机上为你打开。填账号绑定的，一开始开着四项：这周吃药的天数、量了几次血压、有几个问题要问医生，提醒两次没回的时候会通知你。你自己填他的账号绑定的，要等他在自己的手机上点了「知道了」或者改了你的开关：在那以前，你看得到的只有这四项，还不能给他录提醒，也不能给他的资料补充。",
      "有一样不归这些开关管：他早上第一次提醒的时间。他确认是你以后，你可以给他录一段提醒，所以不管开关怎么设，你都看得到这次提醒在几点，和现在放给他的是哪一段录音。",
      "血压读数、问题的内容、他的笔记和看诊录音，他不打开，你就看不到。",
      "你不能替他记录吃药或血压，也不能改他的开关。你可以给他的资料补充一条，要等他本人确认才算数。",
      "你每次看，他都看得到是什么时候、看了哪一项。",
      "你可以随时不再看；他也可以随时停止分享。",
    ],
  },
  {
    kind: "family_accept",
    version: "2026-10-11",
    locale: "en",
    title: "Accepting a family invitation",
    paragraphs: [
      "You see the items that are switched on for you on his side. If he invited you, every item starts switched off and he switches them on from his own phone. If you are linked by an account being entered, four items start switched on: how many days this week he took his medicine, how many blood pressure readings he took, how many questions are waiting for the doctor, and a notice to you when two reminders go unanswered. If you entered his account yourself, he still has to tap “Got it” on his own phone or change one of your switches: until then those four items are all you see, and you cannot yet record a reminder for him or add to his details.",
      "One thing is not governed by those switches: the time of his first morning reminder. Once he confirms it is you, you can record a reminder for him, so whatever the switches say, you can see what time that reminder comes and which recording plays for him now.",
      "His blood pressure readings, what his questions say, his notes and his visit recordings stay hidden unless he turns them on.",
      "You cannot record his medicine or blood pressure for him, and you cannot change his switches. You can add a line to his details; it counts only after he confirms it himself.",
      "Each time you look, he can see when, and which item you looked at.",
      "You can stop looking at any time, and he can stop sharing at any time.",
    ],
  },
  {
    kind: "family_share",
    version: "2026-10-11",
    locale: "zh-Hans",
    title: "让家人看到你的记录",
    paragraphs: [
      "这位家人看得到的是开着的项目，关着的对方看不到。你发邀请请来的，要你确认是对方以后才看得到，每一项一开始都是关着的。填账号绑定的，一开始开着四项：这周吃药的天数、量了几次血压、有几个问题要问医生，提醒两次没回的时候会通知对方；看诊录音和你的笔记要你自己打开。对方自己填你的账号绑定的，要等你点了「知道了」或者改了对方的开关：在那以前，对方看得到的只有这四项，还不能给你录提醒，也不能给你的资料补充。",
      "有一样不归这些开关管：早上提醒的时间。对方可以给你录一段提醒，所以不管开关怎么设，对方都看得到你早上第一次提醒在几点，和现在给你放的是哪一段提醒录音。",
      "对方也可以给你的资料补充一条，要你本人确认以后才算数。",
      "每一项随时能开能关，改了以后对方那边马上跟着变。每次改动都会留下记录。",
      "你随时可以停止分享，对方马上就什么都看不到了，提醒的时间也一样。",
    ],
  },
  {
    kind: "family_share",
    version: "2026-10-11",
    locale: "en",
    title: "Letting a family member see your records",
    paragraphs: [
      "This family member sees the items that are switched on, and none of the ones that are off. Someone you invited sees them after you confirm it is them, and every item starts switched off. Someone linked by an account being entered starts with four items on: how many days this week you took your medicine, how many blood pressure readings you took, how many questions are waiting for the doctor, and a notice to them when two reminders go unanswered; visit recordings and your notes stay closed until you open them. If they entered your account themselves, you still have to tap “Got it” or change one of their switches: until then those four items are all they see, and they cannot yet record a reminder for you or add to your details.",
      "One thing is not governed by those switches: the time of your morning reminder. They can record a reminder for you, so whatever the switches say, they can see what time your first morning reminder comes and which reminder recording plays for you now.",
      "They can also add a line to your details. It counts only after you confirm it yourself.",
      "You can switch each item on or off at any time, and their screen follows at once. Every change is recorded.",
      "You can stop sharing at any time. They stop seeing anything at once, the reminder time included.",
    ],
  },
  // ---------------------------------------------------------------- 2026-10-14 (in force)
  // The owner's decision of 2026-10-14: the same six switches, each showing its kind in full while it is on. The first
  // three had been made stricter than the challenge asks ("whether and how many": no reason for a dose he did not take,
  // a count of readings, a count of questions), and the texts said so. Two things changed, nothing else, word for word:
  //   - the sentence of the first paragraph that names the four items a link made by entering an account starts with
  //     (his text and hers): the kinds themselves, the first one said out in full;
  //   - her third paragraph, which listed his readings and what his questions say among what stays hidden unless he
  //     turns it on: only his notes and his visit recordings are on that list now.
  // The first four stay on for a direct bind (lib/care/bind.ts DIRECT_GRANTS); recordings and notes stay off until he
  // opens them. Before this version was published, its 华语 also took the owner's other decision of that day,
  // professional words where it said spoken ones (每日服药情况, 未服药, 待问医生, 两次提醒均未回应, 就诊 for 每天吃药, 没吃,
  // 要问医生, 提醒两次没回, 看诊), in the same places: her text first (the family side), then his. The 2026-10-11
  // entries above stay exactly as they are: records point at them.
  {
    kind: "family_accept",
    version: "2026-10-14",
    locale: "zh-Hans",
    title: "接受家人的邀请",
    paragraphs: [
      "你看得到的是他那边开着的项目。他发邀请请你来的，每一项一开始都是关着的，由他在自己的手机上为你打开。填账号绑定的，一开始开着四项：每日服药情况（药物名称、服药时间、未服药的原因）、血压读数、待问医生的问题，两次提醒均未回应时会通知你。你自己填他的账号绑定的，要等他在自己的手机上点了「知道了」或者改了你的开关：在那以前，你看得到的只有这四项，还不能给他录提醒，也不能给他的资料补充。",
      "有一样不归这些开关管：他早上第一次提醒的时间。他确认是你以后，你可以给他录一段提醒，所以不管开关怎么设，你都看得到这次提醒在几点，和现在放给他的是哪一段录音。",
      "他的笔记和就诊录音，他不打开，你就看不到。",
      "你不能替他记录服药或血压，也不能改他的开关。你可以给他的资料补充一条，要等他本人确认才算数。他分享问题单时，你可以把建议问医生的问题加入他的问题单，上面会标明是家人加的，问不问由他决定。长按他分享的一条记录，Ripple 会根据这些记录写一段说明；只有他本人同意过 AI 处理，这段说明才会由 AI 来写。说明不是医嘱。",
      "你每次看，他都看得到是什么时候、看了哪一项。",
      "你可以随时不再看；他也可以随时停止分享。",
    ],
  },
  {
    kind: "family_accept",
    version: "2026-10-14",
    locale: "en",
    title: "Accepting a family invitation",
    paragraphs: [
      "You see the items that are switched on for you on his side. If he invited you, every item starts switched off and he switches them on from his own phone. If you are linked by an account being entered, four are on at first: his medicine each day (which medicine, when, and the reason when he did not take it), his blood pressure readings, the questions he wants to ask his doctor, and a notice to you when two reminders go unanswered. If you entered his account yourself, he still has to tap “Got it” on his own phone or change one of your switches: until then those four items are all you see, and you cannot yet record a reminder for him or add to his details.",
      "One thing is not governed by those switches: the time of his first morning reminder. Once he confirms it is you, you can record a reminder for him, so whatever the switches say, you can see what time that reminder comes and which recording plays for him now.",
      "His notes and his visit recordings stay hidden unless he turns them on.",
      "You cannot record his medicine or blood pressure for him, and you cannot change his switches. You can add a line to his details; it counts only after he confirms it himself. While he shares his question list, you can add a suggested question for his doctor to it; it is marked as added by family, and whether to ask it is his choice. When you hold one of the records he shares, Ripple writes a short explanation from those records; AI writes it only if he has agreed to AI processing. The explanation is not medical advice.",
      "Each time you look, he can see when, and which item you looked at.",
      "You can stop looking at any time, and he can stop sharing at any time.",
    ],
  },
  {
    kind: "family_share",
    version: "2026-10-14",
    locale: "zh-Hans",
    title: "让家人看到你的记录",
    paragraphs: [
      "这位家人看得到的是开着的项目，关着的对方看不到。你发邀请请来的，要你确认是对方以后才看得到，每一项一开始都是关着的。填账号绑定的，一开始开着四项：每日服药情况（药物名称、服药时间、未服药的原因）、血压读数、待问医生的问题，两次提醒均未回应时会通知对方；就诊录音和你的笔记要你自己打开。对方自己填你的账号绑定的，要等你点了「知道了」或者改了对方的开关：在那以前，对方看得到的只有这四项，还不能给你录提醒，也不能给你的资料补充。",
      "有一样不归这些开关管：早上提醒的时间。对方可以给你录一段提醒，所以不管开关怎么设，对方都看得到你早上第一次提醒在几点，和现在给你放的是哪一段提醒录音。",
      "对方也可以给你的资料补充一条，要你本人确认以后才算数。你分享问题单时，对方可以往你的问题单里加一个待问医生的问题，上面会标明是家人加的，问不问由你决定。对方长按你分享的一条记录时，Ripple 会根据这些记录给对方写一段说明；只有你同意过 AI 处理，这段说明才会由 AI 来写。",
      "每一项随时能开能关，改了以后对方那边马上跟着变。每次改动都会留下记录。",
      "你随时可以停止分享，对方马上就什么都看不到了，提醒的时间也一样。",
    ],
  },
  {
    kind: "family_share",
    version: "2026-10-14",
    locale: "en",
    title: "Letting a family member see your records",
    paragraphs: [
      "This family member sees the items that are switched on, and none of the ones that are off. Someone you invited sees them after you confirm it is them, and every item starts switched off. For someone linked by an account being entered, four are on at first: your medicine each day (which medicine, when, and the reason when you did not take it), your blood pressure readings, the questions you want to ask your doctor, and a notice to the other person when two reminders go unanswered; visit recordings and your notes stay off until you turn them on. If they entered your account themselves, you still have to tap “Got it” or change one of their switches: until then those four items are all they see, and they cannot yet record a reminder for you or add to your details.",
      "One thing is not governed by those switches: the time of your morning reminder. They can record a reminder for you, so whatever the switches say, they can see what time your first morning reminder comes and which reminder recording plays for you now.",
      "They can also add a line to your details. It counts only after you confirm it yourself. While you share your question list, they can add a question for your doctor to it; it is marked as added by family, and whether to ask it is your choice. When they hold one of the records you share, Ripple writes them a short explanation from those records; AI writes it only if you have agreed to AI processing.",
      "You can switch each item on or off at any time, and their screen follows at once. Every change is recorded.",
      "You can stop sharing at any time. They stop seeing anything at once, the reminder time included.",
    ],
  },
];

/** Every published version, oldest first (the registry reads the last entry of a kind as the one in force). */
export const FAMILY_CONSENT_TEXTS: readonly ConsentText[] = DRAFTS.map((d) => {
  const text = consentBody(d.title, d.paragraphs);
  return { kind: d.kind, version: d.version, locale: d.locale, title: d.title, paragraphs: d.paragraphs, text, sha256: createHash("sha256").update(text, "utf8").digest("hex") };
});

/** The text in force now, in `locale` (华语 when the locale has none). */
export function familyConsentText(kind: FamilyConsentKind, locale: ConsentLocale): ConsentText {
  const now = FAMILY_CONSENT_TEXTS.filter((x) => x.kind === kind && x.version === FAMILY_CONSENT_VERSION);
  const t = now.find((x) => x.locale === locale) ?? now.find((x) => x.locale === "zh-Hans");
  if (!t) throw new Error(`no ${kind} text`);
  return t;
}

/** A published text by its version (a record made under an older version still finds its words), or null. */
export function familyConsentTextOf(kind: FamilyConsentKind, version: string, locale: ConsentLocale): ConsentText | null {
  return FAMILY_CONSENT_TEXTS.find((x) => x.kind === kind && x.version === version && x.locale === locale) ?? null;
}
