/**
 * Who is speaking, from the voice and the words together (scene 1 of the owner's video, 2026-10-15: the doctor, Mr Tan
 * and his daughter speak in the doctor's room; his phone records; both phones show who said each line). Pure;
 * client-safe. The live wiring is lib/visit/live-speakers.ts.
 *
 * The voice (lib/visit/voiceprint.ts): each line of a recording has a print of its voice. clusterVoices groups the
 * prints of a visit into voices: agglomerative clustering with average linkage, merging while two groups are closer
 * than JOIN_DISTANCE on average, and then the closest groups until there are at most MAX_VOICES. Only a print that rests
 * on enough speech (STRONG_SPEECH_MS) shapes the groups; a weak one joins the nearest group when it is close enough and
 * otherwise stays without a voice, as does a line with no print at all. The whole visit is grouped again each time a
 * line comes (a visit has tens of lines, not thousands), and the groups keep their numbers from one grouping to the next
 * (stableVoices): a group keeps the number most of its lines had, so a line's voice changes only when the grouping
 * itself changed its mind.
 *
 * The words: for each line, a vote for who said it, "doctor", "patient" or "family" (or "unknown"), with how sure it is
 * (0..1). The model's vote (lib/visit/speaker-words.ts), or until it comes, and offline, the fixed rules' (ruleVote).
 * The rules' vote is also kept beside the model's as the line's cue: what its own words say of their speaker (an address
 * such as "Dad," or "Mr Tan,", "my father", 医生，...).
 *
 * combineRoles, the rule:
 *   a voice's role       the role most of its lines were named, weighted by how sure each vote is (a model vote counts
 *                        in full, a rules vote at RULE_WEIGHT). The voice is settled once at least two of its lines
 *                        name the leading role and it has at least SETTLED_SHARE of the weight; until then the leading
 *                        role is only the voice's guess (unsettled): one line named "patient" and another "family" is
 *                        not yet anybody's voice
 *   a line's role        its voice's role once the voice is settled, unless the line is very clearly someone else's:
 *                        the model names another speaker at least CLEAR_VOTE sure AND the line's own words point there
 *                        too (its cue). A model alone is not enough: in the first live run (10-15) it was 0.9 sure that
 *                        a short "Yes, doctor." after "Your daughter came with you today" was the patient's, while the
 *                        voice was rightly the daughter's. While the voice is not settled: its own vote when that is at
 *                        least FAIR_VOTE sure, else the voice's guess, else its cue when that is FAIR_VOTE sure (a short
 *                        line in Mandarin that the model would not name, in a voice of its own); else nobody (unknown)
 *   always               a line he confirmed in the review keeps its role (confirmed lines never move); every role this
 *                        gives is "inferred" (or "unknown"), never "confirmed": only his own check in the review
 *                        confirms a speaker. The clinician is the pharmacist at a pharmacy, the doctor anywhere else.
 */
import type { RoleState, UtteranceRole } from "@/lib/store/types";
import { STRONG_SPEECH_MS, voiceDistance, type VoicePrint } from "./voiceprint";

/** The people of a visit the words can name. */
export type SpeakerVoteRole = "doctor" | "patient" | "family";

export interface SpeakerVote {
  role: SpeakerVoteRole | "unknown";
  /** 0..1 */
  sure: number;
  /** who voted: the model, or the fixed rules (a stand-in until the model answers, and the only vote offline) */
  by: "model" | "rules";
}

/** Groups closer than this on average are one voice (lib/visit/voiceprint.ts voiceDistance's scale). */
export const JOIN_DISTANCE = 1.5;
/** A weak print joins a group only this close to it, on average. */
export const WEAK_JOIN_DISTANCE = 1.4;
/** At most this many voices in one visit. */
export const MAX_VOICES = 4;

export const SETTLED_SHARE = 0.6;
export const CLEAR_VOTE = 0.9;
export const FAIR_VOTE = 0.5;
/** How much a vote of the fixed rules counts next to a model's. */
export const RULE_WEIGHT = 0.5;

// ------------------------------------------------------------------ the voices

