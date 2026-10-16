/**
 * /p/profile/name — 「我 › 称呼」 (real-app 2.23; track C; laid out with the timeline draft's pieces by line fe-me, the
 * field of its 01-2a): how the app addresses him, one field, and at the foot 「不改了」 and the filled 「改好了」 side by
 * side. What he answered at sign-up 「怎么称呼你」 is there to change. His own account only (the demo has no 「我」: 404).
 */
import { notFound } from "next/navigation";
import { PageHeader, Screen } from "@/components/ui";
import { meCopy } from "@/lib/profile/copy";
import { hisName } from "@/lib/profile/identity";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";
import { NameForm } from "./NameForm";

export const dynamic = "force-dynamic";

export default async function NamePage() {
  const [ctx, locale] = await Promise.all([getPageSubject(), getPatientLocale()]);
  if (!ctx) return null;
  if (ctx.subject.kind !== "account" || ctx.subject.relation !== "self") notFound();
  const c = meCopy(locale);
  return (
    <Screen locale={locale}>
      <PageHeader back={{ href: "/p/me", label: c.me }} title={c.nameTitle.join(" ")} locale={locale} />
      <NameForm locale={locale} initial={(await hisName(ctx.store, ctx.session)) ?? ""} />
    </Screen>
  );
}
