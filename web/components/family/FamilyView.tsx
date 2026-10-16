"use client";

/**
 * Wei Ling's view (/f, task M6 item 1): only the sections Mr Tan has switched on. The server builds the data
 * (lib/family/view.ts) and leaves out every section that is off, so nothing hidden is on the page or in a response.
 *
 * Live: on family_grant.changed a section that was switched off disappears straight from the event (under 1 s);
 * one switched on arrives with a refetch of GET /api/family/view (1 s on the in-memory store; up to 2 s on
 * STORE=supabase with the Tokyo database, accepted for this wave on 10-10). Data events (doses, readings, notes,
 * questions, the clock, a reset) refetch too. This morning's dose state follows dose.logged directly (M0's
 * family-dose-<med>). Whichever copy is newer wins: the server render (router.refresh) or the refetch.
 *
 * She can look, not act: there are no dose, question or medicine buttons here (the APIs refuse her anyway).
 *
 * No silent failure: a refetch that fails (non-2xx, no answer, an 8 s timeout, a body that is not the view) keeps
 * what is shown, says so in one line (「没能取到爸爸的最新情况，正在重试…」) and tries again by itself (1 s, 2 s, 4 s,
 * 8 s, then every 15 s) until it gets the view; the line goes when it does. Any new event also tries at once.
 * Quoted words (visit lines, his notes) carry data-verbatim, so a page scan can tell them from Ripple's own words.
 */
import { useEffect, useRef, useState } from "react";
import { useLiveEvent, useLiveSession } from "@/components/live/LiveSession";
import { useDoseStates } from "@/components/live/useDoseStates";
import { stateLabel } from "@/components/patient/DoseButtons";
import { demoText } from "@/lib/crew/demo-copy";
import { shortDay } from "@/lib/daily/i18n";
import { chipText } from "@/lib/daily/lines";
import type { LineChip } from "@/lib/daily/types";
import { isFamilyViewData, requestJson, retryDelayMs } from "@/lib/family/fetch";
import { ft, ftn } from "@/lib/family/i18n";
import { GRANT_KEYS, type FamilyDoseSection, type FamilyGrantChangedData, type FamilyViewData, type FamilyWeek } from "@/lib/family/types";
import { t, type Locale, type MessageKey } from "@/lib/i18n";
import { withSession } from "@/lib/session/client";
import type { FamilyGrantItems } from "@/lib/store/types";

const REFETCH_ON = [
  "family_grant.changed",
  "dose.logged",
  "bp.logged",
  "note.logged",
  "question.created",
  "question.updated",
  "visit.changed",
  "med.changed",
  "clock.changed",
  "session.reset",
];

/** The view with every switched-off section removed (the "off" direction needs no server round trip). */
export function withoutHidden(view: FamilyViewData, grants: FamilyGrantItems): FamilyViewData {
  const next: FamilyViewData = { ...view, grants: { ...grants } };
  if (!grants.dose_summary) delete next.doses;
  if (!grants.bp_summary) delete next.bp;
  if (!grants.questions_count) delete next.questions;
  if (!grants.visit_transcripts) delete next.visits;
  if (!grants.notes) delete next.notes;
  return next;
}

function weekText(locale: Locale, w: FamilyWeek): string {
  return ft(locale, "f.week", { from: shortDay(locale, w.fromDate), to: shortDay(locale, w.toDate) });
}

function chipLabel(locale: Locale, chip: LineChip): string {
  return chip.kind === "self" ? ft(locale, "f.chip.self") : chipText(locale, chip);
}

