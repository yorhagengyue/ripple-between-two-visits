/**
 * /f/phone?link=&back= — she changes Dad's number, kept on her own phone (C2 track D; relaid to the v3 draft's G3 by
 * the fe-d track): 「存一下爸爸的电话。」, the field with +65 in front, 「存下来」, then back where she came from (「我的」). The
 * number never leaves her phone (lib/care/device.ts); 「打电话给爸爸」 dials it. The first time it is asked for is no
 * longer this page: it is step 1 of her first visit (A4a) or the bottom sheet under 「打电话给爸爸」 (D4).
 */
import { PhonePage } from "@/components/family/HerBits";
import { FamilyScreen, FamilyTop } from "@/components/family-ui";
import { safeNext } from "@/lib/auth/next";
import { hc } from "@/lib/care/her-copy";
import { herPage } from "@/lib/care/her-page";

export const dynamic = "force-dynamic";

export default async function FamilyPhonePage({ searchParams }: PageProps<"/f/phone">) {
  const sp = await searchParams;
  const p = await herPage(sp, "/f/phone");
  const back = safeNext(typeof sp.back === "string" ? sp.back : null) ?? p.paths.home;
  // the way back names the screen it leads to
  const label = back.startsWith("/f/me") ? hc(p.locale, "meBack") : hc(p.locale, "dadToday", { dad: p.dad });
  return (
    <div className="contents" data-testid="family-phone">
      <FamilyScreen locale={p.locale}>
        <FamilyTop back={{ href: back, label }} locale={p.locale} langHref={p.langHref} />
        <PhonePage linkId={p.link.id} locale={p.locale} dad={p.dad} back={back} />
      </FamilyScreen>
    </div>
  );
}
