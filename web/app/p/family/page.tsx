/**
 * /p/family — 「家人」: who can see something of his, and 「邀请家人」 (the demo: 「家人能看到什么」 / "What my family can see").
 *
 * Demo (task M6 item 2), as before: Mr Tan's switches for Wei Ling's view, one per item, changeable any time. Defaults
 * come from the seed's family_grants. His only: Wei Ling's phone (family role) is sent to /f before anything is read
 * (lib/family/role.ts sendFamilyToF).
 *
 * His real account (C2 track D; the elder brief 16-20, real-app 2.19-2.22), one thing per screen, laid out as the
 * timeline draft's 16-20 (front-end line fe-fam; components/his-family):
 *   someone accepted his invitation   only that, the draft's 18-1: the header 「是她吗？」, 「Wei Ling 接受了邀请，是她吗？」
 *                                     as one entry with the daughter's node, her name and account under it, a grey
 *                                     box, 「不是」 / 「是她」 side by side (she sees nothing until he says yes)
 *   otherwise                         each family member (or invitation) on one row of a white card with its state,
 *                                     opening its own page (/p/family/[id]: the six switches, and from there when she
 *                                     looked and how to stop); the ones that ended in a second card; 「邀请家人」 in the
 *                                     lower part; with nobody yet, one sentence, what an invitation means, that button
 * No tab bar and no say bar: the draft's family screens have neither (they hang under 「我」; the way back is the header's).
 * Live: a link changing (she accepts, she leaves) re-reads the page (CareLive).
 *
 * Line bind: a link a family member bound by typing his account, which he has not answered yet (lib/care/ack.ts), comes
 * first in the list and says so on its row in the place of its state; her page then has the card with 「知道了」 and
 * 「不认识这个人，解除」.
 */
import { notFound } from "next/navigation";
import { CareLive } from "@/components/family/HisFamily";
import { GrantSwitches } from "@/components/family/GrantSwitches";
import { ConfirmCard } from "@/components/his-family/ConfirmCard";
import { HisScreen, Lead } from "@/components/his-family/pieces";
import { ActionDock, BodyText, ListCard, ListItem, PrimaryButton } from "@/components/ui";
import { linkStateWords, whoWords } from "@/lib/care/copy";
// line bind (only add): which of his links a family member bound herself and he has not answered
import { unacknowledgedLinks } from "@/lib/care/ack";
import { bc } from "@/lib/care/bind-copy";
import { pc } from "@/lib/care/his-copy";
import { helpedName, patientLinks } from "@/lib/care/links";
import type { PatientLinkView } from "@/lib/care/types";
import { readGrants } from "@/lib/family/grants";
import { ft } from "@/lib/family/i18n";
import { sendFamilyToF } from "@/lib/family/role";
import type { Locale } from "@/lib/i18n";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";
import { careEntryStore } from "@/lib/subject/care";
import { nowMs } from "@/lib/time/now";

export const dynamic = "force-dynamic";

/** How a link that ended is said on its row: an invitation he took back before anyone accepted is not 「已停止分享」. */
function endedWords(l: PatientLinkView, locale: Locale): string {
  return l.state === "revoked" && !l.confirmedAt ? pc(locale, "cancelled") : linkStateWords(l.state, locale);
}

export default async function FamilyGrantsPage() {
  const [ctx, locale] = await Promise.all([getPageSubject(), getPatientLocale()]);
  if (!ctx) return null;
  const store = ctx.store;
  if (ctx.subject.kind === "demo") {
    await sendFamilyToF(ctx, store);
    const grants = await readGrants(store, ctx.session);
    return (
      <div className="flex flex-col gap-4" data-testid="page-family-grants">
        <h1 className="text-[28px] font-bold">{ft(locale, "g.title")}</h1>
        <p className="text-body text-ink-2">{ft(locale, "g.lead")}</p>
        <GrantSwitches key={ctx.client.id} locale={locale} initial={grants.items} />
      </div>
    );
  }
  if (ctx.subject.relation !== "self" || !ctx.subject.userId) notFound();
  const links = await patientLinks(store, careEntryStore(), ctx.session, ctx.subject.userId, nowMs());
  const back = { href: "/p/me", label: locale === "zh-Hans" ? "我" : "Me" };
  const waiting = links.find((l) => l.state === "accepted");

  if (waiting) {
    // someone is helping him on this phone: the tap that lets her in is his own (real-app 3.11)
    const helped = await helpedName(store, ctx.subject.userId);
    return (
      <HisScreen locale={locale} back={back} title={pc(locale, "confirmTitle")} testId="page-family" state="confirm" attrs={{ "data-link": waiting.id }}>
        <CareLive />
        <ConfirmCard locale={locale} link={waiting} helped={helped} />
      </HisScreen>
    );
  }

  // line bind: links he has not answered first, each saying so on its row
  const unanswered = new Set((await unacknowledgedLinks(store, ctx.subject.userId, links)).map((l) => l.id));
  const shown = links.filter((l) => l.state === "active" || l.state === "invited").sort((a, b) => Number(unanswered.has(b.id)) - Number(unanswered.has(a.id)));
  const ended = links.filter((l) => l.state !== "active" && l.state !== "invited").slice(0, 3);
  const href = (l: PatientLinkView) => `/p/family/${encodeURIComponent(l.id)}`;
  return (
    <HisScreen locale={locale} back={back} title={pc(locale, "familyTitle")} testId="page-family" state={shown.length ? "list" : "none"}>
      <CareLive />
      <div className="rpu-stack">
        {shown.length > 0 ? (
          <>
            <BodyText variant="lede">{pc(locale, "lead")}</BodyText>
            <ListCard testId="family-list">
              {shown.map((l) => (
                <ListItem
                  key={l.id}
                  // the daughter's node for someone he confirmed; the dashed ring for an invitation nobody accepted yet
                  mark={l.state === "active" ? "dau" : "miss"}
                  title={whoWords(l.familyLabel, l.relation, locale)}
                  sub={unanswered.has(l.id) ? bc(locale, "boundState") : linkStateWords(l.state, locale)}
                  chevron
                  href={href(l)}
                  attrs={{ "data-link": l.id, "data-state": l.state, "data-ack": unanswered.has(l.id) ? "no" : undefined }}
                />
              ))}
            </ListCard>
          </>
        ) : (
          <>
            <Lead>{pc(locale, "none")}</Lead>
            <BodyText variant="lede">{pc(locale, "noneBody")}</BodyText>
          </>
        )}
        {ended.length > 0 && (
          <ListCard heading={pc(locale, "endedTitle")} testId="family-ended">
            {ended.map((l) => (
              <ListItem key={l.id} title={whoWords(l.familyLabel, l.relation, locale)} sub={endedWords(l, locale)} chevron href={href(l)} attrs={{ "data-link": l.id, "data-state": l.state }} />
            ))}
          </ListCard>
        )}
      </div>
      <ActionDock>
        <PrimaryButton href="/p/family/invite" nav="forward" data-testid="family-invite">
          {pc(locale, "invite")}
        </PrimaryButton>
      </ActionDock>
    </HisScreen>
  );
}
