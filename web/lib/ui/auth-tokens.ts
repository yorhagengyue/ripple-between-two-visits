/**
 * The tokens of the welcome, log-in, sign-up and recovery screens (components/auth-ui, app/ripple-auth.css) as data:
 * the two sets of the colour variables, each colour with where it comes from, and the two sizes of the one set of
 * components.
 *
 * Two sets of the colour variables (which one a screen is drawn in is AUTH_SCHEME, below; nothing else decides it):
 *   dark    the owner's iOS app as it is (ripple-ios RippleApp/DesignSystem/RippleColor.swift and the Onboarding /
 *           Auth views): the blue-black ground, the white mark, the teal.
 *   light   the elder version derived from it: the same screens on the elder side's own ground and ink (the
 *           foundation's tokens in app/ripple-ui.css: paper, white cards, ink, the purple as the action colour), so
 *           the last sign-up screen and the first setting-up screen are one product.
 *
 * Two sizes:
 *   elder   Mr Tan's pages (/login, /signup, /recover) and the door everyone comes through (/, /who): the iOS screens
 *           one text size up, about 1.2 times and never under 18px; anything tappable at least 48.
 *   family  the iOS sizes as they are, with the three text styles under 16px (subheadline 15, footnote 13, caption 12)
 *           lifted to 16: his son's or daughter's log-in and sign-up (/login?as=family, /signup?as=family).
 *
 * The source of truth is app/ripple-auth.css; tests/unit/ui/auth-contrast.test.ts reads that file and checks it agrees
 * with these tables, that the light set is the foundation's tokens, and that every text pair reaches WCAG AA in both
 * sets. Client-safe.
 */

/** A size of the one set of components: his, or his family's. */
export type AuthSide = "elder" | "family";

/**
 * Whose screen it is: one of the two sides, or the door both come through before they have said which they are (the
 * welcome and 「你是哪一位？」).
 */
export type AuthFace = AuthSide | "door";

/** A set of the colour variables. */
export type AuthScheme = "dark" | "light";

/**
 * THE SWITCH: which set of the colour variables each face's screens are drawn in. Mr Tan's pages are light (the elder
 * version), his family's are the iOS dark, and so is the door: the app opens as the iOS app does. To change one, change
 * its value here: that one value is all there is.
 *
 * What follows it by itself: the screen's root says it as data-rp-phone (components/auth-ui AuthScreen), every rule of
 * app/ripple-auth.css that differs between the sets is keyed by that mark, the desktop layout (app/desktop.css) reads
 * the same mark to choose the ground beside the 430px column, and each page's theme-color is authThemeColor(face).
 * tests/unit/ui/auth-contrast.test.ts holds the pages, the component and the CSS to this table.
 */
export const AUTH_SCHEME: Record<AuthFace, AuthScheme> = { elder: "light", family: "dark", door: "dark" };

/** The size each face is drawn at. The door has none of its own: an elder reads it, so it is his. */
export const AUTH_TIER: Record<AuthFace, AuthSide> = { elder: "elder", family: "family", door: "elder" };

export interface AuthColour {
  /** the CSS variable */
  name: string;
  /** dark: what the iOS app calls it, and its value there */
  ios: string;
  /** dark: the value in app/ripple-auth.css (#RRGGBB, or rgba() for a line or wash that lies over more than one ground) */
  dark: string;
  /** light: the foundation's token it mirrors (app/ripple-ui.css), or why there is none */
  from: string;
  /** light: the value in app/ripple-auth.css */
  light: string;
  use: string;
  /** "text": 4.5:1 on its grounds; "rule": a boundary that has to be seen, 3:1; "fill": other text sits on it; "decor": exempt */
  role: "ground" | "text" | "rule" | "fill" | "decor";
  /** why a value is not the source's own, when it is not */
  note?: string;
}

