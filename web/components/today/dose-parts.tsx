import type { ReactElement, ReactNode } from "react";
import { Act, Acts, Box, LabelOriginal, SubRow, Tag, TimelineItem, TlControls } from "@/components/ui";
import { clockWords, dt, shortDay, shortTime, type DailyKey } from "@/lib/daily/i18n";
import type { DoseMedView, DoseSlotView } from "@/lib/daily/today-view";
import type { DaySlot } from "@/lib/store/types";
import { uiCopy } from "@/lib/ui/copy";
import type { UiLocale } from "@/lib/ui/tokens";

/**
 * The parts of Today's medicine on the timeline that only draw (the draft's 02 screens): a medicine's row on the
 * card under a slot's node, and a slot that is not the one on screen as one entry of the line. The slot that needs
 * him, with its buttons and what follows a tap, is components/daily/elder/TodayAccount.tsx.
 *
 * The words are the app's own (lib/daily/i18n.ts, lib/ui/copy.ts), as they were before the timeline: only their place
 * changed. What is new with the line says so where it is added.
 */

const slotKey = (prefix: "slot" | "slotMed", slot: DaySlot) => `${prefix}.${slot}` as DailyKey;
export const slotMedKey = (slot: DaySlot) => slotKey("slotMed", slot);

/** Where a slot's 「改一下」 / 「现在记」 goes: the same screen with that slot as the one on screen. */
export function changeHref(s: Pick<DoseSlotView, "slot" | "when">): string {
  return s.when === "yesterday" ? `/p/today?when=yesterday&slot=${s.slot}` : `/p/today?change=${s.slot}`;
}

/** What Today knows about where a medicine's words come from, beyond the dose data: when its label was dispensed. */
export interface MedSource {
  /** YYYY-MM-DD on the label, or null */
  dispensed: string | null;
}

/** A medicine's name as it is shown everywhere: the name and its strength, never translated. */
export const medTitle = (m: Pick<DoseMedView, "name" | "strength">) => `${m.name}${m.strength ? ` ${m.strength}` : ""}`;

/** The label's own Mandarin line without its lead-in: the head line next to it already says 「药品标签」 (the lead-in was 「药袋上写着：」 before 10-14). */
const restated = (m: Pick<DoseMedView, "labelZh">, locale: UiLocale) => (locale === "zh-Hans" && m.labelZh ? m.labelZh.replace(/^(?:药品标签|药袋上写着)：/, "") : null);

/** What the label says, under a head line that names the label: the Mandarin line (华语), then the label as printed. */
function LabelWords({ m, locale }: { m: DoseMedView; locale: UiLocale }) {
  const zh = restated(m, locale);
  return (
    <>
      {zh ? (
        <p className="rpu-said" data-size="sub" data-rp="label-line" lang="zh-Hans">
          {zh}
        </p>
      ) : null}
      <LabelOriginal style={{ marginTop: 4 }}>{m.labelWords ?? ""}</LabelOriginal>
    </>
  );
}

/**
 * One medicine on the slot's card (the draft's MED row): its name (never translated), then where its words come from:
 * 「药袋上写着 · 9月1日 配药 · 看原文 ›」 with the label's own line (its Mandarin slot template when there is one) and the
 * label as printed; or 「你选的时间」 when he chose the time himself. 「看原文」 opens the medicine's page (the label's
 * photo and text). The dispensing date and 「看原文」 are new with the timeline.
 */
