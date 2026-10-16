/**
 * The consent texts that had none (docs/plan/real-app.md 3.11: every consent record carries the version and the sha256 of
 * the words he saw): keeping a visit's recording for good (retention_keep_forever) and letting a family member help him
 * reset his password (family_reset_helper). C2 track H; client-safe (the screens that ask show `title` and
 * `paragraphs`), same shape and canonical form as track A's sign-up texts (./consent-texts.ts consentBody).
 *
 * Every kind's text is reached through one module, ./consents.ts (server-only: it also gathers track A's, track D's and
 * track F's texts, publishes them to consent_text and stamps the records). A screen imports its own text from here.
 *
 * Changing a text means a NEW version (add an entry, keep the old one: records point at it) and a new sha256:
 * tests/unit/privacy/consents.test.ts recomputes every hash and prints the right one.
 * Never clinical: what is kept and for how long, who can help with a password and what they cannot do.
 */
import { consentBody, type ConsentLocale, type ConsentText } from "./consent-texts";

export type MoreConsentKind = "retention_keep_forever" | "family_reset_helper";

/** The version each of these texts is at now. */
export const MORE_CONSENT_VERSIONS: Record<MoreConsentKind, string> = {
  retention_keep_forever: "2026-10-10",
  family_reset_helper: "2026-10-10",
};

interface Draft {
  kind: MoreConsentKind;
  version: string;
  locale: ConsentLocale;
  title: string;
  paragraphs: readonly string[];
  sha256: string;
}

const DRAFTS: readonly Draft[] = [
  {
    kind: "retention_keep_forever",
    version: "2026-10-10",
    locale: "zh-Hans",
    title: "一直保留这次看诊的录音",
    paragraphs: [
      "打开以后，这次看诊的录音和每句话的片段不会在 90 天后自动删除，会一直留着，直到你关掉这一项或者删除账号。",
      "关掉以后，回到原来的规则：从看诊那天起留 90 天，到期自动删除；已经过了 90 天的，会在下一次清理时删除。",
      "不管开还是关，逐字稿和医生交代的事都留着。",
    ],
    sha256: "17f14a796ea9a9a6f00b132d199fd74a78000b7de9116b07f3db2e5baafce501",
  },
  {
    kind: "retention_keep_forever",
    version: "2026-10-10",
    locale: "en",
    title: "Keeping this visit's recording for good",
    paragraphs: [
      "While this is on, this visit's recording and the clip of each sentence are not deleted after 90 days. They stay until you switch this off or delete your account.",
      "When you switch it off, the usual rule applies again: kept for 90 days from the day of the visit, then deleted automatically. A recording already past its 90 days is deleted at the next clean-up.",
      "On or off, the transcript and what the doctor asked you to do are kept.",
    ],
    sha256: "c54c1d3e9a450018c4cd17ddeef7f98c14cd45115534899d9582e96833e953c5",
  },
  {
    kind: "family_reset_helper",
    version: "2026-10-10",
    locale: "zh-Hans",
    title: "忘记密码时，让这位家人帮你重设",
    paragraphs: [
      "打开以后，你忘了密码时，可以在自己用过的手机上请这位家人帮忙。",
      "对方的手机上会出现一个 6 位数。对方把数字念给你，你在自己的手机上输入这个数字和新密码。",
      "这个数字 10 分钟内有效，只能用一次；在对方的手机上输入，或者在你没用过的手机上输入，都无效。",
      "对方看不到你的密码，也改不了你给对方看的项目。",
      "重设成功以后，你登录过的设备都要重新登录，今天页会写明是谁帮你重设的。",
      "你随时可以关掉这一项。",
    ],
    sha256: "f73e021ff8daf5db894b097d1d4cfcb65e6f1240e55527b44678faad2087da8a",
  },
  {
    kind: "family_reset_helper",
    version: "2026-10-10",
    locale: "en",
    title: "Letting this family member help you reset your password",
    paragraphs: [
      "While this is on, if you forget your password you can ask this family member for help from a phone you have used before.",
      "A 6-digit number appears on their phone. They read it to you, and you type it into your own phone with a new password.",
      "The number works for 10 minutes and only once. Typing it on their phone, or on a phone you have not used before, does not work.",
      "They never see your password, and they cannot change what you let them see.",
      "After a reset, every device you were signed in on has to sign in again, and your Today page says who helped you.",
      "You can switch this off at any time.",
    ],
    sha256: "ec661b7f18eae00ecd1c3495274afa41837545c5957d8a6a293cd8606938c7c2",
  },
];

/** Every published text of these two kinds (all versions, both locales). */
export const MORE_CONSENT_TEXTS: readonly ConsentText[] = DRAFTS.map((d) => ({ ...d, text: consentBody(d.title, d.paragraphs) }));

/** The text a screen shows now for one of these kinds. */
export function moreConsentText(kind: MoreConsentKind, locale: ConsentLocale): ConsentText {
  const t = MORE_CONSENT_TEXTS.find((x) => x.kind === kind && x.version === MORE_CONSENT_VERSIONS[kind] && x.locale === locale);
  if (!t) throw new Error(`no ${kind} text ${MORE_CONSENT_VERSIONS[kind]} in ${locale}`);
  return t;
}
