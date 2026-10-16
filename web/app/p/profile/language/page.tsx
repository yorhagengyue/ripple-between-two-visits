/**
 * /p/profile/language — 「我 › 语言」 (real-app 2.23; track C; laid out with the timeline draft's pieces by line fe-me):
 * 华语 or English as the draft's list of options, each in its own language; the one in use has the filled ring. A tap
 * saves it for his account (his reminders are sent in it), his space and this browser, and goes back to 「我」. His own
 * account only (the demo has no 「我」: 404).
 */
import { notFound } from "next/navigation";
import { P } from "@/components/me/parts";
import { PageHeader, Screen } from "@/components/ui";
import { meCopy } from "@/lib/profile/copy";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";
import { LanguageChoice } from "./LanguageChoice";

export const dynamic = "force-dynamic";

export default async function LanguagePage() {
  const [ctx, locale] = await Promise.all([getPageSubject(), getPatientLocale()]);
  if (!ctx) return null;
  if (ctx.subject.kind !== "account" || ctx.subject.relation !== "self") notFound();
  const c = meCopy(locale);
  return (
    <Screen locale={locale} className="rpm-screen">
      <PageHeader back={{ href: "/p/me", label: c.me }} title={c.langTitle.join(" ")} locale={locale} />
      <div className="rpu-stack">
        <P size="large">{c.langLede}</P>
        <LanguageChoice locale={locale} />
      </div>
    </Screen>
  );
}
