import { KeyValueRow, Rows } from "@/components/ui";
import { dt } from "@/lib/daily/i18n";
import type { UiLocale } from "@/lib/ui/tokens";

/**
 * Today · 「拍一下新药的药袋」 (C2 track B, second round; real-app 2.16 「有『等药袋确认』的药时，今天页和药卡上都有『拍一下
 * 新药的药袋』」). One row per medicine that waits for its label (the doctor prescribed it at a visit he confirmed, or a
 * new bag of a medicine he has): the medicine's own name, and the whole row opens the camera page for that medicine
 * (/p/meds/add?med=<id>), so the photo lands on the row that waits. Nothing when no medicine waits.
 */
export function NewMedLabel({ locale, meds }: { locale: UiLocale; meds: { id: string; name: string }[] }) {
  if (!meds.length) return null;
  return (
    <div data-testid="new-med-label" data-count={meds.length}>
      <Rows style={{ marginTop: 14 }}>
        {meds.map((m) => (
          <KeyValueRow key={m.id} label={<span data-testid={`new-med-${m.id}`}>{dt(locale, "today.newMed.label")}</span>} value={m.name} href={newMedHref(m.id)} />
        ))}
      </Rows>
    </div>
  );
}

/** The camera page for the medicine that waits for its label. */
export function newMedHref(id: string): string {
  return `/p/meds/add?med=${encodeURIComponent(id)}`;
}
