"use client";

/**
 * A checked sentence typed out on the screen (10-15): the explanation's words stream from the server as the model writes
 * them, but they are painted only once their checks passed (the long-press sheet, ExplainSheet.tsx; a word on the screen
 * is never taken back). Then the sentence appears as if written, a few characters at a time, about a second in all, with
 * the soft caret at its end. `animate` false (a plain JSON answer, a test, prefers-reduced-motion): the whole sentence at
 * once.
 */
import { useEffect, useState } from "react";

/** The whole sentence takes about this long, however long it is. */
const TOTAL_MS = 1100;
const STEP_MS = 24;

export function TypeOut({ text, animate }: { text: string; animate: boolean }) {
  const chars = [...text];
  const [shown, setShown] = useState(animate ? 0 : chars.length);
  useEffect(() => {
    if (!animate) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      const t = window.setTimeout(() => setShown(chars.length), 0);
      return () => window.clearTimeout(t);
    }
    const per = Math.max(1, Math.ceil(chars.length / (TOTAL_MS / STEP_MS)));
    const t = window.setInterval(() => {
      setShown((n) => {
        const next = Math.min(chars.length, n + per);
        if (next >= chars.length) window.clearInterval(t);
        return next;
      });
    }, STEP_MS);
    return () => window.clearInterval(t);
    // a new sentence starts again from its first character
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, animate]);
  const done = shown >= chars.length;
  return (
    <>
      {chars.slice(0, shown).join("")}
      {done ? null : <span className="rpu-caret" aria-hidden="true" />}
    </>
  );
}
