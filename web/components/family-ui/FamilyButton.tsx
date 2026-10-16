import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icons";
import { UiLink } from "@/components/ui/UiLink";
import type { NavMotion } from "@/lib/ui/nav-motion";
import { cx, type FamilyBaseProps } from "@/lib/ui/props";
import { PlayGlyph } from "./Glyphs";

type Variant = "primary" | "secondary" | "quiet" | "warn";

interface Common extends FamilyBaseProps {
  children: ReactNode;
  variant?: Variant;
  /** an icon of the shared set; the v3 draft draws none in a button, so her pages pass none */
  icon?: IconName;
  /** the draft's own two: the play triangle (「听一遍」, 「听原声」) and the stop square (「录完了」) */
  glyph?: "play" | "stop";
  /** small: a 44px button inside a row */
  size?: "normal" | "small";
  /** a small outlined button with the teal outline (「听原声」) */
  tone?: "teal";
}

type AsButton = Common & Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof Common> & { href?: undefined; pending?: boolean };
type AsLink = Common & { href: string; pending?: never; "data-testid"?: string; /** how the screen moves when the page opens (lib/ui/nav-motion.ts) */ nav?: NavMotion };

function Inner({ icon, glyph, children }: { icon?: IconName; glyph?: "play" | "stop"; children: ReactNode }) {
  return (
    <>
      {icon && <Icon name={icon} />}
      {glyph === "play" && <PlayGlyph />}
      {glyph === "stop" && <i data-glyph="stop" aria-hidden="true" />}
      <span>{children}</span>
    </>
  );
}

/**
 * Her buttons (the v3 draft's four levels), pill-shaped:
 *   primary    56px, solid teal, dark words: one per screen
 *   warn       56px, solid amber: only where Dad did not reply (「打电话给爸爸」); no teal one on that screen
 *   secondary  52px, a thin white outline, no ground (also for leaving and deleting the account)
 *   quiet      48px, plain grey words (「删掉这段」, 「先不要」, 「跳过」)
 * `size="small"` is the 44px one inside a row. `href` makes it a link (tel: for 「打电话给爸爸」). A disabled button
 * is the grey one of the draft's no-network screen.
 */
export function FamilyButton(props: AsButton | AsLink) {
  if (props.href !== undefined) {
    const { href, nav, children, variant = "primary", icon, glyph, size = "normal", tone, className, style } = props;
    return (
      <UiLink
        href={href}
        nav={nav}
        className={cx("rpf rpf-btn", className)}
        data-variant={variant}
        data-size={size === "small" ? "small" : undefined}
        data-tone={tone}
        data-testid={props["data-testid"]}
        style={style}
      >
        <Inner icon={icon} glyph={glyph}>
          {children}
        </Inner>
      </UiLink>
    );
  }
  const { children, variant = "primary", icon, glyph, size = "normal", tone, className, style, pending, type, disabled, ...rest } = props;
  return (
    <button
      {...rest}
      type={type ?? "button"}
      disabled={disabled || pending}
      aria-busy={pending ? true : undefined}
      className={cx("rpf rpf-btn", className)}
      data-variant={variant}
      data-size={size === "small" ? "small" : undefined}
      data-tone={tone}
      style={style}
    >
      <Inner icon={icon} glyph={glyph}>
        {children}
      </Inner>
    </button>
  );
}
