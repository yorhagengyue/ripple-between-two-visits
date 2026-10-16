/**
 * What kind of visit it was, for her list of his visit records (the fe-d track; the v3 draft's F3, F4), in the words
 * his own screens use for it (lib/visit/strings.ts). Kept out of lib/care/her-view.ts so her live screens do not carry
 * his visit strings. Read by server pages only.
 */
import type { Locale } from "@/lib/i18n";
import { vt, type VisitKey } from "@/lib/visit/strings";

const KINDS = new Set(["healthier_sg_check_in", "follow_up", "pharmacy"]);

/** 「复诊」 / "Follow-up"; null for a kind without words of its own (the row then shows the place). */
export function visitKindWords(kind: string | null | undefined, locale: Locale): string | null {
  return kind && KINDS.has(kind) ? vt(locale, `kind.${kind}` as VisitKey) : null;
}
