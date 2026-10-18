/**
 * What the fe-auth specs share (e2e/fe-auth*.spec.ts: the welcome, log-in, sign-up and recovery screens derived from
 * the iOS app): a phone, the colours his screens are drawn in, the numbers the browser computed for an element, the
 * page checks and a picture in BOTH sets of the colour variables.
 *
 * Which set his pages ship in is one value (lib/ui/auth-tokens.ts AUTH_SCHEME.elder: light), and the specs take their
 * expectations from it (ELDER, SHAPE), so they hold whichever way it is set. The same holds for the door everyone comes
 * through, the welcome and 「你是哪一位？」 (AUTH_SCHEME.door: the iOS dark; DOOR, DOOR_SHAPE: drawn at the elder's
 * size), and for his family's pages (AUTH_SCHEME.family; FAMILY). The other set of a screen is reached here by
 * changing the screen's own mark (data-rp-phone) in the browser: every rule that differs between the sets is keyed by
 * that mark, so this is what the other value of the switch draws (all but the browser's own bar, which a page sets on
 * the server).
 *
 * FE_AUTH_SHOTS_DIR=<folder> makes `shot` save two pictures of the screen there (390x844 at 2x): `<name>-light.png`
 * and `<name>-dark.png`; a screen longer than the phone gets a whole-page one as well (「-整页」). Without the variable
 * no picture is written.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { AUTH_COLOURS, AUTH_RADII, AUTH_SCHEME, AUTH_SEAM, AUTH_SIZES, AUTH_TYPE, authColour, type AuthScheme, type AuthSide } from "../lib/ui/auth-tokens";
import { checkTextScaling, expectPageChecks, settleAnimations } from "./_checks/page-checks";
import { BASE_URL } from "./helpers";

export const SHOTS = process.env.FE_AUTH_SHOTS_DIR?.trim() || null;
export const VIEWPORT = { width: 390, height: 844 };

/** A phone: 390x844 at 2x, Singapore time; 华语 unless asked. */
export async function phone(browser: Browser, opts: { locale?: "zh-Hans" | "en"; reducedMotion?: boolean } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const en = opts.locale === "en";
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    locale: en ? "en-SG" : "zh-CN",
    timezoneId: "Asia/Singapore",
    reducedMotion: opts.reducedMotion ? "reduce" : "no-preference",
  });
  await context.addCookies([{ name: "rp_lang", value: en ? "en" : "zh-Hans", url: BASE_URL }]);
  return { context, page: await context.newPage() };
}

