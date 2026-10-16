/**
 * /f/shared/notes?link= — his own notes (the fe-d track; the v3 draft's F5, and its F6 while he does not share them):
 * 「爸爸的笔记。」, the line that says he agreed to show them, then each note with its date and weekday, whether he
 * spoke or typed it, and his words. She can read, not answer. Through her active link (else back to /f). The notes
 * leave the page the moment he switches them off; the server then says so.
 *
 * Not drawn, because the data is not there: the play key beside a spoken note (a note keeps its words, not its sound).
 */
import { DayClock } from "@/components/daily/elder/DayClock";
import { HerLive, WhileShared } from "@/components/family/HerLive";
import { NotShared } from "@/components/family/HerShared";
import { ReconsentLine } from "@/components/family/Reconsent";
import { AgreedRow, Chip, FamilyDock, FamilyHero, FamilyNote, FamilyScreen, FamilyTop, Said } from "@/components/family-ui";
import { logLook } from "@/lib/care/access-log";
import { dayWords } from "@/lib/care/copy";
import { hc } from "@/lib/care/her-copy";
import { herDayClock, herPage, herSwitches } from "@/lib/care/her-page";
import { quoted, weekdayOf } from "@/lib/care/her-view";
import { sharedNotes } from "@/lib/care/shared";
import { nowMs } from "@/lib/time/now";

export const dynamic = "force-dynamic";

export default async function FamilyNotesPage({ searchParams }: PageProps<"/f/shared/notes">) {
  const p = await herPage(await searchParams, "/f/shared/notes");
  const { ctx, link, locale, dad, paths } = p;
  const { items, version } = await herSwitches(ctx.store, ctx.session, link.id);
  const now = nowMs();
  const notes = items.notes ? await sharedNotes(ctx.store, ctx.session) : null;
  if (notes) await logLook(ctx.store, ctx.session.id, { linkId: link.id, userId: p.userId, label: link.family_label, route: "/f/shared/notes", items: ["notes"] }, now);
  return (
    <HerLive linkId={link.id} since={ctx.since} version={version} locale={locale} dad={dad} langHref={p.langHref}>
      <DayClock {...herDayClock(ctx.session, now)} />
      <div className="contents" data-testid="family-notes" data-state={notes ? "shown" : "not_shared"}>
        <FamilyScreen locale={locale}>
          <FamilyTop back={{ href: paths.home, label: hc(locale, "dadToday", { dad }) }} locale={locale} langHref={p.langHref} />
          {/* the family texts asked again (only add): why his notes are not shown while her link waits for both of them */}
          {p.reconsent && <ReconsentLine locale={locale} dad={dad} />}
          {notes ? (
            <>
              {/* his words leave the page the moment he switches his notes off (the server then renders the sentence) */}
              <WhileShared grant="notes">
                <section data-testid="shared-notes">
                  <FamilyHero tone="quiet" title={hc(locale, "notesTitle", { dad })} detail={notes.length ? undefined : hc(locale, "notesNone")} />
                  <AgreedRow style={{ marginTop: 22 }}>{hc(locale, "notesAgreed", { dad })}</AgreedRow>
                  <ul className="rpf rpf-items">
                    {notes.map((n) => (
                      <li key={n.id} className="rpf-item" data-testid="shared-note" data-source={n.source}>
                        <div className="rpf-item-head">
                          <span>{`${dayWords(n.date, locale)}　${weekdayOf(n.date, locale)}`}</span>
                          <Chip>{hc(locale, n.source === "voice_note" ? "noteVoice" : "noteTyped")}</Chip>
                        </div>
                        <div className="rpf-item-main">
                          <div>
                            <Said>{quoted(n.text, locale)}</Said>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              </WhileShared>
              <FamilyDock foot="n">
                <FamilyNote>{hc(locale, "notesReadOnly")}</FamilyNote>
              </FamilyDock>
            </>
          ) : (
            <NotShared locale={locale} dad={dad} what="notes" homeHref={paths.home} />
          )}
        </FamilyScreen>
      </div>
    </HerLive>
  );
}
