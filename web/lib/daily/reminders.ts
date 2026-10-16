/**
 * Wei Ling's recorded reminder (task M4 item 5). Server-only.
 *
 * A clip's audio is, in this order:
 *   1. her own recording in Storage (audio bucket, <session>/reminders/<file>.wav, uploaded through
 *      /api/upload-url kind "reminder" and registered with POST /api/reminders);
 *   2. the seed's file web/fixtures/reminders/<name>.wav, when it exists (it does not yet);
 *   3. for the seed clip only (same words), a synthetic stand-in voice (Windows Huihui, 16 kHz mono) kept in
 *      lib/daily/assets/wei-ling-reminder.standin.wav: the UI labels it 代录音 / stand-in recording, like the
 *      R1-R4 stand-ins. Replace it by putting her real recording at fixtures/reminders/wei_ling.wav.
 * Her words are hers (女儿说): Ripple adds nothing to them.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { blobPrefix, getBlobStore, pathInSession } from "@/lib/blob";
import { loadTemplate } from "@/lib/story/seed";
import { scopedUrl } from "@/lib/subject/url";
import type { ReminderClipRow, SessionRow, Store } from "@/lib/store/types";
import { scheduleFor } from "./doses";
import type { ReminderClipView, RemindersResponse } from "./types";

export const STAND_IN_FILE = path.join(process.cwd(), "lib", "daily", "assets", "wei-ling-reminder.standin.wav");

function fixtureFile(audioPath: string): string | null {
  if (!/^reminders\/[A-Za-z0-9._-]+\.wav$/.test(audioPath)) return null;
  const file = path.join(process.cwd(), "fixtures", audioPath);
  return existsSync(file) ? file : null;
}

/** The seed's clip words (the stand-in voice says exactly these); none for a space without the template (a blank account). */
function seedClipText(session: Pick<SessionRow, "template">, clipId: string): string | null {
  if (session.template !== "mr-tan") return null;
  const c = loadTemplate(session.template).reminder_clips.find((x) => x.id === clipId);
  return c ? (c.text_zh ?? c.text ?? null) : null;
}

type AudioSource = { kind: "blob"; path: string } | { kind: "file"; file: string; standIn: boolean } | null;

function audioSource(session: SessionRow, clip: ReminderClipRow): AudioSource {
  const p = clip.audio_path;
  if (p && pathInSession(blobPrefix(session), p)) return { kind: "blob", path: p };
  if (p) {
    const f = fixtureFile(p);
    if (f) return { kind: "file", file: f, standIn: false };
  }
  const seedText = seedClipText(session, clip.id);
  if (seedText && clip.text && seedText.trim() === clip.text.trim() && existsSync(STAND_IN_FILE)) return { kind: "file", file: STAND_IN_FILE, standIn: true };
  return null;
}

/** The clip's audio link: with ?session= for a demo session (a bare id string is one), never an account's id. */
export function reminderAudioUrl(scope: string | (Pick<SessionRow, "id"> & Partial<Pick<SessionRow, "kind">>), clipId: string): string {
  return scopedUrl(typeof scope === "string" ? { id: scope } : scope, `/api/reminders/${encodeURIComponent(clipId)}/audio`);
}

export async function remindersView(store: Store, session: SessionRow): Promise<RemindersResponse> {
  const [clips, schedule] = await Promise.all([store.listReminderClips(session.id), scheduleFor(store, session)]);
  const views: ReminderClipView[] = clips.map((c) => {
    const src = audioSource(session, c);
    return {
      id: c.id,
      by: c.by,
      text: c.text,
      lang: c.lang,
      plays_at: c.plays_at,
      audio_url: src ? reminderAudioUrl(session, c.id) : null,
      stand_in: src?.kind === "file" ? src.standIn : false,
      // C2 track B: an account's clip says whose it is (the demo's JSON is unchanged)
      ...(c.by_label ? { by_label: c.by_label } : {}),
    };
  });
  return { day: session.story_day, schedule, clips: views };
}

/** The clip's bytes for GET /api/reminders/[id]/audio, or null (no clip, or no audio for it). */
export async function reminderAudio(store: Store, session: SessionRow, clipId: string): Promise<{ bytes: Uint8Array; standIn: boolean } | null> {
  const clip = (await store.listReminderClips(session.id)).find((c) => c.id === clipId);
  if (!clip) return null;
  const src = audioSource(session, clip);
  if (!src) return null;
  if (src.kind === "blob") {
    const obj = await getBlobStore().getObject("audio", src.path);
    return obj ? { bytes: obj.bytes, standIn: false } : null;
  }
  return { bytes: new Uint8Array(await readFile(src.file)), standIn: src.standIn };
}
