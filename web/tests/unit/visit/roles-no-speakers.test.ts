/**
 * A transcript without speaker labels (C2 track F, fix round; web/progress/g.md 「旅程查到的」 1).
 *
 * The real transcription service has no diarisation: every line's speaker is null (lib/asr/whisper.ts). Role inference
 * then went by each line's own words only, and a line without a cue was nobody's: the sample third visit without
 * speakers paired none of its five questions and answers, so on the real stack the three questions on his list were
 * never answered by a visit.
 *
 * Now the order and the form of the lines decide what the cues leave open (lib/visit/roles.ts turnsWithoutSpeakers).
 * These tests hold:
 *   - the four sample visits with their speakers taken out: every line's role is the one the answer file gives it,
 *     as a guess ("inferred"), and the third visit's five questions meet their answers, each the transcript's own next
 *     line;
 *   - nothing is invented: a question nobody replied to has no answer, a line that fits no rule stays unknown, and no
 *     answer reaches his question list before he says 「是」;
 *   - a transcript that has speaker labels is inferred exactly as before (the pass does not run).
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { reviewEntries } from "@/components/visit/elder/AccountReview";
import { fixtureUtterances } from "@/lib/asr";
import type { FileJobResult } from "@/lib/asr/types";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow, UtteranceRole } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";
import { extractItems, type ExtractLine } from "@/lib/visit/extract";
import { confirmVisit, finalizeVisit, setItemVerdict, startVisit } from "@/lib/visit/pipeline";
import { inferRoles, type RoleLine } from "@/lib/visit/roles";
import { buildVisitView } from "@/lib/visit/view";

const store = getMemoryStore();

beforeAll(() => {
  process.env.MOCK_ASR_JOB_MS = "0";
  delete process.env.SPEECH_PROVIDER;
});
afterEach(() => setTestClock(null));

const trueRoles = (visit: string): Map<string, UtteranceRole> =>
  new Map((JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "visits", `${visit}.expected.json`), "utf8")) as { answers: { id: string; true_role: UtteranceRole }[] }).answers.map((a) => [a.id, a.true_role]));
const kindOf = (visit: string) => (visit === "p1" ? "pharmacy" : "clinic");
/** The sample visit's lines as the real service gives them: the words and the times, no speaker. */
const stripped = (visit: string): RoleLine[] => fixtureUtterances(visit)!.map((l) => ({ id: l.id, speaker_cluster: null, text: l.text }));
const rolesOf = (lines: RoleLine[], visitKind = "clinic") => inferRoles(lines, { visitKind, requiredLines: [] }).byLine;

function itemsOf(visit: string) {
  const roles = rolesOf(stripped(visit), kindOf(visit));
  const lines: ExtractLine[] = fixtureUtterances(visit)!.map((l) => ({ id: l.id, text: l.text, role: roles.get(l.id)!.role, t_start_ms: l.t_start_ms, t_end_ms: l.t_end_ms }));
  return extractItems(lines, 0, { visit: { id: visit, day: 0, kind: kindOf(visit) }, requiredLines: [], priorPrescriptions: [] });
}

describe("the sample visits with their speakers taken out", () => {
  for (const visit of ["v1", "v2", "v3", "p1"]) {
    it(`${visit}: every line gets the speaker the answer file names, as a guess`, () => {
      const roles = rolesOf(stripped(visit), kindOf(visit));
      const truth = trueRoles(visit);
      for (const l of fixtureUtterances(visit)!) {
        expect(roles.get(l.id), `${l.id} ${l.text}`).toEqual({ role: truth.get(l.id), state: "inferred" });
      }
    });
  }

  it("the third visit: his five questions meet Dr Lim's answers, each the transcript's own next line", () => {
    const answers = itemsOf("v3").filter((i) => i.type === "answer");
    expect(answers.map((a) => [a.slots.question_utterance_id, a.utterance_ids[0]])).toEqual([
      ["v3-u10", "v3-u11"],
      ["v3-u12", "v3-u13"],
      ["v3-u14", "v3-u15"],
      ["v3-u16", "v3-u17"],
      ["v3-u18", "v3-u19"],
    ]);
    const said = new Map(fixtureUtterances("v3")!.map((l) => [l.id, l.text]));
    for (const a of answers) {
      expect(a.text).toBe(said.get(a.utterance_ids[0]));
      expect(a.speaker).toBe("doctor");
    }
  });

  it("the other visits: the wrist-monitor answer, the painkiller answer, the counter's yes to his teach-back and its 「拿去问药剂师」, the pharmacist's answer", () => {
    expect(itemsOf("v1").filter((i) => i.type === "answer").map((a) => [a.slots.question_utterance_id, a.utterance_ids[0]])).toEqual([["v1-u11", "v1-u12"]]);
    const v2 = itemsOf("v2").filter((i) => i.type === "answer");
    expect(v2.map((a) => [a.slots.question_utterance_id, a.utterance_ids[0], a.speaker])).toEqual([
      ["v2-u10", "v2-u11", "doctor"],
      ["v2-u14", "v2-u15", "dispenser"],
      ["v2-u16", "v2-u17", "dispenser"],
    ]);
    expect(itemsOf("p1").filter((i) => i.type === "answer").map((a) => [a.slots.question_utterance_id, a.utterance_ids[0], a.speaker])).toEqual([["p1-u01", "p1-u03", "pharmacist"]]);
  });
});

