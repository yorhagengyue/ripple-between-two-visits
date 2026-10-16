/**
 * Who may join a session with its code, and as which role (POST /api/session/join; M6 privacy, B1 wrap-up 10-10).
 * Server-only.
 *
 * The code is on the director's screen and the judge's landing, and Wei Ling has it because she joined with it. Anyone
 * holding it reaches the join route (the proxy gate lets a device with no row through to it: it is the way in), so the
 * route itself decides what the code can make a device:
 *
 *   family      anyone with the code: that is how Wei Ling joins, and the family role sees only what he switched on.
 *   patient     only while the session has no patient device yet. On the shoot the director opens the session and
 *               his phone joins first; a judge's sandbox has no patient row until a phone joins as him. Once his
 *               phone is in, the code cannot make another device him: 403 patient_exists. (Asking his phone to
 *               confirm a second one would need a screen on his phone; that waits for item 7's invites.)
 *   director,
 *   backstage   only with the film crew's key (lib/session/crew-key.ts: the x-ripple-crew-key header, or the rp_crew
 *               cookie that /backstage/crew or a keyed filming session leaves on the crew's browser). Both see or move
 *               everything of his. 403 crew_key_required for anyone who is not the crew (lib/crew/gate.ts: no key,
 *               a stale cookie and a wrong typed key alike; crew_key_wrong and crew_key_attempts are the sign-in
 *               door's own answers, POST /api/session/crew, never this route's).
 *   judge       never with a code: a judge's row is made with the judge's own sandbox (POST /api/session). 403
 *               role_not_joinable.
 *
 * A device that is already Wei Ling's (its row here, or in the session of its own rp_session cookie, is family; or it
 * says rp_role=family) joins as family only: 403 patient_only, the same answer the gate gives her first. Joining again
 * with the role it already has here gives the device its own row back: no new row, no session.member_joined event.
 * Member rows that cannot be read: 503 role_unavailable (never "join and hope").
 *
 * Two phones asking to be the patient at the same moment on one instance are answered one after the other (a queue per
 * session), so only the first becomes his. Across several instances (STORE=supabase) the check and the insert are two
 * steps; item 7 replaces the code with per-person invites.
 */
import type { NextRequest } from "next/server";
import { checkCrew, type CrewCheck } from "@/lib/session/crew-key";
import { MEMBER_COOKIE, ROLE_COOKIE, SESSION_COOKIE } from "@/lib/session/cookies";
import { joinSession } from "@/lib/session/ops";
import type { JoinSessionBody } from "@/lib/session/schemas";
import type { MemberRole, SessionMemberRow, SessionRow } from "@/lib/store/types";
import { demoMembers, type DemoEntryStore } from "@/lib/subject/entry";
import { directoryFor } from "./member-cache";
import { PATIENT_ONLY, ROLE_UNAVAILABLE } from "./role";

export const PATIENT_EXISTS = "patient_exists";
export const ROLE_NOT_JOINABLE = "role_not_joinable";

export interface JoinRefusal {
  status: 403 | 429;
  code: string;
  detail: string;
}

/** What the device presents (its cookies), read from the join request. */
export interface JoinDevice {
  /** rp_session cookie: the session it is in now */
  cookieSession: string | null;
  /** rp_member cookie: its row there */
  memberId: string | null;
  /** rp_role cookie */
  cookieRole: string | null;
}

export interface JoinFacts {
  /** the role the body asks for */
  role: MemberRole;
  /** the code's session's rows, read now */
  members: readonly SessionMemberRow[];
  /** the device's own row in the code's session (its rp_member), if any */
  ownRow: SessionMemberRow | null;
  /** the device is already Wei Ling's: its row here or in its own session is family, or rp_role=family */
  deviceIsFamily: boolean;
  /**
   * the crew key check, for director and backstage. Asked only when the rule needs it, so a key typed with another
   * role is never judged or counted; its count is rows of the store, so the answer is awaited
   */
  crew: () => Promise<CrewCheck>;
}

const DETAIL = {
  family: "Wei Ling's phone joins as family only.",
  patient: "Mr Tan's phone has already joined this session. The code cannot add another phone as him.",
  judge: "A judge's own sandbox is opened from the link, not joined with a code.",
  crew: "Joining as the director or backstage needs the film crew's key (Crew sign-in, /backstage/crew).",
} as const;

