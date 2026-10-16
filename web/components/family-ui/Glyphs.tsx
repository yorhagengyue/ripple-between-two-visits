/**
 * The few drawings of her screens, as the v3 draft draws them (inline, no icon set): the way back, the small chevrons,
 * the tick, the bell, the play triangle. Each is decorative: the words next to it say what it is. Sizes come from CSS
 * (calc(N * var(--rp-u))); the width and height here are only the fallback.
 */
import type { CSSProperties } from "react";

interface GlyphProps {
  className?: string;
  style?: CSSProperties;
}

const base = { "aria-hidden": true, focusable: false, fill: "none" } as const;

/** The way back, at the left of the top bar (28px). */
export function BackGlyph(p: GlyphProps) {
  return (
    <svg {...base} {...p} width="28" height="28" viewBox="0 0 24 24" data-glyph="back">
      <path d="M14.5 5.5L8 12l6.5 6.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A row that opens a screen (16px). */
export function ChevronRight(p: GlyphProps) {
  return (
    <svg {...base} {...p} width="16" height="16" viewBox="0 0 16 16" data-glyph="chevron">
      <path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The week before (16px). */
export function ChevronLeft(p: GlyphProps) {
  return (
    <svg {...base} {...p} width="16" height="16" viewBox="0 0 16 16" data-glyph="chevron-left">
      <path d="M10 3.5L5.5 8 10 12.5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The tick inside a teal mark; `stroke` 2.2 in the large marks, 2.6 in the small ones. */
export function CheckGlyph({ stroke = 2.2, ...p }: GlyphProps & { stroke?: number }) {
  return (
    <svg {...base} {...p} width="16" height="16" viewBox="0 0 16 16" data-glyph="check">
      <path d="M3.5 8.3l3 3L12.5 5" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The small solid bell: no reply. */
export function BellGlyph(p: GlyphProps) {
  return (
    <svg {...base} {...p} width="14" height="14" viewBox="0 0 14 14" data-glyph="bell">
      <path d="M7 1.6c-2 0-3.4 1.5-3.4 3.5v2.5L2.3 9.6h9.4L10.4 7.6V5.1C10.4 3.1 9 1.6 7 1.6z" fill="currentColor" />
      <circle cx="7" cy="11.6" r="1.4" fill="currentColor" />
    </svg>
  );
}

/** The play triangle. */
export function PlayGlyph(p: GlyphProps) {
  return (
    <svg {...base} {...p} width="14" height="16" viewBox="0 0 14 16" data-glyph="play">
      <path d="M2.5 1.8v12.4L12.5 8z" fill="currentColor" />
    </svg>
  );
}
