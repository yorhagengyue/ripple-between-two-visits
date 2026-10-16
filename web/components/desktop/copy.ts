/**
 * The words of the note beside the phone column on a computer (DeskNote.tsx). Chrome only, in the phone's language.
 *
 * The note is in the DOM of every phone page in a wide window, next to that page's own words, and many tests find
 * things by visible text or by role and name. So nothing here repeats a sentence, a label or a name that a page shows:
 * no 「Ripple」 as text (the code is the only mark), none of the pages' button words (登录, 注册, 今天, 我, 开, 关, 改, 打, 听 …),
 * no address and no number. e2e/fe-desk.spec.ts checks this on every page; tests/unit/desktop/desktop-css.test.ts
 * holds the list of words below.
 */

export type DeskLocale = "zh-Hans" | "en";

export interface DeskCopy {
  /** the note's accessible name */
  label: string;
  /** the QR code's accessible name */
  code: string;
  /** the first line */
  lead: string;
  /** what a computer shows, and how to get the app on a phone */
  text: string;
}

export const DESK_COPY: Record<DeskLocale, DeskCopy> = {
  "zh-Hans": {
    label: "电脑上的提示",
    code: "在手机上用的二维码",
    lead: "这是给手机用的",
    text: "电脑上显示成中间这一栏。用手机的相机扫上面的码，就能在手机上用。",
  },
  en: {
    label: "A word about this view",
    code: "QR code for a phone",
    lead: "Built for a phone",
    text: "A computer shows it as this single column. Point a phone's camera at the code above to use it there.",
  },
};

/** Words of the pages that the note must never contain (the short ones a test may look for by text). */
export const DESK_COPY_AVOIDS: Record<DeskLocale, readonly string[]> = {
  "zh-Hans": ["Ripple", "登录", "注册", "今天", "看诊", "血压", "返回", "我", "开", "关", "改", "打", "听", "停", "对", "问", "吃", "药", "说"],
  en: ["Ripple", "Log in", "Sign up", "Today", "Visit", "Back", "Undo", "Send", "Type", "Taken", "Later", "Listen", "Change"],
};

/** The phone page's own language (the `lang` of its screen), as one of the two the app speaks. */
export function deskLocale(lang: string | null | undefined): DeskLocale {
  return lang && lang.toLowerCase().startsWith("en") ? "en" : "zh-Hans";
}

export function deskCopy(locale: DeskLocale): DeskCopy {
  return DESK_COPY[locale] ?? DESK_COPY["zh-Hans"];
}
