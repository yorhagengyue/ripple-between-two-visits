/**
 * /f/me/notifications?link= — 「我的」→「通知」 (the fe-d track; the v3 draft's G2): where this phone's notifications
 * stand and what to do about it. components/family/HerBits.tsx NotificationsPage reads the phone and draws the state:
 * refused (「通知关着。」, the three steps on an iPhone, 「打开了，再看一次」), never asked (「打开通知」),
 * on (「通知开着。」, 「关掉通知」); in every state the row 「怎么加到主屏」, the one way to /f/me/install now that 「我的」
 * has no row for it (owner's tidy of 10-13). Through her active link (else back to /f). Nothing of his is read here.
 */
import { NotificationsPage } from "@/components/family/HerBits";
import { FamilyScreen, FamilyTop } from "@/components/family-ui";
import { hc } from "@/lib/care/her-copy";
import { herPage } from "@/lib/care/her-page";

export const dynamic = "force-dynamic";

export default async function FamilyNotificationsPage({ searchParams }: PageProps<"/f/me/notifications">) {
  const p = await herPage(await searchParams, "/f/me/notifications");
  return (
    <div className="contents" data-testid="family-notifications">
      <FamilyScreen locale={p.locale}>
        <FamilyTop back={{ href: p.paths.me, label: hc(p.locale, "meBack") }} locale={p.locale} langHref={p.langHref} />
        <NotificationsPage locale={p.locale} dad={p.dad} installHref={p.paths.install} />
      </FamilyScreen>
    </div>
  );
}
