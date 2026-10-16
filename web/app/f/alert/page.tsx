/**
 * /f/alert?link= — 「留意」 of her bottom bar (C2 track D; owner 10-14: only what needs attention, each with a follow-up).
 * What is open first: while two reminders stand unanswered today, what happened this morning, his last entry she may
 * know of and the one amber 「打电话给爸爸」 (the daughter brief D2, D4), from her home's data (lib/care/home.ts; only
 * while his no-reply switch for her link is on). Then what needs her attention in his last 14 days, each item with its
 * follow-up, and one line for everything routine (lib/care/record.ts herRecord). Both are built from the switches read
 * here, side by side with whether he has acknowledged her link (lib/care/ack.ts: both ask it, so it is read once);
 * components/family/AlertScreen.tsx keeps the screen live.
 * Her look is logged with the switches whose records were read for it (lib/care/access-log.ts), as on her other pages.
 * Owner 10-16: before all of it, what he told Ripple that may need attention (Ripple answered his own message on the
 * emergency route): his words, when, Ripple's answer, the way to open the conversation (lib/care/told.ts). The baseline:
 * sent and shown whatever his switches say.
 */
import { DayClock } from "@/components/daily/elder/DayClock";
import { AlertScreen } from "@/components/family/AlertScreen";
import { logLook } from "@/lib/care/access-log";
import { linkAcknowledged } from "@/lib/care/ack";
import { herDayClock, herPage, herSwitches } from "@/lib/care/her-page";
import { familyHome, shownSections } from "@/lib/care/home";
import { herRecord } from "@/lib/care/record";
// owner 10-16 (only add): what he told Ripple that may need attention, sent to her link whatever his switches
import { toldNotices } from "@/lib/care/told";
import { bindEntryStore } from "@/lib/subject/bind";
import { nowMs } from "@/lib/time/now";

export const dynamic = "force-dynamic";

export default async function FamilyAlertPage({ searchParams }: PageProps<"/f/alert">) {
  const p = await herPage(await searchParams, "/f/alert");
  const { ctx, link } = p;
  const now = nowMs();
  const [{ items: grants, version }, acknowledged] = await Promise.all([herSwitches(ctx.store, ctx.session, link.id), linkAcknowledged(bindEntryStore(), link)]);
  const [home, record, told] = await Promise.all([
    // the copy says when her link waits for the family text in force (her store cut the switches: lib/care/reconsent.ts)
    familyHome(ctx.store, ctx.session, { link, grants, version, acknowledged, consent: ctx.subject.consent }, now),
    herRecord(ctx.store, ctx.session, { link, userId: p.userId, grants, version, locale: p.locale, acknowledged }, now),
    // the baseline: read under no switch (lib/care/told.ts); a read that fails leaves the rest of the page as it was
    toldNotices(ctx.store, ctx.session, link.id).catch(() => []),
  ]);
  // one row for the look: every switch something of his was shown under, in the open block or in the record
  const items = [...new Set<string>([...shownSections(home), ...record.shown])];
  await logLook(ctx.store, ctx.session.id, { linkId: link.id, userId: p.userId, label: link.family_label, route: "/f/alert", items }, now);
  // keyed by his date: at his midnight the day clock reads the page again and the screen starts over on the new day
  return (
    <>
      <DayClock {...herDayClock(ctx.session, now)} />
      <AlertScreen key={`${link.id}|${home.today}`} locale={p.locale} linkId={link.id} since={ctx.since} tz={p.tz} initial={home} record={record} langHref={p.langHref} dad={p.dad} told={told} />
    </>
  );
}
