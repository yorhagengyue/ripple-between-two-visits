"use client";

/**
 * An account's Today screen (C2 track B, journey 02; real-app 2.7, 2.8), drawn as the timeline draft's 02 screens: the
 * day is one line of nodes. The server picks the slot that needs him (lib/daily/account-today.ts); this component
 * draws the line and answers that slot. No dialog anywhere.
 *
 * Owner's decision of 10-14 (his Today is short, nothing on it twice): on the day's overview the top of the screen is
 * his month (`month`: components/daily/elder/OwnMonth.tsx, each day marked by its doses, visit days in red, today
 * outlined) and under it today's line; a day he tapped in the month (`otherDay`) stands in the line's place until he
 * taps today again. While a slot needs him, he is answering or the answer's round mark is up, the screen is that slot
 * alone, exactly as before (「已服药」 stays on the first screen). The visit's box with 「就诊简报」 / 「开始就诊」, the
 * blood pressure entry and 「今天说过的话」 left Today (就诊 and 记录 have them), and so did the 「按一下说 / 打字」 strip.
 *
 *   the line      yesterday's slots he never answered; his routine up to now folded into one grey entry (「6:30 散步 ·
 *                 8:30 早饭」; before the reminder the latest routine entry is the node that is "now"; not while a slot
 *                 waits for his answer, so that 「已服药」 is on the first screen); every slot of
 *                 today in its place: the one on screen, the others as one entry each (components/today/dose-parts);
 *                 then, on the day's overview, a visit whose recording waits for its text
 *   under it      the slot's buttons, the reasons, who will see his answer
 *   the words     the app's own, as before the timeline (lib/daily/i18n.ts): the draft gives the shapes, the wording
 *                 stays the back end's (owner, 10-11). New with the line: the routine entries, 「提醒过」 / 「又问了一次」,
 *                 「再问一次」, the dispensing date and 「看原文」 on the medicine's row
 *   the slot      02-1  before the reminder: the grey ring, 「早上的药，8:45 提醒你。」, the medicine's card and a row of
 *                       buttons (he may log it before Ripple asks, real-app 2.7)
 *                 02-2b the reminder is due or he opened the notice: "now", 「早上的药，还没记。」, a card with her
 *                       recording (it plays by itself; 02-8 when the browser refuses) and each medicine's label
 *                 02-6a the window closed with no answer: 「8:45 提醒过」, 「9:15 又问了一次」, the dashed ring at
 *                       9:45, 「早上的药，到 9:45 还没记。」; 吃了 / 还没吃 still answer it
 *   the buttons   under the line, indented to its text, while the slot needs him: 吃了 / 还没吃 / 等一下 in one row
 *                 (72 high); after the window closed 吃了 over 还没吃; on the day's overview a row of three inside
 *                 the slot's entry
 *   吃了          02-3 / 02-6b: the tick at the time he tapped, 「记好了。」, 「早上 8:52 吃的。」, the medicines,
 *                 「改一下」, who will see it
 *   还没吃        recorded at once (not taken), then 02-4a: 「早上的药，还没吃。」 and under the line 「没吃是因为？」
 *                 with the reasons as a list, his own routine first; then 02-4b: the dashed ring, 「记好了。」,
 *                 「这次没吃。 原因：打太极」. No lecture after it
 *   等一下        02-5: Ripple says 「好，9:15 再问你。」, then 「9:15 再问一次」; 吃了 / 还没吃 stay
 *   two medicines 02-7: a slot with more than one medicine asks each by itself: an entry per medicine with its own
 *                 吃了 / 还没吃 (dose-taken-<id>, dose-missed-<id>), 等一下 for the slot under the line. One answered,
 *                 the other still asks
 *   撤销          12 s in the strip at the bottom after every answer: the cell goes back to what it was
 *   改            a link back to the slot (?change=<slot>); the buttons never show an earlier answer as chosen
 * Every answer goes to POST /api/doses (account: the day is the server's); undo to DELETE /api/doses. After an answer
 * the page's server data is read again (router.refresh), so the other entries follow; the answered view stays while
 * the undo bar is up, then the line says what is next.
 *
 * C2 track O (real-app 2.25, no network): an answer the server cannot be reached for is kept on the phone with the moment
 * he tapped (components/offline/senders.ts useDoseSender) and the screen says 「已记下（等连网）」 (OfflineNote); it goes out
 * by itself when the network is back. Undo of such an answer takes it out of the phone's list. While it waits the screen
 * keeps showing what he answered (the server's data cannot be read again without a network).
 *
 * Test hooks: dose-section (data-state: the focus's why, "done", "reasons", "all-done", "no-meds"), dose-headline
 * (data-why; the node's title; once every slot is answered it is the entry 「今天的药都记好了。」, data-why="all-done"),
 * dose-med-<id>, dose-actions, dose-taken / dose-missed / dose-later, dose-reasons with [data-reason], dose-own,
 * dose-done (data-kind), dose-done-rows, dose-her-eyes, dose-row-<slot>, undo-toast, today-routine, today-routine-now,
 * [data-today-section="month"] (his month, on the overview; the day he chose is own-day, OwnMonth.tsx), setup-done-notice,
 * setup-done-ok.
 */
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { TodayLayout } from "@/components/today";
import { HerEyesBox, MedEntry, MedRow, SlotRow, changeHref, medTitle, slotMedKey, type MedSource } from "@/components/today/dose-parts";
import { NewMedLabel, newMedHref } from "@/components/today/NewMedLabel";
import { DoseHero, DoseHeroHer, DoseHeroMed } from "@/components/today/DoseHero";
import {
  Act,
  Acts,
  ActionDock,
  Bubble,
  ButtonRow,
  Icon,
  PrimaryButton,
  ReasonChoices,
  Screen,
  SecondaryButton,
  SectionTitle,
  StatusHeadline,
  SubCard,
  Timeline,
  TimelineItem,
  UiLink,
  UndoToast,
} from "@/components/ui";
import { clockWords, dt, shortTime } from "@/lib/daily/i18n";
import { reasonsFor, stillOpen, type DoseMedView, type DoseSlotView, type TodayDoseData } from "@/lib/daily/today-view";
import type { ReminderClipView } from "@/lib/daily/types";
import type { Locale } from "@/lib/i18n";
import type { DaySlot, DoseState } from "@/lib/store/types";
import { localHHMM } from "@/lib/time/clock";
import { uiCopy } from "@/lib/ui/copy";
import { HerReminder } from "./HerReminder";
import { SlotChooser } from "./SlotChooser";
// owner 10-14: every entry that stands for one of his records can be held for Ripple's read of it
import { Explainable } from "@/components/explain/Explainable";
import { doseRef } from "@/lib/explain/subjects";
// the shape of the one-time notice after setting up is track A's reset line (.rpa-notice)
import "@/components/account/account.css";
// C2 track O: without a network his answer is kept on the phone and sent later
import { OfflineNote } from "@/components/offline/OfflineNote";
import { failureWords, useDoseSender } from "@/components/offline/senders";
import { refreshWhenOnline } from "@/lib/offline/client";
import { fetchSignedIn } from "@/lib/session/client";

