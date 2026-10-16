"use client";

/**
 * Her home on a real account (/f?link=, C2 track D; the daughter brief A4, B, F2, H1, H2). The server renders the first
 * copy (lib/care/home.ts) and logs her look; this keeps it live:
 *   her stream (useFamilyStream)   a hint -> read /api/family/view again (only what he shares)
 *                                  his switches changed -> what went off leaves the screen at once, cut out of the
 *                                  copy this page holds (lib/care/hide.ts); the fresh copy follows, pushed by the
 *                                  stream (read here only if none comes)
 *                                  her link's end -> the ended screen at once (data-ended-at for the 1-second check)
 *   focus, visibility, every 15 s   read again (the reminder times pass by themselves)
 * Every copy says which change of his switches it was built at (grantsVersion). A copy older than a change this page
 * has already shown is dropped: a read that was on its way when he switched something off cannot bring it back.
 *   first visit after he confirmed  three skippable steps: Dad's number (kept on this phone), notifications, the
 *                                  Home Screen on an iPhone
 * She can look, record her reminder and call him; nothing here acts for him.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hideOff } from "@/lib/care/hide";
import { EmptyBlock, FamilyButton, FamilyDock, FamilyHero, FamilyHome, FamilyScreen, FamilyTabs, FamilyTop, Stepper, familyTabHrefs } from "@/components/family-ui";
import type { BusEvent } from "@/lib/bus";
import { dadWord, dateLine, grantName, privacyLine, slotPart } from "@/lib/care/copy";
import { markWelcomed, savePhone, savedPhone, welcomed } from "@/lib/care/device";
import { hc } from "@/lib/care/her-copy";
// the long press on her side (owner 10-14): which element of her home stands for which of his records
import { homeHolds } from "@/lib/care/her-holds";
import { grantChange, herPaths, homeFacts, homeHeadline, homeReason, lastEntryWords, nextReminderAt, noticeView, sharedItems, timelineItems, weekDays, weekSummary } from "@/lib/care/her-view";
import type { FamilyHomeData } from "@/lib/care/home-types";
import { hmIn } from "@/lib/care/time";
import type { Locale } from "@/lib/i18n";
// fe-d (the v3 draft): 「打电话给爸爸」 asks for his number in a bottom sheet when none is saved (D4)
import { CallDad, PhoneField, phoneForField, phoneFrom } from "./CallDad";
// line bind (round two, only add): 「绑定另一位长辈」 on the screen that says her link is over
import { BindAgainButton } from "./BindAgain";
import { switchesOf, useFamilyStream, type EndedBy } from "./useFamilyStream";
import { PushStep } from "./PushStep";
// C2 track I (only add): 「开通知：爸爸没回时告诉你」 while he has the no-reply switch on and this phone has no push
import { PushNudge } from "./PushNudge";
import { HerInstall } from "./HerInstall";
// C2 track A (only add): 「爸爸在重设密码，要帮他吗？」 (real-app 2.4; components/family/ResetHelp.tsx)
import { ResetHelpScreen, useResetHelp } from "./ResetHelp";
// the family texts asked again (owner 10-14, only add): the quiet line while her link waits, her card while she has not agreed
import { HerAgreeCard, ReconsentLine } from "./Reconsent";
// scene 1 (owner 10-15): his visit as it is recorded
import { LiveBanner } from "./LiveBanner";
// owner 10-16 (only add): what he told Ripple today that may need attention (lib/care/told.ts)
import { ToldHomeLine } from "./ToldCard";

const POLL_MS = 15_000;
/** after a switch change: how long to wait for the stream's fresh copy before reading it here */
const VIEW_WAIT_MS = 1500;
/** a read that came back older than what is shown is asked again this many times at most */
const STALE_RETRIES = 3;

