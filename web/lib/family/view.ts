/**
 * Wei Ling's view (/f, GET /api/family/view): only what Mr Tan has switched on (task M6 item 1). Server-only.
 *
 *   dose_summary       this week (Monday to the story day): on how many days he took his medicine, of the days a
 *                      dose was due; this morning's doses (live on the page). Both read one medicine list, his
 *                      medicines at this moment of the story (C2: lib/meds/on-day.ts), and while this week has no
 *                      counted day yet but a dose is being asked today, the page says so (never "no medicine due")
 *   bp_summary         this week: how many readings (a count, never the numbers or any comparison)
 *   questions_count    how many questions wait for the next visit
 *   visit_transcripts  what was said at his visits so far, word for word with who said it (off by default); "so far"
 *                      follows the story clock (10-10): a visit on the story day shows once it has happened
 *                      (lib/safety/line-state.ts visitHappened) and a recorded answer once it has been said
 *   notes              his own notes so far, word for word (off by default)
 *   no_reply_alert     handled by GET /api/family/alerts (lib/daily/alerts.ts, the FamilyAlerts card)
 *
 * A switch that is off leaves its section out of the data altogether, so nothing hidden reaches the browser. The
 * counts are lib/summary's, the same functions the visit brief (M7) uses. Nothing after the story day is read.
 *
 * Reads run side by side (STORE=supabase pays one round trip per store call): after the switches are known, every
 * switched-on section is built at once, and the visit section reads all its transcripts at once. A caller that has
 * already read the switches passes them in (GET /api/family/view reads them while it settles the reminder window).
 */
import { d0Of, routineOf, scheduleFor } from "@/lib/daily/doses";
import { answerMoment, answerVisible, type AnswerMoment } from "@/lib/daily/questions";
import { windowClosed } from "@/lib/daily/schedule";
import type { LineChip } from "@/lib/daily/types";
import { itemLineState, liveTranscript, visitHappened } from "@/lib/safety/line-state";
import { medsNow } from "@/lib/meds/on-day";
import { dueDoses } from "@/lib/session/today";
import type { FamilyGrantItems, RoleState, SessionRow, Store, UtteranceRole } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { summarizeBp } from "@/lib/summary/bp";
import { summarizeDoses } from "@/lib/summary/doses";
import { waitingQuestions } from "@/lib/summary/questions";
import { thisWeek } from "@/lib/summary/window";
import { isReplayCopy } from "@/lib/visit/happened";
import { readGrants } from "./grants";
import type { FamilyNote, FamilyViewData, FamilyVisit, FamilyVisitLine, FamilyWeek } from "./types";

function lineChip(role: UtteranceRole | null, state: RoleState, date: string, tStartMs: number | null): LineChip {
  if (role === "doctor" || role === "dispenser" || role === "pharmacist") return { kind: role, inferred: state !== "confirmed", date, tStartMs };
  if (role === "patient") return { kind: "self", date, tStartMs };
  if (role === "family") return { kind: "family", date, tStartMs };
  return { kind: "recording", date, tStartMs };
}

async function visitsSection(store: Store, session: SessionRow): Promise<FamilyVisit[]> {
  const day = session.story_day;
  const [visits, items, questions] = await Promise.all([
    store.listVisits(session.id),
    store.listVisitItems(session.id, { required_only: true }),
    store.listQuestions(session.id),
  ]);
  // (C2 track E: a replay copy is his re-watch of a visit, not another visit: never on her page)
  const upToDay = visits.filter((x) => x.day <= day && !isReplayCopy(x)).sort((a, b) => b.day - a.day);
  const utterances = await Promise.all(upToDay.map((v) => store.listUtterances(session.id, v.id)));
  const records = new Map(upToDay.map((v, i) => [v.id, liveTranscript(utterances[i])]));
  // the story moment (10-10): a visit on the story day only once it has happened, an answer only once it has been said
  const moment: AnswerMoment = { day, time: session.story_time ?? null, records };
  const shown = upToDay.filter((v) => visitHappened(v, moment, (records.get(v.id) ?? []).length > 0));
  const out: FamilyVisit[] = [];
  for (const v of shown) {
    const transcript = records.get(v.id) ?? [];
    let lines: FamilyVisitLine[];
    if (transcript.length > 0) {
      lines = transcript.map((u) => ({ id: u.id, text: u.text, lang: u.lang, chip: lineChip(u.role, u.role_state, v.date, u.t_start_ms) }));
    } else {
      // no transcript stored in this session: the lines Ripple keeps from the seed (R1-R4) and the recorded answers
      lines = [];
      for (const it of items.filter((i) => i.visit_id === v.id)) {
        const line = itemLineState(v, it, transcript);
        if (!line.said) continue;
        lines.push({ id: it.id, text: it.text, lang: "en", chip: lineChip(line.role, line.state, v.date, null) });
      }
      for (const q of questions.filter((x) => x.answer_visit_id === v.id && answerVisible(x, visits, moment))) {
        if (q.asked_at_visit_id === v.id) lines.push({ id: `${q.id}-q`, text: q.text, lang: q.lang, chip: { kind: "self", date: v.date } });
        lines.push({ id: `${q.id}-a`, text: q.answer_text!, lang: null, chip: lineChip(q.answer_speaker, q.answer_speaker ? "confirmed" : "unknown", v.date, null) });
      }
    }
    out.push({ id: v.id, day: v.day, date: v.date, place: v.place, lines });
  }
  return out;
}

