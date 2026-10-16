/** /p/me/password (docs/plan/real-app.md 2.23; track A): a new password (PasswordFlow). */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loginUrl } from "@/lib/auth/next";
import { patientPageLocale } from "@/lib/auth/page-locale";
import { pageUser } from "@/lib/subject/account";
import { PasswordFlow } from "./PasswordFlow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "改密码 · Ripple" };

export default async function PasswordPage({ searchParams }: PageProps<"/p/me/password">) {
  if (!(await pageUser())) redirect(loginUrl("/p/me/password"));
  const locale = await patientPageLocale((await searchParams).lang);
  return <PasswordFlow locale={locale} />;
}
