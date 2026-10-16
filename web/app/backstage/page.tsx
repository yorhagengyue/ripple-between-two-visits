/**
 * /backstage — the desktop view recorded next to the phones (task M8 item 1): every step as it happens, one plain
 * sentence per event with its raw data one tap away; the safety layer's blocks (which layer, why), who-said-it
 * changes and scripted fallback stand out. Light background, text at least 18px, and new events never pull the
 * list away from a reader who scrolled up.
 * The crew's only (lib/crew/gate.ts): anyone else gets Next's 404. Judges see the same feed next to the phone on /demo.
 */
import { EventFeed } from "@/components/backstage/EventFeed";
import { TodayPanel } from "@/components/backstage/TodayPanel";
import { LiveSessionProvider } from "@/components/live/LiveSession";
import { NoSessionDesk } from "@/components/session/NoSession";
import { StaffShell } from "@/components/staff/StaffShell";
import { recentEvents } from "@/lib/session/server";
import { dueDoses } from "@/lib/session/today";
import { requireCrewPage } from "@/lib/crew/gate";
import { getDemoPageSubject } from "@/lib/subject";

export const dynamic = "force-dynamic";

function Legend() {
  return (
    <section className="rp-card flex flex-col gap-2 text-[18px]" data-testid="backstage-legend" aria-label="What stands out">
      <h2 className="text-[20px] font-bold">What stands out</h2>
      <p className="border-l-[6px] border-l-ink pl-3">
        <span className="font-semibold">Blocked</span>: a sentence the three checks stopped, with the layer and the reason. The phone shows a referral
        instead.
      </p>
      <p className="border-l-[6px] border-l-ink-3 pl-3">
        <span className="font-semibold">Who said it</span>: a line&apos;s speaker changed (Ripple&apos;s guess, or confirmed by Mr Tan).
      </p>
      <p className="border-l-[6px] border-dashed border-l-ink-2 pl-3">
        <span className="font-semibold">Scripted fallback</span>: filming only; the script line was shown instead of what was heard.
      </p>
    </section>
  );
}

export default async function BackstagePage() {
  await requireCrewPage();
  const ctx = await getDemoPageSubject();
  if (!ctx) {
    return (
      <StaffShell title="Backstage">
        <NoSessionDesk />
      </StaffShell>
    );
  }
  const store = ctx.store;
  const id = ctx.session.id;
  const day = ctx.session.story_day;
  const [meds, doses] = await Promise.all([store.listMeds(id), store.listDoses(id, { fromDay: day, toDay: day })]);
  return (
    <StaffShell title="Backstage">
      <LiveSessionProvider key={id} session={ctx.client} d0={ctx.d0} since={ctx.since}>
        <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]" data-testid="page-backstage">
          <div className="flex min-w-0 flex-col gap-5">
            <TodayPanel key={day} initial={dueDoses(meds, doses, day)} />
            <Legend />
          </div>
          <div className="min-w-0">
            <EventFeed initial={recentEvents(id, 200)} />
          </div>
        </div>
      </LiveSessionProvider>
    </StaffShell>
  );
}
