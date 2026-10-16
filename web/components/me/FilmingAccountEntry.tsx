import type { UiLocale } from "@/lib/ui/tokens";
import { MeEntry } from "./MeEntry";

/**
 * 我 · Filming account (entry "filming"; C2 track J; the timeline draft's 21-1: the row with the accent square in
 * front). Shown only on a phone that carries the film crew's cookie (/p/me places it in its last card; MeLayout renders
 * a `crewEntry` when `crew`): the page behind it (/p/me/filming) marks this account as the filming account, whose day
 * the director can move, and ends filming. Never on anyone else's 「我」. Keeps F2's export name and the `locale` prop.
 */
export function FilmingAccountEntry({ locale, href = "/p/me/filming" }: { locale: UiLocale; href?: string }) {
  const zh = locale === "zh-Hans";
  return (
    <MeEntry
      entry="filming"
      crew
      href={href}
      title={zh ? "拍摄账号" : "Filming account"}
      status={zh ? "只有拍摄组看得到：标成拍摄用，导演能拨它的日子" : "Crew only: mark it for filming so the director can move its day"}
    />
  );
}
