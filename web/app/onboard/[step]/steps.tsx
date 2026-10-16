"use client";

/**
 * The setting-up screens' controls (journey 01 建档; track C), laid out after the timeline draft's 01-5a to 01-5f
 * (web/progress/fe-01.md). Each screen sends one answer to POST /api/profile/onboard and goes where the answer says
 * (the next screen), or back to his profile when he opened the screen from there to change it. Only taps and short
 * typing: a field, chips for times and days, a list with 「改」. There is no summary screen at the end (owner's tidy of
 * 10-13): the answer on the last screen, the reminders, also finishes setting up and goes to Today.
 *
 * Every screen ends in the dock (the draft's `dk`): a white strip at the foot with the way on at the right (「下一步」,
 * filled) and the way past at the left (「跳过」 on the screens that ask for an answer, 「以后再说」 on the ones that
 * offer something; a screen opened from his profile has 「不改了 / 改好了」). A save that failed says so in the dock,
 * right over the buttons.
 *
 * Test hooks (all kept from the first build): onboard-next, onboard-skip, onboard-who-<by> (aria-pressed,
 * data-current), onboard-clinic, onboard-breakfast-<HH:MM> / -other / -input, onboard-reminder-at,
 * onboard-habit-<preset> / -own, onboard-day-<Mon…>, onboard-habit-time-<HH:MM>, onboard-habit-add,
 * [data-rp="habit"][data-habit], [data-action="habit-remove"], onboard-meds-photo / -later, onboard-age,
 * onboard-<step>-<choice> / -none / -own / -own-add / -own-picked, [data-rp="fact"], [data-action="fact-remove"],
 * onboard-family-invite / -later, onboard-reminders-on / -later / -next, [data-rp="reminders-result"][data-state],
 * onboard-ios-steps, onboard-install, [data-rp="form-problem"]. New with this layout: onboard-habit-new
 * (「＋ 加一项」), onboard-habit-save, onboard-habit-cancel, onboard-breakfast-change, onboard-breakfast-save,
 * onboard-meds-manual, onboard-remind-time-<HH:MM>, onboard-remind-again, onboard-remind-save.
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BodyText, Box, Button, ButtonRow, Field, ListCard, ListItem, PrimaryButton, SecondaryButton, Tag } from "@/components/ui";
import { sendJson } from "@/lib/profile/client";
import type { OnboardBy, ReminderResult } from "@/lib/profile/onboarding";
import { enablePush, type PushState } from "@/lib/push/client";
// C2 track I (only add; real-app 2.6): the iPhone's three pictured steps before any tap, and Android's 「装到主屏」
import { HomeScreenSteps } from "@/components/push/HomeScreenSteps";
import { InstallButton } from "@/components/push/InstallButton";
import { useNeedsHomeScreen } from "@/lib/push/install";
import { meCopy, onboardCopy, profileCopy, type CLocale } from "@/lib/profile/copy";
import { clockWords, weekdaysWords } from "@/lib/profile/dates";
import { setupCopy } from "@/lib/profile/setup-copy";
import { uiCopy } from "@/lib/ui/copy";
import { addMinutes, daysWords, firstSentence } from "./words";
import "./onboard.css";

type Body = Record<string, unknown>;

/** The address of the last step: it has no screen of its own any more, only the call that finishes setting up. */
const DONE_HREF = "/onboard/done";
/** Where setting up ends: Today, told that he has only just been set up (it says so once). */
const AFTER_SETUP_HREF = "/p/today?setup=done";

function useAnswer(returnTo: string | null) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function send(body: Body, go?: string) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const fail = () => {
      setBusy(false);
      setFailed(true);
    };
    const r = await sendJson<{ href: string }>("POST", "/api/profile/onboard", body);
    if (!r.ok) return fail();
    let href = go ?? returnTo ?? r.data.href;
    // The summary screen 「建好了」 is gone (owner's tidy of 10-13). Whichever way the last screen is left, the answer
    // that used to lead to it is followed by the call its button made ({ step: "done" }: without it the account is
    // not set up and he is sent back here); only once that has answered does he go on, to Today. If it fails he stays
    // and the screen says so.
    if (body.step === "done") href = AFTER_SETUP_HREF;
    else if (href === DONE_HREF) {
      const done = await sendJson("POST", "/api/profile/onboard", { step: "done" });
      if (!done.ok) return fail();
      href = AFTER_SETUP_HREF;
    }
    router.push(href);
    router.refresh();
  }
  return { send, busy, failed };
}

/** A chip: a short answer among a few; the chosen one is filled (the word says it, aria-pressed too). */
export function Chip({ on, onClick, children, testid }: { on: boolean; onClick: () => void; children: ReactNode; testid?: string }) {
  return (
    <button type="button" className="rpu-chip" data-rp="chip" aria-pressed={on} data-testid={testid} onClick={onClick}>
      {children}
    </button>
  );
}

