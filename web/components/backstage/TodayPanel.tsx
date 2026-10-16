"use client";

/**
 * Backstage "now" panel: the story day and today's dose states, updated live from the same events the phones use. The
 * film crew (crew: the rp_crew cookie, on /backstage and on /demo with the crew's cookie) also sees the join code and
 * filming mode; a judge reads no filming words (real-status: "rehearsal" on the judges' page).
 */
import { useDoseStates } from "@/components/live/useDoseStates";
import { useLiveSession } from "@/components/live/LiveSession";
import type { DueDose } from "@/lib/session/today";
import { storyDayLabel } from "@/lib/story/clock";

const STATE_TEXT = { taken: "taken", missed: "not taken", unconfirmed: "not confirmed" } as const;
const SLOT_TEXT: Record<string, string> = { morning: "morning", midday: "midday", evening: "evening", night: "night" };

export function TodayPanel({ initial, crew = true }: { initial: DueDose[]; crew?: boolean }) {
  const { session, d0, live } = useLiveSession();
  const { doses } = useDoseStates(initial);
  return (
    <section className="rp-card" data-testid="today-panel">
      <p className="text-[18px] font-semibold uppercase tracking-wide text-ink-2">Now</p>
      <p className="mt-1 text-2xl font-bold tabular-nums" data-testid="backstage-day-label">
        {storyDayLabel({ d0, day: session.story_day, time: session.story_time, locale: "en" })}
      </p>
      {crew ? (
        <p className="mt-1 text-[18px] text-ink-2" data-testid="today-panel-crew">
          Join code {session.join_code} · {session.filming_mode ? "filming mode on" : "filming mode off"} · {live === "open" ? "connected" : live === "connecting" ? "connecting" : "disconnected"}
        </p>
      ) : (
        <p className="mt-1 text-[18px] text-ink-2">{live === "open" ? "Live: what happens on the phone shows here at once." : "Connecting to the phone…"}</p>
      )}
      <h3 className="mt-4 text-[18px] font-semibold text-ink-2">Doses due today</h3>
      {doses.length === 0 ? (
        <p className="mt-1 text-[18px] text-ink-2">None</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {doses.map((d) => (
            <li
              key={d.medication_id}
              className="flex justify-between gap-4 text-[18px]"
              data-testid={`backstage-dose-${d.medication_id}`}
              data-state={d.state ?? "none"}
            >
              <span>
                {d.name} {d.strength ?? ""} · {SLOT_TEXT[d.slot] ?? d.slot}
              </span>
              <span className="font-semibold">{d.state ? STATE_TEXT[d.state] : "not recorded"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
