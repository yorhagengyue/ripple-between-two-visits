"use client";

/**
 * After the visit (web-app.md section 8): he taps the lines he said, and checks each thing that was said
 * (right / not right). Until then every speaker is only inferred; a medicine sentence never reads
 * "Doctor said" before he confirms it (or it agrees with a confirmed label).
 *
 * C2 follow-up (real-app 12 「看诊回顾确认后不能再改」): after he confirmed, each thing that was said keeps its two buttons
 * showing what he answered; a tap changes that one answer at once (POST /api/visits/[id]/verdict: the item's history
 * keeps the change, his question list follows) and the card says it was changed. "Not right" never removes a sentence:
 * the card stays with 「他说不对」 (components/visit/DocCard).
 */
import { useState } from "react";
import type { Locale } from "@/lib/i18n";
import { demoText } from "@/lib/crew/demo-copy";
import { postJson } from "@/lib/session/client";
import { vt, type VisitKey } from "@/lib/visit/strings";
import { formatMs } from "@/lib/visit/text";
import type { ClipView, DocCardView, RoleDisplay, VisitView } from "@/lib/visit/types";
import { ClipButton } from "./ClipButton";
import { DocCard } from "./DocCard";
import { chipText } from "./labels";
import { visitTitle } from "./VisitScreen";
import s from "./styles";

export interface SeedLine {
  id: string;
  requiredLine: string;
  text: string;
  display: RoleDisplay;
  clip: ClipView | null;
  tStartMs: number | null;
}

type Verdict = "right" | "wrong";

