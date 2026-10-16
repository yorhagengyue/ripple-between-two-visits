/**
 * One clinical line on a medicine card: v3 card layout, the source as the tag on top (医生说 / 药袋 / 单张 ...),
 * the words, and the detail of the source underneath (visit date and time point, label date, leaflet site).
 * The text itself always comes from lib/meds/card (lib/safety checked); this component only lays it out.
 */
import type { Locale } from "@/lib/i18n";
import { chipDetailText, chipKindText } from "@/lib/meds/chips";
import { mt } from "@/lib/meds/i18n";
import type { CardLine } from "@/lib/meds/types";
import { cx } from "./classes";

export function CardLineView({ line, locale, testId = "card-line" }: { line: CardLine; locale: Locale; testId?: string }) {
  const doctor = line.chip.kind === "doctor";
  const detail = chipDetailText(locale, line.chip);
  return (
    <div className={`rp-card ${doctor ? "rp-card-doc" : ""}`} data-testid={testId} data-chip={line.chip.kind} data-source={line.sourceId}>
      <div className="rp-tag" data-testid="card-line-tag">
        ● {chipKindText(locale, line.chip)}
      </div>
      <p className={`${cx.lineText} mt-1.5`} data-testid="card-line-text">
        {line.text}
      </p>
      {line.secondLine ? (
        <p className={cx.secondLine} data-testid="card-line-second" data-original={line.secondIsOriginal ? "true" : undefined}>
          {line.secondIsOriginal ? mt(locale, "card.original", { text: line.secondLine }) : line.secondLine}
        </p>
      ) : null}
      {detail ? (
        <div className="rp-src" data-testid="card-line-source">
          {detail}
        </div>
      ) : null}
    </div>
  );
}