describe("nothing is invented", () => {
  const lines = (...texts: string[]): RoleLine[] => texts.map((text, i) => ({ id: `u${i + 1}`, speaker_cluster: null, text }));
  const roles = (...texts: string[]) => [...rolesOf(lines(...texts)).values()].map((r) => r.role);
  const answers = (...texts: string[]) => {
    const r = rolesOf(lines(...texts));
    const ext: ExtractLine[] = lines(...texts).map((l, i) => ({ id: l.id, text: l.text, role: r.get(l.id)!.role, t_start_ms: i * 1000, t_end_ms: i * 1000 + 900 }));
    return extractItems(ext, 0, { visit: { id: "x", day: 0, kind: "clinic" }, requiredLines: [], priorPrescriptions: [] })
      .filter((i) => i.type === "answer")
      .map((a) => [a.slots.question_utterance_id, a.utterance_ids[0]]);
  };

  it("a question nobody replied to has no answer", () => {
    expect(answers("Anything else you want to ask?", "Doctor, the two pills, can eat together?")).toEqual([]);
    // his question, then he goes on himself: his own next line is not an answer
    expect(answers("Anything else you want to ask?", "Doctor, the two pills, can eat together?", "My daughter says cannot leh.")).toEqual([]);
    // two questions of his in a row: only the second one is followed by a reply
    expect(answers("Anything else you want to ask?", "Doctor, the two pills, can eat together?", "The blood test, I need to fast or not?", "No need to fast for this one.")).toEqual([["u3", "u4"]]);
  });

  it("a line that fits no rule stays unknown (his to claim in the review), and a line with his own cue is never the clinician's reply", () => {
    // small talk with no question before it
    expect(roles("Quite hot today.", "The traffic was bad.")).toEqual(["unknown", "unknown"]);
    // after his question a line with his own words in it is his, not the doctor's
    expect(roles("Doctor, the two pills, can eat together?", "I think can lah.")).toEqual(["patient", "patient"]);
    // a question with neither "I" nor "you", with nobody known around it
    expect(roles("Quite hot today.", "Any ankle swelling?")).toEqual(["unknown", "unknown"]);
    // the clinician going on about the dose is the clinician; a line about himself is not
    expect(roles("Mr Tan, we'll start a tablet.", "Amlodipine, 5 milligrams, one tablet every morning.")).toEqual(["doctor", "doctor"]);
    expect(roles("Mr Tan, we'll start a tablet.", "One tablet only? I see.")).toEqual(["doctor", "patient"]);
  });

  it("the counter is the counter only after the doctor closed the visit and in the counter's own words", () => {
    // the doctor answering in Mandarin after 「come back」 stays the doctor (the sample third visit)
    const v3 = rolesOf(stripped("v3"));
    expect([...v3.values()].some((r) => r.role === "dispenser")).toBe(false);
    // no closing line before it: still the doctor
    expect(roles("Mr Tan, we'll start a tablet.", "陈先生，这是 amlodipine，每天早上吃一粒，饭前饭后都可以。")).toEqual(["doctor", "doctor"]);
    expect(roles("Come back in five weeks.", "陈先生，这是 amlodipine，每天早上吃一粒，饭前饭后都可以。", "忘了吃的话，想起来就吃，但是不要一次吃两粒。")).toEqual(["doctor", "dispenser", "dispenser"]);
  });
});

