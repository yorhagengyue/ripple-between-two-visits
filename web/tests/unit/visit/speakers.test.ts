/**
 * Who is speaking, from the voice and the words together (scene 1 of the owner's video, 2026-10-15):
 *   lib/visit/voiceprint.ts     a line's voice print: pitch (YIN) and MFCC timbre; too little speech has none
 *   lib/visit/speakers.ts       the voices of a visit (average-linkage grouping, at most four, numbers kept from one
 *                               grouping to the next) and the rule that combines them with the votes of the words
 *   lib/visit/speaker-words.ts  the fixed rules' vote, and reading the model's answer
 *   lib/visit/pipeline.ts       an account's live lines with prints: roles from both, the model's votes applied in the
 *                               background (utterance.role), and the whole-visit record from the service's speaker numbers
 * The voices here are synthetic (harmonics of a moving pitch through three moving formants, in syllables), made in the
 * test: two sentences of one voice are close, two voices differing in pitch or in timbre alone are far apart.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { getBus } from "@/lib/bus";
import type { LlmClient } from "@/lib/llm/types";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";
import { finalizeVisit, processChunk, speakersIdle, startVisit } from "@/lib/visit/pipeline";
import { setSummaryTestDeps } from "@/lib/visit/ripple-summary";
import { readSpeakerAnswer, ruleVote, speakerPayload } from "@/lib/visit/speaker-words";
import { clusterVoices, combineRoles, JOIN_DISTANCE, MAX_VOICES, stableVoices, type CombineLine, type SpeakerVote } from "@/lib/visit/speakers";
import { liveSpeakers } from "@/lib/visit/live-speakers";
import { voiceDistance, voicePrint, type VoicePrint } from "@/lib/visit/voiceprint";

// ------------------------------------------------------------------ synthetic voices

/** One voice saying one "sentence": harmonics of a moving pitch, shaped by three moving formants, in syllables. */
function say(f0: number, formants: [number, number, number], ms: number, seed: number): Int16Array {
  const sr = 16_000;
  const n = Math.round((ms * sr) / 1000);
  const out = new Int16Array(n);
  const harmonics = Math.floor(3800 / (f0 * 0.9));
  const phase = new Float64Array(harmonics + 1);
  let rnd = seed * 9301 + 49_297;
  const rand = () => (rnd = (rnd * 9301 + 49_297) % 233_280) / 233_280;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const pitch = f0 * (1 + 0.06 * Math.sin(2 * Math.PI * 0.7 * t + seed) + 0.02 * Math.sin(2 * Math.PI * 3.1 * t));
    const vowel = 1 + 0.07 * Math.sin(2 * Math.PI * (1.3 + 0.2 * seed) * t + 2 * seed);
    const syllable = Math.max(0, Math.sin(2 * Math.PI * 3.2 * t + seed)) ** 0.6;
    let v = 0;
    for (let h = 1; h <= harmonics; h++) {
      phase[h] += (2 * Math.PI * h * pitch) / sr;
      const f = h * pitch;
      let a = 0.02;
      formants.forEach((F, k) => (a += Math.exp(-(((f - F * vowel) / (90 + 40 * k)) ** 2)) / (k + 1)));
      v += a * Math.sin(phase[h]);
    }
    out[i] = Math.round(3000 * syllable * v + (rand() - 0.5) * 60);
  }
  return out;
}

const LOW: [number, [number, number, number]] = [115, [550, 1450, 2500]];
const HIGH: [number, [number, number, number]] = [210, [750, 1900, 2900]];
const MID: [number, [number, number, number]] = [160, [450, 1100, 2300]];
const print = (v: [number, [number, number, number]], seed: number, ms = 2400): VoicePrint => voicePrint(say(v[0], v[1], ms, seed))!;
const semitones = (hz: number) => 12 * Math.log2(hz / 55);