/** A colour as the browser writes a computed one: "#RRGGBB" becomes "rgb(r, g, b)", an rgba() stays as it is. */
export const rgb = (value: string) => {
  if (!value.startsWith("#")) return value;
  const n = parseInt(value.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

/** One set of the colour variables, by the names the iOS palette gives them (RippleColor.swift) and the views' own. */
export function palette(scheme: AuthScheme) {
  const of = (name: string) => authColour(name, scheme);
  return {
    scheme,
    /** outside the column, behind the screen */
    page: of("--rpa-page"),
    background: of("--rpa-bg"),
    surface: of("--rpa-surface"),
    textPrimary: of("--rpa-text"),
    textSecondary: of("--rpa-text-2"),
    /** small print (the iOS textTertiary, lightened to pass AA as text) */
    textTertiary: of("--rpa-text-3"),
    accent: of("--rpa-accent"),
    accentLight: of("--rpa-accent-light"),
    onAccent: of("--rpa-on-accent"),
    warning: of("--rpa-warning"),
    /** the second button's fill and edge (SignInView's Continue with Email) */
    fill2: of("--rpa-fill-2"),
    stroke2: of("--rpa-stroke-2"),
    /** the edge of the field he is in, of a picked choice */
    focus: of("--rpa-accent-focus"),
    /** the glow under the welcome button, the avatar's ring */
    soft: of("--rpa-accent-soft"),
    logo: of("--rpa-logo"),
  };
}

/** The iOS app's own colours (the dark set). */
export const IOS = palette("dark");
/** What Mr Tan's pages are drawn in: whatever the switch says. */
export const ELDER = palette(AUTH_SCHEME.elder);
/** What the door is drawn in (the welcome, 「你是哪一位？」): whatever the switch says for it. */
export const DOOR = palette(AUTH_SCHEME.door);
/** What his family's log-in and sign-up are drawn in. */
export const FAMILY = palette(AUTH_SCHEME.family);

const elderSize = (name: string) => AUTH_SIZES.find((x) => x.name === name)!.elder;

/**
 * What differs in shape between the two sets on his pages (lib/ui/auth-tokens.ts), at the default text size: the dark
 * set has the iOS numbers one text size up; the light set has, for what the setting-up screens have too, the
 * foundation's own (AUTH_SEAM): its typeface, its gutter, its back word, its two buttons, how its fields say an error.
 */
export function shape(scheme: AuthScheme) {
  if (scheme === "light") {
    return {
      scheme,
      font: /^"Noto Sans", "Noto Sans SC"/,
      gutter: AUTH_SEAM.gutter.px,
      /** under the last button of a step */
      foot: 34,
      /** the filled button; on the welcome screen and on a finished screen it is the same button */
      primary: { height: AUTH_SEAM.primary.height.px, radius: AUTH_SEAM.primary.radius.px, fontSize: AUTH_SEAM.primary.size.px, fontWeight: AUTH_SEAM.primary.weight },
      hero: { radius: AUTH_SEAM.primary.radius.px, glow: false },
      pill: { radius: AUTH_SEAM.primary.radius.px, glow: false },
      secondary: { height: AUTH_SEAM.secondary.height.px, radius: AUTH_SEAM.secondary.radius.px, fontSize: AUTH_SEAM.secondary.size.px, fontWeight: AUTH_SEAM.secondary.weight, border: AUTH_SEAM.secondary.border },
      /** quiet words that are tapped */
      words: { fontWeight: 700 },
      /** 「‹ 返回」 */
      back: { capsule: false, fontSize: AUTH_SEAM.back.size.px, fontWeight: AUTH_SEAM.back.weight },
      error: { fontSize: AUTH_SEAM.error.size.px, fontWeight: AUTH_SEAM.error.weight },
    };
  }
  return {
    scheme,
    font: /^-apple-system, "SF Pro Text", "SF Pro Display", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif$/,
    gutter: 16,
    foot: 28,
    primary: { height: elderSize("--rpa-h-action"), radius: AUTH_RADII.control, fontSize: AUTH_TYPE.elder.headline, fontWeight: 600 },
    hero: { radius: AUTH_RADII.hero, glow: true },
    pill: { radius: AUTH_RADII.pill, glow: true },
    secondary: { height: elderSize("--rpa-h-secondary"), radius: AUTH_RADII.control, fontSize: AUTH_TYPE.elder.headline, fontWeight: 600, border: 1 },
    words: { fontWeight: 500 },
    back: { capsule: true, fontSize: AUTH_TYPE.elder.subheadline, fontWeight: 500 },
    error: { fontSize: AUTH_TYPE.elder.footnote, fontWeight: 400 },
  };
}
/** The shapes of the set his pages ship in. */
export const SHAPE = shape(AUTH_SCHEME.elder);
/** The shapes of the door's screens: the elder's size, in the set the door ships in. */
export const DOOR_SHAPE = shape(AUTH_SCHEME.door);
export const other = (scheme: AuthScheme): AuthScheme => (scheme === "dark" ? "light" : "dark");

/** The set the screen on this page is drawn in right now (its root's mark). */
export async function lookOf(page: Page): Promise<AuthScheme> {
  return (await page.locator(".rpa-ios-screen[data-rp-phone]").first().getAttribute("data-rp-phone")) as AuthScheme;
}

/**
 * Draw the screen on this page in one set of the colour variables, by its mark. React leaves the mark alone while the
 * screen stays (it only writes a prop that changed); a new document or a new screen has the shipped mark again.
 */
export async function setLook(page: Page, scheme: AuthScheme): Promise<void> {
  await page
    .locator(".rpa-ios-screen[data-rp-phone]")
    .first()
    .evaluate((el, s) => {
      el.setAttribute("data-rp-phone", s);
      // a colour that eases from one value to the next (the switch's track) is taken at its end
      void getComputedStyle(el).backgroundColor;
      for (const a of document.getAnimations()) if (a.effect?.getComputedTiming().endTime !== Infinity) a.finish();
    }, scheme);
  await expect(page.locator(".rpa-ios-screen[data-rp-phone]").first()).toHaveAttribute("data-rp-phone", scheme);
}

/** Every colour that only `scheme` has (as the browser writes it): none may be left on a screen drawn in the other set. */
export function onlyIn(scheme: AuthScheme): string[] {
  const theirs = new Set(AUTH_COLOURS.map((c) => rgb(c[other(scheme)])));
  return [...new Set(AUTH_COLOURS.map((c) => rgb(c[scheme])))].filter((v) => !theirs.has(v));
}

/** Every place on the screen (and behind it) still drawn in one of `colours`, as "what where". */
export async function drawnIn(page: Page, colours: string[]): Promise<string[]> {
  return page.evaluate((list) => {
    const out = new Set<string>();
    const props = ["color", "backgroundColor", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "outlineColor", "fill", "stroke", "caretColor"] as const;
    const visibleEdge = (cs: CSSStyleDeclaration, p: string) => {
      if (p.startsWith("border")) return parseFloat(cs.getPropertyValue(`${p.replace(/Color$/, "").replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}-width`)) > 0;
      if (p === "outlineColor") return cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
      return true;
    };
    for (const el of [document.body, ...document.querySelectorAll("[data-rp-phone], [data-rp-phone] *")]) {
      const cs = getComputedStyle(el);
      const name = `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/)[0]}`;
      for (const p of props) {
        const v = cs[p];
        if (!list.includes(v) || !visibleEdge(cs, p)) continue;
        // a colour nothing is painted with does not count: SVG fill on an HTML element, a stroke of width 0
        if ((p === "fill" || p === "stroke") && !(el instanceof SVGElement)) continue;
        if (p === "stroke" && parseFloat(cs.strokeWidth) === 0) continue;
        out.add(`${p} ${v} on ${name}`);
      }
      const shadow = cs.boxShadow;
      if (shadow !== "none" && list.some((d) => shadow.includes(d))) out.add(`boxShadow ${shadow} on ${name}`);
    }
    return [...out];
  }, colours);
}

/**
 * The page checks (text and target floors, contrast, no sideways scroll) on the screen as it ships and again in the
 * other set of the colour variables: the switch has to be safe both ways. The screen is left as it shipped.
 */
export async function expectChecksInBothSets(page: Page, side: AuthSide): Promise<void> {
  const shipped = await lookOf(page);
  await expectPageChecks(page, { side });
  // Her pages are drawn in one palette: the family set has no light variant (its --rpf-* tokens do not flip with
  // data-rp-phone), so the other set would set her dark ink on a light ground and report a contrast failure no user
  // can reach (axe read 4.16:1 on /login?as=family and /signup?as=family, 2026-10-18). His pages do have both.
  if (side === "family") return;
  await setLook(page, other(shipped));
  // a colour transition started by the flip itself lands a frame later: let it end before axe reads colours
  await page.waitForTimeout(350);
  try {
    await expectPageChecks(page, { side });
  } catch (e) {
    throw new Error(`in the ${other(shipped)} set (the page ships ${shipped}): ${(e as Error).message}`);
  } finally {
    await setLook(page, shipped);
  }
}

/**
 * Pictures for the owner, when FE_AUTH_SHOTS_DIR is set: the phone's screen in both sets of the colour variables
 * (`<name>-light.png`, `<name>-dark.png`), and the whole page as well when it is longer than the phone. The draw-in is
 * finished first and nothing is left focused, so the picture is the resting screen. The screen is left as it shipped.
 */
export async function shot(page: Page, name: string, opts: { keepFocus?: boolean } = {}): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  // `next dev` draws its own badge in a corner of the page: not part of the app, kept out of the picture
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await settleAnimations(page);
  if (!opts.keepFocus) await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.evaluate(() => window.scrollTo(0, 0));
  const shipped = await lookOf(page);
  for (const scheme of [shipped, other(shipped)]) {
    await setLook(page, scheme);
    await page.screenshot({ path: path.join(SHOTS, `${name}-${scheme}.png`) });
    const taller = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 4);
    if (taller) await page.screenshot({ path: path.join(SHOTS, `${name}-${scheme}-整页.png`), fullPage: true });
  }
  await setLook(page, shipped);
}