export function MedRow({ m, locale, source }: { m: DoseMedView; locale: UiLocale; source?: MedSource }) {
  const copy = uiCopy(locale);
  const fromLabel = !m.slotChosen && !!m.labelWords;
  return (
    <SubRow
      testId={`dose-med-${m.medicationId}`}
      attrs={{ "data-state": m.state ?? "none", "data-reason": m.reason ?? "" }}
      title={medTitle(m)}
      who={m.slotChosen ? dt(locale, "today.slotChosen") : fromLabel ? copy.sources.label : undefined}
      meta={fromLabel && source?.dispensed ? dt(locale, "today.med.dispensed", { date: shortDay(locale, source.dispensed) }) : undefined}
      link={fromLabel ? { href: `/p/meds/${encodeURIComponent(m.medicationId)}`, label: copy.seeOriginal, testId: `dose-med-label-${m.medicationId}` } : undefined}
    >
      {fromLabel ? <LabelWords m={m} locale={locale} /> : null}
    </SubRow>
  );
}

/**
 * One medicine as its own entry of the line, when a slot holds more than one (the draft's 02-7): each is asked and
 * answered by itself. A medicine with a label is the label's node (the ink square) in a card: 「药袋上写着 · 9月1日 配药」,
 * its name, what the label says. One that still waits for its label is the dashed ring with the tag 「等药袋确认」; one
 * whose time he chose himself is his own node. `actions` are its own 吃了 / 还没吃; an answered one says what he
 * answered and when instead (the tick, or the dashed ring for 还没吃).
 */
export function MedEntry({ m, slot, locale, source, awaitingLabel = false, actions }: { m: DoseMedView; slot: DaySlot; locale: UiLocale; source?: MedSource; awaitingLabel?: boolean; actions?: ReactNode }) {
  const copy = uiCopy(locale);
  const fromLabel = !m.slotChosen && !!m.labelWords;
  const answered = m.state === "taken" || m.state === "missed";
  const part = dt(locale, slotKey("slot", slot));
  const said = !answered
    ? null
    : `${dt(locale, m.state === "taken" ? "today.row.taken" : "today.row.missed", { part, time: shortTime(m.answeredTime ?? "") })}${m.state === "missed" && m.reasonText ? ` · ${dt(locale, "today.done.reason", { reason: m.reasonText })}` : ""}`;
  return (
    <TimelineItem
      node={answered ? (m.state === "taken" ? "ok" : "miss") : fromLabel ? "lab" : m.slotChosen ? "me" : "miss"}
      frame="card"
      who={m.slotChosen ? dt(locale, "today.slotChosen") : fromLabel ? copy.sources.label : undefined}
      meta={fromLabel && source?.dispensed ? dt(locale, "today.med.dispensed", { date: shortDay(locale, source.dispensed) }) : undefined}
      title={<span translate="no">{medTitle(m)}</span>}
      note={said ?? undefined}
      testId={`dose-med-${m.medicationId}`}
      attrs={{ "data-state": m.state ?? "none", "data-reason": m.reason ?? "" }}
      actions={
        <>
          {awaitingLabel && !fromLabel ? (
            <TlControls>
              <Tag>{dt(locale, "today.med.awaitingLabel")}</Tag>
            </TlControls>
          ) : null}
          {actions}
        </>
      }
    >
      {fromLabel ? <LabelWords m={m} locale={locale} /> : null}
    </TimelineItem>
  );
}

/** 「Wei Ling 会看到：今天吃了」 in the tinted box, for as long as someone can see his medicine answers (real-app 2.7). */
export function HerEyesBox({ locale, names, state, indent = false }: { locale: UiLocale; names: string[]; state: "taken" | "missed" | "later"; indent?: boolean }): ReactElement | null {
  if (!names.length) return null;
  return (
    <Box
      variant="tint"
      indent={indent}
      title={
        <span data-testid="dose-her-eyes" data-state={state}>
          {dt(locale, "today.herEyes", { names: names.join(locale === "zh-Hans" ? "、" : ", "), state: dt(locale, `today.herEyes.${state}`) })}
        </span>
      }
    />
  );
}

