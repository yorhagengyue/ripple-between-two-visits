/**
 * Ripple UI tokens as data, for code that needs them outside CSS (tests, the /design gallery's swatches).
 * The source of truth is app/ripple-ui.css; tests/unit/ui/contrast.test.ts reads that file and checks it
 * agrees with these tables. Safe to import from client components.
 *
 * Two systems share the file:
 * - Mr Tan's phone (elder side): --rp-* variables, .rpu-* classes. The values are the timeline draft's
 *   (web/progress/fe.md, owner 2026-10-11): cool paper, white cards with a 1px line, one accent, no speaker colours.
 *   Who said a thing is the node's shape plus words (NODE_OF_SOURCE), never a colour of its own.
 * - Wei Ling's phone (daughter side): --rpf-* variables, .rpf-* classes. The v3 draft (Ripple-Daughter-v3, the
 *   fe-d track): its colours verbatim, its weak grey lightened wherever it is text (see FAMILY_COLOURS[].note),
 *   hairlines as solid hexes, its see-through lines as it writes them (FAMILY_LINES).
 */

export type UiLocale = "zh-Hans" | "en";

/** Who said it or where it is written. Decides the icon, the word and the colour of a source tag. */
export type SourceKind = "doctor" | "dispenser" | "pharmacist" | "label" | "leaflet" | "family" | "self" | "ripple";

/** Speakers whose exact words go in <Said> (serif). Ripple's and his own words never do. */
export type SpeakerKind = "doctor" | "pharmacist" | "dispenser" | "family";

export interface ColourToken {
  name: string;
  value: string;
  use: string;
  /**
   * "text": must reach 4.5:1 on its ground; "rule": a line or border that has to be seen (3:1);
   * "decor": exempt (hairline, ground tint); "fill": a background other text sits on.
   */
  role: "ground" | "text" | "rule" | "decor" | "fill";
  /** why a value differs from the design source, when it does */
  note?: string;
}

/** The elder side's page ground. */
export const PAPER = "#F2F5F9";

export const COLOURS: readonly ColourToken[] = [
  { name: "--rp-paper", value: "#F2F5F9", use: "the page", role: "ground" },
  { name: "--rp-white", value: "#FFFFFF", use: "cards, buttons, fields", role: "ground" },
  { name: "--rp-tint", value: "#E1E7EE", use: "grey box, the segmented control's groove, separators inside a list", role: "decor" },
  { name: "--rp-ink", value: "#18202C", use: "body, titles, the secondary button's border and words", role: "text" },
  { name: "--rp-ink-2", value: "#2C3644", use: "the Chinese translation under English words, the second line in a box", role: "text" },
  { name: "--rp-ink-3", value: "#475263", use: "source lines, subtitles, idle tabs, placeholders, text chevrons", role: "text" },
  { name: "--rp-line", value: "#D5DCE5", use: "1px hairline and card border (not text)", role: "decor" },
  { name: "--rp-line-2", value: "#C3CCD8", use: "the timeline's rule, idle option and small-button borders, the 我 circle", role: "decor" },
  {
    name: "--rp-edge",
    value: "#8592A3",
    use: "not text: dashed frames, past nodes, the empty radio ring, input borders",
    role: "rule",
    note: "3.16:1 on the white it encloses, 2.89:1 on paper; the draft's value, kept for lines only (owner 10-11)",
  },
  { name: "--rp-accent", value: "#6A4C93", use: "primary button, Ripple's node and name, links, the current tab", role: "text" },
  { name: "--rp-accent-ink", value: "#6A4C93", use: "accent words (the same purple: the draft has one)", role: "text" },
  { name: "--rp-urgent", value: "#A4262C", use: "995, deleting, an error", role: "text" },
];

