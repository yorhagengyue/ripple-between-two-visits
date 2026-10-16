"use client";

/**
 * How Today and the blood pressure page send what he records (C2 track O; real-app 2.25): straight to the server as
 * always, and into the phone's to-send list when the server cannot be reached (lib/offline/client.ts). These two hooks
 * keep the pages' own code (track B's components/daily/elder) to a few changed lines.
 */
import { useMemo } from "react";
import { isOffline, sendBp, sendDose, takeOut, waitingDose, type BpEntryBody, type DoseAnswerBody } from "@/lib/offline/client";
import { offlineCopy } from "@/lib/offline/copy";
import type { Locale } from "@/lib/i18n";
import type { ThresholdRelay } from "@/lib/safety/threshold";
import type { DaySlot } from "@/lib/store/types";
import { localHHMM } from "@/lib/time/clock";
import { useOfflineKit, useOutbox } from "./OfflineProvider";

export interface DoseSent {
  ok: boolean;
  /** when the answer was written: the server's row, or the moment he tapped for one kept on the phone */
  createdAt: string | null;
  /** kept on the phone, not with Ripple yet */
  queued: boolean;
}

/** Today's sender. */
export function useDoseSender(tz: string) {
  const kit = useOfflineKit();
  const entries = useOutbox();
  const holding = entries.filter((e) => e.kind === "dose" && e.state === "waiting").length;
  return useMemo(
    () => ({
      /** medicine answers of his still on the phone */
      holding,
      async answer(medicationId: string, cell: { slot: DaySlot; when: "today" | "yesterday"; date: string }, a: DoseAnswerBody): Promise<DoseSent> {
        const r = await sendDose(kit, { medicationId, slot: cell.slot, when: cell.when, date: cell.date, tz }, a);
        if (r.kind === "sent") return { ok: true, createdAt: r.json.dose?.created_at ?? null, queued: false };
        if (r.kind === "queued") return { ok: true, createdAt: r.at, queued: true };
        return { ok: false, createdAt: null, queued: false };
      },
      /** Undo of an answer that never left the phone: it is taken out of the list. False when nothing of that cell waits. */
      unqueue(medicationId: string, cell: { slot: DaySlot; date: string }): boolean {
        const e = waitingDose(kit, { medicationId, slot: cell.slot, date: cell.date });
        return e ? takeOut(kit, e.id) : false;
      },
    }),
    [kit, tz, holding],
  );
}

/** A reading as POST /api/bp answers it; for one kept on the phone, built here from what he typed and when. */
export interface SentReading {
  id: string;
  day: number;
  slot: DaySlot;
  systolic: number | null;
  diastolic: number | null;
  pulse?: number | null;
  state: "recorded" | "unconfirmed";
  created_at: string;
}

export interface BpSent {
  ok: boolean;
  queued: boolean;
  json: { reading?: SentReading; relay?: ThresholdRelay | null };
}

/**
 * The part of the day of a clock time, as POST /api/bp counts it (C2 track B, second round, real-app 2.9: morning before
 * noon, evening from noon on; lib/daily/bp-changes.ts accountPartAt).
 */
function partOf(hhmm: string): DaySlot {
  const [h] = hhmm.split(":").map(Number);
  return h < 12 ? "morning" : "evening";
}

/** The blood pressure page's sender. */
export function useBpSender(tz: string) {
  const kit = useOfflineKit();
  return useMemo(
    () => ({
      async record(b: BpEntryBody): Promise<BpSent> {
        const r = await sendBp<{ reading?: SentReading; relay?: ThresholdRelay | null }>(kit, b);
        if (r.kind === "sent") return { ok: true, queued: false, json: r.json };
        if (r.kind === "failed") return { ok: false, queued: false, json: {} };
        const skipped = b.state === "unconfirmed";
        const reading: SentReading = {
          id: b.id,
          day: 0,
          slot: partOf(localHHMM(Date.parse(r.at), tz)),
          systolic: skipped ? null : (b.systolic ?? null),
          diastolic: skipped ? null : (b.diastolic ?? null),
          pulse: skipped ? null : (b.pulse ?? null),
          state: skipped ? "unconfirmed" : "recorded",
          created_at: r.at,
        };
        // a reading above the doctor's warning line gets his words only once it has reached the server (no relay here)
        return { ok: true, queued: true, json: { reading, relay: null } };
      },
    }),
    [kit, tz],
  );
}

/** The page's own failure words, or the offline ones when the browser says there is no network. */
export function failureWords(locale: Locale, what: "undo" | "change", otherwise: string): string {
  if (!isOffline()) return otherwise;
  const c = offlineCopy(locale);
  return what === "undo" ? c.undoNeedsNetwork : c.changeNeedsNetwork;
}
