/**
 * /p/bp — blood pressure.
 *
 * Demo (task M4 item 3): record a reading; the doctor's own number, word for word with its date and time point in the
 * recording, only once he said it at a visit before today (R1, from D1); the chart and the list of his readings next to
 * that number; a reading that was due and not taken shows 未确认. Before the doctor gave a number there is no comparison
 * line at all, only the record. No word on this screen judges a reading (no high / normal / good, 偏高 / 正常). Data:
 * lib/daily/bp.ts. Exactly as before.
 *
 * Account (C2 track B, journey 03): the elder screens of the timeline draft's group 03 (components/daily/elder/BpAccount;
 * web/progress/fe-03.md): the page opens on the week (its readings, their picture next to the doctor's number, a past
 * week's facts), 「记一次血压」 brings the keypad like the home monitor, and after saving he sees his reading next to the
 * doctor's own words. This file reads the data and draws the doctor's sentences as entries of a line (components/bp
 * BpDoctorEntry), each with its checked Chinese when there is one:
 *   target     the number he confirmed at a visit (track F doctorNumbers), word for word with its date, time point and
 *              clip, labelled by how he confirmed it; it is also the dashed lines of the week's picture
 *   plan       how often the doctor said to measure (his confirmed instruction), with today's parts under his words
 *   measuring  how to measure, as the doctor said
 * Today's readings can be changed or deleted; 「这次没量」; a reading above the doctor's warning line gets track S's relay
 * (the 995 card, then the doctor's words). Before any confirmed number: 「医生还没给过数字，这里只记录。」
 * Query: ?when=yesterday (a reading from yesterday), ?do=record (straight to the keypad, from 「记录」's 「记录一次血压」),
 * ?lang=en|zh-Hans (this render in that language).
 *
 * Owner 10-15 (the demo video's second scene): after a reading outside the target his doctor set, the card that says so
 * and takes his words about the day (components/bp/BpOutsideTarget.tsx); this page gives it the target, the doctor's name
 * from the visit's details (lib/daily/visit-details.ts) and whether a speech service is connected.
 *
 * Owner 10-14: the account's page is under 「记录」 (/p/records, which shows the latest reading, the week's count and the
 * doctor's number and opens this page with 「看全部」): the bar shows 「记录」 and the week's header goes back there.
 */
import { BpChart } from "@/components/daily/BpChart";
import { BpRecordForm } from "@/components/daily/BpRecordForm";
import { BpTodayTools } from "@/components/daily/BpTodayTools";
import { ClipPlay } from "@/components/daily/ClipPlay";
import { BpDoctorEntry } from "@/components/bp/BpDoctorEntry";
import { BpAccount } from "@/components/daily/elder/BpAccount";
import { BpYesterdayEntry, BpYesterdayScreen } from "@/components/daily/elder/BpYesterday";
import { ElderMeta } from "@/components/daily/elder/ElderMeta";
import { SayBarLinks } from "@/components/daily/elder/SayBarLinks";
import { TimeKeeper } from "@/components/daily/elder/TimeKeeper";
import { pageZh } from "@/components/translate/DoctorZh";
import { TabBar } from "@/components/ui";
import { accountBpView, bpView, type AccountBpPlanView } from "@/lib/daily/bp";
import { clockWords, dateWords, dt, shortDay, type DailyKey } from "@/lib/daily/i18n";
import { chipDetail, chipText } from "@/lib/daily/lines";
import type { QuotedLine } from "@/lib/daily/types";
import { t, toLocale, type Locale } from "@/lib/i18n";
import { getPatientLocale } from "@/lib/session/server";
import { scopeD0, scopeNow, scopeTz } from "@/lib/store/scope";
import { storyDate } from "@/lib/story/clock";
import { getPageSubject, type PageSubject } from "@/lib/subject";
// owner 10-15: the card after a reading outside the doctor's target
import { doctorWords, visitDetail } from "@/lib/daily/visit-details";
import { askVoiceAvailable } from "@/lib/safety/voice";
import { zonedTimeToUtcMs } from "@/lib/time/clock";
import { nowMs as appNowMs } from "@/lib/time/now";
import type { ZhLookup } from "@/lib/translate/shown";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

function Quote({ line, locale, testId }: { line: QuotedLine; locale: Locale; testId: string }) {
  const detail = chipDetail(locale, line.chip);
  const doctorSaid = line.chip.kind === "doctor" && !line.chip.inferred;
  return (
    <div className={`rp-card ${doctorSaid ? "rp-card-doc" : ""}`} data-testid={testId} data-source={line.sourceId} data-inferred={line.chip.inferred ? "true" : "false"}>
      <div className="rp-tag">● {chipText(locale, line.chip)}</div>
      <p className="mt-1.5 text-body leading-[1.42]" lang="en">
        {line.text}
      </p>
      {detail ? <div className="rp-src">{detail}</div> : null}
      {line.clipUrl ? <ClipPlay url={line.clipUrl} locale={locale} standIn={!!line.chip.standInVoice} /> : null}
    </div>
  );
}

