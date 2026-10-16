/**
 * Tailwind class sets for the M3 screens (on top of the .rp-* components in app/globals.css).
 *
 * Not a CSS module on purpose: next.config.ts sends every "*.css" through @tailwindcss/turbopack with
 * `as: "*.css"`, which also turns a *.module.css into plain global CSS, so a CSS module's class names come out
 * undefined (and its selectors leak globally). Utilities with the theme tokens avoid both.
 */
export const cx = {
  row: "flex items-center justify-between gap-3 no-underline text-inherit",
  rowName: "font-bold",
  rowStrength: "ml-1.5 font-medium text-ink-2",
  status: "flex-none rounded-full px-2.5 py-1 bg-surface-2 text-ink-2 data-[check=true]:bg-chk-wash data-[check=true]:text-chk-ink",
  lineText: "leading-[1.42] whitespace-pre-line",
  secondLine: "mt-1 text-ink-2 whitespace-pre-line",
  photo: "block w-full max-h-[220px] object-contain rounded-xl border border-hair bg-surface",
  field: "flex items-center justify-between gap-3 px-3.5 py-3 border-b border-hair last:border-b-0",
  fieldName: "text-ink-2",
  fieldValue: "font-semibold [overflow-wrap:anywhere]",
  right: "flex-none min-w-[84px] min-h-12 aria-pressed:bg-accent aria-pressed:text-on-accent",
  bigButton: "block w-full min-h-14 text-center no-underline",
  input: "w-full min-w-0 min-h-[52px] rounded-xl border border-hair-2 bg-surface text-ink px-3 py-2.5",
} as const;
