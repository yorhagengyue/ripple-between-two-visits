/**
 * Her screens' pieces, built from what the server sent (lib/care/home-types.ts): the week's marks, today's timeline,
 * the count rows, the headline. Client-safe, pure: the home, the no-reply screen and the week screen share them.
 * Shaped as the v3 draft (Ripple-Daughter-v3) by the fe-d track; the words are the ones written before it, except
 * where the draft's layout has an element there was none for.
 */
import type { DayListRow, FamilyStat, SharedItem, TimelineItem, WeekStripDay } from "@/components/family-ui";
import type { Locale } from "@/lib/i18n";
import type { DaySlot, FamilyGrantItems } from "@/lib/store/types";
import { bpLine, bpWords, dadWord, dayWord, dayWords, elderWords, grantName, headline, headlineLede, hm, markWord, missedReasonLine, questionLine, sharedHeadline, slotPart, timelineWords, weekdayLong, weekdayShort } from "./copy";
import { hc, type HerKey } from "./her-copy";
import type { FamilyHomeData, TimelineLine, WeekDayView, WeekView } from "./home-types";
import { hmIn, whenWords } from "./time";
// owner 10-15: the next visit's doctor in her language
import { doctorWords } from "@/lib/daily/visit-details";

export const herPaths = (linkId: string) => {
  const q = `link=${encodeURIComponent(linkId)}`;
  return {
    home: `/f?${q}`,
    week: `/f/week?${q}`,
    alert: `/f/alert?${q}`,
    reminder: `/f/reminder?${q}`,
    /** 「我录过的」 (E5) */
    mine: `/f/reminder/mine?${q}`,
    shared: `/f/shared?${q}`,
    /** his visit records (F3) and his notes (F5): each says so when he has not shared it (F6) */
    visits: `/f/shared/visits?${q}`,
    notes: `/f/shared/notes?${q}`,
    visit: (id: string) => `/f/shared/visit/${encodeURIComponent(id)}?${q}`,
    /** scene 1 (10-15): his visit as it is recorded */
    live: (id: string) => `/f/shared/visit/${encodeURIComponent(id)}/live?${q}`,
    me: `/f/me?${q}`,
    /** 「通知」 (G2), 「不再看爸爸的 Ripple」 (G4), 「加到主屏」, 「删除我的账号」 (G5) */
    notifications: `/f/me/notifications?${q}`,
    leave: `/f/me/leave?${q}`,
    install: `/f/me/install?${q}`,
    remove: `/f/me/delete?${q}`,
    /** her own account: a new password, the devices she signed in on, a new recovery code */
    password: `/f/me/password?${q}`,
    devices: `/f/me/devices?${q}`,
    recovery: `/f/me/recovery?${q}`,
    facts: `/f/facts?${q}`,
    phone: (back: string) => `/f/phone?${q}&back=${encodeURIComponent(back)}`,
  };
};

export type HerPaths = ReturnType<typeof herPaths>;

export function weekDays(week: WeekView, locale: Locale): WeekStripDay[] {
  return week.days.map((d) => ({
    key: d.date,
    short: weekdayShort(d.weekday, locale),
    mark: d.mark,
    isToday: d.isToday,
    label: `${weekdayLong(d.weekday, locale)} ${dayWords(d.date, locale)} ${d.mark === "pending" ? dayWord(d.mark, d.isToday, locale) : markWord(d.mark, locale)}`,
    word: dayWord(d.mark, d.isToday, locale),
  }));
}

/** 「6 天里吃了 5 天」: the days the server counted (a day counts once it has an answer, or its window closed). */
export function weekSummary(week: WeekView, locale: Locale): string {
  return week.daysDue ? hc(locale, "weekSummary", { due: week.daysDue, taken: week.daysAllTaken }) : hc(locale, "weekNone");
}

/**
 * The week screen's sentence (C1): 「这一周，6 天里吃了 5 天。」, the same count as one sentence. An earlier week
 * (`current` false) is named by its dates in the top bar, so its sentence is the count alone.
 */
export function weekHeadline(week: WeekView, locale: Locale, current = true): string {
  if (!week.daysDue) return hc(locale, "weekHeadNone");
  const summary = weekSummary(week, locale);
  return current ? hc(locale, "weekHead", { summary }) : `${summary}${locale === "zh-Hans" ? "。" : "."}`;
}

/** When he tapped, for a day whose every medicine is taken: the last tap of the day (a time only where one is kept). */
function takenAt(d: WeekDayView, tz: string): string {
  const at = d.slots.flatMap((s) => s.cells.map((c) => (c.mark === "taken" ? c.at : null))).filter((x): x is string => !!x).sort().at(-1);
  return at ? hmIn(at, tz) : "";
}

