/**
 * Today's entries for his visits that are not done yet (C2 track V; the timeline draft's 05-8). Each is an entry of the
 * day's line; the component's root is a fragment of <TimelineItem>s, as the line asks.
 *
 *   waiting for its text   (real-app 2.14: 「看诊列表和今天页显示『录音已存，等转写』」) the tick (the recording is kept), a
 *                          sentence per waiting visit with 「去看」 to that visit's review (which says the recording is
 *                          saved and plays it). Shown on a server with no transcription service (the judges' deployment),
 *                          and while the service is away. A visit whose transcript the server gave up on (three
 *                          attempts, track F) says 「录音没能转成文字」 instead, as its review does.
 *   not checked through    (05-8) a visit whose lines he has not all answered, or has not saved: the tick and 「录音存下
 *                          来了」 when it has a recording, a box that says it is not finished and that nothing he
 *                          answered is lost, 「接着认」 to its review (it opens at the first line still to ask) and 「结束」
 *                          (./TodayReviewEnd.tsx: the review's own 「就这样，存好」, so every line he did not answer keeps
 *                          saying 「好像是医生说的」 and can still be answered from the visit's record). Never the example's
 *                          sample replay, and never a visit in which nothing was recorded.
 * No words about a visit's content. Server-safe (no state).
 */
import { Fragment } from "react";
import { Act, Acts, Box, TimelineItem } from "@/components/ui";
import type { ReminderDeliveryRow, UtteranceRow, VisitRow } from "@/lib/store/types";
import { at, shortDate, type AccountLocale } from "@/lib/visit/account-copy";
import { isReplayCopy } from "@/lib/visit/happened";
import { transcriptGaveUp } from "@/lib/visit/transcript-tries";
import { liveUtterances } from "@/lib/visit/view";
import { TodayReviewEnd } from "./TodayReviewEnd";
import { vw } from "./words";

export interface WaitingVisit {
  id: string;
  /** the visit's date, ISO */
  date: string;
  /** the server used up its attempts: the recording is kept, the text could not be made (the review says the same) */
  failed: boolean;
  /** its text is there and his review of it is not finished (absent: the visit waits for its text) */
  review?: true;
  /** (a review) the visit has a recording on the server */
  recorded?: boolean;
}

/**
 * His visits waiting for their text, newest first; then the ones whose review is not finished (when the store can say
 * what was recorded: a visit with no line at all is not one).
 */
export async function visitsWaiting(
  store: {
    listVisits(scopeId: string): Promise<VisitRow[]>;
    listDeliveries(scopeId: string): Promise<ReminderDeliveryRow[]>;
    listUtterances?(scopeId: string, visitId: string): Promise<UtteranceRow[]>;
  },
  scopeId: string,
): Promise<WaitingVisit[]> {
  const newestFirst = (a: VisitRow, b: VisitRow) => b.day - a.day || b.created_at.localeCompare(a.created_at);
  const visits = await store.listVisits(scopeId);
  const waiting = visits.filter((v) => v.status === "awaiting_transcript").sort(newestFirst);
  const out: WaitingVisit[] = [];
  if (waiting.length) {
    const tries = await store.listDeliveries(scopeId);
    for (const v of waiting) out.push({ id: v.id, date: v.date, failed: transcriptGaveUp(tries, v.id) });
  }
  if (store.listUtterances) {
    // his own visits only: the example's sample visit (it plays a recorded file) and a replay copy are not his to finish
    for (const v of visits.filter((x) => x.status === "review" && !x.audio_fixture && !isReplayCopy(x)).sort(newestFirst)) {
      const lines = liveUtterances(await store.listUtterances(scopeId, v.id));
      if (lines.length > 0) out.push({ id: v.id, date: v.date, failed: false, review: true, recorded: !!v.audio_path });
    }
  }
  return out;
}

export function TodayVisitWaiting({ locale, visits }: { locale: AccountLocale; visits: WaitingVisit[] }) {
  const waiting = visits.filter((v) => !v.review);
  const reviews = visits.filter((v) => v.review);
  if (!waiting.length && !reviews.length) return null;
  const failed = waiting.filter((v) => v.failed).length;
  return (
    <>
      {waiting.length ? (
        <TimelineItem node={failed === waiting.length ? "miss" : "ok"} who={at(locale, "today.visit")} section="visit" testId="today-visit-waiting" attrs={{ "data-count": waiting.length, "data-failed": failed }}>
          {waiting.map((v) => (
            <Fragment key={v.id}>
              <p className="rpu-tl-title">{at(locale, v.failed ? "today.visitFailed" : "today.visitWaiting", { date: shortDate(v.date, locale) })}</p>
              <Acts>
                <Act href={`/p/visit/${encodeURIComponent(v.id)}/review`}>{at(locale, "visit.unfinished.open")}</Act>
              </Acts>
            </Fragment>
          ))}
        </TimelineItem>
      ) : null}
      {reviews.map((v) => {
        const date = shortDate(v.date, locale);
        return (
          <TimelineItem
            key={v.id}
            node={v.recorded ? "ok" : "now"}
            who={at(locale, "today.visit")}
            title={v.recorded ? vw(locale, "today.reviewSaved", { date }) : at(locale, "review.context", { date })}
            section="visit"
            testId="today-visit-review"
            attrs={{ "data-visit": v.id }}
          >
            <Box variant="acc" title={vw(locale, "today.reviewOpen", { date })}>
              {vw(locale, "today.reviewOpenSub")}
            </Box>
            <TodayReviewEnd visitId={v.id} locale={locale} />
          </TimelineItem>
        );
      })}
    </>
  );
}