/** A save that did not go through: one sentence in the red frame, where the buttons are. */
function Problem({ show, locale, words }: { show: boolean; locale: CLocale; words?: string }) {
  if (!show) return null;
  return (
    <div role="alert" data-rp="form-problem">
      <Box variant="red" title={words ?? onboardCopy(locale).failed} />
    </div>
  );
}

/** The dock: the white strip at the foot of a screen. */
function DockStrip({ children }: { children: ReactNode }) {
  return (
    <div className="rpu rpo-dock" data-rp="dock">
      {children}
    </div>
  );
}

/**
 * The foot of a screen that asks for an answer: 「跳过」 and the filled 「下一步」 side by side (setting up), or
 * 「不改了」 and 「改好了」 (changing it from the profile).
 */
function Dock({
  locale,
  returnTo,
  primary,
  onPrimary,
  onSkip,
  busy,
  disabled,
  failed,
}: {
  locale: CLocale;
  returnTo: string | null;
  primary: ReactNode;
  onPrimary: () => void;
  onSkip: () => void;
  busy: boolean;
  disabled?: boolean;
  failed: boolean;
}) {
  const c = onboardCopy(locale);
  return (
    <DockStrip>
      <Problem show={failed} locale={locale} />
      <ButtonRow cols={2}>
        {returnTo ? (
          <SecondaryButton href={returnTo}>{c.cancel}</SecondaryButton>
        ) : (
          <SecondaryButton onClick={onSkip} disabled={busy} data-testid="onboard-skip">
            {c.skip}
          </SecondaryButton>
        )}
        <PrimaryButton pending={busy} disabled={disabled} onClick={onPrimary} data-testid="onboard-next">
          {primary}
        </PrimaryButton>
      </ButtonRow>
    </DockStrip>
  );
}

// ---------------------------------------------------------------- who

/**
 * `current` is who is filling it in as things stand: what sign-up said (「家人帮我操作」), or what he chose here before.
 * Its row carries the filled ring and says so (aria-pressed); a tap on either row answers and goes on; 「跳过」 changes
 * nothing.
 */
export function WhoStep({ locale, current }: { locale: CLocale; current: OnboardBy }) {
  const c = onboardCopy(locale);
  const a = useAnswer(null);
  const choices: { by: OnboardBy; words: string }[] = [
    { by: "self", words: c.whoSelf },
    { by: "family", words: c.whoFamily },
  ];
  return (
    <>
      <div className="rpu rpu-opts" data-rp="options" role="group" aria-label={c.whoTitle.join("")}>
        {choices
          .sort((x, y) => Number(y.by === current) - Number(x.by === current))
          .map(({ by, words }) => (
            <button
              key={by}
              type="button"
              className="rpu-opt"
              data-rp="option"
              aria-pressed={by === current}
              data-current={by === current ? "true" : undefined}
              disabled={a.busy}
              onClick={() => void a.send({ step: "who", by })}
              data-testid={`onboard-who-${by}`}
            >
              <span className="rpu-opt-dot" aria-hidden="true" />
              <span className="rpu-opt-main">
                <span className="rpu-opt-t">{words}</span>
              </span>
            </button>
          ))}
      </div>
      <DockStrip>
        <Problem show={a.failed} locale={locale} />
        {/* every screen can be skipped: skipping this one leaves who is filling it in as it was */}
        <SecondaryButton disabled={a.busy} onClick={() => void a.send({ step: "who", by: null })} data-testid="onboard-skip">
          {c.skip}
        </SecondaryButton>
      </DockStrip>
    </>
  );
}

// ---------------------------------------------------------------- clinic (01-5a)

export function ClinicStep({ locale, initial, returnTo }: { locale: CLocale; initial: string | null; returnTo: string | null }) {
  const c = onboardCopy(locale);
  const a = useAnswer(returnTo);
  const [clinic, setClinic] = useState(initial ?? "");
  const save = () => void a.send({ step: "clinic", clinic: clinic.trim() });
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (clinic.trim()) save();
        }}
      >
        <Field id="rpc-clinic" label={c.clinicLabel} data-testid="onboard-clinic" value={clinic} placeholder={c.clinicPlaceholder} onChange={(e) => setClinic(e.target.value)} autoComplete="off" enterKeyHint="next" />
      </form>
      <Dock locale={locale} returnTo={returnTo} busy={a.busy} failed={a.failed} disabled={!clinic.trim()} primary={returnTo ? c.save : c.next} onPrimary={save} onSkip={() => void a.send({ step: "clinic", clinic: null })} />
    </>
  );
}

// ---------------------------------------------------------------- times

const BREAKFAST_TIMES = ["06:30", "07:00", "07:30", "08:00", "08:30", "09:00", "09:30", "10:00"];
const HABIT_TIMES = ["06:00", "06:30", "07:00", "07:30", "08:00", "09:00", "10:00", "16:00", "17:00", "18:00", "19:00", "20:00"];
/** The usual times of the morning's first reminder (the same ones 「我 › 早饭时间和提醒」 offers for the morning). */
const MORNING_REMINDER_TIMES = ["06:30", "07:00", "07:30", "08:00", "08:30", "08:45", "09:00", "09:30"];

