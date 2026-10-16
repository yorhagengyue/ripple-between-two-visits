// Time and motion helpers. Every frame is a pure function of t: no Math.random, no state carried between frames.
export const TAU = Math.PI * 2;
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const seg = (t, a, b) => clamp((t - a) / (b - a));
export const ease = (k) => k * k * (3 - 2 * k);
export const easeOut = (k) => 1 - (1 - k) * (1 - k) * (1 - k);
export const easeIn = (k) => k * k * k;
export const backOut = (k, s = 1.70158) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);
export const elasticOut = (k) => (k === 0 || k === 1 ? k : Math.pow(2, -10 * k) * Math.sin((k * 10 - 0.75) * (TAU / 3)) + 1);
export const hash = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
export const wob = (t, f = 1, ph = 0) => Math.sin(t * f * TAU + ph);
/** Hand-made "boil": a stepped clock at 12 per second, for jitter that looks drawn on twos. */
export const boil = (t) => Math.floor(t * 12);

/** Keyframes: kf(t, [[t0, v0], [t1, v1], ...], easing). Values may be numbers or arrays. */
export function kf(t, keys, fn = ease) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
    if (t <= t1) {
      const k = fn(seg(t, t0, t1));
      return Array.isArray(v0) ? v0.map((x, j) => lerp(x, v1[j], k)) : lerp(v0, v1, k);
    }
  }
  return keys[keys.length - 1][1];
}

/** A pop-in progress with overshoot: 0 before `at`, overshoots, settles at 1 after `len` seconds. */
export const pop = (t, at, len = 0.35) => (t < at ? 0 : backOut(seg(t, at, at + len), 2.4));
/** 0 → 1 → 0 over [a, b] with fades of `f` seconds. */
export const window01 = (t, a, b, f = 0.2) => Math.min(seg(t, a, a + f), 1 - seg(t, b - f, b));
/** Animation on twos (15 poses a second), as measured on the reference: use twos(lt) for character poses and comic
 *  overlays, and the plain time for camera moves. */
export const twos = (t) => Math.floor(t * 15 + 1e-6) / 15; // the epsilon stops frame times like 26.133 rounding down a step
