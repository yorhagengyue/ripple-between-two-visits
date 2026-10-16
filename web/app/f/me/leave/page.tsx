/**
 * /f/me/leave?link= — 「不再看爸爸的 Ripple」 (the fe-d track; the v3 draft's G4): what follows, one line each, then the
 * outlined button that does it (components/family/HerBits.tsx LeaveButton: POST /api/family/links/[id]/leave; her
 * page then says she left, H2) and 「先不要」. Through her active link (else back to /f).
 *
 * One line is not the draft's. It says 「你录的提醒不再放给他听。」; as things are, the reminders she recorded stay in
 * his Ripple and his phone goes on playing the newest one after she leaves, so the line here says that.
 */
import { LeaveButton } from "@/components/family/HerBits";
import { DashList, FamilyButton, FamilyDock, FamilyHero, FamilyScreen, FamilyTop } from "@/components/family-ui";
import { hc } from "@/lib/care/her-copy";
import { herPage } from "@/lib/care/her-page";

export const dynamic = "force-dynamic";

export default async function FamilyLeavePage({ searchParams }: PageProps<"/f/me/leave">) {
  const p = await herPage(await searchParams, "/f/me/leave");
  const { locale, dad, link, paths } = p;
  return (
    <div className="contents" data-testid="family-leave">
      <FamilyScreen locale={locale}>
        <FamilyTop back={{ href: paths.me, label: hc(locale, "meBack") }} locale={locale} langHref={p.langHref} />
        <FamilyHero tone="quiet" title={hc(locale, "leaveTitle", { dad })} detail={hc(locale, "leaveLede")} />
        <DashList items={[hc(locale, "leaveItem1", { dad }), hc(locale, "leaveItem2", { dad }), hc(locale, "leaveItem3", { dad }), hc(locale, "leaveItem4", { dad })]} data-testid="leave-what" />
        <FamilyDock foot="b">
          <LeaveButton linkId={link.id} locale={locale} dad={dad} />
          <FamilyButton href={paths.me} nav="back" variant="quiet" data-testid="leave-not-now">
            {hc(locale, "notNow")}
          </FamilyButton>
        </FamilyDock>
      </FamilyScreen>
    </div>
  );
}
