/**
 * /p/questions/[id]/edit — 「改一下字」 on one of his questions (track C; journey 07), in the timeline design: the way
 * back to the list, the screen's name, his words in a tall field, 「改好了」 in the lower half. Only a question still to
 * ask and worded by him (a pattern question keeps Ripple's wording of his log; an answered one keeps the words the doctor
 * answered): anything else goes back to the list.
 */
import { notFound, redirect } from "next/navigation";
import { PageHeader, Screen } from "@/components/ui";
import { questionsCopy } from "@/lib/profile/copy";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";
import { QuestionForm } from "../../QuestionForm";

export const dynamic = "force-dynamic";

export default async function EditQuestionPage({ params }: PageProps<"/p/questions/[id]/edit">) {
  const [ctx, locale] = await Promise.all([getPageSubject(), getPatientLocale()]);
  if (!ctx) return null;
  if (ctx.subject.kind !== "account") notFound();
  const id = decodeURIComponent((await params).id);
  const q = await ctx.store.getQuestion(ctx.session.id, id);
  if (!q || q.status !== "open" || q.merged_into || q.origin === "pattern" || q.origin === "watch_pattern") redirect("/p/questions");
  const c = questionsCopy(locale);
  return (
    <Screen locale={locale} className="rp14q">
      {/* one list since 10-14: back to it */}
      <PageHeader locale={locale} back={{ href: "/p/questions", label: c.backToList }} title={c.editTitle.join(" ")} />
      <QuestionForm mode="edit" locale={locale} id={q.id} initial={q.text} />
    </Screen>
  );
}
