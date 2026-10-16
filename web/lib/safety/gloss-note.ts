/**
 * The quiet line under Ripple's own explanation of an answer's quotes (lib/safety/gloss.ts; owner's decision of 10-14:
 * Ripple may explain in its own words, every sentence with its source, never what to take, how much, to change or to
 * stop). The ask screen draws it under the explanation (components/daily/ask-copy.ts glossNote) and the text form of an
 * answer carries it after the explanation (render.ts), so the words say whose they are wherever they are read.
 * Client-safe (a constant).
 */
export const GLOSS_NOTE = {
  zh: "这段是 Ripple 根据上面的原话写的说明，不是医嘱。",
  en: "Ripple's explanation of the words above. Not medical advice.",
} as const;

/**
 * owner 10-15: the quiet line under Ripple's own answer to his question (lib/safety/general.ts), on the ask screen and in
 * the text form of an answer: whose words these are, in one short line.
 */
export const GENERAL_NOTE = {
  zh: "以上是 Ripple 的一般健康信息，不是医生的话。",
  en: "General health information from Ripple, not your doctor's words.",
} as const;
