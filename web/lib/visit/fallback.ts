/**
 * Scripted fallback (filming mode only, web-app.md section 8): an actor may fluff a line or the
 * transcription may mishear it. With the switch on, each incoming sentence is aligned to this beat's
 * script (the replay file of the visit, built from docs/plan/visits-script.md). When it does not match the
 * next script lines, the screen shows the script line instead and the backstage feed marks it
 * "scripted fallback". The judge link can never turn this on: it needs a filming scope (the crew's filming
 * session in filming mode, or an account the crew marked as a filming account, track J) AND the crew: the switch's
 * route answers 404 to anyone without the crew's cookie or key (lib/crew/gate.ts isCrew, the one gate: real-app 5.2).
 * There is no per-session unlock any more (C2 follow-up): the switch is on for a visit only because a crew request
 * set it (lib/visit/state.ts fallbackOn), and it is applied only while the scope is a filming scope.
 *
 * Pure apart from the replay file lookup.
 */
import type { SessionRow, VisitRow } from "@/lib/store/types";
import { fixtureUtterances, replayIdForAudioFixture } from "@/lib/asr/fixtures";
import type { FixtureUtterance } from "@/lib/asr/types";
import { loadTemplate } from "@/lib/story/seed";
import { hasHan, norm } from "./text";

type FilmingFields = Pick<SessionRow, "filming_mode"> & Partial<Pick<SessionRow, "kind" | "filming">>;

/**
 * The structural precondition: a filming scope. The crew's filming session in filming mode (kind "filming"; a judge's
 * sandbox stays a sandbox even when the crew switches filming mode on), or an account the crew marked as a filming
 * account (kind "account", filming, track J). Read from the scope's kind, not from "never expires": an account never
 * expires either (real-app 5.2).
 */
export function filmingSession(session: FilmingFields): boolean {
  if (session.kind === "account") return session.filming === true;
  return session.kind === "filming" && session.filming_mode === true;
}

/**
 * C2 track J (filming): the script a visit's fallback aligns its sentences to. A visit of the story (v1, v2, p1, v3, in a
 * demo session or laid out on a filming account) has its own replay file, as before. A filming account's visit recorded
 * on the phone (a new row) takes the replay of the story's visit on the same story day: the account is laid out on the
 * story's own dates (lib/crew/filming-account.ts), so its Day 8 is the second visit. Anything else: no script (the
 * fallback then changes nothing).
 */
export function scriptFor(session: Partial<Pick<SessionRow, "kind" | "filming" | "d0">>, visit: Pick<VisitRow, "id" | "day">): FixtureUtterance[] {
  // by the visit's id for the demo and for a filming account (laid out with the story's own visits); an ordinary
  // account has no script, whatever its visit is called (real-app H6; the second fence behind fallbackAllowed)
  if (session.kind === "account" && session.filming !== true) return [];
  const own = fixtureUtterances(visit.id);
  if (own?.length) return own;
  const story = loadTemplate("mr-tan");
  if (session.kind !== "account" || session.filming !== true || session.d0 !== story.meta.d0) return [];
  const same = story.visits.find((v) => v.day === visit.day && v.audio_fixture);
  const replay = same ? replayIdForAudioFixture(same.audio_fixture) : null;
  return (replay ? fixtureUtterances(replay) : null) ?? [];
}

/**
 * The scope may use the fallback at all: a filming scope. Who may switch it is the crew alone, asked by the routes
 * (lib/crew/gate.ts isCrew); nothing is remembered per session.
 */
export function fallbackAllowed(session: FilmingFields): boolean {
  return filmingSession(session);
}

function tokens(text: string): Set<string> {
  if (hasHan(text)) {
    const chars = Array.from(norm(text));
    const out = new Set<string>();
    for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i] + chars[i + 1]);
    return out;
  }
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s']/gu, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
}

/** Jaccard overlap of words (English) or character pairs (Mandarin), 0..1. */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const x of ta) if (tb.has(x)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export const MATCH_THRESHOLD = 0.6;

export interface Alignment {
  line: FixtureUtterance;
  score: number;
  /** true = the heard text did not match; show the script line */
  fallback: boolean;
}

/**
 * Align one heard sentence to the script. Looks at the next three unused script lines (in script order);
 * the best one above MATCH_THRESHOLD is a match; otherwise the next unused line is shown as a fallback.
 * Null when the script has no unused lines left.
 */
export function alignToScript(heard: string, script: FixtureUtterance[], used: Set<string>): Alignment | null {
  const remaining = script.filter((l) => !used.has(l.id));
  if (remaining.length === 0) return null;
  const window = remaining.slice(0, 3);
  let best: Alignment | null = null;
  for (const line of window) {
    const score = similarity(heard, line.text);
    if (!best || score > best.score) best = { line, score, fallback: false };
  }
  if (best && best.score >= MATCH_THRESHOLD) return best;
  return { line: remaining[0], score: best?.score ?? 0, fallback: true };
}
