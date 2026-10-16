/**
 * The way in, as addresses (line fe-entry; web/progress/fe-entry.md): the door (/), the choice of side (/who), and each
 * side's log-in and sign-up. Pure and client-safe: the pages and the flows build every link between these pages here.
 *
 *   /who?do=signup|login        「你是哪一位？」, on the way to signing up or to logging in
 *   /login?as=elder|family      that side's log-in. Without `as`: the side `next` implies; else the elder's
 *   /signup?as=elder|family     that side's sign-up, the same way
 *
 * So a bare /login and a bare /signup are the elder's pages, as they were before there were two.
 *
 * A language the address asked for (?lang=, the door's and the log-in's switch) is carried from one of these pages to
 * the next, so the choice at the door holds all the way through. A language that came from the rp_lang cookie or from
 * the browser needs no carrying: the next page finds it the same way.
 */
import type { AuthSide } from "@/lib/ui/auth-tokens";

/** What someone at the door is about to do. */
export type EntryDo = "signup" | "login";

type Param = string | string[] | null | undefined;

const first = (v: Param): string | null => (Array.isArray(v) ? v[0] : v) ?? null;

/** `as` in an address: one of the two sides, or null when it names neither. */
export function sideParam(v: Param): AuthSide | null {
  const s = first(v);
  return s === "elder" || s === "family" ? s : null;
}

/** `do` in the address of /who: logging in only when it says so; anything else is signing up. */
export function doParam(v: Param): EntryDo {
  return first(v) === "login" ? "login" : "signup";
}

/** Her page and the pages under it (/f, /f/…) and an invitation's (/invite/…): someone on the way there is family. */
const FAMILY_PAGES = /^\/(?:f|invite)(?:\/|\?|$)/;

/**
 * Whose log-in or sign-up page this is: `as` when the address says it; else what `next` implies (one of her pages
 * means family; his own, /p and /onboard, and anything else mean the elder); else the elder.
 */
export function entrySide(as: Param, next?: string | null): AuthSide {
  return sideParam(as) ?? (next && FAMILY_PAGES.test(next) ? "family" : "elder");
}

/** The other of the two sides. */
export function otherSide(side: AuthSide): AuthSide {
  return side === "elder" ? "family" : "elder";
}

export interface EntryQuery {
  do?: EntryDo;
  as?: AuthSide | null;
  /** the page to go back to after logging in (already checked: lib/auth/next.ts safeNext) */
  next?: string | null;
  /** a language the address asked for; never one that was only found (the cookie, the browser) */
  lang?: string | null;
}

/** One of these pages' addresses, carrying only what is given: entryHref("/login", { as: "family", next, lang }). */
export function entryHref(path: "/" | "/who" | "/login" | "/signup", q: EntryQuery = {}): string {
  const params = new URLSearchParams();
  if (q.do) params.set("do", q.do);
  if (q.as) params.set("as", q.as);
  if (q.next) params.set("next", q.next);
  if (q.lang) params.set("lang", q.lang);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
