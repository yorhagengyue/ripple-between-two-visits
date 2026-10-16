/**
 * The parts of the welcome, log-in, sign-up and recovery screens, derived from the owner's iOS app (styles:
 * app/ripple-auth.css, tokens: lib/ui/auth-tokens.ts). One set of parts, two sets of colours (which one each face is
 * drawn in is AUTH_SCHEME in the tokens), two sizes: <AuthScreen side="elder"> for Mr Tan's own pages, side="family"
 * (the iOS sizes) for his son's or daughter's log-in and sign-up, side="door" for the welcome and 「你是哪一位？」 (the
 * elder's size). Notes: web/progress/fe-auth.md, and web/progress/fe-entry.md for the way in.
 */
export { AuthActions, AuthDock, AuthNav, AuthNavLink, AuthScreen, authFlow, authNoPrint, type AuthBack, type AuthLocale, type DataAttrs } from "./AuthScreen";
export { AuthLogo } from "./AuthLogo";
export { AuthSplash } from "./AuthSplash";
export { SPLASH_DRAW_SECONDS, SPLASH_FADE_SECONDS, SPLASH_GATE, SPLASH_SEEN_KEY } from "./splash";
export { AuthWay } from "./AuthWays";
export { doParam, entryHref, entrySide, otherSide, sideParam, type EntryDo, type EntryQuery } from "./entry";
export { entryCopy, sideTitle, type EntryCopy } from "./entry-copy";
export { AuthLink } from "./AuthLink";
export { AuthAvatar, AuthDone, AuthError, AuthFeatureRow, AuthFeatures, AuthHead, AuthHero, AuthHeroText, AuthHint, AuthText, AuthTitle } from "./AuthText";
export { AuthLinks, AuthPrimaryButton, AuthSecondaryButton, AuthTextButton } from "./AuthButtons";
export { AuthCheckbox, AuthChoiceList, AuthField, AuthPasswordField, AuthSwitchRow, type AuthChoice, type AuthFieldProps } from "./AuthFields";
export { AuthCard, AuthCode, AuthMore, AuthParagraphs, AuthRecoveryCard } from "./AuthBlocks";
export { AuthReadAloud } from "./AuthReadAloud";
export { AuthIcon, type AuthIconName } from "./icons";
