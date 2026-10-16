/**
 * 「爸爸跟 Ripple 说了一件可能要留意的事」 on her phone (owner 10-16; lib/care/told.ts). Client-safe, presentational.
 *
 *   ToldCard          one notice on her 「留意」: the amber event line, the sentence, when, his own words, what Ripple
 *                     answered him (each line as his screen showed it; his doctor's words named as theirs), and the
 *                     way to open the conversation. Nothing else is said: no advice of Ripple's own.
 *   ToldConversation  the conversation opened (/f/alert/told): his words, then Ripple's answer, then the line that
 *                     says she is told this whatever he shares
 * Shown whatever his switches say (the baseline): nothing here reads them.
 */
import type { ReactNode } from "react";
import { EventCard, FamilyButton, FamilyNote, Quote } from "@/components/family-ui";
import { dayWords } from "@/lib/care/copy";
import { hc } from "@/lib/care/her-copy";
import { quoted } from "@/lib/care/her-view";
import { whenWords } from "@/lib/care/time";
import type { ToldLine, ToldNotice } from "@/lib/care/told";
import type { Locale } from "@/lib/i18n";

/** 「今天 16:20」 / "Today 4:20" (his clock), as her other screens say a moment. */
export function toldWhen(n: Pick<ToldNotice, "at">, today: string, tz: string, locale: Locale): string {
  const w = whenWords(n.at, today, tz, locale);
  return locale === "en" ? w.charAt(0).toUpperCase() + w.slice(1) : w;
}

/** Whose words a line of Ripple's answer is, when they are a clinician's own (his doctor's warning line). */
function lineWho(l: ToldLine, locale: Locale, dad: string): string | null {
  if (!l.by) return null;
  return l.said ? hc(locale, "toldDoctorSaidOn", { dad, date: dayWords(l.said, locale) }) : hc(locale, "toldDoctorSaid", { dad });
}

/** Ripple's answer to him, line by line, in the words and language he saw them. */
function RippleLines({ lines, locale, dad }: { lines: readonly ToldLine[]; locale: Locale; dad: string }) {
  return (
    <ol className="rpf-told-lines" data-testid="told-lines" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
      {lines.map((l, i) => {
        const who = lineWho(l, locale, dad);
        return (
          <li key={i} data-testid="told-line" data-by={l.by ?? "ripple"}>
            {who && (
              <span className="rpf-event-src" style={{ display: "block" }}>
                {who}
              </span>
            )}
            <span lang={l.lang} data-verbatim="true">
              {l.text}
            </span>
            {l.translation && (
              <span className="rpf-event-src" lang="zh-Hans" style={{ display: "block" }}>
                {l.translation}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** One notice on her 「留意」. */
export function ToldCard({ notice, today, tz, locale, dad, href, call }: { notice: ToldNotice; today: string; tz: string; locale: Locale; dad: string; href: string; call?: ReactNode }) {
  const label = { fontWeight: 600, color: "var(--rpf-ink)", margin: "10px 0 4px" } as const;
  return (
    <div data-testid="told-card" data-told={notice.id}>
      <EventCard
        kind="check"
        tag={hc(locale, "toldTag", { dad })}
        title={hc(locale, "toldTitle", { dad })}
        source={toldWhen(notice, today, tz, locale)}
        actions={
          <>
            <FamilyButton href={href} nav="forward" variant="secondary" size="small" data-testid="told-open">
              {hc(locale, "toldOpen", { dad })}
            </FamilyButton>
            {call}
          </>
        }
      >
        <p style={label}>{hc(locale, "toldHeSaid", { dad })}</p>
        <p className="rpf-event-quote" lang={notice.lang ?? undefined} data-verbatim="true" data-testid="told-words">
          {quoted(notice.words, locale)}
        </p>
        <p style={label}>{hc(locale, "toldRippleSaid", { dad })}</p>
        <RippleLines lines={notice.lines} locale={locale} dad={dad} />
      </EventCard>
    </div>
  );
}

/** The conversation opened: his words and Ripple's answer, as two quotes. */
export function ToldConversation({ notice, today, tz, locale, dad }: { notice: ToldNotice; today: string; tz: string; locale: Locale; dad: string }) {
  const when = toldWhen(notice, today, tz, locale);
  return (
    <section data-testid="told-conversation" data-told={notice.id}>
      <Quote who={`${hc(locale, "toldHeSaid", { dad })} · ${when}`} words={quoted(notice.words, locale)} lang={notice.lang ?? undefined} kind="check" data-testid="told-words" style={{ marginTop: 22 }} />
      <Quote who={hc(locale, "toldRippleSaid", { dad })} words={<RippleLines lines={notice.lines} locale={locale} dad={dad} />} lang={notice.answerLang} style={{ marginTop: 22 }} />
      <FamilyNote style={{ marginTop: 22 }}>{hc(locale, "toldNote", { dad })}</FamilyNote>
    </section>
  );
}

/** On her home (owner 10-16): today's newest notice, one amber line that opens the conversation; nothing of what was said. */
export function ToldHomeLine({ told, linkId, today, tz, locale, dad }: { told: { id: string; at: string }; linkId: string; today: string; tz: string; locale: Locale; dad: string }) {
  return (
    <div data-testid="home-told" data-told={told.id}>
      <EventCard
        kind="check"
        tag={hc(locale, "toldTag", { dad })}
        title={hc(locale, "toldTitle", { dad })}
        source={toldWhen(told, today, tz, locale)}
        actions={
          <FamilyButton href={`/f/alert/told?link=${encodeURIComponent(linkId)}&id=${encodeURIComponent(told.id)}`} nav="forward" variant="secondary" size="small" data-testid="home-told-open">
            {hc(locale, "toldOpen", { dad })}
          </FamilyButton>
        }
      />
    </div>
  );
}
