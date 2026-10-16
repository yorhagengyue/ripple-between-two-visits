/**
 * /p/brief — the visit brief.
 *
 * Demo (task M7): one page for the doctor covering the time since the last clinic visit before the story day. Readings
 * (count, average, how many not below the doctor's own number R1, R1 word for word with its date), doses (due, taken,
 * missed, not confirmed, and the routine the missed mornings fall on), his notes word for word, at most three questions
 * (refused > pattern > his own), his medicines. Red only marks what changed since the last visit. Nothing after the
 * story day. Data: lib/summary/brief.ts (counts shared with Wei Ling's view). Exactly as before.
 *
 * Account (C2 track B, journey 14): lib/summary/account-brief.ts on the elder screen in the timeline design (design
 * group 14; components/brief/AccountBrief.tsx): from the day after the last clinic visit that happened (never a planned
 * visit or an empty recording), real dates, untracked cells left out, readings next to the doctor's warning line on
 * their own rows, his notes and questions with the checked English for the doctor (track S; else marked not translated),
 * the same three questions as the visit screen. ?show=doctor: the screen he hands over (components/brief/DoctorBrief.tsx):
 * English first, one tap to 华语, kept awake, 「看完了」; opening it keeps the page as shown (lib/summary/brief-snapshot.ts:
 * which day, which version, when). ?shown=<id>: a page he showed earlier, drawn from what was kept (the same numbers
 * whatever he logged since); his brief has a row to the last one.
 * While the brief is put together the screen shows its own header and quiet bars (components/brief/BriefLoading.tsx);
 * when it cannot be, what happened and 「再试一次」 (components/brief/BriefError.tsx).
 *
 * Reading this page first settles doses whose reminder window closed with no answer and brings the routine-pattern
 * question up to date (lib/daily, idempotent), like Today.
 *
 * His only: the brief quotes his notes and his readings, which Wei Ling sees only through her switches. Her phone
 * (family role) is sent to /f before anything is read or rendered (lib/family/role.ts sendFamilyToF), the same rule
 * as GET /api/brief's 403.
 */
import { Suspense } from "react";
import { AccountBriefScreen, BriefWindow } from "@/components/brief/AccountBrief";
import { BriefErrorBoundary } from "@/components/brief/BriefError";
import { BriefLoading } from "@/components/brief/BriefLoading";
import { BriefSheet } from "@/components/brief/BriefSheet";
import { DoctorBrief } from "@/components/brief/DoctorBrief";
import { LastShown } from "@/components/brief/LastShown";
import { PageHeader, TabBar } from "@/components/ui";
import { settleNoReply } from "@/lib/daily/doses";
import { clockWords, dateWords } from "@/lib/daily/i18n";
import { syncPatternQuestions } from "@/lib/daily/patterns";
import { sendFamilyToF } from "@/lib/family/role";
import { toLocale, type Locale } from "@/lib/i18n";
import { getPatientLocale } from "@/lib/session/server";
import { buildAccountBrief } from "@/lib/summary/account-brief";
import { buildBrief } from "@/lib/summary/brief";
import { lastShownBrief, shownBrief, type ShownBrief } from "@/lib/summary/brief-snapshot";
import { scopeTz } from "@/lib/store/scope";
import { getPageSubject } from "@/lib/subject";
import { bt } from "@/lib/summary/i18n";
import { localHHMM } from "@/lib/time/clock";
import { nowMs as appNowMs } from "@/lib/time/now";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** 「10月12日 周一 · 早上 10:05」: the day a brief was shown (its own date) and the time it was shown, in his zone. */
function shownWhen(locale: Parameters<typeof dateWords>[0], kept: ShownBrief, tz: string): string {
  const ms = kept.shownAt ? Date.parse(kept.shownAt) : Number.NaN;
  return Number.isFinite(ms) ? `${dateWords(locale, kept.data.date)} · ${clockWords(locale, localHHMM(ms, tz))}` : dateWords(locale, kept.data.date);
}

/**
 * An account's brief, once his records are read: the page kept as it was shown, the page for the doctor, or his own.
 * Drawn inside the page's Suspense, so the header and the bars of BriefLoading stand until this is ready.
 * It takes no store and no scope as props (a component's props are what a development build writes into the page for
 * its tools): it reads the subject the page was opened by itself, the same one the page read (one read per request).
 */
