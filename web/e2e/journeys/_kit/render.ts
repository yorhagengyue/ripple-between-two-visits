/**
 * What the kit draws. Two kinds:
 *
 * - on the phone screen, through page.screencast.showOverlay (Playwright's own overlay layer: a closed shadow root
 *   outside <body>, no pointer events, re-attached after navigations, so app selectors and text checks never see it):
 *   the notification banner (notificationHtml);
 * - around the phones, rendered once to PNG in finish() and laid over the composed video by ffmpeg: the caption band
 *   with the phone labels for each step (headerHtml) and the frame that rounds the phone corners (frameSvg).
 *
 * Sizes here are CSS pixels; the PNGs are rendered at the recording's device scale factor (2), so they match the
 * phone videos pixel for pixel.
 */

export const FONT_STACK = `"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", "Noto Sans SC", system-ui, sans-serif`;

/** Colours of the composed video. */
export const THEME = {
  background: "#101317",
  caption: "#f5f7fa",
  muted: "#9aa3ad",
  labelOff: "#7d8590",
  labelOn: "#ffffff",
  accent: "#2dd4bf",
  cornerBg: "#f4b400",
  cornerInk: "#1b1b1b",
  phoneEdge: "rgba(255,255,255,0.16)",
};

/** Layout of the composed video, in CSS pixels. */
export const LAYOUT = {
  margin: 16,
  gap: 20,
  /** caption band height (kicker line + up to two caption lines) */
  caption: 112,
  /** label strip under the caption band, above the phones */
  labels: 32,
  bottom: 16,
  radius: 22,
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where each phone sits in the composed frame (CSS px), and the frame's size. */
export function layoutFor(phones: number, viewport: { width: number; height: number }): { width: number; height: number; header: number; boxes: Box[] } {
  const header = LAYOUT.caption + LAYOUT.labels;
  const width = LAYOUT.margin * 2 + phones * viewport.width + (phones - 1) * LAYOUT.gap;
  const height = header + viewport.height + LAYOUT.bottom;
  const boxes = Array.from({ length: phones }, (_, i) => ({
    left: LAYOUT.margin + i * (viewport.width + LAYOUT.gap),
    top: header,
    width: viewport.width,
    height: viewport.height,
  }));
  return { width, height, header, boxes };
}

export interface HeaderSpec {
  width: number;
  /** "07 问一句（含「能不能多吃一粒」）" */
  kicker: string;
  /** "3 / 9", or "" before the first step */
  count: string;
  caption: string;
  corner: string | null;
  labels: { text: string; active: boolean; box: Box }[];
}

/** The caption band and the label strip for one step: one element, #hdr, screenshotted to PNG. */
export function headerHtml(h: HeaderSpec): string {
  const labels = h.labels
    .map(
      (l) =>
        `<div class="lab${l.active ? " on" : ""}" style="left:${l.box.left}px;width:${l.box.width}px"><span class="dot"></span>${escapeHtml(l.text)}</div>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:transparent}
#hdr{position:relative;width:${h.width}px;height:${LAYOUT.caption + LAYOUT.labels}px;background:${THEME.background};color:${THEME.caption};font-family:${FONT_STACK};overflow:hidden}
#cap{position:absolute;left:${LAYOUT.margin}px;right:${LAYOUT.margin}px;top:12px;height:${LAYOUT.caption - 14}px}
#top{display:flex;align-items:center;gap:8px;height:20px;font-size:12px;color:${THEME.muted};white-space:nowrap}
#top .kicker{overflow:hidden;text-overflow:ellipsis;min-width:0}
#top .count{flex:none;font-variant-numeric:tabular-nums}
#top .corner{margin-left:auto;flex:none;background:${THEME.cornerBg};color:${THEME.cornerInk};font-weight:700;padding:2px 9px;border-radius:999px}
#text{margin-top:7px;font-size:23px;line-height:1.32;font-weight:600;letter-spacing:.01em;word-break:break-word}
.lab{position:absolute;top:${LAYOUT.caption}px;height:${LAYOUT.labels}px;display:flex;align-items:center;justify-content:center;gap:7px;font-size:14px;color:${THEME.labelOff};font-family:${FONT_STACK}}
.lab .dot{width:8px;height:8px;border-radius:50%;background:transparent}
.lab.on{color:${THEME.labelOn};font-weight:700}
.lab.on .dot{background:${THEME.accent};box-shadow:0 0 0 3px rgba(45,212,191,.25)}
</style></head><body><div id="hdr"><div id="cap"><div id="top"><span class="kicker">${escapeHtml(h.kicker)}</span>${
    h.count ? `<span class="count">· ${escapeHtml(h.count)}</span>` : ""
  }${h.corner ? `<span class="corner">${escapeHtml(h.corner)}</span>` : ""}</div><div id="text">${escapeHtml(h.caption)}</div></div>${labels}</div></body></html>`;
}

/**
 * Shrinks #text until it fits in two lines (runs in the render page). Returns the font size used.
 */
export function fitCaption(): number {
  const el = document.getElementById("text") as HTMLElement;
  let size = 23;
  for (; size > 15; size--) {
    el.style.fontSize = `${size}px`;
    if (el.scrollHeight <= Math.ceil(size * 1.32 * 2) + 1) break;
  }
  return size;
}

/** Everything outside the phone screens, with rounded screen corners and a thin edge; transparent over the screens. */
export function frameSvg(width: number, height: number, boxes: Box[]): string {
  const r = LAYOUT.radius;
  const holes = boxes
    .map(({ left: x, top: y, width: w, height: h }) =>
      [
        `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}`,
        `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`,
      ].join(""),
    )
    .join("");
  const edges = boxes
    .map((b) => `<rect x="${b.left + 0.5}" y="${b.top + 0.5}" width="${b.width - 1}" height="${b.height - 1}" rx="${r}" fill="none" stroke="${THEME.phoneEdge}" stroke-width="1"/>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{background:transparent}svg{display:block}</style></head><body><svg id="frame" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path fill="${THEME.background}" fill-rule="evenodd" d="M0 0H${width}V${height}H0Z${holes}"/>${edges}</svg></body></html>`;
}

export interface NotificationSpec {
  title: string;
  body: string;
  /** the app name on the banner (default "Ripple") */
  app?: string;
  /** the time on the banner (default "现在") */
  time?: string;
  /** how long it stays, ms */
  durationMs: number;
}

/** A phone-style notification banner that slides in from the top and out again (for showOverlay). */
export function notificationHtml(n: NotificationSpec): string {
  const out = Math.max(0, n.durationMs - 320);
  return `<style>
.rpj-note{position:absolute;top:10px;left:8px;right:8px;display:flex;gap:11px;align-items:flex-start;padding:12px 14px 13px;border-radius:22px;
background:rgba(250,250,250,.97);box-shadow:0 12px 32px rgba(0,0,0,.28),0 0 0 1px rgba(0,0,0,.05);color:#111;font-family:${FONT_STACK};
animation:rpj-in .38s cubic-bezier(.2,.9,.3,1.15) both,rpj-out .3s ease-in ${out}ms forwards}
.rpj-note .ic{flex:none;width:38px;height:38px;border-radius:10px;background:linear-gradient(140deg,#16b3a3,#0b7a6e);color:#fff;font:700 20px/38px ${FONT_STACK};text-align:center}
.rpj-note .tx{flex:1;min-width:0}
.rpj-note .mt{display:flex;justify-content:space-between;font-size:13px;line-height:16px;color:#6b7280;letter-spacing:.03em}
.rpj-note .tt{margin-top:2px;font-size:17px;line-height:22px;font-weight:700}
.rpj-note .bd{margin-top:1px;font-size:16px;line-height:21px;color:#1f2937}
@keyframes rpj-in{from{transform:translateY(-140%);opacity:.3}to{transform:none;opacity:1}}
@keyframes rpj-out{to{transform:translateY(-140%);opacity:0}}
</style><div class="rpj-note"><div class="ic">R</div><div class="tx"><div class="mt"><span>${escapeHtml((n.app ?? "Ripple").toUpperCase())}</span><span>${escapeHtml(
    n.time ?? "现在",
  )}</span></div><div class="tt">${escapeHtml(n.title)}</div><div class="bd">${escapeHtml(n.body)}</div></div></div>`;
}
