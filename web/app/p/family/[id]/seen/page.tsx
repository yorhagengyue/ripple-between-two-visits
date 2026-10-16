/**
 * /p/family/[id]/seen — 「她什么时候看过」 (the timeline draft's 19-1; real-app 2.21 「她每看一次，留一条访问记录」, 2.22
 * 「每次变化都留历史，带时间和版本」; front-end line fe-fam). Reached from her page (/p/family/[id]) by 「她什么时候看过 ›」.
 *
 *   her looks       one entry each with the daughter's node, newest first: her name, when (「今天 8:20」), and what she
 *                   looked at (「看了你的吃药情况」): the items, never what was in them (lib/care/access-log.ts)
 *   the switches    the draft did not draw them; real-app 2.22 keeps them: one entry per change with his own node,
 *                   newest first (「打开了「每天吃药了没有」」), down to the first version, when everything was off
 *                   (line bind: a link bound by account starts with four items on, and its first version says which)
 * Only for a link that is in force: for any other state this address leads back to her page. His own links only.
 */
import { redirect } from "next/navigation";
import { CareLive } from "@/components/family/HisFamily";
import { HisScreen, Lead } from "@/components/his-family/pieces";
import { BodyText, SectionTitle, Timeline, TimelineItem } from "@/components/ui";
import { accessItemWords, careAccessEntries } from "@/lib/care/access-log";
import { switchTitle } from "@/lib/care/copy";
import { pc } from "@/lib/care/his-copy";
import { grantHistory } from "@/lib/care/links";
import { hisLink } from "../his-link";
// line bind (only add): the words for the first version of a link that was bound by account
import { bc } from "@/lib/care/bind-copy";
import { NO_GRANTS } from "@/lib/family/types";
import type { FamilyGrantItems } from "@/lib/store/types";

export const dynamic = "force-dynamic";

/** How many of each the screen lists (the rest stays in his export: track H's 查看记录). */
const LOOKS = 30;
const CHANGES = 20;

export default async function FamilySeenPage({ params }: PageProps<"/p/family/[id]/seen">) {
  const { id: raw } = await params;
  const { ctx, locale, link, id, href, name, backToLink, when } = await hisLink(raw);
  if (link.state !== "active") redirect(href);
  const [access, history] = await Promise.all([careAccessEntries(ctx.store, ctx.session, { linkId: id, limit: LOOKS }), grantHistory(ctx.store, id)]);
  const changes = [...history].reverse().slice(0, CHANGES);
  return (
    <HisScreen locale={locale} back={backToLink} title={pc(locale, "accessTitle")} testId="page-family-seen" state={access.length ? "list" : "none"} attrs={{ "data-link": id }}>
      <CareLive />
      <div className="rpu-stack">
        {access.length > 0 ? (
          <div data-testid="access-log">
            <Timeline>
              {access.map((e) => (
                <TimelineItem key={e.id} node="dau" who={e.who?.trim() || name} meta={when(e.at)} title={pc(locale, "lookedAt", { what: accessItemWords(e.items, locale) })} />
              ))}
            </Timeline>
          </div>
        ) : (
          <Lead>{pc(locale, "accessNone")}</Lead>
        )}
        <BodyText variant="lede">{pc(locale, "accessNote")}</BodyText>
        <SectionTitle>{pc(locale, "historyTitle")}</SectionTitle>
        <div data-testid="grant-history">
          <Timeline>
            {changes.map((h) => {
              // his own names for the switches, as on the card he changes them on (「两次提醒没回时通知她」, 「我自己写的笔记」)
              const lines = [...h.turnedOn.map((k) => pc(locale, "historyOn", { what: switchTitle(k, locale) })), ...h.turnedOff.map((k) => pc(locale, "historyOff", { what: switchTitle(k, locale) }))];
              // line bind: a link bound by account starts with items on; an invited one with everything off
              const startedOn = h.version === 1 ? (Object.keys(NO_GRANTS) as (keyof FamilyGrantItems)[]).filter((k) => h.items[k]) : [];
              return h.version === 1 ? (
                <TimelineItem key={h.version} node="dot" meta={when(h.at)} title={startedOn.length ? [bc(locale, "historyBound"), ...startedOn.map((k) => switchTitle(k, locale))].join("\n") : pc(locale, "historyFirst")} />
              ) : (
                <TimelineItem key={h.version} node="me" who={pc(locale, "historyYou")} meta={when(h.at)} title={lines.length ? lines.join("\n") : pc(locale, "versionLine", { v: h.version })} />
              );
            })}
          </Timeline>
        </div>
      </div>
    </HisScreen>
  );
}