export function ReviewScreen({
  view: initial,
  locale,
  sessionId,
  seedLines,
}: {
  view: VisitView;
  locale: Locale;
  sessionId: string;
  seedLines: SeedLine[];
}) {
  const [view, setView] = useState(initial);
  const [mine, setMine] = useState<Set<string>>(() => new Set(initial.lines.filter((l) => l.role === "patient").map((l) => l.id)));
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(initial.visit.status === "confirmed");
  const [failed, setFailed] = useState(false);
  /** after he confirmed: the card whose answer is being changed */
  const [changing, setChanging] = useState<string | null>(null);

  const docCards = view.cards.filter((c): c is DocCardView => c.kind === "doc");
  const answers = (view.qlist?.items ?? []).filter((q) => q.answer?.itemId);
  const canConfirm = view.lines.length > 0 && view.visit.status !== "recording" && view.visit.status !== "transcribing";
  // his own recording (no sample file behind it) that ended with no words: not a visit of the story with no transcript
  const emptyRecording = view.lines.length === 0 && seedLines.length === 0 && !view.replayable && view.visit.status !== "confirmed";

  function setVerdict(itemIds: string[], v: Verdict) {
    setVerdicts((x) => {
      const next = { ...x };
      for (const id of itemIds) next[id] = v;
      return next;
    });
  }

  async function confirm() {
    setSaving(true);
    setFailed(false);
    try {
      const out = await postJson<{ view: VisitView }>(`/api/visits/${encodeURIComponent(view.visit.id)}/confirm`, sessionId, {
        mine: [...mine],
        items: verdicts,
        locale,
      });
      setView(out.view);
      setSaved(true);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  /** After he confirmed: one answer changed, saved at once (its history keeps the change). */
  async function change(itemIds: string[], v: Verdict, key: string) {
    if (changing) return;
    setChanging(key);
    setFailed(false);
    try {
      const out = await postJson<{ view: VisitView }>(`/api/visits/${encodeURIComponent(view.visit.id)}/verdict`, sessionId, { items: itemIds, verdict: v, locale });
      setView(out.view);
    } catch {
      setFailed(true);
    } finally {
      setChanging(null);
    }
  }

  /**
   * The two answers of one thing that was said. Before he confirms they are his choices on this screen, sent together;
   * after, they show what the record holds (`kept`) and a tap changes it there.
   */
  const Verdicts = ({ ids, testId, kept }: { ids: string[]; testId: string; kept: Verdict | null }) => {
    const v = saved ? kept : verdicts[ids[0]];
    const busy = changing === testId;
    const pick = (next: Verdict) => (saved ? (v === next ? undefined : void change(ids, next, testId)) : setVerdict(ids, next));
    return (
      <div className={s.verdict} data-testid={testId} data-verdict={v ?? "none"} data-editable={saved ? "true" : "false"}>
        <button
          type="button"
          className={`rp-btn ${v === "right" ? "rp-btn-accent" : "rp-btn-ghost"}`}
          aria-pressed={v === "right"}
          disabled={changing !== null}
          onClick={() => pick("right")}
          data-testid={`${testId}-right`}
        >
          {vt(locale, "review.right")}
        </button>
        <button
          type="button"
          className={`rp-btn ${v === "wrong" ? "rp-btn-chk" : "rp-btn-ghost"}`}
          aria-pressed={v === "wrong"}
          disabled={changing !== null}
          onClick={() => pick("wrong")}
          data-testid={`${testId}-wrong`}
        >
          {vt(locale, "review.wrong")}
        </button>
        {busy ? (
          <span className="text-ink-2" role="status">
            {demoText(locale, "review.changing")}
          </span>
        ) : null}
      </div>
    );
  };

  /** What the record holds for a card: the same answer on every row, else none. */
  const keptOf = (rows: { verdict?: "right" | "wrong" | "unsure" | null }[]): Verdict | null => {
    const first = rows[0]?.verdict;
    return (first === "right" || first === "wrong") && rows.every((r) => r.verdict === first) ? first : null;
  };

  return (
    <div className="flex flex-col gap-4" data-testid="page-visit-review" data-status={view.visit.status}>
      <div>
        <h1 className="text-[28px] font-bold">{vt(locale, "review.title")}</h1>
        <p className="font-semibold">{visitTitle(locale, view.visit)}</p>
        <p className="text-ink-2">
          {view.visit.place} · {view.visit.date}
        </p>
        <span className="rp-count mt-2" data-testid="review-status">
          {vt(locale, `review.status.${view.visit.status}` as VisitKey)}
        </span>
        {view.rewatch ? (
          <p className="mt-2 text-ink-2" data-testid="review-rewatch">
            {demoText(locale, "visit.rewatch")}
          </p>
        ) : null}
      </div>

      {view.lines.length === 0 ? (
        <div className="rp-card" data-testid="review-no-transcript" data-empty-recording={emptyRecording ? "true" : "false"}>
          {/* C2 (real-app 12 「结束时说清『这次没有录到』」): a recording of his own that ended with nothing in it says so;
              a visit of the story that was never replayed here keeps its own sentence */}
          <p>{emptyRecording ? demoText(locale, "review.nothingRecorded") : vt(locale, "review.noTranscript")}</p>
        </div>
      ) : null}

      {seedLines.length > 0 ? (
        <div className="rp-card rp-card-doc" data-testid="review-seed-lines">
          <div className="rp-tag">● {vt(locale, "review.required")}</div>
          {seedLines.map((l) => (
            <div key={l.id} className="mt-3" data-testid={`seed-${l.requiredLine}`}>
              <div className={s.quote}>“{l.text}”</div>
              <div className={`rp-src ${s.src}`}>
                <span>{chipText(locale, "doctor", l.display)}</span>
                {l.tStartMs !== null ? <span>· {formatMs(l.tStartMs)}</span> : null}
              </div>
              {l.clip ? <ClipButton clip={l.clip} locale={locale} testId={`seed-${l.requiredLine}-play`} /> : null}
            </div>
          ))}
        </div>
      ) : null}

      {view.lines.length > 0 ? (
        <section className="rp-card" data-testid="review-mine">
          <h2 className="font-semibold">{vt(locale, "review.mineTitle")}</h2>
          {view.lines.map((l) => {
            const on = mine.has(l.id);
            return (
              <div key={l.id} className={s.reviewLine} data-testid={`review-line-${l.id}`} data-display={l.display} data-role={l.role}>
                <div className={s.txt}>
                  <div>{l.text}</div>
                  <div className={`rp-src ${s.src}`} data-testid={`review-chip-${l.id}`}>
                    <span>{chipText(locale, l.role, l.display)}</span>
                    <span>· {formatMs(l.tStartMs)}</span>
                  </div>
                </div>
                {saved ? null : (
                  <button
                    type="button"
                    className={`rp-btn ${on ? "rp-btn-accent" : "rp-btn-ghost"} shrink-0`}
                    aria-pressed={on}
                    onClick={() =>
                      setMine((m) => {
                        const n = new Set(m);
                        if (n.has(l.id)) n.delete(l.id);
                        else n.add(l.id);
                        return n;
                      })
                    }
                    data-testid={`mine-${l.id}`}
                  >
                    {on ? vt(locale, "review.mine") : vt(locale, "review.notMine")}
                  </button>
                )}
              </div>
            );
          })}
        </section>
      ) : null}

      {docCards.length + answers.length > 0 ? (
        <section data-testid="review-items">
          <h2 className="mb-3 font-semibold">{vt(locale, "review.itemsTitle")}</h2>
          {docCards.map((c) => (
            <DocCard key={c.id} card={c} locale={locale}>
              <Verdicts ids={c.rows.map((r) => r.itemId)} testId={`verdict-${c.anchor}`} kept={keptOf(c.rows)} />
            </DocCard>
          ))}
          {answers.map((q) => (
            <div key={q.id} className={`rp-qlist mb-4 px-4 py-3`} data-testid={`review-answer-${q.id}`}>
              <span className="rp-tag">{vt(locale, "q.saved")}</span>
              <p className="rp-qt mt-1">{q.text.own ?? (locale === "zh-Hans" ? q.text.zh : q.text.en)}</p>
              <p className="mt-2">“{q.answer!.text}”</p>
              <div className="rp-src">
                {chipText(locale, q.answer!.role, q.answer!.display)} · {formatMs(q.answer!.tStartMs)}
              </div>
              {q.answer!.verdict === "wrong" ? (
                <p className="mt-2 text-body" data-testid={`review-answer-${q.id}-disputed`}>
                  <span className="rp-tag">● {demoText(locale, "review.disputed")}</span>
                  <span className="mt-1 block text-ink-2">{demoText(locale, "review.disputed.kept")}</span>
                </p>
              ) : null}
              {q.answer!.changes ? (
                <p className="rp-src mt-1" data-testid={`review-answer-${q.id}-changed`}>
                  {demoText(locale, q.answer!.changes === 1 ? "review.changed.one" : "review.changed", { n: q.answer!.changes })}
                </p>
              ) : null}
              <Verdicts ids={[q.answer!.itemId!]} testId={`verdict-${q.id}`} kept={keptOf([q.answer!])} />
            </div>
          ))}
        </section>
      ) : null}

      {canConfirm && !saved ? (
        <button type="button" className="rp-btn rp-btn-accent min-h-14" onClick={confirm} disabled={saving} data-testid="review-confirm">
          {vt(locale, "review.save")}
        </button>
      ) : null}
      {saved && view.lines.length > 0 ? (
        <p className="text-ink-2" data-testid="review-saved">
          {vt(locale, "review.saved")}
        </p>
      ) : null}
      {saved && docCards.length + answers.length > 0 ? (
        <p className="text-ink-2" data-testid="review-change-hint">
          {demoText(locale, "review.changeHint")}
        </p>
      ) : null}
      {failed ? <p className="text-ink-2">{vt(locale, "ctrl.failed")}</p> : null}
    </div>
  );
}

/** A visit later than the story day: its title and "not yet", nothing it will contain (day gating). */
export function ReviewNotYet({ view, locale, storyDay }: { view: VisitView; locale: Locale; storyDay: number }) {
  return (
    <div className="flex flex-col gap-4" data-testid="page-visit-review" data-status="not_yet">
      <div>
        <h1 className="text-[28px] font-bold">{vt(locale, "review.title")}</h1>
        <p className="font-semibold">{visitTitle(locale, view.visit)}</p>
      </div>
      <div className="rp-card" data-testid="review-not-yet">
        <p>{vt(locale, "review.notYet", { day: view.visit.day, now: storyDay })}</p>
      </div>
    </div>
  );
}
