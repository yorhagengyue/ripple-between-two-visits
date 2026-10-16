"use client";

/**
 * His two answers on the card of the family texts asked again (components/his-family/ReconsentCard; lib/care/reconsent.ts):
 *
 *   「同意」   POST /api/family/links/[id]/agree: his family_share record under the text in force, as his confirmation
 *             writes it. The page reads itself again: the card goes. Her view opens up once she has agreed too.
 *   「先不」   the card is closed for today, on this phone only: a cookie with his date (RECONSENT_LATER_COOKIE), which
 *             his pages read before they draw the card (on Today the card is the whole screen while it is there, so the
 *             server has to know). Nothing is written anywhere; she stays in the alert-only form.
 *
 * One tap each, no dialog. A tap that did not work says so in the red-bordered box and changes nothing. `dock`: in the
 * lower part of the screen (Today, where the card is the one thing on it); without it the two stand in the page's flow.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionDock, PrimaryButton, SecondaryButton } from "@/components/ui";
import { rcc } from "@/lib/care/reconsent-copy";
import { RECONSENT_LATER_COOKIE } from "@/lib/care/reconsent-later";
import type { Locale } from "@/lib/i18n";
import { Failed } from "./pieces";
import "./his-bind.css";

export function ReconsentAnswer({ linkId, locale, date, dock = true }: { linkId: string; locale: Locale; /** his date today (YYYY-MM-DD): what 「先不」 keeps */ date: string; dock?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<"ok" | "later" | null>(null);
  const [failed, setFailed] = useState(false);

  const agree = async () => {
    setPending("ok");
    setFailed(false);
    let done = false;
    try {
      const res = await fetch(`/api/family/links/${encodeURIComponent(linkId)}/agree`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", credentials: "same-origin", cache: "no-store" });
      done = res.ok;
    } catch {
      done = false;
    }
    if (!done) {
      setPending(null);
      return setFailed(true);
    }
    router.refresh();
  };

  const later = () => {
    setPending("later");
    // two days at most: it only ever says 「not today」, and his date moves on at his midnight
    document.cookie = `${RECONSENT_LATER_COOKIE}=${encodeURIComponent(date)}; path=/; max-age=${2 * 86_400}; samesite=lax`;
    router.refresh();
  };

  const buttons = (
    <>
      {failed && <Failed testId="reconsent-failed">{rcc(locale, "hisFailed")}</Failed>}
      <PrimaryButton onClick={() => void agree()} pending={pending === "ok"} disabled={pending !== null} data-testid="reconsent-ok">
        {rcc(locale, "hisAgree")}
      </PrimaryButton>
      <SecondaryButton onClick={later} pending={pending === "later"} disabled={pending !== null} data-testid="reconsent-later">
        {rcc(locale, "hisLater")}
      </SecondaryButton>
    </>
  );
  return dock ? <ActionDock>{buttons}</ActionDock> : <div className="rphb-answer">{buttons}</div>;
}