/**
 * Each day of the week as the draft's row (C1): the mark, the weekday, the date and one state at the right, with the
 * time he tapped when the day is taken (「吃了 8:52」). One state per day; no medicine names, no reason.
 */
export function dayRows(week: WeekView, locale: Locale, tz: string): DayListRow[] {
  return week.days.map((d) => {
    const word = d.mark === "none" ? hc(locale, "word_none") : dayWord(d.mark, d.isToday, locale);
    const at = d.mark === "taken" ? takenAt(d, tz) : "";
    return {
      key: d.date,
      weekday: weekdayLong(d.weekday, locale),
      date: dayWords(d.date, locale),
      mark: d.mark,
      markWords: at ? `${word} ${at}` : word,
      isToday: d.isToday,
      todayWord: hc(locale, "today"),
      lines: [],
    };
  });
}

const ANSWERS = new Set<TimelineLine["kind"]>(["taken", "missed", "late_taken", "late_missed", "answered"]);

/**
 * Today's lines as the draft's timeline. The line that matters gets the large node: the amber bell where it became
 * 「没回」 and she was told, the teal tick where he took it after all; once he answered after a no reply, every earlier
 * line drops to the quiet grey (D3). `nextAt` adds the line that has not happened yet (B2: 「9:15 还没回的话，再提醒
 * 一次」). The words of each line are lib/care/copy.ts timelineWords, with 「没有回」 after an unanswered reminder.
 * `dad`: her word for him (the English lines and the line still to come say he / she by it).
 */
export function timelineItems(lines: readonly TimelineLine[], opts: { tz: string; locale: Locale; yourVoice: boolean; herWords: string | null; nextAt?: string | null; dad?: string | null }): TimelineItem[] {
  const zh = opts.locale === "zh-Hans";
  const told = lines.findIndex((l) => l.kind === "told_you" || l.kind === "no_reply");
  const lastAnswer = lines.map((l) => ANSWERS.has(l.kind)).lastIndexOf(true);
  const calmed = told >= 0 && lastAnswer > told;
  const items: TimelineItem[] = lines.map((l, i) => {
    const warn = l.kind === "no_reply" || l.kind === "told_you" || l.kind === "missed" || l.kind === "late_missed" || !!l.unanswered;
    const past = calmed && i < lastAnswer;
    const node: TimelineItem["node"] = past ? "dot" : l.kind === "told_you" || l.kind === "no_reply" ? "no_reply" : (l.kind === "late_taken" || (l.kind === "taken" && told >= 0)) && i === lastAnswer ? "taken" : "dot";
    return {
      key: `${l.kind}-${i}`,
      kind: l.kind,
      when: hmIn(l.at, opts.tz),
      what: timelineWords(l, opts.locale, { yourVoice: opts.yourVoice, dad: opts.dad }),
      tag: l.unanswered ? (zh ? "未回应" : "no response") : undefined,
      say: l.kind === "reminded" && opts.yourVoice && opts.herWords ? `「${opts.herWords}」` : undefined,
      tone: l.kind === "later" || l.kind === "answered" ? "quiet" : warn ? "warn" : "ok",
      state: past ? "past" : "now",
      node,
      rise: calmed && i === lastAnswer,
    };
  });
  if (opts.nextAt) items.push({ key: "next", kind: "next", when: hm(opts.nextAt), what: hc(opts.locale, "nextReminder", { dad: dadWord(opts.dad, opts.locale) }), tone: "quiet", state: "future" });
  return items;
}

/** The second reminder still to come today (B2), "09:15", or null: it went out already, or nothing is being reminded. */
export function nextReminderAt(home: FamilyHomeData): string | null {
  const s = home.status;
  if (!s || s.state !== "reminding" || !s.slot || s.slot.phase !== "first") return null;
  return home.timeline.some((l) => l.kind === "reminded_again") ? null : s.slot.second;
}

