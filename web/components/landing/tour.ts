/**
 * 「从第一天开始看」 on /demo (the film crew's story clock): the story's scenes (lib/session/beats.ts) and the phone page
 * that tells each one, from lib/crew/story.ts (the director's phones follow the same pages). Client-safe, pure data.
 */
export { BEAT_PAGE, pageForBeat } from "@/lib/crew/story";

/** The judge's starting point: Day 29, 8:15pm, Today (the evening of the hero question). */
export const LANDING_DAY = 29;
export const LANDING_TIME = "20:15";
