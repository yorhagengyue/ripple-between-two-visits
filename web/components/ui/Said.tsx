import type { ReactNode } from "react";
import { cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";
import type { SpeakerKind, UiLocale } from "@/lib/ui/tokens";

/** Whose exact words these are. Ripple's own words and his own words are never <Said> (they stay sans). */
export type SaidSpeaker = SpeakerKind;

/**
 * Where the words were said. Required: a quote without a source cannot be rendered.
 * `ref` names the record that holds the words (an utterance id, a reminder clip id), e.g. "v2-u08".
 */
export interface SaidSource {
  kind: SaidSpeaker;
  ref: string;
}

export interface SaidProps extends UiBaseProps {
  /** Required. The type has no default and no optional marker on purpose. */
  source: SaidSource;
  /** The language of the words themselves, not of the UI (Dr Lim's English stays English on the 华语 screen). */
  lang: UiLocale;
  /** A 3px rule on the left (a quote inside running text). */
  ruled?: boolean;
  /** "sub": the smaller size of a card's row (22) */
  size?: "sub";
  children: ReactNode;
}

const SPEAKERS: readonly SaidSpeaker[] = ["doctor", "pharmacist", "dispenser", "family"];

/** Runtime half of the rule, for callers that get around the type (plain JS, `as any`). */
export function assertSaidSource(source: unknown): asserts source is SaidSource {
  const s = source as Partial<SaidSource> | null | undefined;
  if (!s || typeof s !== "object" || !SPEAKERS.includes(s.kind as SaidSpeaker) || typeof s.ref !== "string" || !s.ref.trim()) {
    throw new Error("<Said> needs a source: { kind: doctor | pharmacist | dispenser | family, ref: the record id of the words }");
  }
}

/**
 * Someone else's exact words, in the serif face: Noto Serif for Latin, Noto Serif SC for Chinese, 24px, weight 400
 * (the owner's decision with the timeline draft). Who said them is never this element's job: put them in a timeline
 * entry (the node and its head line) or under a <SourceTag>.
 */
export function Said({ source, lang, ruled = false, size, children, filming, className, style }: SaidProps) {
  assertSaidSource(source);
  return (
    <blockquote
      className={cx("rpu rpu-said", className)}
      data-rp="said"
      data-kind={source.kind}
      data-lang={lang === "en" ? "en" : "zh"}
      data-ruled={ruled ? "true" : "false"}
      data-size={size}
      data-source-kind={source.kind}
      data-source-ref={source.ref}
      lang={lang}
      {...filmingAttr(filming)}
      style={style}
    >
      {children}
    </blockquote>
  );
}