/** The big sentence and the line under it, for whatever he shares. */
export function homeHeadline(home: FamilyHomeData, dad: string, locale: Locale, tz: string): { title: string; detail?: string; tone: "ok" | "chk" | "quiet" } {
  const yourVoice = home.reminder?.whose === "yours";
  if (home.status) {
    const s = home.status;
    const slot = s.slot;
    const input = { state: s.state, dad, slot: slot?.slot ?? null, at: s.at ? hmIn(s.at, tz) : null, first: slot?.first ?? null };
    const reminded = home.timeline.some((l) => l.kind === "reminded");
    const detail = headlineLede({ ...input, yourVoice, reminded, perMed: (slot?.cells ?? []).map((c) => ({ name: c.name, mark: c.mark })) }, locale) ?? undefined;
    const tone = s.state === "no_reply" || s.state === "missed" ? "chk" : s.state === "taken" ? "ok" : "quiet";
    return { title: headline(input, locale), detail, tone };
  }
  return {
    title: sharedHeadline({ dad, bp: home.bp?.count ?? null, questions: home.questions?.waiting ?? null, visits: home.visitsShared, notes: home.notesShared, noReplyOn: home.grants.no_reply_alert }, locale),
    detail: Object.values(home.grants).some(Boolean) ? undefined : (locale === "zh-Hans" ? `等${elderWords(dad, locale).he}打开以后，这里会显示。` : `Once ${elderWords(dad, locale).he} does, it shows here.`),
    tone: "quiet",
  };
}

/**
 * The quiet line under today's sentence (owner, 10-14): the reason he gave for a dose of today's slot he did not take,
 * in his words (lib/care/copy.ts missedReasonLine). null: he gave none, or his medicine is not shared (with the
 * no-reply switch on alone today's slot carries no medicine, so there is nothing to say).
 */
export function homeReason(home: FamilyHomeData, locale: Locale): string | null {
  const cells = home.status?.slot?.cells ?? [];
  return missedReasonLine(cells.filter((c) => c.mark === "missed"), locale);
}

/** How her own additions to his details stand, in a few words: 「1 条等爸爸确认」 / 「爸爸确认了」; null: she wrote none. */
export function herFactsWords(facts: FamilyHomeData["facts"] | undefined, dad: string, locale: Locale): string | null {
  if (!facts) return null;
  if (facts.waiting > 0) return hc(locale, "factsWaiting", { n: facts.waiting, dad });
  if (facts.confirmed > 0) return hc(locale, "factsConfirmed", { dad });
  return null;
}

/** How many of his questions' words her home lists under 「要问医生的」 (the copy holds a few more: lib/care/home.ts). */
export const HOME_QUESTIONS = 3;

/**
 * The rows under the week, as the draft's home: his blood pressure, his questions, the next visit. Nothing to tap. One
 * row more than the draft: how her own additions to his details stand, once she wrote one (it opens her list). His
 * visit records and notes are reached from 「爸爸让你看到的」 (F1), not from here.
 *
 * The owner's decision of 2026-10-14 (each switch shows its kind in full; these rows were counts only):
 *   blood pressure   the latest reading as the value (「142/88」), and under it when it was taken, the pulse when he
 *                    recorded one, and how many readings this week; no reading this week: 「这周还没有量」
 *   questions        the number as before, and under the row the words of the newest (HOME_QUESTIONS at most), one for
 *                    the pharmacist saying so
 *   next visit       the date as before, and under it the place when one is written
 * `tz`: his time zone, for the time of a reading.
 */
export function homeFacts(home: FamilyHomeData, locale: Locale, paths: HerPaths, dad?: string, tz = "Asia/Singapore"): FamilyStat[] {
  const out: FamilyStat[] = [];
  if (home.bp) {
    // `?? []`: a copy built before 10-14 (a server still on the older build while this one is rolled out) has the count alone
    const latest = (home.bp.readings ?? [])[0];
    if (latest) {
      const when = latest.at ? whenWords(latest.at, home.today, tz, locale) : dayPartWords(latest.date, latest.slot, home.today, locale);
      out.push({ key: "bp", label: hc(locale, "bpRow"), value: bpWords(latest), lines: [bpLine({ when, pulse: latest.pulse, count: home.bp.count }, locale)] });
    } else out.push({ key: "bp", label: hc(locale, "bpRow"), value: hc(locale, "bpNone") });
  }
  if (home.questions) {
    const words = (home.questions.items ?? []).slice(0, HOME_QUESTIONS).map((q) => questionLine(q, locale));
    out.push({ key: "questions", label: hc(locale, "qRow"), value: hc(locale, "qValue", { n: home.questions.waiting }), lines: words });
    if (home.questions.nextVisit) {
      const today = home.questions.nextVisit === home.today;
      // owner 10-15: its time before the place, and its doctor under them, when the scope has them
      const place = [home.questions.nextVisitTime, home.questions.nextVisitPlace].filter(Boolean).join("　");
      const doctor = doctorWords(home.questions.nextVisitDoctor, locale);
      out.push({ key: "next", label: hc(locale, "nextRow"), value: today ? hc(locale, "today") : hc(locale, "nextValue", { date: dayWords(home.questions.nextVisit, locale) }), lines: [place, doctor].filter((x): x is string => !!x) });
    }
  }
  const mine = herFactsWords(home.facts, dad ?? dadFallback(locale), locale);
  if (mine) out.push({ key: "facts", label: hc(locale, "factsRow"), value: mine, href: paths.facts });
  return out;
}

