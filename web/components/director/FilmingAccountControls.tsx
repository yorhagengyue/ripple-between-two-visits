"use client";

/**
 * The director's controls for the filming accounts (C2 track J; journey 21; real-app 5.4). The client half of
 * FilmingAccountPanel: one card per account its owner marked as a filming account, each control a call to
 * /api/crew/filming-account/accounts/[ref]. A refusal reads as the server's sentence, never an error code.
 *
 *   Lay out to a scene   the account's records become the story's as they stood at that scene, and its clock is that
 *                        scene's date and time (the story's own dates: Day 29 8:15pm is Tue 22 Sep 2026, 8:15pm)
 *   Move forward         by some minutes, or to a time (on a date when given); never back
 *   Pop reminder now     the slot's reminder, as the 8:45 job sends it
 *   Simulate no reply    the slot's window closes now with no reply; his family is told when he allows it
 *   Script fallback      for the visit being recorded on his phone today: a sentence the transcription mishears shows
 *                        the scene's script line (on and off; set after the visit started)
 *   End filming          the account is back on its real date, and no longer a filming account
 *
 * C2 follow-up (real-app 12; the same behaviour as the demo console, DirectorConsole.tsx): laying an account out to a
 * scene moves his phone to that scene's page by itself (the server's "show" cue; the phone also re-reads every move),
 * and "Simulate no reply" is greyed with the reason while today's tablets are already recorded ("This day is already
 * recorded: Amlodipine taken."), instead of failing after the tap. The list is read again every few seconds, so the
 * reason follows what he taps on his phone.
 *
 * ux pass 10-13: the story sheet (StorySheet, lib/crew/story-edits.ts) sits above the accounts. It is kept in this
 * browser (localStorage) and goes along with every "Lay out to a scene", so the account is laid out with its changes in.
 */
import { useEffect, useRef, useState } from "react";
import type { FilmingAccountView } from "@/lib/crew/filming-account";
import { plainBeat } from "@/lib/crew/story";
import { countStoryEdits, type StoryEdits, type StorySheetBase } from "@/lib/crew/story-edits";
import { BEATS } from "@/lib/session/beats";
import { formatClockTime, storyDate } from "@/lib/story/clock";
import { sendableStoryEdits, StorySheet, useStorySheet, writeStorySheet } from "./StorySheet";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SLOT_WORDS: Record<string, string> = { morning: "morning", midday: "midday", evening: "evening", night: "bedtime" };
/** how often the list is read again while the tab is in front */
const LIST_REFRESH_MS = 5000;

/** "2026-09-22", "20:15" -> "Tue 22 Sep 2026 · 8:15pm" */
export function filmingMoment(date: string, time: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const wd = WEEKDAYS[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()];
  const day = `${wd} ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return time ? `${day} · ${formatClockTime(time, "en")}` : day;
}

interface ApiAnswer {
  account?: FilmingAccountView | null;
  done?: Record<string, unknown>;
  error?: string;
  detail?: unknown;
}

/** What the director reads after an action. */
export function doneWords(action: string, done: Record<string, unknown> | undefined, account: FilmingAccountView | null): string {
  const now = account ? filmingMoment(account.date, account.time) : "";
  const d = done ?? {};
  switch (action) {
    case "seed": {
      const scene = plainBeat(String(d.scene ?? ""), "en");
      const sheet = Number(d.storyEdits ?? 0);
      return `Laid out to ${scene ? `the scene “${scene}”` : "that moment of the story"}${
        sheet > 0 ? `, with the story sheet's ${sheet} change${sheet === 1 ? "" : "s"}` : ""
      }. The account is now at ${now}. His phone opens that scene's page by itself.`;
    }
    case "forward":
      return `Clock moved forward: the account is now at ${now}. His phone shows it by itself.`;
    case "reminder": {
      const which = d.kind === "dose_first" ? "first" : "second";
      const sent = Number(d.sent ?? 0);
      return `Reminder recorded: the ${SLOT_WORDS[String(d.slot)] ?? String(d.slot)} medicine, ${which} reminder${d.again ? " (sent again)" : ""}. ${
        sent > 0 ? `Sent to ${sent} phone${sent === 1 ? "" : "s"}.` : "No phone of his has reminders switched on, so nothing buzzed; opening Ripple shows it."
      }`;
    }
    case "no_reply": {
      const moved = typeof d.movedTo === "string" ? ` (the clock moved to ${d.movedTo}, when the window closes)` : "";
      const family = Number(d.family ?? 0);
      const told =
        family > 0
          ? `${family} family member${family === 1 ? " was" : "s were"} told.`
          : d.familyWhy === "no_link"
            ? "No family member is linked to this account, so nobody was told."
            : d.familyWhy === "switch_off"
              ? "His switch for telling his family is off, so nobody was told."
              : "His family was already told about this window.";
      return `No reply recorded for the ${SLOT_WORDS[String(d.slot)] ?? String(d.slot)} medicine${moved}. ${told}`;
    }
    case "fallback":
      return `Script fallback ${d.on ? "on" : "off"} for the visit being recorded (${filmingMoment(String(d.date ?? ""), null)}).${
        d.on && d.script === false ? " The story has no script for this day's visit, so it changes nothing." : ""
      }`;
    case "end":
      return `Filming ended: the account is back on its real date (${filmingMoment(String(d.date ?? ""), (d.time as string | null) ?? null)}) and is no longer a filming account.`;
    default:
      return "Done.";
  }
}

