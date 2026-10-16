"use client";

import { useEffect, useRef, useState } from "react";
import { weekCountWords } from "@/components/bp/copy";
import { weekSoFar } from "@/components/bp/week";
import { Chevron, ListCard, ListenBar, ListItem, Said, SaidTranslation, SourceTag, UiLink } from "@/components/ui";
import { clockWords, dt, longDay, shortDay, shortTime } from "@/lib/daily/i18n";
import { TRANSLATION_LABEL } from "@/lib/translate/label";
import { uiCopy } from "@/lib/ui/copy";
import { clipTime } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";
import { SectionPlaceholder } from "./Placeholder";
import "@/components/bp/bp.css";

/**
 * Today · Blood pressure (section "bp"): the body of the 「量血压」 entry on Today's line, as the timeline draft's 03-4.
 * Owner: B (clock and every day); the over-180 restatement comes from S (on the blood pressure page).
 *
 *   the week      「这周量了 2 次」 and the days (「10月12日、10月16日」), Monday to today: the way to the week on the blood
 *                 pressure page. A count and dates only: never a number of a reading here.
 *   today         with the doctor's frequency he confirmed, one row per part of the day the plan asks for today:
 *                 「该量血压了（早上）」 from its reminder time (it opens the keypad), 「早上量过了 · 8:10」 once there is a
 *                 reading, 「早上这次没量」 once the part passed without one (or he said so), else when it starts (「早上
 *                 8:00 起」); without one: 「记一次」 (it opens the keypad), or how many he recorded today. No reminder,
 *                 nothing ever "missed".
 *   the doctor    his own sentence about how often to measure, with its date, its time point and its recording, next
 *                 to the count (the draft: 「次数旁边只附 Dr Lim 9月1日 0:52 那句」). Nothing judges anything.
 * Without `data` (the /design gallery) it is the placeholder.
 *
 * Where the week and the sentence come from: the Today page hands this cell today's parts and today's count only
 * (app/p/today/page.tsx, another line's), and this file is in the client graph (components/today/index.ts is imported
 * by TodayAccount), so it cannot read the server's data itself. The parts are drawn from the page's data at once, as
 * before; the week's count and the doctor's sentence are read after that from the existing GET /api/bp (his own
 * readings and the doctor's plan: lib/daily/bp.ts accountBpView) and added when they arrive. Without a network the
 * cell stays as the page drew it. When the page passes `week` and `how` itself, nothing is fetched (and `how.zh`, the
 * checked Chinese of the sentence, which only the server can look up, is drawn under the English).
 *
 * Test hooks: bp-section, bp-part-<part> (data-state), bp-cell-week (data-count), bp-cell-days, bp-cell-how.
 */
export interface BpSectionData {
  /** state: a reading in it, not measured (「这次没量」 or the part passed), due now, or later today */
  parts: { part: "morning" | "evening"; remind: string; state: "measured" | "not_measured" | "due" | "later"; time: string | null }[];
  todayCount: number;
  /** this week so far (Monday to today): how many readings, and the days that have one (YYYY-MM-DD) */
  week?: { count: number; days: string[] };
  /** the doctor's sentence about how often; null: he gave none */
  how?: BpHowOften | null;
}

/** The doctor's frequency sentence as the cell quotes it (lib/daily/bp-schedule.ts BpPlanWords, plus its checked Chinese). */
export interface BpHowOften {
  text: string;
  /** YYYY-MM-DD of the visit */
  date: string;
  tStartMs: number | null;
  clipUrl: string | null;
  standIn: boolean;
  /** the record that holds the words */
  sourceRef: string;
  zh?: string | null;
}

const PART_KEY = { morning: "slot.morning", evening: "slot.evening" } as const;
const RECORD_HREF = "/p/bp?do=record";

interface Read {
  week: { count: number; days: string[] };
  how: BpHowOften | null;
}

/** What GET /api/bp answers for an account, as far as this cell reads it. */
interface BpAnswer {
  date?: unknown;
  readings?: { date: string; state: "recorded" | "unconfirmed"; systolic: number | null; diastolic: number | null }[];
  plan?: { words?: { text: string; visitDate: string; tStartMs: number | null; clipUrl: string | null; standIn: boolean; utteranceId: string | null; itemId: string } } | null;
}