function DoseSection({ locale, section }: { locale: Locale; section: FamilyDoseSection }) {
  const { doses } = useDoseStates(section.today);
  return (
    <section className="rp-card" data-testid="family-doses" data-grant="dose_summary" data-days-taken={section.daysTaken} data-days-due={section.daysDue}>
      <p className="font-bold">{ft(locale, "f.doses.title")}</p>
      <p className="text-body text-ink-2">{weekText(locale, section.week)}</p>
      {section.daysDue === 0 ? (
        // C2 (real-app 12): the week and today never contradict each other. Nothing counted this week yet but a dose is
        // listed below for today (it is still being asked): "no check-in this week so far", not "no medicine due"
        <p className="mt-2 text-body" data-testid="family-doses-none" data-today={doses.length}>
          {doses.length > 0 ? demoText(locale, "f.doses.noneYet") : ft(locale, "f.doses.none")}
        </p>
      ) : (
        <>
          <p className="mt-2 text-[20px] font-bold" data-testid="family-doses-days">
            {ftn(locale, "f.doses.days", section.daysDue, { taken: section.daysTaken, due: section.daysDue })}
          </p>
          {section.daysMissed > 0 ? (
            <p className="text-body" data-testid="family-doses-missed">
              {ftn(locale, "f.doses.missed", section.daysMissed)}
            </p>
          ) : null}
          {section.daysUnconfirmed > 0 ? (
            <p className="text-body" data-testid="family-doses-unconfirmed">
              {ftn(locale, "f.doses.unconfirmed", section.daysUnconfirmed)}
            </p>
          ) : null}
        </>
      )}
      {doses.length > 0 ? (
        <div className="mt-2 border-t border-hair pt-2">
          {doses.map((d) => (
            <p key={d.medication_id} className="text-body font-semibold" data-testid={`family-dose-${d.medication_id}`} data-state={d.state ?? "none"}>
              {t(locale, "family.doseToday", { state: stateLabel(locale, d.state) })}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function FamilyView({ locale, initial }: { locale: Locale; initial: FamilyViewData }) {
  const { session } = useLiveSession();
  const [view, setView] = useState<FamilyViewData>(initial);
  const [seenInitial, setSeenInitial] = useState<FamilyViewData>(initial);
  const [tick, setTick] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const failures = useRef(0);

  // a newer server render (router.refresh after an event) replaces what is shown
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    if (initial.generatedAt >= view.generatedAt) setView(initial);
  }

  useLiveEvent((event) => {
    if (event.type === "family_grant.changed") {
      const data = event.data as FamilyGrantChangedData;
      const at = Date.parse(event.at);
      // anything built before this change is older than what is shown now
      if (data?.grant?.items) setView((v) => ({ ...withoutHidden(v, data.grant.items), generatedAt: Number.isFinite(at) ? Math.max(v.generatedAt, at) : v.generatedAt }));
    }
    setTick((n) => n + 1);
  }, REFETCH_ON);

  useEffect(() => {
    if (tick === 0) return;
    const ctrl = new AbortController();
    let retry: ReturnType<typeof setTimeout> | null = null;
    void requestJson<FamilyViewData>(withSession("/api/family/view", session.id), { signal: ctrl.signal, check: isFamilyViewData }).then((r) => {
      if (r.ok) {
        failures.current = 0;
        setLoadFailed(false);
        setView((v) => (r.data.generatedAt >= v.generatedAt ? r.data : v));
        return;
      }
      if (r.problem === "aborted") return; // superseded by a newer try, or the page left
      console.warn("[family/view] refetch failed", r.problem, r.status ?? "", r.code ?? "");
      setLoadFailed(true);
      retry = setTimeout(() => setTick((n) => n + 1), retryDelayMs(failures.current));
      failures.current += 1;
    });
    return () => {
      ctrl.abort();
      if (retry) clearTimeout(retry);
    };
  }, [tick, session.id]);

  const g = view.grants;
  return (
    <div className="flex flex-col gap-4" data-testid="family-view" data-day={view.day} data-load-failed={loadFailed ? "true" : "false"}>
      {loadFailed ? (
        <p className="text-body text-ink-2" role="status" data-testid="family-view-error">
          {ft(locale, "f.error.load")}
        </p>
      ) : null}
      {view.doses ? <DoseSection key={`d-${view.day}`} locale={locale} section={view.doses} /> : null}

      {view.bp ? (
        <section className="rp-card" data-testid="family-bp" data-grant="bp_summary" data-count={view.bp.count}>
          <p className="font-bold">{ft(locale, "f.bp.title")}</p>
          <p className="text-body text-ink-2">{weekText(locale, view.bp.week)}</p>
          <p className="mt-2 text-[20px] font-bold">{ft(locale, "f.bp.count", { n: view.bp.count })}</p>
          {view.bp.unconfirmed > 0 ? (
            <p className="text-body" data-testid="family-bp-unconfirmed">
              {ftn(locale, "f.bp.unconfirmed", view.bp.unconfirmed)}
            </p>
          ) : null}
        </section>
      ) : null}

      {view.questions ? (
        <section className="rp-card" data-testid="family-questions" data-grant="questions_count" data-count={view.questions.waiting}>
          <p className="font-bold">{ft(locale, "f.q.title")}</p>
          <p className="mt-1 text-[20px] font-bold">{ft(locale, "f.q.count", { n: view.questions.waiting })}</p>
        </section>
      ) : null}

      {view.visits ? (
        <section className="flex flex-col gap-3" data-testid="family-visits" data-grant="visit_transcripts">
          <h2 className="text-[20px] font-bold">{ft(locale, "f.visits.title")}</h2>
          {view.visits.length === 0 ? <p className="text-body text-ink-2">{ft(locale, "f.visits.none")}</p> : null}
          {view.visits.map((v) => (
            <article key={v.id} className="rp-card" data-testid="family-visit" data-visit={v.id}>
              <p className="font-bold">
                {shortDay(locale, v.date)} · {v.place}
              </p>
              {v.lines.length === 0 ? <p className="mt-1 text-body text-ink-2">{ft(locale, "f.visits.empty")}</p> : null}
              <ul className="mt-1 flex flex-col gap-2">
                {v.lines.map((l) => (
                  <li key={l.id} data-testid="family-visit-line" data-line={l.id}>
                    <p className="rp-src">{chipLabel(locale, l.chip)}</p>
                    <p className="text-body" lang={l.lang ?? undefined} data-verbatim="visit">
                      「{l.text}」
                    </p>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      ) : null}

      {view.notes ? (
        <section className="rp-card" data-testid="family-notes" data-grant="notes">
          <p className="font-bold">{ft(locale, "f.notes.title")}</p>
          {view.notes.length === 0 ? <p className="mt-1 text-body text-ink-2">{ft(locale, "f.notes.none")}</p> : null}
          <ul className="mt-1 flex flex-col gap-2">
            {view.notes.map((n) => (
              <li key={n.id} data-testid="family-note" data-day={n.day}>
                <p className="rp-src">
                  {ft(locale, "f.chip.note")} · {shortDay(locale, n.date)}
                </p>
                <p className="text-body" lang={n.lang ?? undefined} data-verbatim="note">
                  「{n.text}」
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rp-card" data-testid="family-allowed">
        <p className="font-semibold text-ink-2">{t(locale, "family.allowed")}</p>
        <ul className="mt-2 flex flex-col gap-1">
          {GRANT_KEYS.map((k) => (
            <li key={k} className="flex justify-between gap-3 text-body" data-testid={`family-allowed-${k}`} data-on={g[k] ? "true" : "false"}>
              <span>{t(locale, `grant.${k}` as MessageKey)}</span>
              <span className="font-semibold">{g[k] ? t(locale, "grant.on") : t(locale, "grant.off")}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-body text-ink-2">{ft(locale, "f.allowed.who")}</p>
      </section>
    </div>
  );
}
