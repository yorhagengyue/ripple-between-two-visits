/**
 * Registering Wei Ling's recorded reminder (POST /api/reminders, task M6). Server-only.
 *
 * Two checks the route makes before it stores a clip, so that a clip which cannot play never becomes "her latest
 * recording" on his phone (where it would play nothing at the reminder time) and his own device cannot register a
 * clip that then plays labelled 女儿的录音 / Wei Ling's recording:
 *
 *   reminderAudioProblem  the uploaded object is in the audio bucket, starts as a RIFF/WAVE file and holds sound
 *                         after the 44-byte header. 404 audio_not_found, 415 not_wav, 422 audio_empty; storage that
 *                         does not answer (error or READ_TIMEOUT_MS) is 503 storage_unavailable, never a silent 201.
 *   reminderAuthor        who recorded it, from the caller's identity (lib/family/identity.ts): the family role is
 *                         "wei-ling"; so is a judge's sandbox (one device plays every phone there, /f included, through
 *                         the jump menu) and a request with no role in a session nobody joined as family (scripts and
 *                         API tests that only name ?session=, until item 7's real accounts); patient, backstage and
 *                         director get 403 family_only; her phone naming a session that is not its own gets 403
 *                         patient_only and a device with no row in a session she has joined 403 member_required
 *                         (nothing is registered in either session); member rows that cannot be read are 503
 *                         role_unavailable.
 *
 * How the route uses it (app/api/reminders/route.ts, wired 10-09 wave B; the role check comes before the body):
 *   const author = await reminderAuthorFor(req, s);
 *   if (!author.ok) return author.status === 503 ? roleUnavailable() : jsonError(author.status, author.code);
 *   const problem = await reminderAudioProblem(getBlobStore(), p); if (problem) return jsonError(problem.status, problem.code);
 *   ... addReminderClip(s.id, { by: author.by, ... })
 */
import type { NextRequest } from "next/server";
import { sniffContentType, type BlobStore } from "@/lib/blob";
import type { MemberRole, SessionRow, Store } from "@/lib/store/types";
import { demoMembers } from "@/lib/subject/entry";
import { actingRole, isOutsider, type Identity } from "./identity";
import type { MembersReader } from "./member-cache";
import { MEMBER_REQUIRED, PATIENT_ONLY, requesterIdentity, ROLE_UNAVAILABLE, type RoleScope } from "./role";
import { FAMILY_MEMBER } from "./types";

/** A canonical PCM WAV header is 44 bytes; a clip with nothing after it plays nothing. */
export const WAV_HEADER_BYTES = 44;
export const READ_TIMEOUT_MS = 10_000;

export interface ReminderProblem {
  status: 404 | 415 | 422 | 503;
  code: "audio_not_found" | "not_wav" | "audio_empty" | "storage_unavailable";
}

class ReadTimeout extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ReadTimeout(`no answer from storage in ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** null when the reminder's audio is there and playable as WAV; otherwise the status and code to answer with. */
export async function reminderAudioProblem(blob: Pick<BlobStore, "getObject">, path: string, timeoutMs = READ_TIMEOUT_MS): Promise<ReminderProblem | null> {
  let obj: Awaited<ReturnType<BlobStore["getObject"]>>;
  try {
    obj = await withTimeout(blob.getObject("audio", path), timeoutMs);
  } catch (err) {
    console.warn("[reminders] could not read the uploaded clip", err instanceof ReadTimeout ? "timeout" : err instanceof Error ? err.message.slice(0, 160) : "");
    return { status: 503, code: "storage_unavailable" };
  }
  if (!obj) return { status: 404, code: "audio_not_found" };
  if (sniffContentType(obj.bytes) !== "audio/wav") return { status: 415, code: "not_wav" };
  if (obj.bytes.length <= WAV_HEADER_BYTES) return { status: 422, code: "audio_empty" };
  return null;
}

export type ReminderAuthor =
  | { ok: true; by: typeof FAMILY_MEMBER }
  | { ok: false; status: 403; code: "family_only" | typeof PATIENT_ONLY | typeof MEMBER_REQUIRED }
  | { ok: false; status: 503; code: typeof ROLE_UNAVAILABLE };

const MAY_RECORD = new Set<MemberRole | null>(["family", "judge", null]);

/** Who recorded the reminder, from the caller's role (or whole identity); only Wei Ling's side records one. Pure. */
export function reminderAuthor(who: MemberRole | null | Identity): ReminderAuthor {
  if (who !== null && typeof who === "object") {
    if (isOutsider(who)) return { ok: false, status: 403, code: who.kind === "stranger" ? MEMBER_REQUIRED : PATIENT_ONLY };
    return reminderAuthor(actingRole(who));
  }
  return MAY_RECORD.has(who) ? { ok: true, by: FAMILY_MEMBER } : { ok: false, status: 403, code: "family_only" };
}

/**
 * The author for this request. A member row that cannot be read is 503 role_unavailable (the route answers it with
 * Retry-After, like the proxy gate), never "no role", which would let the clip through as hers.
 */
export async function reminderAuthorFor(req: NextRequest, session: RoleScope, members: MembersReader = demoMembers()): Promise<ReminderAuthor> {
  // an account's clip is hers through her care link (track D); the demo's author rule does not apply to it
  if (session.kind === "account") return { ok: false, status: 403, code: "family_only" };
  let id: Identity;
  try {
    id = await requesterIdentity(req, session, members);
  } catch (err) {
    console.warn("[family/reminders] could not read the device's member row", err instanceof Error ? err.message.slice(0, 160) : "");
    return { ok: false, status: 503, code: ROLE_UNAVAILABLE };
  }
  return reminderAuthor(id);
}
