import type { UiLocale } from "@/lib/ui/tokens";
import { MeEntry } from "./MeEntry";

/**
 * 我 · 我的档案 / My details (entry "profile"; real-app 2.23). Owner: C (example data and onboarding). Page: app/p/profile.
 * Shows what is there and what waits for him: 「家人写了 2 条，等你看」 when a family member's facts wait for his 对.
 */
export function ProfileEntry({ locale, href = "/p/profile", pending = 0, name = null }: { locale: UiLocale; href?: string; pending?: number; name?: string | null }) {
  const zh = locale === "zh-Hans";
  const status =
    pending > 0
      ? zh
        ? `家人写了 ${pending} 条，等你看`
        : `${pending} written by your family, waiting for you`
      : zh
        ? `${name ? `${name} · ` : ""}称呼、作息、诊所、病史`
        : `${name ? `${name} · ` : ""}Name, routine, clinic and history`;
  return <MeEntry entry="profile" href={href} title={zh ? "我的档案" : "My details"} status={status} />;
}
