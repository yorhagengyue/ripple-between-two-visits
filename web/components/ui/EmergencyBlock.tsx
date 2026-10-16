import type { ReactNode } from "react";
import { uiCopy } from "@/lib/ui/copy";
import { cx, filmingAttr, telHref, type UiBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";
import { Icon } from "./icons";

export interface EmergencyCall {
  /** the number as dialled and shown: "995", "1767", "1800-3535-800" */
  number: string;
  /** the words before the number; defaults to 「打」 / "Call" */
  label?: string;
  /** defaults to tel:<digits> */
  href?: string;
}

/**
 * The only place red fills: the fixed emergency template (995). White bold words on red, and one big white call
 * line, number as the largest text on the screen (「打 995」). Words come from lib/safety/templates, never a model.
 * `who` is the draft's first line of the card, who is saying it (a white square and 「Ripple」): the card stands between
 * two stretches of a line, so it names its speaker itself.
 */
export function EmergencyBlock({
  title,
  who,
  children,
  call,
  locale,
  filming,
  className,
  style,
}: UiBaseProps & {
  title: ReactNode;
  /** who says it, over the sentence: 「Ripple」 */
  who?: ReactNode;
  children?: ReactNode;
  call: EmergencyCall;
  locale: UiLocale;
}) {
  const copy = uiCopy(locale);
  return (
    <section className={cx("rpu rpu-emergency", className)} data-rp="emergency" lang={locale} {...filmingAttr(filming)} style={style}>
      {who != null && (
        <p className="rpu-emergency-who" data-rp="emergency-who">
          {who}
        </p>
      )}
      <h2 className="rpu-emergency-title">{title}</h2>
      {children && (
        <p className="rpu-emergency-body" data-rp-role="body">
          {children}
        </p>
      )}
      <a className="rpu-emergency-call" href={call.href ?? telHref(call.number)} data-rp="emergency-call">
        <Icon name="phone" />
        <span className="rpu-emergency-call-label">{call.label ?? copy.call}</span>
        <span className="rpu-emergency-call-num">{call.number}</span>
      </a>
    </section>
  );
}

export interface Hotline {
  /** the fixed sentence that introduces the number (lib/safety/templates) */
  text: ReactNode;
  /** each number one tap to call (or open WhatsApp); the number stays selectable text */
  calls: (EmergencyCall & { urgent?: boolean })[];
}

/**
 * Self-harm hotlines (brief 6.11; the timeline draft's 10-1): calm, no lecture. Each fixed sentence stands in Ripple's
 * tinted bubble, and each of its numbers is a button under it, one tap to call (or to open WhatsApp): 56 high, one
 * per row. Only 995 is red (it is the emergency); a number to call is filled with the accent, the WhatsApp one is
 * outlined. The number stays selectable text. In the Mandarin UI the caller adds Care Corner.
 *
 * It draws no node and no rule: put one <Hotlines> with one line into a "rip" entry of a <Timeline> per sentence (the
 * ask screen, the day's record), or give it several lines where there is no line (the gallery).
 */
export function Hotlines({ lines, locale, filming, className, style }: UiBaseProps & { lines: readonly Hotline[]; locale: UiLocale }) {
  const copy = uiCopy(locale);
  return (
    <div className={cx("rpu rpu-hotlines", className)} data-rp="hotlines" lang={locale} {...filmingAttr(filming)} style={style}>
      {lines.map((line, i) => (
        <div className="rpu-hotline" key={i}>
          <p className="rpu-bubble" data-rp="bubble" data-node="rip" data-rp-role="say">
            {line.text}
          </p>
          {line.calls.length > 0 && (
            <div className="rpu-acts" data-rp="acts">
              {line.calls.map((c) => (
                <a
                  key={c.number + (c.label ?? "")}
                  className="rpu-act"
                  href={c.href ?? telHref(c.number)}
                  data-variant={c.urgent ? "danger" : c.href?.startsWith("https://wa.me") ? "secondary" : "primary"}
                  data-urgent={c.urgent ? "true" : undefined}
                  data-rp="call"
                >
                  <span>
                    {c.label ?? copy.call} <span className="rpu-call-num">{c.number}</span>
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
