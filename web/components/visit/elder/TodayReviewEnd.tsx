"use client";

/**
 * The two buttons of Today's entry for a review he has not finished (the timeline draft's 05-8): 「结束」 and 「接着认」.
 *
 * 「接着认」 opens the visit's review, which starts at the first line still to ask. 「结束」 is the review's own 「就这样，
 * 存好」 (POST /api/visits/[id]/confirm with the lines the record already holds as his own): the visit is confirmed as it
 * stands, every line he did not answer keeps saying 「好像是医生说的」, and each one can still be answered from the
 * visit's record. Nothing new on the server; a save that fails says so here and can be tapped again.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Act, Acts } from "@/components/ui";
import { fetchSignedIn, postJson } from "@/lib/session/client";
import type { AccountLocale } from "@/lib/visit/account-copy";
import type { VisitView } from "@/lib/visit/types";
import { vw } from "./words";

export function TodayReviewEnd({ visitId, locale }: { visitId: string; locale: AccountLocale }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const path = `/api/visits/${encodeURIComponent(visitId)}`;

  async function end() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      // his own lines as the record holds them now: the confirm keeps them his (as the review's own button sends them)
      const res = await fetchSignedIn(path, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const { view } = (await res.json()) as { view: VisitView };
      const mine = view.lines.filter((l) => l.role === "patient").map((l) => l.id);
      await postJson(`${path}/confirm`, null, { mine, items: {}, locale });
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Acts cols={2}>
        <Act onClick={() => void end()} pending={busy} data-testid="today-visit-review-end">
          {vw(locale, "today.reviewEnd")}
        </Act>
        <Act variant="primary" href={`/p/visit/${encodeURIComponent(visitId)}/review`} data-testid="today-visit-review-go">
          {vw(locale, "today.reviewGoOn")}
        </Act>
      </Acts>
      {failed ? (
        <p className="rpu-tl-note" role="alert" data-testid="today-visit-review-failed">
          {vw(locale, "today.reviewEndFailed")}
        </p>
      ) : null}
    </>
  );
}
