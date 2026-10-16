import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { NavMotion } from "@/lib/ui/nav-motion";
import { cx, dataAttrs, filmingAttr, type DataAttrs, type UiBaseProps } from "@/lib/ui/props";
import { Icon, type IconName } from "./icons";
import { UiLink } from "./UiLink";

interface Common extends UiBaseProps {
  children: ReactNode;
  /** an icon before the words (never instead of them) */
  icon?: IconName;
}

type AsButton = Common &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof Common> & {
    href?: undefined;
    /** busy after a tap: disabled and aria-busy, the words stay (the caller words them) */
    pending?: boolean;
  };

type AsLink = Common &
  DataAttrs & {
    href: string;
    /** how the screen moves when the page opens (lib/ui/nav-motion.ts): a button that opens a page under this one is "forward" */
    nav?: NavMotion;
    pending?: never;
    id?: string;
    "aria-label"?: string;
    "data-testid"?: string;
  };

export type ButtonProps = AsButton | AsLink;

/**
 * The draft's buttons (its BTN table):
 *   primary         72 high, the accent, 26/800            secondary       64 high, white, a 2px ink border, 23/700
 *   danger          80 high, red, 28/900 (「打 995」)        dark            64 high, ink, 24/800
 *   link            words only, in the accent (56 high)    outline         a pill with the accent outline (「读给我听」)
 *   small           56 high, the light border (「‹ 上一周」)   on              the chosen one of a row (ink)
 *   danger-outline  deleting, outlined in red              danger-solid    the second step of deleting the account
 * A disabled button is grey on grey whatever its variant.
 *
 * A caller's own data-* attributes land on the button, as a link too (`data-testid`, `data-action`). `data-rp` says
 * which of the buttons it is (the variant's name) unless the caller passes its own, which is then kept: it names the
 * button in a page's tests, and the look comes from `data-variant` either way.
 */
export type ButtonVariant = "primary" | "secondary" | "danger" | "dark" | "link" | "outline" | "small" | "on" | "danger-outline" | "danger-solid";
type Variant = ButtonVariant;

function render(variant: Variant, props: ButtonProps) {
  const own = dataAttrs(props);
  if (props.href !== undefined) {
    const { href, nav, children, icon, filming, className, style, id } = props;
    return (
      <UiLink
        href={href}
        nav={nav}
        id={id}
        aria-label={props["aria-label"]}
        className={cx("rpu rpu-btn", className)}
        data-rp={variant}
        {...own}
        data-variant={variant}
        {...filmingAttr(filming)}
        style={style}
      >
        {icon && <Icon name={icon} stroke={2.6} />}
        <span>{children}</span>
      </UiLink>
    );
  }
  const { children, icon, filming, className, style, pending, type, disabled, ...rest } = props;
  return (
    <button
      {...rest}
      type={type ?? "button"}
      disabled={disabled || pending}
      aria-busy={pending ? true : undefined}
      className={cx("rpu rpu-btn", className)}
      data-rp={variant}
      {...own}
      data-variant={variant}
      {...filmingAttr(filming)}
      style={style}
    >
      {icon && <Icon name={icon} stroke={2.6} />}
      <span>{children}</span>
    </button>
  );
}

/** The one filled button on a screen: full width, 72px, the accent, white 26px 800. */
export function PrimaryButton(props: ButtonProps) {
  return render("primary", props);
}

/** A second choice: 64px, white with a 2px ink border (it has to look like a button), ink 23px 700. */
export function SecondaryButton(props: ButtonProps) {
  return render("secondary", props);
}

/** Same as SecondaryButton (the first build's name). */
export const GhostButton = SecondaryButton;

/** Red, 80px: 「打 995」 (red means 995, deleting or an error, nothing else). */
export function DangerButton(props: ButtonProps) {
  return render("danger", props);
}

/** Ink, 64px: 「录完了」 while the phone lies on the clinic table. */
export function DarkButton(props: ButtonProps) {
  return render("dark", props);
}

/** Any of the draft's buttons by name: <Button variant="link">忘了密码，用恢复码</Button>. */
export function Button({ variant = "secondary", ...props }: ButtonProps & { variant?: ButtonVariant }) {
  return render(variant, props as ButtonProps);
}

/** The grey line under a button that says why it waits (「勾上以后才能往下走」). */
export function ButtonNote({ children }: { children: ReactNode }) {
  return <p className="rpu rpu-btn-note">{children}</p>;
}

/** A row of buttons in equal columns (the draft's `r`): 「吃了 / 还没吃 / 等一下」, 「结束 / 接着认」. As many columns as `cols`. */
export function ButtonRow({ children, cols = 2, testId, attrs, filming, className, style }: UiBaseProps & { children: ReactNode; cols?: number; testId?: string; attrs?: Record<`data-${string}`, string | number | undefined> }) {
  return (
    <div className={cx("rpu rpu-row-btns", className)} data-rp="button-row" data-testid={testId} {...attrs} {...filmingAttr(filming)} style={{ ...style, ["--rpu-cols" as string]: cols }}>
      {children}
    </div>
  );
}

/** Two or three buttons side by side (「还没吃」 / 「等一下」); one above the other when the text is large. */
export function ButtonPair({ children, filming, className, style }: UiBaseProps & { children: ReactNode }) {
  return (
    <div className={cx("rpu rpu-pair", className)} data-rp="pair" {...filmingAttr(filming)} style={style}>
      {children}
    </div>
  );
}
