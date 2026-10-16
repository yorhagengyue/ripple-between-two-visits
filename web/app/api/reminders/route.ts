/**
 * GET /api/reminders — Wei Ling's reminder clips with a playable audio URL (her recording, or the labelled
 *   stand-in for the seed clip), and today's reminder times (first after breakfast, second, window close).
 *   Her phone naming a session that is not its own, and a device with no row in a session she has joined, get 403
 *   (lib/family/role.ts denyOutsider; the proxy gate answers first).
 * POST /api/reminders — register a recording she uploaded (POST /api/upload-url kind "reminder", then PUT):
 *   { audio_path, text?, plays_at?: "after_breakfast" | "HH:MM" }. The path must be this session's reminder file.
 *   Publishes reminder.clip_added. Returns { clip }. (M6 builds the recording screen; this is its endpoint.)
 *   Before anything is stored (lib/family/reminders.ts):
 *     who   only Wei Ling's side records (family role; a judge's sandbox, which plays every phone; a call with no
 *           role): his phone, backstage and the director get 403 family_only, so a clip of his never plays labelled
 *           女儿的录音 / Wei Ling's recording; a member row that cannot be read is 503 role_unavailable (Retry-After);
 *     file  the path is this session's reminder file (403 path_not_in_session), it was uploaded (404
 *           audio_not_found), it is WAV (415 not_wav) and holds sound after the header (422 audio_empty); storage
 *           that errors or does not answer within 10 s is 503 storage_unavailable, never a silent 201.
 *
 * Her real account (C2 track D, ?link=<her care link>):
 *   GET   lib/care/reminders.ts HerReminders: { at, current, mine } (what his phone plays, her own recordings), every
 *         audio link through her link.
 *   POST  { audio_path, plays_at? }: the same file checks, then the words come from the clip itself
 *         (lib/care/transcribe.ts: Whisper, or the developer tools' stand-in) and go on his card only when they pass
 *         the check for medicine names, numbers and doses (lib/care/reminder-text.ts); a `text` in the body is
 *         ignored (her screen has no text field: the card's words and the sound are one recording).
 *         201 { clip: HerClipView, shown: "text" | "label_only", why: null | "clinical" | "no_transcript" }.
 *   His own account: GET as before (his clips); POST 403 family_only (a clip of his never plays labelled hers).
 *   Line bind (only add): 409 link_not_acknowledged while he has not acknowledged her link (lib/care/ack.ts: she bound
 *   his account by typing it and he has not tapped 「知道了」): nothing is read, transcribed or stored. Round two: her
 *   GET answers the same way (the recording his phone plays may be another family member's voice).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { DEVFAKE_HEADER } from "@/lib/asr";
import { blobPrefix, getBlobStore, pathInSession, pathOwnedBy } from "@/lib/blob";
import { publish } from "@/lib/bus";
import { logLook } from "@/lib/care/access-log";
import { herReminders, registerHerClip } from "@/lib/care/reminders";
import { transcribeReminder } from "@/lib/care/transcribe";
import { scopeSlotSchedule } from "@/lib/daily/cells";
import { remindersView } from "@/lib/daily/reminders";
import { reminderAudioProblem, reminderAuthorFor } from "@/lib/family/reminders";
import { denyOutsider, roleUnavailable } from "@/lib/family/role";
import { detectLang } from "@/lib/safety/text";
import { jsonError, parseBody, storeErrorResponse } from "@/lib/session/http";
import { isClockTime } from "@/lib/story/clock";
import { requireSubject } from "@/lib/subject";
import { nowMs } from "@/lib/time/now";
// line bind (only add): her recording reaches his phone, so it waits for his acknowledgement of her link
import { LINK_NOT_ACKNOWLEDGED, linkAcknowledged } from "@/lib/care/ack";
import { bindEntryStore } from "@/lib/subject/bind";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clipBody = z
  .object({
    audio_path: z.string().trim().min(1).max(300),
    text: z.string().trim().max(300).optional(),
    plays_at: z
      .string()
      .refine((v) => v === "after_breakfast" || isClockTime(v), { message: "after_breakfast or HH:MM" })
      .optional(),
  })
  .strict();

export async function GET(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req, { allowFamily: true });
  if (!found.ok) return found.res;
  const denied = await denyOutsider(req, found.session);
  if (denied) return denied;
  try {
    const link = found.subject.link;
    if (found.subject.kind === "account" && found.subject.relation === "family" && link && found.subject.userId) {
      // line bind (only add, round two): what his phone plays, its words and its sound, is not hers to read before he
      // has acknowledged her link (her home leaves it out too: lib/care/home.ts)
      if (!(await linkAcknowledged(bindEntryStore(), link))) return jsonError(409, LINK_NOT_ACKNOWLEDGED);
      const first = scopeSlotSchedule(found.session, "morning").first;
      return NextResponse.json(await herReminders(found.store, found.session, link.id, found.subject.userId, first), { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(await remindersView(found.store, found.session));
  } catch (err) {
    return storeErrorResponse(err);
  }
}

/** The audio file checks every recording passes (the demo's and hers): this scope's reminder file, uploaded, WAV, sound. */
async function fileProblem(scope: Parameters<typeof blobPrefix>[0], p: string): Promise<Response | null> {
  const prefix = blobPrefix(scope);
  if (!pathInSession(prefix, p) || !p.startsWith(`${prefix}/reminders/`) || !p.endsWith(".wav")) return jsonError(403, "path_not_in_session");
  let problem: Awaited<ReturnType<typeof reminderAudioProblem>>;
  try {
    problem = await reminderAudioProblem(getBlobStore(), p);
  } catch (err) {
    console.warn("[api/reminders] storage not available", err instanceof Error ? err.message.slice(0, 160) : "");
    problem = { status: 503, code: "storage_unavailable" };
  }
  return problem ? jsonError(problem.status, problem.code) : null;
}

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req, { allowFamily: true });
  if (!found.ok) return found.res;
  const s = found.session;
  if (found.subject.kind === "account") return accountPost(req, found);
  // a member row that cannot be read comes back as 503 role_unavailable (never thrown, never "no role")
  const author = await reminderAuthorFor(req, s);
  if (!author.ok) return author.status === 503 ? roleUnavailable() : jsonError(author.status, author.code);
  const body = await parseBody(req, clipBody);
  if (!body.ok) return body.res;
  const p = body.data.audio_path;
  const problem = await fileProblem(s, p);
  if (problem) return problem;
  try {
    const text = body.data.text ?? null;
    const clip = await found.store.addReminderClip(s.id, {
      by: author.by,
      audio_path: p,
      plays_at: body.data.plays_at ?? "after_breakfast",
      text,
      lang: text ? detectLang(text) : null,
    });
    publish(s.id, "reminder.clip_added", "Wei Ling recorded a reminder", { clip });
    return NextResponse.json({ clip }, { status: 201 });
  } catch (err) {
    return storeErrorResponse(err);
  }
}

