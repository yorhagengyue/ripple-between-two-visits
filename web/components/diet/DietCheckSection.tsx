import type { DietCheckData } from "@/lib/diet/view";
import type { UiLocale } from "@/lib/ui/tokens";
import { DietCheck } from "./DietCheck";

/**
 * Today · the daily diet check (journey 13; 老人端提示词 13.5: 每天一问只在医生给过饮食交代时出现; design 13-3). Track K;
 * track B mounts it in a Today slot (integrator, 10-10), as the body of one entry of the day's line:
 *
 *   import { dietCheckToday } from "@/lib/diet/view";                      // server-only
 *   import { DietCheckSection } from "@/components/diet/DietCheckSection";
 *   const diet = await dietCheckToday(ctx.store, ctx.session, locale);     // DietCheckData | null
 *   diet ? <DietCheckSection locale={locale} data={diet} /> : undefined
 *
 * null: nothing to ask today (the doctor gave no diet instruction at a visit that happened, or he answered today).
 * Without `data` it renders nothing.
 *
 * The entry and its node belong to the Today page (components/daily/elder/TodayAccount.tsx: a grey ring, no head
 * line); this body draws its own head line (what the entry is, and which line of the doctor's the question is taken
 * from), the question as the title and the row of answers (components/diet/DietCheck, mode "today").
 */
export function DietCheckSection({ locale, data }: { locale: UiLocale; data?: DietCheckData | null }) {
  if (!data) return null;
  return (
    <div data-testid="today-diet">
      <DietCheck data={data} locale={locale} mode="today" />
    </div>
  );
}
