/**
 * /p/me/export/recordings — 「看诊录音留多久」 (journey 15; the elder brief 15.3 「看诊录音默认留 90 天，每一次看诊可以单独选
 * 『一直保留』」; real-app 3.11 保留期限; C2 track H; laid out after the timeline draft's 15-4). One white card under the
 * grey heading 「一直保留」: every visit that has, or had, a recording of his is a row with its date and place, until when
 * it is kept (the visit date + 90 days) or 「一直保留」, and the switch (track F's POST /api/visits/[id]/keep, which also
 * keeps his decision as a consent record); 「听录音」 under it while the recording is there. A recording the retention
 * job deleted says on which day; its transcript stays.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { P } from "@/components/me/parts";
import { Box, PageHeader, Screen, ToggleList } from "@/components/ui";
import { getBlobStore, READ_LINK_SECONDS } from "@/lib/blob";
import { asHLocale, hCopy } from "@/lib/privacy/copy";
import { recordingListenPath } from "@/lib/privacy/links";
import { ownedAudio, recordingState } from "@/lib/privacy/retention";
import { dateWords, placeWords } from "@/lib/privacy/words";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";
import { completeParts } from "@/lib/visit/recording";
import { RecordingRow, type RecordingRowData } from "./RecordingRow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "就诊录音留多久 · Ripple" };

export default async function RecordingsPage() {
  const [ctx, uiLocale] = await Promise.all([getPageSubject(), getPatientLocale()]);
  if (!ctx) return null;
  if (ctx.subject.kind !== "account" || ctx.subject.relation !== "self") notFound();
  const locale = asHLocale(uiLocale);
  const c = hCopy(locale);
  const scope = ctx.session;
  const visits = (await ctx.store.listVisits(scope.id)).filter((v) => v.status !== "planned").sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
  const rows: RecordingRowData[] = [];
  for (const v of visits) {
    const utterances = await ctx.store.listUtterances(scope.id, v.id);
    const state = recordingState(scope, v, utterances);
    if (state.kind === "none") continue;
    const own = ownedAudio(scope, v, utterances);
    // the player's address is our own route, which signs a fresh 10-minute link for every play; here the link is
    // only asked for to learn whether the file is still in storage (a row without its file shows no 「听录音」)
    const there = state.kind !== "deleted" && own.recording ? await getBlobStore().signedReadUrl("audio", own.recording, READ_LINK_SECONDS).then(() => true, () => false) : false;
    const listenUrl = there ? recordingListenPath(v.id) : null;
    // C2 track R: a long recording is several files; the player goes through them as one
    const parts = there && own.files.length > 1 ? completeParts(v) : null;
    rows.push({
      visitId: v.id,
      title: c.recVisit(dateWords(v.date, locale), placeWords(v, c.recPharmacy)),
      state: state.kind,
      until: state.kind === "kept_until" || state.kind === "deleted" ? dateWords(state.until, locale) : null,
      deletedOn: state.kind === "deleted" ? dateWords(state.on, locale) : null,
      listenUrl,
      ...(parts ? { listenMore: parts.slice(1).map((_, i) => recordingListenPath(v.id, i + 1)), lengthsMs: parts.map((p) => p.ms) } : {}),
    });
  }
  return (
    <Screen locale={locale} className="rpm-screen">
      <PageHeader back={{ href: "/p/me/export", label: c.myData }} title={c.recTitle} locale={locale} />
      <div className="rpu-stack" data-testid="page-recordings">
        <P>{c.recLede}</P>
        {rows.length === 0 ? (
          <Box variant="dash" title={c.recEmpty} />
        ) : (
          <div data-rp="recordings">
            <ToggleList heading={c.recKeepTitle}>
              {rows.map((r) => (
                <RecordingRow key={r.visitId} locale={locale} row={r} />
              ))}
            </ToggleList>
          </div>
        )}
      </div>
    </Screen>
  );
}
