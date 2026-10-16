/**
 * /backstage/crew — the film crew's sign-in (real-app 5.2): the one page of the crew's that anyone can open, and no
 * public page links to it. The crew types the key once on each crew browser (the filming laptop, the phones of a filming
 * session); the browser then keeps a hash of it in the rp_crew cookie, and the crew's pages and buttons open for it
 * (lib/crew/gate.ts): /director, /backstage, /join, the jump menu on a demo phone, the story clock on /demo. Which keys
 * count: SCRIPTED_FALLBACK_KEY, and the dev-only key while the developer tools are on; a server with neither says so.
 */
import { CrewSignIn } from "@/components/backstage/CrewSignIn";
import { StaffShell } from "@/components/staff/StaffShell";
import { isCrewPage } from "@/lib/crew/gate";
import { crewGateSource } from "@/lib/session/crew-key";

export const dynamic = "force-dynamic";

export default async function CrewPage() {
  const signedIn = await isCrewPage();
  const configured = crewGateSource() !== "none";
  return (
    <StaffShell title="Crew" wide={false}>
      <div className="flex max-w-2xl flex-col gap-4" data-testid="page-crew">
        <h1 className="text-3xl font-bold">Film crew</h1>
        <p className="text-[18px] text-ink-2">
          The director&apos;s remote, the backstage screen, joining phones with a code and the story clock on the demo page are for the film crew.
          Type the crew key once on each crew browser. Judges do not need it: the demo page works without it.
        </p>
        {configured ? null : (
          <p className="rp-card text-[18px]" role="note" data-testid="crew-not-configured">
            This server has no crew key set, so the crew&apos;s tools are off here and no key will be accepted.
          </p>
        )}
        <section className="rp-card">
          <CrewSignIn signedIn={signedIn} />
        </section>
      </div>
    </StaffShell>
  );
}
