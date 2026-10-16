import { Icon } from "@/components/ui/icons";
import { UiLink } from "@/components/ui/UiLink";
import { profileCopy } from "@/lib/profile/copy";
import type { UiLocale } from "@/lib/ui/tokens";

/**
 * Today · 「家人写了 N 条，请你看一下。」 (the banner slot of TodayLayout, under the example's banner; owner: C). One quiet
 * line while facts a family member wrote for his profile wait for his 对 / 改一下 / 不对 (M11, real-app 2.5); the whole
 * line opens 我 › 我的档案 (/p/profile), where they come first. Not shown when nothing waits. Fixed words only.
 */
export function FamilyFactsLine({ locale, count }: { locale: UiLocale; count: number }) {
  if (count <= 0) return null;
  const words = profileCopy(locale).pendingTitle(count).join(" ");
  return (
    <UiLink href="/p/profile" nav="forward" className="rpu rpu-banner" data-rp="family-facts-line" data-count={count} style={{ alignItems: "center", color: "var(--rp-ink)", textDecoration: "none" }}>
      <Icon name="family" />
      <span style={{ flex: 1 }}>{words}</span>
      <Icon name="chevron" stroke={2.4} />
    </UiLink>
  );
}
