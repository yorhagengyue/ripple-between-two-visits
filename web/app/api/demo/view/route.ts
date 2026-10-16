/**
 * The judges' demo in this browser (lib/crew/demo-view.ts; real-app 5.3).
 *   POST   /demo opened: rp_view=demo (a session cookie, httpOnly), so the split view's phone is the demo copy even when
 *          the browser is also signed in to an account; and, when the browser has no rp_lang yet, the phone's language
 *          from Accept-Language (rp_lang, readable by the phone's own language switch). 200 { view: "demo", lang }.
 *   DELETE "Back to my account": rp_view cleared; /p/today is the account again. 200 { view: null }.
 * Names no session and reads nothing of anyone's: no crew key, no sign-in needed.
 */
import { NextResponse, type NextRequest } from "next/server";
import { DEMO_VIEW, localeFromAcceptLanguage, VIEW_COOKIE } from "@/lib/crew/demo-view";
import { LOCALE_COOKIE, toLocale } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const had = req.cookies.get(LOCALE_COOKIE)?.value;
  const lang = had ? toLocale(had, localeFromAcceptLanguage(null)) : localeFromAcceptLanguage(req.headers.get("accept-language"));
  const res = NextResponse.json({ view: DEMO_VIEW, lang });
  res.cookies.set(VIEW_COOKIE, DEMO_VIEW, { path: "/", sameSite: "lax", httpOnly: true });
  if (!had) res.cookies.set(LOCALE_COOKIE, lang, { path: "/", sameSite: "lax", httpOnly: false, maxAge: 60 * 60 * 24 * 365 });
  return res;
}

export async function DELETE(): Promise<Response> {
  const res = NextResponse.json({ view: null });
  res.cookies.set(VIEW_COOKIE, "", { path: "/", sameSite: "lax", httpOnly: true, maxAge: 0 });
  return res;
}
