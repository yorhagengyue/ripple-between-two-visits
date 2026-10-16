import { ListCard, ListItem } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import { bt } from "@/lib/summary/i18n";

/**
 * 「上次给医生看的那一页」 on his brief (C2 track B, second round; e2e-chains 14.2): the page he last handed to the doctor
 * is kept as it was shown, and this row opens it again (/p/brief?shown=<id>): the same numbers, whatever he has logged
 * since. `when` is the day and time it was shown, in his words, on the grey line under the row's words. Nothing when he
 * never showed one. One row of a list card (the timeline design's `list`), with its chevron.
 */
export function LastShown({ locale, id, when }: { locale: Locale; id: string; when: string }) {
  return (
    <div data-testid="brief-last-shown" data-id={id}>
      <ListCard>
        <ListItem title={bt(locale, "brief.shown.last")} sub={when} chevron href={`/p/brief?shown=${encodeURIComponent(id)}`} />
      </ListCard>
    </div>
  );
}
