import type { ReactNode } from "react";

/**
 * The few glyphs the auth screens draw, in the place of the iOS app's SF Symbols (chevron.left, chevron.right,
 * arrow.right, person.fill, person.2.fill, lock.fill, checkmark, speaker.wave.2.fill, target, bubble.left.fill): drawn
 * here, simple and filled, in the current colour. Always decoration: every one sits next to words (or inside a control
 * that has a name).
 */
export type AuthIconName = "back" | "forward" | "arrow" | "person" | "people" | "lock" | "check" | "sound" | "target" | "bubble";

const STROKE = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;

const GLYPHS: Record<AuthIconName, ReactNode> = {
  back: <path {...STROKE} strokeWidth={2.4} d="M14.5 5 7.5 12l7 7" />,
  forward: <path {...STROKE} strokeWidth={2.4} d="M9.5 5l7 7-7 7" />,
  arrow: <path {...STROKE} strokeWidth={2.2} d="M4.5 12h15M13 5.5l6.5 6.5-6.5 6.5" />,
  person: (
    <>
      <circle cx="12" cy="7.6" r="4.1" fill="currentColor" />
      <path fill="currentColor" d="M3.8 20.1c0-3.7 3.7-6.4 8.2-6.4s8.2 2.7 8.2 6.4c0 .8-.6 1.4-1.4 1.4H5.2c-.8 0-1.4-.6-1.4-1.4Z" />
    </>
  ),
  // two people: one in front, one half behind (person.2.fill)
  people: (
    <>
      <circle cx="9" cy="8.2" r="3.7" fill="currentColor" />
      <path fill="currentColor" d="M1.6 19.9c0-3.4 3.3-5.8 7.4-5.8s7.4 2.4 7.4 5.8c0 .7-.6 1.3-1.3 1.3H2.9c-.7 0-1.3-.6-1.3-1.3Z" />
      <path fill="currentColor" d="M15.9 11.9a3.2 3.2 0 1 0-1.1-6.2 5.4 5.4 0 0 1-.2 5.6c.4.4.8.6 1.3.6Z" />
      <path fill="currentColor" d="M18.1 21.2h3c.7 0 1.3-.6 1.3-1.3 0-3-2.6-5.2-6-5.3 1.2 1.3 1.9 3 1.9 4.9 0 .6-.1 1.2-.2 1.7Z" />
    </>
  ),
  lock: (
    <>
      <path {...STROKE} strokeWidth={2.1} d="M8 10.6V7.9a4 4 0 0 1 8 0v2.7" />
      <rect x="4.8" y="10.2" width="14.4" height="11" rx="2.8" fill="currentColor" />
    </>
  ),
  check: <path {...STROKE} strokeWidth={2.8} d="M5 12.6l4.4 4.4L19 7.4" />,
  sound: (
    <>
      <path fill="currentColor" d="M3.6 9.6c0-.5.4-.9.9-.9h2.6l4-3.3c.6-.5 1.5-.1 1.5.7v11.8c0 .8-.9 1.2-1.5.7l-4-3.3H4.5c-.5 0-.9-.4-.9-.9V9.6Z" />
      <path {...STROKE} strokeWidth={1.9} d="M15.6 9.3a4 4 0 0 1 0 5.4M18 6.8a7.5 7.5 0 0 1 0 10.4" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.6" {...STROKE} strokeWidth={1.9} />
      <circle cx="12" cy="12" r="4.9" {...STROKE} strokeWidth={1.9} />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
    </>
  ),
  bubble: <path fill="currentColor" d="M5.6 4.4h12.8c1.5 0 2.7 1.2 2.7 2.7v7.2c0 1.5-1.2 2.7-2.7 2.7h-7l-3.6 3c-.5.4-1.2 0-1.2-.6V17h-1c-1.5 0-2.7-1.2-2.7-2.7V7.1c0-1.5 1.2-2.7 2.7-2.7Z" />,
};

export function AuthIcon({ name }: { name: AuthIconName }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      {GLYPHS[name]}
    </svg>
  );
}
