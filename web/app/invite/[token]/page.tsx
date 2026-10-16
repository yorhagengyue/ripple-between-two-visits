/**
 * /invite/[token] — the one-time invitation he sent her (C2 track D; real-app 2.20; the daughter brief A1, H3). Public:
 * she may not be signed in yet. Nothing about the link is shown unless the token matches its stored hash
 * (lib/care/links.ts lookupInvite):
 *   open        who invites her, what she will see once he switches each item on (all six, each with what exactly she
 *               would see), what stays hidden, the words she agrees to (family_accept); 「接受」: signed in, it is
 *               accepted here; signed out, her short sign-up (which offers her login) first, then it is accepted;
 *               「先不要」
 *   used, expired, invalid    one sentence, what to do (ask him for a new one; an invitation lasts 7 days), and, signed
 *               out, 「登录」 (the draft's H3)
 *   self        he opened his own invitation
 *   hers        already accepted by her (or confirmed): her own page
 */
import { redirect } from "next/navigation";
import { InviteScreen } from "@/components/family/InviteScreen";
import { FamilyHero, FamilyScreen, FamilyTop, InviteAccept } from "@/components/family-ui";
import { loginUrl } from "@/lib/auth/next";
import { familyConsentText } from "@/lib/care/consent";
import { dadWord, grantName } from "@/lib/care/copy";
import { hc, type HerKey } from "@/lib/care/her-copy";
import { lookupInvite } from "@/lib/care/links";
import { NO_GRANTS } from "@/lib/family/types";
import { otherLocale } from "@/lib/i18n";
import { getPatientLocale } from "@/lib/session/server";
import type { FamilyGrantItems } from "@/lib/store/types";
import { careEntryStore, getPageUser } from "@/lib/subject/care";
import { nowMs } from "@/lib/time/now";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token: raw } = await params;
  const token = decodeURIComponent(raw);
  const [locale, me] = await Promise.all([getPatientLocale(), getPageUser()]);
  const found = await lookupInvite(careEntryStore(), token, me?.user.userId ?? null, nowMs());
  const langHref = `/api/profile/lang?to=${otherLocale(locale)}&next=${encodeURIComponent(`/invite/${raw}`)}`;
  if ((found.state === "yours_waiting" || found.state === "yours_active") && found.link) redirect(`/f?link=${encodeURIComponent(found.link.id)}`);
  const zh = locale === "zh-Hans";
  if (found.state === "self") {
    return (
      <div className="contents" data-testid="invite-page" data-state="self">
        <FamilyScreen locale={locale}>
          <FamilyTop brand locale={locale} langHref={langHref} />
          <FamilyHero tone="quiet" title={zh ? "这是你自己发出的邀请。" : "This is the invitation you sent."} detail={zh ? "把这个链接发给家人，让对方在自己的手机上打开。" : "Send this link to your family member to open on their own phone."} />
        </FamilyScreen>
      </div>
    );
  }
  // H3: expired, used, or not an invitation at all: one sentence, what to do, and (signed out) the login
  if (found.state !== "open" || !found.link) {
    const expired = found.state === "expired";
    const title = expired ? (zh ? "这个邀请过期了。" : "This invitation has expired.") : zh ? "这个邀请用不了了。" : "This invitation can't be used.";
    const body = expired
      ? zh
        ? "邀请 7 天内有效。请他在他的手机上重新发一个。"
        : "An invitation lasts 7 days. Ask him to send a new one from his phone."
      : zh
        ? "一个邀请只能用一次。请他在他的手机上重新发一个。"
        : "An invitation works only once. Ask him to send a new one from his phone.";
    return (
      <div className="contents" data-testid="invite-page" data-state={found.state}>
        <FamilyScreen locale={locale}>
          <FamilyTop brand locale={locale} langHref={langHref} />
          <InviteAccept state="used" locale={locale} inviter={dadWord(null, locale)} shares={[]} usedTitle={title} usedBody={body} loginHref={me ? undefined : loginUrl("/f")} />
        </FamilyScreen>
      </div>
    );
  }

  const dad = dadWord(found.link.patientLabel, locale);
  const consent = familyConsentText("family_accept", locale);
  // all six items, each with what exactly she would see of it (her-copy see_*: the invitation's own lines)
  const shares = (Object.keys(NO_GRANTS) as (keyof FamilyGrantItems)[]).map((k) => ({ title: grantName(k, locale, dad), detail: hc(locale, `see_${k}` as HerKey, { dad }), shared: false, grant: k }));
  return (
    <div className="contents" data-testid="invite-page" data-state="open">
      <FamilyScreen locale={locale}>
        <FamilyTop brand locale={locale} langHref={langHref} />
        <InviteScreen
          locale={locale}
          token={token}
          dad={dad}
          signedIn={!!me}
          shares={shares}
          notSeen={hc(locale, "notSeen", { dad })}
          consent={{ title: consent.title, paragraphs: [...consent.paragraphs] }}
          joinHref={`/invite/${raw}/join`}
        />
      </FamilyScreen>
    </div>
  );
}