export default async function BpPage({ searchParams }: { searchParams: Promise<Search> }) {
  const [ctx, cookieLocale, sp] = await Promise.all([getPageSubject(), getPatientLocale(), searchParams]);
  if (!ctx) return null;
  if (ctx.subject.kind === "account") {
    const lang = Array.isArray(sp.lang) ? sp.lang[0] : sp.lang;
    const when = Array.isArray(sp.when) ? sp.when[0] : sp.when;
    const what = Array.isArray(sp.do) ? sp.do[0] : sp.do;
    return <AccountBp ctx={ctx} locale={lang === "en" || lang === "zh-Hans" ? toLocale(lang, cookieLocale) : cookieLocale} yesterday={when === "yesterday"} record={what === "record"} />;
  }
  const locale = cookieLocale;
  const view = await bpView(ctx.store, ctx.session);
  const target = view.target;
  const newestFirst = [...view.readings].reverse();

  return (
    <div className="flex flex-col gap-4" data-testid="page-bp" data-target={target ? `${target.systolic}/${target.diastolic}` : "none"}>
      <h1 className="text-[28px] font-bold">{t(locale, "nav.bp")}</h1>

      {target ? (
        <section className="flex flex-col gap-2" data-testid="bp-target-section">
          <h2 className="text-[20px] font-bold">{dt(locale, "bp.doctorNumber")}</h2>
          <Quote
            line={{ sourceId: target.sourceId, text: target.text, chip: target.chip, visitId: target.visitId, date: target.date, tStartMs: target.tStartMs, clipUrl: target.clipUrl }}
            locale={locale}
            testId="bp-target"
          />
        </section>
      ) : (
        <section className="rp-card" data-testid="bp-only-record">
          <p className="text-body text-ink-2">{dt(locale, "bp.onlyRecord")}</p>
        </section>
      )}

      <BpRecordForm locale={locale} />

      <BpChart readings={view.readings} target={target} locale={locale} />

      <section className="flex flex-col gap-2" data-testid="bp-readings">
        <h2 className="text-[20px] font-bold">{dt(locale, "bp.readings")}</h2>
        {newestFirst.length === 0 ? (
          <p className="text-body text-ink-2">{dt(locale, "bp.empty")}</p>
        ) : (
          <ul className="rp-card flex flex-col p-0">
            {newestFirst.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 border-b border-hair px-4 py-2.5 last:border-b-0" data-testid="bp-reading" data-day={r.day} data-state={r.state}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-body text-ink-2">
                    {shortDay(locale, r.date)} {dt(locale, `bp.slot.${r.slot}`)}
                  </span>
                  <span className="text-body font-semibold tabular-nums" data-testid="bp-reading-value">
                    {r.state === "recorded" ? `${r.systolic}/${r.diastolic}` : dt(locale, "bp.unconfirmed")}
                  </span>
                </div>
                {/* C2 track E (only add; real-app 12 「血压记错不能删改」): today's readings can be corrected and deleted */}
                {r.day === view.day ? <BpTodayTools key={r.id} id={r.id} systolic={r.systolic} diastolic={r.diastolic} locale={locale} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {view.measuring.length > 0 ? (
        <section className="flex flex-col gap-2" data-testid="bp-measuring">
          <h2 className="text-[20px] font-bold">{dt(locale, "bp.measuring")}</h2>
          {view.measuring.map((m) => (
            <Quote key={m.sourceId} line={m} locale={locale} testId="bp-measuring-line" />
          ))}
        </section>
      ) : null}
    </div>
  );
}

const PART_KEY = { morning: "slot.morning", evening: "slot.evening" } as const satisfies Record<string, DailyKey>;

/**
 * How often, as the doctor said: his sentence as an entry of a line, and under his words what that asks for today
 * (「今天：早上量过了；晚上 8:00 起」). data-today keeps the first screen's words for a part: done, not_measured, due.
 */
function planEntry(locale: Locale, plan: AccountBpPlanView | null, zh: ZhLookup) {
  if (!plan) return null;
  const parts = plan.today.map((p) => {
    const part = dt(locale, PART_KEY[p.part]);
    if (p.state === "measured") return dt(locale, "bp.page.planDone", { part });
    if (p.state === "not_measured") return dt(locale, "bp.page.planNotMeasured", { part });
    return dt(locale, "bp.page.planDue", { part, time: clockWords(locale, p.remind) });
  });
  const shortState = { measured: "done", not_measured: "not_measured", due: "due", later: "due" } as const;
  return (
    <BpDoctorEntry
      locale={locale}
      testId="bp-plan"
      wordsTestId="bp-plan-words"
      translationTestId="bp-plan-translation"
      attrs={{ "data-ended": plan.ended ? "true" : "false", "data-today": plan.today.map((p) => `${p.part}:${shortState[p.state]}`).join(",") }}
      words={{
        text: plan.words.text,
        date: plan.words.visitDate,
        tStartMs: plan.words.tStartMs,
        clipUrl: plan.words.clipUrl,
        standIn: plan.words.standIn,
        confirmed: true,
        sourceRef: plan.words.utteranceId ?? plan.words.itemId,
        zh: zh(plan.words.text),
      }}
    >
      <p className="rp03-fact" data-testid="bp-plan-today">
        {plan.ended ? dt(locale, "bp.page.planEnded") : parts.length ? dt(locale, "bp.page.planToday", { parts: parts.join(locale === "zh-Hans" ? "；" : "; ") }) : dt(locale, "bp.page.planNone")}
      </p>
    </BpDoctorEntry>
  );
}

/**
 * The account's blood pressure screens (C2 track B). `yesterday`: the page for a reading from yesterday instead
 * (/p/bp?when=yesterday, components/daily/elder/BpYesterday.tsx); there is no yesterday on the day his space began.
 * `record`: the page opens on the keypad.
 */
async function AccountBp({ ctx, locale, yesterday = false, record = false }: { ctx: PageSubject; locale: Locale; yesterday?: boolean; record?: boolean }) {
  const session = ctx.session;
  const hasYesterday = session.story_day >= 1;
  if (yesterday && hasYesterday) {
    const date = storyDate(scopeD0(session), session.story_day - 1);
    return (
      <BpYesterdayScreen
        locale={locale}
        date={date}
        meta={<ElderMeta locale={locale} back={{ href: "/p/bp", label: t(locale, "nav.bp") }} title={dt(locale, "bp.yesterday.title")} story={dateWords(locale, storyDate(scopeD0(session), session.story_day))} />}
        tabBar={<TabBar active="records" locale={locale} />}
      />
    );
  }
  const nowMs = appNowMs();
  const [view, zh] = await Promise.all([accountBpView(ctx.store, session, locale, nowMs), pageZh(locale)]);
  const tz = scopeTz(session);
  // the doctor's plan has its own moments (「晚上 8:00 起」 becomes due, a part passes): the page reads itself again then.
  // His midnight and the medicine moments are the layout's (components/daily/elder/DayClock.tsx)
  const at = scopeNow(session, nowMs);
  const moments = (view.plan?.today ?? []).flatMap((p) => [zonedTimeToUtcMs(view.date, p.remind, tz), zonedTimeToUtcMs(view.date, p.closes, tz)]).filter((m) => m > at);
  const target = view.target;
  return (
    <>
      <TimeKeeper nextAtMs={moments.length ? Math.min(...moments) - (at - nowMs) : null} serverNowMs={nowMs} />
      <BpAccount
        locale={locale}
        tz={tz}
        date={view.date}
        readings={view.readings}
        relays={view.relays}
        target={
          target ? (
            <BpDoctorEntry
              locale={locale}
              testId="bp-target"
              translationTestId="bp-target-translation"
              words={{
                text: target.text,
                date: target.date,
                tStartMs: target.tStartMs,
                clipUrl: target.clipUrl,
                standIn: target.standIn,
                confirmed: target.state === "confirmed",
                sourceRef: target.utteranceId ?? `${target.visitId}:${target.kind}`,
                zh: zh(target.text),
              }}
            />
          ) : null
        }
        targetLine={target ? { systolic: target.systolic, diastolic: target.diastolic, date: target.date, tStartMs: target.tStartMs, confirmed: target.state === "confirmed" } : null}
        plan={planEntry(locale, view.plan, zh)}
        due={(view.plan?.today ?? []).filter((p) => p.state === "due").map((p) => p.part)}
        measuring={
          view.measuring.length ? (
            <>
              {view.measuring.map((m) => (
                <BpDoctorEntry
                  key={m.sourceId}
                  locale={locale}
                  testId="bp-measuring-line"
                  words={{ text: m.text, date: m.date, tStartMs: m.tStartMs, clipUrl: m.clipUrl, standIn: !!m.chip.standInVoice, confirmed: !m.chip.inferred, sourceRef: m.sourceId, zh: zh(m.text) }}
                />
              ))}
            </>
          ) : null
        }
        yesterday={hasYesterday ? <BpYesterdayEntry locale={locale} /> : null}
        tabBar={<TabBar active="records" locale={locale} />}
        sayBar={<SayBarLinks locale={locale} />}
        start={record ? "record" : "week"}
        outside={
          target && target.diastolic !== null
            ? {
                target: { systolic: target.systolic, diastolic: target.diastolic, date: target.date, since: target.visitDay },
                doctor: doctorWords(visitDetail(session, target.visitId).doctor, locale, "short"),
                voice: askVoiceAvailable(),
              }
            : null
        }
      />
    </>
  );
}
