/**
 * /p/questions/answered — the questions a visit answered (track C; journey 07, 14), in the timeline design (the 已答的
 * part of 14-1a, on a page of its own with every answered question, the doctor's and the pharmacist's): one line, his
 * question (his node, or Ripple's mark; where it came from and when), then the doctor's or pharmacist's answer word for
 * word (their node, who said it in words, the visit's date and where in the recording it was said, the words in the
 * serif, the checked Chinese under English words), and the recording to listen to when there is one (a stand-in voice
 * says so). A speaker he has not confirmed is marked 「好像是医生说的」. Nothing is reworded. The field that searched them
 * by a word is gone (owner's tidy of 10-13; AnsweredSearch.tsx is left in place, unused). The demo has no such page (404).
 */
import { notFound } from "next/navigation";
import { Box, PageHeader, Screen, TabBar, Timeline } from "@/components/ui";
import { questionsCopy } from "@/lib/profile/copy";
import { questionList } from "@/lib/profile/questions";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";
import { AnsweredPair } from "../AccountQuestions";

export const dynamic = "force-dynamic";

export default async function AnsweredQuestionsPage({ searchParams }: PageProps<"/p/questions/answered">) {
  const [ctx, locale] = await Promise.all([getPageSubject(), getPatientLocale()]);
  if (!ctx) return null;
  if (ctx.subject.kind !== "account") notFound();
  const c = questionsCopy(locale);
  const [list, sp] = await Promise.all([questionList(ctx.store, ctx.session, locale), searchParams]);
  const focus = typeof sp.q === "string" ? sp.q : null;
  return (
    // the question list is part of 就诊 (owner 10-14)
    <Screen locale={locale} className="rp14q" tabBar={<TabBar active="visit" locale={locale} placement="fixed" />} tabBarPlacement="fixed">
      <PageHeader locale={locale} back={{ href: "/p/questions", label: c.backToList }} title={c.answeredTitle.join(" ")} />
      <div className="rpu-stack">
        {focus && (
          <div role="status" data-rp="questions-notice" data-notice="answered">
            <Box variant="tint" title={c.noticeAnswered} />
          </div>
        )}
        {list.answered.length === 0 ? (
          <Box variant="dash" testId="questions-answered-none">
            {c.answeredNone}
          </Box>
        ) : (
          <Timeline>
            {list.answered.map((q) => (
              <AnsweredPair key={q.id} q={q} locale={locale} highlight={q.id === focus} />
            ))}
          </Timeline>
        )}
      </div>
    </Screen>
  );
}