describe("a line's voice print", () => {
  it("reads the pitch within a semitone, and has no print for a line with too little speech or none", () => {
    expect(Math.abs(print(LOW, 1).pitch! - semitones(115))).toBeLessThan(1);
    expect(Math.abs(print(HIGH, 1).pitch! - semitones(210))).toBeLessThan(1);
    expect(Math.abs(print(MID, 1).pitch! - semitones(160))).toBeLessThan(1);
    expect(voicePrint(say(LOW[0], LOW[1], 300, 1))).toBeNull();
    expect(voicePrint(new Int16Array(32_000))).toBeNull();
    // 26 numbers and how much speech they rest on: nothing that could be played back
    expect(Object.keys(print(LOW, 1)).sort()).toEqual(["mean", "pitch", "pitchRange", "speechMs", "spread"]);
  });

  it("two sentences of one voice are close; two voices are far apart, by pitch alone or by timbre alone", () => {
    expect(voiceDistance(print(LOW, 1), print(LOW, 2))).toBeLessThan(1);
    expect(voiceDistance(print(HIGH, 1), print(HIGH, 2))).toBeLessThan(1);
    expect(voiceDistance(print(LOW, 1), print(HIGH, 1))).toBeGreaterThan(JOIN_DISTANCE * 2);
    const samePitchOtherTimbre: [number, [number, number, number]] = [LOW[0], HIGH[1]];
    const sameTimbreOtherPitch: [number, [number, number, number]] = [HIGH[0], LOW[1]];
    expect(voiceDistance(print(LOW, 1), print(samePitchOtherTimbre, 2))).toBeGreaterThan(JOIN_DISTANCE);
    expect(voiceDistance(print(LOW, 1), print(sameTimbreOtherPitch, 2))).toBeGreaterThan(JOIN_DISTANCE);
  });
});

describe("the voices of a visit", () => {
  it("groups interleaved lines of three voices into three, numbered in the order they first spoke", () => {
    const lines = [print(LOW, 1), print(HIGH, 1), print(MID, 1), print(LOW, 2), print(HIGH, 2), print(MID, 2), print(LOW, 3)].map((p, i) => ({ id: `l${i}`, print: p }));
    const g = clusterVoices(lines);
    expect([...g.values()]).toEqual([0, 1, 2, 0, 1, 2, 0]);
  });

  it("a weak print joins the nearest voice when close, a line without a print has none, and never more than four voices", () => {
    const weak = print(HIGH, 7, 1100);
    expect(weak.speechMs).toBeLessThan(900);
    const g = clusterVoices([
      { id: "a", print: print(LOW, 1) },
      { id: "b", print: print(HIGH, 1) },
      { id: "c", print: weak },
      { id: "d", print: null },
    ]);
    expect(g.get("c")).toBe(g.get("b"));
    expect(g.get("d")).toBeNull();
    // a weak print alone starts no voice
    expect(clusterVoices([{ id: "w", print: weak }]).get("w")).toBeNull();
    const five: [number, [number, number, number]][] = [LOW, HIGH, MID, [260, [900, 2200, 3100]], [95, [400, 900, 2100]]];
    const many = clusterVoices(five.map((v, i) => ({ id: `v${i}`, print: print(v, i + 1) })));
    expect(new Set(many.values()).size).toBeLessThanOrEqual(MAX_VOICES);
  });

  it("keeps a voice's number from one grouping to the next; a new voice takes the smallest free number", () => {
    const before = new Map<string, number | null>([
      ["a", 0],
      ["b", 1],
      ["c", 0],
    ]);
    // the new grouping numbered them the other way round, and found a third voice
    const now = new Map<string, number | null>([
      ["a", 1],
      ["b", 0],
      ["c", 1],
      ["d", 2],
      ["e", null],
    ]);
    expect([...stableVoices(before, now).entries()]).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 0],
      ["d", 2],
      ["e", null],
    ]);
  });
});

// ------------------------------------------------------------------ the rule

const model = (role: SpeakerVote["role"], sure: number): SpeakerVote => ({ role, sure, by: "model" });
const rules = (role: SpeakerVote["role"], sure: number): SpeakerVote => ({ role, sure, by: "rules" });
const roleOf = (lines: CombineLine[], id: string, kind?: string) => combineRoles(lines, { visitKind: kind }).byLine.get(id);

