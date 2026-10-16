/**
 * /director — the film crew's remote on the laptop (crew only: anyone without the crew's cookie gets Next's 404,
 * lib/crew/gate.ts). Two parts:
 *   - the demo session's console (DirectorConsole): the join code for the phones, the story clock (scenes, any day of the
 *     story), cues (pop the reminder now, simulate "no reply"), replay, filming mode, reset. Without a session the page
 *     offers a new filming session or joining one with a code.
 *   - the filming account's panel (track J, components/director/FilmingAccountPanel), shown with or without a session.
 *
 * The members go to the client component as lib/session/members.ts memberView (role, label, joined time): a member
 * row's id is that device's rp_member credential.
 */
import { DirectorConsole } from "@/components/director/DirectorConsole";
import { FilmingAccountPanel } from "@/components/director/FilmingAccountPanel";
import { LiveSessionProvider } from "@/components/live/LiveSession";
import { NoSessionDesk } from "@/components/session/NoSession";
import { StartSessionButton } from "@/components/session/StartSession";
import { StaffShell } from "@/components/staff/StaffShell";
import { replayableToday } from "@/lib/crew/director";
import { requireCrewPage } from "@/lib/crew/gate";
import { memberView } from "@/lib/session/members";
import { getStaffLocale, recentEvents } from "@/lib/session/server";
import { dueDoses } from "@/lib/session/today";
import { getDemoPageSubject } from "@/lib/subject";

export const dynamic = "force-dynamic";

export default async function DirectorPage() {
  await requireCrewPage();
  const ctx = await getDemoPageSubject();
  if (!ctx) {
    return (
      <StaffShell title="Director">
        <NoSessionDesk allowFilming />
        <div data-slot="filming-account">
          <FilmingAccountPanel />
        </div>
      </StaffShell>
    );
  }
  const id = ctx.session.id;
  const day = ctx.session.story_day;
  const [rows, meds, doses, replay] = await Promise.all([
    ctx.store.listMembers(id),
    ctx.store.listMeds(id),
    ctx.store.listDoses(id, { fromDay: day, toDay: day }),
    replayableToday(ctx.store, ctx.session),
  ]);
  const members = rows.map(memberView);
  return (
    <StaffShell
      title="Director"
      right={
        <StartSessionButton
          body={{ kind: "filming", role: "director" }}
          label="New filming session"
          className="rp-btn rp-btn-ghost min-h-11 text-[16px]"
          testId="new-filming-session"
          locale={getStaffLocale()}
          align="end"
        />
      }
    >
      <LiveSessionProvider key={ctx.client.id} session={ctx.client} d0={ctx.d0} since={ctx.since}>
        <DirectorConsole
          members={members}
          initialEvents={recentEvents(id, 30)}
          initialDoses={dueDoses(meds, doses, day)}
          replayVisit={replay?.id ?? null}
        />
      </LiveSessionProvider>
      <div data-slot="filming-account">
        <FilmingAccountPanel />
      </div>
    </StaffShell>
  );
}
