/**
 * The one sentence for "he has not agreed to AI processing" on the ask screens (C2 track S, round 2; real-app 2.10 line
 * 189: 没有 AI 处理同意时，不调模型，只走固定模板和转介，屏上说「你没有同意用 AI，这里只能帮你记下来、转给医生」). There were
 * two wordings (a template and a footer); now there is this one, used in both places:
 *
 *   on the screen    /p/ask and Today's ask section say it for as long as his consent is off, before he asks and under his
 *                    answers (components/today/AskSection.tsx); the chat screen and an older answer made without consent
 *                    carry it as their footer (ask-copy.ts noAi)
 *   in an answer     when the rules found nothing to relay, the fixed template no_ai_consent says it, followed by where his
 *                    question went (templates.ts)
 * Client-safe (a constant).
 */
export const NO_AI_SENTENCE = {
  zh: "你没有同意用 AI，这里只能帮你记下来、转给医生。",
  en: "You have not agreed to AI, so here I can only note this down and pass it to your doctor.",
} as const;
