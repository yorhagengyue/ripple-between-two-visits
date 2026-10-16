"use client";

/**
 * The film crew's remote for a demo session (/director): the join code for the phones, the story clock (scenes, any day
 * of the story), cues (pop the reminder now, simulate "no reply"), the visit replay, filming mode, reset. Every control is
 * an API call; the result reaches all devices through the session's event stream.
 *
 * C2 (real-status "导演台和评委页"):
 *   - a scene moves the clock AND the phones: they open that scene's page (POST /api/clock { beat, show: true });
 *   - days stay inside the story, Day 0 to Day 43 (the field and the route both refuse others, in words);
 *   - "Start replay" plays the day's sample visit on the phones; "Stop replay" stops it; moving the clock or resetting
 *     stops a running replay first;
 *   - "Simulate no reply" is greyed, with what is recorded, when every tablet of that time already has an answer;
 *   - a refusal reads as a sentence, never an error code; a reset lands on the evening of Day 29, 8:15pm.
 */
import { useState, useSyncExternalStore } from "react";
import { EventFeed } from "@/components/backstage/EventFeed";
import { useLiveEvent, useLiveSession } from "@/components/live/LiveSession";
import { useDoseStates } from "@/components/live/useDoseStates";
import type { BusEvent } from "@/lib/bus";
import { CLOCK_LAST_DAY, OUTSIDE_STORY, plainBeat, STORY_FIRST_DAY } from "@/lib/crew/story";
import { BEATS, currentBeat } from "@/lib/session/beats";
import { ApiError, postJson } from "@/lib/session/client";
import type { MemberView } from "@/lib/session/members";
import { DOSE_SLOT, type DueDose } from "@/lib/session/today";
import { storyDayLabel } from "@/lib/story/clock";

const noSubscribe = () => () => {};

const STATE_WORDS = { taken: "taken", missed: "not taken", unconfirmed: "not confirmed" } as const;

/** A refused call in a sentence the crew can act on (never the code). */
export function directorProblem(err: unknown): string {
  if (!(err instanceof ApiError)) return "That did not work: the server did not answer. Check the connection and try again.";
  switch (err.code) {
    case "outside_story":
      return OUTSIDE_STORY;
    case "end_of_story":
      return "This is the last scene of the story.";
    case "start_of_story":
      return "This is the first scene of the story.";
    case "unknown_beat":
      return "That scene is not in the story.";
    case "no_visit_today":
      return "There is no visit to replay on this day. The visits are on Day 0, Day 8 and Day 42.";
    case "not_found":
      return "This browser is no longer signed in as the film crew. Sign in again on the Crew page.";
    case "crew_key_wrong":
      return "That is not the crew key.";
    case "crew_key_attempts":
      return "Too many wrong crew keys. Wait ten minutes, then try again.";
    case "patient_only":
    case "member_required":
      return "This device cannot do that in this session.";
    case "role_unavailable":
      return "The session's devices could not be read just now. Try again in a moment.";
    default:
      return "That did not work. Try again.";
  }
}

/** Why "Simulate no reply" cannot be pressed now, or null when it can. */
export function noReplyBlocked(doses: Pick<DueDose, "name" | "slot" | "state">[], slot = DOSE_SLOT): string | null {
  const due = doses.filter((d) => d.slot === slot);
  if (due.length === 0) return "No tablet is due on this day, so there is nothing to leave unanswered.";
  const open = due.filter((d) => d.state === null || d.state === "unconfirmed");
  if (open.length > 0) return null;
  return `This day is already recorded: ${due.map((d) => `${d.name} ${STATE_WORDS[d.state as keyof typeof STATE_WORDS] ?? d.state}`).join(", ")}.`;
}

/**
 * `members` as memberView gives them (no ids: a member id is a device's credential); only `role` is used, for the counts.
 * `initialDoses`: the tablets due on the story day (lib/session/today.ts dueDoses), kept live from dose events.
 * `replayVisit`: the sample visit of the story day ("v1" on Day 0, "v2" on Day 8, "v3" on Day 42), or null.
 */
