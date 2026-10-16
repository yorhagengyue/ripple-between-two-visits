/**
 * The fixed sentences of the family texts asked again (owner, 2026-10-14; lib/care/reconsent.ts): her one quiet line and
 * her card's button, his card's title and two buttons. Client-safe. Same pattern as her-copy.ts: 华语 and English, `{dad}`
 * how she calls him (lib/care/copy.ts dadWord), `{name}` how his screens name her. The texts the cards show are the
 * family texts in force themselves (lib/care/consent.ts familyConsentText), never words of this file. His side is
 * written for a man of about seventy: short, plain, the app's professional words.
 */
import type { Locale } from "@/lib/i18n";

const zh = {
  // her screens, above what she sees of him, while either of them has not agreed to the text in force
  line: "{dad}那边的分享说明更新了。等你们两位都确认新的说明以后，这里才会显示详细记录。",
  // her card (her home), under her text in force; one button
  herAgree: "同意新的说明",
  herFailed: "没有成功，请再试一次。",
  // his card (Today, his page for her), above his text in force
  hisTitle: "{name}能看到的内容更新了",
  hisAgree: "同意",
  hisLater: "先不",
  hisFailed: "没有成功，请再试一次。",
  // his card when the link names nobody
  hisSomeone: "家人",
};

export type ReconsentKey = keyof typeof zh;

const en: Record<ReconsentKey, string> = {
  line: "{dad}'s sharing terms were updated. Detailed records show again once you have both agreed to the new terms.",
  herAgree: "Agree to the new terms",
  herFailed: "That didn't work. Try again.",
  hisTitle: "What {name} can see has been updated",
  hisAgree: "Agree",
  hisLater: "Not now",
  hisFailed: "That didn't work. Try again.",
  hisSomeone: "Your family member",
};

const messages: Record<Locale, Record<ReconsentKey, string>> = { "zh-Hans": zh, en };

/** A sentence of this file. In English a sentence that starts with a name (「{Dad}'s sharing terms…」) starts with a capital. */
export function rcc(locale: Locale, key: ReconsentKey, vars: Record<string, string | number> = {}): string {
  const raw = messages[locale]?.[key] ?? zh[key];
  const out = raw.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole));
  return locale === "en" ? out.charAt(0).toUpperCase() + out.slice(1) : out;
}
