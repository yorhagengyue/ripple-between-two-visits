/**
 * /p/me/example — the example account's own page (real-app 4.7; journey 22; track C; laid out after the timeline
 * draft's 22-3): what the example is (Mr Tan, a made-up person; six weeks laid out on today's dates), its dates, and the
 * two buttons, each with one grey line under it saying what it does. An account on his own data just says so. The demo
 * has no such page (404).
 *
 *   (no query)   from 「我 › 示例资料」 and from the line under the other screens' headers (「示例资料：陈先生（虚构人物）」;
 *                this page itself does not draw that line): where the data comes from, both buttons
 *   ?do=reseed   that one thing, what it does, its button and 「不动它」
 *   ?do=clear    the same for clearing
 * Neither can be undone on the server (the rows are replaced), so there is no undo bar (the draft's note): the grey line
 * under each button says what goes, and the one button does it. No dialog asks. 「我」 has one row to this page now
 * (owner's tidy of 10-13), so no row leads to the two ?do= screens any more; they still answer a direct address.
 */
import { notFound } from "next/navigation";
import { P } from "@/components/me/parts";
import { Box, ListCard, ListItem, PageHeader, Screen } from "@/components/ui";
import { exampleCopy } from "@/lib/profile/copy";
import { dayLabel, shortDate } from "@/lib/profile/dates";
import { getPatientLocale } from "@/lib/session/server";
import { storyDate } from "@/lib/story/clock";
import { getPageSubject } from "@/lib/subject";
import { ExampleActions } from "./ExampleActions";

export const dynamic = "force-dynamic";

/** A row of a card keeps the hook the first build's rows had (data-rp="row"). */
const ROW = { "data-rp": "row" } as const;

export default async function ExamplePage({ searchParams }: PageProps<"/p/me/example">) {
  const [ctx, locale, sp] = await Promise.all([getPageSubject(), getPatientLocale(), searchParams]);
  const only = sp.do === "reseed" || sp.do === "clear" ? sp.do : null;
  if (!ctx) return null;
  if (ctx.subject.kind !== "account") notFound();
  const c = exampleCopy(locale);
  const s = ctx.session;
  const back = { href: "/p/me", label: locale === "zh-Hans" ? "我" : "Me" };
  if (!s.example_data || !s.d0) {
    return (
      <Screen locale={locale} className="rpm-screen">
        <PageHeader back={back} title={c.pageTitle.join(" ")} locale={locale} />
        <Box variant="grey" title={c.notExample.join(" ")} />
      </Screen>
    );
  }
  if (only) {
    // one thing on the screen: what goes, and at the foot the button that does it
    return (
      <Screen locale={locale} fill="viewport">
        <PageHeader back={back} title={only === "reseed" ? c.reseed : c.clear} locale={locale} />
        <ExampleActions locale={locale} only={only} />
      </Screen>
    );
  }
  const visit = (await ctx.store.listVisits(s.id)).find((v) => v.status === "planned");
  return (
    <Screen locale={locale} className="rpm-screen">
      <PageHeader back={back} title={c.pageTitle.join(" ")} locale={locale} />
      <div className="rpu-stack">
        <P size="large">{c.pageLede}</P>
        <ListCard>
          <ListItem title={c.rowsFrom} right={dayLabel(s.d0, locale)} attrs={ROW} />
          <ListItem title={c.rowsToday} right={dayLabel(storyDate(s.d0, s.story_day), locale)} attrs={ROW} />
          {/* words like the two lines above, not a way to the visit: the tab bar has that (owner's tidy of 10-13) */}
          {visit && <ListItem title={c.rowsVisit} right={shortDate(visit.date, locale)} attrs={ROW} />}
        </ListCard>
        <ExampleActions locale={locale} only={null} />
      </div>
    </Screen>
  );
}
