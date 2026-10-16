/**
 * What leaves her screen the moment he switches a section off (C2 track D, the one-second fix round; real-app 2.22
 * 「他关一项：她那边 1 秒内跟着变」). Client-safe, pure.
 *
 * Her home holds a copy of his day (lib/care/home-types.ts FamilyHomeData). When her stream says his switches changed,
 * the page does not wait for a fresh copy: `hideOff` cuts the copy it has down to what the new switches allow, at once,
 * and the fresh copy follows (her stream pushes it; lib/care/her-stream.ts). The order is the point: first nothing she
 * may no longer see, then the nice refresh of the rest. A section that went ON has nothing to show yet: its data comes
 * with the fresh copy, never from the old one.
 *
 * What depends on which switch (the same rules as lib/care/home.ts familyHome builds by):
 *   dose_summary      today's state and its timeline, the week, which medicine and what he answered in the no-reply
 *                     alert, his last record when it was a dose
 *   no_reply_alert    the alert; 「没回」 as today's state (with the dose switch still on it reads 「没有记录」)
 *   bp_summary        the count of readings, his last record when it was a reading
 *   questions_count   the count of questions and the next visit
 *   visit_transcripts, notes   the two links on her home (their pages read for themselves)
 * Hers whatever his switches: the reminder that plays, what she added to his details.
 *
 * The owner's decision of 2026-10-14 (each switch shows its kind in full while it is on) put more into the copy, and
 * every piece of it sits inside what a switch already takes away here, so it leaves with its kind:
 *   dose_summary      the reason of a dose he did not take is on the medicine's cell (CellView.reason): the cells of
 *                     today's slot, of the week and of the alert all go (with the alert left on alone its slot keeps no
 *                     cell: no name, no answer, no reason, exactly as before)
 *   bp_summary        the readings themselves are inside `bp`
 *   questions_count   the questions' words and the next visit's place are inside `questions`
 * tests/unit/care/hide.test.ts scans the whole cut copy for them.
 */
import type { FamilyGrantItems } from "@/lib/store/types";
import type { FamilyHomeData, SlotView, TimelineLine } from "./home-types";

const ALERT_KINDS = new Set<TimelineLine["kind"]>(["reminded", "reminded_again", "no_reply", "told_you"]);
const ORDER: TimelineLine["kind"][] = ["reminded", "later", "reminded_again", "taken", "missed", "no_reply", "told_you", "late_taken", "late_missed", "answered"];
const order = (k: TimelineLine["kind"]) => ORDER.indexOf(k);

/**
 * The alert's own lines, for a home where only the no-reply switch is on: the reminders (with 「没有回」), when it became
 * 「没回」 and she was told, and, once he answered after the window, a neutral 「他回了提醒」 at that time. No answer
 * lines (taken, missed, 等一下: the dose switch's) and no medicine names.
 */
export function alertTimeline(lines: readonly TimelineLine[], answeredAt: string | null): TimelineLine[] {
  const kept = lines.filter((l) => ALERT_KINDS.has(l.kind)).map((l) => ({ ...l, meds: [] }));
  if (answeredAt) kept.push({ at: answeredAt, kind: "answered", meds: [] });
  return kept.sort((a, b) => a.at.localeCompare(b.at) || order(a.kind) - order(b.kind));
}

/**
 * Her copy of his day under new switches: everything a switch that is now off was showing is gone from it. `version`:
 * which change of his switches this is (the copy carries it, so an older read cannot replace it).
 */
export function hideOff(home: FamilyHomeData, items: FamilyGrantItems, version?: number): FamilyHomeData {
  const grants: FamilyGrantItems = { ...home.grants, ...items };
  const out: FamilyHomeData = { ...home, grants, grantsVersion: version ?? home.grantsVersion, visitsShared: grants.visit_transcripts, notesShared: grants.notes };
  if (!grants.no_reply_alert) {
    out.noReply = null;
    // 「没回」 is the alert's word; with the dose switch alone that slot reads 「没有记录」 (lib/care/home.ts todayStatus)
    if (out.status?.state === "no_reply") out.status = grants.dose_summary ? { ...out.status, state: "not_logged" } : null;
    if (out.status?.state === "answered") out.status = null;
  }
  if (!grants.dose_summary) {
    out.week = null;
    const alert = out.noReply;
    if (alert) {
      // the alert stays in its own form: that there was no reply and when, never which medicine or what he answered
      // (nor why he did not take one: the reason is on the cells, and none is kept)
      const slot: SlotView = { ...alert.slot, cells: [] };
      out.noReply = { ...alert, slot, answer: null };
      out.status = alert.answeredSince ? { state: "answered", slot, at: alert.answeredAt } : { state: "no_reply", slot, at: null };
      out.timeline = alertTimeline(home.timeline, alert.answeredSince ? alert.answeredAt : null);
    } else {
      out.status = null;
      out.timeline = [];
    }
  }
  // owner, 10-14: the whole part goes, so the readings go with the count, and the questions' words and the next visit's
  // place with the number of questions
  if (!grants.bp_summary) out.bp = null;
  if (!grants.questions_count) out.questions = null;
  // scene 1 (10-15): his visit records went off while he records: the banner says only that the visit is being recorded
  if (!grants.visit_transcripts && out.liveVisit) out.liveVisit = { ...out.liveVisit, shared: false };
  if (out.lastRecord && ((out.lastRecord.what === "dose" && !grants.dose_summary) || (out.lastRecord.what === "bp" && !grants.bp_summary))) out.lastRecord = null;
  return out;
}

/** The switches that went off between two states of them. */
export function wentOff(before: FamilyGrantItems, after: FamilyGrantItems): (keyof FamilyGrantItems)[] {
  return (Object.keys(before) as (keyof FamilyGrantItems)[]).filter((k) => before[k] && !after[k]);
}
