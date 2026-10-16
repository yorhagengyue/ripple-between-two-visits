/** Small helpers shared by components/ui and components/family-ui. Safe to import from client components. */
import type { CSSProperties } from "react";

/** Props every component in components/ui accepts. */
export interface UiBaseProps {
  /**
   * Filming mode for this component. Leave it out to follow the nearest ancestor with data-filming
   * (Screen, FilmingScope, or the existing PhoneShell root); true bumps body text from 20px to 22px.
   */
  filming?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Props every component in components/family-ui accepts. */
export interface FamilyBaseProps {
  className?: string;
  style?: CSSProperties;
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** A caller's own data-* attributes on a component (`data-testid`, a state a test reads): `<Option data-testid="x" data-state="on" />`. */
export type DataAttrs = { [K in `data-${string}`]?: string | number | boolean | undefined };

/** The data-* entries of a props object, to spread on the component's root element (after the component's own). */
export function dataAttrs(props: object): Record<string, string | number | boolean | undefined> {
  const out: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(props)) if (key.startsWith("data-")) out[key] = value as string | number | boolean | undefined;
  return out;
}

/** data-filming only when the caller decided; otherwise the CSS variables inherit from the nearest scope. */
export function filmingAttr(filming: boolean | undefined): { "data-filming"?: "true" | "false" } {
  return filming === undefined ? {} : { "data-filming": filming ? "true" : "false" };
}

/** Internal page links go through next/link; API routes, tel:, mailto:, # and absolute URLs stay plain <a>. */
export function isAppRoute(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/api/");
}

/** tel: link for a number as it is shown ("1800-3535-800" → "tel:18003535800"). */
export function telHref(number: string): string {
  return `tel:${number.replace(/[^\d+]/g, "")}`;
}

/**
 * "0:43" from milliseconds (clips are short: minutes:seconds). Whole seconds, cut, never rounded: a recording's time
 * point reads the same on every screen (49.5 s is 0:49 in the review, on the question list and here), and a player's
 * elapsed time does not show a second that has not been played. The rule is held by tests/unit/ui/clip-time.test.ts.
 */
export function clipTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
