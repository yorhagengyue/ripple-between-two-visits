"use client";

/**
 * An account's blood pressure screens (C2 track B, journey 03; real-app 2.9), laid out as the timeline draft's group 03.
 * One page, four screens of it, switched on the phone itself (no request: the page he has open keeps working without a
 * network, real-app 2.25):
 *
 *   the week      03-3a / 03-3b / 03-5b, where 「记录」's 「看全部」 opens (owner 10-14; the header goes back with 「‹ 记录」):
 *                 「‹ 上一周 / 下一周 ›」 (once the account has a reading), the week's dates and how
 *                 many readings it holds, the week's picture next to the doctor's own numbers (dashed lines; the
 *                 caption says whose they are), a past week's average and highest upper number (never a count of
 *                 readings above or below the doctor's number: lib/daily/bp.ts), then every reading as a row. Today's rows open
 *                 the screen that changes them; a day without a reading says so. Under the list 「记一次血压」 and
 *                 「补记昨天的读数」, then the doctor's own words: how often to measure (with today's parts), the number
 *                 he gave, how to measure. When the doctor's plan asks for a reading right now, the page starts with
 *                 「该量血压了（早上）」, the button and 「这次没量」 (only there: owner's tidy of 10-13).
 *   recording     03-1: 「‹ 血压」, 「记一次血压」, the keypad like the home monitor (components/ui BpKeypad).
 *   after saving  03-2: his own entry, 「记下了：142/88」 with the time, next to the number the doctor gave (his words,
 *                 only once he confirmed them); the undo strip for 12 s (「撤销」: the reading is not recorded after all
 *                 and the keypad comes back with what he typed); then 「问一句」 and 「看这一周」. Changing or deleting it
 *                 is done from the week (today's row), not from this screen. 03-6, a reading above the doctor's warning line: the
 *                 995 card first, then the doctor's own sentence (track S's relay, ThresholdRelayBlock); no tab bar,
 *                 so nothing stands in front of it.
 *   changing      03-5a: 「‹ 血压」, 「今天的读数」, 「正在改 142/88」 over an empty keypad, 「删掉这次读数」 (no dialog: 03-5b,
 *                 the week with 「删掉了：142/88 · 撤销」 for 12 s).
 * Nothing judges a reading: no colour, no word about the numbers.
 *
 * Writes, as before: POST /api/bp (a uuid made here makes a resend harmless), PATCH /api/bp (today's), DELETE /api/bp
 * (today's; the undo puts the same reading back: PATCH { id, restore: true }, so its time and part of the day stay).
 * The undo after a new reading is that same DELETE; after a change it writes the numbers the reading had.
 *
 * C2 track O (real-app 2.25, no network): a reading (or 「这次没量」) the server cannot be reached for is kept on the phone
 * with the moment he tapped (components/offline/senders.ts useBpSender) and the screen says 「已记下（等连网）」
 * (OfflineNote, where a reading still on the phone can be taken out again); it goes out by itself when the network is
 * back, and only then can the doctor's words for a reading above his warning line appear. Changing or deleting a reading
 * that is already with Ripple needs a network.
 *
 * Owner 10-15 (the demo video's second scene): after a reading outside the target his doctor set (not above the warning
 * line: that screen stays track S's), the card under 「记下了」 says so with the doctor's numbers, who and when, and asks
 * him to hold a button and say what happened today (components/bp/BpOutsideTarget.tsx: his words kept with the reading,
 * one question for the next visit on his list). The same rule as his and her calendars (lib/daily/bp-target.ts).
 *
 * Test hooks: page-bp (data-scope, data-mode), bp-week (data-monday, data-count), bp-week-prev / bp-week-next,
 * bp-week-facts, bp-today (around today's rows of the week), bp-today-reading (data-id, data-state, data-reading; a
 * row of the week, or his entry after saving), bp-today-empty, bp-earlier-reading (data-state), bp-change (today's row of the week; the entry above the warning line), bp-delete (the changing screen; that same entry), bp-record-open (「记一次血压」: under the list,
 * or in bp-due at the top when the doctor's plan asks for a reading now), bp-skip (in bp-due), bp-cancel, bp-saved (data-kind, data-reading), bp-again (above the warning line, or waiting for a network), bp-back, bp-undo (after a delete), bp-saved-undo (after a
 * reading), bp-failed, bp-target-block, bp-plan-block, bp-no-target, bp-measuring, bp-today-relay.
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { BpWeekPlot } from "@/components/bp/BpWeekPlot";
import { bpc, weekCountWords } from "@/components/bp/copy";
import { DoseHero } from "@/components/today/DoseHero";
import { addDays, earliestMonday, mondayOf, plotModel, weekView, weeksBetween } from "@/components/bp/week";
import { Act, Acts, BodyText, Box, BpKeypad, Button, ButtonRow, Chevron, ListCard, ListItem, PrimaryButton, Screen, SecondaryButton, SectionTitle, Timeline, TimelineItem, UndoToast } from "@/components/ui";
import type { AccountBpReading } from "@/lib/daily/bp";
import { clockWords, dateWords, dt, shortDay, type DailyKey } from "@/lib/daily/i18n";
import { t, type Locale } from "@/lib/i18n";
import type { ThresholdRelay } from "@/lib/safety/threshold";
import type { BpEntry, BpReading } from "@/lib/ui/bp-entry";
import { uiCopy } from "@/lib/ui/copy";
import { clipTime } from "@/lib/ui/props";
import { localHHMM } from "@/lib/time/clock";
import { ElderMeta } from "./ElderMeta";
import { ThresholdRelayBlock } from "./ThresholdRelayBlock";
// C2 track O: without a network a reading is kept on the phone and sent later
import { OfflineNote } from "@/components/offline/OfflineNote";
import { useOfflineKit } from "@/components/offline/OfflineProvider";
import { failureWords, useBpSender } from "@/components/offline/senders";
import { takeOut } from "@/lib/offline/client";
import { fetchSignedIn } from "@/lib/session/client";
// owner 10-14: a reading and the week's head can be held for Ripple's read of them
import { Explainable } from "@/components/explain/Explainable";
// owner 10-14: the page is under 「记录」 (app/p/records): the week's way back
import { RECORDS_HREF, rc } from "@/lib/records/copy";
import "@/components/bp/bp.css";
// owner 10-15: the card after a reading outside the target his doctor set
import { BpOutsideTarget } from "@/components/bp/BpOutsideTarget";
import { outsideTarget } from "@/lib/daily/bp-target";

interface Saved {
  reading: AccountBpReading;
  relay: ThresholdRelay | null;
  kind: "recorded" | "corrected" | "skipped";
  /** track O: kept on the phone, not with Ripple yet */
  queued?: boolean;
}

