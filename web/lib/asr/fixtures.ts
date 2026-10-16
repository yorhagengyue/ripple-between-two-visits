/**
 * Replay files for SPEECH_PROVIDER=mock: web/fixtures/visits/<visit>.utterances.json (fields id,
 * t_start_ms, t_end_ms, speaker_cluster, lang, text; built from docs/plan/visits-script.md). Only the
 * utterance files are read here. The answer files next to them are for tests and must never be imported
 * by app code (tests/unit/visit/static-no-answer-files.test.ts checks this).
 *
 * Stand-in clips: web/fixtures/visits/clips/<utteranceId>.wav (synthetic voices for R1-R4 until real
 * recordings replace them). The UI labels them as stand-in recordings.
 *
 * Server-only (node:fs for the clip check).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import p1 from "@/fixtures/visits/p1.utterances.json";
import v1 from "@/fixtures/visits/v1.utterances.json";
import v2 from "@/fixtures/visits/v2.utterances.json";
import v3 from "@/fixtures/visits/v3.utterances.json";
import type { FixtureUtterance } from "./types";

const FILES: Record<string, { utterances: FixtureUtterance[] }> = { v1, v2, p1, v3 };

/**
 * A table's own entry for a name, or undefined. (A plain lookup also answers for the names every object has:
 * "constructor", "toString", "__proto__" would then pass as a replay and break the caller.)
 */
function own<T>(table: Readonly<Record<string, T>>, name: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, name) ? table[name] : undefined;
}

/** Visit ids that have a replay file. */
export const REPLAY_VISITS = Object.keys(FILES);

/**
 * The template's audio file names (timeline seed visit.audio_fixture) and the replay file that stands in for each
 * (C2, real-app 6.7 / H6): a visit replays only when its own audio_fixture names one of these, never because its id
 * happens to be "v1". An account's recorded visit has no audio_fixture and so no replay.
 */
export const AUDIO_FIXTURE_REPLAY: Readonly<Record<string, string>> = {
  "visit_A.wav": "v1",
  "visit_B.wav": "v2",
  "pharmacy_C.wav": "p1",
  "visit_D.wav": "v3",
};

/** The replay id for a visit's audio_fixture ("visit_B.wav" -> "v2"), or null. A replay id itself is accepted too. */
export function replayIdForAudioFixture(audioFixture: string | null | undefined): string | null {
  if (!audioFixture) return null;
  const name = audioFixture.trim();
  const replay = own(AUDIO_FIXTURE_REPLAY, name);
  if (replay) return replay;
  return own(FILES, name) ? name : null;
}

/** A fresh copy of the replay lines of a visit, or null when there is no file for it. */
export function fixtureUtterances(fixture: string): FixtureUtterance[] | null {
  const file = own(FILES, fixture);
  return file ? file.utterances.map((u) => ({ ...u })) : null;
}

/** web/fixtures-relative path prefix of the stand-in clips. */
export const CLIP_DIR = "visits/clips";

const CLIP_ID = /^[a-z0-9]+-u\d{2,3}$/;

/** "visits/clips/<id>.wav" when the stand-in clip file exists, else null. */
export function fixtureClipPath(utteranceId: string): string | null {
  if (!CLIP_ID.test(utteranceId)) return null;
  const rel = `${CLIP_DIR}/${utteranceId}.wav`;
  try {
    return existsSync(path.join(process.cwd(), "fixtures", rel)) ? rel : null;
  } catch {
    return null;
  }
}

/** Absolute file path of a fixture clip path ("visits/clips/v2-u08.wav"), or null when it is not one. */
export function fixtureClipFile(clipPath: string): string | null {
  const m = /^visits\/clips\/([a-z0-9]+-u\d{2,3})\.wav$/.exec(clipPath);
  if (!m) return null;
  return path.join(process.cwd(), "fixtures", "visits", "clips", `${m[1]}.wav`);
}

/** A clip path that points at a stand-in clip under web/fixtures (not a real recording). */
export function isStandInClip(clipPath: string | null | undefined): boolean {
  return !!clipPath && clipPath.startsWith(`${CLIP_DIR}/`);
}
