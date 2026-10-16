"use client";

/**
 * The family texts asked again, on her screens (owner, 2026-10-14; lib/care/reconsent.ts has the rule):
 *
 *   ReconsentLine   one quiet line above what she sees of him while either of them has not agreed to the family text in
 *                   force: why her view of him is the alert-only form (her home, 「留意」, what he lets her see)
 *   HerAgreeCard    her home, while she has not agreed herself: her text in force (its title and paragraphs, sent by the
 *                   server from lib/care/consent.ts familyConsentText) and one button, 「同意新的说明」
 *                   (POST /api/family/links/[id]/agree). Done: the page is loaded again from the start, her stream with
 *                   it (a stream opened while her link waited cuts his switches until it ends). Failed: one line says so
 *                   and nothing changes.
 * There is nothing else to choose on the card: she leaves it as it is, or stops following him from 「我的」 as always.
 */
import { useState } from "react";
import { FamilyButton } from "@/components/family-ui";
import { rcc } from "@/lib/care/reconsent-copy";
import type { Locale } from "@/lib/i18n";
import "./reconsent.css";

export function ReconsentLine({ locale, dad }: { locale: Locale; dad: string }) {
  return (
    <p className="rpf rpf-note rpfrc-line" data-rp="reconsent-line" data-testid="family-reconsent">
      {rcc(locale, "line", { dad })}
    </p>
  );
}

export function HerAgreeCard({ locale, linkId, text }: { locale: Locale; linkId: string; text: { title: string; paragraphs: readonly string[] } }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const agree = async () => {
    setPending(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/family/links/${encodeURIComponent(linkId)}/agree`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (res.ok) {
        // her screens read again, from the start: the copy, the line, and a stream that is not cut once both agreed
        window.location.reload();
        return;
      }
    } catch {
      // not sent: said below, nothing changed
    }
    setPending(false);
    setFailed(true);
  };
  return (
    <section className="rpf rpfrc-card" data-rp="reconsent-card" data-testid="family-reconsent-card" aria-label={text.title}>
      <h2 className="rpfrc-title">{text.title}</h2>
      {text.paragraphs.map((p) => (
        <p key={p} className="rpfrc-p">
          {p}
        </p>
      ))}
      {failed && (
        <p className="rpf rpf-error" role="alert" data-testid="family-reconsent-failed">
          {rcc(locale, "herFailed")}
        </p>
      )}
      <FamilyButton onClick={() => void agree()} pending={pending} data-testid="family-reconsent-agree">
        {rcc(locale, "herAgree")}
      </FamilyButton>
    </section>
  );
}
