/**
 * /f/me/install?link= — 「加到主屏」 (the fe-d track): the screen behind 「怎么加到主屏」 on 「我的」→「通知」 (G2) and behind
 * the row on 「我的」. The draft names the row and does not draw the screen; it is the first visit's third step (A4c)
 * without the step count: the sentence, the three pictured steps on an iPhone (Android: the browser's own 「装到主屏」
 * while it is offered), and the way back. components/family/HerInstall.tsx does the rest.
 */
import { HerInstall } from "@/components/family/HerInstall";
import { FamilyButton, FamilyDock, FamilyHero, FamilyScreen, FamilyTop } from "@/components/family-ui";
import { hc } from "@/lib/care/her-copy";
import { herPage } from "@/lib/care/her-page";

export const dynamic = "force-dynamic";

export default async function FamilyInstallPage({ searchParams }: PageProps<"/f/me/install">) {
  const p = await herPage(await searchParams, "/f/me/install");
  const { locale, paths } = p;
  return (
    <div className="contents" data-testid="family-install">
      <FamilyScreen locale={locale}>
        <FamilyTop back={{ href: paths.me, label: hc(locale, "meBack") }} locale={locale} langHref={p.langHref} />
        <FamilyHero tone="quiet" title={hc(locale, "homeTitle")} detail={hc(locale, "homeBody")} />
        <HerInstall locale={locale} always />
        <FamilyDock foot="d">
          <FamilyButton href={paths.me} nav="back" data-testid="install-done">
            {hc(locale, "gotIt")}
          </FamilyButton>
        </FamilyDock>
      </FamilyScreen>
    </div>
  );
}
