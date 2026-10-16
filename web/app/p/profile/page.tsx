/**
 * /p/profile — his profile (M11; journey 01; real-app 2.5; track C), laid out after the timeline draft (01-6 and the
 * list look of the draft's 「我」 pages; web/progress/fe-01.md). One screen, one thing:
 *   while a family member's facts wait for him: those, one at a time, each with 对 / 改一下 / 不对 (./ConfirmFact);
 *   otherwise: what is written down, in the order setting up asked it: his clinic; his routine (breakfast, what he does
 *   every week); about him (age, the conditions a doctor told him of, his allergies, languages, where he lives). Every
 *   row: what it is, his words, who wrote them, and 「改」 into the setting-up screen that changes it (a row with
 *   nothing yet opens the same screen). When the medicine is reminded is not a row here (owner's tidy of 10-13): it is
 *   「我 › 早饭时间和提醒」.
 * His clinic and his routine are settings the app schedules by and facts too: their rows say who wrote them like the
 * rest. Conditions and allergies are his or a family member's words, recorded, never explained.
 * A page under 「我」: 「‹ 我」 in the header, no tab bar (as the draft draws those pages). The demo has no profile (404).
 *
 * Test hooks kept: [data-rp="row"] on each row (its name, the words, who wrote them), [data-rp="fact-value"] with
 * data-fact / data-source, [data-rp="confirm-fact"] and its buttons. The page's name is the header's title now
 * ([data-rp="page-title"]).
 */
import { notFound } from "next/navigation";
import { Fragment, type ReactNode } from "react";
import { Box, Chevron, ListCard, PageHeader, Screen, UiLink } from "@/components/ui";
import { daysWords } from "@/app/onboard/[step]/words";
import { profileCopy, type CLocale } from "@/lib/profile/copy";
import { clockWords } from "@/lib/profile/dates";
import { onboardHref } from "@/lib/profile/onboarding";
import { setupCopy } from "@/lib/profile/setup-copy";
import { profileView, type FactView } from "@/lib/profile/view";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";
import { uiCopy } from "@/lib/ui/copy";
import { ConfirmFacts } from "./ConfirmFact";
import "@/app/onboard/[step]/onboard.css";

export const dynamic = "force-dynamic";

function sourceWords(f: FactView, locale: CLocale, example: boolean): string {
  const c = profileCopy(locale);
  if (f.source === "family") {
    const who = c.familyWho(f.enteredBy);
    return f.editedByHim ? c.byFamilyChanged(who) : c.byFamilyConfirmed(who);
  }
  if (f.source === "visit") return c.fromVisit;
  return example ? c.exampleSource : c.bySelf;
}

/**
 * One row of the list card: its name in grey, the words under it, and at the right 「改」 (there are words to change)
 * or only the chevron (nothing written yet, or the row leads to another page).
 */
function Row({ label, href, change, kind, children }: { label: string; href?: string; /** the word 「改」: the row has words to change (without it the row only opens) */ change?: string; kind: string; children: ReactNode }) {
  const inner = (
    <>
      <span className="rpu-li-main">
        <span className="rpo-fact-l">{label}</span>
        {children}
      </span>
      {href && (
        <span className="rpo-fact-go" data-go={change ? "change" : "open"}>
          {change ?? <Chevron />}
        </span>
      )}
    </>
  );
  if (href) {
    return (
      <UiLink href={href} nav="forward" className="rpu-li rpo-fact" data-rp="row" data-kind={kind}>
        {inner}
      </UiLink>
    );
  }
  return (
    <div className="rpu-li rpo-fact" data-rp="row" data-kind={kind}>
      {inner}
    </div>
  );
}

/**
 * Words that are his setting and, when there is one, the fact row behind them: the words, a grey line of detail (when a
 * habit falls), and who wrote them.
 */
function settingValue(words: string, fact: FactView | null, locale: CLocale, example: boolean, detail?: string) {
  const more = detail ? <span className="rpo-fact-s">{detail}</span> : null;
  if (!fact) {
    return (
      <span className="rpo-fact-v">
        {words}
        {more}
        {example && <span className="rpo-fact-s">{profileCopy(locale).exampleSource}</span>}
      </span>
    );
  }
  return (
    <span className="rpo-fact-v" data-rp="fact-value" data-fact={fact.id} data-source={fact.source}>
      {words}
      {more}
      <span className="rpo-fact-s">{sourceWords(fact, locale, example)}</span>
    </span>
  );
}