function problemWords(status: number, body: ApiAnswer): string {
  if (typeof body.detail === "string" && body.detail) return body.detail;
  if (status === 404) return "This account is not a filming account any more (or this browser is no longer the crew's). Reload the list.";
  if (status === 400) return "The server did not accept that. Check the date and the time.";
  return "That did not work. Try again.";
}

export function FilmingAccountControls({
  initial,
  unavailable = false,
  d0,
  sheetBase,
}: {
  initial: FilmingAccountView[];
  unavailable?: boolean;
  d0: string;
  /** the story's own details, for the story sheet (omitted: no sheet is drawn) */
  sheetBase?: StorySheetBase;
}) {
  const [accounts, setAccounts] = useState<FilmingAccountView[]>(initial);
  const [busy, setBusy] = useState(false);
  // the story sheet: this browser's (the server does not have it)
  const sheet = useStorySheet();
  const story = sendableStoryEdits(sheet);
  const storyCount = countStoryEdits(story);
  const [listNote, setListNote] = useState<string>(unavailable ? "The filming accounts could not be read just now. Reload the list." : "");

  async function reload() {
    setBusy(true);
    try {
      const res = await fetch("/api/crew/filming-account/accounts", { credentials: "same-origin", cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { accounts?: FilmingAccountView[] };
      if (res.ok && body.accounts) {
        setAccounts(body.accounts);
        setListNote("");
      } else setListNote("The list could not be read. Check that this browser is signed in as the crew.");
    } catch {
      setListNote("The server did not answer. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  // the accounts as they stand now, read again quietly every few seconds while this tab is in front: what he taps on his
  // phone (a tablet recorded) then shows here as the reason next to "Simulate no reply". A failed read changes nothing.
  const acting = useRef(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || acting.current > 0) return;
      void fetch("/api/crew/filming-account/accounts", { credentials: "same-origin", cache: "no-store" })
        .then(async (res) => (res.ok ? ((await res.json()) as { accounts?: FilmingAccountView[] }) : null))
        .then((body) => {
          const fresh = body?.accounts;
          // an action answered meanwhile holds the newer row: keep the cards as they are, the next read catches up
          if (!fresh || acting.current > 0) return;
          setAccounts((list) => list.map((a) => fresh.find((x) => x.ref === a.ref) ?? a));
        })
        .catch(() => undefined);
    }, LIST_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  const list = (
    <section className="rp-card mt-5" data-testid="filming-accounts" aria-labelledby="filming-accounts-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="filming-accounts-title" className="text-[16px] font-semibold uppercase tracking-wide text-ink-2">
          Filming accounts
        </h2>
        <button type="button" className="rp-btn rp-btn-ghost min-h-11 text-[17px]" disabled={busy} onClick={() => void reload()} data-testid="filming-reload">
          Reload list
        </button>
      </div>
      <p className="mt-1 text-[17px] text-ink-2">
        Real accounts their owners marked for filming on their own phone (sign in, the crew key at /backstage/crew, then 我 › 拍摄账号). Laying one out
        replaces every record of that account with Mr Tan&apos;s story as it stood at the scene; ordinary accounts never appear here.
      </p>
      {listNote ? (
        <p className="mt-2 text-[17px] text-ink-2" role="status" data-testid="filming-list-note">
          {listNote}
        </p>
      ) : null}
      {accounts.length === 0 ? (
        <p className="mt-3 text-[16px] text-ink-2" data-testid="filming-none">
          No filming account yet.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          {accounts.map((a) => (
            <AccountCard
              key={a.ref}
              account={a}
              d0={d0}
              story={storyCount > 0 ? story : null}
              onActing={(on) => {
                acting.current += on ? 1 : -1;
              }}
              onChange={(next) => setAccounts((list) => (next ? list.map((x) => (x.ref === a.ref ? next : x)) : list.filter((x) => x.ref !== a.ref)))}
            />
          ))}
        </div>
      )}
    </section>
  );
  return (
    <>
      {sheetBase ? <StorySheet base={sheetBase} edits={sheet} onChange={writeStorySheet} /> : null}
      {list}
    </>
  );
}

function AccountCard({
  account,
  d0,
  story,
  onChange,
  onActing,
}: {
  account: FilmingAccountView;
  d0: string;
  /** the story sheet's changes to lay the account out with, or null (the story as it is) */
  story: StoryEdits | null;
  onChange: (next: FilmingAccountView | null) => void;
  /** an action started (true) or ended (false): the list's quiet refresh waits meanwhile */
  onActing: (on: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [time, setTime] = useState("");
  const [date, setDate] = useState("");
  const [fallback, setFallback] = useState(false);
  const a = account;

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    onActing(true);
    try {
      const res = await fetch(`/api/crew/filming-account/accounts/${encodeURIComponent(a.ref)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      const answer = (await res.json().catch(() => ({}))) as ApiAnswer;
      if (!res.ok) {
        setStatus(problemWords(res.status, answer));
        return;
      }
      const next = answer.account ?? null;
      setStatus(doneWords(String(body.action), answer.done, next));
      if (body.action === "fallback") setFallback(answer.done?.on === true);
      if (body.action === "end") {
        // the card stays a moment with the sentence, then leaves the list
        window.setTimeout(() => onChange(null), 4000);
      } else if (next) onChange(next);
    } catch {
      setStatus("The server did not answer. Check the connection and try again.");
    } finally {
      setBusy(false);
      onActing(false);
    }
  }

  const sceneTitle = a.sceneTitle ? ` · ${a.sceneTitle}` : "";
  return (
    <article className="rounded-2xl border border-hair-2 p-4" data-testid={`filming-account-${a.ref}`} data-ref={a.ref} data-date={a.date} data-time={a.time ?? ""}>
      <p className="text-[18px] font-semibold">
        {a.name}
        {a.username ? <span className="font-normal text-ink-2"> · {a.username}</span> : null}
        <span className="ml-2 font-mono text-[17px] text-ink-2" data-testid="filming-ref">
          code {a.ref}
        </span>
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums" data-testid="filming-now">
        {filmingMoment(a.date, a.time)}
      </p>
      <p className="text-[17px] text-ink-2">
        {a.laidOut ? `Day ${a.day} of the story${sceneTitle}` : "Not laid out to the story yet: its own records, its real date."}
        {a.offsetMs ? " · clock moved by the director" : ""}
      </p>

      <p className="mt-4 text-[16px] font-semibold uppercase tracking-wide text-ink-2">Lay out to a scene</p>
      <p className="mt-1 text-[17px] text-ink-2" data-testid="filming-sheet-line">
        {story ? `铺的时候带上故事表的 ${countStoryEdits(story)} 处改动。` : "故事表没有改动：铺的是陈先生原来的故事。"}
      </p>
      <ol className="mt-2 grid gap-1">
        {BEATS.map((b) => (
          <li key={b.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => void act({ action: "seed", scene: b.id, ...(story ? { story } : {}) })}
              className={`min-h-11 w-full rounded-xl px-3 py-2 text-left text-[16px] ${a.scene === b.id ? "bg-surface-2 font-semibold" : "hover:bg-surface-2"}`}
              aria-current={a.scene === b.id ? "step" : undefined}
              data-testid={`filming-scene-${b.id}`}
            >
              <span className="block tabular-nums text-ink-2">{filmingMoment(storyDate(d0, b.day), b.time)}</span>
              <span className="block">{plainBeat(b.id, "en") ?? b.title}</span>
            </button>
          </li>
        ))}
      </ol>

      <p className="mt-4 text-[16px] font-semibold uppercase tracking-wide text-ink-2">Move forward</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {[1, 15, 60].map((m) => (
          <button key={m} type="button" className="rp-btn rp-btn-ghost min-h-11 text-[17px]" disabled={busy || !a.laidOut} onClick={() => void act({ action: "forward", minutes: m })} data-testid={`filming-plus-${m}`}>
            +{m === 60 ? "1 hour" : `${m} min`}
          </button>
        ))}
      </div>
      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!/^\d{1,2}:\d{2}$/.test(time)) return setStatus("Type the time as HH:MM, for example 08:44.");
          const hhmm = time.length === 4 ? `0${time}` : time;
          void act({ action: "forward", time: hhmm, ...(date ? { date } : {}) });
        }}
      >
        <label className="flex flex-col text-[16px] text-ink-2">
          Date (optional)
          <input
            className="mt-1 min-h-11 w-40 rounded-lg border border-hair-2 bg-surface px-2 py-1.5 text-[17px] text-ink"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            data-testid="filming-forward-date"
          />
        </label>
        <label className="flex flex-col text-[16px] text-ink-2">
          Time
          <input
            className="mt-1 min-h-11 w-28 rounded-lg border border-hair-2 bg-surface px-2 py-1.5 text-[17px] text-ink"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            data-testid="filming-forward-time"
          />
        </label>
        <button type="submit" className="rp-btn rp-btn-ghost min-h-11 text-[17px]" disabled={busy || !a.laidOut} data-testid="filming-forward-go">
          Move to this time
        </button>
      </form>

      <p className="mt-4 text-[16px] font-semibold uppercase tracking-wide text-ink-2">Cues</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="rp-btn rp-btn-accent min-h-11 text-[17px]" disabled={busy} onClick={() => void act({ action: "reminder" })} data-testid="filming-reminder">
          Pop reminder now
        </button>
        <button
          type="button"
          className="rp-btn rp-btn-ghost min-h-11 text-[17px]"
          disabled={busy || a.noReplyWhy !== null}
          aria-describedby={`filming-no-reply-why-${a.ref}`}
          onClick={() => void act({ action: "no_reply" })}
          data-testid="filming-no-reply"
        >
          Simulate no reply
        </button>
        <button
          type="button"
          className="rp-btn rp-btn-ghost min-h-11 text-[17px]"
          disabled={busy}
          aria-pressed={fallback}
          onClick={() => void act({ action: "fallback", on: !fallback })}
          data-testid="filming-fallback"
        >
          Script fallback: {fallback ? "on" : "off"}
        </button>
        <button type="button" className="rp-btn rp-btn-ghost min-h-11 text-[17px]" disabled={busy} onClick={() => void act({ action: "end" })} data-testid="filming-end">
          End filming
        </button>
      </div>
      <p className="mt-2 min-h-6 text-[17px] text-ink-2" id={`filming-no-reply-why-${a.ref}`} data-testid="filming-no-reply-why">
        {a.noReplyWhy ?? "Simulate no reply: this slot's window closes now with no answer, and his family is told when he allows it."}
      </p>
      <p className="mt-3 min-h-6 text-[17px] text-ink-2" role="status" data-testid="filming-status">
        {status}
      </p>
    </article>
  );
}
