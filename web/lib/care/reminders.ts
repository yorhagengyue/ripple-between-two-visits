/**
 * Her reminder recordings on a real account (C2 track D; the daughter brief E; real-app 3.10 录提醒). Server-only.
 *
 *   herReminders(store, scope, linkId, herId)    what his phone plays now and every clip she recorded (newest first),
 *                                                each with a playable link through her link
 *   registerHerClip(...)                         her new recording: the WAV she uploaded into his space, the words from
 *                                                the clip itself (lib/care/transcribe.ts) when they pass the check
 *                                                (lib/care/reminder-text.ts), else none; by her, through her link
 *   useHerClip(...)                              「换成这段」: an older clip of hers plays again (a fresh row pointing at
 *                                                the same file, so it is the newest: lib/family/clips.ts preferredClip)
 *   deleteHerClip(...)                           「删掉这段」: her clip's rows go (every row pointing at that file)
 *
 * His phone plays her newest own recording (track B's Today, components/daily/elder/HerReminder.tsx): labelled with her
 * name and 「女儿的录音」, its words under it only when they passed. The family-mode store allows these writes only for
 * her and her link (lib/subject/scoped-store.ts clipByHer, "only her own clip").
 */
import { preferredClip } from "@/lib/family/clips";
import { remindersView } from "@/lib/daily/reminders";
import type { ReminderClipRow, SessionRow, Store } from "@/lib/store/types";
import { cardText } from "./reminder-text";

export interface HerClipView {
  id: string;
  whose: "yours" | "stand_in" | "other";
  /** the words his card shows (null: only 「女儿的录音」) */
  text: string | null;
  createdAt: string;
  /** playable through her link; null when the clip has no sound */
  audioUrl: string | null;
  /** the one his phone plays now */
  current: boolean;
  /** whose name his card shows */
  byLabel: string | null;
}

export interface HerReminders {
  /** the morning's first reminder, "08:45" */
  at: string;
  current: HerClipView | null;
  /** her own recordings, newest first, one per file */
  mine: HerClipView[];
}

/** Her link appended to a clip's audio link. */
export function withLink(url: string, linkId: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}link=${encodeURIComponent(linkId)}`;
}

export async function herReminders(store: Store, scope: SessionRow, linkId: string, herId: string, firstReminder: string): Promise<HerReminders> {
  const [view, rows] = await Promise.all([remindersView(store, scope), store.listReminderClips(scope.id)]);
  const current = preferredClip(view.clips);
  const rowOf = new Map(rows.map((r) => [r.id, r]));
  const toView = (c: (typeof view.clips)[number]): HerClipView => {
    const row = rowOf.get(c.id);
    return {
      id: c.id,
      whose: c.stand_in ? "stand_in" : row?.by_user_id === herId ? "yours" : "other",
      text: c.text,
      createdAt: row?.created_at ?? "",
      audioUrl: c.audio_url ? withLink(c.audio_url, linkId) : null,
      current: current?.id === c.id,
      byLabel: c.by_label ?? null,
    };
  };
  const seen = new Set<string>();
  const mine: HerClipView[] = [];
  for (const c of [...view.clips].reverse()) {
    const row = rowOf.get(c.id);
    if (!row || row.by_user_id !== herId) continue;
    const file = row.audio_path ?? row.id;
    if (seen.has(file)) continue;
    seen.add(file);
    mine.push(toView(c));
  }
  return { at: firstReminder, current: current ? toView(current) : null, mine };
}

export interface RegisteredClip {
  clip: ReminderClipRow;
  shown: "text" | "label_only";
  why: "clinical" | "no_transcript" | null;
}

export async function registerHerClip(
  store: Pick<Store, "addReminderClip">,
  scope: Pick<SessionRow, "id">,
  input: { linkId: string; herId: string; label: string | null; audioPath: string; playsAt: string; transcript: string | null },
): Promise<RegisteredClip> {
  const card = cardText(input.transcript);
  const clip = await store.addReminderClip(scope.id, {
    by: input.linkId,
    audio_path: input.audioPath,
    plays_at: input.playsAt,
    text: card.text,
    lang: card.text ? (/[㐀-鿿]/.test(card.text) ? "zh-Hans" : "en") : null,
    by_user_id: input.herId,
    by_label: input.label,
    link_id: input.linkId,
  });
  return { clip, shown: card.text ? "text" : "label_only", why: card.why };
}

/** Her own clip, found by id; null for anyone else's. */
async function hers(store: Pick<Store, "listReminderClips">, scope: Pick<SessionRow, "id">, herId: string, clipId: string): Promise<{ row: ReminderClipRow; all: ReminderClipRow[] } | null> {
  const all = await store.listReminderClips(scope.id);
  const row = all.find((c) => c.id === clipId);
  return row && row.by_user_id === herId ? { row, all } : null;
}

export async function useHerClip(store: Pick<Store, "listReminderClips" | "addReminderClip">, scope: Pick<SessionRow, "id">, linkId: string, herId: string, clipId: string): Promise<ReminderClipRow | null> {
  const found = await hers(store, scope, herId, clipId);
  if (!found) return null;
  const r = found.row;
  return store.addReminderClip(scope.id, { by: linkId, audio_path: r.audio_path, plays_at: r.plays_at, text: r.text, lang: r.lang, by_user_id: herId, by_label: r.by_label ?? null, link_id: linkId });
}

/** Every row of hers that points at the same file. The file itself is removed by the route once no row points at it (app/api/reminders/[id]). */
export async function deleteHerClip(store: Pick<Store, "listReminderClips" | "deleteReminderClip">, scope: Pick<SessionRow, "id">, herId: string, clipId: string): Promise<number> {
  const found = await hers(store, scope, herId, clipId);
  if (!found) return 0;
  const file = found.row.audio_path;
  const rows = found.all.filter((c) => c.by_user_id === herId && (c.id === clipId || (file && c.audio_path === file)));
  for (const c of rows) await store.deleteReminderClip(scope.id, c.id);
  return rows.length;
}
