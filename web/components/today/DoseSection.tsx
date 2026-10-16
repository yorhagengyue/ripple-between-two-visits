import { SubCard, Timeline, TimelineItem } from "@/components/ui";
import { dt } from "@/lib/daily/i18n";
import type { DoseSlotView } from "@/lib/daily/today-view";
import type { UiLocale } from "@/lib/ui/tokens";
import { MedRow, SlotRow, changeHref, slotMedKey, type MedSource } from "./dose-parts";
import { SectionPlaceholder } from "./Placeholder";

/**
 * Today · Today's medicine (section "dose"). Owner: B (clock and every day). C2 track B: an account's medicine day.
 *
 * On an account's Today the medicine is part of the day's one line and is drawn, with its buttons, by
 * components/daily/elder/TodayAccount.tsx from the parts in ./dose-parts.tsx (a medicine's row on the slot's card, a
 * slot that is not on screen as one entry). This component is what is left for a page that only shows the day (no
 * buttons): the slot that needs him with each medicine's label, then every other slot as one entry.
 *
 * Words: lib/daily/i18n.ts. Nothing judges, nothing advises. Without `data` (the /design gallery) it is the placeholder.
 */
export interface DoseSectionData {
  focus: DoseSlotView | null;
  others: DoseSlotView[];
  yesterday: DoseSlotView[];
  herEyes: string[];
  /** when each medicine's label was dispensed, by medicine id */
  sources?: Record<string, MedSource>;
}

export { changeHref };

export function DoseSection({ locale, data }: { locale: UiLocale; data?: DoseSectionData }) {
  const zh = locale === "zh-Hans";
  if (!data) {
    return (
      <SectionPlaceholder
        section="dose"
        name={zh ? "今天的药" : "Today's medicine"}
        owner={zh ? "B 时钟和每一天" : "B (clock and every day)"}
        shows={zh ? "一根线上的一格：药名、「药袋上写着：每天早上吃一粒。」和看原文；吃了 / 还没吃 / 等一下；还没吃时问原因；记好了写「早上的药：吃了」和「改」，撤销条 12 秒。" : "One entry of the day's line: the drug, the label line and its source; 吃了 / 还没吃 / 等一下, reasons, the answered entry and the undo bar."}
      />
    );
  }
  const f = data.focus;
  return (
    <div data-testid="dose-section">
      <Timeline>
        {data.yesterday.map((s) => (
          <SlotRow key={`y-${s.slot}`} s={s} locale={locale} />
        ))}
        {f ? (
          <TimelineItem node="now" title={dt(locale, "today.slot.pending", { slotMed: dt(locale, slotMedKey(f.slot)) })}>
            <SubCard testId="dose-focus">
              {f.meds.map((m) => (
                <MedRow key={m.medicationId} m={m} locale={locale} source={data.sources?.[m.medicationId]} />
              ))}
            </SubCard>
          </TimelineItem>
        ) : null}
        {data.others.map((s) => (
          <SlotRow key={s.slot} s={s} locale={locale} herEyes={data.herEyes} />
        ))}
      </Timeline>
    </div>
  );
}