/** Her recording through her care link (C2 track D). */
async function accountPost(req: NextRequest, found: Extract<Awaited<ReturnType<typeof requireSubject>>, { ok: true }>): Promise<Response> {
  const link = found.subject.link;
  const herId = found.subject.userId;
  if (found.subject.relation !== "family" || !link || !herId) return jsonError(403, "family_only");
  // line bind (only add): a link he has not acknowledged records nothing that his phone would play
  try {
    if (!(await linkAcknowledged(bindEntryStore(), link))) return jsonError(409, LINK_NOT_ACKNOWLEDGED);
  } catch (err) {
    return storeErrorResponse(err);
  }
  const body = await parseBody(req, clipBody);
  if (!body.ok) return body.res;
  const s = found.session;
  const p = body.data.audio_path;
  // C2 track H (only add): through her link only a recording she uploaded herself (its file name starts with her tag)
  if (!pathOwnedBy(found.subject, p)) return jsonError(403, "path_not_in_session");
  const problem = await fileProblem(s, p);
  if (problem) return problem;
  try {
    const obj = await getBlobStore().getObject("audio", p);
    const heard = obj ? await transcribeReminder(obj.bytes, { devfakeFixture: req.headers.get(DEVFAKE_HEADER) }) : { text: null, source: "none" as const };
    const r = await registerHerClip(found.store, s, { linkId: link.id, herId, label: link.family_label, audioPath: p, playsAt: body.data.plays_at ?? "after_breakfast", transcript: heard.text });
    publish(s.id, "reminder.clip_added", "A family member recorded a reminder", { clip: { id: r.clip.id } });
    await logLook(found.store, s.id, { linkId: link.id, userId: herId, label: link.family_label, route: "/api/reminders", items: ["reminder"] }, nowMs());
    const view = await herReminders(found.store, s, link.id, herId, scopeSlotSchedule(s, "morning").first);
    const clip = view.mine.find((c) => c.id === r.clip.id) ?? view.current;
    return NextResponse.json({ clip, shown: r.shown, why: r.why, source: heard.source }, { status: 201 });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