function useWeekAndSentence(data: BpSectionData | undefined): Read | null {
  const given = data?.week ? { week: data.week, how: data.how ?? null } : null;
  const [read, setRead] = useState<Read | null>(null);
  const key = data ? `${data.todayCount}|${data.parts.map((p) => `${p.part}:${p.state}:${p.time ?? ""}`).join(",")}` : null;
  const skip = !data || !!given;
  /** what was last asked for (the day and what the page said about today), and which answer is still wanted */
  const asked = useRef<string | null>(null);
  const turn = useRef(0);
  useEffect(() => {
    if (skip) return;
    // the day the page is on (the Today page marks it): a new day, and a new week on Monday, is read again; so is a
    // change in what the page says about today (a reading recorded on another phone). Nothing else asks twice
    const day = document.querySelector('[data-testid="page-today"]')?.getAttribute("data-day") ?? "";
    const mark = `${day}|${key}`;
    if (asked.current === mark) return;
    asked.current = mark;
    const mine = ++turn.current;
    // his own readings and the doctor's plan, from the route the blood pressure page's data comes from. A plain fetch:
    // this is an addition to the cell, so a sign-in that ended or a missing network leaves the cell as the page drew it
    fetch("/api/bp", { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? (res.json() as Promise<BpAnswer>) : null))
      .then((v) => {
        if (turn.current !== mine || !v || typeof v.date !== "string" || !Array.isArray(v.readings)) return;
        const w = v.plan?.words;
        setRead({
          week: weekSoFar(v.readings, v.date),
          how: w ? { text: w.text, date: w.visitDate, tStartMs: w.tStartMs, clipUrl: w.clipUrl, standIn: w.standIn, sourceRef: w.utteranceId ?? w.itemId } : null,
        });
      })
      .catch(() => {
        // not read: the next change may ask again
        if (turn.current === mine) asked.current = null;
      });
  });
  // the cell is gone (he left Today): an answer still on its way is not wanted, and the next time it is asked afresh
  useEffect(
    () => () => {
      turn.current += 1;
      asked.current = null;
    },
    [],
  );
  return given ?? read;
}

export function BpSection({ locale, data }: { locale: UiLocale; data?: BpSectionData }) {
  const zh = locale === "zh-Hans";
  const more = useWeekAndSentence(data);
  if (!data) {
    return (
      <SectionPlaceholder
        section="bp"
        name={zh ? "量血压" : "Blood pressure"}
        owner={zh ? "B 时钟和每一天（血压超过 180 的转述由 S 提供）" : "B (clock and every day); the over-180 restatement comes from S"}
        shows={zh ? "这周量了几次和哪几天；按医生说的频次提醒今天要不要量；旁边只附医生说多久量一次的那句原话。不评判读数。" : "How many readings this week and on which days; whether to measure today, as the doctor said; next to it only the doctor's own sentence about how often. Never a judgement on a reading."}
      />
    );
  }
  const copy = uiCopy(locale);
  const record = dt(locale, "today.bp.record");
  const hook = (part: string, state: string, words: string) => (
    <span data-testid={`bp-part-${part}`} data-state={state}>
      {words}
    </span>
  );
  const week = more?.week && more.week.count > 0 ? more.week : null;
  const how = more?.how ?? null;
  const when = how ? [longDay(locale, how.date), how.tStartMs !== null ? clipTime(how.tStartMs) : null].filter(Boolean).join(" · ") : "";
  return (
    <div data-testid="bp-section" className="rp03-cell">
      {week ? (
        <>
          <UiLink href="/p/bp" nav="forward" className="rp03-cell-week" data-testid="bp-cell-week" data-count={week.count}>
            <span className="rp03-cell-week-t">{weekCountWords(locale, week.count)}</span>
            <Chevron />
          </UiLink>
          <p className="rp03-cell-days" data-testid="bp-cell-days">
            {week.days.map((d) => shortDay(locale, d)).join(zh ? "、" : ", ")}
          </p>
        </>
      ) : null}
      <ListCard>
        {data.parts.length ? (
          data.parts.map((p) => {
            const part = dt(locale, PART_KEY[p.part]);
            if (p.state === "measured") return <ListItem key={p.part} mark="ok" title={hook(p.part, "done", dt(locale, "today.bp.done", { part, time: shortTime(p.time ?? "") }))} chevron href="/p/bp" />;
            if (p.state === "not_measured") return <ListItem key={p.part} mark="miss" title={hook(p.part, "not_measured", dt(locale, "today.bp.notMeasured", { part }))} chevron href="/p/bp" />;
            if (p.state === "due") return <ListItem key={p.part} mark="todo" title={hook(p.part, "due", dt(locale, "today.bp.dueNow", { part }))} right={record} rightTone="accent" chevron href={RECORD_HREF} />;
            return <ListItem key={p.part} mark="todo" title={hook(p.part, "later", dt(locale, "today.bp.dueLater", { part, time: clockWords(locale, p.remind) }))} chevron href="/p/bp" />;
          })
        ) : (
          <ListItem
            title={hook("none", data.todayCount ? "done" : "none", data.todayCount ? dt(locale, "today.bp.count", { n: data.todayCount }) : record)}
            chevron
            href={data.todayCount ? "/p/bp" : RECORD_HREF}
          />
        )}
      </ListCard>
      {how ? (
        <div className="rp03-cell-doc" data-testid="bp-cell-how">
          <SourceTag kind="doctor" locale={locale} when={when || undefined} />
          <Said lang="en" source={{ kind: "doctor", ref: how.sourceRef }}>
            “{how.text}”
          </Said>
          {zh && how.zh ? (
            <div className="rp03-words" lang="zh-Hans" data-testid="bp-cell-how-translation">
              <SaidTranslation note={TRANSLATION_LABEL["zh-Hans"]}>{how.zh}</SaidTranslation>
            </div>
          ) : null}
          {how.clipUrl ? <ListenBar src={how.clipUrl} kind="doctor" time="" label={how.standIn ? copy.listen : copy.listenOriginal} locale={locale} standIn={how.standIn} /> : null}
        </div>
      ) : null}
    </div>
  );
}
