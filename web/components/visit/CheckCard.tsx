"use client";

/**
 * Yellow "Check" card (v3 .card.c): his own records next to what he just said. Counts and averages are his
 * records; quoted lines are verbatim (the doctor's R1 with its chip, his label, his own note); the
 * unknown-medicine line is lib/safety's fixed sentence. The comparison line on the chart is R1 only, and
 * only when R1 exists; without it the card shows the average and the count, nothing else.
 * "Show the doctor" opens the card full screen.
 */
import { useState } from "react";
import { t, type Locale } from "@/lib/i18n";
import { weekdayShort } from "@/lib/story/clock";
import { shortDate, vt } from "@/lib/visit/strings";
import type { CheckCardView } from "@/lib/visit/types";
import { chipText } from "./labels";
import s from "./styles";

const BAR_FLOOR = 100;
const BAR_SPAN = 80;
const pct = (sys: number) => Math.max(8, Math.min(100, ((sys - BAR_FLOOR) / BAR_SPAN) * 100));

function Body({ card, locale }: { card: CheckCardView; locale: Locale }) {
  if (card.check === "bp") {
    const target = card.target;
    return (
      <>
        <div className="rp-tag">● {vt(locale, "chk.bp.tag")}</div>
        <div className={s.cardBody} data-testid={`chk-${card.anchor}-summary`}>
          {vt(locale, "chk.bp.summary", {
            from: shortDate(card.fromDate, locale),
            to: shortDate(card.toDate, locale),
            n: card.recorded,
            s: card.avgSystolic,
            d: card.avgDiastolic,
          })}
          {card.unconfirmed > 0 ? ` ${vt(locale, "chk.bp.unconfirmed", { n: card.unconfirmed })}` : ""}
        </div>
        {target ? (
          <>
            <div className={s.cardBody} data-testid={`chk-${card.anchor}-target`}>
              {vt(locale, "chk.bp.vsTarget", {
                k: card.notBelow ?? 0,
                n: card.recorded,
                s: target.systolic,
                d: target.diastolic,
                date: shortDate(target.date, locale),
              })}
            </div>
            <div className={`${s.quote} ${s.quoteChk}`} data-testid={`chk-${card.anchor}-quote`}>
              “{target.quote}”
            </div>
            <div className={`rp-src ${s.src}`}>
              <span>{chipText(locale, "doctor", target.display)}</span>
              <span>· {shortDate(target.date, locale)}</span>
            </div>
          </>
        ) : null}
        <div className={s.bars} data-testid={`chk-${card.anchor}-bars`} data-ref={target ? `${target.systolic}/${target.diastolic}` : ""}>
          {target ? (
            <>
              <span className={s.ref} style={{ bottom: `${pct(target.systolic)}%` }} />
              <span className={`rp-src ${s.reflab}`} style={{ bottom: `${pct(target.systolic)}%` }}>
                {target.systolic}/{target.diastolic}
              </span>
            </>
          ) : null}
          {card.bars.map((b, i) => (
            <i key={i} className={b.notBelow ? s.hi : undefined} style={{ height: `${pct(b.systolic)}%` }} />
          ))}
        </div>
        <div className="rp-src">{vt(locale, "chk.bp.src", { n: card.recorded })}</div>
      </>
    );
  }
  if (card.check === "med") {
    const days = [...new Set(card.missedDays.map((d) => weekdayShort(card.d0, d, locale)))];
    const routine = card.routine ? (locale === "zh-Hans" ? card.routine.labelZh ?? card.routine.label : card.routine.label.toLowerCase()) : null;
    return (
      <>
        <div className="rp-tag">● {vt(locale, "chk.med.tag")}</div>
        <div className={s.cardBody}>{vt(locale, "chk.med.label")}</div>
        {card.meds.map((m) => (
          <div key={m.id}>
            <div className={`${s.quote} ${s.quoteChk}`} data-testid={`chk-${card.anchor}-label`}>
              {m.labelLine}
            </div>
            <div className="rp-src">{t(locale, "source.label")}</div>
          </div>
        ))}
        <div className={s.cardBody} data-testid={`chk-${card.anchor}-doses`}>
          {vt(locale, "chk.med.doses", { taken: card.taken, total: card.total })}{" "}
          {card.missed > 0
            ? routine
              ? vt(locale, "chk.med.missedRoutine", { n: card.missed, days: days.join(locale === "zh-Hans" ? "、" : " and "), routine })
              : vt(locale, "chk.med.missedPlain", { n: card.missed })
            : ""}
        </div>
        <div className="rp-src">{vt(locale, "chk.med.src", { from: shortDate(card.fromDate, locale), to: shortDate(card.toDate, locale) })}</div>
      </>
    );
  }
  if (card.check === "note") {
    return (
      <>
        <div className="rp-tag">● {vt(locale, "chk.note.tag")}</div>
        <div className={s.cardBody}>{vt(locale, "chk.note.lead", { date: shortDate(card.note.date, locale) })}</div>
        <div className={`${s.quote} ${s.quoteChk}`} data-testid={`chk-${card.anchor}-note-text`}>
          “{card.note.text}”
        </div>
        <div className="rp-src">
          {t(locale, "source.self")} ·{" "}
          {vt(locale, card.note.source === "voice_note" ? "chk.note.srcVoice" : "chk.note.srcTyped", { date: shortDate(card.note.date, locale) })}
        </div>
      </>
    );
  }
  return (
    <>
      <div className="rp-tag">● {vt(locale, "chk.unknown.tag")}</div>
      <div className={s.cardBody} data-testid={`chk-${card.anchor}-fixed`}>
        {card.en}
      </div>
      {locale === "zh-Hans" ? <div className={s.cardBody}>{card.zh}</div> : null}
      <div className="rp-src">{vt(locale, "chk.unknown.src")}</div>
    </>
  );
}

export function CheckCard({ card, locale }: { card: CheckCardView; locale: Locale }) {
  const [shown, setShown] = useState(false);
  const [later, setLater] = useState(false);
  const cls = `rp-card rp-card-chk ${s.card} ${s.cardChk}`;
  return (
    <>
      <div className={cls} data-testid={`chk-${card.anchor}-${card.check}`} data-kind="chk" data-check={card.check}>
        <Body card={card} locale={locale} />
        {later ? null : (
          <div className={s.acts}>
            <button type="button" className="rp-btn rp-btn-chk" onClick={() => setShown(true)} data-testid={`chk-${card.anchor}-show`}>
              {vt(locale, "chk.show")}
            </button>
            <button type="button" className="rp-btn rp-btn-ghost" onClick={() => setLater(true)}>
              {vt(locale, "chk.later")}
            </button>
          </div>
        )}
      </div>
      {shown ? (
        <div className={s.overlay} role="dialog" aria-modal="true" data-testid={`chk-${card.anchor}-overlay`}>
          <div className={cls}>
            <Body card={card} locale={locale} />
          </div>
          <div className={s.acts}>
            <button type="button" className="rp-btn rp-btn-ghost" onClick={() => setShown(false)}>
              {vt(locale, "chk.close")}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