function Empty({ locale }: { locale: CLocale }) {
  return (
    <span className="rpo-fact-v" data-empty="true">
      {profileCopy(locale).notYet}
    </span>
  );
}

/** Facts of one kind as one row: each one's words, and who wrote them under them. */
function FactsRow({ label, kind, facts, locale, example, href }: { label: string; kind: string; facts: FactView[]; locale: CLocale; example: boolean; href?: string }) {
  if (!facts.length) {
    return (
      <Row label={label} kind={kind} href={href}>
        <Empty locale={locale} />
      </Row>
    );
  }
  return (
    <Row label={label} kind={kind} href={href} change={uiCopy(locale).changeShort}>
      <span data-rp="fact-value">
        {facts.map((f) => (
          <span key={f.id} className="rpo-fact-v" data-fact={f.id} data-source={f.source}>
            {f.text}
            <span className="rpo-fact-s">{sourceWords(f, locale, example)}</span>
          </span>
        ))}
      </span>
    </Row>
  );
}

export default async function ProfilePage() {
  const [ctx, locale] = await Promise.all([getPageSubject(), getPatientLocale()]);
  if (!ctx) return null;
  if (ctx.subject.kind !== "account") notFound();
  const c = profileCopy(locale);
  const s = setupCopy(locale);
  const scope = ctx.session;
  const view = await profileView(ctx.store, scope);
  const example = scope.example_data;
  const of = (kind: string) => view.facts.filter((f) => f.kind === kind);
  const edit = (step: string) => `/onboard/${step}?return=/p/profile`;
  const back = { href: "/p/me", label: uiCopy(locale).me };

  if (view.pending.length) {
    return (
      <Screen locale={locale}>
        <PageHeader back={back} locale={locale} />
        <div className="rpo-stack">
          <ConfirmFacts locale={locale} facts={view.pending.map((f) => ({ id: f.id, text: f.text, who: c.familyWho(f.enteredBy) }))} />
        </div>
      </Screen>
    );
  }

  const habitName = (h: { label: string; label_zh?: string }) => (locale === "zh-Hans" ? (h.label_zh ?? h.label) : h.label);
  const habitWhen = (h: { days: "daily" | string[]; time: string }) => `${daysWords(h.days, locale)} · ${clockWords(h.time, locale)}`;
  const change = uiCopy(locale).changeShort;
  return (
    <Screen locale={locale}>
      <PageHeader back={back} title={c.title.join("")} subtitle={view.name ?? undefined} locale={locale} />
      <div className="rpu-stack" data-rp="profile">
        {view.onboarding !== "done" && <Box variant="acc" href={onboardHref(scope)} title={c.setUp} />}
        <ListCard>
          <Row label={c.clinic} kind="clinic" href={edit("clinic")} change={view.clinic ? change : undefined}>
            {view.clinic ? settingValue(view.clinic, view.clinicFact, locale, example) : <Empty locale={locale} />}
          </Row>
        </ListCard>
        <ListCard heading={s.groupRoutine}>
          <Row label={c.breakfast} kind="breakfast" href={edit("breakfast")} change={view.breakfast ? change : undefined}>
            {view.breakfast ? settingValue(clockWords(view.breakfast, locale), view.breakfastFact, locale, example) : <Empty locale={locale} />}
          </Row>
          <Row label={c.habits} kind="habits" href={edit("habits")} change={view.habits.length ? change : undefined}>
            {view.habits.length ? view.habits.map((h, i) => <Fragment key={h.label}>{settingValue(habitName(h), view.habitFacts[i] ?? null, locale, example, habitWhen(h))}</Fragment>) : <Empty locale={locale} />}
          </Row>
        </ListCard>
        <ListCard heading={s.groupAbout}>
          <FactsRow label={c.age} kind="age" facts={of("age")} locale={locale} example={example} href={edit("age")} />
          <FactsRow label={c.conditions} kind="condition" facts={of("condition")} locale={locale} example={example} href={edit("conditions")} />
          <FactsRow label={c.allergies} kind="allergy" facts={of("allergy")} locale={locale} example={example} href={edit("allergies")} />
          {of("language").length > 0 && <FactsRow label={c.languages} kind="language" facts={of("language")} locale={locale} example={example} />}
          {of("home").length > 0 && <FactsRow label={c.home} kind="home" facts={of("home")} locale={locale} example={example} />}
          {of("other").length > 0 && <FactsRow label={c.other} kind="other" facts={of("other")} locale={locale} example={example} />}
        </ListCard>
      </div>
    </Screen>
  );
}
