/**
 * /f/shared/visit/[id]/live?link= — his visit as it is recorded, on her phone (scene 1 of the owner's video, 2026-10-15;
 * components/family/HerVisitLive.tsx draws it, lib/care/live-visit.ts reads it). Her home's banner opens it while he
 * records. Through her active link (else back to /f); the visit's words only while he shares his visit records, and
 * then her look is logged for him, as on his visit records' own pages.
 */
import { HerVisitLive } from "@/components/family/HerVisitLive";
import { logLook } from "@/lib/care/access-log";
import { herPage, herSwitches } from "@/lib/care/her-page";
import { herLiveVisit } from "@/lib/care/live-visit";
import { nowMs } from "@/lib/time/now";

export const dynamic = "force-dynamic";

export default async function FamilyVisitLivePage({ params, searchParams }: PageProps<"/f/shared/visit/[id]/live">) {
  const { id } = await params;
  const visitId = decodeURIComponent(id);
  const p = await herPage(await searchParams, `/f/shared/visit/${id}/live`);
  const { ctx, link, locale, dad, paths } = p;
  const { items, version } = await herSwitches(ctx.store, ctx.session, link.id);
  const now = nowMs();
  const live = await herLiveVisit(ctx.store, ctx.session, visitId, items, now);
  if (live.shared && live.state !== "missing") {
    await logLook(ctx.store, ctx.session.id, { linkId: link.id, userId: p.userId, label: link.family_label, route: "/f/shared/visit/live", items: ["visit_transcripts"] }, now);
  }
  return (
    <HerVisitLive
      linkId={link.id}
      since={ctx.since}
      version={version}
      locale={locale}
      dad={dad}
      herName={link.family_label}
      langHref={p.langHref}
      homeHref={paths.home}
      recordHref={paths.visit(visitId)}
      initial={live}
    />
  );
}
