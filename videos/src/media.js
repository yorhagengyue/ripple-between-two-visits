// Frames of the real app recordings, extracted at 30 fps into media/<clip>/f00001.jpg ... (ffmpeg numbering from 1).
// frame(clip, seconds) resolves to a decoded <img>; a small cache keeps recent frames.
const cache = new Map();
const MAX = 400;
export const FPS = 30;

export function frameUrl(clip, sec) {
  const i = Math.max(1, Math.round(sec * FPS) + 1);
  return `media/${clip}/f${String(i).padStart(5, "0")}.jpg`;
}
export async function frame(clip, sec) {
  window.__logFrame?.(clip, sec); // the sound pass: which recording second is on screen
  return image(frameUrl(clip, sec));
}
export async function image(url) {
  if (cache.has(url)) return cache.get(url);
  const img = new Image();
  img.src = url;
  const p = img.decode().then(() => img).catch(() => null);
  cache.set(url, p);
  if (cache.size > MAX) cache.delete(cache.keys().next().value);
  return p;
}
