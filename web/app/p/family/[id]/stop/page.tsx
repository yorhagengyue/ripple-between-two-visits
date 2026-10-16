/**
 * /p/family/[id]/stop — 「停止分享」 (the timeline draft's 20-1; real-app 2.22; front-end line fe-fam). Reached from her
 * page (/p/family/[id]) by 「停止分享给 Wei Ling」. One sentence that says what the tap does, and the one red button in
 * the lower part. No confirm dialog: the tap stops it at once, her open page follows within a second, and he is back on
 * her page, which says it has stopped and offers 「重新邀请」 (the draft's 20-2). There is no undo bar: stopping is for
 * good (web/progress/d.md), which is why the button has a screen of its own. Only for a link that is in force: for any
 * other state this address leads back to her page. His own links only.
 */
import { redirect } from "next/navigation";
import { CareLive, StopSharing } from "@/components/family/HisFamily";
import { HisScreen, Lead } from "@/components/his-family/pieces";
import { ActionDock } from "@/components/ui";
import { linkStateWords } from "@/lib/care/copy";
import { pc } from "@/lib/care/his-copy";
import { hisLink } from "../his-link";

export const dynamic = "force-dynamic";

export default async function FamilyStopPage({ params }: PageProps<"/p/family/[id]/stop">) {
  const { id: raw } = await params;
  const { locale, link, id, href, name, who, backToLink } = await hisLink(raw);
  if (link.state !== "active") redirect(href);
  return (
    <HisScreen locale={locale} back={backToLink} title={who} subtitle={linkStateWords("active", locale)} testId="page-family-stop" attrs={{ "data-link": id }}>
      <CareLive />
      <div className="rpu-stack">
        <Lead>{pc(locale, "stopBody")}</Lead>
      </div>
      <ActionDock>
        <StopSharing linkId={id} locale={locale} name={name} after={href} />
      </ActionDock>
    </HisScreen>
  );
}
