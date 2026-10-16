/**
 * Who is speaking while a visit is recorded (scene 1 of the owner's video, 2026-10-15): the state of one recording, kept
 * in process memory with the visit's other live state (lib/visit/state.ts visitLive; a new recording starts without
 * it). Server-only.
 *
 *   prints   each live line's voice print (lib/visit/voiceprint.ts), made by POST /api/asr/chunk from the line's audio;
 *            the audio itself is not kept
 *   voices   each line's voice, from grouping every print of the visit again when a line comes (lib/visit/speakers.ts
 *            clusterVoices, numbers kept by stableVoices), at most four
 *   votes    each line's vote from its words: the rules' at once, the model's when it answers (lib/visit/pipeline.ts
 *            labelLinesLater)
 *   lock     the chunk that stores a line and the model's answer that changes roles take turns, so a line's role is
 *            written from the latest votes and voices, never from an older copy
 *
 * The voice prints are lost when the server restarts; the lines and their roles are in the store. A recording that
 * goes on after a restart groups the voices it hears from then on (the words still vote for every line).
 */
import type { UtteranceRow } from "@/lib/store/types";
import { clusterVoices, stableVoices, type SpeakerVote } from "./speakers";
import type { SpeakerPeople } from "./speaker-words";
import { visitLive } from "./state";
import type { VoicePrint } from "./voiceprint";

export interface LiveSpeakers {
  /** line id -> its print (null: too little speech to tell a voice) */
  prints: Map<string, VoicePrint | null>;
  /** line ids in the order their audio came */
  order: string[];
  /** line id -> its voice (null: none) */
  voices: Map<string, number | null>;
  /** line id -> the vote of its words (the rules' at once, the model's when it answers) */
  votes: Map<string, SpeakerVote>;
  /** line id -> the rules' vote, kept beside the model's: what the line's own words say of their speaker */
  cues: Map<string, SpeakerVote>;
  /** lines waiting for the model's vote */
  queue: string[];
  running: Promise<void> | null;
  /** the people in the room as the model is told (read once per recording) */
  people: SpeakerPeople | null;
  /** what the model calls did (the server log and tests: codes and timings, never words) */
  calls: { ms: number; lines: number; votes: number; error: string | null }[];
  lock: Promise<void>;
}

/** The speaker state of a recording; `create` makes it when there is none. */
export function liveSpeakers(sessionId: string, visitId: string, create = false): LiveSpeakers | null {
  const live = visitLive(sessionId, visitId);
  const have = live.speakers;
  if (have || !create) return have ?? null;
  const made: LiveSpeakers = { prints: new Map(), order: [], voices: new Map(), votes: new Map(), cues: new Map(), queue: [], running: null, people: null, calls: [], lock: Promise.resolve() };
  live.speakers = made;
  return made;
}

/** Run `fn` when the recording's earlier work on its speakers is done (a failure does not block the next). */
export function withSpeakerLock<T>(sp: LiveSpeakers, fn: () => Promise<T>): Promise<T> {
  const run = sp.lock.then(fn, fn);
  sp.lock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Add the prints of new lines and group every print of the recording again (voices keep their numbers). */
export function addPrints(sp: LiveSpeakers, lines: readonly { id: string; print: VoicePrint | null }[]): void {
  for (const l of lines) {
    if (!sp.prints.has(l.id)) sp.order.push(l.id);
    sp.prints.set(l.id, l.print);
  }
  const grouped = clusterVoices(sp.order.map((id) => ({ id, print: sp.prints.get(id) ?? null })));
  sp.voices = stableVoices(sp.voices, grouped);
}

/** A line's voice as the recording knows it: from its print, else what the store has (an earlier server's). */
export function voiceOf(sp: LiveSpeakers, u: Pick<UtteranceRow, "id" | "speaker_cluster">): number | null {
  return sp.voices.has(u.id) ? (sp.voices.get(u.id) ?? null) : u.speaker_cluster;
}
