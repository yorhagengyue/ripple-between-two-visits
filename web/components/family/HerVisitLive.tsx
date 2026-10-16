"use client";

/**
 * His visit as it is recorded, on her phone (/f/shared/visit/[id]/live?link=; scene 1 of the owner's video, 2026-10-15:
 * in the doctor's room his phone records, hers shows the same visit at the same time). From the top:
 *
 *   「‹ 爸爸今天」 back to her home; 「爸爸的就诊」; the breathing dot and how long it has been recording (his clock as the
 *   server gave it), or 「录音已结束」 with the way to the visit's record
 *   while he shares his visit records (visit_transcripts):
 *     Ripple's live summary, its points as he sees them on his phone (it grows large by itself for a few seconds when a
 *     point arrives or changes; a tap shows it large: components/visit/SummaryFocus.tsx)
 *     the live captions: the latest lines as they come, newest on top, each with who said it (「医生」, her word for him, her own name)
 *     and its time; a line's speaker follows when Ripple decides again (utterance.role); one quiet line says the
 *     speakers are Ripple's guess
 *   without them: one sentence, that only the recording itself shows here
 *
 * Everything arrives on her stream (components/family/HerLive.tsx's, lib/family/events.ts: the lines, the speakers and the
 * summary while he shares his visit records; a content-free hint when the recording starts or ends): no polling for
 * what is said. When a hint comes (and every 30 s while it records, in case one was missed), the visit's state is read
 * again (GET /api/family/live). His switch going off takes the visit's words off the screen at once (WhileShared), and
 * the page is drawn again by the server; her link ending is HerLive's screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HerLive, WhileShared } from "@/components/family/HerLive";
import { EmptyBlock, FamilyButton, FamilyNote, FamilyScreen, FamilyTop, Quote } from "@/components/family-ui";
import { SummaryFocus } from "@/components/visit/SummaryFocus";
import type { BusEvent } from "@/lib/bus";
import { hc, type HerKey } from "@/lib/care/her-copy";
import type { HerLiveLine, HerLiveSummary, HerLiveVisit } from "@/lib/care/live-visit";
import type { Locale } from "@/lib/i18n";
import type { RoleState, UtteranceRole } from "@/lib/store/types";
import { useRunningTime } from "./LiveBanner";
import "./live-visit.css";

/** Lines shown at once (the newest on top, as her visit records list the latest first); the earlier ones are counted. */
const SHOWN = 5;
/** While it records: the state is read again this often, in case a hint was missed. */
const RECHECK_MS = 30_000;

// whole seconds, cut, never rounded (tests/unit/ui/clip-time.test.ts holds the rule for every time point)
const at = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

const byTime = (a: HerLiveLine, b: HerLiveLine) => a.tStartMs - b.tStartMs;