/** Grounds other things sit on (each pair is checked in FILL_PAIRS). */
export const TINTS: readonly ColourToken[] = [
  { name: "--rp-accent-press", value: "#4E3672", use: "a pressed accent button", role: "fill" },
  { name: "--rp-accent-soft", value: "#EEE8F5", use: "Ripple's bubble, the tinted box", role: "decor" },
  { name: "--rp-accent-halo", value: "#E3DAF0", use: "the ring around the node that is now", role: "decor" },
  { name: "--rp-rec", value: "#E5484D", use: "the recording dot (on ink)", role: "decor" },
  { name: "--rp-rec-halo", value: "#562C36", use: "the dot's halo: rgba(229,72,77,.3) over ink", role: "decor" },
  { name: "--rp-on-ink-2", value: "#C3CCD8", use: "the second line on an ink ground", role: "decor" },
  { name: "--rp-on-ink-3", value: "#D5DCE5", use: "the second line in an ink box", role: "decor" },
  { name: "--rp-off", value: "#6B7684", use: "the words on a disabled button", role: "decor", note: "3.34:1 on --rp-line; a disabled control is exempt from AA" },
];

/** Foreground-on-background pairs that are not "text on paper". */
export const FILL_PAIRS: readonly { fg: string; bg: string; use: string }[] = [
  { fg: "--rp-on-accent", bg: "--rp-accent", use: "primary button label" },
  { fg: "--rp-on-accent", bg: "--rp-accent-press", use: "primary button, pressed" },
  { fg: "--rp-on-ink", bg: "--rp-ink", use: "undo bar, recording bar, the dark button" },
  { fg: "--rp-on-ink-2", bg: "--rp-ink", use: "the second line on the undo bar and the recording bar" },
  { fg: "--rp-on-ink-3", bg: "--rp-ink", use: "the second line in an ink box" },
  { fg: "--rp-on-urgent", bg: "--rp-urgent", use: "the 995 card, a red button" },
  { fg: "--rp-urgent", bg: "--rp-on-urgent", use: "「打 995」 on the white button of the red card" },
  { fg: "--rp-accent", bg: "--rp-accent-soft", use: "accent words on the tinted box" },
  { fg: "--rp-ink", bg: "--rp-accent-soft", use: "Ripple's sentence in its bubble" },
  { fg: "--rp-ink-2", bg: "--rp-accent-soft", use: "the second line in the tinted box" },
  { fg: "--rp-ink", bg: "--rp-tint", use: "the grey box" },
  { fg: "--rp-ink-3", bg: "--rp-tint", use: "an idle item of the segmented control" },
  { fg: "--rp-ink", bg: "--rp-white", use: "secondary buttons, cards" },
  { fg: "--rp-ink-3", bg: "--rp-white", use: "source lines and placeholders on white" },
];

/**
 * Daughter side: the v3 draft (Ripple-Daughter-v3). Fills and text colours are the draft's own; hairlines are the solid
 * hexes of its white 7% and 12% over the ground, so axe can measure text that sits next to them. What differs from the
 * draft is said in each `note`.
 */
export const FAMILY_BG = "#0A0C0F";

export const FAMILY_COLOURS: readonly ColourToken[] = [
  { name: "--rpf-page", value: "#05070A", use: "outside the phone column (wide screens)", role: "ground" },
  { name: "--rpf-bg", value: "#0A0C0F", use: "page ground", role: "ground" },
  { name: "--rpf-surface", value: "#15181C", use: "inputs, the bottom sheet, the skeleton, a disabled button", role: "ground" },
  { name: "--rpf-surface-2", value: "#1E2227", use: "the chosen half of 中/EN", role: "ground" },
  { name: "--rpf-ink", value: "#F2F5F6", use: "the large sentence, text, values, button words", role: "text" },
  { name: "--rpf-ink-2", value: "#9AA1A6", use: "the line under a sentence, row names, notes, plain-word buttons", role: "text" },
  {
    name: "--rpf-ink-3",
    value: "#80878C",
    use: "words the draft sets in its weak grey: a week that cannot be opened, a disabled button",
    role: "text",
    note: "the draft's #6A7176 is under 4.5:1 on the ground; lightened to pass AA wherever it is text",
  },
  { name: "--rpf-dim", value: "#6A7176", use: "the draft's weak grey where it is not text: the dashed 「还没到」 ring, an earlier timeline node, the sheet's handle", role: "rule" },
  { name: "--rpf-teal", value: "#37C2BA", use: "the solid button, the taken mark, the record key, a live recording's shape", role: "fill" },
  { name: "--rpf-teal-ink", value: "#5FD4CC", use: "teal on the dark ground: 「开」, 「正在放」, 「看看」, the play key, links", role: "text" },
  { name: "--rpf-doc", value: "#4CB3E6", use: "the gallery's doctor event only; not on her pages (the draft has no blue)", role: "fill" },
  { name: "--rpf-doc-ink", value: "#7CC8EE", use: "the gallery's doctor event only", role: "text" },
  { name: "--rpf-chk", value: "#E6B45A", use: "amber: only no reply and not taken (rings, the word under them, the call button)", role: "text" },
  { name: "--rpf-rec", value: "#E5534B", use: "not drawn on her pages any more (the draft records in teal)", role: "text" },
  { name: "--rpf-banner", value: "#25292F", use: "rgba(40,44,50,.9) on the ground: the phone's notification, drawn as a preview", role: "ground" },
  { name: "--rpf-banner-ink", value: "#D5D9DB", use: "the notification's text", role: "text" },
  { name: "--rpf-banner-dim", value: "#BAC0C4", use: "the notification's 「现在」", role: "text" },
];

