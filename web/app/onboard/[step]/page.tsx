/**
 * /onboard/<step> — setting up a blank account, one screen at a time (journey 01 建档; real-app 2.5; track C), laid out
 * after the timeline draft's 01-5a to 01-5f (web/progress/fe-01.md).
 * who, clinic, breakfast, habits, meds, age, conditions, allergies, family, reminders, done (lib/profile/onboarding.ts).
 *
 * The eleven screens are the draft's six items, one question a screen: the clinic (1), his routine (2: breakfast, then
 * the routine as a list), the medicines (3), about him (4: age, conditions, allergies), family (5), the reminders (6).
 * The step bar says which item a screen belongs to; 「谁在填」 before them carries no bar. 「建好了」 after them is no
 * longer a screen (owner's tidy of 10-13): the reminders screen's answer finishes setting up and goes to
 * /p/today?setup=done, and /onboard/done opened by its address does the same without showing a summary.
 *
 * Every screen: 「‹ 上一步」, the step bar, the question as the title with a grey line under it, its controls, and the
 * dock at the foot (app/onboard/[step]/steps.tsx). A screen opened from his profile to change something
 * (?return=/p/profile) has no step bar, saves and goes back there instead. While a family member fills it in for him,
 * a tinted box says that what she enters waits for his own 「对」.
 * The reminders screen draws when the morning reminders come as a small line (breakfast, the first reminder, the second,
 * 「没回」): the times are what the back end computes for his space now (lib/daily/cells scopeSlotSchedule), never a
 * sample. `?edit=time` on it is 「改时间」.
 * Only his own account: no sign-in goes to /login; a demo session to Today; once set up, the setting-up screens only
 * open from his profile.
 */
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Act, Acts, BodyText, Box, PageHeader, Screen, StatusHeadline, StepBar, Timeline, TimelineItem } from "@/components/ui";
import { scopeSlotSchedule } from "@/lib/daily/cells";
import { dt, shortTime } from "@/lib/daily/i18n";
import { slotAnchor, type RoutineEntry } from "@/lib/daily/schedule";
import { meCopy, onboardCopy, profileCopy, type CLocale } from "@/lib/profile/copy";
import { clockWords } from "@/lib/profile/dates";
import { factEntry, isBreakfast, isPending, isShown } from "@/lib/profile/facts";
import { ALLERGY_CHOICES, CONDITION_CHOICES, HABIT_PRESETS, isOnboardStep, NO_ALLERGY, onboardingBy, previousStep, signupAssisted, type OnboardStep } from "@/lib/profile/onboarding";
import { SLOT_TIME_RANGE } from "@/lib/profile/reminder-times";
import { SETUP_ITEMS, setupCopy } from "@/lib/profile/setup-copy";
import { profileView } from "@/lib/profile/view";
import { getPatientLocale } from "@/lib/session/server";
import { scopeRoutine } from "@/lib/store/scope";
import { getPageSubject } from "@/lib/subject";
import { AgeStep, BreakfastStep, ClinicStep, DoneStep, FamilyStep, HabitsStep, ListStep, MedsStep, ReminderTimeStep, RemindersStep, WhoStep, type WaitingEntry } from "./steps";
import { addMinutes, daysWords, SETUP_ITEM_OF } from "./words";
import "./onboard.css";

export const dynamic = "force-dynamic";

/** Only his profile, or 「我 › 早饭时间和提醒」, may be where a changed screen returns to. */
const RETURN_TARGETS = ["/p/profile", "/p/profile/times"];
function returnTarget(sp: Record<string, string | string[] | undefined>): string | null {
  return typeof sp.return === "string" && RETURN_TARGETS.includes(sp.return) ? sp.return : null;
}

const EDITABLE: OnboardStep[] = ["clinic", "breakfast", "habits", "age", "conditions", "allergies"];

