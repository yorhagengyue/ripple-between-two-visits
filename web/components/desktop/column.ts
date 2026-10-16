/**
 * The phone column on a computer, as selectors and numbers (owner, 2026-10-11: on a laptop every phone page is one
 * column in the middle of the window). app/desktop.css is the layout itself and writes these selectors out in full;
 * this module is the same contract for code: the note beside the column (DeskNote.tsx) asks whether the document is a
 * phone page, and e2e/fe-desk.spec.ts measures the column. tests/unit/desktop/desktop-css.test.ts checks that the
 * stylesheet and this file say the same.
 *
 * Plain strings and numbers only: safe to import from a client component, a test and a Playwright spec.
 */

/** A window this wide or wider shows a phone page as a column (CSS px). */
export const DESK_MIN_WIDTH = 720;
/** A window this wide or wider has room for the note beside the column (CSS px). */
export const DESK_NOTE_MIN_WIDTH = 1100;
/** The column's width in the foundation's unit (--rp-u, 1px at the default text size). */
export const DESK_COLUMN_UNITS = 430;

/**
 * The column: the foundation's Screen unless it fills a container (the /design phones), and any page root that carries
 * data-rp-phone. A screen inside the old demo frame (.rp-patient, already a 430px column) is not one.
 */
export const DESK_COLUMN = ':is(.rpu-screen, [data-rp-phone]):not([data-fill="container"]):not(.rp-patient *)';
/** A column on the dark stage: a page root marked data-rp-phone="dark" (the sign-in pages). */
export const DESK_COLUMN_DARK = '[data-rp-phone="dark"]:not([data-fill="container"]):not(.rp-patient *)';
/** Wei Ling's screen as a page: a column by its own rules (app/ripple-ui.css Part B), which this layout leaves alone. */
export const DESK_FAMILY_COLUMN = '.rpf-screen[data-fill="viewport"]:not(.rp-patient *)';
/** The document is a phone page when it holds one of these. */
export const DESK_PHONE_PAGE = `${DESK_COLUMN}, ${DESK_FAMILY_COLUMN}`;

/** The foundation's bars that are fixed to the bottom of the phone: on a computer they keep the column's edges. */
export const DESK_FIXED_BARS =
  ':is(.rpu-tabs:not([data-placement="absolute"], [data-placement="static"]), .rpu-say[data-placement="fixed"], .rpu-typedock, .rpu-toast[data-placement="fixed"])';
/** A fixed element of another line that spans the phone: its owner marks it, and it gets the column's edges. */
export const DESK_FIXED_MARK = "[data-rp-phone-fixed]";
/** The reminder that is due, a strip above the page (components/daily/elder/DueReminder.tsx): the top of the column. */
export const DESK_STRIP = ".rp-due";

/** The media queries of app/desktop.css. */
export const DESK_MEDIA = `screen and (min-width: ${DESK_MIN_WIDTH}px)`;
export const DESK_NOTE_MEDIA = `screen and (min-width: ${DESK_NOTE_MIN_WIDTH}px)`;

/** The note's place beside the column (app/desktop.css): the gap to the column, its width in units, the margin kept at the window's edge. */
export const DESK_NOTE_GAP = 40;
export const DESK_NOTE_UNITS = 220;
export const DESK_NOTE_MARGIN = 24;