/** Every colour variable of a set, with its value in each. */
export const AUTH_COLOURS: readonly AuthColour[] = [
  { name: "--rpa-page", ios: "none (the phone is the screen)", dark: "#05070A", from: "--rp-tint", light: "#E1E7EE", use: "outside the 430px column on a wide screen", role: "ground", note: "dark: the daughter side's page colour (--rpf-page); light: the desktop layout's light stage" },
  { name: "--rpa-bg", ios: "RippleColor.background #0A0C0F", dark: "#0A0C0F", from: "--rp-paper", light: "#F2F5F9", use: "the screen", role: "ground" },
  { name: "--rpa-surface", ios: "RippleColor.surface #15181C", dark: "#15181C", from: "--rp-white", light: "#FFFFFF", use: "fields, rows, cards, the code", role: "ground" },
  { name: "--rpa-surface-2", ios: "AllSetView's icon tile #1B1F26", dark: "#1B1F26", from: "--rp-accent-soft", light: "#EEE8F5", use: "the small icon tile in a hint", role: "decor" },
  { name: "--rpa-fill-2", ios: "white 8% (SignInView, Continue with Email)", dark: "rgba(255, 255, 255, 0.08)", from: "--rp-white (the secondary button)", light: "#FFFFFF", use: "the secondary button", role: "fill" },
  { name: "--rpa-hairline", ios: "RippleColor.hairline, white 6%", dark: "rgba(255, 255, 255, 0.06)", from: "--rp-line", light: "#D5DCE5", use: "the edge of a row, a card", role: "decor" },
  {
    name: "--rpa-field-line",
    ios: "RippleColor.hairline, white 6% (a field's edge at rest)",
    dark: "rgba(255, 255, 255, 0.06)",
    from: "--rp-edge (the foundation's input border)",
    light: "#8592A3",
    use: "the edge of a field he types in",
    role: "decor",
    note: "on the dark ground the field is told by its fill, as in the iOS app; on paper a white field needs an edge that is seen, and the foundation's fields have this one",
  },
  { name: "--rpa-stroke", ios: "white 10% (VerifyCodeView's boxes)", dark: "rgba(255, 255, 255, 0.1)", from: "--rp-edge", light: "#8592A3", use: "the edge of the code field and of the top bar's buttons", role: "decor" },
  { name: "--rpa-stroke-2", ios: "white 14% (SignInView, Continue with Email)", dark: "rgba(255, 255, 255, 0.14)", from: "--rp-ink (the secondary button's border)", light: "#18202C", use: "the edge of the secondary button", role: "decor" },
  { name: "--rpa-track", ios: "the system switch, off (fill 120 120 128 at 32%)", dark: "rgba(120, 120, 128, 0.32)", from: "--rp-line-2 (the foundation's switch, off)", light: "#C3CCD8", use: "the switch when off", role: "decor" },
  { name: "--rpa-knob", ios: "the system switch's knob, white", dark: "#FFFFFF", from: "--rp-white", light: "#FFFFFF", use: "the switch's knob", role: "decor" },
  { name: "--rpa-text", ios: "RippleColor.textPrimary #F2F5F6", dark: "#F2F5F6", from: "--rp-ink", light: "#18202C", use: "titles, what he types, body", role: "text" },
  { name: "--rpa-text-2", ios: "RippleColor.textSecondary #9AA1A6", dark: "#9AA1A6", from: "--rp-ink-3 (the foundation's line under a title)", light: "#475263", use: "the line under a title, labels, the step count", role: "text" },
  {
    name: "--rpa-text-3",
    ios: "RippleColor.textTertiary #6A7176",
    dark: "#80878C",
    from: "--rp-ink-3 (the foundation has no lighter text: #8592A3 is for lines)",
    light: "#475263",
    use: "small print, placeholders",
    role: "text",
    note: "dark: #6A7176 is 3.95:1 on the ground and 3.59:1 on the surface; lightened to pass AA as text",
  },
  { name: "--rpa-dim", ios: "RippleColor.textTertiary #6A7176", dark: "#6A7176", from: "--rp-edge (the foundation's empty ring)", light: "#8592A3", use: "rings that are not text, on a surface: an unpicked choice, an empty tick box", role: "rule" },
  { name: "--rpa-accent", ios: "RippleColor.accent #37C2BA", dark: "#37C2BA", from: "--rp-accent", light: "#6A4C93", use: "the primary button, icons, a picked choice", role: "fill" },
  { name: "--rpa-accent-light", ios: "RippleColor.accentLight #5FD4CC", dark: "#5FD4CC", from: "--rp-accent-ink", light: "#6A4C93", use: "text buttons, the account's name in a sentence", role: "text" },
  { name: "--rpa-accent-muted", ios: "RippleColor.accentMuted, accent 16%", dark: "rgba(55, 194, 186, 0.16)", from: "--rp-accent-soft", light: "#EEE8F5", use: "the icon chip, the avatar", role: "decor" },
  { name: "--rpa-accent-focus", ios: "accent 75% (a focused field's edge)", dark: "rgba(55, 194, 186, 0.75)", from: "--rp-accent (the foundation's focused field)", light: "#6A4C93", use: "the edge of the field he is in, of a picked choice", role: "rule" },
  {
    name: "--rpa-accent-soft",
    ios: "accent 35% (the primary button's glow, the avatar's ring)",
    dark: "rgba(55, 194, 186, 0.35)",
    from: "--rp-accent-halo",
    light: "#E3DAF0",
    use: "the glow under the welcome button, the avatar's ring",
    role: "decor",
    note: "light: the elder side draws no shadows; with the halo colour the glow is all but flat on paper",
  },
  { name: "--rpa-on-accent", ios: "RippleColor.onAccent #06201E", dark: "#06201E", from: "--rp-on-accent", light: "#FFFFFF", use: "the label on the primary button", role: "text" },
  {
    name: "--rpa-warning",
    ios: "RippleColor.warning #E6B45A",
    dark: "#E6B45A",
    from: "--rp-urgent (the foundation's field error)",
    light: "#A4262C",
    use: "what went wrong (a wrong password, a taken name)",
    role: "text",
    note: "dark: the iOS auth screens write errors in the system red; the iOS palette's own amber is used instead, which that palette keeps for exactly this. Light: the elder side's fields say an error in --rp-urgent, and his sign-up says it the same way",
  },
  { name: "--rpa-logo", ios: "the mark's white #FFFFFF", dark: "#FFFFFF", from: "--rp-ink", light: "#18202C", use: "the logo", role: "fill" },
];

