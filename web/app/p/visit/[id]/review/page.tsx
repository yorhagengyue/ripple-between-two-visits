/**
 * /p/visit/[id]/review — after-visit review (M2): he marks which sentences were his and checks each item.
 * A seeded visit with no transcript yet shows the doctor's required lines kept for it (with the stand-in
 * clip) and points to the sample replay. A visit later than the story day shows only "not yet" (day gating).
 */
import { notFound } from "next/navigation";
import { AccountReviewPage } from "@/components/visit/elder/pages";
import { ReviewNotYet, ReviewScreen, type SeedLine } from "@/components/visit/ReviewScreen";
import { fixtureClipPath, fixtureUtterances } from "@/lib/asr";
import { getPatientLocale } from "@/lib/session/server";
import { clipUrl, buildVisitView } from "@/lib/visit/view";
import { getPageSubject } from "@/lib/subject";

export const dynamic = "force-dynamic";

export default async function VisitReviewPage({ params }: PageProps<"/p/visit/[id]/review">) {
  const [{ id }, ctx, locale] = await Promise.all([params, getPageSubject(), getPatientLocale()]);
  if (!ctx) return null;
  const store = ctx.store;
  const visitId = decodeURIComponent(id);
  // his own account (C2): one line at a time, the summary, the edits (components/visit/elder)
  if (ctx.subject.kind === "account") return <AccountReviewPage ctx={ctx} locale={locale} visitId={visitId} />;
  const view = await buildVisitView(store, ctx.session.id, visitId, { session: ctx.session });
  if (!view) notFound();
  // day gating: a visit later in the story shows nothing yet (no doctor's lines, no clips, no status)
  if (view.visit.day > ctx.session.story_day) {
    return <ReviewNotYet view={view} locale={locale} storyDay={ctx.session.story_day} />;
  }

  // required doctor lines kept for this visit that are not in the transcript (a seeded visit)
  const shown = new Set(view.lines.map((l) => l.text.trim()));
  const required = await store.listVisitItems(ctx.session.id, { visit_id: visitId, required_only: true });
  const fixture = fixtureUtterances(visitId) ?? [];
  const seedLines: SeedLine[] = required
    .filter((r) => !shown.has(r.text.trim()))
    .map((r) => {
      const line = fixture.find((f) => f.text.trim() === r.text.trim()) ?? null;
      const clip = line && fixtureClipPath(line.id) ? { url: clipUrl(ctx.session, visitId, line.id), standIn: true } : null;
      return {
        id: r.id,
        requiredLine: r.required_line ?? "",
        text: r.text,
        display: view.visit.status === "confirmed" ? "confirmed" : "inferred",
        clip,
        tStartMs: line?.t_start_ms ?? null,
      };
    });

  return <ReviewScreen key={`${view.visit.id}-${view.visit.status}`} view={view} locale={locale} sessionId={ctx.client.id} seedLines={seedLines} />;
}
