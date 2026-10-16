/**
 * GET /api/profile/lang?to=en|zh-Hans&next=/p/questions — the 「中 EN」 switch of his screens and of hers (track C): sets
 * the UI language cookie (rp_lang, a year) and goes back to the screen it was pressed on. A plain link, so it works
 * without script (components/ui AccountHeader, in the header of every screen of his; components/family-ui LangToggle).
 * `next` must be a path on this site (one leading slash); anything else goes to Today.
 *
 * Owner's decision of 2026-10-14 (the language is switched inside the app, on every screen): the switch also keeps the
 * choice. When the browser is signed in, the language is written to that person's account (account.locale: what the
 * next sign-in puts back into rp_lang, lib/auth/http.ts signedInResponse; what his reminders are sent in; what a family
 * member's notices use, lib/care/recipients.ts) and, for someone with a space of his own, to that space as well, exactly
 * as 「我 › 语言」 does (lib/profile/identity.ts saveHisLanguage). A family member has no space: her account alone.
 * Not signed in: the cookie only, as before (nothing is looked up).
 *
 * The redirect never fails with the write: if the account could not be read or written the cookie still stands, this
 * browser is in the new language, and the next tap writes it again. Nothing is written for a link another site sent
 * the browser to, nor when `to` names no language (the cookie then falls back to 华语, as it always did).
 */
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE } from "@/lib/auth/cookies";
import { LOCALE_COOKIE, toLocale, type Locale } from "@/lib/i18n";
import { safeNext } from "@/lib/profile/copy";
import { saveHisLanguage } from "@/lib/profile/identity";
import { requireUser } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Is there a choice to keep, and someone to keep it for? (`to` named a language, this site's own link, a sign-in cookie) */
function toKeep(req: NextRequest, asked: string | null): boolean {
  // "zh", "en-SG" and the like name a language; anything else only fell back to 华语 and is nobody's choice
  if (!asked || toLocale(asked, "zh-Hans") !== toLocale(asked, "en")) return false;
  // a link on another site may change this browser's cookie (as before), never what is stored for the account
  if ((req.headers.get("sec-fetch-site") ?? "").trim().toLowerCase() === "cross-site") return false;
  // the proxy has refreshed the sign-in by now: no access cookie, nobody signed in
  return !!req.cookies.get(ACCESS_COOKIE)?.value?.trim();
}

/** Write the language to the signed-in person's account, and to his own space if he has one. Never throws. */
async function keep(req: NextRequest, to: Locale): Promise<void> {
  try {
    // the person behind the sign-in cookie (verified), with a store bound to their own rows only (lib/subject)
    const found = await requireUser(req);
    if (!found.ok) return; // not signed in after all, or the store cannot be read: the cookie stands
    if (found.scope) await saveHisLanguage(found.store, found.scope, to);
    else await found.store.updateAccount(found.user.userId, { locale: to });
  } catch (err) {
    console.warn("[profile/lang] the language was not kept on the account", err instanceof Error ? err.message : err);
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const asked = req.nextUrl.searchParams.get("to");
  const to = toLocale(asked, "zh-Hans");
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const res = NextResponse.redirect(new URL(next, req.nextUrl.origin), 303);
  res.cookies.set(LOCALE_COOKIE, to, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  // waited for, so the account says the same as the cookie by the time the screen is loaded again
  if (toKeep(req, asked)) await keep(req, to);
  return res;
}