describe("the voice and the words together", () => {
  it("a settled voice gives its lines the role most of them were named; a line very clearly someone else's (the model sure, its own words too) keeps its own", () => {
    const lines: CombineLine[] = [
      { id: "1", voice: 0, vote: model("doctor", 0.9) },
      { id: "2", voice: 0, vote: model("doctor", 0.8) },
      { id: "3", voice: 0, vote: model("patient", 0.6) },
      { id: "4", voice: 0, vote: null },
      { id: "5", voice: 0, vote: model("family", 0.95), cue: rules("family", 0.75) },
      { id: "6", voice: 0, vote: model("doctor", 0.8) },
      { id: "7", voice: 0, vote: model("doctor", 0.7) },
    ];
    const r = combineRoles(lines);
    expect(r.voices.get(0)).toMatchObject({ role: "doctor", settled: true });
    expect(r.byLine.get("3")).toEqual({ role: "doctor", state: "inferred" });
    expect(r.byLine.get("4")).toEqual({ role: "doctor", state: "inferred" });
    expect(r.byLine.get("5")).toEqual({ role: "family", state: "inferred" });
    // the rules never overrule a settled voice, however sure
    expect(roleOf([...lines.slice(0, 2), { id: "8", voice: 0, vote: rules("family", 1) }], "8")?.role).toBe("doctor");
    // nor does a sure model whose line's own words say nothing of their speaker (the live run's "Yes, doctor.")
    expect(roleOf([...lines.slice(0, 2), { id: "9", voice: 0, vote: model("patient", 0.95), cue: rules("unknown", 0) }], "9")?.role).toBe("doctor");
  });

  it("a line in a voice of its own that the model would not name takes its words' cue when that is fair", () => {
    // 「谢谢医生。」 in the live run: a short line far from every voice, the model unsure, the rules' Mandarin cue
    expect(roleOf([{ id: "1", voice: 3, vote: model("unknown", 0), cue: rules("patient", 0.5) }], "1")).toEqual({ role: "patient", state: "inferred" });
    expect(roleOf([{ id: "1", voice: 3, vote: model("unknown", 0), cue: rules("patient", 0.45) }], "1")).toEqual({ role: "unknown", state: "unknown" });
  });

  it("before its voice is settled a line takes its own fair vote, else the voice's one guess; with nothing, nobody", () => {
    expect(roleOf([{ id: "1", voice: 2, vote: model("family", 0.6) }], "1")).toEqual({ role: "family", state: "inferred" });
    expect(roleOf([{ id: "1", voice: 2, vote: model("family", 0.6) }, { id: "2", voice: 2, vote: model("patient", 0.3) }], "2")).toEqual({ role: "family", state: "inferred" });
    expect(roleOf([{ id: "1", voice: null, vote: rules("patient", 0.4) }], "1")).toEqual({ role: "unknown", state: "unknown" });
    expect(roleOf([{ id: "1", voice: 1, vote: null }], "1")).toEqual({ role: "unknown", state: "unknown" });
    // a split voice is not settled: each line keeps its own vote
    const split = combineRoles([
      { id: "1", voice: 0, vote: model("doctor", 0.8) },
      { id: "2", voice: 0, vote: model("patient", 0.8) },
    ]);
    expect(split.voices.get(0)?.settled).toBe(false);
    expect(split.byLine.get("2")?.role).toBe("patient");
    // one line named by the model and one by the rules: the voice is not anybody's yet, however the weights fall (live,
    // 10-15: a short "Yes, doctor." named the patient made the daughter's next line the patient's until this rule)
    const early = combineRoles([
      { id: "1", voice: 1, vote: model("patient", 0.7) },
      { id: "2", voice: 1, vote: rules("family", 0.62) },
    ]);
    expect(early.voices.get(1)?.settled).toBe(false);
    expect(early.byLine.get("2")).toEqual({ role: "family", state: "inferred" });
  });

  it("a line he confirmed keeps its role; at a pharmacy the clinician is the pharmacist; nothing else is ever confirmed", () => {
    const lines: CombineLine[] = [
      { id: "1", voice: 0, vote: model("doctor", 0.9) },
      { id: "2", voice: 0, vote: model("doctor", 0.9) },
      { id: "3", voice: 0, vote: model("doctor", 0.9), confirmed: "patient" },
    ];
    expect(roleOf(lines, "3")).toEqual({ role: "patient", state: "confirmed" });
    expect(roleOf(lines, "1", "pharmacy")).toEqual({ role: "pharmacist", state: "inferred" });
    for (const [, r] of combineRoles(lines.slice(0, 2)).byLine) expect(r.state).toBe("inferred");
  });
});