describe("with speaker labels nothing changes", () => {
  it("a transcript in which lines carry a speaker is not touched by the turn rules", () => {
    // one labelled line is enough: the lines the cues leave open stay open, as before
    const mixed = stripped("v3").map((l, i) => (i === 0 ? { ...l, speaker_cluster: 0 } : l));
    const roles = rolesOf(mixed);
    for (const id of ["v3-u05", "v3-u06", "v3-u11", "v3-u12", "v3-u15", "v3-u16", "v3-u18"]) expect(roles.get(id), id).toEqual({ role: "unknown", state: "unknown" });
    // and the sample visits as recorded (two or three speakers) come out as their answer files say
    for (const visit of ["v1", "v2", "v3", "p1"]) {
      const labelled = fixtureUtterances(visit)!.map((l) => ({ id: l.id, speaker_cluster: l.speaker_cluster, text: l.text }));
      expect(labelled.every((l) => typeof l.speaker_cluster === "number")).toBe(true);
      const truth = trueRoles(visit);
      const got = rolesOf(labelled, kindOf(visit));
      for (const l of labelled) expect(got.get(l.id)!.role, `${visit} ${l.id}`).toBe(truth.get(l.id));
    }
  });
});

describe("on his account: his own recording, a transcript without speakers", () => {
  async function example(): Promise<SessionRow> {
    setTestClock({ at: "2026-10-12T10:00:00+08:00", frozen: true });
    const a = await createAccountWithSpace(store, getAuthProvider(), { login: `ns${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
    return (await store.getSession(a.scope!.id))!;
  }
  /** What the real service hands back for a recording of the sample third visit: words and times, no speakers, no ids. */
  const transcript = (): FileJobResult => ({
    status: "done",
    source: "audio",
    utterances: fixtureUtterances("v3")!.map((l) => ({ tStartMs: l.t_start_ms, tEndMs: l.t_end_ms, speaker: null, lang: l.lang ?? "en", text: l.text })),
  });

  it("the three questions on his list meet Dr Lim's answers as guesses; they are written to his list only after he says 「是」 and saves", async () => {
    const scope = await example();
    const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    // his own visit (a new row), never the example's sample visit
    expect(visit.id).not.toBe("v3");
    await finalizeVisit(store, scope, visit.id, transcript(), { llm: null });
    const view = (await buildVisitView(store, scope.id, visit.id, { session: scope }))!;
    const byQuestion = new Map(view.qlist!.items.map((q) => [q.questionId, q]));
    const expected: [string, string][] = [
      ["q-tai-chi", "可以，回来再吃，每天差不多同一个时间就好。Same time every day."],
      ["q-knee-2", "Try not to take ibuprofen regularly. It can push your blood pressure up. For the knee, paracetamol is the safer one, and we'll look at the knee properly next time."],
      ["q-extra-tablet", "No, please don't take an extra tablet on your own. One high reading doesn't mean the dose is wrong; I look at all your readings together, and that's why we're adding losartan today."],
    ];
    for (const [id, words] of expected) {
      const q = byQuestion.get(id)!;
      // the answer is the transcript's line word for word, shown as a guess
      expect(q.answer, id).toMatchObject({ text: words, role: "doctor", display: "inferred", verdict: null });
    }
    // every line's speaker is a guess; no line reads 医生说 yet, and nothing was written to his question list
    expect(view.lines.every((l) => l.roleState === "inferred")).toBe(true);
    expect(view.lines.some((l) => l.display === "confirmed")).toBe(false);
    for (const [id] of expected) expect((await store.getQuestion(scope.id, id))!.status, id).toBe("open");

    // he answers 「是」 to each of the three, 「不记得」 to everything else, and saves
    let current = view;
    const wanted = new Set(expected.map(([, words]) => words));
    for (let i = 0; i < 40; i++) {
      const pending = reviewEntries(current).filter((e) => e.verdict === null);
      if (!pending.length) break;
      current = await setItemVerdict(store, scope, visit.id, { items: pending[0].itemIds, verdict: wanted.has(pending[0].text) ? "right" : "unsure" });
    }
    await confirmVisit(store, scope, visit.id, { mine: current.lines.filter((l) => l.role === "patient").map((l) => l.id), items: {} });
    for (const [id, words] of expected) {
      expect(await store.getQuestion(scope.id, id), id).toMatchObject({ status: "answered", answer_text: words, answer_speaker: "doctor", answer_visit_id: visit.id });
    }
    // a line he did not say 「是」 to is still only a guess
    const after = (await buildVisitView(store, scope.id, visit.id, { session: scope }))!;
    expect(after.lines.find((l) => l.text.startsWith("Yes, both together"))).toMatchObject({ role: "doctor", roleState: "inferred" });
  });
});
