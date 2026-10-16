import type { ReactNode } from "react";
import { UiLink } from "@/components/ui/UiLink";
import { familyCopy } from "@/lib/ui/copy";
import { cx, type FamilyBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";
import { FamilyDock, FamilyNote } from "./FamilyScreen";
import { ChevronRight } from "./Glyphs";
import { DayMark } from "./WeekStrip";

export interface SharedItem {
  /** 「每天吃药了没有」 */
  title: ReactNode;
  /** what exactly she sees, or would see: 「只有吃了、没吃、没回，不含原因」 */
  detail?: ReactNode;
  shared: boolean;
  /** the grant key, for tests: "dose_summary" */
  grant?: string;
  /** a screen behind the row: his visit records or his notes while shared, the 「还没有分享」 screen while not */
  href?: string;
}

/** The six rows alone (her empty home lists them all as 「没有分享」, the draft's H4). */
export function SharedRows({ items, locale, plain = false, className, style }: FamilyBaseProps & { items: readonly SharedItem[]; locale: UiLocale; /** short rows: a dash, the name, 「没有分享」; no detail line */ plain?: boolean }) {
  // 「开」 and 「没有分享」 say nothing of him
  const copy = familyCopy(locale, null);
  return (
    <div className={cx("rpf rpf-shares", className)} role="list" data-kind={plain ? "plain" : undefined} style={style}>
      {items.map((item, i) => {
        const inner = (
          <>
            <DayMark mark={item.shared ? "taken" : "off"} size={plain ? 22 : 26} />
            <span className="rpf-share-text">
              <span className="rpf-share-title">{item.title}</span>
              {!plain && item.detail && <span className="rpf-share-sub">{item.detail}</span>}
            </span>
            <span className="rpf-share-icon">
              <span>{item.shared ? copy.sharedOn : copy.sharedNo}</span>
              {item.href && <ChevronRight />}
            </span>
          </>
        );
        const common = { className: "rpf-share", role: "listitem", "data-shared": item.shared ? "true" : "false", "data-grant": item.grant } as const;
        return item.href ? (
          <UiLink key={item.grant ?? i} href={item.href} nav="forward" {...common}>
            {inner}
          </UiLink>
        ) : (
          <div key={item.grant ?? i} {...common}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

/**
 * What Dad lets her see (the v3 draft's F1): read only. All six items, one hairline row each: a shared one has the
 * teal tick and says 「开」, the rest a dash and 「没有分享」 — nothing hidden, nothing to guess. She has no switch here;
 * the last line says only Dad changes these. A row with `href` opens his visit records or his notes (or the screen
 * that says he has not shared them).
 */
export function SharedSection({
  items,
  locale,
  heading,
  lead,
  note,
  dad,
  className,
  style,
}: FamilyBaseProps & {
  items: readonly SharedItem[];
  locale: UiLocale;
  heading?: ReactNode;
  /** null: no lead line (the draft has none) */
  lead?: ReactNode | null;
  /** the last line, when the caller words it */
  note?: ReactNode;
  /** her word for him, for the heading and the last line the section words itself; null: 爸爸 / Dad */
  dad?: string | null;
}) {
  const copy = familyCopy(locale, dad);
  return (
    <section className={cx("rpf rpf-col", className)} data-rp="shared" data-testid="shared-items" style={style}>
      <h1 className="rpf-h1" data-testid="family-headline">
        {heading ?? copy.sharedYes}
      </h1>
      {lead && <p className="rpf-sub">{lead}</p>}
      <SharedRows items={items} locale={locale} />
      <FamilyDock foot="n">
        <FamilyNote>{note ?? copy.sharedBy}</FamilyNote>
      </FamilyDock>
    </section>
  );
}