export interface VoiceItem {
  id: string;
  print: VoicePrint | null;
}

/**
 * The visit's lines grouped into voices: id -> group index (0, 1, ...; in order of each group's first line), or null
 * for a line no group takes. See the header for the rule. Average linkage over a distance matrix kept up to date as
 * groups merge (Lance-Williams), so a visit of a few hundred lines is grouped in milliseconds.
 */
export function clusterVoices(items: readonly VoiceItem[], opts: { join?: number; weakJoin?: number; max?: number } = {}): Map<string, number | null> {
  const join = opts.join ?? JOIN_DISTANCE;
  const weakJoin = opts.weakJoin ?? WEAK_JOIN_DISTANCE;
  const max = opts.max ?? MAX_VOICES;
  const out = new Map<string, number | null>();
  const strong = items.map((it, index) => ({ it, index })).filter(({ it }) => it.print && it.print.speechMs >= STRONG_SPEECH_MS);
  const n = strong.length;
  const dist: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) dist[a][b] = dist[b][a] = voiceDistance(strong[a].it.print!, strong[b].it.print!);
  /** live groups: members (indices into `strong`) */
  const groups = new Map<number, number[]>(strong.map((_, i) => [i, [i]]));
  for (;;) {
    if (groups.size < 2) break;
    let best = { a: -1, b: -1, d: Infinity };
    const keys = [...groups.keys()];
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const d = dist[keys[i]][keys[j]];
        if (d < best.d) best = { a: keys[i], b: keys[j], d };
      }
    }
    if (best.d >= join && groups.size <= max) break;
    const ga = groups.get(best.a)!;
    const gb = groups.get(best.b)!;
    // average linkage: the merged group's distance to every other group is the size-weighted mean of the two
    for (const k of groups.keys()) {
      if (k === best.a || k === best.b) continue;
      dist[best.a][k] = dist[k][best.a] = (ga.length * dist[best.a][k] + gb.length * dist[best.b][k]) / (ga.length + gb.length);
    }
    groups.set(best.a, [...ga, ...gb]);
    groups.delete(best.b);
  }
  const ordered = [...groups.values()].map((m) => ({ members: m, first: Math.min(...m.map((i) => strong[i].index)) })).sort((x, y) => x.first - y.first);
  const grouped = new Map<string, number>();
  ordered.forEach((g, k) => g.members.forEach((i) => grouped.set(strong[i].it.id, k)));
  // every line in the order given: its group, or the nearest group for a weak print close enough to it
  for (const it of items) {
    const k = grouped.get(it.id);
    if (k !== undefined) {
      out.set(it.id, k);
      continue;
    }
    if (!it.print || !ordered.length) {
      out.set(it.id, null);
      continue;
    }
    let near = { k: -1, d: Infinity };
    ordered.forEach((g, n) => {
      const d = g.members.reduce((sum, i) => sum + voiceDistance(it.print!, strong[i].it.print!), 0) / g.members.length;
      if (d < near.d) near = { k: n, d };
    });
    out.set(it.id, near.d < weakJoin ? near.k : null);
  }
  return out;
}

/**
 * The new grouping with the numbers the lines had before: each new group takes the old number most of its lines had
 * (the biggest group chooses first; a number is taken once), and a group with no old number takes the smallest free
 * one. Lines without a group stay null.
 */
