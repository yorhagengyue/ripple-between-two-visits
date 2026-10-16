"use client";

/**
 * His two answers to a family member who bound his account by typing it (line bind; components/his-family/BoundCard):
 *
 *   「知道了」                 POST /api/family/bind/seen: his own record of sharing names the link from now on, the card
 *                             goes, and what she records or adds for him is no longer refused (lib/care/ack.ts)
 *   「不认识这个人，解除」     the existing stop (POST /api/family/links/[id]/revoke): at once and for good; her open
 *                             page says he stopped, as it does today
 *
 * One tap each, no dialog. A tap that did not work says so in the red-bordered box and changes nothing. `dock`: in the
 * lower part of the screen (Today, where the card is the one thing on it); without it the two stand in the page's flow.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionDock, Button, PrimaryButton } from "@/components/ui";
import { bc } from "@/lib/care/bind-copy";
import { pc } from "@/lib/care/his-copy";
import type { Locale } from "@/lib/i18n";
import { Failed } from "./pieces";
import "./his-bind.css";

async function post(path: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}), credentials: "same-origin", cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

export function BoundAnswer({ linkId, locale, dock = true }: { linkId: string; locale: Locale; dock?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<"ok" | "remove" | null>(null);
  const [failed, setFailed] = useState(false);

  const answer = async (what: "ok" | "remove") => {
    setPending(what);
    setFailed(false);
    // the moment of his tap, for the check that her open page follows within a second (as components/family/HisFamily StopSharing)
    if (what === "remove") (window as unknown as { __rpStopAt?: number }).__rpStopAt = Date.now();
    const done = what === "ok" ? await post("/api/family/bind/seen", { link: linkId }) : await post(`/api/family/links/${encodeURIComponent(linkId)}/revoke`, {});
    if (!done) {
      setPending(null);
      return setFailed(true);
    }
    // the page reads itself again: the card is gone (and after a removal her page under 「家人」 says it has stopped)
    router.refresh();
  };

  const buttons = (
    <>
      {failed && <Failed testId="bound-failed">{pc(locale, "failed")}</Failed>}
      <PrimaryButton onClick={() => void answer("ok")} pending={pending === "ok"} disabled={pending !== null} data-testid="bound-ok">
        {bc(locale, "boundOk")}
      </PrimaryButton>
      <Button variant="danger-outline" onClick={() => void answer("remove")} pending={pending === "remove"} disabled={pending !== null} data-testid="bound-remove">
        {bc(locale, "boundRemove")}
      </Button>
    </>
  );
  return dock ? <ActionDock>{buttons}</ActionDock> : <div className="rphb-answer">{buttons}</div>;
}
