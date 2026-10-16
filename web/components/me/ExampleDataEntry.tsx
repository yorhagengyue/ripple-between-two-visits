import { exampleCopy } from "@/lib/profile/copy";
import type { UiLocale } from "@/lib/ui/tokens";
import { MeEntry } from "./MeEntry";

/**
 * 我 · the example account's row (entry "example"). Owner: C. Only on an account that runs on Mr Tan's example data
 * (real-app 2.23 line 315, 4.7): one row, 「示例资料」, to the example's own page (app/p/me/example), which says where
 * the data comes from and has both buttons, 「重新铺一遍示例资料」 and 「清空，从我自己的开始」, each with what it does under
 * it. Nothing is wiped by a tap on 「我」 itself, and no dialog asks. One row where there were two, one per button
 * (owner's tidy of 10-13).
 */
export function ExampleDataEntry({ locale, href = "/p/me/example" }: { locale: UiLocale; href?: string }) {
  const c = exampleCopy(locale);
  return <MeEntry entry="example" href={href} title={c.pageTitle.join(" ")} />;
}
