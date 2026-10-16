import { MeEntry } from "@/components/me/MeEntry";
import type { UiLocale } from "@/lib/ui/tokens";

/**
 * 我 · Diet (entry "diet"). Track K (journey 13). Page: app/p/diet. One row on the 「我」 page (integrator, 10-10); the
 * daily diet check itself shows on Today (components/today/DietCheckSection) only when the doctor gave a diet
 * instruction.
 */
export function DietEntry({ locale }: { locale: UiLocale }) {
  const zh = locale === "zh-Hans";
  return (
    <MeEntry
      entry="diet"
      href="/p/diet"
      title={zh ? "饮食" : "Food"}
      status={zh ? "医生说的饮食的话，官方的饮食条目" : "Your doctor's words about food, the official food lines"}
    />
  );
}