async function AccountBrief({ locale, shownId, show, from, place }: { locale: Locale; shownId: string | null; show: string | null; from: string | null; place: string | null }) {
  const ctx = await getPageSubject();
  if (!ctx) return null;
  const { store, session } = ctx;
  const nowMs = appNowMs();
  const tz = scopeTz(session);
  // a page he showed the doctor earlier: drawn again from what was kept then
  if (shownId) {
    const kept = await shownBrief(store, session, shownId);
    if (kept) return <DoctorBrief views={kept.data.views} homeLocale={locale} kept={{ when: shownWhen(locale, kept, tz) }} />;
  }
  if (show === "doctor") {
    // the doctor reads it in English first; one tap shows it in 华语: both are built here (the pattern wording and the
    // medicine names follow the language), with the same counts
    const [en, zh] = await Promise.all([
      buildAccountBrief(store, session, "en", { nowMs, translate: "model" }),
      buildAccountBrief(store, session, "zh-Hans", { nowMs, translate: "cache" }),
    ]);
    // C2 track V (only add): opened from the visit's 「先给医生看简报」 (?from=visit&place=clinic|pharmacy), 「看完了」
    // goes back to the visit, at the card for the doctor (real-app 2.12); opened anywhere else, back to the brief
    // Opened from his own brief that he reached from the visit screen (?from=visit, no place), back to that brief with
    // the same mark, so its 「返回」 still goes to the visit (owner's tidy of 10-13)
    const doneHref = from === "visit" ? (place === "clinic" || place === "pharmacy" ? `/p/visit?step=consent&place=${place}` : "/p/brief?from=visit") : undefined;
    return <DoctorBrief views={{ en, "zh-Hans": zh }} homeLocale={locale} doneHref={doneHref} />;
  }
  const [view, last] = await Promise.all([buildAccountBrief(store, session, locale, { nowMs, translate: "model" }), lastShownBrief(store, session)]);
  // 「返回」 goes back to where he came from (owner's tidy of 10-13): the visit screen when the address says so
  // (?from=visit), else Today
  const fromVisit = from === "visit";
  return (
    <AccountBriefScreen
      view={view}
      locale={locale}
      lastShown={last ? <LastShown locale={locale} id={last.id} when={shownWhen(locale, last, tz)} /> : undefined}
      showHref={fromVisit ? "/p/brief?show=doctor&from=visit" : undefined}
      // the timeline design's header: the way back, the screen's name, and the brief's period as the grey line under it
      meta={<PageHeader locale={locale} back={{ href: fromVisit ? "/p/visit" : "/p/today" }} title={bt(locale, "brief.title")} subtitle={<BriefWindow view={view} locale={locale} testId="brief-window" />} />}
      // the brief is part of 就诊 (owner 10-14)
      tabBar={<TabBar active="visit" locale={locale} />}
    />
  );
}

export default async function BriefPage({ searchParams }: { searchParams: Promise<Search> }) {
  const [ctx, cookieLocale, sp] = await Promise.all([getPageSubject(), getPatientLocale(), searchParams]);
  if (!ctx) return null;
  const store = ctx.store;
  await sendFamilyToF(ctx, store);
  await settleNoReply(store, ctx.session);
  await syncPatternQuestions(store, ctx.session);
  if (ctx.subject.kind === "account") {
    const lang = one(sp.lang);
    const locale = lang === "en" || lang === "zh-Hans" ? toLocale(lang, cookieLocale) : cookieLocale;
    const shownId = one(sp.shown);
    const show = one(sp.show);
    // the page in the doctor's hands (shown now, or kept from before) has no header of his and no tab bar
    const doctor = show === "doctor" || !!shownId;
    return (
      <BriefErrorBoundary locale={locale} doctor={doctor}>
        <Suspense key={`${shownId ?? ""}|${show ?? ""}|${locale}`} fallback={<BriefLoading locale={locale} doctor={doctor} />}>
          <AccountBrief locale={locale} shownId={shownId} show={show} from={one(sp.from)} place={one(sp.place)} />
        </Suspense>
      </BriefErrorBoundary>
    );
  }
  const view = await buildBrief(store, ctx.session, cookieLocale);
  return <BriefSheet view={view} locale={cookieLocale} />;
}
