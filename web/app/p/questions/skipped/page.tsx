/**
 * /p/questions/skipped — the questions he set aside (track C; journey 07), in the timeline design: one line, each
 * question in his words (his node, where it came from and when) with 「放回去」 under it. Merged duplicates are not here
 * (they live on in the question they were merged into). The demo has no such page (404).
 */
import { notFound } from "next/navigation";
import { Box, PageHeader, Screen, TabBar, Timeline } from "@/components/ui";
import { questionsCopy } from "@/lib/profile/copy";
import { questionList } from "@/lib/profile/questions";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";
import { QuestionLine } from "../AccountQuestions";
import { PutBack } from "../QuestionActions";

export const dynamic = "force-dynamic";

export default async function SkippedQuestionsPage() {
  const [ctx, locale] = await Promise.all([getPageSubject(), getPatientLocale()]);
  if (!ctx) return null;
  if (ctx.subject.kind !== "account") notFound();
  const c = questionsCopy(locale);
  const list = await questionList(ctx.store, ctx.session, locale);
  return (
    // the question list is part of 就诊 (owner 10-14)
    <Screen locale={locale} className="rp14q" tabBar={<TabBar active="visit" locale={locale} placement="fixed" />} tabBarPlacement="fixed">
      <PageHeader locale={locale} back={{ href: "/p/questions", label: c.backToList }} title={c.skippedTitle.join(" ")} />
      <div className="rpu-stack">
        {list.skipped.length === 0 ? (
          <Box variant="dash" testId="questions-skipped-none">
            {c.skippedNone}
          </Box>
        ) : (
          <Timeline>
            {list.skipped.map((q) => (
              <QuestionLine key={q.id} q={q} locale={locale} actions={<PutBack id={q.id} locale={locale} />} />
            ))}
          </Timeline>
        )}
      </div>
    </Screen>
  );
}
