/**
 * /login (docs/plan/real-app.md 2.3; track A): log in, then back to ?next= (the page he was sent away from by the proxy)
 * or his own home. Someone already signed in goes on at once.
 *
 * The page has two sides (line fe-entry; web/progress/fe-entry.md): the elder's log-in, light, and his son's or
 * daughter's, in the iOS dark at the iOS sizes. Which one: ?as=elder|family when the address says it (「你是哪一位？」
 * does); else what ?next= implies (one of her pages, /f or /invite, means
 * family); else the elder's, so the bare address is his page as it always was. The steps and what they do are the
 * same on both, and the server sends each account to its own side whichever page it logged in on.
 */
import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { entryHref, entrySide, sideParam } from "@/components/auth-ui";
import { safeNext } from "@/lib/auth/next";
import { asAccountLocale, otherLocale, pageLocale } from "@/lib/auth/page-locale";
import { signedInHome } from "@/lib/subject/account";
import { authThemeColor } from "@/lib/ui/auth-tokens";
import { LoginFlow } from "./LoginFlow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "登录 · Ripple" };

type Query = Awaited<PageProps<"/login">["searchParams"]>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** What the address says: where to go back to, the side it names (if it names one), and the side the page is. */
function read(q: Query) {
  const next = safeNext(one(q.next));
  return { next, as: sideParam(q.as), side: entrySide(q.as, next), lang: asAccountLocale(one(q.lang)) };
}

// the browser's own bar takes the ground of the set of colours this side's screens are drawn in (lib/ui/auth-tokens.ts)
export async function generateViewport({ searchParams }: PageProps<"/login">): Promise<Viewport> {
  return { themeColor: authThemeColor(read(await searchParams).side) };
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const q = await searchParams;
  const { next, as, side, lang } = read(q);
  const home = await signedInHome();
  if (home) redirect(next ?? home);
  const locale = await pageLocale(q.lang);
  // the same page in the other language: the side it was asked for and the way back stay (only her page shows it)
  const langHref = entryHref("/login", { as, next, lang: otherLocale(locale) });
  return <LoginFlow locale={locale} next={next} langHref={langHref} side={side} lang={lang} />;
}