export interface FamilyAppProps {
  locale: Locale;
  linkId: string;
  since: number;
  tz: string;
  initial: FamilyHomeData;
  langHref: string;
  /**
   * The family texts asked again (lib/care/reconsent.ts): her family_accept text in force (title and paragraphs), sent
   * while she has not agreed to it; her card shows it while the copy on screen says she still has not (`reconsent.hers`)
   */
  herText?: { title: string; paragraphs: readonly string[] } | null;
}

type Ended = { by: EndedBy; at: number } | null;

export function FamilyApp({ locale, linkId, since, tz, initial, langHref, herText }: FamilyAppProps) {
  const [home, setHome] = useState(initial);
  const [ended, setEnded] = useState<Ended>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [failed, setFailed] = useState(false);
  const dad = dadWord(home.patientLabel, locale);
  const paths = useMemo(() => herPaths(linkId), [linkId]);
  const busy = useRef(false);
  const again = useRef(false);
  /** the newest change of his switches this page has shown (the link's grant version) */
  const seen = useRef(initial.grantsVersion ?? 0);
  const stale = useRef(0);
  const viewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // C2 track A (only add): is he asking her to help reset his password right now? (her own route; nothing of his is read)
  const resetHelp = useResetHelp(linkId, !ended);

  useEffect(() => {
    setPhone(savedPhone(linkId));
    if (!welcomed(linkId)) setStep(1);
  }, [linkId]);

  const end = useCallback((by: EndedBy) => setEnded((e) => e ?? { by, at: Date.now() }), []);

  /** A quiet line on her home when his switches changed (whichever path saw the change first says it). */
  const announce = useCallback(
    (before: FamilyHomeData["grants"], after: FamilyHomeData["grants"], patientLabel: string | null) => {
      const change = grantChange(before, after);
      const name = (k: keyof FamilyHomeData["grants"]) => grantName(k, locale, dadWord(patientLabel, locale));
      const sep = locale === "zh-Hans" ? "、" : ", ";
      if (change.on.length) setNotice(hc(locale, "noticeOn", { dad: dadWord(patientLabel, locale), what: change.on.map(name).join(sep) }));
      else if (change.off.length) setNotice(hc(locale, "noticeOff", { dad: dadWord(patientLabel, locale), what: change.off.map(name).join(sep) }));
    },
    [locale],
  );

  /**
   * A copy of her home from the server (read here, or pushed by her stream). False when it is older than a change of
   * his switches this page has already shown: it is dropped, whatever it holds.
   */
  const take = useCallback(
    (next: FamilyHomeData): boolean => {
      const version = next.grantsVersion ?? 0;
      if (version < seen.current) return false;
      seen.current = version;
      setFailed(false);
      setHome((prev) => {
        if (version < (prev.grantsVersion ?? 0) || next.generatedAt < prev.generatedAt) return prev;
        announce(prev.grants, next.grants, next.patientLabel);
        // he confirmed something she added to his details since the last copy (real-app 3.10 「爸爸确认了」)
        if ((next.facts?.confirmed ?? 0) > (prev.facts?.confirmed ?? 0)) setNotice(hc(locale, "factNoticeConfirmed", { dad: dadWord(next.patientLabel, locale) }));
        return next;
      });
      return true;
    },
    [announce, locale],
  );

  const refetch = useCallback(async () => {
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    try {
      const res = await fetch(`/api/family/view?link=${encodeURIComponent(linkId)}`, { cache: "no-store", credentials: "same-origin" });
      if (res.status === 403 || res.status === 404) {
        // 404: the link itself is gone (his account was deleted); 403: he stopped sharing (or she left)
        end(res.status === 404 ? "gone" : "patient");
        return;
      }
      if (!res.ok) {
        setFailed(true);
        return;
      }
      if (take((await res.json()) as FamilyHomeData)) stale.current = 0;
      else if (stale.current < STALE_RETRIES) {
        // it was read before his last change: ask once more (a few times at most)
        stale.current += 1;
        again.current = true;
      }
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      if (again.current) {
        again.current = false;
        void refetch();
      }
    }
  }, [linkId, end, take]);

  const stopWaiting = useCallback(() => {
    if (viewTimer.current) clearTimeout(viewTimer.current);
    viewTimer.current = null;
  }, []);
  useEffect(() => stopWaiting, [stopWaiting]);

  const live = useFamilyStream(ended ? null : linkId, since, {
    onEvent: (e: BusEvent) => {
      const switches = switchesOf(e);
      if (!switches) return void refetch();
      const { items, version } = switches;
      // a change this page already shows (the first frame of a connection says his switches as they are)
      if (version !== null && version <= seen.current) return;
      if (version !== null) seen.current = version;
      // his switches: what went off leaves the screen now, cut out of the copy this page holds; what went on has
      // nothing to show until the fresh copy is here
      setHome((prev) => {
        const next = hideOff(prev, items, version ?? undefined);
        announce(prev.grants, next.grants, prev.patientLabel);
        return next;
      });
      // the stream pushes the fresh copy right behind this frame; read it here only if none comes
      stopWaiting();
      if (version === null) return void refetch();
      viewTimer.current = setTimeout(() => {
        viewTimer.current = null;
        void refetch();
      }, VIEW_WAIT_MS);
    },
    onView: (next: FamilyHomeData) => {
      if (take(next)) stopWaiting();
    },
    onEnd: end,
  });

  useEffect(() => {
    if (ended) return;
    const onFocus = () => void refetch();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => void refetch(), POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [refetch, ended]);

  const wrap = (state: string, child: React.ReactNode) => (
    <div className="contents" data-testid="family-app" data-state={state} data-live={ended ? "closed" : live} data-ended={ended?.by} data-ended-at={ended?.at}>
      {child}
    </div>
  );

  // ------------------------------------------------------------ her link ended (H1, H2)
  if (ended) {
    const title = ended.by === "family" ? hc(locale, "leftTitle", { dad }) : ended.by === "gone" ? hc(locale, "goneTitle") : hc(locale, "endedTitle", { dad });
    const body = ended.by === "family" ? hc(locale, "leftBody", { dad }) : ended.by === "gone" ? hc(locale, "goneBody") : hc(locale, "endedBody", { dad });
    return wrap(
      ended.by === "gone" ? "gone" : "ended",
      <FamilyScreen locale={locale}>
        {/* H1 (he stopped sharing): 「Ripple」, one sentence in the middle, the solid 「打电话给爸爸」; H2 (she left): the
            outlined one and 「删除我的账号」; a link that is gone: the sentence alone. 「我的」 stays at the top right
            for H1 and H2, as the draft draws them: her own account's rows open without a link in force
            (lib/care/her-page.ts herOwnPage). A link that is gone has none: there is no link left to name */}
        <FamilyTop brand locale={locale} langHref={langHref} meHref={ended.by === "gone" ? undefined : paths.me} />
        <EmptyBlock title={title} detail={body} />
        {/* line bind (round two): on each of the three, the quiet way back to the form 「填长辈的账号」 (/f?bind=1) */}
        <FamilyDock foot="h">
          {ended.by !== "gone" && <CallDad linkId={linkId} locale={locale} dad={dad} phone={phone} variant={ended.by === "family" ? "secondary" : "primary"} onSaved={setPhone} />}
          <BindAgainButton locale={locale} />
          {ended.by === "family" && (
            <FamilyButton href={paths.remove} variant="quiet" data-testid="ended-delete">
              {hc(locale, "deleteAccount")}
            </FamilyButton>
          )}
        </FamilyDock>
      </FamilyScreen>,
    );
  }

  // ------------------------------------------------------------ C2 track A (only add): he asks her to help him reset
  if (resetHelp.show) {
    return wrap("reset_help", <ResetHelpScreen locale={locale} linkId={linkId} dad={dad} tz={tz} langHref={langHref} onDone={resetHelp.dismiss} />);
  }

  // ------------------------------------------------------------ the first visit (A4)
  if (step > 0) {
    const next = () => {
      if (step >= 3) {
        markWelcomed(linkId);
        setStep(0);
      } else setStep((s) => (s + 1) as 1 | 2 | 3);
    };
    return wrap(
      `welcome-${step}`,
      <FamilyScreen locale={locale}>
        {/* A4a to A4c: the step count, 「以后再说」 at the top right, three bars under the top bar */}
        <FamilyTop
          step={hc(locale, "stepOf", { n: step })}
          locale={locale}
          langHref={langHref}
          skip={{ label: hc(locale, "later"), onClick: next, testId: step === 1 ? "phone-later" : step === 2 ? "push-later" : "welcome-skip" }}
        />
        <Stepper done={step} />
        {step === 1 && (
          <PhoneStep
            locale={locale}
            dad={dad}
            initial={phone}
            onSaved={(p) => {
              savePhone(linkId, p);
              setPhone(p);
              next();
            }}
            onSkip={next}
          />
        )}
        {step === 2 && <PushStep locale={locale} dad={dad} who={home.patientLabel} onDone={next} slot={home.status?.slot ?? null} />}
        {step === 3 && (
          <>
            <FamilyHero tone="quiet" title={hc(locale, "homeTitle")} detail={hc(locale, "homeBody")} />
            {/* the same pictured steps as his phone (track I's component), and Android's 「装到主屏」 when it is offered */}
            <div data-testid="welcome-home-steps">
              <HerInstall locale={locale} always />
            </div>
            <FamilyDock foot="d">
              <FamilyButton onClick={next} data-testid="welcome-done">
                {hc(locale, "gotIt")}
              </FamilyButton>
            </FamilyDock>
          </>
        )}
      </FamilyScreen>,
    );
  }

  // ------------------------------------------------------------ the home (B)
  const head = homeHeadline(home, dad, locale, tz);
  const yourVoice = home.reminder?.whose === "yours";
  const herWords = yourVoice ? home.reminder?.text ?? null : null;
  const showTimeline = home.status?.state === "reminding" || home.status?.state === "before" ? home.timeline : [];
  const noReplyOpen = home.noReply && !home.noReply.answeredSince;
  const part = home.status?.slot ? slotPart(home.status.slot.slot, locale) : "";
  // fe-d (the v3 draft): what the screen shows of the state above; nothing below changes that state
  const nothingShared = !home.status && !Object.values(home.grants).some(Boolean);
  // B2 only: the reminder that went out, her words under it, and the one still to come (B1 has no timeline)
  const lines = home.status?.state === "reminding" ? showTimeline : [];
  // owner 10-14 (his medicine switch shows its kind in full): the reason he gave for a dose he did not take today, as one
  // quiet line under the sentence. The readings and his questions' words are in the rows (homeFacts, with his time zone)
  const why = homeReason(home, locale);
  // F2: his switch change, as the live page wrote it, with 「看看」 where the item has a screen of its own
  const told = noticeView(notice, dad, locale, paths);
  // I3: the page could not be refreshed; what is shown is the copy from `generatedAt`
  const seenAt = hmIn(new Date(home.generatedAt).toISOString(), tz);
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const staleLine = failed ? hc(locale, offline ? "offline" : "stale", { time: seenAt }) : null;
  return wrap(
    home.status?.state ?? (Object.values(home.grants).some(Boolean) ? "shared" : "nothing_shared"),
    <FamilyHome
      locale={locale}
      dad={dad}
      title={hc(locale, "dadToday", { dad })}
      kicker={dateLine(home.today, locale)}
      langHref={langHref}
      status={head}
      reason={why ?? undefined}
      notice={staleLine ?? told?.text}
      noticeAction={staleLine ? undefined : told?.action}
      noticeKind={staleLine ? "offline" : "shared"}
      prompt={
        home.reconsent || home.grants.no_reply_alert || home.liveVisit || home.told ? (
          <>
            {/* owner 10-16: today he told Ripple something that may need attention; the line opens the conversation (the
                baseline: whatever his switches; lib/care/told.ts) */}
            {home.told && <ToldHomeLine told={home.told} linkId={linkId} today={home.today} tz={tz} locale={locale} dad={dad} />}
            {/* scene 1 (10-15): he is recording a visit now: 「爸爸正在就诊，录音中」, and 「实时看」 while he shares his visit records */}
            {home.liveVisit && <LiveBanner locale={locale} dad={dad} live={home.liveVisit} href={paths.live(home.liveVisit.id)} serverNow={home.generatedAt} />}
            {/* the family texts asked again: why only the alert shows, and her own card while she has not agreed */}
            {home.reconsent && <ReconsentLine locale={locale} dad={dad} />}
            {home.reconsent && !home.reconsent.hers && herText && <HerAgreeCard locale={locale} linkId={linkId} text={herText} />}
            {home.grants.no_reply_alert && <PushNudge locale={locale} dad={dad} openHref={paths.notifications} />}
          </>
        ) : undefined
      }
      noReply={
        noReplyOpen
          ? { title: head.title, detail: hc(locale, "noReplyDetail"), lastEntry: lastEntryWords(home, locale, tz), href: paths.alert, linkLabel: hc(locale, "seeMorning", { part }) }
          : undefined
      }
      timeline={timelineItems(lines, { tz, locale, yourVoice, herWords, nextAt: nextReminderAt(home), dad })}
      week={home.week ? { label: hc(locale, "weekLabel"), summary: weekSummary(home.week, locale), days: weekDays(home.week, locale), href: paths.week } : undefined}
      stats={homeFacts(home, locale, paths, dad, tz)}
      plainShares={nothingShared ? sharedItems(home.grants, locale, null, dad) : undefined}
      recordHref={paths.reminder}
      recordDisabled={failed}
      phone={phone}
      callHref={paths.phone(paths.home)}
      call={(variant) => <CallDad linkId={linkId} locale={locale} dad={dad} phone={phone} variant={variant} onSaved={setPhone} />}
      sharedHref={paths.shared}
      meHref={paths.me}
      tabs={<FamilyTabs locale={locale} active="home" hrefs={familyTabHrefs(paths)} />}
      privacy={nothingShared ? hc(locale, "onlyDadChanges", { dad }) : privacyLine(dad, home.grants, locale)}
      explain={{ link: linkId, holds: homeHolds(home) }}
    />,
  );
}

/**
 * Dad's number, kept on this phone only: step 1 of her first visit (A4a: 「存一下爸爸的电话。」; 「以后再说」 is in the top
 * bar) and, with `edit`, the screen under 「我的」 that changes it (G3: the same sentences; it says the number stays on
 * this phone). `onSkip` is kept for callers; the step's own 「以后再说」 is drawn by the screen that holds it.
 */
export function PhoneStep({ locale, dad, initial, onSaved, edit = false }: { locale: Locale; dad: string; initial: string | null; onSaved: (phone: string) => void; onSkip?: () => void; edit?: boolean }) {
  const [value, setValue] = useState(phoneForField(initial));
  const [bad, setBad] = useState(false);
  return (
    <form
      className="rpf-col"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const p = phoneFrom(value);
        if (!p) return setBad(true);
        onSaved(p);
      }}
    >
      <FamilyHero tone="quiet" title={hc(locale, "savePhoneTitle", { dad })} detail={hc(locale, "savePhoneBody", { dad })} />
      <PhoneField locale={locale} dad={dad} value={value} onChange={(v) => (setValue(v), setBad(false))} bad={bad} />
      <FamilyDock foot={edit ? "d" : "c"}>
        <FamilyButton type="submit" data-testid="phone-save">
          {hc(locale, "save")}
        </FamilyButton>
      </FamilyDock>
    </form>
  );
}
