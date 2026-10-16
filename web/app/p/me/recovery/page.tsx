/** /p/me/recovery (docs/plan/real-app.md 2.23; track A): a new recovery code (RecoveryCodeFlow). */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loginUrl } from "@/lib/auth/next";
import { loginOf, loginShown } from "@/lib/auth/service";
import { patientPageLocale } from "@/lib/auth/page-locale";
import { accountReadAloudAvailable } from "@/lib/auth/read-aloud";
import { pageUser } from "@/lib/subject/account";
import { RecoveryCodeFlow } from "./RecoveryCodeFlow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "恢复码 · Ripple" };

export default async function RecoveryCodePage({ searchParams }: PageProps<"/p/me/recovery">) {
  const me = await pageUser();
  if (!me) redirect(loginUrl("/p/me/recovery"));
  const login = loginOf(me.account, me.email);
  const locale = await patientPageLocale((await searchParams).lang);
  return <RecoveryCodeFlow locale={locale} login={login ? loginShown(login) : ""} readAloud={accountReadAloudAvailable()} />;
}