/** A handful of usual times as chips, and 「别的时间」 for any other (also used by 「我 › 早饭时间和提醒」 and the medicine-add flow). */
export function TimeChips({ locale, times, value, onChange, testid }: { locale: CLocale; times: string[]; value: string | null; onChange: (t: string) => void; testid: string }) {
  const c = onboardCopy(locale);
  const [other, setOther] = useState(value !== null && !times.includes(value));
  return (
    <div className="rpu rpo-times" data-rp="time-chips">
      <div className="rpu-chips rpo-chipgrid" role="group" aria-label={c.timeLabel}>
        {times.map((t) => (
          <Chip
            key={t}
            on={value === t && !other}
            testid={`${testid}-${t}`}
            onClick={() => {
              setOther(false);
              onChange(t);
            }}
          >
            {clockWords(t, locale)}
          </Chip>
        ))}
        <Chip on={other} testid={`${testid}-other`} onClick={() => setOther(true)}>
          {c.otherTime}
        </Chip>
      </div>
      {other && (
        <input
          type="time"
          className="rpu-field-input"
          aria-label={c.timeLabel}
          data-testid={`${testid}-input`}
          value={value ?? ""}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          // flex "0 0 auto" (track F, round three): .rpu-field-input grows (flex: 1 1 11em, meant for a row); as a child
          // of a column it stretched to fill the screen
          style={{ width: "100%", flex: "0 0 auto" }}
        />
      )}
    </div>
  );
}

/** The first question of the routine: when breakfast is, and what that does to the morning reminder. */
export function BreakfastStep({ locale, initial, returnTo, helped = false }: { locale: CLocale; initial: string | null; returnTo: string | null; helped?: boolean }) {
  const c = onboardCopy(locale);
  const a = useAnswer(returnTo);
  const [time, setTime] = useState<string | null>(initial);
  return (
    <>
      <TimeChips locale={locale} times={BREAKFAST_TIMES} value={time} onChange={setTime} testid="onboard-breakfast" />
      {time && <Box variant="tint" testId="onboard-reminder-at" title={(helped ? c.breakfastLedeHelped : c.breakfastLede)(clockWords(addMinutes(time, 15), locale))} />}
      <Dock locale={locale} returnTo={returnTo} busy={a.busy} failed={a.failed} disabled={!time} primary={returnTo ? c.save : c.next} onPrimary={() => void a.send({ step: "breakfast", time })} onSkip={() => void a.send({ step: "breakfast", time: null })} />
    </>
  );
}

// ---------------------------------------------------------------- the routine as a list (01-5b)

export interface HabitEntry {
  label: string;
  label_zh?: string | null;
  days: string[];
  time: string;
}

