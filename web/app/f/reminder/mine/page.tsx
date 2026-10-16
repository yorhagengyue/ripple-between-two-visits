/**
 * /f/reminder/mine?link= — 「我录过的」 (the fe-d track; the v3 draft's E5): her own recordings, which one his phone
 * plays now, putting another one back, deleting one. Through her active link (else back to /f).
 * components/family/HerRecordings.tsx does the rest. Her own recordings, nothing of his switches: live for the end of
 * her link only, like the recorder itself.
 */
import { redirect } from "next/navigation";
import { DayClock } from "@/components/daily/elder/DayClock";
import { HerLive } from "@/components/family/HerLive";
import { HerRecordings } from "@/components/family/HerRecordings";
// line bind (only add)
import { linkAcknowledged } from "@/lib/care/ack";
import { bindEntryStore } from "@/lib/subject/bind";
import { FamilyScreen, FamilyTop } from "@/components/family-ui";
import { logLook } from "@/lib/care/access-log";
import { hc } from "@/lib/care/her-copy";
import { herDayClock, herPage, herSwitches } from "@/lib/care/her-page";
import { herReminders } from "@/lib/care/reminders";
import { scopeSlotSchedule } from "@/lib/daily/cells";
import { nowMs } from "@/lib/time/now";

export const dynamic = "force-dynamic";

export default async function FamilyRecordingsPage({ searchParams }: PageProps<"/f/reminder/mine">) {
  const p = await herPage(await searchParams, "/f/reminder/mine");
  const { ctx, link } = p;
  // line bind (only add): a link she bound herself and he has not acknowledged puts no recording back on his phone
  // (lib/care/ack.ts); the recorder's own screen says what she is waiting for
  if (!(await linkAcknowledged(bindEntryStore(), link))) redirect(p.paths.reminder);
  const first = scopeSlotSchedule(ctx.session, "morning").first;
  const now = nowMs();
  const [reminders, switches] = await Promise.all([herReminders(ctx.store, ctx.session, link.id, p.userId, first), herSwitches(ctx.store, ctx.session, link.id)]);
  // the same look as the recorder's screen: her reminder
  await logLook(ctx.store, ctx.session.id, { linkId: link.id, userId: p.userId, label: link.family_label, route: "/f/reminder", items: ["reminder"] }, now);
  return (
    <HerLive linkId={link.id} since={ctx.since} version={switches.version} locale={p.locale} dad={p.dad} langHref={p.langHref}>
      <DayClock {...herDayClock(ctx.session, now)} />
      <div className="contents" data-testid="family-reminder-mine">
        <FamilyScreen locale={p.locale}>
          <FamilyTop back={{ href: p.paths.reminder, label: hc(p.locale, "mineBack") }} locale={p.locale} langHref={p.langHref} />
          <HerRecordings locale={p.locale} linkId={link.id} playsAt={first} tz={p.tz} initial={reminders} herLabel={link.family_label} dad={p.dad} />
        </FamilyScreen>
      </div>
    </HerLive>
  );
}
