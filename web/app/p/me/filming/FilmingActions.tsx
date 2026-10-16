"use client";

/**
 * The one button of 「拍摄账号」 (C2 track J): 「标成拍摄账号」 (POST /api/crew/filming-account) or, once marked, 「结束拍摄」
 * (DELETE; the grey line under it says what it does). One tap does it, no confirm dialog (适老: no pop-ups); then the
 * page is read again.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Said } from "@/components/me/parts";
import { ButtonNote, PrimaryButton, SecondaryButton } from "@/components/ui/Buttons";
import { filmingCopy, type FilmingLocale } from "./copy";

export function FilmingActions({ locale, filming }: { locale: FilmingLocale; filming: boolean }) {
  const c = filmingCopy(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function send(method: "POST" | "DELETE") {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/crew/filming-account", { method, credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rpu" data-rp="filming-actions" style={{ display: "grid", gap: "var(--rp-gap)" }}>
      {failed && (
        <Said tone="problem" testId="filming-failed">
          {c.failed}
        </Said>
      )}
      {filming ? (
        <div>
          <SecondaryButton pending={busy} disabled={busy} data-testid="filming-end" onClick={() => void send("DELETE")}>
            {busy ? c.ending : c.end}
          </SecondaryButton>
          <ButtonNote>{c.endHint}</ButtonNote>
        </div>
      ) : (
        <PrimaryButton pending={busy} disabled={busy} data-testid="filming-mark" onClick={() => void send("POST")}>
          {busy ? c.marking : c.mark}
        </PrimaryButton>
      )}
    </div>
  );
}
