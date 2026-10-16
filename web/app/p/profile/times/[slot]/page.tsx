/**
 * /p/profile/times/<slot> — when one part of the day's medicine is reminded (real-app 2.16 line 252, 2.23; track C;
 * laid out with the timeline draft's pieces by line fe-me): 「中午的药，几点提醒你？」 as the header, a handful of usual
 * times as chips and 「别的时间」, the chosen time and the second reminder as two nodes of one line (the draft's 01-5f),
 * one filled button. A time he set himself can be given back (the morning follows breakfast again; the others go back
 * to his routine or Ripple's own time). slot: morning | midday | evening | night. His own account only (the demo has
 * no 「我」: 404).
 */
import { notFound } from "next/navigation";
import { PageHeader, Screen } from "@/components/ui";
import { dt, type DailyKey } from "@/lib/daily/i18n";
import { meCopy } from "@/lib/profile/copy";
import { isReminderSlot, SLOT_TIME_RANGE, slotTimes } from "@/lib/profile/reminder-times";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";
import { SlotTimeForm } from "./SlotTimeForm";

export const dynamic = "force-dynamic";

export default async function SlotTimePage({ params }: PageProps<"/p/profile/times/[slot]">) {
  const [ctx, locale] = await Promise.all([getPageSubject(), getPatientLocale()]);
  const slot = (await params).slot;
  if (!isReminderSlot(slot)) notFound();
  if (!ctx) return null;
  if (ctx.subject.kind !== "account" || ctx.subject.relation !== "self") notFound();
  const c = meCopy(locale);
  const now = slotTimes(ctx.session).find((t) => t.slot === slot)!;
  const name = dt(locale, `slotMed.${slot}` as DailyKey);
  return (
    <Screen locale={locale}>
      <PageHeader back={{ href: "/p/profile/times", label: c.timesRow }} title={c.slotTitle(name).join(locale === "en" ? " " : "")} locale={locale} />
      <SlotTimeForm locale={locale} slot={slot} slotName={name} initial={now.first} own={now.source === "own"} range={SLOT_TIME_RANGE[slot]} />
    </Screen>
  );
}
