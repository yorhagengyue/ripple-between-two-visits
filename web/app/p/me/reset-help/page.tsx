/**
 * /p/me/reset-help (docs/plan/real-app.md 2.4 「家人协助（默认关）」 step 1, 3.6; track A): 「忘记密码时，让家人帮我」. What it
 * means in plain words (the published consent text, track H's lib/privacy/consent-texts-more.ts), then one switch per family
 * member who is confirmed and active, each off until he turns it on himself. Reached from 「我」 and from a family
 * member's own page (「我 → 家人」). Signed out: the login, and back here.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { listResetHelpers } from "@/lib/auth/family-reset";
import { loginUrl } from "@/lib/auth/next";
import { patientPageLocale } from "@/lib/auth/page-locale";
import { moreConsentText } from "@/lib/privacy/consent-texts-more";
import { accountDeps, pageUser } from "@/lib/subject/account";
import { ResetHelpScreen } from "./ResetHelpScreen";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "忘记密码时让家人帮我 · Ripple" };

export default async function ResetHelpPage({ searchParams }: PageProps<"/p/me/reset-help">) {
  const me = await pageUser();
  if (!me) redirect(loginUrl("/p/me/reset-help"));
  const locale = await patientPageLocale((await searchParams).lang);
  const helpers = await listResetHelpers(accountDeps(), me);
  const text = moreConsentText("family_reset_helper", locale);
  return <ResetHelpScreen locale={locale} helpers={helpers} paragraphs={text.paragraphs} />;
}
