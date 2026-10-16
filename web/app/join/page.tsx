/**
 * /join — enter the join code (or open /join?code=XXXXXX) and pick this device's role: the phones of the crew's filming
 * session (the shoot's fallback, real-app 5.4). The crew's only (lib/crew/gate.ts): a phone signs in at /backstage/crew
 * first; anyone else gets Next's 404 (a judge never joins with a code: the judge has an own copy on /demo).
 */
import { LangToggle } from "@/components/LangToggle";
import { JoinForm } from "@/components/session/JoinForm";
import { t } from "@/lib/i18n";
import { requireCrewPage } from "@/lib/crew/gate";
import { getPatientLocale } from "@/lib/session/server";
// the crew's phone pages share the demo phone's look (the .rp-patient scope)
import "@/components/patient/demo-phone.css";

export default async function JoinPage({ searchParams }: PageProps<"/join">) {
  await requireCrewPage();
  const [query, locale] = await Promise.all([searchParams, getPatientLocale()]);
  const code = typeof query.code === "string" ? query.code : "";
  return (
    <div className="rp-patient px-5 py-6" lang={locale} data-testid="page-join">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[28px] font-bold">{t(locale, "join.title")}</h1>
        <LangToggle locale={locale} />
      </div>
      <JoinForm locale={locale} initialCode={code} />
    </div>
  );
}
