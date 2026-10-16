/**
 * /p/meds/[id] — one medicine's card (task M3 item 3): what it is for (the doctor's own words first, then the
 * leaflet), how to take it (the confirmed label), the leaflet's points, each with its source; 「等药袋确认」 until
 * the label is confirmed; for a medicine Ripple cannot identify, the fixed sentence and his question for the
 * pharmacist with its answer; and 「问这个」 (POST /api/ask). Every line comes from lib/meds/card (lib/safety checked).
 *
 * M5: from the day the doctor said why he takes it (R3, D8 for amlodipine), after the card's own sections comes the
 * explain card 「为什么没感觉也要吃」 (lib/explain/card, R3 playable from its source label, read-aloud) and the
 * understanding checklist (知道 / 不确定; 不确定 goes on his question list). Before that day neither is on the page.
 * R3 is also the first line of the card's purpose section (M3); the explain card repeats it as the reason it gives.
 *
 * His own account (the timeline draft's 06-7 to 06-9): the card is one screen, the explain card and the checklist are
 * screens of their own under the same address, `?view=why` and `?view=check` (components/meds/elder/pages.tsx); any
 * other value is the card.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnswerPicker } from "@/components/meds/AnswerPicker";
import { AccountMedCardPage, type MedCardView } from "@/components/meds/elder/pages";
import { AskThis } from "@/components/meds/AskThis";
import { CardLineView } from "@/components/meds/CardLineView";
import { RelabelButton } from "@/components/meds/RelabelButton";
import { StatusPill } from "@/components/meds/StatusPill";
import { cx } from "@/components/meds/classes";
import { ExplainCard } from "@/components/explain/ExplainCard";
import { UnderstandingChecklist } from "@/components/explain/UnderstandingChecklist";
import { buildExplainCard } from "@/lib/explain/card";
import { understandingView } from "@/lib/explain/understanding";
import { buildMedCardView } from "@/lib/meds/card";
import { mt } from "@/lib/meds/i18n";
import type { CardLine } from "@/lib/meds/types";
import type { Locale } from "@/lib/i18n";
import { getPatientLocale } from "@/lib/session/server";
import { readAloudOffered } from "@/lib/tts";
import { getPageSubject } from "@/lib/subject";

function Section({ title, lines, locale, testId }: { title: string; lines: CardLine[]; locale: Locale; testId: string }) {
  if (lines.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" data-testid={testId}>
      <h2 className="text-[20px] font-bold">{title}</h2>
      {lines.map((l) => (
        <CardLineView key={l.sourceId} line={l} locale={locale} />
      ))}
    </section>
  );
}

export default async function MedDetailPage({ params, searchParams }: PageProps<"/p/meds/[id]">) {
  const [{ id }, ctx, locale, sp] = await Promise.all([params, getPageSubject(), getPatientLocale(), searchParams]);
  if (!ctx) return null;
  // his own account (C2): the elder card (components/meds/elder); the demo below is unchanged
  if (ctx.subject.kind === "account") {
    const view: MedCardView = sp.view === "why" ? "why" : sp.view === "check" ? "check" : "card";
    return <AccountMedCardPage ctx={ctx} locale={locale} medId={decodeURIComponent(id)} view={view} />;
  }
  const store = ctx.store;
  const med = await store.getMed(ctx.session.id, decodeURIComponent(id));
  if (!med) notFound();
  const [card, explain] = await Promise.all([
    buildMedCardView(store, ctx.session.id, med, { day: ctx.session.story_day, locale }),
    buildExplainCard(store, ctx.session.id, med, { day: ctx.session.story_day, locale }),
  ]);
  const understanding = explain ? await understandingView(store, ctx.session.id, med.id) : null;
  const q = card.question;
  // the hidden answer has its own note in the question block; this count is the leaflet parts awaiting review
  const hiddenParts = card.hidden.filter((h) => h.section !== "answer").length;

  return (
    <div className="flex flex-col gap-4" data-testid="page-med-detail" data-med={card.medId} data-status={card.status}>
      <Link href="/p/meds" className="text-ink-2 underline underline-offset-2" data-testid="med-back">
        ← {mt(locale, "card.back")}
      </Link>
      <header className="flex flex-col gap-2">
        <h1 className="text-[28px] font-bold" data-testid="med-name">
          {card.name}
          {/* C2 track E: the Chinese generic name from the fixed table, next to the English name (real-app 12) */}
          {locale === "zh-Hans" && card.zhName ? (
            <span className="ml-2 font-semibold text-ink-2" lang="zh-Hans" data-testid="med-zh-name">
              {card.zhName}
            </span>
          ) : null}
          {card.strength ? <span className="ml-2 font-semibold text-ink-2">{card.strength}</span> : null}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink-2">{mt(locale, `origin.${card.origin}`)}</span>
          <StatusPill status={card.status} locale={locale} />
        </div>
      </header>

      <div className="flex flex-col gap-4" data-testid="med-card">
        {card.awaitingLabel ? (
          <div className="rp-card rp-card-chk flex flex-col gap-2" data-testid="awaiting-label">
            <div className="rp-tag">● {mt(locale, "card.awaiting")}</div>
            <p className="rp-card-body">{mt(locale, "card.awaitingBody")}</p>
            <Link href={`/p/meds/add?med=${encodeURIComponent(card.medId)}`} className={`rp-btn rp-btn-chk ${cx.bigButton}`} data-testid="awaiting-photograph">
              {mt(locale, "card.photograph")}
            </Link>
          </div>
        ) : null}

        <Section title={mt(locale, "card.unknown")} lines={card.unknown} locale={locale} testId="card-unknown" />

        {q ? (
          <section className="rp-qlist" data-testid="card-question" data-status={q.status}>
            <div className="rp-q">
              <span className="rp-tag">● {mt(locale, "card.questionFor")}</span>
              <p className="rp-qt mt-1">{q.text}</p>
              <p className="text-ink-2">{mt(locale, q.status === "answered" ? "card.questionAnswered" : "card.questionOpen")}</p>
            </div>
            {q.answer ? (
              <div className="rp-q flex flex-col gap-2" data-testid="card-answer">
                <p className="font-semibold">{mt(locale, "card.answer")}</p>
                <CardLineView line={q.answer} locale={locale} testId="card-answer-line" />
              </div>
            ) : q.answerHidden ? (
              <p className="rp-q text-ink-2" data-testid="card-answer-hidden" data-speaker={q.answerSpeaker ?? "none"}>
                {mt(locale, q.answerSpeaker ? "card.answerNotShown" : "card.answerUnnamed")}
              </p>
            ) : null}
            {q.answerChoices.length > 0 ? (
              <div className="rp-q">
                <AnswerPicker medId={card.medId} choices={q.answerChoices} locale={locale} />
              </div>
            ) : null}
          </section>
        ) : null}

        <Section title={mt(locale, "card.purpose")} lines={card.purpose} locale={locale} testId="card-purpose" />
        <Section title={mt(locale, "card.howToTake")} lines={card.howToTake} locale={locale} testId="card-how-to-take" />
        <Section title={mt(locale, "card.leaflet")} lines={card.leaflet} locale={locale} testId="card-leaflet" />

        {hiddenParts > 0 ? (
          <p className="text-ink-2" data-testid="card-hidden" data-count={hiddenParts}>
            {mt(locale, hiddenParts === 1 ? "card.hiddenParts" : "card.hiddenPartsMany", { n: hiddenParts })}
          </p>
        ) : null}
      </div>

      {/* 「朗读这张卡」 only while the provider answers (lib/tts: one rule for every read-aloud button) */}
      {explain ? <ExplainCard card={explain} locale={locale} readAloud={readAloudOffered("demo")} /> : null}
      {explain && understanding ? <UnderstandingChecklist medId={med.id} locale={locale} initial={understanding} /> : null}

      {card.drugId && !card.awaitingLabel ? <RelabelButton medId={card.medId} locale={locale} /> : null}
      <AskThis medId={card.medId} locale={locale} />
    </div>
  );
}
