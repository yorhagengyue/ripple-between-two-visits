import { dt } from "@/lib/daily/i18n";
import type { UiLocale } from "@/lib/ui/tokens";

/**
 * Today · 「Wei Ling 会看到：今天吃了」 under a slot he answered (C2 track B, second round; real-app 2.7 「开了『吃药』时多一行
 * 『Wei Ling 会看到：今天吃了』」). It stays with the folded row for the rest of the day, not only while the undo bar is up:
 * as long as someone can see his medicine answers (an active family link with 「吃药」 switched on), the row says who
 * and what she sees. Nobody can see: nothing. A line of its own under the row (the row's text column is narrow next to
 * 「改一下」), in the row's own quiet type, starting where the row's words start.
 */
export function HerEyesLine({ locale, names, state }: { locale: UiLocale; names: string[]; state: "taken" | "missed" | "later" }) {
  if (!names.length) return null;
  return (
    <p
      className="rpu"
      data-testid="dose-her-eyes"
      data-state={state}
      style={{ margin: "4px 0 0 calc(var(--rp-hit) + 14px)", fontSize: "var(--rp-fs-min)", fontWeight: 600, color: "var(--rp-ink-3)" }}
    >
      {dt(locale, "today.herEyes", { names: names.join(locale === "zh-Hans" ? "、" : ", "), state: dt(locale, `today.herEyes.${state}`) })}
    </p>
  );
}
