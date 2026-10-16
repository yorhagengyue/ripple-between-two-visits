"use client";

/**
 * Before recording: ask the doctor (the agreement and its time are kept); if the doctor says no, take a photo
 * of the prescription and the label instead. Below it, "replay a sample visit" for judges without a
 * microphone: the sample goes through the same realtime pipeline as a real visit. Only visits on or before
 * the story day are offered (day gating, app/p/visit/page.tsx).
 */
import Link from "next/link";
import { demoText } from "@/lib/crew/demo-copy";
import type { Locale } from "@/lib/i18n";
import { shortDate, vt, type VisitKey } from "@/lib/visit/strings";
import s from "./styles";

export interface ReplayOption {
  fixture: string;
  day: number;
  date: string;
  kind: string;
}

function kindLabel(locale: Locale, kind: string): string {
  return vt(locale, (["healthier_sg_check_in", "follow_up", "pharmacy"].includes(kind) ? `kind.${kind}` : "kind.other") as VisitKey);
}

/** A visit started and not finished (C2: listed on top so it can be ended, real-app 12 「没结束的看诊在看诊页顶上列出」). */
export interface UnfinishedOption {
  id: string;
  day: number;
  date: string;
  kind: string;
  status: "recording" | "transcribing" | "review";
  /** the demo: a visit that already happened, being watched again (a replay copy) */
  rewatch?: boolean;
}

export function ConsentStep({
  locale,
  declined,
  busy,
  notice,
  replays,
  laterReplays = false,
  unfinished = [],
  onConsent,
  onBack,
  onReplay,
}: {
  locale: Locale;
  declined: boolean;
  busy: boolean;
  notice: string | null;
  replays: ReplayOption[];
  /** sample visits later in the story exist (not offered until the story reaches their day) */
  laterReplays?: boolean;
  /** visits started and not finished: each can be ended (recording) or checked (review) */
  unfinished?: UnfinishedOption[];
  onConsent(given: boolean): void;
  onBack(): void;
  onReplay(fixture: string): void;
}) {
  if (declined) {
    return (
      <div className="flex flex-col gap-4" data-testid="visit-declined">
        <h1 className="text-[28px] font-bold">{vt(locale, "consent.noTitle")}</h1>
        <div className="rp-card">
          <p>{vt(locale, "consent.noBody")}</p>
          <div className={s.stack}>
            <Link href="/p/meds/add" className={`rp-btn rp-btn-accent ${s.fullBtn} grid place-items-center`} data-testid="visit-photo-label">
              {vt(locale, "consent.noAction")}
            </Link>
            <button type="button" className={`rp-btn rp-btn-ghost ${s.fullBtn}`} onClick={onBack}>
              {vt(locale, "consent.back")}
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4" data-testid="page-visit">
      <h1 className="text-[28px] font-bold">{vt(locale, "visit.title")}</h1>
      {unfinished.length > 0 ? (
        <div className="rp-card" data-testid="visit-unfinished">
          <span className="rp-kicker">{vt(locale, "unfinished.title")}</span>
          {unfinished.map((u) => (
            <div key={u.id} className={s.replayRow} data-testid={`unfinished-${u.id}`} data-status={u.status}>
              <div>
                <div className="font-semibold">{vt(locale, "visit.dayTitle", { day: u.day, kind: kindLabel(locale, u.kind) })}</div>
                <div className="rp-src">
                  {shortDate(u.date, locale)} · {u.rewatch ? `${demoText(locale, "visit.rewatch.tag")} · ` : ""}
                  {vt(locale, u.status === "review" ? "unfinished.review" : "unfinished.recording")}
                </div>
              </div>
              {u.status === "review" ? (
                <Link href={`/p/visit/${encodeURIComponent(u.id)}/review`} className="rp-btn rp-btn-ghost grid place-items-center" data-testid={`unfinished-open-${u.id}`}>
                  {vt(locale, "unfinished.check")}
                </Link>
              ) : (
                // a full page load, not a soft navigation: this page is already mounted on its start step and keeps its
                // state across a soft navigation to itself, so 「接着结束」 would change the address and nothing else (C2)
                <a href={`/p/visit?visit=${encodeURIComponent(u.id)}&mode=replay`} className="rp-btn rp-btn-ghost grid place-items-center" data-testid={`unfinished-open-${u.id}`}>
                  {vt(locale, "unfinished.end")}
                </a>
              )}
            </div>
          ))}
        </div>
      ) : null}
      <div className="rp-card" data-testid="visit-consent-step">
        <span className="rp-kicker">{vt(locale, "consent.kicker")}</span>
        <p className="mt-1 font-semibold">{vt(locale, "consent.title")}</p>
        <p className="mt-2 text-ink-2">{vt(locale, "consent.body")}</p>
        <p className="mt-3 text-ink-2">{vt(locale, "consent.sayLabel")}</p>
        <p className={s.say}>“{vt(locale, "consent.sayLine")}”</p>
        <div className={s.stack}>
          <button type="button" className={`rp-btn rp-btn-accent ${s.fullBtn}`} disabled={busy} onClick={() => onConsent(true)} data-testid="consent-yes">
            {vt(locale, "consent.yes")}
          </button>
          <button type="button" className={`rp-btn rp-btn-ghost ${s.fullBtn}`} disabled={busy} onClick={() => onConsent(false)} data-testid="consent-no">
            {vt(locale, "consent.no")}
          </button>
        </div>
        {notice ? (
          <p className="mt-3 text-ink-2" data-testid="visit-notice">
            {notice}
          </p>
        ) : null}
      </div>

      {replays.length > 0 ? (
        <div className="rp-card" data-testid="replay-picker">
          <span className="rp-kicker">{vt(locale, "replay.title")}</span>
          <p className="mt-1 text-ink-2">{vt(locale, "replay.body")}</p>
          <div className="mt-2">
            {replays.map((r) => (
              <div key={r.fixture} className={s.replayRow}>
                <div>
                  <div className="font-semibold">{vt(locale, "visit.dayTitle", { day: r.day, kind: kindLabel(locale, r.kind) })}</div>
                  <div className="rp-src">{shortDate(r.date, locale)}</div>
                </div>
                <button type="button" className="rp-btn rp-btn-ghost" disabled={busy} onClick={() => onReplay(r.fixture)} data-testid={`replay-${r.fixture}`}>
                  {vt(locale, "replay.start")}
                </button>
              </div>
            ))}
          </div>
          {laterReplays ? (
            <p className="mt-2 text-ink-2" data-testid="replay-later">
              {vt(locale, "replay.later")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
