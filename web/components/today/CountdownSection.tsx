import { Box, Button, PrimaryButton, SecondaryButton } from "@/components/ui";
import { dateWords, dt, shortDay } from "@/lib/daily/i18n";
import type { UiLocale } from "@/lib/ui/tokens";
import { followUpHref } from "./FollowUpDay";
import { SectionPlaceholder } from "./Placeholder";

/**
 * Today · Next visit (section "countdown"), as the draft's 14-2: under the day's line a box with the accent border,
 * 「大约 10月5日 看诊，还有 5 天。」 and 「要问的有 3 个。」 with 「看问题单」, then the button 「给医生看的简报」
 * (「今天看医生 · 简报准备好了」 on the day itself, real-app 2.12). Owner: B (clock and every day).
 *
 * C2 track B, an account: the next planned visit (a follow-up he confirmed, or the example account's visit today) when
 * it is within two weeks: its date and how many days are left, how many questions wait for the doctor, and the way to
 * the visit brief. Without a planned visit nothing: the brief's button comes with the box (owner's tidy of 10-13). Real
 * dates only.
 * A follow-up worked out from the doctor's words (「大约 6 周后回来」, real-app 2.15) is on the page at any distance, as
 * 「大约 11月20日」, with 「我约的日子」 under the sentence (it opens track V's screen for that visit): once he gave the day
 * he booked the sentence says that day, and 「改日子」 stays.
 * Without `data` (the /design gallery) it is the placeholder.
 *
 * On the day of the visit (ux pass 10-12, round 4) a third thing follows the brief: 「开始看诊」, the way to start
 * the visit, and Today puts this whole section over the day's line (components/daily/elder/TodayAccount.tsx).
 *
 * Test hooks: countdown-section (data-days, data-approx), countdown-when (the date's own words), countdown-questions
 * (「3 个」), countdown-brief, countdown-start, follow-up-day (data-approx) and follow-up-set.
 */
export interface CountdownSectionData {
  next: {
    date: string;
    days: number;
    questions: number;
    /** the visit row (to set its day); absent: the day cannot be set */
    id?: string;
    /** within two weeks (default true): the countdown and the questions row */
    soon?: boolean;
    /** the date is still the doctor's "about" */
    approx?: boolean;
    settable?: boolean;
  } | null;
}

/** A sentence from a template with one part wrapped in a test hook: 「{when} 看诊，还有 5 天。」 */
function hooked(template: string, name: string, hook: string, words: string) {
  const [before, after = ""] = template.split(`{${name}}`);
  return (
    <>
      {before}
      <span data-testid={hook}>{words}</span>
      {after}
    </>
  );
}

export function CountdownSection({ locale, data }: { locale: UiLocale; data?: CountdownSectionData }) {
  const zh = locale === "zh-Hans";
  if (!data) {
    return (
      <SectionPlaceholder
        section="countdown"
        name={zh ? "离下次看诊" : "Next visit"}
        owner={zh ? "B 时钟和每一天" : "B (clock and every day)"}
        shows={zh ? "离下次看诊两周内才出现：一个紫边的框，「大约 10月5日 看诊，还有 5 天。」「要问的有 3 个。」和「看问题单」，下面「给医生看的简报」。" : "Only within two weeks of the visit: a box with the date, the days left and how many questions wait, then the brief's button."}
      />
    );
  }
  const n = data.next;
  const soon = !!n && n.soon !== false;
  // the date's own words: 「今天」, 「明天 · 10月5日 周一」, 「大约 10月5日」, 「10月5日 周一」
  const when = !n
    ? null
    : n.approx
      ? dt(locale, "today.next.about", { date: shortDay(locale, n.date) })
      : n.days === 0
        ? dt(locale, "today.next.today")
        : n.days === 1
          ? dt(locale, "today.next.tomorrow", { date: dateWords(locale, n.date) })
          : dt(locale, "today.next.on", { date: dateWords(locale, n.date) });
  const sentence = !n || when === null ? null : soon && n.days > 1 ? dt(locale, "today.next.visitInDays", { n: n.days }) : dt(locale, n.days === 0 && !n.approx ? "today.next.visitToday" : "today.next.visit");
  return (
    <div data-testid="countdown-section" data-days={n ? n.days : "none"} data-approx={n?.approx ? "true" : "false"} className="rpu-stack">
      {n && sentence && when ? (
        <Box variant="acc" title={hooked(sentence, "when", "countdown-when", when)} link={soon ? { href: "/p/questions", label: dt(locale, "today.next.seeQuestions"), testId: "countdown-questions-link" } : undefined}>
          {soon ? hooked(dt(locale, "today.next.questionsWait"), "n", "countdown-questions", dt(locale, "today.next.questionsN", { n: n.questions })) : null}
        </Box>
      ) : null}
      {n && n.settable && n.id ? (
        <div data-testid="follow-up-day" data-approx={n.approx ? "true" : "false"}>
          <Button variant="link" href={followUpHref(n.id)}>
            <span data-testid="follow-up-set">{dt(locale, n.approx ? "today.next.booked" : "today.next.change")}</span>
          </Button>
        </div>
      ) : null}
      {/* the brief's button only with a visit to count down to: a new account's brief is empty (owner's tidy of 10-13) */}
      {n && sentence && when ? (
        <SecondaryButton href="/p/brief" nav="forward">
          <span data-testid="countdown-brief">{n.days === 0 ? dt(locale, "today.next.briefReady") : dt(locale, "today.next.brief")}</span>
        </SecondaryButton>
      ) : null}
      {/* the day of the visit: the way to start it, on Today's first screen */}
      {n && n.days === 0 && !n.approx ? (
        <PrimaryButton href="/p/visit">
          <span data-testid="countdown-start">{dt(locale, "today.next.start")}</span>
        </PrimaryButton>
      ) : null}
    </div>
  );
}
