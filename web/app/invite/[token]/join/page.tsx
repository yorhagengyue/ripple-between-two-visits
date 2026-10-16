/**
 * /invite/[token]/join — her short sign-up on the way into his invitation (C2 track D; the daughter brief A2). Signed
 * in already: back to the invitation (she accepts there). The invitation must still be open (else back to it, which
 * says why). components/family/HerAccount.tsx does the rest: track A's sign-up with no space, then accepting.
 */
import { redirect } from "next/navigation";
import { HerSignup } from "@/components/family/HerAccount";
import { FamilyScreen, FamilyTop } from "@/components/family-ui";
import { dadWord } from "@/lib/care/copy";
import { hc } from "@/lib/care/her-copy";
import { lookupInvite } from "@/lib/care/links";
import { otherLocale } from "@/lib/i18n";
import { getPatientLocale } from "@/lib/session/server";
import { careEntryStore, getPageUser } from "@/lib/subject/care";
import { nowMs } from "@/lib/time/now";

export const dynamic = "force-dynamic";

export default async function InviteJoinPage({ params }: PageProps<"/invite/[token]/join">) {
  const { token: raw } = await params;
  const token = decodeURIComponent(raw);
  const back = `/invite/${raw}`;
  const [locale, me] = await Promise.all([getPatientLocale(), getPageUser()]);
  if (me) redirect(back);
  const found = await lookupInvite(careEntryStore(), token, null, nowMs());
  if (found.state !== "open" || !found.link) redirect(back);
  const dad = dadWord(found.link.patientLabel, locale);
  return (
    <div className="contents" data-testid="invite-join">
      <FamilyScreen locale={locale}>
        {/* the top bar goes to the form, which leaves it out on the screen that shows her recovery code once */}
        <HerSignup
          locale={locale}
          token={token}
          dad={dad}
          top={<FamilyTop back={{ href: back, label: hc(locale, "inviteBack", { dad }) }} locale={locale} langHref={`/api/profile/lang?to=${otherLocale(locale)}&next=${encodeURIComponent(`${back}/join`)}`} />}
        />
      </FamilyScreen>
    </div>
  );
}
