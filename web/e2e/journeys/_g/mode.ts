/**
 * The two switches of the whole-line journeys of track G (23 blank, 24 example). Both are read from the environment
 * of the command that runs the journey (node scripts/record/run.mjs ..., or npx playwright test ...), never from the
 * app server: what the server itself must be is written at the top of each journey.
 *
 *   JOURNEY_MODEL   stub (default)   the server answers with the stub model (LLM_PROVIDER=mock): every assertion is on
 *                                    the stub's exact output (which lines of a visit become items, the label's fields
 *                                    as read, the sentences of an answer)
 *                   real             the server answers with a real model (LLM_PROVIDER=hunyuan or openai, its key in
 *                                    web/.env). What a model may do differently is no longer asserted word for word:
 *                                    it may find more items in a visit than the rules do, read a label's fields in
 *                                    its own spelling, pick other candidate sentences for an answer. What the design
 *                                    requires with any model stays asserted (the doctor's own sentences, the label's
 *                                    own line, the numbers, every step's outcome in his records)
 *
 *   JOURNEY_SPEECH  standin (default)  23 only: Chromium's fake microphone (its test tone) and the journey's own
 *                                    stand-in Whisper on 127.0.0.1:7966. The server must run SPEECH_PROVIDER=whisper
 *                                    with WHISPER_URL=http://127.0.0.1:7966 and nothing listening there. This is the
 *                                    design's step 6 as written (假麦克风录音, awaiting_transcript, 假 Whisper 起来)
 *                   none             nothing is faked: no fake microphone, no stand-in service is started, and the
 *                                    server's transcription may be anything (the real Whisper service, devfake, mock).
 *                                    A browser test has no microphone and no conversation to record, so 23 then walks
 *                                    the line WITHOUT the visit and what follows from it (the design's steps 6 and 7,
 *                                    and in step 9 the doctor's target and the answered question), and says so in its
 *                                    captions. The real service's own path on an account is journey 05-whisper.
 *                                    24 needs neither: its visit is the sample replay, which reads its own file.
 *
 * A value that is none of these stops the journey before it starts: a mistyped switch must not fall back silently.
 */
function pick<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (!(allowed as readonly string[]).includes(raw)) throw new Error(`${name}=${raw}: must be one of ${allowed.join(", ")}`);
  return raw as T;
}

/** The server answers with a real model: stub-exact assertions give way to what must hold with any model. */
export const REAL_MODEL = pick("JOURNEY_MODEL", ["stub", "real"] as const, "stub") === "real";

/** The fake microphone and the journey's own stand-in Whisper are in use (journey 23). */
export const STANDIN_SPEECH = pick("JOURNEY_SPEECH", ["standin", "none"] as const, "standin") === "standin";
