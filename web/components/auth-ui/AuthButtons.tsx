import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import type { NavMotion } from "@/lib/ui/nav-motion";
import { cx } from "@/lib/ui/props";
import { AuthLink } from "./AuthLink";
import { AuthIcon, type AuthIconName } from "./icons";

interface Common {
  children: ReactNode;
  /** an icon after the words (EmailEntryView's arrow on 「下一步」); never instead of them */
  icon?: AuthIconName;
  className?: string;
  style?: CSSProperties;
}

type AsButton<Extra> = Common &
  Extra &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof Common | keyof Extra> & {
    href?: undefined;
    /** busy after a tap: disabled and aria-busy; the words stay */
    pending?: boolean;
  };

type AsLink<Extra> = Common &
  Extra & {
    href: string;
    /** how the screen moves when the page opens (lib/ui/nav-motion.ts): a button that opens the next page is "forward" */
    nav?: NavMotion;
    pending?: never;
    id?: string;
    lang?: string;
    target?: string;
    rel?: string;
    "aria-label"?: string;
    "data-testid"?: string;
  };

type Props<Extra = unknown> = AsButton<Extra> | AsLink<Extra>;

type Variant = "primary" | "secondary" | "text";

function render(variant: Variant, props: Props, marks: Record<string, string | undefined>) {
  const body = (
    <>
      <span>{props.children}</span>
      {props.icon && <AuthIcon name={props.icon} />}
    </>
  );
  if (props.href !== undefined) {
    const { href, nav, className, style, id, lang, target, rel } = props;
    return (
      <AuthLink
        href={href}
        nav={nav}
        id={id}
        lang={lang}
        target={target}
        rel={rel}
        aria-label={props["aria-label"]}
        data-testid={props["data-testid"]}
        className={cx("rpa-ios-btn", className)}
        data-rp={variant === "text" ? "text-button" : variant}
        data-variant={variant}
        {...marks}
        style={style}
      >
        {body}
      </AuthLink>
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- taken out so they do not reach the <button>
  const { children, icon, className, style, pending, type, disabled, ...rest } = props;
  return (
    <button
      {...rest}
      type={type ?? "button"}
      disabled={disabled || pending}
      aria-busy={pending ? true : undefined}
      className={cx("rpa-ios-btn", className)}
      data-rp={variant === "text" ? "text-button" : variant}
      data-variant={variant}
      {...marks}
      style={style}
    >
      {body}
    </button>
  );
}

interface PrimaryExtra {
  /**
   * "hero": the welcome screen's (54 tall, radius 16, the teal glow); "pill": a finished screen's (radius 26, the glow;
   * AllSetView). Without it: a form screen's (52 tall, radius 14, no glow).
   */
  shape?: "hero" | "pill";
}

/** The one filled button of a screen (RipplePrimaryButtonStyle): teal, the dark label, full width. */
export function AuthPrimaryButton(props: Props<PrimaryExtra>) {
  const { shape, ...rest } = props;
  return render("primary", rest as Props, { "data-shape": shape });
}

/** A second choice that still has to look like a button (SignInView's Continue with Email): white 8%, a thin edge. */
export function AuthSecondaryButton(props: Props) {
  return render("secondary", props, {});
}

interface TextExtra {
  /** teal (the default, the welcome screen's 「登录」), grey, or small print */
  tint?: "accent" | "secondary" | "quiet";
  /** only as wide as its words, at the end or the start of its line; without it the whole line can be tapped */
  fit?: "end" | "start";
}

/** Quiet words under the filled button (RippleTextButtonStyle). */
export function AuthTextButton(props: Props<TextExtra>) {
  const { tint, fit, ...rest } = props;
  return render("text", rest as Props, { "data-tint": tint && tint !== "accent" ? tint : undefined, "data-fit": fit });
}

/**
 * Text buttons one under another (「已经有账号？登录」, 「忘记密码？用恢复码」). `newTab`: opens beside the steps, so nothing
 * typed is lost. `tint`: a quieter one among them (the small link to the other side's log-in is grey).
 */
export function AuthLinks({ links }: { links: { href: string; label: string; testId?: string; newTab?: boolean; tint?: TextExtra["tint"] }[] }) {
  return (
    <nav className="rpa-ios-links" data-rp="links">
      {links.map((l) => (
        <AuthTextButton key={l.href} href={l.href} data-testid={l.testId} tint={l.tint} {...(l.newTab ? { target: "_blank", rel: "noopener" } : {})}>
          {l.label}
        </AuthTextButton>
      ))}
    </nav>
  );
}
