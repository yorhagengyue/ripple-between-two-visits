/**
 * /f/me/delete?link= — 「删除我的账号」 for a family member without a space of her own (C2 track H; the daughter brief G;
 * real-app 3.10 她删号, 3.11 删除账号). Her 「我的」 page (track D's /f/me) opens it. First screen: what goes (her account,
 * her links to the people she follows, her consents, devices and notifications) and what stays in their Ripple with only
 * her name on it (the reminders she recorded, their record of when she looked); second screen: her password; then it is
 * done and this phone is signed out. The same POST /api/me/delete as his (lib/privacy/delete.ts): nothing of hers in
 * storage to clear, every session of hers ended, her identity deleted, zero rows by her id, her links left first so his
 * page shows she is gone.
 * It needs no active link; ?link= only names the way back, her 「我的」 (which stays open for a link of hers that has
 * ended: lib/care/her-page.ts herOwnPage). His own phone (an account with a space) has its own screen, /p/me/delete.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loginUrl } from "@/lib/auth/next";
import { dadWord } from "@/lib/care/copy";
import { otherLocale } from "@/lib/i18n";
import { asHLocale } from "@/lib/privacy/copy";
import { getPatientLocale } from "@/lib/session/server";
import { getPageUser } from "@/lib/subject/care";
import { HerDeleteFlow } from "./HerDeleteFlow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "删除我的账号 · Ripple" };

export default async function HerDeletePage({ searchParams }: PageProps<"/f/me/delete">) {
  const sp = await searchParams;
  const link = typeof sp.link === "string" && sp.link.trim() ? sp.link.trim() : null;
  const here = link ? `/f/me/delete?link=${encodeURIComponent(link)}` : "/f/me/delete";
  const [me, uiLocale] = await Promise.all([getPageUser(), getPatientLocale()]);
  if (!me) redirect(loginUrl(here));
  if (me.scope) redirect("/p/me/delete"); // his own phone: his own delete screen
  const locale = asHLocale(uiLocale);
  const links = await me.store.listCareLinks({ family_id: me.user.userId, status: ["active", "accepted"] });
  const names = [...new Set(links.map((l) => dadWord(l.patient_label, locale)))];
  return (
    <HerDeleteFlow
      locale={locale}
      names={names}
      back={link ? `/f/me?link=${encodeURIComponent(link)}` : "/f"}
      langHref={`/api/profile/lang?to=${otherLocale(locale)}&next=${encodeURIComponent(here)}`}
    />
  );
}
