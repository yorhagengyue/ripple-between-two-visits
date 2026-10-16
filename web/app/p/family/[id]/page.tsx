/**
 * /p/family/[id] — one family member, his side (C2 track D; the elder brief 16-20 items 1, 4, 5; real-app 2.19-2.22),
 * laid out as the timeline draft's 16-1 and 20-2 (front-end line fe-fam; components/his-family):
 *   active     16-1: 「家人能看到什么」 with 「女儿 Wei Ling · 已确认」 under it; the six switches in one card, each saying exactly
 *              what she will see, changed at once (her screen follows within a second); the line about her phone
 *              having no notifications yet (track I, only while that switch is on); 「她什么时候看过 ›」 to the list of
 *              her looks and of the switches' changes (./seen, the draft's 19-1), with her latest look under it; the
 *              way to 「忘记密码时，让 Wei Ling 帮我」 (track A; the switch itself is on 「我」's own page); 「停止分享给
 *              Wei Ling」 to the screen that stops it (./stop, the draft's 20-1)
 *   invited    the invitation as a line of three steps, when it stops working, and 「取消这个邀请」
 *   accepted   she waits for his 「是她」: that is asked on 「家人」 (and on Today), so this address leads there
 *   ended      20-2: one entry that says what happened (stopped, an invitation he took back, she left, expired, not
 *              her) and 「重新邀请」 under it. There is no undo bar: stopping is for good (web/progress/d.md).
 * His own links only (404 otherwise).
 *
 * Line bind: an active link a family member bound by typing his account, which he has not answered yet
 * (lib/care/ack.ts), opens with the card of Today above the switches: who bound it and when, what she can see now, and
 * 「知道了」 / 「不认识这个人，解除」 (components/his-family/BoundCard). The line under the title says 「绑定了你的账号，
 * 等你看一下」 in the place of 「已确认」. Changing a switch is an answer too (its record names the link), so the
 * switches work as on any link.
 * Round two: once he has removed such a person without ever answering, her page says 「这个人自己绑定了你的账号，你已经
 * 解除。」 and has nothing to tap but the way back: no 「重新邀请」 for someone he does not know.
 * The family texts asked again (owner 10-14; lib/care/reconsent.ts): an active link whose family text in force he has
 * not agreed to opens with 「Wei Ling 能看到的内容更新了」, the text, 「同意」 / 「先不」 (components/his-family/ReconsentCard),
 * unless he closed it on this phone today. Her view stays the alert-only form until both of them have agreed.
 */
import { redirect } from "next/navigation";
import { CancelInvite, CareLive, LinkSwitches } from "@/components/family/HisFamily";
import { HisScreen, InviteSteps, Lead } from "@/components/his-family/pieces";
import { ActionDock, BodyText, Button, ButtonNote, Chevron, ListCard, ListItem, SecondaryButton, Timeline, TimelineItem } from "@/components/ui";
import { careAccessEntries } from "@/lib/care/access-log";
import { linkStateWords } from "@/lib/care/copy";
import { pc } from "@/lib/care/his-copy";
import type { NodeKind } from "@/lib/ui/tokens";
// C2 track I (only add; real-app 3.10): his no-reply switch is on but her phone has no notifications yet
import { HerPushLine } from "@/components/push/HerPushLine";
// C2 track A (only add): the way from 「我 → 家人」 to 「忘记密码时，让家人帮我」 (real-app 2.4)
import { accountCopy } from "@/lib/auth/copy";
import { hisLink } from "./his-link";
// line bind (only add): the card of a link a family member bound herself, until he has answered
import { BoundCard } from "@/components/his-family/BoundCard";
import { linkAcknowledged, unacknowledgedLinks } from "@/lib/care/ack";
import { bc } from "@/lib/care/bind-copy";
import { helpedName } from "@/lib/care/links";
import { scopeD0, scopeTz } from "@/lib/store/scope";
// the family texts asked again (owner 10-14, only add): 「Wei Ling 能看到的内容更新了」 above the switches
import { cookies } from "next/headers";
import { ReconsentCard } from "@/components/his-family/ReconsentCard";
import { familyConsentText } from "@/lib/care/consent";
import { linkWaitingForHim } from "@/lib/care/reconsent";
import { closedToday, RECONSENT_LATER_COOKIE } from "@/lib/care/reconsent-later";
import { storyDate } from "@/lib/story/clock";
import { bindEntryStore } from "@/lib/subject/bind";

export const dynamic = "force-dynamic";

