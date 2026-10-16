/**
 * /f/alert/told?link=&id= — one notice 「爸爸跟 Ripple 说了一件可能要留意的事」 opened (owner 10-16: 「通知相应的对话」;
 * lib/care/told.ts). Where her push lands and where 「看这段对话」 on her 「留意」 leads: what he said and when, then what
 * Ripple answered him, line by line as his screen showed it (the 995 line, his doctor's own warning line with its day,
 * "kept for your doctor"), the line that says she is told this whatever he shares, and the call button.
 *
 * THE BASELINE: no switch of his is read for it (every other page of hers is cut by them). Through her active link (else
 * back to /f, herPage); her look is logged as on her other pages, as 「told」 (his 「谁看过」 says 「看了你的 Ripple 对话（可能要留意的
 * 那段）」, lib/care/access-log.ts), under no switch. Read only: nothing of his changes.
 */
import { DayClock } from "@/components/daily/elder/DayClock";
import { CallDad } from "@/components/family/CallDad";
import { HerLive } from "@/components/family/HerLive";
import { ToldConversation } from "@/components/family/ToldCard";
import { EmptyBlock, FamilyDock, FamilyHero, FamilyScreen, FamilyTop } from "@/components/family-ui";
import { logLook } from "@/lib/care/access-log";
import { hc } from "@/lib/care/her-copy";
import { herDayClock, herPage, herSwitches } from "@/lib/care/her-page";
import { toldNotice } from "@/lib/care/told";
import { localDate } from "@/lib/time/clock";
import { scopeTz } from "@/lib/store/scope";
import { nowMs } from "@/lib/time/now";
import { familyCopy } from "@/lib/ui/copy";

export const dynamic = "force-dynamic";

export default async function FamilyToldPage({ searchParams }: PageProps<"/f/alert/told">) {
  const sp = await searchParams;
  const p = await herPage(sp, "/f/alert/told");
  const { ctx, link, locale, dad, paths } = p;
  const id = typeof sp.id === "string" ? sp.id : "";
  const now = nowMs();
  const [{ version }, notice] = await Promise.all([herSwitches(ctx.store, ctx.session, link.id), id ? toldNotice(ctx.store, ctx.session, link.id, id).catch(() => null) : Promise.resolve(null)]);
  if (notice) await logLook(ctx.store, ctx.session.id, { linkId: link.id, userId: p.userId, label: link.family_label, route: "/f/alert/told", items: ["told"] }, now);
  const today = localDate(now, scopeTz(ctx.session));
  return (
    <HerLive linkId={link.id} since={ctx.since} version={version} locale={locale} dad={dad} langHref={p.langHref}>
      <DayClock {...herDayClock(ctx.session, now)} />
      <div className="contents" data-testid="family-told" data-state={notice ? "shown" : "gone"}>
        {/* a page under 「留意」: the way back to it at the top, as her other detail pages (no tab bar) */}
        <FamilyScreen locale={locale}>
          <FamilyTop back={{ href: paths.alert, label: familyCopy(locale, dad).tabs.notice }} locale={locale} langHref={p.langHref} />
          {notice ? (
            <>
              <FamilyHero tone="chk" title={hc(locale, "toldTitle", { dad })} />
              <ToldConversation notice={notice} today={today} tz={p.tz} locale={locale} dad={dad} />
              <FamilyDock foot="n">
                <CallDad linkId={link.id} locale={locale} dad={dad} variant="primary" />
              </FamilyDock>
            </>
          ) : (
            <EmptyBlock title={hc(locale, "toldGone", { dad })} />
          )}
        </FamilyScreen>
      </div>
    </HerLive>
  );
}
