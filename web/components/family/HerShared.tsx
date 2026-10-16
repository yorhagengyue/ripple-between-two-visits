/**
 * Pieces of the screens behind 「爸爸让你看到的」 (the fe-d track; the v3 draft's F3 to F6). No state, no data: the pages
 * read his records (lib/care/shared.ts) and hand the words in.
 *
 *   NotShared   F6: he has not shared his visit records (or his notes). One sentence in the middle, whose decision it
 *               is, and the way home. Nothing here asks him to share.
 */
import { EmptyBlock, FamilyButton, FamilyDock } from "@/components/family-ui";
import { hc } from "@/lib/care/her-copy";
import type { Locale } from "@/lib/i18n";

export function NotShared({ locale, dad, what, homeHref }: { locale: Locale; dad: string; what: "visits" | "notes"; homeHref: string }) {
  return (
    <>
      <EmptyBlock title={hc(locale, what === "visits" ? "notSharedVisits" : "notSharedNotes", { dad })} detail={hc(locale, "notSharedBody", { dad })} />
      <FamilyDock foot="e">
        <FamilyButton href={homeHref} nav="back" variant="secondary" data-testid="not-shared-home">
          {hc(locale, "backHome", { dad })}
        </FamilyButton>
      </FamilyDock>
    </>
  );
}