/** What the browser computed for one element: the numbers the iOS views name. */
export async function look(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        color: cs.color,
        background: cs.backgroundColor,
        border: cs.borderTopColor,
        borderWidth: parseFloat(cs.borderTopWidth),
        fontSize: parseFloat(cs.fontSize),
        fontWeight: Number(cs.fontWeight),
        radius: parseFloat(cs.borderTopLeftRadius),
        height: Math.round(r.height * 10) / 10,
        width: Math.round(r.width * 10) / 10,
        shadow: cs.boxShadow,
        textAlign: cs.textAlign,
        textTransform: cs.textTransform,
        family: cs.fontFamily,
      };
    });
}

/** A login name no other run has used. */
export const newLogin = (prefix = "fe") => `${prefix}.${Math.random().toString(36).slice(2, 10)}`;

/** The phone's text size, as the design checks ask it: at a 200% root font every text doubles and nothing scrolls sideways at 360. */
export async function expectScales(page: Page): Promise<void> {
  const s = await checkTextScaling(page, { factor: 2 });
  expect(s.count, "sampled text").toBeGreaterThan(3);
  expect(s.minRatio, "every sampled text grew with the root").toBeGreaterThanOrEqual(1.95);
  expect(s.overflow.doc, `sideways scroll at 200%: ${s.overflow.offenders.join(", ")}`).toBeLessThanOrEqual(0);
}