export async function familyView(store: Store, session: SessionRow, opts: { grants?: FamilyGrantItems } = {}): Promise<FamilyViewData> {
  const day = session.story_day;
  const d0 = d0Of(session);
  const grants = opts.grants ?? (await readGrants(store, session)).items;
  const w = thisWeek(day, d0);
  const week: FamilyWeek = { fromDay: w.fromDay, toDay: w.toDay, fromDate: w.fromDate, toDate: w.toDate };
  const out: FamilyViewData = { day, grants, generatedAt: Date.now() };

  const dosesAndQuestions = async () => {
    if (!grants.dose_summary && !grants.questions_count) return;
    const [meds, doses, schedule, questions, visits, medsToday] = await Promise.all([
      store.listMeds(session.id),
      store.listDoses(session.id, { toDay: day }),
      scheduleFor(store, session),
      grants.questions_count ? store.listQuestions(session.id) : Promise.resolve([]),
      grants.questions_count ? store.listVisits(session.id) : Promise.resolve([]),
      // C2 track E (real-app 12 「『本周』和『今天』用同一份当天药单」): his medicines at this moment of the story
      // (lib/meds/on-day.ts: one prescribed at a visit only once that visit has happened), for both lines below
      grants.dose_summary ? medsNow(store, session) : Promise.resolve([]),
    ]);
    if (grants.dose_summary) {
      const s = summarizeDoses({
        meds: medsToday,
        doses: doses.filter((d) => d.day >= week.fromDay),
        fromDay: week.fromDay,
        toDay: week.toDay,
        storyDay: day,
        todayWindowClosed: windowClosed(day, day, session.story_time, schedule),
        d0,
        routine: routineOf(session),
      });
      out.doses = {
        week,
        daysDue: s.days.length,
        daysTaken: s.daysAllTaken,
        daysMissed: s.days.filter((x) => x.missed > 0).length,
        daysUnconfirmed: s.days.filter((x) => x.missed === 0 && x.unconfirmed > 0).length,
        today: dueDoses(
          medsToday,
          doses.filter((d) => d.day === day),
          day,
        ),
      };
    }
    if (grants.questions_count) {
      const moment = await answerMoment(store, session, visits, questions);
      out.questions = { waiting: waitingQuestions({ questions, visits, doses, meds, routine: routineOf(session), d0, day, moment, locale: "zh-Hans" }).length };
    }
  };
  const bp = async () => {
    if (!grants.bp_summary) return;
    const readings = await store.listBp(session.id, { fromDay: week.fromDay, toDay: week.toDay });
    const s = summarizeBp(readings, week.fromDay, week.toDay, null);
    out.bp = { week, count: s.count, unconfirmed: s.unconfirmed };
  };
  const visits = async () => {
    if (grants.visit_transcripts) out.visits = await visitsSection(store, session);
  };
  const notes = async () => {
    if (!grants.notes) return;
    const rows = await store.listNotes(session.id, { toDay: day });
    out.notes = rows.map<FamilyNote>((n) => ({ id: n.id, day: n.day, date: storyDate(d0, n.day), text: n.text, lang: n.lang })).reverse();
  };
  await Promise.all([dosesAndQuestions(), bp(), visits(), notes()]);
  return out;
}