const dadFallback = (locale: Locale) => dadWord(null, locale);

/** A day and its part, where no time is kept: 「今天早上」 / 「昨天晚上」 / 「10月9日早上」. */
function dayPartWords(date: string, slot: DaySlot | null, today: string, locale: Locale): string {
  const zh = locale === "zh-Hans";
  const prev = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const day = date === today ? (zh ? "今天" : "today") : date === prev ? (zh ? "昨天" : "yesterday") : dayWords(date, locale);
  const part = slot ? slotPart(slot, locale).replace(/^this /, "").replace(/^at /, "") : "";
  return zh ? `${day}${part}` : `${day} ${part}`.trim();
}

/** His last entry she may know of, in words: 「昨晚 9:12」 / 「量了血压」. */
export function lastEntryWords(home: FamilyHomeData, locale: Locale, tz: string): { when: string; what: string } | undefined {
  const r = home.lastRecord;
  if (!r) return undefined;
  const zh = locale === "zh-Hans";
  const what = r.what === "bp" ? (zh ? "血压测量" : "blood pressure reading") : zh ? "服药记录" : "medicine logged";
  if (r.at) return { when: whenWords(r.at, home.today, tz, locale), what };
  return { when: dayPartWords(r.date, r.slot, home.today, locale), what };
}

/** The weekday of a date: 「周一」 / "Mon". */
export function weekdayOf(iso: string, locale: Locale): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  return weekdayLong(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay(), locale);
}

/** Someone's words as said: 「…」 on a 华语 screen (and where no language is given), “…” on an English one (10-15: 「」
 * around English words on her English day sheet). */
export function quoted(words: string, locale?: Locale): string {
  return locale === "en" ? `“${words}”` : `「${words}」`;
}

/** What changed in his switches since the last copy, for the quiet notice line (F2). */
export function grantChange(before: FamilyGrantItems, after: FamilyGrantItems): { on: (keyof FamilyGrantItems)[]; off: (keyof FamilyGrantItems)[] } {
  const keys = Object.keys(after) as (keyof FamilyGrantItems)[];
  return { on: keys.filter((k) => after[k] && !before[k]), off: keys.filter((k) => !after[k] && before[k]) };
}

/**
 * The quiet line at the top of her home, as it is shown (F2): the sentence the live page wrote when his switches
 * changed (noticeOn with the item's full name), and, when the item has a screen of its own (his visit records, his
 * notes), 「看看」 leading there.
 */
export function noticeView(notice: string | null | undefined, dad: string, locale: Locale, paths: HerPaths): { text: string; action?: { label: string; href: string } } | null {
  if (!notice) return null;
  const screens: [keyof FamilyGrantItems, string][] = [
    ["visit_transcripts", paths.visits],
    ["notes", paths.notes],
  ];
  for (const [grant, href] of screens) {
    if (notice === hc(locale, "noticeOn", { dad, what: grantName(grant, locale, dad) })) return { text: notice, action: { label: hc(locale, "noticeSee"), href } };
  }
  return { text: notice };
}

const GRANTS: (keyof FamilyGrantItems)[] = ["dose_summary", "bp_summary", "questions_count", "no_reply_alert", "visit_transcripts", "notes"];

/**
 * The six items as rows (F1, and H4's short list): the name, what exactly she sees (or would see; the invitation's
 * own lines, her-copy see_*), whether it is on.
 * His visit records and his notes open their own screens, on or off (off: the screen says he has not shared it).
 * `dad`: her word for him (「她本人写的笔记」, 「她的笔记原文」); without it 爸爸 / 他.
 */
export function sharedItems(grants: FamilyGrantItems, locale: Locale, paths: HerPaths | null, dad?: string | null): SharedItem[] {
  const word = dadWord(dad, locale);
  return GRANTS.map((k) => ({
    title: grantName(k, locale, word),
    detail: hc(locale, `see_${k}` as HerKey, { dad: word }),
    shared: !!grants[k],
    grant: k,
    href: paths && k === "visit_transcripts" ? paths.visits : paths && k === "notes" ? paths.notes : undefined,
  }));
}
