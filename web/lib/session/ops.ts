/**
 * Session operations behind the M0 routes: write through the Store, then publish one bus event per
 * change (the store never publishes; see lib/store/types.ts). Route handlers stay thin and these
 * functions are unit-tested directly. Server-only.
 *
 * `say` sentences are short English for the backstage feed.
 *
 * Every function takes the store it may use: the subject's scoped store for a session's own operations
 * (lib/subject requireSubject), the demo's way in for creating and joining (lib/subject/entry.ts demoEntryStore).
 */
import { removeSessionBlobs } from "@/lib/blob";
import { getBus, publish } from "@/lib/bus";
import { remindersView } from "@/lib/daily/reminders";
import { preferredClip } from "@/lib/family/clips";
import { StoreError, type DaySlot, type DemoSessionRow, type DoseLogRow, type SessionMemberRow, type SessionRow, type Store } from "@/lib/store";
import { storyDayLabel } from "@/lib/story/clock";
import { scopeD0 } from "@/lib/store/scope";
import { findBeat, nextBeat, prevBeat, type Beat } from "./beats";
import { SANDBOX_TTL_HOURS } from "./cookies";
import { memberView } from "./members";
import type {
  ClockChangedData,
  DoseLoggedData,
  MemberJoinedData,
  NoReplyCueData,
  ReminderCueData,
  SessionEventData,
} from "./events";
import type { ClockBody, CreateSessionBody, DoseBody, JoinSessionBody } from "./schemas";
import { DOSE_SLOT, dueDoses, medName } from "./today";

function dayLabel(session: SessionRow): string {
  return storyDayLabel({
    d0: scopeD0(session),
    day: session.story_day,
    time: session.story_time,
    locale: "en",
  });
}

// ------------------------------------------------------------------ sessions

export async function createSessionWithMember(
  store: Pick<Store, "createSession" | "addMember">,
  body: CreateSessionBody,
): Promise<{ session: DemoSessionRow; member: SessionMemberRow }> {
  const filming = body.kind === "filming";
  const session = await store.createSession({
    kind: filming ? "filming" : "sandbox",
    story_day: body.story_day,
    story_time: body.story_time,
    filming_mode: body.filming_mode ?? false,
    ttl_hours: filming ? null : SANDBOX_TTL_HOURS,
  });
  const member = await store.addMember(session.id, {
    role: body.role ?? (filming ? "director" : "judge"),
    device_label: body.device_label ?? null,
  });
  return { session, member };
}

export async function joinSession(
  store: Pick<Store, "getSessionByJoinCode" | "addMember">,
  body: JoinSessionBody,
): Promise<{ session: SessionRow; member: SessionMemberRow } | null> {
  const session = await store.getSessionByJoinCode(body.code);
  if (!session) return null;
  const member = await store.addMember(session.id, { role: body.role, device_label: body.device_label ?? null });
  // every stream on his side gets this event: the row without its id, which is the new device's rp_member credential
  // (the device itself gets the whole row from the join route, with its cookies)
  publish<MemberJoinedData>(session.id, "session.member_joined", `A ${member.role} device joined`, { member: memberView(member) });
  return { session, member };
}

/** Landing page for each role after /join. */
export function homeForRole(role: string): string {
  switch (role) {
    case "patient":
      return "/p/today";
    case "family":
      return "/f";
    case "backstage":
      return "/backstage";
    case "director":
      return "/director";
    default:
      return "/";
  }
}

/**
 * Back to the template timeline. The event history is dropped too, so backstage starts clean, and the
 * session's recordings and label photos are deleted (spec section 3). A storage failure is logged and
 * never fails the reset.
 */
export async function resetSession(store: Pick<Store, "resetSession">, sessionId: string): Promise<SessionRow> {
  const session = await store.resetSession(sessionId);
  try {
    // a reset is the demo's alone (the store refuses an account first): a demo session's files live under its id
    await removeSessionBlobs(sessionId);
  } catch (err) {
    console.warn(`[reset] could not delete stored files of the session: ${(err as Error).message}`);
  }
  getBus().clearHistory(sessionId);
  publish<SessionEventData>(sessionId, "session.reset", `Session reset to the template timeline (${dayLabel(session)})`, {
    session,
  });
  return session;
}

// ------------------------------------------------------------------ clock

export class ClockError extends Error {
  constructor(readonly code: "unknown_beat" | "end_of_story" | "start_of_story") {
    super(code);
    this.name = "ClockError";
  }
}