/** The strip at the bottom: after a delete (the reading can be put back), or after a reading (it can be taken back). */
type Strip =
  | { kind: "deleted"; key: number; reading: AccountBpReading; message: string; detail?: string }
  | {
      kind: "saved";
      key: number;
      id: string;
      queued: boolean;
      /** what he typed (null: 「这次没量」) */
      entry: BpReading | null;
      /** a change: the reading as it was before */
      before: AccountBpReading | null;
      message: string;
      detail?: string;
    };

/**
 * Owner 10-15: what the card after a reading outside the doctor's target needs: the target he confirmed (its numbers, the
 * visit's date and story day), the doctor's name as a sentence says it, and whether a speech service is connected.
 */
export interface BpOutside {
  target: { systolic: number; diastolic: number; date: string; since: number };
  doctor: string | null;
  voice: boolean;
}

/** The doctor's number as the week's picture needs it: the dashed lines and what the caption says about them. */
export interface BpTargetLine {
  systolic: number;
  diastolic: number | null;
  /** YYYY-MM-DD of the visit */
  date: string;
  tStartMs: number | null;
  confirmed: boolean;
}

type ApiReading = { id: string; day: number; slot: AccountBpReading["slot"]; systolic: number | null; diastolic: number | null; pulse?: number | null; state: "recorded" | "unconfirmed"; created_at: string };

/** Monday first; two letters in English, so seven fit under the picture at 18px */
const WEEKDAYS: Record<Locale, readonly string[]> = { "zh-Hans": ["一", "二", "三", "四", "五", "六", "日"], en: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] };

