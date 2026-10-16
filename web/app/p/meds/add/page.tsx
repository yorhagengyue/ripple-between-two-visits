/**
 * /p/meds/add — photograph a medicine label and check it (task M3 item 2). `?med=<id>` photographs the label of a
 * medicine already on the list (its card's 「拍药袋」).
 * C2: on his own account also 「我自己输入」 (`?manual=1` goes straight there) and 「以后再说」 (`?next=` where it goes).
 * `?from=onboard` (setting up his account, real-app 2.5 step 3 「去拍药袋」): after the medicine is added, or 「以后再说」,
 * he goes on with setting up (/onboard picks up the screen that follows). Only that fixed word, never a path.
 */
import { AddLabelFlow } from "@/components/meds/AddLabelFlow";
import { AccountAddPage } from "@/components/meds/elder/pages";
import { t } from "@/lib/i18n";
import { medFullName } from "@/lib/meds/write";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";

export default async function MedAddPage({ searchParams }: PageProps<"/p/meds/add">) {
  const [ctx, locale, sp] = await Promise.all([getPageSubject(), getPatientLocale(), searchParams]);
  if (!ctx) return null;
  const medParam = typeof sp.med === "string" ? sp.med : null;
  // his own account (C2): photo checked line by line, or typed in by himself, or later (components/meds/elder)
  if (ctx.subject.kind === "account") {
    return <AccountAddPage ctx={ctx} locale={locale} medParam={medParam} manual={sp.manual === "1"} next={typeof sp.next === "string" ? sp.next : null} fromOnboard={sp.from === "onboard"} />;
  }
  const med = medParam ? await ctx.store.getMed(ctx.session.id, medParam) : null;
  return (
    <div className="flex flex-col gap-4" data-testid="page-med-add">
      <h1 className="text-[28px] font-bold">{t(locale, "page.medAdd")}</h1>
      <AddLabelFlow locale={locale} medId={med?.id ?? null} medName={med ? medFullName(med, locale) : null} medOrigin={med?.origin ?? null} />
    </div>
  );
}
