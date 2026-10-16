/**
 * /f/shared?link= — what Dad lets her see (C2 track D; relaid to the v3 draft's F1 by the fe-d track): all six items
 * read only, each with what exactly she sees or would see; an item that is on has the teal tick and says 「开」, the rest
 * a dash and 「没有分享」. Only he changes them, on his phone, as the last line says. His visit records and his notes
 * have screens of their own (/f/shared/visits, /f/shared/notes): their two rows lead there, on or off (off: the screen
 * says he has not shared it). Nothing of his records is on this screen, so no look is logged for it.
 *
 * The owner's decision of 2026-10-14 (each of the six switches shows its kind in full while it is on): the first three
 * rows are named for their kind and their line says the whole of it, in the same words as his switch screen
 * (「每天吃药的情况 / 哪种药、几点、没吃的原因」, 「血压 / 每次的读数和时间」, 「要问医生的问题 / 问题的原文，和下次看诊的日期」).
 * The words are the copy files' (lib/care/copy.ts grantName, lib/care/her-copy.ts see_*), read here through sharedItems.
 */
import { DayClock } from "@/components/daily/elder/DayClock";
import { HerLive } from "@/components/family/HerLive";
import { ReconsentLine } from "@/components/family/Reconsent";
import { FamilyScreen, FamilyTop, SharedSection } from "@/components/family-ui";
import { hc } from "@/lib/care/her-copy";
import { herDayClock, herPage, herSwitches } from "@/lib/care/her-page";
import { sharedItems } from "@/lib/care/her-view";
import { nowMs } from "@/lib/time/now";

export const dynamic = "force-dynamic";

export default async function FamilySharedPage({ searchParams }: PageProps<"/f/shared">) {
  const p = await herPage(await searchParams, "/f/shared");
  const { ctx, link, locale, dad } = p;
  const { items, version } = await herSwitches(ctx.store, ctx.session, link.id);
  return (
    <HerLive linkId={link.id} since={ctx.since} version={version} locale={locale} dad={dad} langHref={p.langHref}>
      <DayClock {...herDayClock(ctx.session, nowMs())} />
      <div className="contents" data-testid="family-shared">
        <FamilyScreen locale={locale}>
          <FamilyTop back={{ href: p.paths.home, label: hc(locale, "dadToday", { dad }) }} locale={locale} langHref={p.langHref} />
          {/* the family texts asked again (only add): why only the alert is on while her link waits for both of them */}
          {p.reconsent && <ReconsentLine locale={locale} dad={dad} />}
          <SharedSection items={sharedItems(items, locale, p.paths, dad)} locale={locale} dad={dad} heading={hc(locale, "sharedTitle", { dad })} lead={null} note={hc(locale, "onlyDadChanges", { dad })} />
        </FamilyScreen>
      </div>
    </HerLive>
  );
}
