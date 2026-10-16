"use client";

/**
 * Today's dose states, kept live: starts from the server's DueDose list and applies every dose.logged
 * event of the session straight from its payload (no server round trip), so a tick on one phone shows
 * on the other phone and the backstage screen within the 1 s budget. session.reset drops the local
 * overrides; the debounced router.refresh() then brings the restored seed.
 */
import { useState } from "react";
import type { BusEvent } from "@/lib/bus";
import type { DoseLoggedData } from "@/lib/session/events";
import { doseKey, type DueDose } from "@/lib/session/today";
import type { DaySlot, DoseState } from "@/lib/store/types";
import { useLiveEvent } from "./LiveSession";

export function useDoseStates(initial: DueDose[]): {
  doses: DueDose[];
  setLocal(medicationId: string, day: number, slot: DaySlot, state: DoseState): void;
} {
  const [overrides, setOverrides] = useState<Record<string, DoseState>>({});

  useLiveEvent(
    (event: BusEvent) => {
      if (event.type === "session.reset") {
        setOverrides({});
        return;
      }
      const { dose } = event.data as DoseLoggedData;
      if (!dose) return;
      setOverrides((prev) => ({ ...prev, [doseKey(dose.medication_id, dose.day, dose.slot)]: dose.state }));
    },
    ["dose.logged", "session.reset"],
  );

  const doses = initial.map((d) => ({ ...d, state: overrides[doseKey(d.medication_id, d.day, d.slot)] ?? d.state }));
  const setLocal = (medicationId: string, day: number, slot: DaySlot, state: DoseState) =>
    setOverrides((prev) => ({ ...prev, [doseKey(medicationId, day, slot)]: state }));
  return { doses, setLocal };
}