export const FAMILY_WASHES: readonly ColourToken[] = [
  { name: "--rpf-hair", value: "#1B1D20", use: "rgba(255,255,255,.07) on the ground: rows and groups", role: "decor" },
  { name: "--rpf-hair-2", value: "#27292C", use: "rgba(255,255,255,.12) on the ground: the timeline rule, the 中/EN outline, an open step", role: "decor" },
  { name: "--rpf-edge", value: "#5C6368", use: "dashed frames in the gallery (3:1)", role: "rule" },
  { name: "--rpf-teal-line", value: "#1E5E5C", use: "rgba(55,194,186,.45) on the ground: the gallery's event rule", role: "decor" },
  { name: "--rpf-doc-line", value: "#285770", use: "rgba(76,179,230,.45) on the ground: the gallery's event rule", role: "decor" },
  { name: "--rpf-chk-line", value: "#6D5831", use: "rgba(230,180,90,.45) on the ground: the gallery's event rule", role: "decor" },
];

/** The draft's see-through lines, written as it writes them. Outlines and rules only: no text sits on them. */
export const FAMILY_LINES: readonly { name: string; value: string; use: string }[] = [
  { name: "--rpf-w10", value: "rgba(255, 255, 255, .1)", use: "an input's outline" },
  { name: "--rpf-w14", value: "rgba(255, 255, 255, .14)", use: "the rule after +65" },
  { name: "--rpf-w16", value: "rgba(255, 255, 255, .16)", use: "the dotted line ahead of a live recording" },
  { name: "--rpf-w18", value: "rgba(255, 255, 255, .18)", use: "a small tag's outline (代录音, 语音, 打字)" },
  { name: "--rpf-w20", value: "rgba(255, 255, 255, .2)", use: "the outlined button" },
  { name: "--rpf-w22", value: "rgba(255, 255, 255, .22)", use: "the rule left of someone's words" },
  { name: "--rpf-w28", value: "rgba(255, 255, 255, .28)", use: "a step's number ring" },
  { name: "--rpf-teal-22", value: "rgba(55, 194, 186, .22)", use: "the halo of the recording dot" },
  { name: "--rpf-teal-50", value: "rgba(95, 212, 204, .5)", use: "the record key's outer ring, 「听原声」" },
  { name: "--rpf-teal-60", value: "rgba(95, 212, 204, .6)", use: "today's ring, the play circle" },
  { name: "--rpf-scrim", value: "rgba(5, 7, 10, .74)", use: "behind the bottom sheet" },
];

export const FAMILY_PAIRS: readonly { fg: string; bg: string; use: string }[] = [
  { fg: "--rpf-ink", bg: "--rpf-bg", use: "the large sentence and text on the page" },
  { fg: "--rpf-ink-2", bg: "--rpf-bg", use: "secondary text on the page" },
  { fg: "--rpf-ink-3", bg: "--rpf-bg", use: "a week that cannot be opened" },
  { fg: "--rpf-ink-3", bg: "--rpf-surface", use: "a disabled button's words" },
  { fg: "--rpf-ink-2", bg: "--rpf-surface", use: "a placeholder in an input; the bottom sheet's second line" },
  { fg: "--rpf-ink", bg: "--rpf-surface", use: "what she types; the bottom sheet's sentence" },
  { fg: "--rpf-ink", bg: "--rpf-surface-2", use: "the language in use, on 中/EN" },
  { fg: "--rpf-teal-ink", bg: "--rpf-bg", use: "teal words" },
  { fg: "--rpf-doc-ink", bg: "--rpf-bg", use: "the gallery's doctor event" },
  { fg: "--rpf-chk", bg: "--rpf-bg", use: "「没吃」, 「没回」, amber words" },
  { fg: "--rpf-rec", bg: "--rpf-bg", use: "kept for the token table" },
  { fg: "--rpf-on-teal", bg: "--rpf-teal", use: "the solid button's words" },
  { fg: "--rpf-on-chk", bg: "--rpf-chk", use: "the amber call button's words" },
  { fg: "--rpf-ink", bg: "--rpf-banner", use: "the notification's title" },
  { fg: "--rpf-banner-ink", bg: "--rpf-banner", use: "the notification's text" },
  { fg: "--rpf-banner-dim", bg: "--rpf-banner", use: "the notification's 「现在」" },
];

