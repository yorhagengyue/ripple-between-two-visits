import { MeEntry } from "@/components/me/MeEntry";
import type { UiLocale } from "@/lib/ui/tokens";

/**
 * 我 · Prevention (entry "prevent"). Track K (journey 11). Page: app/p/prevent. It was one row on the 「我」 page
 * (integrator, 10-10); 「我」 no longer shows it: prevention is reached from the question list (owner's tidy of 10-13),
 * and nothing mounts this row now.
 */
export function PreventEntry({ locale }: { locale: UiLocale }) {
  const zh = locale === "zh-Hans";
  return (
    <MeEntry
      entry="prevent"
      href="/p/prevent"
      title={zh ? "预防：筛查和疫苗" : "Prevention: screenings and vaccines"}
      status={zh ? "官方表上按年龄和病列的条目" : "What the official tables list for your age and conditions"}
    />
  );
}
