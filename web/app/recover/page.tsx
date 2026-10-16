/**
 * /recover (docs/plan/real-app.md 2.4; track A): reset a forgotten password with the recovery code, or with a family
 * member's help when he turned that on beforehand (RecoverFlow). ?login= fills
 * the account (the login's 「忘记密码？」 and its lock screen pass it). Open to anyone, signed in or not: a person who
 * forgot his password may still have an old sign-in somewhere.
 */
import type { Metadata, Viewport } from "next";
import { otherLocale, pageLocale } from "@/lib/auth/page-locale";
import { accountReadAloudAvailable } from "@/lib/auth/read-aloud";
import { authThemeColor } from "@/lib/ui/auth-tokens";
import { RecoverFlow } from "./RecoverFlow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "忘记密码 · Ripple" };
// the browser's own bar takes the ground of the set of colours this side's screens are drawn in (lib/ui/auth-tokens.ts)
export const viewport: Viewport = { themeColor: authThemeColor("elder") };

export default async function RecoverPage({ searchParams }: PageProps<"/recover">) {
  const q = await searchParams;
  const login = (Array.isArray(q.login) ? q.login[0] : q.login)?.slice(0, 254) ?? "";
  const locale = await pageLocale(q.lang);
  const params = new URLSearchParams({ lang: otherLocale(locale), ...(login ? { login } : {}) });
  // 「读给我听」 only with a real voice (real-app 2.17: never the mock's placeholder tones)
  return <RecoverFlow locale={locale} initialLogin={login} langHref={`/recover?${params.toString()}`} readAloud={accountReadAloudAvailable()} />;
}
