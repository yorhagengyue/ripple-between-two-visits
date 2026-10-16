/**
 * /p/me/ai — 「AI 处理」 (journey 15; real-app 2.23 「AI 处理：同意或撤回」, 3.11; the elder brief 15.4 「开或关，写清楚关了以后会
 * 怎样」; C2 track H; laid out after the timeline draft's 15-5). The header names the screen; under it the switch (POST
 * /api/me/consent, a new consent record) that says 开 or 关 in words, what the tap just changed, when he last changed
 * it, and the AI-processing text itself, the same version and words whose hash the record keeps (track A's
 * CONSENT_TEXTS): what goes to DeepSeek and that it is processed in China, and what changes when it is off.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { meScreenCopy } from "@/components/me/copy";
import { PageHeader, Screen } from "@/components/ui";
import { aiState } from "@/lib/privacy/ai";
import { currentConsentText } from "@/lib/privacy/consent-texts";
import { asHLocale, hCopy } from "@/lib/privacy/copy";
import { momentWords } from "@/lib/privacy/words";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";
import { AiSwitch } from "./AiSwitch";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI 处理 · Ripple" };

export default async function AiPage() {
  const [ctx, uiLocale] = await Promise.all([getPageSubject(), getPatientLocale()]);
  if (!ctx) return null;
  if (ctx.subject.kind !== "account" || ctx.subject.relation !== "self" || !ctx.subject.userId) notFound();
  const locale = asHLocale(uiLocale);
  const c = hCopy(locale);
  const state = await aiState(ctx.store, ctx.subject.userId);
  const text = currentConsentText("ai_processing", locale);
  return (
    <Screen locale={locale} className="rpm-screen">
      <PageHeader back={{ href: "/p/me", label: c.me }} title={meScreenCopy(locale).aiTitle} locale={locale} />
      <AiSwitch
        locale={locale}
        on={state.on}
        since={state.at ? momentWords(state.at, locale, ctx.session.tz) : null}
        textTitle={text.title}
        paragraphs={[...text.paragraphs]}
        version={text.version}
      />
    </Screen>
  );
}