/**
 * There are no speaker colours: the kinds that were said at the clinic share the accent, everything else is ink
 * (the same split as the node shapes). Kept for the few rules that still read --rpu-kind.
 */
export const SOURCE_COLOUR: Record<SourceKind, string> = {
  doctor: "--rp-accent",
  dispenser: "--rp-accent",
  pharmacist: "--rp-accent",
  label: "--rp-ink",
  leaflet: "--rp-ink",
  family: "--rp-ink",
  self: "--rp-ink",
  ripple: "--rp-accent",
};

/**
 * The timeline's nodes (the draft's legend). The node says who an entry comes from; it always sits next to words.
 *   me    he himself (filled ink circle)            rip   Ripple's fixed sentence (purple square)
 *   doc   doctor, counter, pharmacist (purple ring) unc   probably the doctor, not confirmed (dashed purple ring)
 *   lab   label, leaflet, official table (ink square outline)   dau   his daughter (ink ring)
 *   sch   his routine (small grey ring)             now   now (purple, with a halo)
 *   next  coming (grey ring)                        ok    done (ink circle with a tick)
 *   miss  no reply, not confirmed, to be filled (dashed grey ring)   sos   995 (red square with !)
 *   dot   a plain point                             wch   his watch (rounded grey square)
 */
export const NODE_KINDS = ["me", "rip", "doc", "unc", "lab", "dau", "sch", "now", "next", "ok", "miss", "sos", "dot", "wch"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/** The node a source kind is drawn with (a guessed doctor is "unc": SourceTag's `inferred`). */
export const NODE_OF_SOURCE: Record<SourceKind, NodeKind> = {
  doctor: "doc",
  dispenser: "doc",
  pharmacist: "doc",
  label: "lab",
  leaflet: "lab",
  family: "dau",
  self: "me",
  ripple: "rip",
};

/**
 * Elder type scale in design px. Every size is written in app/ripple-ui.css as `calc(N * var(--rp-u))`,
 * where --rp-u is 1px at the browser's default text size and grows with the phone's text-size setting.
 * 18 is the floor: the draft's 15, 16 and 17 are lifted to it.
 */
export const TYPE_SCALE = {
  min: 18,
  sub: 19,
  small: 20,
  body: 21,
  filmingBody: 23,
  row: 22,
  secondary: 23,
  saidEn: 24,
  saidZh: 24,
  node: 24,
  action: 26,
  drug: 26,
  ask: 28,
  question: 30,
  headline: 30,
  title: 36,
  reading: 44,
} as const;

/**
 * Daughter type scale (px, written in --rp-u in CSS): the draft's ladder 30 / 17 / 16 and its two special sizes (the
 * recording time 44, the bottom sheet's sentence 26). 16 is the floor: the draft's 15 (labels) and 14 (English state
 * words) are 16 here.
 */
export const FAMILY_TYPE_SCALE = {
  min: 16,
  body: 17,
  title: 26,
  hero: 30,
  value: 26,
  timer: 44,
} as const;

/** Daughter control heights (px): the solid button, the outlined one, plain words, a small one, the top bar. */
export const FAMILY_SIZES = { primary: 56, secondary: 52, text: 48, small: 44, top: 56, gutter: 24 } as const;

/** Hit areas (px at the default text size). */
export const TARGETS = { elder: 48, family: 44, primary: 72, secondary: 64, source: 56 } as const;