export default async function OnboardStepPage({ params, searchParams }: PageProps<"/onboard/[step]">) {
  const [ctx, locale] = await Promise.all([getPageSubject(), getPatientLocale()]);
  const step = (await params).step;
  if (!isOnboardStep(step)) notFound();
  if (!ctx) redirect(`/login?next=${encodeURIComponent("/onboard")}`);
  if (ctx.subject.kind !== "account" || ctx.subject.relation !== "self") redirect("/p/today");
  const scope = ctx.session;
  const sp = await searchParams;
  const returnTo = returnTarget(sp);
  if (scope.onboarding === "done" && !(returnTo && EDITABLE.includes(step))) redirect(returnTo ?? "/p/today");

  const c = onboardCopy(locale as CLocale);
  const s = setupCopy(locale as CLocale);
  const prev = previousStep(step);
  const view = await profileView(ctx.store, scope);
  const facts = await ctx.store.listProfileFacts(scope.id);
  const own = (kind: string) => facts.filter((f) => f.kind === kind && isShown(f));
  // who is filling this round in: sign-up's own answer, unless he changed it on the first screen
  const by = await onboardingBy(ctx.store, scope);
  const isHelped = scope.onboarding !== "done" && by === "family";
  // 「改时间」 on the reminders screen: his own setting, so only a round he fills in himself
  const editTime = step === "reminders" && sp.edit === "time" && !isHelped && !returnTo;
  // 「‹」 names where it goes: the screen before, or the page this one was opened from
  const back = editTime
    ? { href: "/onboard/reminders", label: c.back }
    : returnTo
      ? { href: returnTo, label: returnTo === "/p/profile" ? profileCopy(locale).title.join("") : meCopy(locale).timesRow }
      : prev && step !== "done"
        ? { href: `/onboard/${prev}`, label: c.back }
        : undefined;
  const item = returnTo ? undefined : SETUP_ITEM_OF[step];
  /** what a family member wrote this round about his routine, still waiting for him */
  const waitingRoutine = facts.filter((f) => isPending(f) && f.kind === "routine");

  let title: readonly string[] = [];
  let lede: string | null = null;
  /** what the page itself draws between the title and the step's controls */
  let above: ReactNode = null;
  let body: ReactNode = null;
  switch (step) {
    case "who": {
      title = c.whoTitle;
      lede = (await signupAssisted(ctx.store, ctx.subject.userId)) ? c.whoHint : c.whoLede;
      body = <WhoStep locale={locale} current={by} />;
      break;
    }
    case "clinic":
      title = c.clinicTitle;
      lede = c.clinicLede;
      body = <ClinicStep locale={locale} initial={view.clinic} returnTo={returnTo} />;
      break;
    case "breakfast":
      title = c.breakfastTitle;
      body = <BreakfastStep locale={locale} initial={view.breakfast} returnTo={returnTo} helped={isHelped} />;
      break;
    case "habits": {
      title = s.routineTitle;
      lede = s.routineLede;
      const waiting: WaitingEntry[] = waitingRoutine.map((f) => {
        const e = factEntry(f);
        if (!e) return { id: f.id, title: f.text, sub: "", time: null, breakfast: false };
        const breakfast = isBreakfast(e);
        return { id: f.id, title: breakfast ? s.breakfast : locale === "zh-Hans" ? (e.label_zh ?? e.label) : e.label, sub: `${daysWords(e.days, locale)} · ${clockWords(e.time, locale)}`, time: e.time, breakfast };
      });
      body = (
        <HabitsStep
          locale={locale}
          presets={HABIT_PRESETS}
          returnTo={returnTo}
          breakfast={view.breakfast}
          waiting={waiting}
          helped={isHelped}
          initial={scopeRoutine(scope)
            .filter((r) => !isBreakfast(r) && Array.isArray(r.days))
            .map((r) => ({ label: r.label, label_zh: r.label_zh ?? null, days: r.days as string[], time: r.time }))}
        />
      );
      break;
    }
    case "meds":
      title = c.medsTitle;
      lede = c.medsLede;
      body = <MedsStep locale={locale} />;
      break;
    case "age": {
      title = c.ageTitle;
      const age = own("age").at(-1);
      body = <AgeStep locale={locale} initial={age ? Number(age.text) || null : null} returnTo={returnTo} />;
      break;
    }
    case "conditions":
      title = c.conditionsTitle;
      lede = c.conditionsLede;
      body = <ListStep locale={locale} step="conditions" choices={CONDITION_CHOICES} already={own("condition").map((f) => ({ id: f.id, text: f.text, removable: f.source !== "visit" }))} returnTo={returnTo} />;
      break;
    case "allergies":
      title = c.allergiesTitle;
      lede = c.conditionsLede;
      body = (
        <ListStep locale={locale} step="allergies" choices={ALLERGY_CHOICES} noneChoice={NO_ALLERGY} already={own("allergy").map((f) => ({ id: f.id, text: f.text, removable: f.source !== "visit" }))} returnTo={returnTo} />
      );
      break;
    case "family":
      title = c.familyTitle;
      lede = c.familyLede;
      body = <FamilyStep locale={locale} />;
      break;
    case "reminders": {
      // the morning's reminders as his space has them now: breakfast plus a quarter of an hour, or the time he set
      const schedule = scopeSlotSchedule(scope, "morning");
      if (editTime) {
        title = meCopy(locale).slotTitle(dt(locale, "slotMed.morning"));
        body = <ReminderTimeStep locale={locale} initial={schedule.first} range={SLOT_TIME_RANGE.morning} backHref="/onboard/reminders" />;
        break;
      }
      title = c.remindersTitle;
      lede = c.remindersLede(clockWords(view.reminderAt, locale));
      // breakfast is on the line only when his routine says it (a time he never gave is not shown as his)
      const anchor = slotAnchor(scopeRoutine(scope) as RoutineEntry[], "morning");
      const proposed = waitingRoutine.map(factEntry).filter((e) => e !== null && isBreakfast(e)).at(-1);
      above = (
        <>
          <Timeline testId="onboard-reminder-line">
            {anchor.fromRoutine ? <TimelineItem node="sch" time={shortTime(anchor.time)} who={s.breakfast} meta={s.routine} attrs={{ "data-line": "breakfast" }} /> : null}
            <TimelineItem
              node="now"
              time={shortTime(schedule.first)}
              title={s.firstReminder}
              attrs={{ "data-line": "first" }}
              actions={
                isHelped ? undefined : (
                  <Acts>
                    <Act href="/onboard/reminders?edit=time" data-testid="onboard-remind-change">
                      {s.changeTime}
                    </Act>
                  </Acts>
                )
              }
            />
            <TimelineItem node="next" time={shortTime(schedule.second)} title={s.askedAgain} attrs={{ "data-line": "second" }} />
            <TimelineItem node="miss" time={shortTime(schedule.closes)} title={s.noReply} attrs={{ "data-line": "closes" }} />
          </Timeline>
          {/* a breakfast time she wrote does not move his reminders until he says 「对」 */}
          {isHelped && proposed ? <Box variant="line">{c.breakfastLedeHelped(clockWords(addMinutes(proposed.time, 15), locale))}</Box> : null}
        </>
      );
      body = <RemindersStep locale={locale} />;
      break;
    }
    case "done":
      // no summary any more: the step finishes setting up as it opens and goes to Today (steps.tsx DoneStep)
      body = <DoneStep locale={locale} />;
      break;
  }

  return (
    <Screen locale={locale}>
      {back && <PageHeader back={back} locale={locale} />}
      <div className="rpo-stack" data-top={back ? undefined : "none"} data-step={step}>
        {item !== undefined && <StepBar index={item} total={SETUP_ITEMS} label={s.item(item)} />}
        {title.length > 0 && (
          <div className="rpo-h">
            <StatusHeadline lines={title} />
            {lede && <BodyText variant="lede">{lede}</BodyText>}
          </div>
        )}
        {isHelped && step !== "who" && step !== "done" && (
          <div data-rp="helped">
            <Box variant="tint">{c.helped}</Box>
          </div>
        )}
        {above}
        {body}
      </div>
    </Screen>
  );
}
