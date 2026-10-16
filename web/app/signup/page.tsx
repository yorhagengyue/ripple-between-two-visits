/**
 * /signup (docs/plan/real-app.md 2.2; track A): the sign-up steps. Someone already signed in goes on to his own page
 * instead. The language starts from ?lang=, the rp_lang cookie or the browser.
 *
 * The page has two sides (line fe-entry; web/progress/fe-entry.md), chosen as /login chooses: ?as=elder|family when the
 * address says it (「你是哪一位？」 does), else what ?next= implies, else the elder's. So the bare address is the elder's
 * nine steps (SignupFlow), unchanged. ?as=family is his son's or daughter's short sign-up (FamilySignupFlow): an
 * account that only looks, in the iOS dark at the iOS sizes.
 */
import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { entrySide } from "@/components/auth-ui";
import { safeNext } from "@/lib/auth/next";
import { asAccountLocale, pageLocale } from "@/lib/auth/page-locale";
import { accountReadAloudAvailable } from "@/lib/auth/read-aloud";
import { signedInHome } from "@/lib/subject/account";
import { authThemeColor } from "@/lib/ui/auth-tokens";
import { FamilySignupFlow } from "./FamilySignupFlow";
import { SignupFlow } from "./SignupFlow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "注册 · Ripple" };

type Query = Awaited<PageProps<"/signup">["searchParams"]>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Whose sign-up this address is. */
const sideOf = (q: Query) => entrySide(q.as, safeNext(one(q.next)));

// the browser's own bar takes the ground of the set of colours this side's screens are drawn in (lib/ui/auth-tokens.ts)
export async function generateViewport({ searchParams }: PageProps<"/signup">): Promise<Viewport> {
  return { themeColor: authThemeColor(sideOf(await searchParams)) };
}

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const home = await signedInHome();
  if (home) redirect(home);
  const q = await searchParams;
  const locale = await pageLocale(q.lang);
  // 「读给我听」 on the consent and recovery-code screens only with a real voice (real-app 2.0, 2.17)
  const readAloud = accountReadAloudAvailable();
  if (sideOf(q) === "family") return <FamilySignupFlow locale={locale} lang={asAccountLocale(one(q.lang))} readAloud={readAloud} />;
  return <SignupFlow initialLocale={locale} readAloud={readAloud} />;
}
