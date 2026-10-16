import type { ReactNode } from "react";
import { Explainable } from "@/components/explain/Explainable";
import type { HomeHolds } from "@/lib/care/her-holds";
import { familyCopy } from "@/lib/ui/copy";
import { telHref } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";
import { ConsentFoot, LinkRow, NoticeRow } from "./FamilyBits";
import { FamilyButton } from "./FamilyButton";
import { FamilyDock, FamilyHero, FamilyScreen, FamilyTop } from "./FamilyScreen";
import { SharedRows, type SharedItem } from "./SharedSection";
import { StatusCard, StatusGrid } from "./StatusCard";
import { Timeline, type TimelineItem } from "./Timeline";
import { WeekStrip, type WeekStripDay } from "./WeekStrip";
import "./home-detail.css";

export interface FamilyStat {
  key: string;
  label: ReactNode;
  value?: ReactNode;
  unit?: ReactNode;
  foot?: ReactNode;
  /** small lines under the row (owner 10-14): when his latest reading was taken, his questions' words, where the next visit is */
  lines?: readonly ReactNode[];
  state?: "normal" | "off" | "loading" | "error";
  href?: string;
}

export interface FamilyHomeProps {
  locale: UiLocale;
  /** her word for him (his link's label, as dadWord gives it): the screen's own words say him by it; null: 爸爸 / Dad */
  dad?: string | null;
  fill?: "viewport" | "container";
  /** the real date under the screen's name: 「9月19日 周六」 */
  kicker: ReactNode;
  /** the screen's name at the top left (default 「爸爸今天」) */
  title?: ReactNode;
  langHref?: string;
  /** the one large sentence and the line under it: 「爸爸 8:52 吃了早上的药。」 / 「他自己点的。」 */
  status: { title: ReactNode; detail?: ReactNode; tone: "ok" | "chk" | "quiet" };
  /**
   * one quiet line under that sentence: the reason he gave for a dose he did not take today, in his words (owner 10-14:
   * 「他说的原因：太极课」). Only while he shares his medicine; never drawn on the no-reply state
   */
  reason?: ReactNode;
  /** no reply after two reminders: the sentence says so, the amber button calls him, a row opens the morning (D2) */
  noReply?: { title: ReactNode; detail: ReactNode; lastEntry?: { when: ReactNode; what: ReactNode }; href?: string; linkLabel?: ReactNode };
  /** 「这一周」 (only while he shares his medicine) */
  week?: { label: ReactNode; summary?: ReactNode; days: readonly WeekStripDay[]; href?: string };
  /** today so far, while a reminder is out (B2) */
  timeline?: readonly TimelineItem[];
  timelineLabel?: ReactNode;
  /**
   * this week's rows, one hairline each: his latest blood pressure reading, how many questions wait with their words
   * under the row, the next visit and its place (owner 10-14; they were counts only)
   */
  stats: readonly FamilyStat[];
  /** kept for older callers; her reminder has its own screen */
  reminder?: { words: ReactNode; playsAt: string; ownVoice: boolean };
  recordHref: string;
  /** no network: 「录一段新的提醒」 is the grey one (the line at the top says why); calling still works */
  recordDisabled?: boolean;
  /** Dad's number; without it 「打电话给爸爸」 opens callHref (she saves it once) */
  phone?: string | null;
  callHref?: string;
  /** the call button itself, drawn by the caller (it then owns asking for the number in the bottom sheet, D4) */
  call?: (variant: "warn" | "secondary") => ReactNode;
  sharedHref: string;
  /** the foot line: 「这些是爸爸同意给你看的。」; it opens what he shares (F1) */
  privacy: ReactNode;
  /** kept for older callers: the foot line itself is the way in now */
  sharedLabel?: ReactNode;
  /** 「我的」, at the top right */
  meHref?: string;
  /** her bottom bar: with it, 「我的」 is a place of the bar and is not drawn at the top right */
  tabs?: ReactNode;
  meLabel?: ReactNode;
  /** a quiet line under the top bar: 「爸爸刚把看诊记录分享给你了。」 (F2), with at most one action (「看看」) */
  notice?: ReactNode;
  noticeAction?: { label: ReactNode; href: string };
  /** what the line is about: he shared something (a tick), or the page could not be refreshed (a dash) */
  noticeKind?: "shared" | "offline";
  /** another line at the top, drawn by the caller: notifications are off (I4) */
  prompt?: ReactNode;
  /** he has switched nothing on (H4): every item as a row that says 「没有分享」 */
  plainShares?: readonly SharedItem[];
  /** kept for older callers: her way to 「补充资料」 is on 「我的」 now */
  factsHref?: string;
  factsLabel?: ReactNode;
  /**
   * the long press on her side (owner 10-14: the same as his): her care link's id and which element stands for which of
   * his records (lib/care/her-holds.ts homeHolds, from the same copy the rest of this screen is drawn from). Without it
   * nothing on the screen can be held
   */
  explain?: { link: string; holds: HomeHolds };
}

