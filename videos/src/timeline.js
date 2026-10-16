// Shots: { name, a, b, fn } on one timeline in seconds. A shot's fn({ t, lt, dur, ov, wait, stage }) poses the stage for
// time t (lt = time since the shot started), pushes 2D drawing closures onto ov, may hand promises to wait() (images to
// load before painting), and may return look settings { dotK, inkK, ca, bloom }. Frames are pure functions of t.
export const SHOTS = [];
export let DURATION = 0;

export function shot(name, a, b, fn) {
  SHOTS.push({ name, a, b, fn });
  SHOTS.sort((x, y) => x.a - y.a);
  DURATION = Math.max(DURATION, b);
}
export function shotAt(t) {
  for (const s of SHOTS) if (t >= s.a && t < s.b) return { shot: s, lt: t - s.a };
  const last = SHOTS[SHOTS.length - 1];
  return last && t >= last.b ? { shot: last, lt: t - last.a } : { shot: null, lt: 0 };
}