/** A colour variable's value in one set. */
export function authColour(name: string, scheme: AuthScheme): string {
  const c = AUTH_COLOURS.find((x) => x.name === name);
  if (!c) throw new Error(`${name} is not a colour variable of the auth screens`);
  return c[scheme];
}

/**
 * The browser's own bar on a face's pages (each page's viewport themeColor): the ground of the set that face is drawn
 * in. It follows AUTH_SCHEME, so no page names a colour.
 */
export function authThemeColor(face: AuthFace): string {
  return authColour("--rpa-bg", AUTH_SCHEME[face]);
}

/** Foreground on background pairs that carry text, in both sets. A `bg` written "a over b" is a wash lying on a ground. */
export const AUTH_PAIRS: readonly { fg: string; bg: string; over?: string; use: string }[] = [
  { fg: "--rpa-text", bg: "--rpa-bg", use: "titles and body on the screen" },
  { fg: "--rpa-text-2", bg: "--rpa-bg", use: "the line under a title, labels" },
  { fg: "--rpa-text-3", bg: "--rpa-bg", use: "small print" },
  { fg: "--rpa-accent-light", bg: "--rpa-bg", use: "text buttons" },
  { fg: "--rpa-warning", bg: "--rpa-bg", use: "an error under a field" },
  { fg: "--rpa-text", bg: "--rpa-surface", use: "what he types, a choice, a consent text" },
  { fg: "--rpa-text-2", bg: "--rpa-surface", use: "the line under a choice" },
  { fg: "--rpa-text-3", bg: "--rpa-surface", use: "a placeholder" },
  { fg: "--rpa-accent-light", bg: "--rpa-surface", use: "a top-bar button's coloured words" },
  { fg: "--rpa-on-accent", bg: "--rpa-accent", use: "the primary button's label" },
  { fg: "--rpa-text", bg: "--rpa-fill-2", over: "--rpa-bg", use: "the secondary button's label" },
  { fg: "--rpa-accent-light", bg: "--rpa-accent-muted", over: "--rpa-bg", use: "the avatar's initial" },
];