export default async function FamilyLinkPage({ params }: PageProps<"/p/family/[id]">) {
  const { id: raw } = await params;
  const { ctx, locale, link, id, href, name, who, backToList, when, day } = await hisLink(raw);
  // her acceptance waits for his answer: one place asks it (「家人」, and Today)
  if (link.state === "accepted") redirect("/p/family");

  if (link.state === "active") {
    const [latest] = await careAccessEntries(ctx.store, ctx.session, { linkId: id, limit: 1 });
    const help = accountCopy(locale);
    // line bind: she bound this link herself and he has not answered yet
    const self = ctx.subject.userId ?? "";
    const unanswered = (await unacknowledgedLinks(ctx.store, self, [link])).length > 0;
    const helped = unanswered ? await helpedName(ctx.store, self) : null;
    // the family texts asked again (owner 10-14, only add): he has not agreed to the family text in force for her link
    // (lib/care/reconsent.ts); its card stands at the top, unless he closed it on this phone today (「先不」)
    const todayDate = storyDate(scopeD0(ctx.session), ctx.session.story_day);
    const later = closedToday((await cookies()).get(RECONSENT_LATER_COOKIE)?.value, todayDate);
    const renew = !unanswered && !later ? await linkWaitingForHim(ctx.store, bindEntryStore(), self, [link]) : null;
    const renewHelped = renew ? await helpedName(ctx.store, self) : null;
    return (
      <HisScreen
        locale={locale}
        back={backToList}
        title={pc(locale, "title")}
        subtitle={`${who} · ${unanswered ? bc(locale, "boundState") : linkStateWords("active", locale)}`}
        testId="page-family-link"
        state="active"
        attrs={{ "data-version": link.version, "data-ack": unanswered ? "no" : undefined }}
      >
        <CareLive />
        <div className="rpu-stack">
          {renew && <ReconsentCard locale={locale} link={renew} paragraphs={familyConsentText("family_share", locale).paragraphs} helped={renewHelped} date={todayDate} dock={false} testId="link-reconsent" />}
          {unanswered && <BoundCard locale={locale} link={link} helped={helped} tz={scopeTz(ctx.session)} dock={false} testId="link-bound" />}
          {/* 「Wei Ling 现在能看到 N 项。」 first, then the sentence about the switches, then the switches: LinkSwitches draws all three (the number follows his taps) */}
          <LinkSwitches key={`${id}-${link.version}`} linkId={id} locale={locale} initial={link.items} name={name} lead={<BodyText variant="lede">{pc(locale, "switchesLead")}</BodyText>} />
          {/* C2 track I (only add) */}
          <HerPushLine linkId={id} name={name} locale={locale} on={link.items.no_reply_alert} />
          <div>
            <Button variant="link" href={`${href}/seen`} nav="forward" data-testid="link-seen">
              {pc(locale, "accessTitle")}
              <Chevron />
            </Button>
            <ButtonNote>
              <span data-testid="last-look">
                {latest ? pc(locale, "lastLook", { name, when: when(latest.at) }) : pc(locale, "accessNone")}
              </span>
            </ButtonNote>
          </div>
          {/* C2 track A (only add): his switch 「忘记密码时，让 Wei Ling 帮我」 lives on its own page (off until he turns it on) */}
          <ListCard>
            <ListItem title={help.helpSwitch(name)} sub={help.helpEntryStatus} chevron href="/p/me/reset-help" testId="link-reset-help" />
          </ListCard>
          <Button variant="danger-outline" href={`${href}/stop`} nav="forward" data-testid="link-stop">
            {pc(locale, "stop", { name })}
          </Button>
        </div>
      </HisScreen>
    );
  }

  if (link.state === "invited") {
    return (
      <HisScreen locale={locale} back={backToList} title={who} testId="page-family-link" state="invited">
        <CareLive />
        <div className="rpu-stack">
          <Lead>{pc(locale, "waitingBody")}</Lead>
          <InviteSteps locale={locale} state="invited" sent={day(link.invitedAt)} until={day(link.expiresAt)} />
          <BodyText variant="lede">{pc(locale, "waitingOnce")}</BodyText>
        </div>
        <ActionDock>
          <CancelInvite linkId={id} locale={locale} />
        </ActionDock>
      </HisScreen>
    );
  }

  // what happened, as one entry: whose doing it was is the node (his own: the tick or his dot; hers: the daughter's ring)
  const cancelled = link.state === "revoked" && !link.confirmedAt;
  // line bind (round two): someone who bound his account herself and whom he removed without ever answering (no
  // 「知道了」, no switch changed) is a stranger to him. The entry says so, and nothing offers to invite that person.
  const stranger = link.state === "revoked" && !cancelled && !(await linkAcknowledged(ctx.store, { id, patient_id: ctx.subject.userId ?? "" }));
  const ended: { node: NodeKind; who?: string; title: string; note?: string } = stranger
    ? { node: "ok", title: bc(locale, "strangerRemoved") }
    : link.state === "revoked"
      ? cancelled
        ? { node: "ok", title: pc(locale, "cancelled") }
        : { node: "ok", title: pc(locale, "stopped"), note: pc(locale, "stoppedBody", { name }) }
      : link.state === "left"
        ? { node: "dau", who: name, title: linkStateWords("left", locale), note: pc(locale, "leftBody", { name }) }
        : link.state === "expired"
          ? { node: "miss", title: linkStateWords("expired", locale), note: pc(locale, "expiredBody") }
          : { node: "me", title: linkStateWords("declined", locale), note: pc(locale, "declinedBody") };
  return (
    <HisScreen locale={locale} back={backToList} title={who} testId="page-family-link" state={link.state} attrs={{ "data-cancelled": cancelled ? "true" : undefined, "data-stranger": stranger ? "true" : undefined }}>
      <CareLive />
      <div className="rpu-stack">
        <Timeline>
          <TimelineItem node={ended.node} who={ended.who} meta={link.endedAt ? when(link.endedAt) : undefined} title={ended.title} note={ended.note} testId="link-ended" />
        </Timeline>
        {/* under the entry, starting where its words start (the draft's 20-2); never for a stranger he removed */}
        {!stranger && (
          <div className="rpu-ind">
            <SecondaryButton href="/p/family/invite" nav="forward" data-testid="invite-again">
              {pc(locale, "inviteAgain", { name })}
            </SecondaryButton>
          </div>
        )}
      </div>
    </HisScreen>
  );
}