export function HerVisitLive({
  linkId,
  since,
  version,
  locale,
  dad,
  herName,
  langHref,
  homeHref,
  recordHref,
  initial,
}: {
  linkId: string;
  since: number;
  /** which change of his switches the page was rendered at */
  version: number;
  locale: Locale;
  /** her word for him (lib/care/copy.ts dadWord) */
  dad: string;
  /** her own name as his link carries it; null: 「你」 */
  herName: string | null;
  langHref: string;
  homeHref: string;
  recordHref: string;
  initial: HerLiveVisit;
}) {
  const [live, setLive] = useState<HerLiveVisit>(initial);
  const [lines, setLines] = useState<HerLiveLine[]>(() => [...initial.lines].sort(byTime));
  const [summary, setSummary] = useState<HerLiveSummary | null>(initial.summary);
  const [partial, setPartial] = useState<{ id: string; text: string; tStartMs: number } | null>(null);
  const visitId = initial.visitId;
  const recording = live.state === "recording";
  const time = useRunningTime(live.startedAt, initial.generatedAt, recording);
  const busy = useRef(false);

  /** the visit's state (and what was heard so far) read again */
  const reread = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const res = await fetch(`/api/family/live?link=${encodeURIComponent(linkId)}&visit=${encodeURIComponent(visitId)}`, { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) return;
      const next = (await res.json()) as HerLiveVisit;
      setLive(next);
      // while it records, the server's lines are the whole of it (a reconnect may have missed some); after it, the
      // lines already on the screen stay (the record's own page has what she may read of it then)
      if (next.state === "recording" && next.shared) setLines((cur) => mergeLines(cur, next.lines));
      if (!next.shared) setLines([]);
      if (next.summary) setSummary(next.summary);
      else if (!next.shared) setSummary(null);
    } catch {
      // the next hint, or the next check, reads it again
    } finally {
      busy.current = false;
    }
  }, [linkId, visitId]);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => void reread(), RECHECK_MS);
    return () => clearInterval(t);
  }, [recording, reread]);

  const listen = (e: BusEvent) => {
    const d = (e.data ?? {}) as {
      visit_id?: string;
      utterances?: { id: string; text: string; lang: string | null; t_start_ms: number; t_end_ms: number; role: UtteranceRole; role_state: RoleState }[];
      utterance?: { id: string; text: string; t_start_ms: number };
      changes?: { id: string; role: UtteranceRole; state: RoleState }[];
      stage?: "live" | "final";
      lang?: "en" | "zh-Hans";
      points?: { text: string }[];
    };
    if (e.type === "visit.changed") return void reread();
    if (e.type === "family_grant.changed") return void reread();
    if (d.visit_id !== visitId) return;
    if (e.type === "asr.final") {
      const add = (d.utterances ?? []).map((u) => ({ id: u.id, text: u.text, lang: u.lang, role: u.role, roleState: u.role_state, tStartMs: u.t_start_ms, tEndMs: u.t_end_ms }));
      if (add.length) setLines((cur) => mergeLines(cur, add));
      setPartial((p) => (p && add.some((u) => u.id === p.id) ? null : p));
    } else if (e.type === "asr.partial" && d.utterance) {
      setPartial({ id: d.utterance.id, text: d.utterance.text, tStartMs: d.utterance.t_start_ms });
    } else if (e.type === "utterance.role") {
      const changes = new Map((d.changes ?? []).map((c) => [c.id, c]));
      if (changes.size) setLines((cur) => cur.map((l) => (changes.has(l.id) ? { ...l, role: changes.get(l.id)!.role, roleState: changes.get(l.id)!.state } : l)));
    } else if (e.type === "visit.summary") {
      const points = (d.points ?? []).map((p) => p.text).filter((t) => typeof t === "string" && t.trim());
      if (points.length) setSummary({ stage: d.stage === "final" ? "final" : "live", lang: d.lang === "en" ? "en" : "zh-Hans", points });
    }
  };

  const speaker = (l: Pick<HerLiveLine, "role">): string => {
    if (l.role === "doctor" || l.role === "pharmacist" || l.role === "dispenser") return hc(locale, `speaker_${l.role}` as HerKey);
    if (l.role === "patient") return dad;
    if (l.role === "family") return herName?.trim() || hc(locale, "speaker_you");
    return hc(locale, "speaker_unknown");
  };

  const shown = useMemo(() => lines.slice(-SHOWN).reverse(), [lines]);
  const earlier = lines.length - shown.length;
  const missing = live.state === "missing";

  return (
    <HerLive linkId={linkId} since={since} version={version} locale={locale} dad={dad} langHref={langHref} listen={listen}>
      <div className="contents" data-testid="family-visit-live" data-state={live.state} data-shared={live.shared ? "true" : "false"} data-visit={visitId}>
        <FamilyScreen locale={locale}>
          <FamilyTop back={{ href: homeHref, label: hc(locale, "dadToday", { dad }) }} locale={locale} langHref={langHref} />
          {missing ? (
            <EmptyBlock title={hc(locale, "liveMissing")} />
          ) : (
            <>
              <h1 className="rpf rpf-h1" data-testid="family-live-title">
                {hc(locale, "liveTitle", { dad })}
              </h1>
              <p className="rpf rpfl-state" data-state={live.state} data-testid="family-live-state" role="status">
                <span className="rpfl-dot" aria-hidden="true" />
                <span>{recording ? hc(locale, "liveRecording", { time: time ?? "0:00" }) : hc(locale, "liveEnded")}</span>
              </p>
              {!recording ? (
                <div className="rpfl-ended" data-testid="family-live-ended">
                  <p className="rpf rpf-sub" style={{ marginTop: 0 }}>
                    {hc(locale, "liveEndedBody")}
                  </p>
                  <FamilyButton href={recordHref} nav="forward" data-testid="family-live-record">
                    {hc(locale, "liveRecord")}
                  </FamilyButton>
                </div>
              ) : null}
              {!live.shared ? (
                <p className="rpf rpf-sub" data-testid="family-live-only-recording">
                  {hc(locale, "liveOnlyRecording", { dad })}
                </p>
              ) : (
                <WhileShared grant="visit_transcripts">
                  {summary ? (
                    <section className="rpfl-section" data-testid="family-live-summary" data-points={summary.points.length} data-stage={summary.stage} aria-live="polite">
                      <SummaryFocus
                        variant="family"
                        title={hc(locale, summary.stage === "final" ? "liveSummaryFinal" : "liveSummary")}
                        note={hc(locale, "liveSummaryNote")}
                        points={summary.points}
                        lang={summary.lang}
                        auto={recording}
                        clamp
                        announceFirst={!initial.summary}
                        openLabel={hc(locale, "liveSummaryOpen")}
                        testId="family-live-summary"
                      >
                        <div className="rpf rpfl-summary">
                          <p className="rpfl-summary-title">{hc(locale, summary.stage === "final" ? "liveSummaryFinal" : "liveSummary")}</p>
                          <ul className="rpfl-points" lang={summary.lang}>
                            {summary.points.map((p, i) => (
                              <li key={`${i}-${p}`} data-testid="family-live-summary-point">
                                {p}
                              </li>
                            ))}
                          </ul>
                          <p className="rpf rpf-note">{hc(locale, "liveSummaryNote")}</p>
                        </div>
                      </SummaryFocus>
                    </section>
                  ) : null}
                  <section className="rpfl-section rpfl-captions" data-testid="family-live-captions" data-lines={lines.length} aria-live="polite">
                    <p className="rpf rpf-label">{hc(locale, "liveCaptions")}</p>
                    {partial && !lines.some((l) => l.id === partial.id) ? (
                      <Quote className="rpfl-partial" who={`${hc(locale, "speaker_unknown")}　${at(partial.tStartMs)}`} words={`${partial.text}…`} data-testid="family-live-partial" />
                    ) : null}
                    {shown.length === 0 && !partial ? (
                      <p className="rpf rpf-sub" data-testid="family-live-nothing">
                        {hc(locale, "liveNothing")}
                      </p>
                    ) : null}
                    {shown.map((l) => (
                      <div key={l.id} className="contents" data-testid="family-live-line" data-line={l.id} data-role={l.role} data-role-state={l.roleState} data-t-start={l.tStartMs} data-t-end={l.tEndMs}>
                        <Quote who={`${speaker(l)}　${at(l.tStartMs)}`} words={l.text} lang={l.lang === "zh" ? "zh-Hans" : (l.lang ?? undefined)} />
                      </div>
                    ))}
                    {earlier > 0 ? <p className="rpf rpfl-earlier">{hc(locale, "liveEarlier", { n: earlier })}</p> : null}
                    <FamilyNote className="rpfl-who">{hc(locale, "liveWho")}</FamilyNote>
                  </section>
                </WhileShared>
              )}
            </>
          )}
        </FamilyScreen>
      </div>
    </HerLive>
  );
}

/** The lines on the screen with the new ones: one per id (the newer copy wins), in recording order. */
function mergeLines(cur: readonly HerLiveLine[], add: readonly HerLiveLine[]): HerLiveLine[] {
  const by = new Map(cur.map((l) => [l.id, l]));
  for (const l of add) by.set(l.id, l);
  return [...by.values()].sort(byTime);
}
