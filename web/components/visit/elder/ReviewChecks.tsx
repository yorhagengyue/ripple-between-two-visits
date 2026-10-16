/**
 * The check cards on his account: what he said in the visit, next to his own records (C2 track F, fix round;
 * real-app 4.4 「核对卡和简报用同一口径」, 4.6; web/progress/g.md 「旅程查到的」 7: no account screen showed them).
 *
 * Where: on the review's summary, right after the visit, before and after 「就这样，存好」. Not while he records:
 * real-app 2.13 lists that screen in full (the red dot, the time, two captions, 「已经记下 N 件事」, one button) and says
 * Ripple does not speak during the visit; the cards are counted in that N and shown here.
 *
 * What a card says is his records, counted as the brief counts at the moment the visit started (lib/visit/account-check
 * .ts with track B's visitCheckSummary), in the brief's own sentences (lib/summary/i18n.ts, components/brief/words.ts):
 *   readings   how many, the average, how many were not below the number the doctor gave at an earlier visit, and the
 *              doctor's sentence itself, word for word, with who said it (a guess until he confirmed it there). Readings
 *              are never judged: the one comparison mirrors the doctor's own number.
 *   medicine   the label's first line word for word, how many doses of how many, the missed ones as the brief says them
 *   his note   his own words, as he wrote them
 *   a medicine nobody can identify   lib/safety's fixed sentence
 * Above each: the line of the visit that brought it up, word for word (whose line it is stays a guess until he confirms).
 *
 * Laid out after the timeline draft (web/progress/fe-05.md; the draft draws no check card): a section of the record,
 * one entry of a line per card. The entry is a plain point (the line of the visit that brought it up is nobody's
 * confirmed word here); under that line a white card holds his records, each quoted piece under the node of its
 * source. Hooks: data-testid="review-checks" (data-count), "review-check" (data-check, data-anchor, and the numbers as
 * data attributes), "review-check-said", "review-check-target"; quoted words carry data-verbatim (or the quote face,
 * data-rp="said"), the comparison line data-mirror, as on the brief.
 */
import type { ReactNode } from "react";
import { missedText } from "@/components/brief/words";
import { Said, SectionTitle, SourceTag, Timeline, TimelineItem } from "@/components/ui";
import { shortDay } from "@/lib/daily/i18n";
import { bt } from "@/lib/summary/i18n";
import { at, type AccountLocale } from "@/lib/visit/account-copy";
import { vt } from "@/lib/visit/strings";
import type { CheckCardView, VisitView } from "@/lib/visit/types";
import "./visit-elder.css";

/**
 * The check cards of a view, in the order of the visit, each record once: his readings and his doses are the same
 * numbers whichever line of the visit brought them up (one window, one moment), so the first line that did stands for
 * them; a note of his is shown once however often it came up.
 */
