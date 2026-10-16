/**
 * /p/family/invite — he adds a family member (C2 track D; the elder brief 16-20 item 2; real-app 2.19). His own account
 * only (onboarding's 家人 step leads here).
 *
 * Line bind, the direct way first: 「填家人的账号」. He types the account she signed up with and 「绑定」 links the two at
 * once; he lands on his switches for her, four of them on (components/his-family/BindFamily; lib/care/bind.ts).
 *
 * Under it, as the second way, the invitation as it was, introduced by 「她还没有账号？发一个邀请链接给她。」: who she is
 * (her name, what she is to him, what she calls him), then the one-time link (7 days) to send on WhatsApp or copy. Every
 * switch of an invited link starts off; he opens them after he confirms it is her.
 *
 * Laid out as the timeline draft's 17-1 and 17-2 (front-end line fe-fam): the header 「‹ 家人 · 邀请家人」; the form, then
 * the link with 「现在到哪一步了」. The steps follow the link's state, so the page hands its links to the client part
 * and re-reads them when one changes (CareLive). Once a link has been made on this screen the direct way is put away:
 * the screen is about that link. With as many invitations waiting as there may be, no new one can be made: the screen
 * says so and lists them (each row opens the invitation, where it can be cancelled); the direct way stays.
 */
import { notFound } from "next/navigation";
import { CareLive, InviteMaker, type InviteLinkInfo } from "@/components/family/HisFamily";
import { BindFamily } from "@/components/his-family/BindFamily";
import { HisScreen } from "@/components/his-family/pieces";
import { whoWords } from "@/lib/care/copy";
import { pc } from "@/lib/care/his-copy";
import { OPEN_INVITES_MAX, patientLinks } from "@/lib/care/links";
import { getPatientLocale } from "@/lib/session/server";
import { scopeTz } from "@/lib/store/scope";
import { getPageSubject } from "@/lib/subject";
import { careEntryStore } from "@/lib/subject/care";
import { nowMs } from "@/lib/time/now";

export const dynamic = "force-dynamic";

export default async function FamilyInvitePage() {
  const [ctx, locale] = await Promise.all([getPageSubject(), getPatientLocale()]);
  if (!ctx || ctx.subject.kind !== "account" || ctx.subject.relation !== "self" || !ctx.subject.userId) notFound();
  const links = await patientLinks(ctx.store, careEntryStore(), ctx.session, ctx.subject.userId, nowMs());
  const info: InviteLinkInfo[] = links.map((l) => ({ id: l.id, state: l.state, who: whoWords(l.familyLabel, l.relation, locale), invitedAt: l.invitedAt, expiresAt: l.expiresAt }));
  const open = links.filter((l) => l.state === "invited").length;
  return (
    <HisScreen locale={locale} back={{ href: "/p/family", label: pc(locale, "familyTitle") }} title={pc(locale, "invite")} testId="page-family-invite">
      <CareLive />
      <InviteMaker locale={locale} links={info} full={open >= OPEN_INVITES_MAX} tz={scopeTz(ctx.session)} direct={<BindFamily locale={locale} />} />
    </HisScreen>
  );
}