export async function moveClock(store: Pick<Store, "setStoryDay">, session: SessionRow, body: ClockBody): Promise<{ session: SessionRow; beat: Beat | null }> {
  let day: number;
  let time: string | null | undefined;
  let beat: Beat | null = null;
  if (body.beat !== undefined) {
    if (body.beat === "next") beat = nextBeat(session.story_day, session.story_time);
    else if (body.beat === "prev") beat = prevBeat(session.story_day, session.story_time);
    else beat = findBeat(body.beat);
    if (!beat) {
      throw new ClockError(body.beat === "next" ? "end_of_story" : body.beat === "prev" ? "start_of_story" : "unknown_beat");
    }
    day = beat.day;
    time = beat.time;
  } else {
    day = body.day!;
    // A plain day jump without a time clears the time, so the label never shows a stale hour.
    time = body.time === undefined ? null : body.time;
  }
  const updated = await store.setStoryDay(session.id, day, time);
  const say = beat ? `Story clock → ${dayLabel(updated)}: ${beat.title}` : `Story clock → ${dayLabel(updated)}`;
  publish<ClockChangedData>(session.id, "clock.changed", say, { session: updated, beat });
  return { session: updated, beat };
}

// ------------------------------------------------------------------ director

export async function setFilming(store: Pick<Store, "setFilmingMode">, session: SessionRow, on: boolean): Promise<SessionRow> {
  const updated = await store.setFilmingMode(session.id, on);
  publish<SessionEventData>(session.id, "session.filming_mode", on ? "Filming mode on" : "Filming mode off", {
    session: updated,
  });
  return updated;
}

export async function cueReminder(store: Store, session: SessionRow, slot: DaySlot = DOSE_SLOT): Promise<ReminderCueData> {
  const day = session.story_day;
  const [meds, doses, clips] = await Promise.all([
    store.listMeds(session.id),
    store.listDoses(session.id, { fromDay: day, toDay: day }),
    store.listReminderClips(session.id),
  ]);
  const due = dueDoses(meds, doses, day).filter((d) => d.slot === slot);
  // C2 track E (real-app 12 「卡上的字和放的录音来自同一条 reminder_clip」): the clip the phones play is her newest own
  // recording, else the story's stand-in (lib/family/clips.ts preferredClip, the player's own rule), so the card's words
  // are that clip's words (none when she recorded without typing any), never another clip's
  const playing = preferredClip((await remindersView(store, session)).clips);
  const clip = (playing ? clips.find((c) => c.id === playing.id) : null) ?? null;
  const data: ReminderCueData = {
    cue: "reminder",
    day,
    slot,
    doses: due,
    clip: clip ? { id: clip.id, by: clip.by, text: clip.text, lang: clip.lang } : null,
  };
  const what = due.length ? due.map((d) => d.name).join(", ") : "no medicine due";
  publish<ReminderCueData>(session.id, "director.cue", `Director: reminder now (${slot}, ${what})`, data);
  return data;
}

export async function cueNoReply(store: Store, session: SessionRow, slot: DaySlot = DOSE_SLOT): Promise<NoReplyCueData> {
  const day = session.story_day;
  const [meds, doses] = await Promise.all([
    store.listMeds(session.id),
    store.listDoses(session.id, { fromDay: day, toDay: day }),
  ]);
  const unanswered = dueDoses(meds, doses, day).filter((d) => d.slot === slot && (d.state === null || d.state === "unconfirmed"));
  const marked: string[] = [];
  for (const d of unanswered) {
    const dose = await store.logDose(session.id, {
      medication_id: d.medication_id,
      day,
      slot,
      state: "unconfirmed",
      reason: "no_reply",
    });
    marked.push(d.medication_id);
    publish<DoseLoggedData>(session.id, "dose.logged", `No reply: ${d.name} (${slot}) recorded as not confirmed`, {
      dose,
      name: d.name,
      by: "director",
    });
  }
  const data: NoReplyCueData = { cue: "no_reply", day, slot, marked };
  publish<NoReplyCueData>(
    session.id,
    "director.cue",
    marked.length ? `Director: simulate no reply (${marked.length} dose marked not confirmed)` : "Director: simulate no reply (nothing unanswered)",
    data,
  );
  return data;
}

// ------------------------------------------------------------------ doses

export async function tickDose(store: Store, session: SessionRow, body: DoseBody): Promise<DoseLogRow> {
  const med = await store.getMed(session.id, body.medication_id);
  if (!med) throw new StoreError("not_found", `No medication ${body.medication_id}`);
  const day = body.day ?? session.story_day;
  const dose = await store.logDose(session.id, {
    medication_id: med.id,
    day,
    slot: body.slot,
    state: body.state,
    reason: body.reason ?? null,
    reason_text: body.reason_text ?? null,
  });
  const name = medName(med);
  const words = { taken: "taken", missed: "not taken", unconfirmed: "later (not confirmed yet)" }[body.state];
  publish<DoseLoggedData>(session.id, "dose.logged", `Mr Tan ticked ${words}: ${name}, Day ${day} ${body.slot}`, {
    dose,
    name,
    by: "patient",
  });
  return dose;
}
