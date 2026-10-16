/**
 * 「留意」 on her phone, drawn (/f/alert; owner 10-14: it shows what needs attention, each item with its detail and a
 * follow-up, and sums everything routine up in one line):
 *
 *   the next planned visit   one row, under no heading, whenever he has one planned
 *   「需要留意」               the items of his last 14 days, newest first, each a card: when; the fact; his reason or
 *                            the lines that go with it; then the follow-up: 「建议问医生」 with the question and
 *                            「加入问题单」, or 「可以做的」 with 「打电话给爸爸」. With none: one quiet sentence
 *   「其余记录」               one line counted from the routine entries of his last 7 days, and the way to her calendar
 *
 * No state and no data of its own: the server builds the entries (lib/care/record.ts herRecord), the live screen
 * (AlertScreen) hands in what her switches allow right now, where each tap on 「加入问题单」 stands, and what a tap does.
 * The pure helpers her screen needs are here, because the builder's own module is server-only:
 *
 *   allowedEntries(entries, grants)   what his switches still allow: a kind whose switch is off is gone, and so is a
 *                                     part one switch alone shows (the medicines named under a reminder, a follow-up
 *                                     taken from his question list)
 *   shownEntries(entries, grants)     the same (nothing repeats another entry any more); kept as her screen's name for it
 *   attentionItems / nextVisitRow / restCounts   the three parts of the screen, out of those entries
 *   whenWords(entry, today, …)        「今天 早间」 / 「昨天 8:20」 / 「10月12日 周一 早间」
 *   holdSubject(entry, grants)        what a held card asks Ripple about (components/explain/Explainable.tsx), or null
 *
 * Every card can be held for Ripple's read of it (the long press), except a note; a card of a reminder only while his
 * medicine is shared too (the read is of his medicine). The follow-up keeps its own press: a hold that starts on
 * 「加入问题单」 or on the call button is that button's. Each card carries data-explain-type and data-explain-ref.
 */
import type { ReactNode } from "react";
import { Explainable } from "@/components/explain/Explainable";
import { CheckGlyph, ChevronRight, FamilyButton } from "@/components/family-ui";
import { UiLink } from "@/components/ui/UiLink";
import { dateLine } from "@/lib/care/copy";
import type { RecordEntry } from "@/lib/care/record";
import { rc, restLine, slotWord } from "@/lib/care/record-copy";
import { hmIn } from "@/lib/care/time";
import type { HoldSubject } from "@/lib/explain/subjects";
import type { Locale } from "@/lib/i18n";
import type { FamilyGrantItems } from "@/lib/store/types";
import { cx, type FamilyBaseProps } from "@/lib/ui/props";
import { CallDad } from "./CallDad";
import "./record.css";

type Part = keyof NonNullable<RecordEntry["only"]>;

/** His switches as they are now cut her copy of the record down: nothing a switch that is off was showing stays. */
export function allowedEntries(entries: readonly RecordEntry[], grants: FamilyGrantItems): RecordEntry[] {
  const out: RecordEntry[] = [];
  for (const e of entries) {
    if (!e.switches.some((k) => grants[k])) continue;
    const off = e.only ? (Object.entries(e.only) as [Part, keyof FamilyGrantItems][]).filter(([, k]) => !grants[k]).map(([part]) => part) : [];
    if (!off.length) {
      out.push(e);
      continue;
    }
    const cut: RecordEntry = { ...e };
    for (const part of off) delete cut[part];
    out.push(cut);
  }
  return out;
}

/** What her screen is drawn from: what his switches allow. */
export function shownEntries(entries: readonly RecordEntry[], grants: FamilyGrantItems): RecordEntry[] {
  return allowedEntries(entries, grants);
}

/** The items of 「需要留意」, in the order given (the builder's: newest first). */
export function attentionItems(entries: readonly RecordEntry[]): RecordEntry[] {
  return entries.filter((e) => e.attention);
}

/** The row of the next planned visit, when he has one. */
export function nextVisitRow(entries: readonly RecordEntry[]): RecordEntry | undefined {
  return entries.find((e) => e.kind === "next_visit" && !e.attention);
}

/** What the one line of 「其余记录」 counts: the routine entries, by kind. */
export function restCounts(entries: readonly RecordEntry[]): { doses: number; bp: number; visits: number } {
  const sum = (kind: RecordEntry["kind"]) => entries.reduce((n, e) => (!e.attention && e.kind === kind ? n + (e.count ?? 0) : n), 0);
  return { doses: sum("dose"), bp: sum("bp"), visits: sum("visit") };
}

