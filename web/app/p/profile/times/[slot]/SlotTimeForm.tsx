"use client";

/**
 * One part of the day's reminder time (track C; laid out with the timeline draft's pieces by line fe-me): the usual
 * times as chips (the draft's `chips`: the chosen one filled) and 「别的时间」, which opens a time field; the chosen time
 * and the second reminder half an hour later as two nodes of one line (the draft's 01-5f); at the foot 「改好了」, 「不改
 * 了」 and, when the time now is one he set himself, a way to give it back. PATCH /api/profile { reminder_times:
 * { <slot>: … } }; a time outside the part of the day is refused by the server and said here in words.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Said } from "@/components/me/parts";
import { ButtonRow, PrimaryButton, SecondaryButton } from "@/components/ui/Buttons";
import { Chip, Chips, Field } from "@/components/ui/Forms";
import { ActionDock } from "@/components/ui/Screen";
import { Timeline, TimelineItem } from "@/components/ui/Timeline";
import { sendJson } from "@/lib/profile/client";
import { meCopy, onboardCopy, type CLocale } from "@/lib/profile/copy";
import { clockWords } from "@/lib/profile/dates";

export type SlotName = "morning" | "midday" | "evening" | "night";

/**
 * The usual times offered for each part of the day (all inside the part's range, lib/profile/reminder-times.ts).
 * Exported for track F's medicine-add flow, which asks the same question once (components/meds/elder/AddFlow.tsx).
 */
export const CHOICES: Record<SlotName, string[]> = {
  morning: ["06:30", "07:00", "07:30", "08:00", "08:30", "08:45", "09:00", "09:30"],
  midday: ["11:30", "12:00", "12:30", "12:45", "13:00", "13:30"],
  evening: ["17:30", "18:00", "18:30", "18:45", "19:00", "19:30"],
  night: ["20:30", "21:00", "21:30", "22:00", "22:30"],
};

function addMinutes(hhmm: string, min: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const t = Math.min(23 * 60 + 59, h * 60 + m + min);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export function SlotTimeForm({
  locale,
  slot,
  slotName,
  initial,
  own,
  range,
}: {
  locale: CLocale;
  slot: SlotName;
  /** 「中午的药」: the first node's title (left out: the node shows the time alone) */
  slotName?: string;
  initial: string;
  own: boolean;
  range: { from: string; to: string };
}) {
  const c = meCopy(locale);
  const oc = onboardCopy(locale);
  const router = useRouter();
  const times = CHOICES[slot];
  const [time, setTime] = useState<string | null>(initial);
  const [other, setOther] = useState(!times.includes(initial));
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function send(value: string | null, what: "save" | "clear") {
    if (busy) return;
    setBusy(what);
    setProblem(null);
    const r = await sendJson("PATCH", "/api/profile", { reminder_times: { [slot]: value } });
    if (!r.ok) {
      setBusy(null);
      return setProblem(r.data.error === "time_out_of_range" || r.data.error === "time_invalid" ? c.slotRange(clockWords(range.from, locale), clockWords(range.to, locale)) : c.failed);
    }
    router.push("/p/profile/times");
    router.refresh();
  }

  return (
    <>
      <div className="rpu-stack">
        <Chips label={oc.timeLabel}>
          {times.map((t) => (
            <Chip
              key={t}
              on={time === t && !other}
              testId={`slot-time-${t}`}
              onClick={() => {
                setOther(false);
                setTime(t);
              }}
            >
              {clockWords(t, locale)}
            </Chip>
          ))}
          <Chip on={other} testId="slot-time-other" onClick={() => setOther(true)}>
            {oc.otherTime}
          </Chip>
        </Chips>
        {other && <Field className="rpm-f" id="rpc-slot-time" label={oc.timeLabel} type="time" data-testid="slot-time-input" value={time ?? ""} onChange={(e) => e.target.value && setTime(e.target.value)} />}
        {time && (
          <Timeline>
            <TimelineItem node="now" time={clockWords(time, locale)} title={slotName} />
            <TimelineItem node="next" note={c.slotAgain(clockWords(addMinutes(time, 30), locale))} testId="slot-time-again" />
          </Timeline>
        )}
        {problem && (
          <div data-rp="form-problem">
            <Said tone="problem">{problem}</Said>
          </div>
        )}
      </div>
      <ActionDock>
        <ButtonRow cols={2}>
          <SecondaryButton href="/p/profile/times" nav="back">{c.cancel}</SecondaryButton>
          <PrimaryButton pending={busy === "save"} disabled={!time || busy !== null} onClick={() => time && void send(time, "save")} data-testid="slot-time-save">
            {c.save}
          </PrimaryButton>
        </ButtonRow>
        {own && (
          <SecondaryButton pending={busy === "clear"} disabled={busy !== null} onClick={() => void send(null, "clear")} data-testid="slot-time-clear">
            {c.slotClear(slot)}
          </SecondaryButton>
        )}
      </ActionDock>
    </>
  );
}
