/**
 * /p/me/devices (docs/plan/real-app.md 2.3, 2.23; track A): 「登录和设备」. The proxy already sent a browser that is
 * nobody to the login; the /p layout keeps everyone without a space of their own out.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loginUrl } from "@/lib/auth/next";
import { patientPageLocale } from "@/lib/auth/page-locale";
import { listDevices } from "@/lib/auth/service";
import { accountDeps, pageFacts, pageUser } from "@/lib/subject/account";
import { DevicesScreen } from "./DevicesScreen";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "登录和设备 · Ripple" };

export default async function DevicesPage({ searchParams }: PageProps<"/p/me/devices">) {
  const me = await pageUser();
  if (!me) redirect(loginUrl("/p/me/devices"));
  const [locale, facts] = await Promise.all([patientPageLocale((await searchParams).lang), pageFacts()]);
  const devices = await listDevices(accountDeps(), me, facts);
  return <DevicesScreen locale={locale} devices={devices} />;
}
