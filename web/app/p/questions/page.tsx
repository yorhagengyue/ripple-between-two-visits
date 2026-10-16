/**
 * /p/questions — his question list (task M4; web-app.md section 4): for the doctor and for the pharmacist, each with
 * where it came from (his own / from a visit / Ripple did not answer / a pattern in his log / a medicine Ripple
 * can't identify) and, once a visit has answered it, the answer word for word with its source chip.
 *
 * Story-day gating (lib/daily/questions.ts): questions recorded after the story day are not shown, and an answer only
 * once it has been said by the story moment (its visit has happened by the story day and time; 10-10), so before the
 * D42 visit q-extra-tablet still waits. Reading the page brings the routine-pattern question up to date first (exactly
 * one per pattern, wording that only describes the pattern).
 *
 * C2 (track C): on his own account the page is the elder screen in the timeline design (design group 14;
 * AccountQuestions.tsx): since the owner's decision of 10-14 one list, part of the visit tab (「看全部」 from /p/visit):
 * what is still to ask in his own words, the doctor's and the pharmacist's together (a small tag on the pharmacist's),
 * with 「改一下字」 「这条不问了」 「合并」, 「加一个问题」; the answered and the set-aside ones a tap away.
 */
import Link from "next/link";
import { ClipPlay } from "@/components/daily/ClipPlay";
import { AddQuestion, QuestionActions } from "@/components/daily/QuestionTools";
import { settleNoReply } from "@/lib/daily/doses";
import { dt, type DailyKey } from "@/lib/daily/i18n";
import { chipDetail, chipText } from "@/lib/daily/lines";
import { syncPatternQuestions } from "@/lib/daily/patterns";
import { questionsView } from "@/lib/daily/questions";
import type { QuestionItemView } from "@/lib/daily/types";
import { t, type Locale } from "@/lib/i18n";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";
import { questionList } from "@/lib/profile/questions";
import { AccountQuestions, noticeFrom } from "./AccountQuestions";

export const dynamic = "force-dynamic";

const ORIGIN_KEYS = new Set(["own", "before_you_go", "refused_question", "pattern", "unidentified_medicine", "understanding_check"]);

function QuestionCard({ q, locale, tools }: { q: QuestionItemView; locale: Locale; tools: boolean }) {
  const originKey = (ORIGIN_KEYS.has(q.origin) ? `q.origin.${q.origin}` : "q.origin.other") as DailyKey;
  return (
    <li className="rp-qlist px-4 py-3" data-testid="question" data-question={q.id} data-origin={q.origin} data-status={q.status} data-wording={q.wording}>
      <span className="rp-tag">
        {dt(locale, originKey)}
        {q.wording === "recorded_summary" ? ` · ${dt(locale, "q.recordedSummary")}` : ""}
      </span>
      <p className="rp-qt mt-1" data-testid="question-text" lang={q.lang ?? undefined}>
        {q.text}
      </p>
      {q.summary ? (
        <p className="text-body text-ink-2" data-testid="question-summary" lang={q.summary.lang ?? undefined}>
          {dt(locale, "q.summaryOf")}
          {q.summary.text}
        </p>
      ) : null}
      <p className="text-body text-ink-2" data-testid="question-status">
        {dt(locale, `q.status.${q.status}` as DailyKey)}
      </p>
      {q.answer ? (
        <div className="rp-card mt-2" data-testid="question-answer" data-chip={q.answer.chip.kind} data-inferred={q.answer.chip.inferred ? "true" : "false"}>
          <div className="rp-tag" data-testid="question-answer-chip">
            ● {chipText(locale, q.answer.chip)}
          </div>
          <p className="mt-1.5 text-body leading-[1.42]" data-testid="question-answer-text">
            {q.answer.text}
          </p>
          {chipDetail(locale, q.answer.chip) ? <div className="rp-src">{chipDetail(locale, q.answer.chip)}</div> : null}
          {q.answer.clipUrl ? <ClipPlay url={q.answer.clipUrl} locale={locale} standIn={!!q.answer.chip.standInVoice} /> : null}
        </div>
      ) : null}
      {/* C2 track E (only add; real-app 12 「问题单不能加、删、标『问过了』」): he changes his own list on the demo too */}
      {tools ? <QuestionActions id={q.id} text={q.text} status={q.status} ownWords={q.wording === "own_words"} locale={locale} /> : null}
    </li>
  );
}

function Group({ title, items, locale, testId, fixed }: { title: string; items: QuestionItemView[]; locale: Locale; testId: string; fixed: Set<string> }) {
  return (
    <section className="flex flex-col gap-2" data-testid={testId}>
      <h2 className="text-[20px] font-bold">
        {title} <span className="text-ink-2">· {items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className="text-body text-ink-2">{dt(locale, "q.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((q) => (
            <QuestionCard key={q.id} q={q} locale={locale} tools={!fixed.has(q.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function QuestionsPage({ searchParams }: PageProps<"/p/questions">) {
  const [ctx, locale] = await Promise.all([getPageSubject(), getPatientLocale()]);
  if (!ctx) return null;
  const store = ctx.store;
  await settleNoReply(store, ctx.session);
  await syncPatternQuestions(store, ctx.session);
  // C2 track C: his own account gets the new list (add, change, set aside, merge); the demo's page below is unchanged
  if (ctx.subject.kind === "account") {
    // the watch's observation (example data) is off the list (owner, 10-14: off the demo path; its page /p/watch stays)
    const [list, sp] = await Promise.all([questionList(store, ctx.session, locale), searchParams]);
    // one list (owner 10-14): the doctor's and the pharmacist's questions together, part of the visit tab
    return <AccountQuestions scope={ctx.session} list={list} locale={locale} notice={noticeFrom(sp)} watch={null} />;
  }
  const view = await questionsView(store, ctx.session, locale);
  // C2 track E (only add): a story question whose answer is already recorded at a visit keeps its words and its place
  // (the route refuses to change it: the answer stays with the words it answered), so it shows no 「改一下」 or 「不问了」,
  // also while the story clock is still before that visit and the answer is not shown yet
  const fixed = new Set((await store.listQuestions(ctx.session.id)).filter((q) => q.status === "answered").map((q) => q.id));
  return (
    <div className="flex flex-col gap-5" data-testid="page-questions" data-day={view.day}>
      <h1 className="text-[28px] font-bold">{t(locale, "nav.questions")}</h1>
      {/* C2 track E (only add): 「加一个问题」, in his own words; the same words twice stay one question */}
      <AddQuestion locale={locale} />
      <Group title={dt(locale, "q.forDoctor")} items={view.doctor} locale={locale} testId="questions-doctor" fixed={fixed} />
      <Group title={dt(locale, "q.forPharmacist")} items={view.pharmacist} locale={locale} testId="questions-pharmacist" fixed={fixed} />
      <Link href="/p/brief" className="rp-btn rp-btn-ghost block min-h-14 text-center no-underline" data-testid="questions-brief">
        {dt(locale, "q.brief")}
      </Link>
    </div>
  );
}