/** Lines that have to be seen (3:1) on the grounds they sit on, in both sets. */
export const AUTH_RULES: readonly { fg: string; bg: string; use: string }[] = [
  { fg: "--rpa-dim", bg: "--rpa-surface", use: "an unpicked choice's ring, an empty tick box" },
  { fg: "--rpa-accent", bg: "--rpa-bg", use: "the primary button against the screen" },
  { fg: "--rpa-accent", bg: "--rpa-surface", use: "a field's icon, a picked choice's mark" },
];

/** The SwiftUI text styles at the default text size (points). */
export const IOS_TYPE = {
  largeTitle: 34,
  title: 28,
  title2: 22,
  title3: 20,
  headline: 17,
  body: 17,
  callout: 16,
  subheadline: 15,
  footnote: 13,
  caption: 12,
  /** VerifyCodeView's digits, .system(size: 26, weight: .semibold) */
  code: 26,
  /** ProfileSetupView's initial, .system(size: 40, weight: .semibold) */
  avatar: 40,
} as const;

export type AuthTextStyle = keyof typeof IOS_TYPE;

/** Design px per side; written in the CSS as calc(N * var(--rp-u)), so they follow the phone's text size. */
export const AUTH_TYPE: Record<AuthSide, Record<AuthTextStyle, number>> = {
  family: { largeTitle: 34, title: 28, title2: 22, title3: 20, headline: 17, body: 17, callout: 16, subheadline: 16, footnote: 16, caption: 16, code: 26, avatar: 40 },
  elder: { largeTitle: 40, title: 34, title2: 26, title3: 24, headline: 20, body: 20, callout: 19, subheadline: 18, footnote: 18, caption: 18, code: 31, avatar: 48 },
};

/** The CSS variable of each text style. */
export const AUTH_TYPE_VAR: Record<AuthTextStyle, string> = {
  largeTitle: "--rpa-fs-large-title",
  title: "--rpa-fs-title",
  title2: "--rpa-fs-title2",
  title3: "--rpa-fs-title3",
  headline: "--rpa-fs-headline",
  body: "--rpa-fs-body",
  callout: "--rpa-fs-callout",
  subheadline: "--rpa-fs-subheadline",
  footnote: "--rpa-fs-footnote",
  caption: "--rpa-fs-caption",
  code: "--rpa-fs-code",
  avatar: "--rpa-fs-avatar",
};

/** The smallest text and the smallest tappable side on each side (the page checks' rules, e2e/_checks/page-checks.ts). */
export const AUTH_FLOORS: Record<AuthSide, { text: number; target: number }> = {
  family: { text: 16, target: 44 },
  elder: { text: 18, target: 48 },
};

export interface AuthSize {
  /** the CSS variable */
  name: string;
  /** where the iOS number comes from */
  ios: string;
  /** points in the iOS app */
  iosPt: number;
  family: number;
  elder: number;
}