describe("the words' vote", () => {
  it("the rules: the daughter speaks to her father, the patient to the doctor, the doctor to Mr Tan; never very sure", () => {
    expect(ruleVote("Dad, you missed it on Sunday, remember?")).toMatchObject({ role: "family", by: "rules" });
    expect(ruleVote("爸，你星期天忘记吃药了。").role).toBe("family");
    expect(ruleVote("Doctor, I feel dizzy in the morning.").role).toBe("patient");
    expect(ruleVote("Mr Tan, we will increase the amlodipine to ten milligrams.").role).toBe("doctor");
    expect(ruleVote("医生，我这几天早上头有点痛。").role).toBe("patient");
    // Chinese with no other cue: the patient, barely; nothing to go by: unknown
    expect(ruleVote("每天早上一粒。")).toEqual({ role: "patient", sure: 0.5, by: "rules" });
    expect(ruleVote("Okay.")).toEqual({ role: "unknown", sure: 0, by: "rules" });
    for (const t of ["Dad, you missed it on Sunday, remember?", "Mr Tan, we will increase the amlodipine to ten milligrams.", "Doctor, I feel dizzy."]) expect(ruleVote(t).sure).toBeLessThan(0.9);
  });

  it("the model is given the lines under short ids with who earlier ones were taken to be, and only its votes on the new lines are read", () => {
    const { payload, ids } = speakerPayload(
      [{ id: "v-w1", text: "Good morning, Mr Tan.", by: "doctor" }],
      [{ id: "v-w2", text: "Morning, doctor.", by: null }],
      { patient: "Mr Tan", family: "Wei Ling" },
    );
    expect(payload).toEqual({
      task: "speakers",
      people: { patient: "Mr Tan", family: "Wei Ling" },
      lines: [
        { id: "L1", by: "doctor", text: "Good morning, Mr Tan." },
        { id: "L2", by: null, text: "Morning, doctor." },
      ],
      new: ["L2"],
    });
    const votes = readSpeakerAnswer('{"lines":[{"id":"L1","speaker":"family","sure":1},{"id":"L2","speaker":"patient","sure":0.85},{"id":"L9","speaker":"doctor"}]}', ids, new Set(["v-w2"]));
    expect([...votes!.entries()]).toEqual([["v-w2", { role: "patient", sure: 0.85, by: "model" }]]);
    expect(readSpeakerAnswer("not json", ids, new Set(["v-w2"]))).toBeNull();
    expect(readSpeakerAnswer('{"lines":[{"id":"L2","speaker":"nurse","sure":0.9}]}', ids, new Set(["v-w2"]))!.get("v-w2")).toEqual({ role: "unknown", sure: 0, by: "model" });
  });
});

// ------------------------------------------------------------------ the pipeline

const store = getMemoryStore();

beforeAll(() => {
  process.env.MOCK_ASR_JOB_MS = "0";
  delete process.env.SPEECH_PROVIDER;
  delete process.env.LLM_PROVIDER;
});
afterEach(() => {
  setTestClock(null);
  setSummaryTestDeps(null);
});

