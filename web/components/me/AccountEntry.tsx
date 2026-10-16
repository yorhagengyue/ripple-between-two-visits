import type { UiLocale } from "@/lib/ui/tokens";
import { meScreenCopy } from "./copy";
import { MeEntry } from "./MeEntry";

/**
 * 我 · Sign-in and devices (entry "account"), track A: one row to /p/me/devices, where his devices, 「退出登录」 and
 * 「退出所有设备」 are, with the links to a new password (/p/me/password) and a new recovery code (/p/me/recovery).
 * `status` may name what is open now ("2 台设备登录着"); without it the row says what is behind it. `count` (the devices
 * signed in now) is written on the right, as the draft's 「1 台」.
 */
export function AccountEntry({ locale, href = "/p/me/devices", status, count }: { locale: UiLocale; href?: string; status?: string; count?: number }) {
  const zh = locale === "zh-Hans";
  return (
    <MeEntry
      entry="account"
      href={href}
      title={zh ? "登录和设备" : "Sign-in and devices"}
      status={status ?? (zh ? "登录过的设备、改密码、恢复码、退出登录" : "Signed-in devices, password, recovery code, log out")}
      right={count !== undefined && count > 0 ? meScreenCopy(locale).devices(count) : undefined}
    />
  );
}
