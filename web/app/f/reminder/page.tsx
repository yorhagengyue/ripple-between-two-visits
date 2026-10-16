/**
 * /f/reminder?link= — her reminder for Dad (C2 track D; the v3 draft's E1 to E4, E6, I5): 「录一句话，每天 8:45 放给爸爸听。」,
 * what plays now, record, listen back, record again, delete, 「就用这段」. Her earlier recordings have their own screen
 * (/f/reminder/mine, E5). Through her active link (else back to /f). components/family/ReminderStudio.tsx does the
 * recording and the upload, and draws the top bar, which follows its state.
 *
 * Line bind: a link she bound herself by typing his account, which he has not acknowledged yet (lib/care/ack.ts), has no
 * recorder here: the screen says 「等他在自己的手机上点了「知道了」，你就可以给他录提醒。」 and reads nothing of his
 * reminders (components/family/ReminderLocked.tsx; it looks again every few seconds).
 */
import { DayClock } from "@/components/daily/elder/DayClock";
import { HerLive } from "@/components/family/HerLive";
import { ReminderLocked } from "@/components/family/ReminderLocked";
import { ReminderStudio } from "@/components/family/ReminderStudio";
import { FamilyScreen } from "@/components/family-ui";
import { logLook } from "@/lib/care/access-log";
import { linkAcknowledged } from "@/lib/care/ack";
import { herDayClock, herPage, herSwitches } from "@/lib/care/her-page";
import { herReminders } from "@/lib/care/reminders";
import { scopeSlotSchedule } from "@/lib/daily/cells";
import { bindEntryStore } from "@/lib/subject/bind";
import { nowMs } from "@/lib/time/now";

export const dynamic = "force-dynamic";

export default async function FamilyReminderPage({ searchParams }: PageProps<"/f/reminder">) {
  const p = await herPage(await searchParams, "/f/reminder");
  const { ctx, link } = p;
  const now = nowMs();
  // line bind: he has not answered a link she bound herself, so nothing she records may reach his phone yet
  if (!(await linkAcknowledged(bindEntryStore(), link))) {
    const switches = await herSwitches(ctx.store, ctx.session, link.id);
    return (
      <HerLive linkId={link.id} since={ctx.since} version={switches.version} locale={p.locale} dad={p.dad} langHref={p.langHref}>
        <DayClock {...herDayClock(ctx.session, now)} />
        <div className="contents" data-testid="family-reminder" data-state="locked">
          <FamilyScreen locale={p.locale}>
            <ReminderLocked locale={p.locale} dad={p.dad} homeHref={p.paths.home} langHref={p.langHref} />
          </FamilyScreen>
        </div>
      </HerLive>
    );
  }
  const first = scopeSlotSchedule(ctx.session, "morning").first;
  const [reminders, switches] = await Promise.all([herReminders(ctx.store, ctx.session, link.id, p.userId, first), herSwitches(ctx.store, ctx.session, link.id)]);
  await logLook(ctx.store, ctx.session.id, { linkId: link.id, userId: p.userId, label: link.family_label, route: "/f/reminder", items: ["reminder"] }, now);
  // her own recordings, nothing of his switches: live for the end of her link only (her next upload would be refused)
  return (
    <HerLive linkId={link.id} since={ctx.since} version={switches.version} locale={p.locale} dad={p.dad} langHref={p.langHref}>
    <DayClock {...herDayClock(ctx.session, now)} />
    <div className="contents" data-testid="family-reminder">
      <FamilyScreen locale={p.locale}>
        <ReminderStudio locale={p.locale} linkId={link.id} playsAt={first} tz={p.tz} initial={reminders} homeHref={p.paths.home} mineHref={p.paths.mine} herLabel={link.family_label} dad={p.dad} langHref={p.langHref} />
      </FamilyScreen>
    </div>
    </HerLive>
  );
}