async function account(): Promise<SessionRow> {
  setTestClock({ at: "2026-10-15T10:00:00+08:00", frozen: true });
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `sp${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
  return (await store.getSession(a.scope!.id))!;
}

/** The three people of scene 1 as synthetic voices, and what each says. */
const DOCTOR: [number, [number, number, number]] = LOW;
const DAUGHTER: [number, [number, number, number]] = HIGH;
const FATHER: [number, [number, number, number]] = MID;
const TALK: { who: "doctor" | "family" | "patient"; voice: [number, [number, number, number]]; text: string }[] = [
  { who: "doctor", voice: DOCTOR, text: "Good morning, Mr Tan. Please have a seat." },
  { who: "family", voice: DAUGHTER, text: "Dad has been getting headaches this week." },
  { who: "patient", voice: FATHER, text: "医生，我这几天早上头有点痛。" },
  { who: "doctor", voice: DOCTOR, text: "Let me check your blood pressure first." },
  { who: "family", voice: DAUGHTER, text: "Should we worry about it?" },
  { who: "patient", voice: FATHER, text: "好的，谢谢。" },
  { who: "doctor", voice: DOCTOR, text: "Come back in two weeks." },
];

async function feed(scope: SessionRow, visitId: string, upTo = TALK.length) {
  for (let i = 0; i < upTo; i++) {
    const t = TALK[i];
    await processChunk(store, scope, visitId, [{ id: `${visitId}-w${i + 1}`, t_start_ms: i * 4000, t_end_ms: i * 4000 + 2400, text: t.text, voice: voicePrint(say(t.voice[0], t.voice[1], 2400, i + 1)) }]);
  }
}

describe("an account's live lines: who is speaking, on both screens", () => {
  it("offline: the voices and the rules' votes name all three people; a line's voice is kept on its row", async () => {
    const scope = await account();
    const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    await feed(scope, visit.id);
    const rows = await store.listUtterances(scope.id, visit.id);
    expect(rows.map((u) => u.role)).toEqual(["doctor", "family", "patient", "doctor", "family", "patient", "doctor"]);
    expect(rows.every((u) => u.role_state === "inferred")).toBe(true);
    expect(rows.map((u) => u.speaker_cluster)).toEqual([0, 1, 2, 0, 1, 2, 0]);
    // "Should we worry about it?" has no cue of its own: its voice says it is the daughter's
    expect(ruleVote(TALK[4].text).role).toBe("unknown");
  });

  it("with a model: its votes come after the caption, change what the voices settle, and go out as utterance.role", async () => {
    const scope = await account();
    const asked: string[] = [];
    const fake: LlmClient = {
      provider: "fake",
      model: "fake-flash",
      async chat(opts) {
        if (opts.purpose !== "classify") return { content: '{"points":[]}', tokens: 1 };
        const p = JSON.parse(opts.user) as { lines: { id: string; text: string }[]; new: string[] };
        asked.push(...p.new);
        // the model hears "Should we worry about it?" as the patient's, very surely: the line is the patient's, its voice stays the daughter's
        const lines = p.new.map((id) => {
          const text = p.lines.find((l) => l.id === id)!.text;
          const who = TALK.find((t) => t.text === text)!;
          return { id, speaker: text.startsWith("Should") ? "patient" : who.who === "family" ? "family" : who.who, sure: text.startsWith("Should") ? 0.95 : 0.8 };
        });
        return { content: JSON.stringify({ lines }), tokens: 10 };
      },
    };
    setSummaryTestDeps({ llm: fake, aiAllowed: true, spend: null });
    const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    const since = (await getBus().head(scope.id)) ?? 0;
    await feed(scope, visit.id);
    await speakersIdle(scope.id, visit.id);
    expect(asked.length).toBe(TALK.length);
    const rows = await store.listUtterances(scope.id, visit.id);
    expect(rows.map((u) => u.role)).toEqual(["doctor", "family", "patient", "doctor", "patient", "patient", "doctor"]);
    const changes = getBus()
      .recent(scope.id, { sinceId: since })
      .filter((e) => e.type === "utterance.role")
      .flatMap((e) => (e.data as { changes: { id: string; role: string }[] }).changes);
    expect(changes).toContainEqual({ id: `${visit.id}-w5`, role: "patient", state: "inferred" });
    const sp = liveSpeakers(scope.id, visit.id)!;
    expect(sp.calls.every((c) => c.error === null)).toBe(true);
  });

  it("the whole-visit record takes the service's speaker numbers (one piece) and the live votes of the lines it overlaps", async () => {
    const scope = await account();
    const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    await feed(scope, visit.id);
    // the service numbered the father's short 「好的，谢谢。」 as the daughter's (a mistake): her voice is then split between
    // two people's votes and not settled, so each of its lines keeps its own vote
    const number = { doctor: 0, family: 1, patient: 2 };
    const formal = TALK.map((t, i) => ({ tStartMs: i * 4000, tEndMs: i * 4000 + 2400, speaker: i === 5 ? 1 : number[t.who], text: t.text, lang: /[一-鿿]/.test(t.text) ? "zh" : "en" }));
    await finalizeVisit(store, scope, visit.id, { status: "done", source: "audio", utterances: formal });
    const rows = (await store.listUtterances(scope.id, visit.id)).filter((u) => u.lang !== "x-superseded");
    expect(rows.map((u) => u.speaker_cluster)).toEqual([0, 1, 2, 0, 1, 1, 0]);
    expect(rows.map((u) => u.role)).toEqual(["doctor", "family", "patient", "doctor", "family", "patient", "doctor"]);
    expect(rows.every((u) => u.role_state === "inferred")).toBe(true);
  });
});
