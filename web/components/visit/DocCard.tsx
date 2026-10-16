/**
 * Blue "Doctor's note" card (v3 .card.d). The sentence is shown whole, as said, with its source chip and time;
 * the rows above it are labels only (what kind of note, the medicine named and the strength said, the
 * approximate date of "in N weeks", always written "About" / 大约: see rowDesc in ./labels). Variants cover the D0 and D8 visits too: measure at home, how to
 * measure, target (R1), warning line (R2), first prescription, purpose (R3), about the dose (R4).
 * A medicine sentence whose speaker is only inferred is headed "To confirm" and never "Doctor's note".
 *
 * C2 follow-up (real-app 12 「看诊回顾点『不对』悄悄删掉医生交代」): a sentence he marked "not right" stays, whole, with the
 * mark 「他说不对」 under it and where it went (a question for the next visit; a warning line or a 995 line stays in use
 * for emergencies). An answer he changed after confirming says so (改过 N 次).
 */
import type { ReactNode } from "react";
import type { Locale } from "@/lib/i18n";
import { demoText } from "@/lib/crew/demo-copy";
import { vt, type VisitKey } from "@/lib/visit/strings";
import { formatMs } from "@/lib/visit/text";
import type { DocCardView, DocRow } from "@/lib/visit/types";
import { ClipButton } from "./ClipButton";
import { cardPrefix, chipText, rowDesc } from "./labels";
import s from "./styles";

function PillIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-35 12 12)" />
      <path d="M9.5 8.3l5 7.4" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="5" width="17" height="15" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M9 12h6M9 16h6" />
    </svg>
  );
}

const cap = (x: string) => (x ? x[0].toUpperCase() + x.slice(1) : x);

function rowTitle(locale: Locale, r: DocRow): string {
  if ((r.variant === "new_med" || r.variant === "med") && r.drugName) return `${cap(r.drugName)}${r.strength ? ` ${r.strength}` : ""}`;
  return vt(locale, `variant.${r.variant}` as VisitKey);
}

export function DocCard({ card, locale, children }: { card: DocCardView; locale: Locale; children?: ReactNode }) {
  const [first] = card.rows;
  const shownRows = card.rows.filter((r, i) => i > 0 || ["new_med", "med", "follow_up", "test"].includes(r.variant));
  const required = card.rows.find((r) => r.requiredLine)?.requiredLine ?? "";
  // his "not right": every row of the sentence (the whole card), or some of them
  const disputed = card.disputed === true || card.rows.some((r) => r.disputed || r.verdict === "wrong");
  // the warning line and a line that sends him to 995 or A&E stay on the emergency path (lib/visit/verdict.ts emergencyItem)
  const emergency = card.rows.some((r) => r.variant === "threshold") || /995|A&E|急诊|救护车/i.test(card.quote);
  const changes = Math.max(0, ...card.rows.map((r) => r.changes ?? 0));
  return (
    <div
      className={`rp-card rp-card-doc ${s.card} ${s.cardDoc}`}
      data-testid={`card-${card.anchor}`}
      data-kind="doc"
      data-display={card.display}
      data-medication={card.medication ? "true" : "false"}
      data-required={required}
      data-variants={card.rows.map((r) => r.variant).join(" ")}
      data-disputed={disputed ? "true" : "false"}
    >
      <div className="rp-tag" data-testid={`card-${card.anchor}-tag`}>
        ● {cardPrefix(locale, card.role, card.display, card.medication)} · {vt(locale, `variant.${first.variant}` as VisitKey)}
      </div>
      {shownRows.map((r) => {
        const desc = rowDesc(locale, r);
        const isMed = r.variant === "new_med" || r.variant === "med";
        return (
          <div className={s.item} key={r.itemId}>
            <div className={s.ic}>{isMed ? <PillIcon /> : r.variant === "follow_up" || r.variant === "test" ? <CalendarIcon /> : <NoteIcon />}</div>
            <div>
              <div className={s.nm}>
                {rowTitle(locale, r)}
                {r.isNew ? <span className={`rp-tag ${s.newBadge}`}>{vt(locale, "card.new")}</span> : null}
              </div>
              {desc ? (
                <div className={`rp-src ${s.ds}`} data-testid={r.dueDate ? `card-${card.anchor}-due-${r.variant}` : undefined}>
                  {desc}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
      <div className={s.quote} data-testid={`card-${card.anchor}-quote`}>
        “{card.quote}”
      </div>
      <div className={`rp-src ${s.src}`} data-testid={`card-${card.anchor}-chip`}>
        <span>{chipText(locale, card.role, card.display)}</span>
        <span>· {formatMs(card.tStartMs)}</span>
      </div>
      {card.clip ? <ClipButton clip={card.clip} locale={locale} testId={`card-${card.anchor}-play`} /> : null}
      {disputed ? (
        <p className="mt-2 text-body" data-testid={`card-${card.anchor}-disputed`}>
          <span className="rp-tag">● {demoText(locale, "review.disputed")}</span>
          <span className="mt-1 block text-ink-2">{demoText(locale, emergency ? "review.disputed.emergency" : "review.disputed.kept")}</span>
        </p>
      ) : null}
      {changes > 0 ? (
        <p className="rp-src mt-1" data-testid={`card-${card.anchor}-changed`}>
          {demoText(locale, changes === 1 ? "review.changed.one" : "review.changed", { n: changes })}
        </p>
      ) : null}
      {children}
    </div>
  );
}