/** A routine entry a family member wrote this round, shown as it waits for him. */
export interface WaitingEntry {
  id: string;
  title: string;
  sub: string;
  /** "HH:MM", to place it among the others (null: after them) */
  time: string | null;
  /** it is the breakfast entry */
  breakfast: boolean;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type RoutineForm = null | { mode: "add" } | { mode: "edit"; index: number } | { mode: "breakfast" };

/**
 * 01-5b: his routine as one list, earliest first: breakfast (asked on the screen before) and what he does every week,
 * each with 「改」; 「＋ 加一项」 opens the question about the week (what, which days, what time, one after the other).
 * That question is closed as the screen opens, also while nothing weekly is written yet, and closes again after
 * 「加上这件事」 or 「不加了」 (owner's tidy of 10-13). What a family member wrote this round
 * is listed with its tag and cannot be changed here: it waits for him. Breakfast is saved as soon as he changes it; the
 * weekly entries with 「下一步」, as before.
 */
export function HabitsStep({
  locale,
  initial,
  presets,
  returnTo,
  breakfast = null,
  waiting = [],
  helped = false,
}: {
  locale: CLocale;
  initial: HabitEntry[];
  presets: { label: string; label_zh: string }[];
  returnTo: string | null;
  /** his breakfast time as his settings have it */
  breakfast?: string | null;
  /** routine entries a family member wrote that wait for him */
  waiting?: WaitingEntry[];
  /** someone is helping him this round: his settings are not theirs to change */
  helped?: boolean;
}) {
  const c = onboardCopy(locale);
  const s = setupCopy(locale);
  const p = profileCopy(locale);
  const router = useRouter();
  const a = useAnswer(returnTo);
  const [habits, setHabits] = useState<HabitEntry[]>(initial);
  const [form, setForm] = useState<RoutineForm>(null);
  const [what, setWhat] = useState<{ label: string; label_zh: string | null } | null>(null);
  const [own, setOwn] = useState<string | null>(null);
  const [days, setDays] = useState<string[]>([]);
  const [time, setTime] = useState<string | null>(null);
  const [incomplete, setIncomplete] = useState(false);
  // breakfast, changed in place
  const [bf, setBf] = useState<string | null>(breakfast);
  const [bfPick, setBfPick] = useState<string | null>(breakfast);
  const [bfBusy, setBfBusy] = useState(false);
  const [bfFailed, setBfFailed] = useState(false);
  const label = (h: { label: string; label_zh?: string | null }) => (locale === "zh-Hans" ? (h.label_zh ?? h.label) : h.label);
  const when = (h: { days: "daily" | string[]; time: string }) => `${daysWords(h.days, locale)} · ${clockWords(h.time, locale)}`;

  function clearForm() {
    setWhat(null);
    setOwn(null);
    setDays([]);
    setTime(null);
    setIncomplete(false);
  }
  function openAdd() {
    clearForm();
    setForm({ mode: "add" });
  }
  function openEdit(index: number) {
    const h = habits[index];
    const preset = presets.find((x) => x.label.toLowerCase() === h.label.toLowerCase());
    setWhat(preset ?? null);
    setOwn(preset ? null : (h.label_zh ?? h.label));
    setDays(h.days);
    setTime(h.time);
    setIncomplete(false);
    setForm({ mode: "edit", index });
  }
  function close() {
    clearForm();
    setForm(null);
  }
  function save() {
    const chosen = own !== null ? (own.trim() ? { label: own.trim(), label_zh: own.trim() } : null) : what;
    if (!chosen || !days.length || !time) return setIncomplete(true);
    const entry: HabitEntry = { label: chosen.label, label_zh: chosen.label_zh, days: WEEKDAYS.filter((d) => days.includes(d)), time };
    const editing = form?.mode === "edit" ? form.index : -1;
    setHabits((hs) => {
      const kept = hs.filter((h, i) => i !== editing && h.label.toLowerCase() !== chosen.label.toLowerCase());
      return [...kept, entry];
    });
    close();
  }
  function remove(index: number) {
    setHabits((hs) => hs.filter((_, i) => i !== index));
    close();
  }
  async function saveBreakfast() {
    if (!bfPick || bfBusy) return;
    setBfBusy(true);
    setBfFailed(false);
    const r = await sendJson("POST", "/api/profile/onboard", { step: "breakfast", time: bfPick });
    setBfBusy(false);
    if (!r.ok) return setBfFailed(true);
    setBf(bfPick);
    setForm(null);
    router.refresh();
  }

  // the rows, earliest first
  type Row = { key: string; time: string | null; node: ReactNode };
  const rows: Row[] = [];
  if (!helped) {
    rows.push({
      key: "breakfast",
      time: bf,
      node: (
        <ListItem
          key="breakfast"
          title={s.breakfast}
          sub={bf ? when({ days: "daily", time: bf }) : p.notYet}
          right={uiCopy(locale).changeShort}
          rightTone="accent"
          onClick={() => {
            clearForm();
            setBfPick(bf);
            setBfFailed(false);
            setForm({ mode: "breakfast" });
          }}
          testId="onboard-breakfast-change"
          attrs={{ "data-rp": "routine-breakfast" }}
        />
      ),
    });
  } else if (bf) {
    rows.push({ key: "breakfast", time: bf, node: <ListItem key="breakfast" title={s.breakfast} sub={when({ days: "daily", time: bf })} attrs={{ "data-rp": "routine-breakfast" }} /> });
  }
  habits.forEach((h, index) =>
    rows.push({
      key: `habit-${h.label}`,
      time: h.time,
      node: <ListItem key={`habit-${h.label}`} title={label(h)} sub={when(h)} right={uiCopy(locale).changeShort} rightTone="accent" onClick={() => openEdit(index)} attrs={{ "data-rp": "habit", "data-habit": h.label }} />,
    }),
  );
  for (const w of waiting) {
    rows.push({
      key: `waiting-${w.id}`,
      time: w.time,
      node: (
        <div key={`waiting-${w.id}`} className="rpu-li" data-rp="routine-waiting" data-fact={w.id}>
          <span className="rpu-li-main">
            <span className="rpu-li-t">{w.title}</span>
            {w.sub && <span className="rpu-li-s">{w.sub}</span>}
            <Tag className="rpo-li-tag">{c.donePending}</Tag>
          </span>
        </div>
      ),
    });
  }
  rows.sort((x, y) => (x.time ?? "99:99").localeCompare(y.time ?? "99:99"));

  const editing = form?.mode === "edit";
  const picked = own !== null ? own.trim() !== "" : what !== null;
  return (
    <>
      {rows.length > 0 && <ListCard testId="onboard-routine">{rows.map((r) => r.node)}</ListCard>}

      {form === null && (
        <Button variant="link" onClick={openAdd} data-testid="onboard-habit-new">
          {s.addOne}
        </Button>
      )}

      {form?.mode === "breakfast" && (
        <div className="rpo-form" data-rp="breakfast-form">
          <p className="rpo-q">{c.breakfastTitle.join("")}</p>
          <TimeChips key={`bf-${bf ?? "none"}`} locale={locale} times={BREAKFAST_TIMES} value={bfPick} onChange={setBfPick} testid="onboard-breakfast" />
          {bfPick && <Box variant="tint" testId="onboard-reminder-at" title={c.breakfastLede(clockWords(addMinutes(bfPick, 15), locale))} />}
          <Problem show={bfFailed} locale={locale} />
          <ButtonRow cols={2}>
            <SecondaryButton disabled={bfBusy} onClick={close}>
              {c.cancel}
            </SecondaryButton>
            <SecondaryButton pending={bfBusy} disabled={!bfPick} onClick={() => void saveBreakfast()} data-testid="onboard-breakfast-save">
              {c.save}
            </SecondaryButton>
          </ButtonRow>
        </div>
      )}

      {(form?.mode === "add" || editing) && (
        <div className="rpo-form" data-rp="habit-form" data-mode={form?.mode}>
          <div className="rpo-group">
            <p className="rpo-q">{editing ? s.habitChange : c.habitsTitle.join("")}</p>
            {!editing && <p className="rpo-muted">{c.habitsLede}</p>}
          </div>
          <div className="rpo-group">
            <BodyText variant="strong">{c.habitWhat}</BodyText>
            <div className="rpu-chips rpo-chipgrid" role="group" aria-label={c.habitWhat}>
              {presets.map((x) => (
                <Chip
                  key={x.label}
                  on={own === null && what?.label === x.label}
                  testid={`onboard-habit-${x.label.toLowerCase().replace(/\s+/g, "-")}`}
                  onClick={() => {
                    setOwn(null);
                    setWhat(x);
                    setIncomplete(false);
                  }}
                >
                  {label(x)}
                </Chip>
              ))}
              <Chip
                on={own !== null}
                testid="onboard-habit-own"
                onClick={() => {
                  setWhat(null);
                  setOwn((v) => v ?? "");
                }}
              >
                {c.habitOwn}
              </Chip>
            </div>
            {own !== null && <Field id="rpc-habit-own" label={c.habitOwnLabel} value={own} onChange={(e) => setOwn(e.target.value)} autoComplete="off" maxLength={40} data-testid="onboard-habit-own-input" />}
          </div>
          {/* one question after the other: the days once he said what, the time once he said which days */}
          {(picked || days.length > 0 || editing) && (
            <div className="rpo-group">
              <BodyText variant="strong">{c.habitDays}</BodyText>
              <div className="rpu-chips rpo-chipgrid" data-cols="4" role="group" aria-label={c.habitDays}>
                {WEEKDAYS.map((d) => (
                  <Chip
                    key={d}
                    on={days.includes(d)}
                    testid={`onboard-day-${d}`}
                    onClick={() => {
                      setDays((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d]));
                      setIncomplete(false);
                    }}
                  >
                    {weekdaysWords([d], locale)}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          {(days.length > 0 || time !== null || editing) && (
            <div className="rpo-group">
              <BodyText variant="strong">{c.habitTime}</BodyText>
              <TimeChips
                key={form?.mode === "edit" ? `edit-${form.index}` : "add"}
                locale={locale}
                times={HABIT_TIMES}
                value={time}
                onChange={(t) => {
                  setTime(t);
                  setIncomplete(false);
                }}
                testid="onboard-habit-time"
              />
            </div>
          )}
          {incomplete && (
            <p role="alert" className="rpu-f-error" data-rp="habit-incomplete">
              {c.habitIncomplete}
            </p>
          )}
          <div className="rpu rpu-btns">
            <SecondaryButton onClick={save} data-testid={editing ? "onboard-habit-save" : "onboard-habit-add"}>
              {editing ? c.save : c.habitAdd}
            </SecondaryButton>
            {editing && form?.mode === "edit" && (
              <Button variant="danger-outline" onClick={() => remove(form.index)} data-action="habit-remove">
                {c.habitRemove}
              </Button>
            )}
            {/* he opened it himself, so it can always be closed again */}
            <Button variant="link" onClick={close} data-testid="onboard-habit-cancel">
              {editing ? c.cancel : s.notAdding}
            </Button>
          </div>
        </div>
      )}

      {/* opened from his profile the dock says 「不改了 / 改好了」 too: while one entry is open only that entry's own
          buttons are on the screen, so the two never stand one above the other */}
      {returnTo !== null && form !== null ? null : (
        <Dock locale={locale} returnTo={returnTo} busy={a.busy} failed={a.failed} primary={returnTo ? c.save : c.next} onPrimary={() => void a.send({ step: "habits", habits })} onSkip={() => void a.send({ step: "habits", habits: null })} />
      )}
    </>
  );
}

// ---------------------------------------------------------------- meds (01-5c), family (01-5e): an offer

/** 01-5c: two ways in (photograph the bag, type it in), or go on. */
export function MedsStep({ locale }: { locale: CLocale }) {
  const c = onboardCopy(locale);
  const s = setupCopy(locale);
  const a = useAnswer(null);
  const later = () => void a.send({ step: "meds", choice: "later" });
  return (
    <>
      <div className="rpu rpu-btns">
        <PrimaryButton pending={a.busy} onClick={() => void a.send({ step: "meds", choice: "photo" }, "/p/meds/add?from=onboard")} data-testid="onboard-meds-photo">
          {c.medsPhoto}
        </PrimaryButton>
        {/* typing it in is the same step for setting up (he went to add a medicine); the add page opens on its typing screen */}
        <SecondaryButton disabled={a.busy} onClick={() => void a.send({ step: "meds", choice: "photo" }, "/p/meds/add?from=onboard&manual=1")} data-testid="onboard-meds-manual">
          {s.medsManual}
        </SecondaryButton>
      </div>
      <DockStrip>
        <Problem show={a.failed} locale={locale} />
        <ButtonRow cols={2}>
          <SecondaryButton disabled={a.busy} onClick={later} data-testid="onboard-meds-later">
            {c.later}
          </SecondaryButton>
          <PrimaryButton pending={a.busy} onClick={later} data-testid="onboard-next">
            {c.next}
          </PrimaryButton>
        </ButtonRow>
      </DockStrip>
    </>
  );
}

/** 01-5e: invite a family member now, or go on. */
export function FamilyStep({ locale }: { locale: CLocale }) {
  const c = onboardCopy(locale);
  const a = useAnswer(null);
  const later = () => void a.send({ step: "family", choice: "later" });
  return (
    <>
      <div className="rpu rpu-btns">
        <PrimaryButton pending={a.busy} onClick={() => void a.send({ step: "family", choice: "invite" }, "/p/family")} data-testid="onboard-family-invite">
          {c.familyInvite}
        </PrimaryButton>
      </div>
      <DockStrip>
        <Problem show={a.failed} locale={locale} />
        <ButtonRow cols={2}>
          <SecondaryButton disabled={a.busy} onClick={later} data-testid="onboard-family-later">
            {c.later}
          </SecondaryButton>
          <PrimaryButton pending={a.busy} onClick={later} data-testid="onboard-next">
            {c.next}
          </PrimaryButton>
        </ButtonRow>
      </DockStrip>
    </>
  );
}

// ---------------------------------------------------------------- reminders (01-5f)

/** What 「开提醒」 came to, as the onboarding records it. */
const REMINDER_RESULT: Record<PushState, ReminderResult> = {
  on: "granted",
  denied: "denied",
  default: "dismissed",
  off: "dismissed",
  unsupported: "unsupported",
  needs_home_screen: "needs_home_screen",
  failed: "failed",
};

/**
 * 「开提醒」 (real-app 2.6; track I's lib/push/client.ts), under the line of when the reminders come (the page draws it):
 * the tap itself asks the browser, subscribes this phone and has the server send 「提醒已经开好了」 to it. On: say so and
 * go on. An iPhone outside the home screen: the three steps to put Ripple there. Refused: where to allow it, and that
 * reminders still show in the app. No push here: one plain sentence. Dismissed or failed: try again. Every outcome can
 * be left with 「下一步」 or 「以后再说」. This is the last screen: each of those ways out also finishes setting up and
 * goes to Today (useAnswer above).
 */
export function RemindersStep({ locale }: { locale: CLocale }) {
  const c = onboardCopy(locale);
  const a = useAnswer(null);
  const [state, setState] = useState<PushState | null>(null);
  const [asking, setAsking] = useState(false);
  // C2 track I (only add): an iPhone that did not open Ripple from the Home Screen sees the three steps at once
  const iphoneFirst = useNeedsHomeScreen();
  async function turnOn() {
    if (asking) return;
    setAsking(true);
    // straight from the tap: the browser asks for permission only on a tap
    const r = await enablePush({ welcome: true });
    setAsking(false);
    setState(r.state);
    if (r.state === "on") {
      await new Promise((resolve) => setTimeout(resolve, 1800));
      await a.send({ step: "reminders", result: "granted" });
    }
  }
  // what came of the tap is said under the line of times: bring it into view, clear of the dock
  const result = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (state !== null) result.current?.scrollIntoView({ block: "center" });
  }, [state]);
  const retry = state === "default" || state === "off" || state === "failed";
  // turned on, but the answer did not get through: 「下一步」 sends it again (it used to stay busy with no way on)
  const settled = state !== null && !retry && (state !== "on" || a.failed);
  const message =
    state === "on"
      ? c.remindersDone
      : state === "denied"
        ? c.remindersDenied
        : state === "default" || state === "off"
          ? c.remindersDismissed
          : state === "unsupported"
            ? c.remindersUnsupported
            : state === "failed"
              ? c.remindersFailed
              : null;
  const said = message ? firstSentence(message) : null;
  return (
    <>
      {said && (
        <div ref={(el) => void (result.current = el)} role="status" data-rp="reminders-result" data-state={state ?? undefined}>
          {/* the sentence as it always was: its first part bold, the rest under it */}
          <Box variant={state === "on" ? "tint" : "line"} title={said.title}>
            {said.rest}
          </Box>
        </div>
      )}
      {state === "needs_home_screen" && (
        <section ref={(el) => void (result.current = el)} className="rpu" role="status" data-rp="reminders-result" data-state="needs_home_screen">
          {/* C2 track I: the same three steps as 「我 › 提醒和通知」 and the manual, each with its picture */}
          <HomeScreenSteps locale={locale} lead={c.remindersHomeTitle} testId="onboard-ios-steps" />
        </section>
      )}
      {/* C2 track I (only add): the same steps before he taps anything (real-app 2.6: 先显示三步图文) */}
      {iphoneFirst && state === null && (
        <section className="rpu" data-rp="reminders-home-first">
          <HomeScreenSteps locale={locale} lead={c.remindersHomeTitle} testId="onboard-ios-steps" />
        </section>
      )}
      <DockStrip>
        <Problem show={a.failed} locale={locale} />
        {settled ? (
          <PrimaryButton pending={a.busy} onClick={() => void a.send({ step: "reminders", result: REMINDER_RESULT[state as PushState] })} data-testid="onboard-reminders-next">
            {c.next}
          </PrimaryButton>
        ) : (
          <ButtonRow cols={2}>
            <SecondaryButton disabled={a.busy || asking || state === "on"} onClick={() => void a.send({ step: "reminders", result: "later" })} data-testid="onboard-reminders-later">
              {c.later}
            </SecondaryButton>
            <PrimaryButton pending={asking || a.busy || state === "on"} onClick={() => void turnOn()} data-testid="onboard-reminders-on">
              {state === "failed" ? c.tryAgain : c.remindersOn}
            </PrimaryButton>
          </ButtonRow>
        )}
        {/* C2 track I (only add): 「装到主屏」 while Android's browser offers it */}
        <InstallButton locale={locale} disabled={a.busy || asking} testId="onboard-install" />
      </DockStrip>
    </>
  );
}

/**
 * 「改时间」 on 01-5f: the morning's first reminder, as 「我 › 早饭时间和提醒」 asks it (the same words, the same usual
 * times, the same range). The second reminder and the close follow it, so the three move together. PATCH /api/profile
 * { reminder_times: { morning } }: his own setting, so only a round he fills in himself offers it.
 */
export function ReminderTimeStep({ locale, initial, range, backHref }: { locale: CLocale; initial: string; range: { from: string; to: string }; backHref: string }) {
  const m = meCopy(locale);
  const router = useRouter();
  const [time, setTime] = useState<string | null>(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function save() {
    if (!time || busy) return;
    setBusy(true);
    setProblem(null);
    const r = await sendJson("PATCH", "/api/profile", { reminder_times: { morning: time } });
    if (!r.ok) {
      setBusy(false);
      return setProblem(r.data.error === "time_out_of_range" || r.data.error === "time_invalid" ? m.slotRange(clockWords(range.from, locale), clockWords(range.to, locale)) : m.failed);
    }
    router.push(backHref);
    router.refresh();
  }
  return (
    <>
      <TimeChips locale={locale} times={MORNING_REMINDER_TIMES} value={time} onChange={setTime} testid="onboard-remind-time" />
      {time && <Box variant="tint" testId="onboard-remind-again" title={m.slotAgain(clockWords(addMinutes(time, 30), locale))} />}
      <DockStrip>
        <Problem show={problem !== null} locale={locale} words={problem ?? undefined} />
        <ButtonRow cols={2}>
          <SecondaryButton href={backHref}>{m.cancel}</SecondaryButton>
          <PrimaryButton pending={busy} disabled={!time} onClick={() => void save()} data-testid="onboard-remind-save">
            {m.save}
          </PrimaryButton>
        </ButtonRow>
      </DockStrip>
    </>
  );
}

// ---------------------------------------------------------------- age (01-5d)

export function AgeStep({ locale, initial, returnTo }: { locale: CLocale; initial: number | null; returnTo: string | null }) {
  const c = onboardCopy(locale);
  const a = useAnswer(returnTo);
  const [age, setAge] = useState(initial ? String(initial) : "");
  const n = Number(age);
  const ok = /^\d{2,3}$/.test(age) && n >= 18 && n <= 120;
  // one digit is the start of an age, not a wrong one: say it only once the number cannot be right
  const wrong = age.length >= 2 && !ok;
  const save = () => void a.send({ step: "age", age: n });
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) save();
        }}
      >
        <Field
          id="rpc-age"
          label={c.ageLabel}
          data-testid="onboard-age"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={3}
          value={age}
          onChange={(e) => setAge(e.target.value.replace(/\D/g, ""))}
          error={wrong ? c.ageInvalid : undefined}
          autoComplete="off"
          enterKeyHint="next"
        />
      </form>
      <Dock locale={locale} returnTo={returnTo} busy={a.busy} failed={a.failed} disabled={!ok} primary={returnTo ? c.save : c.next} onPrimary={save} onSkip={() => void a.send({ step: "age", age: null })} />
    </>
  );
}

