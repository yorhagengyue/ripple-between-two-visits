import { Box } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import { getPageSubject } from "@/lib/subject";
import { hasPushSubscription } from "@/lib/subject/push";

/**
 * 「Wei Ling 还没打开通知，收不到」 on his switches screen (C2 track I, follow-up, on track D's page; real-app 3.10:
 * 「她还没开通知时，他打开这一项的那一屏明说『她还没打开通知，收不到』」). Shown only while his 「两次提醒没回时通知她」
 * switch is on for this link and none of her phones has notifications on: the switch alone tells her nothing until
 * she turns them on (her home offers it: components/family/PushNudge.tsx). A server component: read on every render
 * of the page, which re-reads itself after each switch change.
 *
 * It says one thing about her, whether a notice can reach her at all; never which phone, or when.
 *
 * In the timeline draft's look (front-end line fe-fam): a white box under the card of switches, like the draft's
 * 「通知没打开，8:45 不会响。」 (通用-5c): what is so in the bold line, what changes it in the line under it. The two
 * lines are the same sentence as before, cut at its full stop.
 */
export function herPushParts(name: string, locale: Locale): readonly [string, string] {
  return locale === "zh-Hans"
    ? [`${name} 还没打开通知，现在收不到。`, "她在自己的手机上打开以后才会收到。"]
    : [`${name} has not turned on notifications yet, so this cannot reach her.`, "It will once she turns them on on her phone."];
}

export function herPushWords(name: string, locale: Locale): string {
  return herPushParts(name, locale).join(locale === "zh-Hans" ? "" : " ");
}

export async function HerPushLine({ linkId, name, locale, on }: { linkId: string; name: string; locale: Locale; on: boolean }) {
  if (!on) return null;
  const ctx = await getPageSubject().catch(() => null);
  if (!ctx || ctx.subject.kind !== "account" || ctx.subject.relation !== "self" || !ctx.subject.userId) return null;
  // his own link (the scoped store answers only for a link he is party to)
  const link = await ctx.store.getCareLink(linkId).catch(() => null);
  if (!link || link.patient_id !== ctx.subject.userId || link.status !== "active" || !link.family_id) return null;
  if (await hasPushSubscription(link.family_id)) return null;
  const [what, then] = herPushParts(name, locale);
  return (
    <div data-testid="her-push-off" role="status">
      <Box title={what}>{then}</Box>
    </div>
  );
}
