/**
 * The words the 「我」 screens need that the tracks' own copy modules do not have (the rebuild after the timeline draft,
 * line fe-me; web/progress/fe-me.md). Chrome only: where a way back leads, a screen's name in its header, a state split
 * off a sentence that used to be one line (「开着 · DeepSeek，在中国处理」 is now 「开着」 on the right and the rest under the
 * title). Every sentence that explains a consequence stays in its track's module: lib/privacy/copy.ts (export, AI,
 * deleting), lib/auth/copy.ts (devices, password, recovery code, family help), lib/push/copy.ts (reminders),
 * lib/profile/copy.ts (name, language, times, the example), app/p/me/filming/copy.ts. Client-safe.
 */
export type MeLocale = "zh-Hans" | "en";

const zh = {
  /** 「‹ 今天」 on 「我」 */
  today: "今天",
  /** 「‹ 上一步」: the second screen of a two-step flow goes back to its first */
  stepBack: "上一步",
  // 「我」: the state on the right of a row
  aiOn: "开着",
  aiOff: "关着",
  aiOnSub: "DeepSeek，在中国处理",
  aiOffSub: "提问只给固定的回答和原话",
  devices: (n: number) => `${n} 台`,
  // the names of screens whose header had no title of its own
  aiTitle: "AI 处理",
  recoveryTitle: "恢复码",
  // 家人什么时候看过: one look, its sentence split into who and when (the head line) and what (the title)
  looked: (what: string) => `看了${what}`,
  familyFallback: "家人",
};

export type MeCopy = typeof zh;

const en: MeCopy = {
  today: "Today",
  stepBack: "Back",
  aiOn: "On",
  aiOff: "Off",
  aiOnSub: "DeepSeek, processed in China",
  aiOffSub: "Asking gives fixed answers and original words only",
  devices: (n) => (n === 1 ? "1 device" : `${n} devices`),
  aiTitle: "AI processing",
  recoveryTitle: "Recovery code",
  looked: (what) => `Looked at ${what}`,
  familyFallback: "Your family member",
};

export function meScreenCopy(locale: MeLocale | string): MeCopy {
  return locale === "en" ? en : zh;
}
