"use client";

/**
 * Backstage event list (task M8 item 1): every bus event of the session as it happens, oldest at the top and the
 * newest at the bottom, each as one plain sentence (components/backstage/sentences.ts) with its raw data one tap
 * away. Highlighted: sentences the safety layer stopped (which layer and why), who-said-it changes, and scripted
 * fallback. Light background, text at least 18px.
 *
 * Reading position: while the reader is at the bottom, new events scroll into view; once they scroll up to read,
 * new events are added below without moving what they are reading, and a button says how many arrived.
 *
 * C2 (real-status "导演台和评委页"): times are Singapore time (lib/crew/demo-view.ts sgtClock, the same text on the
 * server and in the browser); a row shows the sentence, not the program's event name (that stays in the raw data and
 * in data-type); counts say "1 step", "2 steps".
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLiveEvent } from "@/components/live/LiveSession";
import type { BusEvent } from "@/lib/bus";
import { sgtClock } from "@/lib/crew/demo-view";
import { renderEvent, type EventTone } from "./sentences";

const MAX_ROWS = 300;
/** within this many px of the bottom counts as "at the bottom" (following) */
const FOLLOW_SLACK_PX = 48;

const steps = (n: number) => `${n} ${n === 1 ? "step" : "steps"}`;

const TONE_ROW: Record<EventTone, string> = {
  blocked: "border-l-[6px] border-l-ink bg-surface-2",
  role: "border-l-[6px] border-l-ink-3",
  fallback: "border-l-[6px] border-dashed border-l-ink-2 bg-surface-2",
  plain: "border-l-[6px] border-l-transparent",
};

const TONE_BADGE: Record<EventTone, string> = {
  blocked: "bg-ink text-surface",
  role: "border-2 border-ink text-ink",
  fallback: "border-2 border-dashed border-ink text-ink",
  plain: "",
};

function RawData({ event }: { event: BusEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="mt-1" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} data-testid="event-raw">
      <summary className="flex min-h-11 cursor-pointer items-center text-[18px] text-ink-2 select-none">Raw data</summary>
      {open ? (
        <pre className="mt-2 max-h-[50vh] overflow-auto rounded-lg border border-hair bg-surface p-3 font-mono text-[18px] leading-snug whitespace-pre" data-testid="event-raw-json">
          {JSON.stringify({ id: event.id, type: event.type, at: event.at, say: event.say, data: event.data }, null, 2)}
        </pre>
      ) : null}
    </details>
  );
}

function EventRow({ event }: { event: BusEvent }) {
  const line = renderEvent(event);
  return (
    <li
      className={`flex flex-col gap-1 py-3 pl-3 pr-2 ${TONE_ROW[line.tone]}`}
      data-type={event.type}
      data-tone={line.tone}
      data-known={line.known ? "true" : "false"}
      data-testid="event-row"
      data-event-id={event.id}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <time className="font-mono text-[18px] tabular-nums text-ink-2" dateTime={event.at} title="Singapore time" data-testid="event-time">
          {sgtClock(event.at)}
        </time>
        {line.badge ? (
          <span className={`rounded-md px-2 py-0.5 text-[18px] font-semibold ${TONE_BADGE[line.tone]}`} data-testid="event-badge">
            {line.badge}
          </span>
        ) : null}
      </div>
      <p className="text-[20px] leading-snug" data-testid="event-sentence">
        {line.sentence}
      </p>
      {line.why && line.why.length > 0 ? (
        <ul className="list-disc pl-6 text-[18px] text-ink" data-testid="event-why">
          {line.why.map((w, i) => (
            <li key={`${i}-${w}`}>{w}</li>
          ))}
        </ul>
      ) : null}
      <RawData event={event} />
    </li>
  );
}

export function EventFeed({ initial, compact = false }: { initial: BusEvent[]; compact?: boolean }) {
  const [events, setEvents] = useState<BusEvent[]>(() => initial.slice(-MAX_ROWS));
  const [unseen, setUnseen] = useState(0);
  const box = useRef<HTMLOListElement | null>(null);
  const following = useRef(true);
  const lastCount = useRef(events.length);

  useLiveEvent((event) => {
    if (event.type === "session.reset") {
      following.current = true;
      setUnseen(0);
    } else if (!following.current) {
      setUnseen((n) => n + 1);
    }
    setEvents((prev) => {
      if (prev.some((e) => e.id === event.id)) return prev;
      const base = event.type === "session.reset" ? [] : prev;
      return [...base, event].slice(-MAX_ROWS);
    });
  });

  // start at the newest event
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // follow new events only while the reader is at the bottom
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (events.length !== lastCount.current && following.current) el.scrollTop = el.scrollHeight;
    lastCount.current = events.length;
  }, [events]);

  function onScroll() {
    const el = box.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK_PX;
    following.current = atBottom;
    if (atBottom) setUnseen(0);
  }

  function jumpToNewest() {
    const el = box.current;
    if (!el) return;
    following.current = true;
    setUnseen(0);
    el.scrollTop = el.scrollHeight;
  }

  return (
    <section className="rp-card relative flex flex-col" data-testid="event-feed" aria-label="Backstage events">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[22px] font-bold">Every step, live</h2>
        <span className="text-[18px] text-ink-2" data-testid="event-count">
          {steps(events.length)} · newest at the bottom · Singapore time
        </span>
      </div>
      {events.length === 0 ? (
        <p className="mt-3 text-[18px] text-ink-2" data-testid="event-feed-empty">
          Nothing yet. Ask something on the phone or tick a dose: each step shows here as it happens.
        </p>
      ) : null}
      <ol
        ref={box}
        onScroll={onScroll}
        className={`mt-2 divide-y divide-hair overflow-y-auto overscroll-contain ${compact ? "max-h-[min(70vh,640px)]" : "max-h-[calc(100dvh-220px)] min-h-[320px]"}`}
        data-testid="event-list"
        data-following={unseen === 0 ? "true" : "false"}
      >
        {events.map((e) => (
          <EventRow key={e.id} event={e} />
        ))}
      </ol>
      {unseen > 0 ? (
        <button
          type="button"
          onClick={jumpToNewest}
          className="rp-btn rp-btn-accent absolute bottom-4 left-1/2 min-h-12 -translate-x-1/2 px-5 text-[18px] shadow-sm"
          data-testid="event-new"
          data-count={unseen}
        >
          {unseen} new {unseen === 1 ? "step" : "steps"} ↓
        </button>
      ) : null}
    </section>
  );
}