// ---------------------------------------------------------------- conditions, allergies (01-5d)

export interface Choice {
  zh: string;
  en: string;
}

export function ListStep({
  locale,
  step,
  choices,
  noneChoice,
  already,
  returnTo,
}: {
  locale: CLocale;
  step: "conditions" | "allergies";
  choices: Choice[];
  noneChoice?: Choice;
  already: { id: string; text: string; removable: boolean }[];
  returnTo: string | null;
}) {
  const c = onboardCopy(locale);
  const a = useAnswer(returnTo);
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [none, setNone] = useState(false);
  const [own, setOwn] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const words = (ch: Choice) => (locale === "zh-Hans" ? ch.zh : ch.en);
  const extra = useMemo(() => picked.filter((x) => !choices.some((ch) => ch.zh === x)), [picked, choices]);
  const toggle = (zh: string) => {
    setNone(false);
    setPicked((ps) => (ps.includes(zh) ? ps.filter((x) => x !== zh) : [...ps, zh]));
  };
  const addOwn = () => {
    const w = own.trim();
    if (!w) return;
    setNone(false);
    setPicked((ps) => (ps.includes(w) ? ps : [...ps, w]));
    setOwn("");
  };
  return (
    <>
      {already.length > 0 && (
        <ListCard heading={c.already}>
          {already.map((f) => (
            <div key={f.id} className="rpu-li" data-rp="fact">
              <span className="rpu-li-main">
                <span className="rpu-li-t">{f.text}</span>
              </span>
              {f.removable && (
                <button
                  type="button"
                  className="rpu-chip-btn rpo-li-end"
                  disabled={removing === f.id}
                  data-action="fact-remove"
                  onClick={async () => {
                    setRemoving(f.id);
                    await sendJson("PATCH", `/api/profile/facts/${encodeURIComponent(f.id)}`, { hidden: true });
                    router.refresh();
                  }}
                >
                  {c.habitRemove}
                </button>
              )}
            </div>
          ))}
        </ListCard>
      )}
      <div className="rpu rpu-chips" data-rp="chips" role="group">
        {choices.map((ch) => (
          <Chip key={ch.zh} on={picked.includes(ch.zh)} testid={`onboard-${step}-${ch.en.toLowerCase().replace(/\s+/g, "-")}`} onClick={() => toggle(ch.zh)}>
            {words(ch)}
          </Chip>
        ))}
        {extra.map((x) => (
          <Chip key={x} on testid={`onboard-${step}-own-picked`} onClick={() => toggle(x)}>
            {x}
          </Chip>
        ))}
        {noneChoice && (
          <Chip
            on={none}
            testid={`onboard-${step}-none`}
            onClick={() => {
              setPicked([]);
              setNone((v) => !v);
            }}
          >
            {words(noneChoice)}
          </Chip>
        )}
      </div>
      <form
        className="rpo-own"
        onSubmit={(e) => {
          e.preventDefault();
          addOwn();
        }}
      >
        <Field id={`rpc-own-${step}`} label={c.own} data-testid={`onboard-${step}-own`} value={own} onChange={(e) => setOwn(e.target.value)} autoComplete="off" />
        <Button variant="small" type="submit" disabled={!own.trim()} data-testid={`onboard-${step}-own-add`}>
          {c.ownAdd}
        </Button>
      </form>
      <Dock
        locale={locale}
        returnTo={returnTo}
        busy={a.busy}
        failed={a.failed}
        disabled={!picked.length && !none && !returnTo}
        primary={returnTo ? c.save : c.next}
        onPrimary={() => void a.send({ step, items: picked, ...(step === "allergies" ? { none } : {}) })}
        onSkip={() => void a.send({ step, items: null })}
      />
    </>
  );
}

// ---------------------------------------------------------------- done

/**
 * /onboard/done opened by its address (he left after the last screen's answer was saved and before setting up was
 * finished, or typed it). The summary 「建好了」 is no longer shown (owner's tidy of 10-13): the screen makes the call
 * its button made as it opens and goes to Today once that has answered. Only if the call fails is there something on
 * it: the sentence every step says, and 「再试一次」.
 */
export function DoneStep({ locale }: { locale: CLocale }) {
  const c = onboardCopy(locale);
  const a = useAnswer(null);
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void a.send({ step: "done" });
  });
  if (!a.failed) return null;
  return (
    <DockStrip>
      <Problem show locale={locale} />
      <PrimaryButton pending={a.busy} onClick={() => void a.send({ step: "done" })}>
        {c.tryAgain}
      </PrimaryButton>
    </DockStrip>
  );
}
