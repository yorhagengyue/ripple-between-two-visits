/**
 * Story beats for the director remote ("next beat", "jump to beat"). Pure data, client-safe.
 *
 * Days come from docs/plan/visits-script.md (日子 table) and web-app.md section 5. The clock times are
 * stage directions for filming, not clinical facts; change them freely.
 */
import { isClockTime, parseClockTime } from "@/lib/story/clock";

export interface Beat {
  id: string;
  day: number;
  /** "HH:MM" story time */
  time: string;
  /** director label (English, staff screens) */
  title: string;
}

export const BEATS: readonly Beat[] = [
  { id: "d0-visit", day: 0, time: "09:30", title: "First visit: Healthier SG check-in" },
  { id: "d1-home", day: 1, time: "07:40", title: "Home readings start (morning)" },
  { id: "d3-evening", day: 3, time: "21:00", title: "Evening reading not recorded" },
  { id: "d8-visit", day: 8, time: "10:00", title: "Second visit, clinic counter dispenses" },
  { id: "d9-first-dose", day: 9, time: "08:45", title: "First tablet at home" },
  { id: "d12-pharmacy", day: 12, time: "11:00", title: "Pharmacy: the relative's box" },
  { id: "d15-tai-chi", day: 15, time: "08:45", title: "Tai chi morning, after breakfast check-in" },
  { id: "d29-hero", day: 29, time: "20:15", title: "Hero shot: 150/95 in the evening" },
  { id: "d37-ankle", day: 37, time: "18:00", title: "He mentions his ankle" },
  { id: "d42-visit", day: 42, time: "09:30", title: "Third visit (v3 direction)" },
];

/** Minutes since D0 00:00, for ordering. A missing time counts as the start of the day. */
function position(day: number, time: string | null | undefined): number {
  const minutes = time && isClockTime(time) ? parseClockTime(time) : 0;
  return day * 24 * 60 + minutes;
}

export function findBeat(id: string): Beat | null {
  return BEATS.find((b) => b.id === id) ?? null;
}

/** First beat strictly after (day, time); null at the end of the story. */
export function nextBeat(day: number, time: string | null | undefined): Beat | null {
  const here = position(day, time);
  return BEATS.find((b) => position(b.day, b.time) > here) ?? null;
}

/** Last beat strictly before (day, time); null before the first beat. */
export function prevBeat(day: number, time: string | null | undefined): Beat | null {
  const here = position(day, time);
  let found: Beat | null = null;
  for (const b of BEATS) if (position(b.day, b.time) < here) found = b;
  return found;
}

/** The beat the clock is sitting on exactly, if any. */
export function currentBeat(day: number, time: string | null | undefined): Beat | null {
  const here = position(day, time);
  return BEATS.find((b) => position(b.day, b.time) === here) ?? null;
}