/**
 * A slot that is not the one on screen, as one entry of the day's line. Its title is the slot's name (「早上的药」), the
 * grey line under it what the folded row always said:
 *   answered      the tick (taken) or the dashed ring (not taken) at the time he answered; 「早上 · 8:52 记的」 or
 *                 「早上 · 没吃 · 8:46 记的」; 「改一下」; and who sees it
 *   no reply      the dashed ring at the time the window closed; 「早上 · 没记（9:45）」; 「现在记」
 *   not his       a window that closed before he started (real-app 4.4): a plain point; 「现在记」
 *   later         the grey ring at the second reminder's time; 「早上 · 等一下（还没确认）」; 「现在记」
 *   coming        the grey ring at the reminder's time; 「早上 8:45 提醒你」
 *   yesterday     the dashed ring; 「昨天 · 早上的药」; 「现在记」 (today and yesterday only)
 * Test hooks: dose-row-<slot> / dose-row-yesterday-<slot> on the entry, with data-state.
 */
export function SlotRow({ s, locale, herEyes = [] }: { s: DoseSlotView; locale: UiLocale; herEyes?: string[] }) {
  const copy = uiCopy(locale);
  const name = dt(locale, slotMedKey(s.slot));
  const part = dt(locale, slotKey("slot", s.slot));
  const logNow = (
    <Acts>
      <Act href={changeHref(s)}>{dt(locale, "today.row.logNow")}</Act>
    </Acts>
  );
  if (s.when === "yesterday") {
    return (
      <TimelineItem node="miss" title={dt(locale, "today.row.yesterday", { slotMed: name })} testId={`dose-row-yesterday-${s.slot}`} attrs={{ "data-state": "open" }} actions={logNow} />
    );
  }
  const id = `dose-row-${s.slot}`;
  const answered = s.meds.filter((m) => m.state === "taken" || m.state === "missed");
  if (answered.length === s.meds.length && answered.length > 0) {
    const last = answered.map((m) => m.answeredTime ?? "").sort().at(-1) ?? "";
    const missed = answered.some((m) => m.state === "missed");
    return (
      <TimelineItem
        node={missed ? "miss" : "ok"}
        time={last ? shortTime(last) : undefined}
        title={name}
        note={dt(locale, missed ? "today.row.missed" : "today.row.taken", { part, time: shortTime(last) })}
        testId={id}
        attrs={{ "data-state": missed ? "missed" : "taken" }}
        actions={
          <>
            <Acts>
              <Act href={changeHref(s)}>{copy.change}</Act>
            </Acts>
            {/* who sees this answer, for as long as she can (real-app 2.7) */}
            <HerEyesBox locale={locale} names={herEyes} state={missed ? "missed" : "taken"} />
          </>
        }
      />
    );
  }
  // a window that closed before he started (real-app 4.4) is not his: never 「没记」, he may still log it
  if (s.phase === "closed" && s.meds.every((m) => m.state === "taken" || m.state === "missed" || (!m.tracked && m.state === null))) {
    return (
      <TimelineItem node="dot" title={name} testId={id} attrs={{ "data-state": "untracked" }} actions={logNow} />
    );
  }
  if (s.phase === "closed") {
    return (
      <TimelineItem
        node="miss"
        time={shortTime(s.schedule.closes)}
        title={name}
        note={dt(locale, "today.row.noReply", { part, time: shortTime(s.schedule.closes) })}
        testId={id}
        attrs={{ "data-state": "no_reply" }}
        actions={logNow}
      />
    );
  }
  if (s.meds.length > 0 && s.meds.every((m) => m.state === "unconfirmed" && m.reason === "later")) {
    return (
      <TimelineItem node="next" time={shortTime(s.schedule.second)} title={name} note={dt(locale, "today.row.later", { part })} testId={id} attrs={{ "data-state": "later" }} actions={logNow} />
    );
  }
  return (
    <TimelineItem node="next" time={shortTime(s.schedule.first)} title={name} note={dt(locale, "today.row.coming", { time: clockWords(locale, s.schedule.first) })} testId={id} attrs={{ "data-state": "coming" }} />
  );
}
