/**
 * Ripple's notes of a visit (owner's decision of 10-14; lib/visit/ripple-summary.ts): its points under a title that names
 * them as Ripple's, and a quiet line that says they are Ripple's words from the recording and not confirmed. Drawn while
 * he records (「实时总结」, above the captions, updating as the points come) and at the top of the review (「Ripple 的总结」,
 * above the doctor's own lines). Its words are never the record and never a source: the doctor's lines stay as they are.
 *
 * Scene 1 (owner 10-15): a tap shows the same notes large (components/visit/SummaryFocus.tsx); while he records
 * (`live`), they grow large by themselves for a few seconds when a point arrives or changes (the first ones too: the
 * card appears with them), the new one marked, and the card keeps to a few lines so the captions under it stay in view.
 */
import { Box } from "@/components/ui";
import { SummaryFocus } from "../SummaryFocus";

export function RippleNotes({ title, note, points, lang, testId, live = false, openLabel }: {
  /** 「实时总结」 / 「Ripple 的总结」 */
  title: string;
  /** 「Ripple 根据录到的话整理，未经确认」 */
  note: string;
  points: readonly string[];
  /** the language the points are written in */
  lang: "zh-Hans" | "en";
  testId: string;
  /** the points change while he records: read out politely when they do, and shown large by themselves */
  live?: boolean;
  /** 「点一下放大看」: the card as a control, for a screen reader (default: its title) */
  openLabel?: string;
}) {
  return (
    <div aria-live={live ? "polite" : undefined} data-testid={testId} data-points={points.length}>
      <SummaryFocus variant="elder" title={title} note={note} points={points} lang={lang} auto={live} clamp={live} announceFirst={live} openLabel={openLabel ?? title} testId={testId}>
        <Box variant="line" title={title}>
          <ul className="rpu-visit-notes" lang={lang}>
            {points.map((p, i) => (
              <li key={`${i}-${p}`} data-testid={`${testId}-point`}>
                {p}
              </li>
            ))}
          </ul>
          <p className="rpu-visit-note" data-testid={`${testId}-label`}>
            {note}
          </p>
        </Box>
      </SummaryFocus>
    </div>
  );
}
