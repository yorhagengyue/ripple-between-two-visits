/**
 * /f/me/recovery?link= — 「我的 → 换一个恢复码」 (the fe-d track): a new recovery code for her own account after her
 * password; the old one stops working, the new one is shown once (POST /api/auth/recovery-code, the account's own
 * route). His /p/me/recovery is closed to an account without a space of its own. Through her active link, or one of
 * hers that has ended (it is her own sign-in: lib/care/her-page.ts herOwnPage); anything else goes back to /f.
 * components/family/HerSecurity.tsx draws it.
 */
import { HerRecoveryFlow } from "@/components/family/HerSecurity";
import { herOwnPage } from "@/lib/care/her-page";

export const dynamic = "force-dynamic";

export default async function FamilyRecoveryPage({ searchParams }: PageProps<"/f/me/recovery">) {
  const p = await herOwnPage(await searchParams, "/f/me/recovery");
  return <HerRecoveryFlow locale={p.locale} back={p.paths.me} langHref={p.langHref} />;
}
