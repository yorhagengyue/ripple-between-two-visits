"use client";

/**
 * Developer jump menu on the phones: every phone route, story beats, reset. Hidden in filming mode
 * (PatientFrame does not render it), together with the debug line.
 */
import Link from "next/link";
import { useState } from "react";
import { useLiveSession } from "@/components/live/LiveSession";
import { t, type Locale } from "@/lib/i18n";
import { BEATS } from "@/lib/session/beats";
import { postJson } from "@/lib/session/client";
import { storyDayLabel } from "@/lib/story/clock";

const PAGES: { href: string; label: string }[] = [
  { href: "/p/today", label: "/p/today" },
  { href: "/p/visit", label: "/p/visit" },
  { href: "/p/visit/v1/review", label: "/p/visit/v1/review" },
  { href: "/p/meds", label: "/p/meds" },
  { href: "/p/meds/med-amlodipine", label: "/p/meds/med-amlodipine" },
  { href: "/p/meds/add", label: "/p/meds/add" },
  { href: "/p/bp", label: "/p/bp" },
  { href: "/p/questions", label: "/p/questions" },
  { href: "/p/brief", label: "/p/brief" },
  { href: "/f", label: "/f" },
];

export function JumpMenu({ locale }: { locale: Locale }) {
  const { session, d0 } = useLiveSession();
  const [busy, setBusy] = useState(false);

  async function call(path: string, body: unknown) {
    setBusy(true);
    try {
      await postJson(path, session.id, body);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="mt-8 rounded-2xl border border-dashed border-hair-2 px-4 py-3" data-testid="jump-menu">
      <summary className="cursor-pointer text-[15px] font-semibold text-ink-2">{t(locale, "jump.title")}</summary>
      <p className="mt-3 text-[13px] font-semibold uppercase tracking-wide text-ink-3">{t(locale, "jump.pages")}</p>
      <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[15px]">
        {PAGES.map((p) => (
          <li key={p.href}>
            <Link className="underline decoration-hair-2 underline-offset-2" href={p.href}>
              {p.label}
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] font-semibold uppercase tracking-wide text-ink-3">{t(locale, "jump.days")}</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {BEATS.map((b) => (
          <button
            key={b.id}
            type="button"
            className="rp-btn rp-btn-ghost px-2.5 py-1 text-[14px]"
            disabled={busy}
            title={b.title}
            onClick={() => void call("/api/clock", { beat: b.id })}
          >
            {storyDayLabel({ d0, day: b.day, time: b.time, locale })}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[15px]">
        <Link className="rp-btn rp-btn-ghost" href="/join">
          {t(locale, "jump.join")}
        </Link>
        <button type="button" className="rp-btn rp-btn-ghost" disabled={busy} onClick={() => void call("/api/session/reset", {})}>
          {t(locale, "jump.reset")}
        </button>
      </div>
    </details>
  );
}