type Answer = { state: DoseState; reason: string | null; reason_text: string | null };
type Prev = { medicationId: string; prev: Answer | null };

interface Done {
  slot: DaySlot;
  when: "today" | "yesterday";
  kind: "taken" | "missed" | "later";
  /** HH:MM in his zone, from the row the server wrote */
  at: string;
  reason: string | null;
  /** the slot as it was answered (its times, for 「9:15 再问你」) */
  view: DoseSlotView;
  /** track O: kept on the phone, not with Ripple yet; and the server data the screen had when he answered */
  queued: boolean;
  seen: TodayDoseData;
}

interface Undo {
  key: number;
  slot: DaySlot;
  when: "today" | "yesterday";
  prevs: Prev[];
  message: string;
  /** the bar's grey second line: when it was written, the reason he gave */
  detail: string | null;
  /** track O: the slot's date, and the medicines whose answer reached the server while this bar was up */
  date: string;
  sent: string[];
}

/** The reason step after 还没吃, on the slot it was asked about (the server's focus may have moved on meanwhile). */
interface Why {
  step: "reasons" | "own";
  view: DoseSlotView;
  /** the medicines he said 还没吃 for */
  meds: DoseMedView[];
  /** one medicine of several: the slot stays on screen afterwards (the others may still ask) */
  one: boolean;
}

/** What he just answered for one medicine of several, until the server's data says the same (track O: it may wait on the phone). */
type Local = Record<string, Pick<DoseMedView, "state" | "reason" | "reasonText" | "answeredTime">>;
const localKey = (s: Pick<DoseSlotView, "slot" | "when">, medicationId: string) => `${s.when}:${s.slot}:${medicationId}`;

/** One entry of his routine today, as the page read it (lib/daily/doses routineOf): "06:30", 「公园散步」. */
export interface RoutineToday {
  time: string;
  label: string;
}

/** Room kept free at the foot of the page while the undo strip is up (its bar and its padding). */
const TOAST_ROOM = "calc(84 * var(--rp-u) + 30px)";

/** How long 「建好了」 stays after setting up when he does not tap 「知道了」. */
const SETUP_NOTE_MS = 8000;

