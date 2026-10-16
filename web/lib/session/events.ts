/**
 * `data` payloads of the bus events that sessions, the clock, the director and dose ticks publish.
 * Shared by route handlers (publish) and client components (render). Client-safe: types only.
 *
 * Every event that changes the session row carries the whole row, so a page can update its day label
 * and filming mode straight from the event without asking the server again.
 */
import type { Beat } from "./beats";
import type { MemberView } from "./members";
import type { DueDose } from "./today";
import type { DaySlot, DoseLogRow, SessionRow } from "@/lib/store/types";

export interface SessionEventData {
  session: SessionRow;
}

/** clock.changed */
export interface ClockChangedData extends SessionEventData {
  beat: Beat | null;
}

/**
 * session.member_joined: the new device's role, label and joining time (lib/session/members.ts), never its row id.
 * That id is the device's rp_member credential, and the event reaches every stream on his side (Wei Ling's filter
 * drops the type altogether, lib/family/events.ts).
 */
export interface MemberJoinedData {
  member: MemberView;
}

/** dose.logged */
export interface DoseLoggedData {
  dose: DoseLogRow;
  name: string;
  /** who caused it: a tick on a phone, the director's "no reply" cue, or the scheduled settling on an account (C2) */
  by: "patient" | "director" | "system";
}

export interface ReminderClipView {
  id: string;
  by: string;
  text: string | null;
  lang: string | null;
}

/** director.cue with cue = "reminder": every patient page shows the reminder card. */
export interface ReminderCueData {
  cue: "reminder";
  day: number;
  slot: DaySlot;
  doses: DueDose[];
  /** Wei Ling's recorded reminder, shown with the 女儿说 source tag (her own words). */
  clip: ReminderClipView | null;
}

/** director.cue with cue = "no_reply": unanswered doses are recorded as unconfirmed. */
export interface NoReplyCueData {
  cue: "no_reply";
  day: number;
  slot: DaySlot;
  /** medication ids that were marked unconfirmed (doses already answered are left alone) */
  marked: string[];
}

export type DirectorCueData = ReminderCueData | NoReplyCueData;

/** Events after which a page should re-read its server data (router.refresh). */
export const REFRESH_EVENT_TYPES = new Set<string>([
  "clock.changed",
  "session.reset",
  "session.filming_mode",
  "dose.logged",
  "bp.logged",
  "note.logged",
  "question.created",
  "question.updated",
  "med.changed",
  "visit.changed",
  "family_grant.changed",
  "reminder.clip_added",
  "session.member_joined",
  // C2 track J (filming): the director moved a filming account's clock or laid it out to a scene (lib/crew/
  // filming-account.ts): his open page reads the new moment. Only accounts publish it (a demo session never does),
  // and her stream drops it (lib/family/events.ts), so only his own phone follows.
  "account.changed",
]);

/** Events whose data carries the full session row. */
export const SESSION_ROW_EVENT_TYPES = new Set<string>(["clock.changed", "session.reset", "session.filming_mode"]);
