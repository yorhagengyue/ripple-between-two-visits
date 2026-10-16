/**
 * Tap to dial on the answer card (docs/plan/e2e-chains.md 7.1, 8.1). The fixed crisis templates (lib/safety/templates.ts)
 * name five numbers: 995, SOS 1767, SOS CareText 9151 1767 (WhatsApp text only), mindline 1771 and, in the Mandarin UI,
 * Care Corner 1800-3535-800. On a template line each of them becomes a link with its own fixed target; the link wraps
 * the digits exactly as the template writes them, so the words on screen do not change.
 *
 * Only these five, and only on template lines (AnswerView decides that): a number in the doctor's words (R2 "call
 * 995"), on a label or in a leaflet stays plain text, and a number the templates do not use (kb/referrals.json B4-06
 * says never to show 6389 2222 and 1800-221-4444) can never become a link. Pure, no React: AnswerView renders the parts.
 */
import type { Locale } from "@/lib/i18n";

export type DialKind = "tel" | "whatsapp";

export interface DialNumber {
  /** the number exactly as the templates write it (both languages) */
  text: string;
  /** where a tap goes: tel: for a call, wa.me for CareText (it takes WhatsApp text, not calls) */
  href: string;
  kind: DialKind;
}

export const DIAL_NUMBERS: readonly DialNumber[] = [
  { text: "995", href: "tel:995", kind: "tel" },
  { text: "1767", href: "tel:1767", kind: "tel" },
  { text: "9151 1767", href: "https://wa.me/6591511767", kind: "whatsapp" },
  { text: "1771", href: "tel:1771", kind: "tel" },
  { text: "1800-3535-800", href: "tel:18003535800", kind: "tel" },
];

const BY_TEXT = new Map(DIAL_NUMBERS.map((d) => [d.text, d]));

// Longest first, so "9151 1767" is one WhatsApp link, not "9151 " and a call to 1767. No lookbehind (older iOS Safari
// cannot parse it): the digit-before check is done by hand in dialParts.
const DIAL_RE = new RegExp(
  [...DIAL_NUMBERS]
    .sort((a, b) => b.text.length - a.text.length)
    .map((d) => d.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|"),
  "g",
);

/** A digit or a hyphen right next to a match means it is part of a longer number, which is never a link. */
const JOINS_NUMBER = /[\d-]/;

export interface DialPart {
  text: string;
  /** set when this part is one of the five numbers */
  dial?: DialNumber;
}

/** `text` cut into plain runs and number runs; joined back together the parts are `text`, character for character. */
export function dialParts(text: string): DialPart[] {
  const parts: DialPart[] = [];
  let last = 0;
  for (const m of text.matchAll(DIAL_RE)) {
    const at = m.index ?? 0;
    const end = at + m[0].length;
    if (JOINS_NUMBER.test(text.charAt(at - 1)) || JOINS_NUMBER.test(text.charAt(end))) continue;
    if (at > last) parts.push({ text: text.slice(last, at) });
    parts.push({ text: m[0], dial: BY_TEXT.get(m[0]) });
    last = end;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/**
 * Closing marks that never start a line, CJK and ASCII. The link is an atomic box (inline-flex, 48 px tall), and a
 * browser may break between such a box and the mark after it, which plain text never does: 「mindline 1771」 on one line
 * and 「，全天都有人接。」 starting the next. So the marks right after a number are kept on its line.
 */
const CLOSING_MARKS = /^[，。、；：！？）」』】〉》”’,.;:!?)\]]+/;

export interface DialRun {
  /** plain text, or the number exactly as written */
  text: string;
  dial?: DialNumber;
  /** the closing marks right after the number, rendered on its line (「，」 in 「1771，」) */
  after?: string;
}

/** dialParts with each number's closing marks moved into its run; joined back together the runs are `text`. */
export function dialRuns(text: string): DialRun[] {
  const parts = dialParts(text);
  const runs: DialRun[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const next = parts[i + 1];
    const after = p.dial && next && !next.dial ? (CLOSING_MARKS.exec(next.text)?.[0] ?? "") : "";
    if (!after) {
      runs.push(p);
      continue;
    }
    runs.push({ text: p.text, dial: p.dial, after });
    if (next.text.length > after.length) runs.push({ text: next.text.slice(after.length) });
    i++;
  }
  return runs;
}

/**
 * The link's accessible name. CareText is labelled as WhatsApp text (a tap opens WhatsApp, not the phone dialer); the
 * name keeps the number as shown. A call link needs none: its name is the number, read inside its sentence.
 */
export function dialLabel(d: DialNumber, locale: Locale): string | undefined {
  if (d.kind !== "whatsapp") return undefined;
  return locale === "zh-Hans" ? `WhatsApp 发文字 ${d.text}` : `WhatsApp text ${d.text}`;
}
