/**
 * /f/me/password?link= — 「我的 → 改密码」 (the fe-d track): her own password, changed on her side. His /p/me/password is
 * closed to an account without a space of its own (app/p/layout.tsx); the route it posts to, POST /api/auth/password,
 * knows the person by the sign-in and serves her as it is. Through her active link, or one of hers that has ended (it
 * is her own sign-in: lib/care/her-page.ts herOwnPage); anything else goes back to /f.
 * components/family/HerSecurity.tsx draws it.
 */
import { HerPasswordFlow } from "@/components/family/HerSecurity";
import { herOwnPage } from "@/lib/care/her-page";

export const dynamic = "force-dynamic";

export default async function FamilyPasswordPage({ searchParams }: PageProps<"/f/me/password">) {
  const p = await herOwnPage(await searchParams, "/f/me/password");
  return <HerPasswordFlow locale={p.locale} back={p.paths.me} langHref={p.langHref} />;
}
