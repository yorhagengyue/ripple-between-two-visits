import type { UiLocale } from "@/lib/ui/tokens";
import { meScreenCopy } from "./copy";
import { MeEntry } from "./MeEntry";

/**
 * 我 · AI processing (entry "ai"; C2 track H, journey 15): opens 「AI 处理」 (/p/me/ai), where he switches it on or off.
 * `on` (optional): the state now, written on the right (「开着」 / 「关着」, the draft's 「开」) with what it means under the
 * name; without it the line says what the switch is about.
 */
export function AiConsentEntry({ locale, href = "/p/me/ai", on }: { locale: UiLocale; href?: string; on?: boolean }) {
  const zh = locale === "zh-Hans";
  const c = meScreenCopy(locale);
  const title = zh ? "AI 处理" : "AI processing";
  if (on === undefined) {
    return <MeEntry entry="ai" href={href} title={title} status={zh ? "开着时问句和就诊转写交给腾讯云的混元模型处理（可能在新加坡以外）" : "When on, questions and visit transcripts go to Tencent Cloud's Hunyuan model (possibly outside Singapore)"} />;
  }
  return <MeEntry entry="ai" href={href} title={title} status={on ? c.aiOnSub : c.aiOffSub} right={<span data-on={on ? "true" : "false"}>{on ? c.aiOn : c.aiOff}</span>} />;
}
