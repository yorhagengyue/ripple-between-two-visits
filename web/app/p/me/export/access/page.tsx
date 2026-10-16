/**
 * /p/me/export/access — 「家人什么时候看过」 (journey 15 查看记录; the elder brief 16–20 item 4 「她什么时候看过：一条一条」;
 * real-app 3.11 「家属读：care_access_log，他看得到」; C2 track H; drawn as the timeline draft's 19-1). His access log,
 * newest first, as one line of nodes: each look is the family member's node (the ink ring) with who and when on its
 * head line and what she looked at as its title, in track D's words (lib/care/access-log.ts: the same who, what and
 * when as accessWords, 「Wei Ling 看了你的吃药情况，10月10日 晚上 7:40」, laid out on the node). The rows hold what she
 * looked at, never what was in it. Under the line, 「家人能看到什么」 (track D's /p/family) where he changes the switches.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { meScreenCopy } from "@/components/me/copy";
import { P } from "@/components/me/parts";
import { Box, PageHeader, Screen, SecondaryButton, Timeline, TimelineItem } from "@/components/ui";
import { accessItemWords, careAccessEntries } from "@/lib/care/access-log";
import { clockWords, shortDay } from "@/lib/daily/i18n";
import { asHLocale, hCopy } from "@/lib/privacy/copy";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";
import { localDate, localHHMM } from "@/lib/time/clock";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "家人什么时候看过 · Ripple" };

/** The newest this many (older ones stay in his export). */
const SHOWN = 50;

export default async function AccessLogPage() {
  const [ctx, uiLocale] = await Promise.all([getPageSubject(), getPatientLocale()]);
  if (!ctx) return null;
  if (ctx.subject.kind !== "account" || ctx.subject.relation !== "self") notFound();
  const locale = asHLocale(uiLocale);
  const c = hCopy(locale);
  const t = meScreenCopy(locale);
  const tz = ctx.session.tz;
  const entries = await careAccessEntries(ctx.store, ctx.session, { limit: SHOWN });
  return (
    <Screen locale={locale} className="rpm-screen">
      <PageHeader back={{ href: "/p/me/export", label: c.myData }} title={c.accessTitle} locale={locale} />
      <div className="rpu-stack" data-testid="page-access">
        {entries.length === 0 ? (
          <Box variant="dash" title={c.accessEmpty} />
        ) : (
          <Timeline>
            {entries.map((e) => {
              const ms = Date.parse(e.at);
              return (
                <TimelineItem
                  key={e.id}
                  node="dau"
                  who={e.who?.trim() || t.familyFallback}
                  meta={`${shortDay(locale, localDate(ms, tz))} ${clockWords(locale, localHHMM(ms, tz))}`}
                  title={t.looked(accessItemWords(e.items, locale))}
                  testId="access-row"
                  attrs={{ "data-link": e.linkId ?? "" }}
                />
              );
            })}
          </Timeline>
        )}
        <P quiet>{c.accessLede}</P>
        <SecondaryButton href="/p/family">{c.accessSwitches}</SecondaryButton>
      </div>
    </Screen>
  );
}
