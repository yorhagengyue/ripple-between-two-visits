/**
 * One transcript line (v3): speaker avatar and label, time in the recording, the sentence as said, with the
 * words a card refers to underlined (blue for a doctor's note, yellow for a check).
 */
import type { ReactNode } from "react";
import type { Locale } from "@/lib/i18n";
import type { UtteranceRole } from "@/lib/store/types";
import { vt } from "@/lib/visit/strings";
import { formatMs } from "@/lib/visit/text";
import type { MarkView, RoleDisplay } from "@/lib/visit/types";
import { avatar, whoText } from "./labels";
import s from "./styles";

function marked(text: string, marks: MarkView[]): ReactNode[] {
  const spans: { start: number; end: number; kind: MarkView["kind"] }[] = [];
  for (const m of marks) {
    const i = text.indexOf(m.text);
    if (i < 0 || !m.text) continue;
    if (spans.some((x) => i < x.end && i + m.text.length > x.start)) continue;
    spans.push({ start: i, end: i + m.text.length, kind: m.kind });
  }
  spans.sort((a, b) => a.start - b.start);
  const out: ReactNode[] = [];
  let pos = 0;
  spans.forEach((sp, k) => {
    if (sp.start > pos) out.push(text.slice(pos, sp.start));
    out.push(
      <mark key={k} className={sp.kind === "doc" ? s.markDoc : s.markChk}>
        {text.slice(sp.start, sp.end)}
      </mark>,
    );
    pos = sp.end;
  });
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

export function TranscriptLine({
  locale,
  id,
  text,
  role,
  display,
  tStartMs,
  marks = [],
  partial = false,
  scriptedFallback = false,
}: {
  locale: Locale;
  id: string;
  text: string;
  role: UtteranceRole;
  display: RoleDisplay;
  tStartMs: number;
  marks?: MarkView[];
  partial?: boolean;
  scriptedFallback?: boolean;
}) {
  const mine = role === "patient";
  return (
    <div
      className={`${s.line} ${mine ? s.mine : ""} ${partial ? s.partial : ""}`}
      data-testid={`line-${id}`}
      data-role={role}
      data-display={display}
      data-partial={partial ? "true" : "false"}
    >
      <div className={`rp-src ${s.who} ${mine ? s.whoMe : ""}`}>
        <span className={s.av}>{partial && role === "unknown" ? "…" : avatar(locale, role)}</span>
        {partial && role === "unknown" ? null : <span data-testid={`who-${id}`}>{whoText(locale, role, display)}</span>}
        <span className={s.ts}>{formatMs(tStartMs)}</span>
        {scriptedFallback ? <span className={s.fallbackTag}>{vt(locale, "chip.fallback")}</span> : null}
      </div>
      <div className={s.txt} data-testid={`text-${id}`}>
        {marked(text, marks)}
        {partial ? <span className={s.caret} /> : null}
      </div>
    </div>
  );
}