/** null when the device may join as `facts.role`; otherwise why not. Pure, apart from the crew key's wrong-key count. */
export async function joinRefusal(facts: JoinFacts): Promise<JoinRefusal | null> {
  const { role } = facts;
  if (facts.deviceIsFamily && role !== "family") return { status: 403, code: PATIENT_ONLY, detail: DETAIL.family };
  if (facts.ownRow && facts.ownRow.role === role) return null; // the same device again, as what it already is here
  switch (role) {
    case "family":
      return null;
    case "patient":
      return facts.members.some((m) => m.role === "patient") ? { status: 403, code: PATIENT_EXISTS, detail: DETAIL.patient } : null;
    case "judge":
      return { status: 403, code: ROLE_NOT_JOINABLE, detail: DETAIL.judge };
    case "director":
    case "backstage": {
      const crew = await facts.crew();
      return crew.ok ? null : { status: crew.status, code: crew.error, detail: DETAIL.crew };
    }
  }
}

// ------------------------------------------------------------------ one patient at a time, per session

const g = globalThis as unknown as { __rippleJoinQueues?: Map<string, Promise<void>> };

/** Run `fn` after every earlier call for the same key has finished (this instance only). */
export async function oneAtATime<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const queues = (g.__rippleJoinQueues ??= new Map());
  const before = queues.get(key) ?? Promise.resolve();
  const run = before.then(fn, fn);
  const done = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, done);
  void done.then(() => {
    if (queues.get(key) === done) queues.delete(key);
  });
  return run;
}

// ------------------------------------------------------------------ the route's use

export type JoinOutcome =
  | { ok: true; session: SessionRow; member: SessionMemberRow; reused: boolean }
  | { ok: false; status: 404; code: "join_code_not_found" }
  | ({ ok: false } & JoinRefusal)
  | { ok: false; status: 503; code: typeof ROLE_UNAVAILABLE };

const clean = (x: string | undefined | null): string | null => {
  const v = x?.trim();
  return v ? v : null;
};

export function joinDevice(req: Pick<NextRequest, "cookies">): JoinDevice {
  return {
    cookieSession: clean(req.cookies.get(SESSION_COOKIE)?.value),
    memberId: clean(req.cookies.get(MEMBER_COOKIE)?.value),
    cookieRole: clean(req.cookies.get(ROLE_COOKIE)?.value),
  };
}

/**
 * Join with the code under the rules above: the existing row back, a new row (lib/session/ops.ts joinSession, which
 * publishes session.member_joined), or the refusal. A patient join is checked and written inside the session's queue.
 */
/** `store`: the demo's way in (lib/subject/entry.ts): demo sessions only, so a code can never lead into an account. */
export async function joinWithCode(req: NextRequest, body: JoinSessionBody, store: DemoEntryStore = demoMembers()): Promise<JoinOutcome> {
  const session = await store.getSessionByJoinCode(body.code);
  if (!session) return { ok: false, status: 404, code: "join_code_not_found" };
  const device = joinDevice(req);
  const attempt = async (): Promise<JoinOutcome> => {
    let members: SessionMemberRow[];
    let homeRole: MemberRole | null = null;
    try {
      members = await store.listMembers(session.id);
      if (device.memberId && device.cookieSession && device.cookieSession !== session.id) {
        homeRole = await directoryFor(store).role(device.cookieSession, device.memberId);
      }
    } catch (err) {
      console.warn("[family/join] could not read the member rows", err instanceof Error ? err.message.slice(0, 160) : "");
      return { ok: false, status: 503, code: ROLE_UNAVAILABLE };
    }
    const ownRow = device.memberId ? (members.find((m) => m.id === device.memberId) ?? null) : null;
    const refusal = await joinRefusal({
      role: body.role,
      members,
      ownRow,
      deviceIsFamily: ownRow?.role === "family" || homeRole === "family" || device.cookieRole === "family",
      crew: () => checkCrew(req, null),
    });
    if (refusal) return { ok: false, ...refusal };
    if (ownRow && ownRow.role === body.role) return { ok: true, session, member: ownRow, reused: true };
    const joined = await joinSession(store, body);
    if (!joined) return { ok: false, status: 404, code: "join_code_not_found" };
    return { ok: true, session: joined.session, member: joined.member, reused: false };
  };
  return body.role === "patient" ? oneAtATime(`patient:${session.id}`, attempt) : attempt();
}