/**
 * Wei Ling's home (/f; the v3 draft's B1 to B5, F2, H4, I3, I4): the screen's name with the date, 中/EN and 「我的」;
 * a quiet line when something changed; ONE large sentence for how Dad is today; 「这一周」 as seven marks with their
 * words; the week's counts as hairline rows; her one solid button 「录一段新的提醒」 with 「打电话给爸爸」 outlined under
 * it; and the line that says all of it is what Dad agreed to share, which opens the list. When he did not reply, the
 * amber 「打电话给爸爸」 is the solid one and no teal button is on the screen. Only his switches' items; she cannot
 * act for him here.
 *
 * The owner's decision of 2026-10-14 (each of his switches shows its kind in full while it is on) added, in the same
 * quiet text and with nothing new to tap: the reason he gave for a dose he did not take, one line under the large
 * sentence; his latest reading as the blood pressure row's value, with when and how many this week under it; up to
 * three of his questions' words under 「要问医生的」; the next visit's place under its date (styles: ./home-detail.css).
 *
 * The owner's decision of 2026-10-14, later that day: the long press of his side is on hers too. With `explain`, each
 * element that stands for one of his records can be held for half a second and Ripple's read of it opens, through her
 * link and cut by his switches (components/explain/Explainable.tsx): today's sentence (that part of the day's medicine),
 * a day of the week that is one record, the blood pressure row (the week) and its number (the latest reading), each of
 * his questions' words, the next visit's row. Nothing new is drawn and every tap does what it did.
 */
export function FamilyHome(props: FamilyHomeProps) {
  const { locale, kicker, langHref, status, noReply, week, stats, recordHref, phone, sharedHref, privacy } = props;
  const copy = familyCopy(locale, props.dad);
  const ex = props.explain;
  // today's sentence, held: the words themselves are the element (the heading keeps its place and its spacing)
  const sentence = (title: ReactNode) =>
    ex?.holds.status ? (
      <Explainable as="inline" subject={ex.holds.status} locale={locale} link={ex.link} label={typeof title === "string" ? title : undefined}>
        {title}
      </Explainable>
    ) : (
      title
    );
  const callHref = phone ? telHref(phone) : (props.callHref ?? recordHref);
  const callButton = (variant: "warn" | "secondary") =>
    props.call ? (
      props.call(variant)
    ) : (
      <FamilyButton href={callHref} variant={variant} data-testid="call-dad">
        {copy.call}
      </FamilyButton>
    );
  const record = (variant: "primary" | "secondary") =>
    props.recordDisabled ? (
      <FamilyButton variant={variant} disabled data-testid="record-new">
        {copy.record}
      </FamilyButton>
    ) : (
      <FamilyButton href={recordHref} nav="forward" variant={variant} data-testid="record-new">
        {copy.record}
      </FamilyButton>
    );
  return (
    <FamilyScreen locale={locale} fill={props.fill} tabs={props.tabs}>
      <FamilyTop title={props.title ?? copy.dadToday} kicker={kicker} locale={locale} langHref={langHref} meHref={props.tabs ? undefined : props.meHref} meLabel={props.meLabel} />
      {props.notice && (
        <NoticeRow icon={props.noticeKind === "offline" ? "dash" : "check"} rise={props.noticeKind !== "offline"} action={props.noticeAction ? { ...props.noticeAction, testId: "family-notice-open" } : undefined} data-testid="family-notice">
          {props.notice}
        </NoticeRow>
      )}
      {/* C2 track I (only add): 「通知关着，爸爸没回时你收不到。」 */}
      {props.prompt}
      {noReply ? (
        <div data-rp="no-reply" data-kind="check" data-testid="home-no-reply">
          <FamilyHero tone="chk" title={sentence(noReply.title)} detail={noReply.detail} />
          {noReply.href && (
            <LinkRow href={noReply.href} style={{ marginTop: 16 }} data-testid="home-no-reply-open">
              {noReply.linkLabel ?? copy.seeMorning}
            </LinkRow>
          )}
        </div>
      ) : (
        <>
          <FamilyHero title={sentence(status.title)} detail={status.detail} tone={status.tone} />
          {/* owner 10-14: why he did not take it, in his words; quiet, under the sentence and its lede */}
          {props.reason && (
            <p className="rpf rpf-home-reason" data-rp="home-reason" data-testid="home-missed-reason">
              {props.reason}
            </p>
          )}
        </>
      )}
      {props.timeline && props.timeline.length > 0 && <Timeline items={props.timeline} label={props.timelineLabel} />}
      {week && (
        <WeekStrip
          label={week.label}
          summary={week.summary}
          days={ex ? week.days.map((d) => ({ ...d, hold: ex.holds.days[d.key] ?? null })) : week.days}
          href={week.href}
          explain={ex ? { link: ex.link, locale } : undefined}
        />
      )}
      {stats.length > 0 && (
        <StatusGrid>
          {stats.map((s) => (
            <StatusCard
              key={s.key}
              locale={locale}
              label={s.label}
              value={s.value}
              unit={s.unit}
              foot={s.foot}
              lines={s.lines}
              state={s.state}
              href={s.href}
              // which of his records the row, its value and its lines stand for (the rows are named by their key)
              holdLink={ex?.link}
              hold={s.key === "bp" ? ex?.holds.bpWeek : s.key === "next" ? ex?.holds.nextVisit : undefined}
              valueHold={s.key === "bp" ? ex?.holds.bpLatest : undefined}
              lineHolds={s.key === "questions" ? ex?.holds.questions : undefined}
            />
          ))}
        </StatusGrid>
      )}
      {props.plainShares && props.plainShares.length > 0 && <SharedRows items={props.plainShares} locale={locale} plain />}
      <FamilyDock>
        {noReply ? (
          <>
            {callButton("warn")}
            {record("secondary")}
          </>
        ) : (
          <>
            {record("primary")}
            {callButton("secondary")}
          </>
        )}
      </FamilyDock>
      <ConsentFoot href={props.plainShares ? undefined : sharedHref} data-testid="open-shared">
        {privacy}
      </ConsentFoot>
    </FamilyScreen>
  );
}
