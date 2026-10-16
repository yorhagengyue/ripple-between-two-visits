/**
 * The check drill's fixed words (lib/crew/drill.ts). Client-safe constants: the judges' page asks the question, the
 * backstage recognises the planted sentence and says so.
 */

/** The query flag of POST /api/ask that asks for the drill (a demo scope only; ignored anywhere else). */
export const DRILL_PARAM = "drill";

/** The one sentence the drill plants: an instruction no source of his says. Fixed; never shown on his screens. */
export const DRILL_SENTENCE = "If the reading is high, take one more tablet tonight.";

/** The question the judges' page asks for the drill, in the phone's language: an ordinary question Ripple can answer. */
export const DRILL_QUESTION = { "zh-Hans": "Amlodipine 这个药是做什么的？", en: "What is amlodipine for?" } as const;
