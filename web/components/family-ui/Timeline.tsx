import type { ReactNode } from "react";
import { cx, type FamilyBaseProps } from "@/lib/ui/props";
import { DayMark } from "./WeekStrip";

export interface TimelineItem {
  key: string;
  /** 「8:45」 */
  when: ReactNode;
  /** what happened, in words */
  what: ReactNode;
  /** more words after it (「没有回」), in the same colour */
  tag?: ReactNode;
  /** someone's words under it (her reminder, quoted) */
  say?: ReactNode;
  /** kept from the earlier draft: "warn" with the no-reply node colours the time amber */
  tone?: "ok" | "warn" | "quiet";
  /** for tests: the event's kind */
  kind?: string;
  /**
   * where the line stands: "now" bright (the default), "past" a line that something later made old (the whole row
   * drops to the quiet grey, its node to the weak grey), "future" not happened yet (dashed node, quiet words)
   */
  state?: "now" | "past" | "future";
  /**
   * the node: "dot" a 14px ring (the default), or a 32px state mark for the line that matters: "taken" teal tick,
   * "no_reply" amber ring with the bell, "waiting" dashed ring
   */
  node?: "dot" | "taken" | "no_reply" | "waiting";
  /** this line just came in: it rises 8px and fades in (the draft's one motion) */
  rise?: boolean;
}

/**
 * The morning as the v3 draft's timeline: three columns (the time 56px, the node 32px, the words), a 2px rule between
 * nodes and none after the last. Ordinary events are a 14px ring; the line that matters gets a 32px state mark. No cards.
 */
export function Timeline({ items, label, sep = "，", className, style }: FamilyBaseProps & { items: readonly TimelineItem[]; label?: ReactNode; /** before a tag: 「，」 / ", " */ sep?: string }) {
  if (!items.length) return null;
  return (
    <>
      {label && <p className="rpf rpf-section">{label}</p>}
      <ol className={cx("rpf rpf-tl", className)} data-rp="timeline" data-testid="family-timeline" style={style}>
        {items.map((it, i) => (
          <li key={it.key} className={cx("rpf-ev", it.rise && "rpf-rise")} data-tone={it.tone ?? "ok"} data-kind={it.kind} data-state={it.state && it.state !== "now" ? it.state : undefined} data-node={it.node && it.node !== "dot" ? it.node : undefined}>
            <span className="rpf-ev-when">{it.when}</span>
            <span className="rpf-ev-node" aria-hidden="true">
              {it.node && it.node !== "dot" ? <DayMark mark={it.node} size={32} /> : <i />}
              {i < items.length - 1 && <b />}
            </span>
            <span className="rpf-ev-body">
              <span className="rpf-ev-what">
                {it.what}
                {it.tag && (
                  <>
                    {sep}
                    <span className="rpf-ev-tag">{it.tag}</span>
                  </>
                )}
              </span>
              {it.say && <span className="rpf-ev-say">{it.say}</span>}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}
