/**
 * The four families of the timeline draft (web/progress/fe.md), self-hosted by next/font. Each sets one --rp-ff-*
 * variable on <html> (app/layout.tsx); app/ripple-ui.css composes them into --rp-font-sans and --rp-font-serif.
 * The mono face is the system's (ui-monospace, Menlo, Consolas): the draft loads none.
 *
 * - Noto Sans 400/700/900: Ripple's own words and his own words (Latin).
 * - Noto Sans SC 400/700/900: the same in Chinese.
 * - Noto Serif 400/600: someone else's words, Latin.
 * - Noto Serif SC 400/600: someone else's words, Chinese.
 *
 * The weights are exactly the draft's (its stylesheet link asks Google for these and no others). The draft's styles
 * also write 500 and 800: with these files a browser draws 500 with 400 and 800 with 900, here as in the draft. Do
 * not add 500 or 800: the pages would stop matching it.
 *
 * The two Chinese families have preload off: Google serves them in about a hundred unicode-range slices and the
 * browser downloads only the slices for the glyphs on screen. The Latin families carry no fallback of their own: the
 * stack continues with the Chinese family, and a generic family placed before it would hand Chinese glyphs to the
 * system's font first.
 */
import { Noto_Sans, Noto_Sans_SC, Noto_Serif, Noto_Serif_SC } from "next/font/google";

const sans = Noto_Sans({
  weight: ["400", "700", "900"],
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--rp-ff-sans",
  fallback: [],
  adjustFontFallback: false,
});

const sansZh = Noto_Sans_SC({
  weight: ["400", "700", "900"],
  preload: false,
  display: "swap",
  variable: "--rp-ff-sans-zh",
  fallback: ["PingFang SC", "Microsoft YaHei", "system-ui", "sans-serif"],
  adjustFontFallback: false,
});

const serif = Noto_Serif({
  weight: ["400", "600"],
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--rp-ff-serif",
  fallback: [],
  adjustFontFallback: false,
});

const serifZh = Noto_Serif_SC({
  weight: ["400", "600"],
  preload: false,
  display: "swap",
  variable: "--rp-ff-serif-zh",
  fallback: ["Songti SC", "STSong", "serif"],
  adjustFontFallback: false,
});

/** Class names that declare the four --rp-ff-* variables; add to the <html> className. */
export const rpFontVariables = [sans.variable, sansZh.variable, serif.variable, serifZh.variable].join(" ");