export function DirectorConsole({
  members,
  initialEvents,
  initialDoses = [],
  replayVisit = null,
}: {
  members: MemberView[];
  initialEvents: BusEvent[];
  initialDoses?: DueDose[];
  replayVisit?: string | null;
}) {
  const { session, d0, live } = useLiveSession();
  const host = useSyncExternalStore(noSubscribe, () => window.location.host, () => "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; problem: boolean }>({ text: "", problem: false });
  const [confirmReset, setConfirmReset] = useState(false);
  const [dayInput, setDayInput] = useState(String(session.story_day));
  const [timeInput, setTimeInput] = useState(session.story_time ?? "");
  const [replaying, setReplaying] = useState(false);
  // the day field follows the clock when it moves (from here, the phone's menu or another crew screen)
  const [seenMoment, setSeenMoment] = useState(`${session.story_day} ${session.story_time ?? ""}`);
  if (seenMoment !== `${session.story_day} ${session.story_time ?? ""}`) {
    setSeenMoment(`${session.story_day} ${session.story_time ?? ""}`);
    setDayInput(String(session.story_day));
    setTimeInput(session.story_time ?? "");
  }
  const { doses } = useDoseStates(initialDoses);
  const here = currentBeat(session.story_day, session.story_time);
  const noReplyWhy = noReplyBlocked(doses);

  // a replay is running while sentences arrive; it stops on its own stop cue, a reset, a clock move or the visit ending
  useLiveEvent(
    (event) => {
      const data = (event.data ?? {}) as { cue?: string; visit?: { status?: string } };
      if (event.type === "asr.partial" || event.type === "asr.final") setReplaying(true);
      else if (event.type === "director.cue" && data.cue === "replay_stopped") setReplaying(false);
      else if (event.type === "session.reset" || event.type === "clock.changed") setReplaying(false);
      else if (event.type === "visit.changed" && data.visit?.status && data.visit.status !== "recording") setReplaying(false);
    },
    ["asr.partial", "asr.final", "director.cue", "session.reset", "clock.changed", "visit.changed"],
  );

  async function call(path: string, body: unknown, done: string): Promise<boolean> {
    setBusy(true);
    try {
      await postJson(path, session.id, body);
      setStatus({ text: done, problem: false });
      return true;
    } catch (err) {
      setStatus({ text: directorProblem(err), problem: true });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const counts = members.reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.role]: (acc[m.role] ?? 0) + 1 }), {});
  const sceneTitle = (id: string, fallback: string) => plainBeat(id) ?? fallback;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-testid="director-console">
      <div className="flex flex-col gap-5">
        <section className="rp-card">
          <p className="text-[16px] font-semibold uppercase tracking-wide text-ink-2">Join code</p>
          <p className="mt-1 font-mono text-5xl font-bold tracking-[0.2em]" data-testid="join-code">
            {session.join_code}
          </p>
          <p className="mt-2 text-[17px] text-ink-2">
            Each phone signs in on the Crew page first, then opens <span className="font-mono text-ink">{host ? `${host}/join` : "/join"}</span> and
            enters the code, or opens <span className="font-mono text-ink">/join?code={session.join_code}</span>.
          </p>
          <p className="mt-2 text-[17px] text-ink-2" data-testid="member-counts">
            Devices joined:{" "}
            {Object.keys(counts).length
              ? Object.entries(counts)
                  .map(([role, n]) => `${n} ${role}`)
                  .join(", ")
              : "none yet"}{" "}
            · {live === "open" ? "connected" : live === "connecting" ? "connecting" : "disconnected"}
          </p>
        </section>

        <section className="rp-card">
          <p className="text-[16px] font-semibold uppercase tracking-wide text-ink-2">Story clock</p>
          <p className="mt-1 text-3xl font-bold tabular-nums" data-testid="director-day-label">
            {storyDayLabel({ d0, day: session.story_day, time: session.story_time, locale: "en" })}
          </p>
          <p className="mt-1 text-[17px] text-ink-2">{here ? sceneTitle(here.id, here.title) : "Between scenes"}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rp-btn rp-btn-ghost min-h-11 text-[17px]"
              disabled={busy}
              onClick={() => void call("/api/clock", { beat: "prev", show: true }, "Moved to the previous scene; the phones follow.")}
              data-testid="director-prev-beat"
            >
              ← Previous scene
            </button>
            <button
              type="button"
              className="rp-btn rp-btn-accent min-h-11 text-[17px]"
              disabled={busy}
              onClick={() => void call("/api/clock", { beat: "next", show: true }, "Moved to the next scene; the phones follow.")}
              data-testid="director-next-beat"
            >
              Next scene →
            </button>
          </div>
          <ol className="mt-3 grid gap-1">
            {BEATS.map((b) => {
              const active = here?.id === b.id;
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void call("/api/clock", { beat: b.id, show: true }, `Jumped to “${sceneTitle(b.id, b.title)}”; the phones follow.`)}
                    className={`min-h-11 w-full rounded-xl px-3 py-2 text-left text-[17px] ${active ? "bg-surface-2 font-semibold" : "hover:bg-surface-2"}`}
                    aria-current={active ? "step" : undefined}
                    data-testid={`beat-${b.id}`}
                  >
                    <span className="inline-block w-48 tabular-nums text-ink-2">{storyDayLabel({ d0, day: b.day, time: b.time, locale: "en" })}</span>
                    {sceneTitle(b.id, b.title)}
                  </button>
                </li>
              );
            })}
          </ol>
          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            // the console says why in a sentence; the browser's own bubble (min/max) would say it in its words instead
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              const day = Number(dayInput);
              if (!Number.isInteger(day) || day < STORY_FIRST_DAY || day > CLOCK_LAST_DAY) {
                setStatus({ text: OUTSIDE_STORY, problem: true });
                return;
              }
              void call("/api/clock", { day, time: timeInput || null }, `Jumped to Day ${day}.`);
            }}
          >
            <label className="flex flex-col text-[16px] text-ink-2">
              Day ({STORY_FIRST_DAY}–{CLOCK_LAST_DAY})
              <input
                className="mt-1 min-h-11 w-28 rounded-lg border border-hair-2 bg-surface px-2 py-1.5 text-[17px] text-ink"
                type="number"
                min={STORY_FIRST_DAY}
                max={CLOCK_LAST_DAY}
                step={1}
                value={dayInput}
                onChange={(e) => setDayInput(e.target.value)}
                data-testid="director-day-input"
              />
            </label>
            <label className="flex flex-col text-[16px] text-ink-2">
              Time (optional)
              <input
                className="mt-1 min-h-11 w-36 rounded-lg border border-hair-2 bg-surface px-2 py-1.5 text-[17px] text-ink"
                type="time"
                value={timeInput}
                onChange={(e) => setTimeInput(e.target.value)}
                data-testid="director-time-input"
              />
            </label>
            <button type="submit" className="rp-btn rp-btn-ghost min-h-11 text-[17px]" disabled={busy} data-testid="director-jump">
              Jump to day
            </button>
          </form>
        </section>
      </div>

      <div className="flex flex-col gap-5">
        <section className="rp-card">
          <p className="text-[16px] font-semibold uppercase tracking-wide text-ink-2">Cues</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              className="rp-btn rp-btn-accent min-h-11 text-lg"
              disabled={busy}
              onClick={() => void call("/api/director/cue", { cue: "reminder" }, "The reminder is on Mr Tan's phones now.")}
              data-testid="director-reminder"
            >
              Pop reminder now
            </button>
            <button
              type="button"
              className="rp-btn rp-btn-ghost min-h-11 text-lg"
              disabled={busy || noReplyWhy !== null}
              aria-describedby="director-no-reply-why"
              onClick={() => void call("/api/director/cue", { cue: "no_reply" }, "No reply recorded: the tablets of this morning are marked not confirmed.")}
              data-testid="director-no-reply"
            >
              Simulate no reply
            </button>
          </div>
          <p className="mt-2 min-h-6 text-[17px] text-ink-2" id="director-no-reply-why" data-testid="director-no-reply-why">
            {noReplyWhy ?? "Marks this morning's unanswered tablets as not confirmed, as if both reminders went unanswered."}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3" data-testid="director-replay">
            <button
              type="button"
              className="rp-btn rp-btn-ghost min-h-11 text-lg"
              disabled={busy || !replayVisit}
              aria-describedby="director-replay-why"
              onClick={() =>
                void call("/api/director/replay", { action: "start" }, "The phones open the visit and play it.").then((ok) => {
                  if (ok) setReplaying(true);
                })
              }
              data-testid="director-replay-start"
            >
              Start replay
            </button>
            <button
              type="button"
              className="rp-btn rp-btn-ghost min-h-11 text-lg"
              disabled={busy}
              onClick={() =>
                void call("/api/director/replay", { action: "stop" }, "The replay is stopped.").then((ok) => {
                  if (ok) setReplaying(false);
                })
              }
              data-testid="director-replay-stop"
            >
              Stop replay
            </button>
          </div>
          <p className="mt-2 text-[17px] text-ink-2" id="director-replay-why" data-testid="director-replay-why" data-running={replaying ? "true" : "false"}>
            {replaying
              ? "A replay is playing on the phones."
              : replayVisit
                ? "Plays this day's visit on the phones, sentence by sentence."
                : "There is no visit on this day. The visits are on Day 0, Day 8 and Day 42."}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="rp-btn rp-btn-ghost min-h-11 text-lg"
              disabled={busy}
              aria-pressed={session.filming_mode}
              onClick={() => void call("/api/director/filming", { on: !session.filming_mode }, session.filming_mode ? "Filming mode is off." : "Filming mode is on: larger text, no crew tools on the phones.")}
              data-testid="director-filming"
            >
              Filming mode: {session.filming_mode ? "ON" : "off"}
            </button>
            {confirmReset ? (
              <>
                <button
                  type="button"
                  className="rp-btn rp-btn-ghost min-h-11 text-lg font-bold text-ink ring-2 ring-ink/50"
                  disabled={busy}
                  onClick={() => {
                    setConfirmReset(false);
                    void call("/api/session/reset", {}, "The session is back at the start of the story's records, on Day 29, 8:15pm.");
                  }}
                  data-testid="director-reset-confirm"
                >
                  Yes, reset everything
                </button>
                <button type="button" className="rp-btn rp-btn-ghost min-h-11 text-lg" onClick={() => setConfirmReset(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className="rp-btn rp-btn-ghost min-h-11 text-lg" disabled={busy} onClick={() => setConfirmReset(true)} data-testid="director-reset">
                Reset session…
              </button>
            )}
          </div>
          <p
            className={`mt-3 min-h-6 text-[17px] ${status.problem ? "font-semibold text-ink" : "text-ink-2"}`}
            role={status.problem ? "alert" : "status"}
            data-testid="director-status"
            data-problem={status.problem ? "true" : "false"}
          >
            {status.text}
          </p>
        </section>
        <EventFeed initial={initialEvents} compact />
      </div>
    </div>
  );
}
