import type { UiLocale } from "@/lib/ui/tokens";
import { MeEntry } from "./MeEntry";

/**
 * 我 · My data (entry "data"; C2 track H, journey 15): opens 「我的数据」 (/p/me/export): export, how long visit
 * recordings are kept, when the family looked, the privacy notice. Deleting the account has its own row on 「我」.
 */
export function DataEntry({ locale, href = "/p/me/export" }: { locale: UiLocale; href?: string }) {
  const zh = locale === "zh-Hans";
  return (
    <MeEntry
      entry="data"
      href={href}
      title={zh ? "我的数据" : "My data"}
      status={zh ? "导出、录音留多久、家人什么时候看过" : "Export, how long recordings are kept, when your family looked"}
    />
  );
}