const shiftDate = (iso: string, days: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * When an item is of: the day (今天, 昨天, else the date with its weekday), then the time he made it, or the part of
 * his day it belongs to. 「今天 早间」, 「昨天 8:20」, 「10月12日 周一 早间」; a day alone when the entry has neither.
 * The visit that is coming says its date and weekday whatever the day (its title is the one that says 今天, 明天).
 */
export function whenWords(entry: Pick<RecordEntry, "day" | "at" | "timed" | "slot"> & Partial<Pick<RecordEntry, "kind">>, today: string, locale: Locale, tz: string): string {
  if (entry.kind === "next_visit") return dateLine(entry.day, locale);
  const day = entry.day === today ? rc(locale, "dayToday") : entry.day === shiftDate(today, -1) ? rc(locale, "dayYesterday") : dateLine(entry.day, locale);
  if (entry.timed) return `${day} ${hmIn(entry.at, tz)}`;
  if (!entry.slot) return day;
  return locale === "zh-Hans" ? `${day} ${slotWord(entry.slot, locale)}` : `${day}, ${slotWord(entry.slot, locale).toLowerCase()}`;
}

/**
 * What holding a card asks Ripple about (lib/explain/subjects.ts): a missed dose and a reminder are that part of that
 * day's medicine, a reading is the reading, the next visit is the next visit. A note has no read; a reminder has one
 * only while his medicine is shared (with the alert alone she is not shown which medicine it was about).
 */
export function holdSubject(entry: Pick<RecordEntry, "kind" | "ref">, grants: Pick<FamilyGrantItems, "dose_summary">): HoldSubject | null {
  switch (entry.kind) {
    case "dose":
      return { type: "dose", ref: entry.ref };
    case "no_reply":
      return grants.dose_summary ? { type: "dose", ref: entry.ref } : null;
    case "bp":
      return { type: "bp", ref: entry.ref };
    case "next_visit":
      return { type: "next_visit", ref: "" };
    default:
      return null;
  }
}

/** How a tap on 「加入问题单」 stands, per entry id (the screen's own state, until the record is read again). */
export type AskState = "busy" | "added" | "failed";

interface Shared {
  locale: Locale;
  /** his time zone: every time on the screen is his */
  tz: string;
  /** his today, YYYY-MM-DD */
  today: string;
  /** how she calls him */
  dad: string;
  linkId: string;
  /** his switches as her screen knows them now */
  grants: FamilyGrantItems;
  /** he has acknowledged her link: until then nothing of hers reaches his phone */
  acknowledged: boolean;
  /** his number saved on this phone, for the call button */
  phone?: string | null;
  onPhone?: (phone: string) => void;
  asks?: Readonly<Record<string, AskState | undefined>>;
  onAdd?: (entry: RecordEntry) => void;
}

/** The lines under a title: his own words in their marks (with who said them), the rest as they are. */
function Lines({ entry, dad, locale }: { entry: RecordEntry; dad: string; locale: Locale }) {
  if (!entry.lines?.length) return null;
  return (
    <>
      {entry.lines.map((line, i) => {
        if (!line.as) {
          return (
            <p key={i} className="rpfr-line">
              {line.text}
            </p>
          );
        }
        // the sentence around his words is the page's; the words keep their own language
        const [before, after] = rc(locale, line.as === "said" ? "whySaid" : "said", { dad, words: "\u0000" }).split("\u0000");
        return (
          <p key={i} className="rpfr-line" data-own-words="true">
            {before}
            <span lang={line.lang ?? undefined}>{line.text}</span>
            {after}
          </p>
        );
      })}
    </>
  );
}

/** 「建议问医生」: the question, and the one tap that puts it on his list (or why there is none). */
function AskBlock({ entry, s }: { entry: RecordEntry; s: Shared }) {
  const ask = entry.ask;
  if (!ask) return null;
  const shared = s.grants.questions_count;
  const state = s.asks?.[entry.id];
  const added = shared && (ask.added || state === "added");
  let foot: ReactNode;
  if (!shared) foot = <p className="rpfr-follow-note" data-testid="ask-off">{rc(s.locale, "addOff", { dad: s.dad })}</p>;
  else if (added) {
    foot = (
      <p className="rpfr-added" data-testid="ask-added">
        <CheckGlyph />
        <span>{rc(s.locale, "added")}</span>
      </p>
    );
  } else if (ask.aside) foot = <p className="rpfr-follow-note" data-testid="ask-aside">{rc(s.locale, "addAside", { dad: s.dad })}</p>;
  else if (!s.acknowledged) foot = <p className="rpfr-follow-note" data-testid="ask-locked">{rc(s.locale, "addLocked", { dad: s.dad })}</p>;
  else {
    foot = (
      <>
        <FamilyButton variant="secondary" className="rpfr-add" pending={state === "busy"} onClick={() => s.onAdd?.(entry)} data-testid="ask-add">
          {rc(s.locale, "addBtn")}
        </FamilyButton>
        {state === "failed" && (
          <p className="rpfr-follow-note" role="alert" data-testid="ask-failed">
            {rc(s.locale, "addFailed")}
          </p>
        )}
      </>
    );
  }
  return (
    <div className="rpfr-follow" data-follow="ask" data-added={added ? "true" : "false"} data-rpx-own="">
      <p className="rpfr-follow-head">{rc(s.locale, ask.for === "pharmacist" ? "followAskPharmacist" : "followAskDoctor")}</p>
      <p className="rpfr-ask" data-testid="ask-text">
        {ask.text}
      </p>
      {foot}
    </div>
  );
}

/** 「可以做的」: the one thing she can do herself, call him. */
function CallBlock({ s }: { s: Shared }) {
  return (
    <div className="rpfr-follow" data-follow="call" data-rpx-own="">
      <p className="rpfr-follow-head">{rc(s.locale, "followDo")}</p>
      <CallDad linkId={s.linkId} locale={s.locale} dad={s.dad} phone={s.phone} variant="secondary" onSaved={s.onPhone} />
    </div>
  );
}

/** One element that can be held for Ripple's read of it, when the entry has one. */
function Held({ entry, s, children }: { entry: RecordEntry; s: Shared; children: ReactNode }) {
  const subject = holdSubject(entry, s.grants);
  if (!subject) return <>{children}</>;
  return (
    <Explainable subject={subject} locale={s.locale} link={s.linkId} label={entry.title}>
      {children}
    </Explainable>
  );
}

function Card({ entry, s }: { entry: RecordEntry; s: Shared }) {
  const subject = holdSubject(entry, s.grants);
  return (
    <li
      className="rpfr-item"
      data-testid="attention-item"
      data-attn={entry.attn}
      data-kind={entry.kind}
      data-day={entry.day}
      data-explain-type={subject?.type ?? entry.kind}
      data-explain-ref={subject ? subject.ref : entry.ref}
    >
      <Held entry={entry} s={s}>
        <article className="rpfr-card">
          {/* several days folded into one item (readings above his doctor's target): its title says the span, its
              lines say each day */}
          {!(entry.attn === "bp_high" && (entry.lines?.length ?? 0) > 1) && (
            <p className="rpfr-when" data-rp="record-when">
              {whenWords(entry, s.today, s.locale, s.tz)}
            </p>
          )}
          <h3 className="rpfr-title">{entry.title}</h3>
          <Lines entry={entry} dad={s.dad} locale={s.locale} />
          <AskBlock entry={entry} s={s} />
          {entry.call && <CallBlock s={s} />}
        </article>
      </Held>
    </li>
  );
}

export function RecordFeed({
  entries,
  shared,
  calendarHref,
  className,
  style,
  ...s
}: FamilyBaseProps &
  Shared & {
    /** what her screen is drawn from (shownEntries): the builder's order */
    entries: readonly RecordEntry[];
    /** he shares at least one kind of record with her (else one sentence says so, and nothing else is drawn) */
    shared: boolean;
    /** her calendar (/f/month), where every day's records are */
    calendarHref: string;
  }) {
  if (!shared) {
    return (
      <p className={cx("rpf rpfr-empty", className)} data-rp="record-empty" data-testid="record-empty" data-shared="false" style={style}>
        {rc(s.locale, "emptyOff", { dad: s.dad })}
      </p>
    );
  }
  const items = attentionItems(entries);
  // a visit within the week with questions waiting is an item below: the plain row would say it twice
  const next = items.some((e) => e.attn === "visit_soon") ? undefined : nextVisitRow(entries);
  const rest = restLine(restCounts(entries), s.locale);
  return (
    <div className={cx("rpf rpfr-feed", className)} data-rp="record-feed" data-testid="record-feed" data-count={items.length} style={style}>
      {next && (
        <div className="rpfr-next" data-testid="record-next" data-kind="next_visit" data-day={next.day} data-explain-type="next_visit" data-explain-ref="">
          <Held entry={next} s={s}>
            <div className="rpfr-next-cells">
              <span className="rpfr-next-main">
                <span className="rpfr-next-title">{next.title}</span>
                <Lines entry={next} dad={s.dad} locale={s.locale} />
              </span>
              {next.value && <span className="rpfr-next-value">{next.value}</span>}
            </div>
          </Held>
        </div>
      )}
      <section className="rpfr-section" data-testid="record-section" data-section="attention">
        <h2 className="rpfr-head">{rc(s.locale, "attnHead")}</h2>
        {items.length ? (
          <ul className="rpfr-cards">
            {items.map((e) => (
              <Card key={e.id} entry={e} s={s} />
            ))}
          </ul>
        ) : (
          <p className="rpfr-none" data-testid="attention-none">
            {rc(s.locale, "attnNone")}
          </p>
        )}
      </section>
      {rest && (
        <section className="rpfr-section" data-testid="record-section" data-section="rest">
          <h2 className="rpfr-head">{rc(s.locale, "restHead")}</h2>
          <p className="rpfr-rest" data-testid="record-rest">
            {rest}
          </p>
          <UiLink href={calendarHref} nav="tab" className="rpfr-restlink" data-testid="record-calendar">
            <span>{rc(s.locale, "restLink")}</span>
            <ChevronRight />
          </UiLink>
        </section>
      )}
    </div>
  );
}
