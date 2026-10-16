/**
 * /f/me/devices?link= — 「我的 → 登录和设备」 (the fe-d track): the devices she signed in on, read the way his
 * /p/me/devices reads them (lib/auth/service.ts listDevices, for the signed-in person; no space is needed), this one
 * first. 「退出这台」 and 「退出所有设备」 post to the account's own routes. Above the list, two rows lead to 「改密码」
 * and 「换一个恢复码」 (they were rows of 「我的」; owner's tidy of 10-13). Through her active link, or one of hers that
 * has ended (it is her own sign-in: lib/care/her-page.ts herOwnPage); anything else goes back to /f.
 * components/family/HerSecurity.tsx draws it.
 */
import { redirect } from "next/navigation";
import { HerDevicesScreen } from "@/components/family/HerSecurity";
import { listDevices } from "@/lib/auth/service";
import { herOwnPage } from "@/lib/care/her-page";
import { accountDeps, pageFacts, pageUser } from "@/lib/subject/account";

export const dynamic = "force-dynamic";

export default async function FamilyDevicesPage({ searchParams }: PageProps<"/f/me/devices">) {
  const p = await herOwnPage(await searchParams, "/f/me/devices");
  const me = await pageUser();
  if (!me) redirect("/f");
  const devices = await listDevices(accountDeps(), me, await pageFacts());
  return <HerDevicesScreen locale={p.locale} back={p.paths.me} langHref={p.langHref} devices={devices} passwordHref={p.paths.password} recoveryHref={p.paths.recovery} />;
}
