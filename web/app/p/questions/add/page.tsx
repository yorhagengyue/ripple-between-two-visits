/**
 * /p/questions/add — 「加一个问题」 on his own account (track C; journey 07), in the timeline design: the way back to the
 * list, the screen's question as its name, his words in a tall field, who to ask as a segmented control, 「加上」 in the
 * lower half. Opened with ?for=pharmacist it starts on 「问药剂师」 (the list itself is one list since 10-14, with no sides).
 * The demo has no such page (404).
 */
import { notFound } from "next/navigation";
import { PageHeader, Screen } from "@/components/ui";
import { questionsCopy } from "@/lib/profile/copy";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";
import { QuestionForm } from "../QuestionForm";

export const dynamic = "force-dynamic";

export default async function AddQuestionPage({ searchParams }: PageProps<"/p/questions/add">) {
  const [ctx, locale, sp] = await Promise.all([getPageSubject(), getPatientLocale(), searchParams]);
  if (!ctx) return null;
  if (ctx.subject.kind !== "account") notFound();
  const c = questionsCopy(locale);
  const who = sp.for === "pharmacist" ? "pharmacist" : "doctor";
  return (
    <Screen locale={locale} className="rp14q">
      {/* one list since 10-14: back to it (no side of it to go back to) */}
      <PageHeader locale={locale} back={{ href: "/p/questions", label: c.backToList }} title={c.addTitle.join(" ")} />
      <QuestionForm mode="add" locale={locale} who={who} />
    </Screen>
  );
}
