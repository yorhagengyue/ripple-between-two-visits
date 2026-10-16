/**
 * The story the demo plays (and the filming account is laid out to): Mr Tan's six weeks from the first visit (Day 0)
 * to the day after the third visit (Day 43), the scenes the director jumps between, and the phone page that tells each
 * scene. Pure data and small helpers; client-safe (the director console, the judges' page and the phones use it).
 *
 * The scene ids and times are lib/session/beats.ts's; the words here are what a judge may read (no filming jargon):
 * the beats' own titles stay the director's stage directions.
 */
import { BEATS, type Beat } from "@/lib/session/beats";

/** Day 0: the first visit. */
export const STORY_FIRST_DAY = 0;
/** Day 43: the day after the third visit, the last day the story has records for. */
export const STORY_LAST_DAY = 43;
/**
 * The clock's last day: the story plus two quiet days after it (Days 44 and 45 have no records and no visit). Rehearsals
 * and the demo's dose chain test (e2e/chains/dose.spec.ts: three mornings after the third visit) use them; nothing
 * further is accepted (real-status: Day 99 flooded the backstage with 113 "no reply" rows).
 */
export const CLOCK_LAST_DAY = STORY_LAST_DAY + 2;

/** Where a reset puts the demo's clock: the evening of Day 29, 8:15pm, the hero question (real-status: no time after a reset). */
export const RESET_DAY = 29;
export const RESET_TIME = "20:15";

/** What the crew reads when a day outside the clock's range is asked for. */
export const OUTSIDE_STORY = `The clock runs from Day ${STORY_FIRST_DAY} to Day ${CLOCK_LAST_DAY} (the story's records end on Day ${STORY_LAST_DAY}).`;

/**
 * May the clock go to `day`? Day 0 to Day 45: the story and two quiet days after it (real-status: "第 99 天" flooded
 * no-replies).
 */
export function inStory(day: number): boolean {
  return Number.isInteger(day) && day >= STORY_FIRST_DAY && day <= CLOCK_LAST_DAY;
}

/** The phone page that tells each scene: when the director jumps to a scene, the phones open this page. */
export const BEAT_PAGE: Readonly<Record<string, string>> = {
  "d0-visit": "/p/visit",
  "d1-home": "/p/bp",
  "d3-evening": "/p/bp",
  "d8-visit": "/p/visit",
  "d9-first-dose": "/p/meds/med-amlodipine",
  "d12-pharmacy": "/p/meds/med-relative-box",
  "d15-tai-chi": "/p/today",
  "d29-hero": "/p/today",
  "d37-ankle": "/p/today",
  "d42-visit": "/p/visit",
};

export function pageForBeat(beatId: string | null | undefined): string {
  return (beatId && BEAT_PAGE[beatId]) || "/p/today";
}

/** Each scene as a judge may read it (the beats' titles are stage directions: "Hero shot", "v3 direction"). */
export const BEAT_PLAIN: Readonly<Record<string, { en: string; zh: string }>> = {
  "d0-visit": { en: "First visit to the clinic (Healthier SG check-in)", zh: "第一次就诊（Healthier SG 登记）" },
  "d1-home": { en: "He starts measuring at home in the morning", zh: "早上开始在家测量血压" },
  "d3-evening": { en: "An evening reading he did not record", zh: "晚上一次读数未记录" },
  "d8-visit": { en: "Second visit: the clinic counter hands him the tablets", zh: "第二次就诊，柜台发药" },
  "d9-first-dose": { en: "His first tablet at home", zh: "在家服用第一粒药" },
  "d12-pharmacy": { en: "At the pharmacy with a relative's box of medicine", zh: "带亲戚给的药去药房" },
  "d15-tai-chi": { en: "A tai chi morning: the tablet after breakfast", zh: "打太极的早上，早饭后的药" },
  "d29-hero": { en: "Evening: 150/95, can he take one more tablet?", zh: "晚上 150/95，能不能多吃一粒？" },
  "d37-ankle": { en: "He mentions his ankle", zh: "他说起脚踝" },
  "d42-visit": { en: "Third visit: the follow-up", zh: "第三次就诊：复诊" },
};

/** A scene in words a judge may read; an unknown id falls back to nothing (the caller shows the date alone). */
export function plainBeat(beatId: string | null | undefined, locale: "en" | "zh-Hans" = "en"): string | null {
  const b = beatId ? BEAT_PLAIN[beatId] : undefined;
  return b ? (locale === "en" ? b.en : b.zh) : null;
}

/** The scenes in story order (re-exported so the director's code reads one module). */
export const SCENES: readonly Beat[] = BEATS;

/** The sample visits the phones can replay, by the story day they happen on (lib/visit: v1, v2 and v3). */
export const REPLAYABLE_VISITS: readonly string[] = ["v1", "v2", "v3"];

/** The phone page that starts the replay of a sample visit (app/p/visit: ?replay=<visit>). */
export function replayPage(visitId: string): string {
  return `/p/visit?replay=${encodeURIComponent(visitId)}`;
}