function uuid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`;
}

async function call(method: "POST" | "PATCH" | "DELETE", body: unknown): Promise<{ ok: boolean; json: { reading?: ApiReading; relay?: ThresholdRelay | null } }> {
  try {
    // track O: fetchSignedIn, so a change after the sign-in ended goes to /login?next= and back (real-app 2.25)
    const res = await fetchSignedIn("/api/bp", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
    return { ok: res.ok, json: (await res.json().catch(() => ({}))) as { reading?: ApiReading; relay?: ThresholdRelay | null } };
  } catch {
    return { ok: false, json: {} };
  }
}

/** A sentence from a template with the reading set in the large numbers: 「记下了：」 then 142/88 at 44. */
function withNumbers(sentence: string, reading: string): ReactNode {
  const [before, after = ""] = sentence.split(reading);
  return (
    <>
      {before}
      <span className="rp03-num" translate="no">
        {reading}
      </span>
      {after}
    </>
  );
}

export function BpAccount({
  locale,
  tz,
  date,
  readings,
  relays,
  target,
  targetLine = null,
  plan,
  due = [],
  measuring,
  yesterday,
  tabBar,
  sayBar,
  start = "week",
  outside = null,
}: {
  locale: Locale;
  tz: string;
  /** today, YYYY-MM-DD */
  date: string;
  readings: AccountBpReading[];
  relays: { readingId: string; relay: ThresholdRelay }[];
  /** kept from the first screen (the page drew the header): the header is drawn here now, one per screen of the page */
  meta?: ReactNode;
  /** the doctor's number he confirmed, as an entry of a line (components/bp BpDoctorEntry: his words, date, clip), or null */
  target: ReactNode;
  /** the same number for the week's picture: the dashed lines and their caption */
  targetLine?: BpTargetLine | null;
  /** how often, as the doctor said, as an entry of a line (with today's parts), or null */
  plan: ReactNode;
  /** the parts of the day the doctor's plan asks for right now, not measured yet */
  due?: ("morning" | "evening")[];
  /** how to measure, as the doctor said: entries of a line, or null */
  measuring: ReactNode;
  /** the entry to a reading from yesterday (components/daily/elder/BpYesterday.tsx), or nothing */
  yesterday?: ReactNode;
  tabBar: ReactNode;
  /** 「按一下说 / 打字」 above the tab bar, on the week's screen only (the keypad and a reading just saved end with their own buttons) */
  sayBar?: ReactNode;
  /** "record": the page opens on the keypad (/p/bp?do=record, from Today's 「记一次」) */
  start?: "week" | "record";
  /** owner 10-15: the target he confirmed and the card's needs; null: no target, so no card */
  outside?: BpOutside | null;
}) {
  const router = useRouter();
  const copy = uiCopy(locale);
  const kit = useOfflineKit();
  const offline = useBpSender(tz); // track O
  const [mode, setMode] = useState<"week" | "record" | "saved">(start === "record" ? "record" : "week");
  const [saved, setSaved] = useState<Saved | null>(null);
  const [editing, setEditing] = useState<AccountBpReading | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [keypad, setKeypad] = useState<{ key: number; initial?: Partial<BpEntry> }>({ key: 0 });
  const [strip, setStrip] = useState<Strip | null>(null);
  /** how many weeks before this one the week view shows */
  const [weeksBack, setWeeksBack] = useState(0);
  /** readings he just deleted: out of the week at once, before the page has read its data again (back in on 「撤销」) */
  const [gone, setGone] = useState<string[]>([]);

  // /p/bp?do=record opened the keypad (Today's 「记一次」). The address keeps `do` (ux pass 10-12, round 4): taking it
  // off made the page build this component anew the first time it read its data again, which is right after 「记下」,
  // so on that way in the screen after a reading never showed (he landed on the week). The cost: loading this address
  // again opens the keypad again

  // a new screen of the page starts at its top (the week's button sits at the foot of a long page)
  const screen = `${mode}:${editing?.id ?? ""}`;
  const shownScreen = useRef(screen);
  useEffect(() => {
    if (shownScreen.current === screen) return;
    shownScreen.current = screen;
    window.scrollTo(0, 0);
  }, [screen]);

  const shown = (r: Pick<AccountBpReading, "systolic" | "diastolic">) => `${r.systolic}/${r.diastolic}`;
  const partWords = (r: Pick<AccountBpReading, "part">) => dt(locale, `bp.slot.${r.part}` as DailyKey);
  const pulseWords = (r: Pick<AccountBpReading, "pulse">) => (r.pulse ? ` · ${dt(locale, "bp.page.pulse", { n: r.pulse })}` : "");
  const nextKey = (s: Strip | null) => (s?.key ?? 0) + 1;

  const asView = (r: ApiReading): AccountBpReading => ({
    id: r.id,
    day: r.day,
    date,
    slot: r.slot,
    part: r.slot === "morning" ? "morning" : "evening",
    time: localHHMM(Date.parse(r.created_at), tz),
    systolic: r.state === "recorded" ? r.systolic : null,
    diastolic: r.state === "recorded" ? r.diastolic : null,
    pulse: r.pulse ?? null,
    state: r.state,
    editable: true,
  });

  function openRecord() {
    setError(undefined);
    setSaved(null);
    setEditing(null);
    setStrip((s) => (s?.kind === "saved" ? null : s));
    setKeypad((k) => ({ key: k.key + 1 }));
    setMode("record");
  }

  function openWeek() {
    setError(undefined);
    setSaved(null);
    setEditing(null);
    setStrip((s) => (s?.kind === "saved" ? null : s));
    setWeeksBack(0);
    setMode("week");
  }

  function openEdit(r: AccountBpReading) {
    setError(undefined);
    setSaved(null);
    setStrip(null);
    setEditing(r);
    // the keypad comes back empty: he types the reading again from the monitor
    setKeypad((k) => ({ key: k.key + 1 }));
    setMode("record");
  }

  async function save(entry: BpReading) {
    setPending(true);
    setError(undefined);
    const was = editing;
    // track O: a new reading goes to the server as before (POST /api/bp), or is kept on the phone when it cannot be reached
    const r = was
      ? { ...(await call("PATCH", { id: was.id, systolic: entry.systolic, diastolic: entry.diastolic, pulse: entry.pulse })), queued: false }
      : await offline.record({ id: uuid(), systolic: entry.systolic, diastolic: entry.diastolic, pulse: entry.pulse });
    setPending(false);
    if (!r.ok || !r.json.reading) {
      setError(was ? failureWords(locale, "change", dt(locale, "today.error")) : dt(locale, "today.error"));
      return;
    }
    const reading = asView(r.json.reading);
    const relay = r.json.relay ?? null;
    setSaved({ reading, relay, kind: was ? "corrected" : "recorded", queued: r.queued });
    setEditing(null);
    setKeypad((k) => ({ key: k.key + 1 }));
    // above the doctor's warning line nothing stands in front of his words: no strip there
    setStrip((s) =>
      relay
        ? null
        : { kind: "saved", key: nextKey(s), id: reading.id, queued: r.queued, entry, before: was, message: bpc(locale, "undoSaved", { reading: shown(reading) }), detail: clockWords(locale, reading.time) },
    );
    setMode("saved");
    if (!r.queued) router.refresh();
  }

  async function skip() {
    setPending(true);
    setError(undefined);
    const r = await offline.record({ id: uuid(), state: "unconfirmed" }); // track O: or kept on the phone
    setPending(false);
    if (!r.ok || !r.json.reading) {
      setError(dt(locale, "today.error"));
      return;
    }
    const reading = asView(r.json.reading);
    setSaved({ reading, relay: null, kind: "skipped", queued: r.queued });
    setStrip((s) => ({ kind: "saved", key: nextKey(s), id: reading.id, queued: r.queued, entry: null, before: null, message: bpc(locale, "undoSkipped"), detail: clockWords(locale, reading.time) }));
    setMode("saved");
    if (!r.queued) router.refresh();
  }

  async function remove(reading: AccountBpReading) {
    setPending(true);
    setError(undefined);
    const r = await call("DELETE", { id: reading.id });
    setPending(false);
    if (!r.ok) {
      setError(failureWords(locale, "change", dt(locale, "today.error")));
      return;
    }
    setSaved(null);
    setEditing(null);
    setWeeksBack(0);
    setGone((g) => [...g, reading.id]);
    setMode("week");
    setStrip((s) => ({
      kind: "deleted",
      key: nextKey(s),
      reading,
      message: dt(locale, "bp.page.deleted", { reading: reading.state === "recorded" ? shown(reading) : dt(locale, "bp.unconfirmed") }),
      detail: `${shortDay(locale, reading.date)} · ${clockWords(locale, reading.time)}`,
    }));
    router.refresh();
  }

  async function putBack(s: Extract<Strip, { kind: "deleted" }>) {
    setStrip(null);
    // the same reading comes back (its time and its part of the day as they were), not a new one
    const r = await call("PATCH", { id: s.reading.id, restore: true });
    if (!r.ok) setError(failureWords(locale, "undo", dt(locale, "today.error")));
    else setGone((g) => g.filter((id) => id !== s.reading.id));
    router.refresh();
  }

  /** 「撤销」 after a reading: it is not recorded after all (a change: the numbers it had are back); the keypad returns with what he typed. */
  async function takeBack(s: Extract<Strip, { kind: "saved" }>) {
    setStrip(null);
    setError(undefined);
    const typed: Partial<BpEntry> | undefined = s.entry ? { sys: String(s.entry.systolic), dia: String(s.entry.diastolic), pul: s.entry.pulse ? String(s.entry.pulse) : "", active: "dia" } : undefined;
    if (s.before) {
      const b = s.before;
      const r = await call("PATCH", { id: s.id, systolic: b.systolic, diastolic: b.diastolic, pulse: b.pulse });
      if (!r.ok) {
        setError(failureWords(locale, "undo", dt(locale, "today.error")));
        return;
      }
      setSaved(null);
      setEditing(b);
      setKeypad((k) => ({ key: k.key + 1, initial: typed }));
      setMode("record");
      router.refresh();
      return;
    }
    // track O: a reading still on the phone is taken out of its list; one that reached the server is deleted there
    const onPhone = s.queued && takeOut(kit, s.id);
    if (!onPhone) {
      const r = await call("DELETE", { id: s.id });
      if (!r.ok) {
        setError(failureWords(locale, "undo", dt(locale, "today.error")));
        return;
      }
    }
    setSaved(null);
    setEditing(null);
    setKeypad((k) => ({ key: k.key + 1, initial: typed }));
    // a reading comes back to the keypad with its numbers; 「这次没量」 was tapped on the week's view and goes back there
    // (owner's tidy of 10-13)
    setMode(s.entry ? "record" : "week");
    if (!onPhone) router.refresh();
  }

  const relayOf = (id: string) => (saved?.reading.id === id ? saved.relay : null) ?? relays.find((x) => x.readingId === id)?.relay ?? null;

  // ---------------------------------------------------------------- the header of the screen on show
  const savedRelay = mode === "saved" && saved && saved.reading.state === "recorded" ? relayOf(saved.reading.id) : null;
  /** 「血压」: the tab's own word, written out in English */
  const pageName = t(locale, "nav.bp");
  const header =
    mode === "record" ? (
      <ElderMeta locale={locale} back={{ href: "/p/bp", label: pageName }} title={dt(locale, editing ? "bp.page.today" : "bp.record.title")} story={dateWords(locale, date)} />
    ) : mode === "saved" && saved ? (
      <ElderMeta locale={locale} title={pageName} story={savedRelay ? dt(locale, "bp.page.saved", { s: saved.reading.systolic ?? "", d: saved.reading.diastolic ?? "" }) : dateWords(locale, date)} />
    ) : (
      // owner 10-14: the page is under 「记录」 (/p/records), and the week goes back there
      <ElderMeta locale={locale} back={{ href: RECORDS_HREF, label: rc(locale, "title") }} title={pageName} story={`${dateWords(locale, date)} · ${bpc(locale, "byWeek")}`} />
    );
  /**
   * 「‹ 血压」 goes back to the week on the phone itself (the page stays; nothing is asked of the server). The week's own
   * 「‹ 记录」 is an ordinary link to another page.
   */
  function onHeaderClick(e: MouseEvent<HTMLDivElement>) {
    if (mode === "week") return;
    const link = (e.target as HTMLElement | null)?.closest?.('[data-rp="back"]');
    if (!link) return;
    e.preventDefault();
    openWeek();
  }

  // ---------------------------------------------------------------- the week
  const currentMonday = mondayOf(date);
  const maxBack = Math.max(0, weeksBetween(earliestMonday(readings, date), currentMonday));
  const back = Math.min(weeksBack, maxBack);
  const monday = addDays(currentMonday, -7 * back);
  const isCurrent = back === 0;
  const week = useMemo(() => weekView(gone.length ? readings.filter((r) => !gone.includes(r.id)) : readings, monday), [readings, gone, monday]);
  const refs = targetLine ? [{ value: targetLine.systolic, label: String(targetLine.systolic) }, ...(targetLine.diastolic !== null ? [{ value: targetLine.diastolic, label: String(targetLine.diastolic) }] : [])] : [];
  const model = plotModel(week, date, refs.map((r) => r.value));
  const facts = week.facts;

  function caption(): ReactNode {
    const below = model.labelled ? "" : bpc(locale, "capBelow");
    if (!targetLine) return below || undefined;
    const at = targetLine.tStartMs !== null ? bpc(locale, "capAt", { time: clipTime(targetLine.tStartMs) }) : "";
    const two = targetLine.diastolic !== null;
    const key = targetLine.confirmed ? (two ? "capTwo" : "capOne") : two ? "capTwoInferred" : "capOneInferred";
    const whose = bpc(locale, key, { date: shortDay(locale, targetLine.date), s: targetLine.systolic, d: targetLine.diastolic ?? "", at });
    const sentence = below ? `${whose}${locale === "zh-Hans" ? "" : " "}${below}` : whose;
    // 「（录音 0:49）」 wraps as one piece: never 「（录音」 at the end of a line and the time on the next. Same words
    const mark = at.trim();
    const cut = mark ? sentence.indexOf(mark) : -1;
    if (cut < 0) return sentence;
    return (
      <>
        {sentence.slice(0, cut)}
        <span className="rp03-whole">{mark}</span>
        {sentence.slice(cut + mark.length)}
      </>
    );
  }

  const todays = isCurrent ? week.rows.filter((r) => r.editable) : [];
  const others = week.rows.filter((r) => !(isCurrent && r.editable));
  const todayRelays = todays.filter((r) => r.state === "recorded").flatMap((r) => {
    const relay = relayOf(r.id);
    return relay ? [{ reading: r, relay }] : [];
  });

  const weekScreen = (
    <div className="rpu-stack">
      {error ? (
        <div role="alert" data-testid="bp-failed">
          <Box variant="red" title={error} />
        </div>
      ) : null}
      {/* C2 track O: no network, and what waits on this phone (「已记下（等连网）」) */}
      <OfflineNote locale={locale} tz={tz} removable />
      {/* a reading of today above the doctor's warning line keeps his words next to it for the day (real-app 2.9) */}
      {todayRelays.map(({ reading, relay }) => (
        <div key={reading.id} className="rp03-sec" data-testid="bp-today-relay" data-id={reading.id}>
          <p className="rpu rpu-label">{bpc(locale, "relayOf", { time: clockWords(locale, reading.time), reading: shown(reading) })}</p>
          <ThresholdRelayBlock relay={relay} locale={locale} />
        </div>
      ))}
      {/* the doctor's plan asks for a reading right now: the page starts with that, and its button is the way to the keypad */}
      {due.length ? (
        <div className="rpu-btns" data-testid="bp-due" data-part={due[0]}>
          <Box variant="acc" title={dt(locale, "today.bp.dueNow", { part: dt(locale, `slot.${due[0]}` as DailyKey) })} />
          <PrimaryButton data-testid="bp-record-open" onClick={openRecord}>
            {dt(locale, "bp.record.title")}
          </PrimaryButton>
          {/* 「这次没量」 answers "it is time: did you measure?", so it stands here and no longer under the keypad (owner's tidy of 10-13) */}
          <Button variant="link" data-testid="bp-skip" disabled={pending} onClick={() => void skip()}>
            {dt(locale, "bp.page.skip")}
          </Button>
        </div>
      ) : null}

      {/* an account without a reading has no other week to go to: the two buttons come with the first reading (owner's tidy of 10-13) */}
      {readings.length ? (
        <ButtonRow cols={2} className="rp03-weeknav">
          <Button variant="small" icon="back" data-testid="bp-week-prev" disabled={back >= maxBack} onClick={() => setWeeksBack(back + 1)}>
            {bpc(locale, "prevWeek")}
          </Button>
          <Button variant="small" data-testid="bp-week-next" disabled={isCurrent} onClick={() => setWeeksBack(Math.max(0, back - 1))}>
            <span className="rp03-icon-after">
              {bpc(locale, "nextWeek")}
              <Chevron />
            </span>
          </Button>
        </ButtonRow>
      ) : null}

      <Explainable subject={{ type: "bp_week", ref: monday }} locale={locale} label={bpc(locale, "weekRange", { from: shortDay(locale, week.monday), to: shortDay(locale, week.sunday) })}>
        <div className="rpu rp03-week" data-testid="bp-week" data-monday={monday} data-count={facts.count} data-current={isCurrent ? "true" : "false"}>
          <h2 className="rp03-week-t">{bpc(locale, "weekRange", { from: shortDay(locale, week.monday), to: shortDay(locale, week.sunday) })}</h2>
          <p className="rp03-week-s" data-testid="bp-week-count">
            {weekCountWords(locale, facts.count, !isCurrent, facts.unconfirmed)}
          </p>
        </div>
      </Explainable>

      {facts.count > 0 ? <BpWeekPlot model={model} weekdays={WEEKDAYS[locale]} refs={refs} caption={caption()} label={bpc(locale, "chartLabel")} testId="bp-week-chart" /> : null}

      {!isCurrent && facts.count > 1 ? (
        <ListCard testId="bp-week-facts">
          <ListItem title={bpc(locale, "avgOf", { n: facts.count })} right={<span translate="no">{`${facts.avgSystolic}/${facts.avgDiastolic}`}</span>} />
          <ListItem title={bpc(locale, "highestTop")} right={<span translate="no">{facts.topSystolic}</span>} />
        </ListCard>
      ) : null}

      {isCurrent || week.rows.length ? (
        <ListCard testId="bp-week-list">
          {isCurrent && todays.length === 0 ? <ListItem testId="bp-today-empty" title={bpc(locale, "today")} sub={dateWords(locale, date)} right={bpc(locale, "noneToday")} /> : null}
          {/* today's rows keep the first screen's hook around them (bp-today); the wrapper draws no box of its own */}
          {todays.length ? (
            <div className="rp03-today" data-testid="bp-today">
              {todays.map((r) => (
                <Explainable key={r.id} as="row" subject={{ type: "bp", ref: r.id }} locale={locale} label={r.state === "recorded" ? shown(r) : `${bpc(locale, "today")} ${partWords(r)}`}>
                  {r.state === "recorded" ? (
                    <ListItem
                      testId="bp-today-reading"
                      attrs={{ "data-id": r.id, "data-state": "recorded", "data-reading": shown(r) }}
                      title={<span translate="no">{shown(r)}</span>}
                      sub={`${bpc(locale, "today")} · ${clockWords(locale, r.time)}${pulseWords(r)}`}
                      right={<span data-testid="bp-change">{copy.change}</span>}
                      rightTone="accent"
                      chevron
                      onClick={() => openEdit(r)}
                    />
                  ) : (
                    <ListItem
                      mark="miss"
                      testId="bp-today-reading"
                      attrs={{ "data-id": r.id, "data-state": "unconfirmed", "data-reading": "unconfirmed" }}
                      title={`${bpc(locale, "today")} ${partWords(r)}`}
                      right={dt(locale, "bp.unconfirmed")}
                      chevron
                      onClick={() => openEdit(r)}
                    />
                  )}
                </Explainable>
              ))}
            </div>
          ) : null}
          {others.map((r) => (
            <Explainable key={r.id} as="row" subject={{ type: "bp", ref: r.id }} locale={locale} label={r.state === "recorded" ? `${shown(r)} · ${shortDay(locale, r.date)}` : `${shortDay(locale, r.date)} ${partWords(r)}`}>
              {r.state === "recorded" ? (
                <ListItem
                  title={
                    <span data-testid="bp-earlier-reading" data-state="recorded" translate="no">
                      {shown(r)}
                    </span>
                  }
                  sub={`${shortDay(locale, r.date)} ${partWords(r)}${pulseWords(r)}`}
                />
              ) : (
                <ListItem
                  mark="miss"
                  title={`${shortDay(locale, r.date)} ${partWords(r)}`}
                  right={
                    <span data-testid="bp-earlier-reading" data-state="unconfirmed">
                      {dt(locale, "bp.unconfirmed")}
                    </span>
                  }
                />
              )}
            </Explainable>
          ))}
        </ListCard>
      ) : (
        <Box variant="line" title={bpc(locale, "weekEmpty")} testId="bp-week-empty" />
      )}

      {!due.length || yesterday ? (
        <div className="rpu-btns">
          {due.length ? null : (
            <SecondaryButton data-testid="bp-record-open" onClick={openRecord}>
              {dt(locale, "bp.record.title")}
            </SecondaryButton>
          )}
          {yesterday}
        </div>
      ) : null}

      {plan ? (
        <section className="rp03-sec" data-testid="bp-plan-block">
          <SectionTitle>{dt(locale, "bp.page.plan")}</SectionTitle>
          <Timeline>{plan}</Timeline>
        </section>
      ) : null}
      <section className="rp03-sec" data-testid="bp-target-block">
        <SectionTitle>{dt(locale, "bp.doctorNumber")}</SectionTitle>
        {target ? (
          <Timeline>{target}</Timeline>
        ) : (
          <div data-testid="bp-no-target">
            <p className="rpu rp03-note">{dt(locale, "bp.page.noTarget")}</p>
          </div>
        )}
      </section>
      {measuring ? (
        <section className="rp03-sec" data-testid="bp-measuring">
          <SectionTitle>{dt(locale, "bp.measuring")}</SectionTitle>
          <Timeline>{measuring}</Timeline>
        </section>
      ) : null}
    </div>
  );

  // ---------------------------------------------------------------- recording, and changing one of today's
  const recordScreen = (
    <div className="rpu-stack">
      {/* C2 track O: no network, and what waits on this phone; a reading taken out again is not "recorded" */}
      <OfflineNote locale={locale} tz={tz} removable />
      {editing ? (
        <>
          <BodyText variant="lede" style={{ marginTop: 0 }}>
            {editing.state === "recorded" ? dt(locale, "bp.page.changing", { reading: shown(editing) }) : dt(locale, "bp.page.planNotMeasured", { part: partWords(editing) })}
          </BodyText>
          {editing.state === "recorded" ? <BpKeypad key={keypad.key} locale={locale} initial={keypad.initial} onSubmit={(entry) => void save(entry)} pending={pending} error={error} style={{ marginTop: 0 }} /> : null}
          {editing.state !== "recorded" && error ? (
            <div role="alert" data-testid="bp-failed">
              <Box variant="red" title={error} />
            </div>
          ) : null}
          <div className="rpu-btns">
            <Button variant="danger-outline" data-testid="bp-delete" disabled={pending} onClick={() => void remove(editing)}>
              {bpc(locale, editing.state === "recorded" ? "deleteThis" : "deleteSkipped")}
            </Button>
            <Button variant="link" data-testid="bp-cancel" onClick={openWeek}>
              {dt(locale, "bp.page.cancel")}
            </Button>
          </div>
        </>
      ) : (
        <>
          {/* the keypad first, so 「记下 142/88」 stays on the first screen; the hint is the grey line under it (the draft's) */}
          <BpKeypad key={keypad.key} locale={locale} initial={keypad.initial} onSubmit={(entry) => void save(entry)} pending={pending} error={error} style={{ marginTop: 0 }} />
          <p className="rpu rp03-note">{bpc(locale, "recordHint")}</p>
        </>
      )}
    </div>
  );

  // ---------------------------------------------------------------- after saving
  let savedScreen: ReactNode = null;
  if (saved) {
    const r = saved.reading;
    const recorded = r.state === "recorded";
    // changing or deleting needs the reading to be with Ripple: one still on the phone is taken out in the note below
    const withRipple = !saved.queued || readings.some((x) => x.id === r.id);
    const entry = (
      <TimelineItem
        node={recorded ? "me" : "miss"}
        who={bpc(locale, "you")}
        meta={`${clockWords(locale, r.time)}${pulseWords(r)}`}
        title={recorded ? withNumbers(dt(locale, "bp.page.saved", { s: r.systolic ?? "", d: r.diastolic ?? "" }), shown(r)) : dt(locale, "bp.page.skipped")}
        testId="bp-today-reading"
        attrs={{ "data-id": r.id, "data-state": r.state, "data-reading": recorded ? shown(r) : "unconfirmed" }}
        actions={
          withRipple ? (
            <Acts>
              {recorded ? (
                <Act data-testid="bp-change" disabled={pending} onClick={() => openEdit(r)}>
                  {copy.change}
                </Act>
              ) : null}
              <Act data-testid="bp-delete" disabled={pending} onClick={() => void remove(r)}>
                {dt(locale, "bp.page.delete")}
              </Act>
            </Acts>
          ) : undefined
        }
      />
    );
    // next to the reading only what the doctor said (the draft's 03-2): the number he gave, his own words
    const doctor = recorded && !savedRelay ? target : null;
    // C2 track O: 「已记下（等连网）」 while it waits on this phone; 「删掉这一条」 takes it out again
    const note = (
      <OfflineNote
        locale={locale}
        tz={tz}
        removable
        onTakeOut={(id) => {
          if (!(saved.queued && saved.reading.id === id)) return;
          setStrip((s) => (s?.kind === "saved" && s.id === id ? null : s));
          setSaved(null);
          setKeypad((k) => ({ key: k.key + 1 }));
          setMode("record");
        }}
      />
    );
    // ux pass 10-12 (round 4): the reading just written is one round tick in the middle of the screen with the words
    // under it, laid out like Today's 「记好了。」. Always the plain tick, never the smiling face: nothing on this screen
    // says how a reading is. Above the doctor's warning line, and while the reading still waits on this phone, the
    // screen is as it was (an entry of a line).
    // No 「改一下」 or 「删掉」 under it any more (owner's tidy of 10-13): the undo strip takes the reading back, and later
    // today's row of the week opens the screen that changes or deletes it
    const hero = (
      <DoseHero
        kind="missed"
        testId="bp-today-reading"
        attrs={{ "data-id": r.id, "data-state": r.state, "data-reading": recorded ? shown(r) : "unconfirmed" }}
        title={recorded ? withNumbers(dt(locale, "bp.page.saved", { s: r.systolic ?? "", d: r.diastolic ?? "" }), shown(r)) : dt(locale, "bp.page.skipped")}
        sub={`${clockWords(locale, r.time)}${pulseWords(r)}`}
      />
    );
    /** the usual screen after a reading: not above the doctor's warning line, and the reading is with Ripple */
    const plain = !savedRelay && withRipple;
    // owner 10-15: outside the target his doctor set (and not above his warning line): the card, between his reading and
    // the doctor's own sentence
    const outsideCard =
      plain && outside && recorded && r.systolic !== null && r.diastolic !== null && outsideTarget(r, outside.target) ? (
        <BpOutsideTarget
          key={r.id}
          locale={locale}
          reading={{ id: r.id, systolic: r.systolic, diastolic: r.diastolic }}
          target={outside.target}
          doctor={outside.doctor}
          voice={outside.voice}
        />
      ) : null;
    savedScreen = (
      <div className="rpu-stack">
        {error ? (
          <div role="alert" data-testid="bp-failed">
            <Box variant="red" title={error} />
          </div>
        ) : null}
        <div className="rpu-stack" data-testid="bp-saved" data-kind={saved.kind} data-reading={recorded ? shown(r) : "unconfirmed"}>
          {/* above the doctor's warning line: 995 first, then his own sentence (the draft's 03-6), and his reading as
              the next entry of that same line */}
          {savedRelay ? (
            <ThresholdRelayBlock relay={savedRelay} locale={locale}>
              {withRipple ? entry : null}
            </ThresholdRelayBlock>
          ) : null}
          {savedRelay && withRipple ? null : withRipple ? (
            <>
              {hero}
              {outsideCard}
              {doctor ? <Timeline>{doctor}</Timeline> : null}
            </>
          ) : (
            // still on this phone: that it waits for a network comes right under his entry, before the doctor's words
            <>
              <Timeline>{entry}</Timeline>
              {note}
              {doctor ? <Timeline>{doctor}</Timeline> : null}
            </>
          )}
        </div>
        {withRipple ? note : null}
        {plain ? (
          // where he goes from here: the week. One more reading starts from the week's 「记一次血压」; 「再记一次」 is no
          // longer on this screen (owner's tidy of 10-13); asking is the round Ask button on every page (10-15), so the
          // screen's own 「提问」 went with the separate ask page
          <ButtonRow cols={1}>
            <SecondaryButton data-testid="bp-back" onClick={openWeek}>
              {bpc(locale, "seeWeek")}
            </SecondaryButton>
          </ButtonRow>
        ) : (
          <ButtonRow cols={2} className="rpu-ind">
            <SecondaryButton data-testid="bp-again" onClick={openRecord}>
              {dt(locale, "bp.page.next")}
            </SecondaryButton>
            <SecondaryButton data-testid="bp-back" onClick={openWeek}>
              {copy.back}
            </SecondaryButton>
          </ButtonRow>
        )}
      </div>
    );
  }

  const body = mode === "saved" && savedScreen ? savedScreen : mode === "record" ? recordScreen : weekScreen;
  const onShow = mode === "saved" && savedScreen ? "saved" : mode === "record" ? (editing ? "edit" : "record") : "week";

  return (
    <Screen
      locale={locale}
      // above the doctor's warning line no other thing stands in front of his words: no tab bar on that screen
      // (and the draft's room under its last buttons: `foot` only counts where no tab bar is fixed)
      tabBar={savedRelay ? undefined : tabBar}
      tabBarPlacement="fixed"
      sayBar={onShow === "week" ? sayBar : undefined}
      foot="plain"
      toast={
        strip ? (
          <div data-testid={strip.kind === "deleted" ? "bp-undo" : "bp-saved-undo"} key={`${strip.kind}-${strip.key}`}>
            <UndoToast
              message={strip.message}
              detail={strip.detail}
              locale={locale}
              onUndo={() => void (strip.kind === "deleted" ? putBack(strip) : takeBack(strip))}
              onExpire={() => setStrip((s) => (s && s.kind === strip.kind && s.key === strip.key ? null : s))}
            />
          </div>
        ) : null
      }
    >
      <div onClickCapture={onHeaderClick} style={{ display: "contents" }}>
        {header}
      </div>
      {/* (while the strip sits over the foot of the page the foundation's Screen keeps that much more room under it) */}
      <div data-testid="page-bp" data-scope="account" data-mode={onShow}>
        {body}
      </div>
    </Screen>
  );
}
