/**
 * /p/me/filming — 「拍摄账号」 on his own phone (C2 track J; journey 21; real-app 5.4 step 2; the elder brief's section 21;
 * laid out after the timeline draft's 21-2). Only a phone that carries the film crew's cookie sees it (anyone else gets
 * Next's 404, lib/crew/gate.ts), and only for his own account (the demo has no such page). Track C's 「我」 links here
 * for crew phones only.
 *
 *   not marked   why this phone sees the page, a plain box saying what a filming account is and what laying it out does
 *                to its records (they become the story's), the account's date and time and its code, and one button:
 *                「标成拍摄账号」
 *   marked       a ticked node 「这是拍摄账号。」 with what the director can do, the account's date and time now (the
 *                director may have moved it), its code on the director's desk, and 「结束拍摄」 (the real date again,
 *                unmarked) with one grey line under it saying so
 * The draft draws a 「拍摄模式」 switch here; the back end's step is marking the account (POST /api/crew/filming-account)
 * and ending filming (DELETE), each its own button, so the screen keeps the two buttons (web/progress/fe-me.md).
 */
import { notFound } from "next/navigation";
import { P } from "@/components/me/parts";
import { ActionDock, Box, ListCard, ListItem, PageHeader, Screen, Timeline, TimelineItem } from "@/components/ui";
import { filmingState } from "@/lib/crew/filming-account";
import { requireCrewPage } from "@/lib/crew/gate";
import { metaLine } from "@/lib/profile/dates";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";
import { FilmingActions } from "./FilmingActions";
import { filmingCopy } from "./copy";

export const dynamic = "force-dynamic";

export default async function FilmingAccountPage() {
  await requireCrewPage();
  const [ctx, locale] = await Promise.all([getPageSubject(), getPatientLocale()]);
  if (!ctx || ctx.subject.kind !== "account" || ctx.subject.relation !== "self") notFound();
  const c = filmingCopy(locale);
  const s = filmingState(ctx.session);
  const now = metaLine(ctx.session, locale);
  return (
    <Screen locale={locale}>
      <PageHeader back={{ href: "/p/me", label: c.back }} title={c.title} locale={locale} />
      <div className="rpu-stack" data-testid="filming-page" data-filming={s.filming ? "true" : "false"}>
        <P size="large">{c.crewOnly}</P>
        {s.filming ? (
          <Timeline>
            <TimelineItem node="ok" title={c.markedTitle} note={c.markedLede} />
          </Timeline>
        ) : (
          <Box variant="line" title={c.lede}>
            {c.records}
          </Box>
        )}
        <ListCard>
          <ListItem testId="filming-now" title={c.nowLabel} sub={s.filming && s.offsetMs ? c.movedNow(now) : now} attrs={{ "data-rp": "row" }} />
          <ListItem testId="filming-code" title={c.codeLabel} right={<span style={{ fontFamily: "var(--rp-font-mono)" }}>{s.ref}</span>} attrs={{ "data-rp": "row" }} />
        </ListCard>
      </div>
      <ActionDock>
        <FilmingActions locale={locale} filming={s.filming} />
      </ActionDock>
    </Screen>
  );
}
