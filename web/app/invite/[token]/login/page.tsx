/**
 * /invite/[token]/login — she already has an account (C2 track D; the daughter brief A2 「已经有账号的走登录」): track A's
 * login, then accepting the invitation. Signed in already: back to the invitation.
 */
import { redirect } from "next/navigation";
import { HerLogin } from "@/components/family/HerAccount";
import { FamilyScreen, FamilyTop } from "@/components/family-ui";
import { dadWord } from "@/lib/care/copy";
import { hc } from "@/lib/care/her-copy";
import { lookupInvite } from "@/lib/care/links";
import { otherLocale } from "@/lib/i18n";
import { getPatientLocale } from "@/lib/session/server";
import { careEntryStore, getPageUser } from "@/lib/subject/care";
import { nowMs } from "@/lib/time/now";

export const dynamic = "force-dynamic";

export default async function InviteLoginPage({ params }: PageProps<"/invite/[token]/login">) {
  const { token: raw } = await params;
  const token = decodeURIComponent(raw);
  const back = `/invite/${raw}`;
  const [locale, me] = await Promise.all([getPatientLocale(), getPageUser()]);
  if (me) redirect(back);
  const found = await lookupInvite(careEntryStore(), token, null, nowMs());
  if (found.state !== "open" || !found.link) redirect(back);
  const dad = dadWord(found.link.patientLabel, locale);
  return (
    <div className="contents" data-testid="invite-login-page">
      <FamilyScreen locale={locale}>
        <FamilyTop back={{ href: back, label: hc(locale, "inviteBack", { dad }) }} locale={locale} langHref={`/api/profile/lang?to=${otherLocale(locale)}&next=${encodeURIComponent(`${back}/login`)}`} />
        <HerLogin locale={locale} token={token} dad={dad} />
      </FamilyScreen>
    </div>
  );
}
