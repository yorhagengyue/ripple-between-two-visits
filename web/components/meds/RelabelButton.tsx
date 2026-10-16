"use client";

/** 「药袋换了？重新拍」: the medicine goes back to awaiting its label, then the label screen opens for it. */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLiveSession } from "@/components/live/LiveSession";
import type { Locale } from "@/lib/i18n";
import { mt } from "@/lib/meds/i18n";
import { withSession } from "@/lib/session/client";
import { cx } from "./classes";

export function RelabelButton({ medId, locale }: { medId: string; locale: Locale }) {
  const { session } = useLiveSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`rp-btn rp-btn-ghost ${cx.bigButton}`}
      disabled={busy}
      data-testid="med-relabel"
      onClick={async () => {
        setBusy(true);
        const res = await fetch(withSession(`/api/meds/${encodeURIComponent(medId)}`, session.id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "relabel" }),
          credentials: "same-origin",
        }).catch(() => null);
        setBusy(false);
        if (res?.ok) router.push(`/p/meds/add?med=${encodeURIComponent(medId)}`);
      }}
    >
      {mt(locale, "card.relabel")}
    </button>
  );
}