export function checkCards(view: Pick<VisitView, "cards">): CheckCardView[] {
  const seen = new Set<string>();
  return view.cards.filter((c): c is CheckCardView => {
    if (c.kind !== "chk") return false;
    const key = c.check === "note" ? `note:${c.note.id}` : c.check;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** One sentence about his records, in the plain face (the brief's own sentence). */
function Fact({ children, strong = false, lang }: { children: ReactNode; strong?: boolean; lang?: string }) {
  return (
    <p className="rpu-visit-fact" data-rp-role="body" data-strong={strong ? "true" : undefined} lang={lang}>
      {children}
    </p>
  );
}

function Records({ card, locale }: { card: CheckCardView; locale: AccountLocale }) {
  if (card.check === "bp") {
    const t = card.target;
    return (
      <>
        <Fact strong>{bt(locale, "brief.bp.title")}</Fact>
        <Fact>{card.recorded === 1 ? bt(locale, "brief.bp.summaryOne", { s: card.avgSystolic, d: card.avgDiastolic }) : bt(locale, "brief.bp.summary", { n: card.recorded, s: card.avgSystolic, d: card.avgDiastolic })}</Fact>
        {card.unconfirmed > 0 ? <Fact>{bt(locale, "brief.bp.unconfirmed", { n: card.unconfirmed })}</Fact> : null}
        {t && card.notBelow !== null ? (
          <span style={{ display: "contents" }} data-testid="review-check-target" data-state={t.display === "confirmed" ? "confirmed" : "inferred"}>
            {/* the one comparison: it mirrors the doctor's own number (as the brief's line does, data-mirror) */}
            <span style={{ display: "contents" }} data-mirror="target">
              <Fact>{bt(locale, "brief.bp.mirror", { n: card.notBelow, s: t.systolic, d: t.diastolic, date: shortDay(locale, t.date) })}</Fact>
            </span>
            <SourceTag kind="doctor" inferred={t.display !== "confirmed"} locale={locale} when={shortDay(locale, t.date)} />
            <Said lang="en" source={{ kind: "doctor", ref: `${t.visitId}:target` }} style={{ margin: 0 }}>
              “{t.quote}”
            </Said>
          </span>
        ) : null}
      </>
    );
  }
  if (card.check === "med") {
    const missed = card.doses ? missedText(locale, card.doses) : null;
    return (
      <>
        <Fact strong>{bt(locale, "brief.doses.title")}</Fact>
        {card.meds.map((m) => (
          <span key={m.id} style={{ display: "contents" }} data-testid="review-check-label" data-med={m.id} data-verbatim="label">
            <SourceTag kind="label" locale={locale} />
            <p className="rpu-visit-printed" lang="en" translate="no">
              {m.labelLine}
            </p>
          </span>
        ))}
        <Fact>{bt(locale, "brief.doses.headline", { taken: card.taken, due: card.total })}</Fact>
        {missed ? <Fact>{missed}</Fact> : null}
        {card.unconfirmed > 0 ? (
          <Fact>
            {bt(locale, "brief.doses.unconfirmed")} {card.unconfirmed}
          </Fact>
        ) : null}
      </>
    );
  }
  if (card.check === "note") {
    return (
      <>
        <Fact strong>{vt(locale, "chk.note.lead", { date: shortDay(locale, card.note.date) })}</Fact>
        <span style={{ display: "contents" }} data-testid="review-check-note" data-verbatim="self">
          <SourceTag kind="self" locale={locale} />
          <Fact>“{card.note.text}”</Fact>
        </span>
      </>
    );
  }
  // lib/safety's fixed sentence about a medicine nobody can identify, as it is
  return (
    <>
      <Fact lang="en">{card.en}</Fact>
      {locale === "zh-Hans" ? <Fact>{card.zh}</Fact> : null}
    </>
  );
}

const numbers = (card: CheckCardView): Record<`data-${string}`, string | number | undefined> =>
  card.check === "bp"
    ? { "data-count": card.recorded, "data-avg": `${card.avgSystolic}/${card.avgDiastolic}`, "data-not-below": card.notBelow ?? "", "data-from": card.fromDate, "data-to": card.toDate }
    : card.check === "med"
      ? { "data-due": card.total, "data-taken": card.taken, "data-missed": card.missed, "data-unconfirmed": card.unconfirmed, "data-from": card.fromDate, "data-to": card.toDate }
      : card.check === "note"
        ? { "data-note": card.note.id }
        : {};

export function ReviewChecks({ view, locale }: { view: VisitView; locale: AccountLocale }) {
  const cards = checkCards(view);
  if (!cards.length) return null;
  const said = new Map(view.lines.map((l) => [l.id, l]));
  return (
    <section className="rpu-visit-group" data-testid="review-checks" data-count={cards.length}>
      <SectionTitle>{at(locale, "review.checks.section")}</SectionTitle>
      <Timeline>
        {cards.map((card) => {
          const line = said.get(card.anchor);
          return (
            <TimelineItem key={card.id} node="dot" testId="review-check" attrs={{ "data-check": card.check, "data-anchor": card.anchor, ...numbers(card) }}>
              {line ? (
                <span style={{ display: "contents" }} data-testid="review-check-said" data-verbatim="visit">
                  <p className="rpu-visit-note" data-rp-role="body" lang={line.lang?.startsWith("zh") ? "zh-Hans" : "en"}>
                    {at(locale, "review.checks.said")}“{line.text}”
                  </p>
                </span>
              ) : null}
              <div className="rpu-sub" data-rp="sub-card">
                <div className="rpu-sub-main" style={{ gap: 8 }}>
                  <Records card={card} locale={locale} />
                </div>
              </div>
            </TimelineItem>
          );
        })}
      </Timeline>
    </section>
  );
}