/** Heights and boxes in design px (calc(N * var(--rp-u)) in the CSS). */
export const AUTH_SIZES: readonly AuthSize[] = [
  { name: "--rpa-h-primary", ios: "RipplePrimaryButtonStyle minHeight (WelcomeView)", iosPt: 54, family: 54, elder: 64 },
  { name: "--rpa-h-action", ios: "RipplePrimaryButtonStyle(minHeight: 52) on the form screens", iosPt: 52, family: 52, elder: 64 },
  { name: "--rpa-h-secondary", ios: "SignInView, Continue with Email", iosPt: 52, family: 52, elder: 60 },
  { name: "--rpa-h-text-btn", ios: "RippleTextButtonStyle minHeight", iosPt: 44, family: 44, elder: 48 },
  { name: "--rpa-hit", ios: "the smallest tappable side (HIG 44)", iosPt: 44, family: 44, elder: 48 },
  { name: "--rpa-h-field", ios: "ProfileSetupView's field", iosPt: 54, family: 54, elder: 64 },
  { name: "--rpa-h-field-icon", ios: "EmailEntryView's field", iosPt: 58, family: 58, elder: 68 },
  { name: "--rpa-h-row", ios: "ProfileSetupView's value row", iosPt: 54, family: 54, elder: 64 },
  { name: "--rpa-h-code", ios: "VerifyCodeView's boxes", iosPt: 60, family: 60, elder: 72 },
  { name: "--rpa-chip", ios: "IconChip", iosPt: 44, family: 44, elder: 52 },
  { name: "--rpa-tile", ios: "AllSetView's row tile", iosPt: 30, family: 30, elder: 36 },
  { name: "--rpa-avatar", ios: "ProfileSetupView's avatar", iosPt: 96, family: 96, elder: 116 },
  { name: "--rpa-switch-w", ios: "the system switch", iosPt: 51, family: 51, elder: 61 },
  { name: "--rpa-switch-h", ios: "the system switch", iosPt: 31, family: 31, elder: 37 },
];

/** Corner radii, the same on both sides (points in the iOS app, px here). */
export const AUTH_RADII = {
  /** RipplePrimaryButtonStyle's default: the welcome button */
  hero: 16,
  /** fields, rows, the form screens' buttons, the secondary button */
  control: 14,
  /** VerifyCodeView's boxes */
  code: 13,
  /** RippleCard */
  card: 20,
  /** IconChip */
  chip: 12,
  /** AllSetView's row tile */
  tile: 9,
  /** AllSetView's button */
  pill: 26,
} as const;

/**
 * The light set's seam with the setting-up screens (/onboard, the foundation's screens, which he reaches straight from
 * the last sign-up screen): what both have is drawn with the foundation's own tokens (app/ripple-ui.css), named here
 * with their value at the default text size. The dark set has none of this: it keeps the iOS numbers above.
 */
export const AUTH_SEAM = {
  /** the typeface: next/font's Noto Sans and Noto Sans SC */
  font: "--rp-font-sans",
  /** the page's sides */
  gutter: { token: "--rp-gutter", px: 20 },
  /** 「‹ 返回」: a bare word in the action colour (.rpu-back) */
  back: { size: { token: "--rp-fs-small", px: 20 }, weight: 700 },
  /** the filled button (.rpu-btn primary) */
  primary: { height: { token: "--rp-h-primary", px: 72 }, size: { token: "--rp-fs-action", px: 26 }, weight: 800, radius: { token: "--rp-radius-btn", px: 16 } },
  /** the second button (.rpu-btn secondary): white, a 2px ink edge */
  secondary: { height: { token: "--rp-h-secondary", px: 64 }, size: { token: "--rp-fs-secondary", px: 23 }, weight: 700, border: 2, radius: { token: "--rp-radius-btn", px: 16 } },
  /** what went wrong under a field (.rpu-f-error) */
  error: { size: { token: "--rp-fs-sub", px: 19 }, weight: 800 },
} as const;

/**
 * The logo's side: on the cold start's black screen (SplashView), on the welcome screen (WelcomeView) and above the
 * log-in (SignInView). Not scaled with text.
 */
export const AUTH_LOGO = { splash: 210, welcome: 175, login: 150 } as const;

/**
 * The cold start (SplashView: Color.black under the animated mark): pure black and the mark's white, whatever set the
 * door is drawn in, and how long the black takes to let the welcome through once the mark has drawn itself (the iOS
 * app cuts; here it is a short cross-fade). components/auth-ui/splash.css holds the same values;
 * tests/unit/ui/auth-entry.test.ts compares the two.
 */
export const AUTH_SPLASH = { ground: "#000000", mark: "#FFFFFF", fadeSeconds: 0.35 } as const;