export function stableVoices(before: ReadonlyMap<string, number | null>, now: ReadonlyMap<string, number | null>): Map<string, number | null> {
  const members = new Map<number, string[]>();
  for (const [id, g] of now) if (g !== null) members.set(g, [...(members.get(g) ?? []), id]);
  const order = [...members.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
  const taken = new Set<number>();
  const rename = new Map<number, number>();
  for (const [g, ids] of order) {
    const votes = new Map<number, number>();
    for (const id of ids) {
      const old = before.get(id);
      if (old !== null && old !== undefined && !taken.has(old)) votes.set(old, (votes.get(old) ?? 0) + 1);
    }
    const pick = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    if (pick) {
      rename.set(g, pick[0]);
      taken.add(pick[0]);
    }
  }
  for (const [g] of order) {
    if (rename.has(g)) continue;
    let n = 0;
    while (taken.has(n)) n++;
    rename.set(g, n);
    taken.add(n);
  }
  const out = new Map<string, number | null>();
  for (const [id, g] of now) out.set(id, g === null ? null : rename.get(g)!);
  return out;
}

// ------------------------------------------------------------------ the rule

export interface CombineLine {
  id: string;
  /** the line's voice (null: none) */
  voice: number | null;
  /** the vote of its words (null: none yet): the model's once it answered, else the rules' */
  vote: SpeakerVote | null;
  /** what the line's own words say of their speaker (the rules' vote, kept when the model answers) */
  cue?: SpeakerVote | null;
  /** a role he confirmed in the review: kept as it is */
  confirmed?: UtteranceRole | null;
}

export interface VoiceRole {
  role: SpeakerVoteRole;
  settled: boolean;
  /** the leading role's share of the voice's vote weight */
  share: number;
  votes: number;
}

export interface CombineResult {
  byLine: Map<string, { role: UtteranceRole; state: RoleState }>;
  voices: Map<number, VoiceRole>;
}

const weightOf = (v: SpeakerVote) => (v.by === "rules" ? RULE_WEIGHT : 1) * Math.max(0, Math.min(1, v.sure));

/** The role each line takes from its voice and its words (see the header). `visitKind` "pharmacy": the clinician is the pharmacist. */
export function combineRoles(lines: readonly CombineLine[], opts: { visitKind?: string } = {}): CombineResult {
  const clinician: UtteranceRole = opts.visitKind === "pharmacy" ? "pharmacist" : "doctor";
  const asRole = (r: SpeakerVoteRole): UtteranceRole => (r === "doctor" ? clinician : r);
  const tally = new Map<number, { weight: Map<SpeakerVoteRole, number>; count: Map<SpeakerVoteRole, number>; votes: number }>();
  for (const l of lines) {
    if (l.voice === null || !l.vote || l.vote.role === "unknown") continue;
    const w = weightOf(l.vote);
    if (w <= 0) continue;
    const t = tally.get(l.voice) ?? { weight: new Map(), count: new Map(), votes: 0 };
    t.weight.set(l.vote.role, (t.weight.get(l.vote.role) ?? 0) + w);
    t.count.set(l.vote.role, (t.count.get(l.vote.role) ?? 0) + 1);
    t.votes += 1;
    tally.set(l.voice, t);
  }
  const voices = new Map<number, VoiceRole>();
  for (const [voice, t] of tally) {
    const total = [...t.weight.values()].reduce((a, b) => a + b, 0);
    const [role, w] = [...t.weight.entries()].sort((a, b) => b[1] - a[1])[0];
    const share = total > 0 ? w / total : 0;
    voices.set(voice, { role, settled: (t.count.get(role) ?? 0) >= 2 && share >= SETTLED_SHARE, share, votes: t.votes });
  }
  const byLine = new Map<string, { role: UtteranceRole; state: RoleState }>();
  for (const l of lines) {
    if (l.confirmed) {
      byLine.set(l.id, { role: l.confirmed, state: "confirmed" });
      continue;
    }
    const v = l.voice === null ? undefined : voices.get(l.voice);
    const own = l.vote && l.vote.role !== "unknown" ? { ...l.vote, role: l.vote.role } : null;
    const cue = l.cue && l.cue.role !== "unknown" ? { ...l.cue, role: l.cue.role } : null;
    let role: SpeakerVoteRole | null = null;
    if (v?.settled) role = own && own.role !== v.role && own.by === "model" && own.sure >= CLEAR_VOTE && cue?.role === own.role ? own.role : v.role;
    else if (own && own.sure >= FAIR_VOTE) role = own.role;
    else if (v) role = v.role;
    else if (cue && cue.sure >= FAIR_VOTE) role = cue.role;
    byLine.set(l.id, role ? { role: asRole(role), state: "inferred" } : { role: "unknown", state: "unknown" });
  }
  return { byLine, voices };
}