/** ?setup=done out of the address, without a navigation: a reload does not say 「建好了」 again. */
function dropSetupQuery() {
  const url = new URL(window.location.href);
  url.searchParams.delete("setup");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

async function post(method: "POST" | "DELETE", body: unknown): Promise<{ ok: boolean; createdAt: string | null }> {
  try {
    // track O: fetchSignedIn, so an undo after the sign-in ended goes to /login?next= and back (real-app 2.25)
    const res = await fetchSignedIn("/api/doses", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
    const json = (await res.json().catch(() => ({}))) as { dose?: { created_at?: string } | null };
    return { ok: res.ok, createdAt: json.dose?.created_at ?? null };
  } catch {
    return { ok: false, createdAt: null };
  }
}

function prevOf(m: DoseMedView): Answer | null {
  if (m.state === null) return null;
  if (m.state === "unconfirmed" && m.reason === "no_reply") return null;
  return { state: m.state, reason: m.reason, reason_text: m.reasonText };
}

/** He said 等一下 and Ripple has not asked again yet: the screen keeps saying when it will. */
function waitsForSecond(s: DoseSlotView): boolean {
  const allLater = s.meds.length > 0 && s.meds.every((m) => m.state === "unconfirmed" && m.reason === "later");
  const laterToSecond = s.meds.every((m) => (m.answeredTime ?? "") >= s.schedule.second);
  return s.when === "today" && allLater && (s.phase === "before" || s.phase === "first" || (s.phase === "second" && laterToSecond));
}

export function TodayAccount({
  locale,
  data,
  reminder,
  routine = [],
  medSources = {},
  meta,
  banner,
  bannerQuiet,
  visitWaiting,
  month,
  otherDay,
  familyConfirm,
  familyConfirmFirst,
  setupDone = false,
  tabBar,
}: {
  locale: Locale;
  data: TodayDoseData;
  /** her clip when a reminder is due (or he came from the notice) */
  reminder: ReminderClipView | null;
  /** his routine entries that fall on today, earliest first (what he gave when he set up); none: no routine entry on the line */
  routine?: RoutineToday[];
  /** where each medicine's label words come from (when the label was dispensed), by medicine id */
  medSources?: Record<string, MedSource>;
  meta: ReactNode;
  /** the banner slot on the day's overview (the example's banner, C's prompts) */
  banner?: ReactNode;
  /** the banner while a slot needs him, he is saying why, or right after he answered (the example's quiet line) */
  bannerQuiet?: ReactNode;
  /** track V's entry for a visit whose recording waits for its text (it draws its own entry of the line) */
  visitWaiting?: ReactNode;
  /** his month (components/daily/elder/OwnMonth.tsx): the top of the day's overview (owner 10-14) */
  month?: ReactNode;
  /** a day he chose in the month that is not today (OwnDay): it stands in the line's place on the overview */
  otherDay?: ReactNode;
  /** track D: someone accepted his invitation (her name, 是她 / 不是 with its own buttons); undefined: nobody waits */
  familyConfirm?: ReactNode;
  /** track D (only add): he came from the notice 「Wei Ling 已经接受」 (real-app 2.20 step 4): the card comes first even while a slot waits */
  familyConfirmFirst?: boolean;
  /** he just finished setting up (/p/today?setup=done): 「建好了」 once, in the banner's place */
  setupDone?: boolean;
  tabBar: ReactNode;
}) {
  const router = useRouter();
  const copy = uiCopy(locale);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<false | "answer" | "undo">(false);
  const [answered, setDone] = useState<Done | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [why, setWhy] = useState<Why | null>(null);
  const [own, setOwn] = useState("");
  const [local, setLocal] = useState<Local>({});
  // the one-time notice after setting up (owner's tidy of 10-13): it leaves on 「知道了」 or by itself after 8 s, and the
  // query leaves the address with it, so a reload does not say it again
  const [setupNote, setSetupNote] = useState(setupDone);
  const closeSetupNote = () => {
    setSetupNote(false);
    dropSetupQuery();
  };
  useEffect(() => {
    if (!setupNote) return;
    const t = window.setTimeout(() => {
      setSetupNote(false);
      dropSetupQuery();
    }, SETUP_NOTE_MS);
    return () => window.clearTimeout(t);
  }, [setupNote]);
  const offline = useDoseSender(data.tz); // track O
  // track O: an answer kept on the phone stays on screen until it has gone out and the server's data was read again
  const done = answered?.queued && !offline.holding && data !== answered.seen ? null : answered;

  const focus = data.focus;
  // the slot on screen: the reason step's own slot, else the server's focus
  const view: DoseSlotView | null = why?.view ?? focus?.slot ?? null;
  const slotMed = (s: Pick<DoseSlotView, "slot">) => dt(locale, slotMedKey(s.slot));

  async function answer(s: DoseSlotView, list: DoseMedView[], a: Answer, message: string, kind: Done["kind"] | null, detailOf?: (at: string) => string | null, stay = false): Promise<boolean> {
    setBusy(true);
    setFailed(false);
    const prevs: Prev[] = list.map((m) => ({ medicationId: m.medicationId, prev: prevOf(m) }));
    let ok = true;
    let createdAt: string | null = null;
    let queued = false;
    const sent: string[] = [];
    for (const m of list) {
      // track O: to the server as before (POST /api/doses), or kept on the phone when it cannot be reached
      const r = await offline.answer(m.medicationId, s, { state: a.state, reason: a.reason, reason_text: a.reason_text });
      ok = ok && r.ok;
      createdAt = r.createdAt ?? createdAt;
      queued = queued || r.queued;
      if (r.ok && !r.queued) sent.push(m.medicationId);
    }
    setBusy(false);
    if (!ok) {
      setFailed("answer");
      refreshWhenOnline(router);
      return false;
    }
    const at = createdAt ? localHHMM(Date.parse(createdAt), data.tz) : data.time;
    setUndo((u) => ({ key: (u?.key ?? 0) + 1, slot: s.slot, when: s.when, prevs: why && u ? u.prevs : prevs, message, detail: detailOf?.(at) ?? null, date: s.date, sent: why && u ? [...u.sent, ...sent] : sent }));
    if (kind) {
      setDone({ slot: s.slot, when: s.when, kind, at, reason: a.reason_text ?? null, view: s, queued, seen: data });
      setWhy(null);
      if (!queued) router.refresh();
    } else if (stay) {
      // one medicine of several: the slot stays on screen and says what he answered for this one
      setLocal((l) => ({ ...l, ...Object.fromEntries(list.map((m) => [localKey(s, m.medicationId), { state: a.state, reason: a.reason, reasonText: a.reason_text, answeredTime: at }])) }));
      setWhy(null);
      if (!queued) router.refresh();
    }
    return true;
  }

  async function undoLast() {
    const u = undo;
    if (!u) return;
    setUndo(null);
    setBusy(true);
    let undone = true;
    for (const p of u.prevs) {
      // track O: an answer still on the phone is taken out of its list; only what reached the server is undone there
      const waited = offline.unqueue(p.medicationId, u);
      if (waited && !u.sent.includes(p.medicationId)) continue;
      const r = await post("DELETE", { medication_id: p.medicationId, slot: u.slot, ...(u.when === "yesterday" ? { when: "yesterday" } : {}), ...(p.prev ? { restore: p.prev } : {}) });
      undone = undone && r.ok;
    }
    setBusy(false);
    setDone(null);
    setWhy(null);
    setLocal((l) => Object.fromEntries(Object.entries(l).filter(([k]) => !u.prevs.some((p) => k === localKey(u, p.medicationId)))));
    if (!undone) setFailed("undo");
    refreshWhenOnline(router);
  }

  /**
   * The end of the undo bar: back to the day's line. The answer stays as it was written. The two round-mark screens
   * had an arrow in the header that did the same at once; it is gone (owner's tidy of 10-13).
   */
  function leaveHero() {
    setDone(null);
    setWhy(null);
    refreshWhenOnline(router);
  }

  // one thing per screen: while a slot needs him now (its reminder is due, its window closed unanswered, he is changing
  // or logging it late, or he is saying why), the screen is that slot with its buttons under the line; otherwise it is
  // the day's overview, with the coming slot's buttons in its own entry
  const needsHim = !done && (!!why || (!!focus && focus.why !== "coming" && focus.why !== "untracked"));
  // her acceptance waiting for his 「是她」 is the one thing on the screen, unless a medicine slot needs him right now (or
  // he is in the middle of an answer): then it waits until that is done
  // track D (only add): tapping the notice 「Wei Ling 已经接受」 lands on this card (real-app 2.20 step 4), so then the
  // slot waits instead (it is still there once he has answered 是她 / 不是)
  const confirmNow = !!familyConfirmFirst && !why;
  if (familyConfirm && !done && (!needsHim || confirmNow)) {
    return <TodayLayout locale={locale} meta={meta} banner={bannerQuiet} headline={familyConfirm} tabBar={tabBar} tabBarPlacement="fixed" toast={null} />;
  }

  const sep = locale === "zh-Hans" ? "、" : ", ";
  /** the undo strip's grey second line after 吃了: when it was written */
  const takenDetail = (at: string) => shortTime(at);

  // ---- the buttons of the slot on screen
  // right after 等一下 the two answers stay (the draft's 02-5): on the slot as the server has it now, else as he answered it
  const laterDone = done && done.kind === "later" ? done : null;
  const sameSlot = (a: Pick<DoseSlotView, "slot" | "when">, b: Pick<DoseSlotView, "slot" | "when">) => a.slot === b.slot && a.when === b.when;
  const s0 = why ? null : laterDone ? (focus && sameSlot(focus.slot, laterDone) ? focus.slot : laterDone.view) : !done && focus ? focus.slot : null;
  /** the server's reason for showing the slot the buttons are for (none: the slot he just answered 等一下 in, before the re-read) */
  const f0 = s0 && focus && focus.slot === s0 ? focus : null;
  /** a medicine as the screen shows it: what he just answered on this screen until the server's data has an answer */
  const shownMed = (s: DoseSlotView, m: DoseMedView): DoseMedView => (stillOpen(m) && local[localKey(s, m.medicationId)] ? { ...m, ...local[localKey(s, m.medicationId)] } : m);
  /** a slot with several medicines asks each by itself (the draft's 02-7) */
  const multi = !!s0 && s0.meds.length > 1;
  const targets = s0 ? (f0?.why === "change" ? s0.meds : s0.meds.filter((m) => stillOpen(shownMed(s0, m)))) : [];
  /** he said 等一下 and Ripple has not asked again: only 吃了 / 还没吃 are left, in one row under the line */
  const afterLater = !!s0 && (!!laterDone || waitsForSecond(s0));
  // 等一下 asks to be reminded again: only while a reminder can still come, and not once he already said it
  const laterOk = !!s0 && s0.when === "today" && s0.phase !== "closed" && !afterLater;
  // a slot whose window closed without an answer, or yesterday's: no reminder is left, so 等一下 is gone and the two
  // answers stand one above the other (the draft's 02-6a)
  const late = !!s0 && f0?.why !== "untracked" && (s0.when === "yesterday" || s0.phase === "closed") && s0.meds.every((m) => m.state !== "taken" && m.state !== "missed");
  const tapTaken = () => s0 && void answer(s0, targets, { state: "taken", reason: null, reason_text: null }, dt(locale, "today.undo.taken"), "taken", takenDetail);
  const tapMissed = () =>
    s0 &&
    void answer(s0, targets, { state: "missed", reason: null, reason_text: null }, dt(locale, "today.undo.missed"), null).then((ok) => {
      if (ok) setWhy({ step: "reasons", view: s0, meds: targets, one: false });
    });
  const tapLater = () => s0 && void answer(s0, targets, { state: "unconfirmed", reason: "later", reason_text: null }, dt(locale, "today.undo.later"), "later");
  const tapTakenOne = (m: DoseMedView) => s0 && void answer(s0, [m], { state: "taken", reason: null, reason_text: null }, dt(locale, "today.undo.taken"), null, takenDetail, true);
  const tapMissedOne = (m: DoseMedView) =>
    s0 &&
    void answer(s0, [m], { state: "missed", reason: null, reason_text: null }, dt(locale, "today.undo.missed"), null).then((ok) => {
      if (ok) setWhy({ step: "reasons", view: s0, meds: [m], one: true });
    });
  const takenWords = copy.taken;
  const missedWords = copy.notTaken;

  /**
   * The buttons under the line, while the slot has the screen (the draft's 02-2b, 02-5, 02-6a; 02-7: only 等一下). Under
   * the slot's card the answers are one row (the draft's 22-1): with her words and the label as printed the card is
   * tall, and 「吃了」 has to stay on the first screen above the say bar. A slot whose window closed has no card, so its
   * two answers stand one above the other (02-6a).
   */
  const oneRow = !late || afterLater;
  const under = needsHim || afterLater;
  const bigButtons =
    s0 && targets.length && under && (!multi || laterOk) ? (
      <div className="rpu rpu-btns rpu-ind" data-testid="dose-actions" data-slot={s0.slot} data-when={s0.when}>
        {multi ? (
          <SecondaryButton disabled={busy} data-testid="dose-later" onClick={tapLater}>
            {copy.later}
          </SecondaryButton>
        ) : oneRow ? (
          <ButtonRow cols={laterOk ? 3 : 2}>
            <SecondaryButton pending={busy} data-testid="dose-taken" onClick={tapTaken}>
              {takenWords}
            </SecondaryButton>
            <SecondaryButton disabled={busy} data-testid="dose-missed" onClick={tapMissed}>
              {missedWords}
            </SecondaryButton>
            {laterOk ? (
              <SecondaryButton disabled={busy} data-testid="dose-later" onClick={tapLater}>
                {copy.later}
              </SecondaryButton>
            ) : null}
          </ButtonRow>
        ) : (
          // the window closed with no answer, or yesterday's slot: no reminder is left, the two answers one above the other
          <>
            <SecondaryButton pending={busy} data-testid="dose-taken" onClick={tapTaken}>
              {takenWords}
            </SecondaryButton>
            <SecondaryButton disabled={busy} data-testid="dose-missed" onClick={tapMissed}>
              {missedWords}
            </SecondaryButton>
          </>
        )}
      </div>
    ) : null;

  /** The same answers as a row inside the slot's own entry, on the day's overview (the draft's 22-1 row of three). */
  const rowButtons =
    s0 && targets.length && !under && (!multi || laterOk) ? (
      <Acts testId="dose-actions" cols={multi ? 1 : laterOk ? 3 : 2}>
        {multi ? null : (
          <Act pending={busy} data-testid="dose-taken" onClick={tapTaken}>
            {takenWords}
          </Act>
        )}
        {multi ? null : (
          <Act disabled={busy} data-testid="dose-missed" onClick={tapMissed}>
            {missedWords}
          </Act>
        )}
        {laterOk ? (
          <Act disabled={busy} data-testid="dose-later" onClick={tapLater}>
            {copy.later}
          </Act>
        ) : null}
      </Acts>
    ) : null;

  // ---- the slot on screen, as entries of the line
  /** the card under the slot's node: her recording and, when the slot has one medicine, that medicine (02-2b) */
  const medCard = (s: DoseSlotView, withReminder: boolean) => {
    const meds = s.meds.length > 1 ? [] : s.meds;
    return meds.length || (withReminder && reminder) ? (
      <SubCard testId="dose-focus">
        {withReminder && reminder ? <HerReminder key={reminder.id} clip={reminder} locale={locale} /> : null}
        {meds.map((m) => (
          <MedRow key={m.medicationId} m={m} locale={locale} source={medSources[m.medicationId]} />
        ))}
      </SubCard>
    ) : null;
  };
  const awaiting = new Set(data.awaitingLabel.map((m) => m.id));
  /** a slot with several medicines: one entry each after the slot's node, each with its own answers (02-7) */
  const medEntries = (s: DoseSlotView): ReactNode[] =>
    s.meds.length > 1
      ? s.meds.map((m0) => {
          const m = shownMed(s, m0);
          const asks = s0 === s && targets.some((t) => t.medicationId === m.medicationId);
          return (
            <MedEntry
              key={`med-${m.medicationId}`}
              m={asks && f0?.why === "change" ? m0 : m}
              slot={s.slot}
              locale={locale}
              source={medSources[m.medicationId]}
              awaitingLabel={awaiting.has(m.medicationId)}
              actions={
                asks ? (
                  <Acts cols={2} testId={`dose-acts-${m.medicationId}`}>
                    <Act pending={busy} data-testid={`dose-taken-${m.medicationId}`} onClick={() => tapTakenOne(m0)}>
                      {takenWords}
                    </Act>
                    <Act disabled={busy} data-testid={`dose-missed-${m.medicationId}`} onClick={() => tapMissedOne(m0)}>
                      {missedWords}
                    </Act>
                  </Acts>
                ) : undefined
              }
            />
          );
        })
      : [];
  /** The test hook on the slot's title (and the grey line that belongs to it): dose-headline with the server's reason. */
  const headlineHook = (whyNow: string, extra?: ReactNode) =>
    function hooked(title: ReactNode) {
      return (
        <div data-testid="dose-headline" data-why={whyNow} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {title}
          {extra}
        </div>
      );
    };
  const laterItems = (s: DoseSlotView): ReactNode[] => {
    const comes = s.when === "today" && (s.phase === "before" || s.phase === "first");
    return [
      <TimelineItem key="later-rip" node="rip">
        <div data-testid={done ? "dose-done" : "dose-later-line"} data-kind="later">
          <Bubble>{comes ? dt(locale, "today.later.title", { time: shortTime(s.schedule.second) }) : dt(locale, "today.later.noTime")}</Bubble>
        </div>
      </TimelineItem>,
      comes ? <TimelineItem key="later-next" node="next" time={shortTime(s.schedule.second)} title={dt(locale, "today.later.next")} /> : null,
    ];
  };
  /** The two reminders that went out before the window closed (the draft's 02-6a, 02-6b), in place of his routine. */
  const reminderHistory = (s: DoseSlotView): ReactNode[] => [
    <TimelineItem key="asked-1" node="sch" time={shortTime(s.schedule.first)} who={dt(locale, "today.closed.first")} />,
    <TimelineItem key="asked-2" node="sch" time={shortTime(s.schedule.second)} who={dt(locale, "today.closed.second")} />,
  ];

  let sectionState = "all-done";
  let closedSlot: DoseSlotView | null = null;
  let focusItems: ReactNode[] = [];
  /** right after 吃了 / 还没吃 the screen is one round mark with a few words (components/today/DoseHero), not an entry of the line */
  let hero: ReactNode = null;
  let heroFoot: ReactNode = null;
  /** the slot the entries above are about: it is left out of the day's other slots */
  const shown: DoseSlotView | null = done ? done.view : view;

  if (done) {
    sectionState = "done";
    const s = done.view;
    if (s.when === "today" && s.phase === "closed") closedSlot = s;
    // the cells as the server has them now (after the refresh), else as they were answered on this screen
    const meds = s.meds.map((m) => ({ ...m, ...answeredNow(data, done, m) }));
    const names = meds.map((m, i) => (
      <span key={m.medicationId} data-testid={`dose-med-${m.medicationId}`} data-state={m.state ?? "none"} data-reason={m.reason ?? ""}>
        {i > 0 ? sep : ""}
        {medTitle(m)}
      </span>
    ));
    const change = <Act href={changeHref(s)}>{copy.change}</Act>;
    if (done.kind === "taken" || done.kind === "missed") {
      // 「记好了。」, then 「早上 8:52 吃的。」 or 「这次没吃。 原因：打太极」, and who will see it; under it the medicines' row
      // with 「改一下」 (the canvas screen 02-3). Nothing more is said. After 吃了 the row has no 「早上 · 8:52 记的」: the
      // words above already say when (owner's tidy of 10-13); after 还没吃 it keeps its line, the only place with the time
      hero = (
        <DoseHero
          kind={done.kind}
          testId="dose-done"
          attrs={{ "data-kind": done.kind }}
          title={dt(locale, "today.done.title")}
          sub={
            done.kind === "taken"
              ? dt(locale, "today.done.taken", { time: clockWords(locale, done.at) })
              : `${dt(locale, "today.done.missed")}${done.reason ? ` ${dt(locale, "today.done.reason", { reason: done.reason })}` : ""}`
          }
        >
          {data.herEyes.length ? (
            <DoseHeroHer testId="dose-done-rows" attrs={{ "data-slot": done.slot }}>
              <span data-testid="dose-her-eyes" data-state={done.kind}>
                {dt(locale, "today.herEyes", { names: data.herEyes.join(sep), state: dt(locale, `today.herEyes.${done.kind}`) })}
              </span>
            </DoseHeroHer>
          ) : null}
        </DoseHero>
      );
      heroFoot = (
        <DoseHeroMed
          title={names}
          sub={done.kind === "missed" ? dt(locale, "today.row.missed", { part: dt(locale, `slot.${s.slot}`), time: shortTime(done.at) }) : undefined}
          action={change}
        />
      );
    } else {
      focusItems = [<TimelineItem key="slot" node="now" time={shortTime(s.schedule.first)} title={dt(locale, "today.slot.pending", { slotMed: slotMed(s) })} />, ...medEntries(s), ...laterItems(s)];
    }
  } else if (why) {
    sectionState = "reasons";
    const s = why.view;
    // the puzzled mark over 「没吃是因为？」 and which medicine it is about (the canvas screen 02-4); the reasons stand under it
    hero = (
      <DoseHero
        kind="why"
        title={
          <span data-testid="dose-headline" data-why="reasons">
            {copy.reasonTitle}
          </span>
        }
        sub={
          <>
            <span translate="no">{why.meds.map((m) => medTitle(m)).join(sep)}</span>
            {` · ${dt(locale, `slot.${s.slot}`)}`}
          </>
        }
      />
    );
  } else if (focus) {
    sectionState = focus.why;
    const s = focus.slot;
    const name = slotMed(s);
    if (focus.why === "yesterday") {
      focusItems = [
        <TimelineItem key="slot" node="miss" title={dt(locale, "today.slot.yesterday", { slotMed: name, slotMedLower: name.toLowerCase() })} titleWrap={headlineHook(focus.why)}>
          {medCard(s, false)}
        </TimelineItem>,
        ...medEntries(s),
      ];
    } else if (focus.why === "untracked") {
      // a window that closed before he started (real-app 4.4): not his, never 「没记」; he may still log it, calmly
      focusItems = [
        <TimelineItem key="slot" node="dot" title={dt(locale, "today.slot.untracked", { slotMed: name })} titleWrap={headlineHook(focus.why)} actions={rowButtons}>
          {medCard(s, false)}
        </TimelineItem>,
        ...medEntries(s),
      ];
    } else if (focus.why === "change") {
      // 「改」 on a slot nothing was answered in yet (a row's 现在记): it is simply not logged
      const nothingYet = s.meds.every((m) => m.state === null || (m.state === "unconfirmed" && m.reason === "no_reply"));
      if (s.phase === "closed" && nothingYet) closedSlot = s;
      focusItems = [
        <TimelineItem
          key="slot"
          node={closedSlot ? "miss" : "now"}
          time={closedSlot ? shortTime(s.schedule.closes) : undefined}
          title={dt(locale, s.meds.every((m) => m.state === null) ? "today.slot.pending" : nothingYet ? "today.slot.noReply" : "today.slot.change", { slotMed: name, time: shortTime(s.schedule.closes) })}
          titleWrap={headlineHook(focus.why)}
        >
          {medCard(s, false)}
        </TimelineItem>,
        ...medEntries(s),
      ];
    } else if (waitsForSecond(s)) {
      // after 等一下 the screen says when Ripple asks again until it does
      focusItems = [
        <TimelineItem key="slot" node="now" time={shortTime(s.schedule.first)} title={dt(locale, "today.slot.pending", { slotMed: name })} titleWrap={headlineHook(focus.why)} />,
        ...medEntries(s),
        ...laterItems(s),
      ];
    } else if (s.phase === "closed") {
      closedSlot = s;
      focusItems = [
        <TimelineItem
          key="slot"
          node="miss"
          time={shortTime(s.schedule.closes)}
          title={dt(locale, "today.slot.noReply", { slotMed: name, time: shortTime(s.schedule.closes) })}
          titleWrap={headlineHook(focus.why)}
        />,
        ...medEntries(s),
      ];
    } else if (s.phase === "before") {
      focusItems = [
        <TimelineItem
          key="slot"
          node="next"
          time={shortTime(s.schedule.first)}
          title={dt(locale, "today.slot.coming", { slotMed: name, time: shortTime(s.schedule.first) })}
          titleWrap={headlineHook(focus.why)}
          actions={rowButtons}
        >
          {/* the medicine's card is already there (he may log it before Ripple asks); her recording once he opened the notice */}
          {medCard(s, !!reminder)}
        </TimelineItem>,
        ...medEntries(s),
      ];
    } else {
      focusItems = [
        <TimelineItem
          key="slot"
          node="now"
          time={shortTime(s.phase === "second" ? s.schedule.second : s.schedule.first)}
          title={dt(locale, "today.slot.pending", { slotMed: name })}
          titleWrap={headlineHook(focus.why)}
          actions={rowButtons}
        >
          {medCard(s, true)}
        </TimelineItem>,
        ...medEntries(s),
      ];
    }
  } else if (data.noMeds) {
    sectionState = "no-meds";
  }

  // ---- his routine up to now: one grey entry; before the reminder, the latest of them is the node that is "now".
  // While a slot waits for his answer the routine is left out: the slot, its card and its buttons are the first screen
  const past = needsHim || hero ? [] : routine.filter((r) => r.time <= data.time);
  const comingNow = !done && !why && !!focus && focus.why === "coming" && focus.slot.phase === "before" && !waitsForSecond(focus.slot);
  const nowRoutine = comingNow ? (past.at(-1) ?? null) : null;
  const folded = nowRoutine ? past.slice(0, -1) : past;
  const routineItems: ReactNode[] = closedSlot
    ? hero
      ? []
      : reminderHistory(closedSlot)
    : [
        folded.length ? (
          <TimelineItem
            key="routine"
            node="sch"
            time={shortTime(folded[0].time)}
            who={folded[0].label}
            meta={folded.length > 1 ? folded.slice(1).map((r) => `${shortTime(r.time)} ${r.label}`).join(" · ") : copy.routine}
            testId="today-routine"
          />
        ) : null,
        nowRoutine ? <TimelineItem key="routine-now" node="now" time={shortTime(nowRoutine.time)} who={nowRoutine.label} meta={copy.routine} testId="today-routine-now" /> : null,
      ];

  // ---- every slot of today in its place, yesterday's unanswered ones first
  const isShown = (s: DoseSlotView) => !!shown && s.slot === shown.slot && s.when === shown.when;
  const todays = [...(focus ? [focus.slot] : []), ...data.others].filter((s) => s.when === "today");
  if (shown && shown.when === "today" && !todays.some(isShown)) todays.push(shown);
  const order: DaySlot[] = ["morning", "midday", "evening", "night"];
  todays.sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));
  /** a slot's entries as one thing he can hold (owner 10-14): the day's medicine in that part of the day */
  const held = (s: Pick<DoseSlotView, "slot" | "date">, key: string, entries: ReactNode) => (
    <Explainable key={key} as="line" subject={{ type: "dose", ref: doseRef(s.date, s.slot) }} locale={locale} label={slotMed(s)}>
      {entries}
    </Explainable>
  );
  // the slot on screen: its entries together (the slot, its medicines, what Ripple said after 等一下)
  const focusHeld: ReactNode[] = shown && focusItems.some(Boolean) ? [held(shown, "focus", focusItems)] : focusItems;
  const yesterdayRows = data.yesterday.filter((s) => !isShown(s)).map((s) => held(s, `y-${s.slot}`, <SlotRow s={s} locale={locale} />));
  const slotEntries: ReactNode[] = todays.flatMap<ReactNode>((s) => (isShown(s) ? focusHeld : [held(s, s.slot, <SlotRow s={s} locale={locale} herEyes={data.herEyes} />)]));
  // every slot answered and nothing on screen to answer: 「今天的药都记好了。」 is where the day stands now
  const allDone = !done && !why && !focus && !data.noMeds;
  if (allDone) slotEntries.push(<TimelineItem key="all-done" node="now" title={dt(locale, "today.allDone")} titleWrap={headlineHook("all-done")} />);
  // the slot on screen is yesterday's, or today's list does not hold it (the reason step after the focus moved on)
  if (shown && !todays.some(isShown)) slotEntries.unshift(...focusHeld);

  const empty = data.noMeds && !focus && !done;
  /** the day's overview: nothing needs him and he did not just answer (those screens are the slot alone, as the draft draws them) */
  const overview = !needsHim && !done;
  /** 「改一下」 opened from the day's line (?change=<slot>), nothing answered on this screen yet: the header's 「今天」 is the way back */
  const changing = !done && !why && !!focus && focus.why === "change";
  /** a day of his month he tapped that is not today: it stands where today's line stands, on the overview only */
  const dayShown = overview && !!otherDay;
  // with no medicine to take yet the line still holds his routine and the day's other records
  const lineItems: ReactNode[] = [
    ...(empty ? [] : yesterdayRows),
    ...routineItems,
    ...(empty ? [] : slotEntries),
    // on the overview only: a visit whose recording waits for its text (blood pressure and what he said to Ripple are
    // under 记录 and 就诊 since 10-14; the diet question and the watch left Today before)
    overview && visitWaiting ? <Fragment key="visit-waiting">{visitWaiting}</Fragment> : null,
  ].filter(Boolean);

  const herState = done ? (done.kind === "taken" ? "taken" : done.kind === "missed" ? "missed" : "later") : null;
  const reasons = why ? reasonsFor(data, why.view) : [];

  return (
    <Screen
      locale={locale}
      tabBar={tabBar}
      tabBarPlacement="fixed"
      toast={
        undo ? (
          <div data-testid="undo-toast" key={undo.key}>
            <UndoToast
              message={undo.message}
              detail={undo.detail ?? undefined}
              locale={locale}
              onUndo={() => void undoLast()}
              onExpire={() => {
                setUndo(null);
                // track O: it still waits on the phone, so the screen keeps saying what he answered
                if (done?.queued && offline.holding) return;
                leaveHero();
              }}
            />
          </div>
        ) : null
      }
    >
      {/* the two round-mark screens have no arrow in the header: the end of the undo bar goes back to the day's line
          (owner's tidy of 10-13) */}
      {changing ? (
        // 「改一下」: an arrow in front of 「今天」, back to the day's line with nothing changed (ux pass, 10-12, round 3)
        <div className="rpu-hero-head">
          {meta}
          <UiLink className="rpu-hero-back" data-testid="dose-change-back" aria-label={copy.back} href="/p/today">
            <Icon name="back" size={28} stroke={2.8} />
          </UiLink>
        </div>
      ) : (
        meta
      )}
      <div className="rpu-stack" data-hero={hero ? "true" : undefined}>
        {/* the one-time notice after setting up, in the banner's place; shaped as track A's password-reset line
            (components/account/ResetNoticeLine.tsx) */}
        {setupNote ? (
          <div className="rpu rpa-notice" role="status" data-testid="setup-done-notice">
            <p className="rpa-notice-text" data-rp-role="body">
              {dt(locale, "today.setup.title")}
            </p>
            <p className="rpa-notice-hint">{dt(locale, "today.setup.hint")}</p>
            <button type="button" className="rpa-text-button" data-testid="setup-done-ok" onClick={closeSetupNote}>
              {dt(locale, "today.setup.ok")}
            </button>
          </div>
        ) : null}
        {overview ? banner : bannerQuiet}
        {failed ? (
          <p className="rpu rpu-state-text" role="alert" data-testid="dose-failed">
            {failed === "undo" ? failureWords(locale, "undo", dt(locale, "today.error")) : dt(locale, "today.error")}
          </p>
        ) : null}
        {/* C2 track O: no network, and what waits on this phone (「已记下（等连网）」) */}
        <OfflineNote locale={locale} tz={data.tz} />

        {/* his month (owner 10-14), at the top of the day's overview; under the slot while one needs him (owner 10-18: it stays all day) */}
        {overview && month ? <section data-today-section="month">{month}</section> : null}

        {/* a day he tapped in the month stands where today's line stands, until he taps today again */}
        {dayShown ? otherDay : null}

        {!dayShown && empty ? (
          <div data-testid="dose-empty">
            <div data-testid="dose-headline" data-why="no-meds">
              <StatusHeadline lines={[dt(locale, "today.noMeds.title")]} style={{ marginTop: 0 }} />
            </div>
            <ActionDock>
              {/* a medicine waits for its label: the photo goes to that medicine (real-app 2.16) */}
              <PrimaryButton href={data.awaitingLabel[0] ? newMedHref(data.awaitingLabel[0].id) : "/p/meds/add"} data-testid="dose-empty-label">
                {dt(locale, data.awaitingLabel[0] ? "today.newMed.label" : "today.noMeds.label")}
              </PrimaryButton>
              <SecondaryButton href="/p/visit">{dt(locale, "today.noMeds.visit")}</SecondaryButton>
            </ActionDock>
            <NewMedLabel locale={locale} meds={data.awaitingLabel.slice(1)} />
          </div>
        ) : null}

        {/* the day's own title over the line, on the overview only (ux pass, 10-12) */}
        {overview && !dayShown && lineItems.length ? (
          <div data-testid="today-heading">
            <SectionTitle>{dt(locale, "today.heading")}</SectionTitle>
          </div>
        ) : null}
        {!dayShown && (hero || lineItems.length) ? (
          <div className={hero ? "rpu-hero-wrap" : undefined} data-testid="dose-section" data-state={sectionState}>
            {hero}
            {heroFoot}
            {lineItems.length ? <Timeline testId="today-line">{lineItems}</Timeline> : null}
          </div>
        ) : null}

        {/* the slot's buttons, under the line and indented to its text */}
        {dayShown ? null : bigButtons}
        {why && why.step === "reasons" ? (
          <div data-testid="dose-reasons" data-slot={why.view.slot}>
            <ReasonChoices
              locale={locale}
              look="buttons"
              showTitle={false}
              reasons={reasons}
              onPick={(code) => {
                const s = why.view;
                if (code === "self") {
                  setWhy({ ...why, step: "own" });
                  return;
                }
                const label = reasons.find((r) => r.code === code)?.label ?? code;
                void answer(s, why.meds, { state: "missed", reason: code, reason_text: label }, dt(locale, "today.undo.reason", { reason: label }), why.one ? null : "missed", undefined, why.one);
              }}
            />
          </div>
        ) : null}
        {why && why.step === "own" ? (
          <form
            className="rpu rpu-field"
            data-testid="dose-own"
            style={{ marginTop: 0 }}
            onSubmit={(e) => {
              e.preventDefault();
              const words = own.trim();
              const s = why.view;
              if (!words) return;
              void answer(s, why.meds, { state: "missed", reason: "own_words", reason_text: words }, dt(locale, "today.undo.reason", { reason: words }), why.one ? null : "missed", undefined, why.one).then((ok) => {
                if (ok) setOwn("");
              });
            }}
          >
            <label className="rpu-field-label" htmlFor="rp-dose-own">
              {dt(locale, "today.reason.ownLabel")}
            </label>
            <input
              id="rp-dose-own"
              className="rpu-field-input"
              value={own}
              maxLength={200}
              autoComplete="off"
              placeholder={dt(locale, "dose.reason.placeholder")}
              onChange={(e) => setOwn(e.target.value)}
              data-testid="dose-own-input"
            />
            <PrimaryButton type="submit" pending={busy} disabled={!own.trim()} data-testid="dose-own-save">
              {dt(locale, "dose.reason.save")}
            </PrimaryButton>
          </form>
        ) : null}

        {/* right after an answer: who will see it */}
        {done && done.kind === "later" && herState && data.herEyes.length ? (
          <div data-testid="dose-done-rows" data-slot={done.slot}>
            <HerEyesBox locale={locale} names={data.herEyes} state={herState} indent />
          </div>
        ) : null}

        {!dayShown && !empty && data.noSlot.length ? <SlotChooser locale={locale} meds={data.noSlot} /> : null}
        {/* 「拍一下新药的药袋」 for each medicine that waits for its label, on the day's overview */}
        {overview && !dayShown && !empty ? <NewMedLabel locale={locale} meds={data.awaitingLabel} /> : null}

        {/* owner 10-18: the month is on Today whatever the day is doing; while a slot needs him it comes after the slot, so the slot still comes first */}
        {!overview && month ? <section data-today-section="month">{month}</section> : null}

        {/* the undo strip sits over the foot of the page for 12 s: what is there moves up out of its way meanwhile */}
        {undo && !hero ? <div aria-hidden="true" style={{ height: TOAST_ROOM }} /> : null}
      </div>
    </Screen>
  );
}

/** The cell's answer as the server has it now (after the refresh), else as it was answered on this screen. */
function answeredNow(data: TodayDoseData, done: Done, m: DoseMedView): Partial<DoseMedView> {
  const fresh = [data.focus?.slot, ...data.others, ...data.yesterday].find((s) => s && s.slot === done.slot && s.when === done.when)?.meds.find((x) => x.medicationId === m.medicationId);
  if (fresh && fresh.state !== null && fresh.answeredTime) return { state: fresh.state, reason: fresh.reason, reasonText: fresh.reasonText, answeredTime: fresh.answeredTime };
  return {
    state: done.kind === "taken" ? "taken" : done.kind === "missed" ? "missed" : "unconfirmed",
    reason: done.kind === "later" ? "later" : null,
    answeredTime: done.at,
  };
}
