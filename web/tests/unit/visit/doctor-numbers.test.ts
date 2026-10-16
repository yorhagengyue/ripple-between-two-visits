/**
 * lib/visit/doctor-numbers.ts and lib/visit/happened.ts (C2 track F; real-app 8.7 「单元 visit/doctor-numbers」): the demo
 * gives R1 and R2 as before; a new account gives nothing until he confirms the doctor's target and warning line in his
 * review; a line he marked "not right" stays on the emergency path only; an empty or planned visit never counts.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { getSpeechProvider } from "@/lib/asr";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow, VisitItemRow, VisitRow } from "@/lib/store/types";
import { confirmedTarget, doctorNumbers, emergencyThreshold } from "@/lib/visit/doctor-numbers";
import { COPY_PREFIX, happenedVisits, isReplayCopy, visitHappened } from "@/lib/visit/happened";
import { confirmVisit, finalizeVisit, startVisit } from "@/lib/visit/pipeline";
import { newSession, replayLive } from "./helpers";

const store = getMemoryStore();

beforeAll(() => {
  process.env.MOCK_ASR_JOB_MS = "0";
  delete process.env.SPEECH_PROVIDER;
});

async function blankAccount(): Promise<SessionRow> {
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `dn${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
  return a.scope!;
}

/** Records a visit on the account and makes its record from the v1 sample lines (what devfake / Whisper hand back). */
async function recordV1(scope: SessionRow): Promise<VisitRow> {
  const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
  const speech = getSpeechProvider();
  const { jobId } = await speech.createFileJob({ url: "fixture:v1", lang: "zh-en-mixed", fixture: "v1" });
  await finalizeVisit(store, scope, visit.id, await speech.getFileJob(jobId));
  return (await store.getVisit(scope.id, visit.id))!;
}

const itemsOf = async (scope: SessionRow, visitId: string, type: VisitItemRow["type"]) =>
  (await store.listVisitItems(scope.id, { visit_id: visitId })).filter((i) => i.type === type && i.slots?.superseded !== true);

describe("the demo: R1 and R2, as before", () => {
  it("a judge sandbox on D29 gives R1 as the target and R2 as the warning line, from the seed's record", async () => {
    const s = await newSession();
    const n = await doctorNumbers(store, s.id, { day: s.story_day, time: s.story_time });
    expect(n.target).toMatchObject({ requiredLine: "R1", systolic: 135, diastolic: 85, visitId: "v1", state: "confirmed", disputed: false, utteranceId: null });
    expect(n.target!.text).toBe("At home, we want it below 135 over 85.");
    expect(n.threshold).toMatchObject({ requiredLine: "R2", systolic: 180, diastolic: null, state: "confirmed" });
    expect(n.emergency).toEqual(n.threshold);
  });

  it("before the D0 visit has happened by the story clock (D0 08:00, nothing replayed) there is no number yet", async () => {
    const s = await store.setStoryDay((await newSession({ story_day: 0 })).id, 0, "08:00");
    const n = await doctorNumbers(store, s.id, { day: 0, time: "08:00" });
    expect(n).toEqual({ target: null, threshold: null, emergency: null });
  });

  it("after a v1 replay he has not confirmed, R1 is still the target, with the transcript's line and 推断 state", async () => {
    const s = await newSession();
    await replayLive(s, "v1");
    const n = await doctorNumbers(store, s.id);
    expect(n.target).toMatchObject({ requiredLine: "R1", utteranceId: "v1-u08", state: "inferred" });
    expect(n.target!.tStartMs).toBe(49520);
    expect(n.threshold).toMatchObject({ requiredLine: "R2", utteranceId: "v1-u09", state: "inferred" });
  });
});

describe("an account: nothing until he confirms", () => {
  it("a new account has no numbers", async () => {
    const scope = await blankAccount();
    expect(await doctorNumbers(store, scope.id)).toEqual({ target: null, threshold: null, emergency: null });
  });

  it("after the visit, before his review: no target and no warning line to compare with; the emergency path has the line, inferred", async () => {
    const scope = await blankAccount();
    const visit = await recordV1(scope);
    const n = await doctorNumbers(store, scope.id);
    expect(n.target).toBeNull();
    expect(n.threshold).toBeNull();
    expect(n.emergency).toMatchObject({ kind: "threshold", systolic: 180, visitId: visit.id, requiredLine: null, state: "inferred", disputed: false });
    expect(n.emergency!.text).toContain("call 995");
  });

  it("he confirms both: the target and the warning line are his doctor's, word for word, with where they were said", async () => {
    const scope = await blankAccount();
    const visit = await recordV1(scope);
    const [target] = await itemsOf(scope, visit.id, "target");
    const [threshold] = await itemsOf(scope, visit.id, "threshold");
    await confirmVisit(store, scope, visit.id, { mine: [], items: { [target.id]: "right", [threshold.id]: "right" } });
    const n = await doctorNumbers(store, scope.id);
    expect(n.target).toMatchObject({ systolic: 135, diastolic: 85, visitId: visit.id, state: "confirmed", requiredLine: null, speaker: "doctor" });
    expect(n.target!.text).toBe("At home, we want it below 135 over 85.");
    expect(n.target!.utteranceId).toBe(target.utterance_ids[0]);
    expect(n.target!.tStartMs).toBe(49520);
    expect(n.threshold).toMatchObject({ systolic: 180, state: "confirmed" });
    expect(n.emergency).toEqual(n.threshold);
  });

  it("a warning line he said was not right is never a comparison line, but stays on the emergency path, marked", async () => {
    const scope = await blankAccount();
    const visit = await recordV1(scope);
    const [threshold] = await itemsOf(scope, visit.id, "threshold");
    await store.updateVisitItem(scope.id, threshold.id, { confirmed_by: null, slots: { ...threshold.slots, disputed: true } });
    const n = await doctorNumbers(store, scope.id);
    expect(n.threshold).toBeNull();
    expect(n.emergency).toMatchObject({ systolic: 180, disputed: true, state: "inferred" });
  });

  it("the latest confirmed target wins", async () => {
    const scope = await blankAccount();
    const first = await recordV1(scope);
    const [t1] = await itemsOf(scope, first.id, "target");
    await confirmVisit(store, scope, first.id, { mine: [], items: { [t1.id]: "right" } });
    const later = await store.upsertVisit(scope.id, { id: `later-${randomUUID()}`, kind: "follow_up", place: "Clinic", day: first.day + 7, status: "confirmed" });
    await store.addUtterances(scope.id, later.id, [
      { id: `${later.id}-u01`, t_start_ms: 1000, t_end_ms: 3000, text: "Now we want it below 130 over 80.", role: "doctor", role_state: "confirmed" },
    ]);
    await store.addVisitItems(scope.id, later.id, [
      { id: `${later.id}-u01-target`, type: "target", text: "Now we want it below 130 over 80.", utterance_ids: [`${later.id}-u01`], slots: { variant: "target", systolic: 130, diastolic: 80 }, confirmed_by: "patient", speaker: "doctor" },
    ]);
    const rows = {
      visits: await store.listVisits(scope.id),
      items: await store.listVisitItems(scope.id),
      transcripts: new Map([
        [first.id, await store.listUtterances(scope.id, first.id)],
        [later.id, await store.listUtterances(scope.id, later.id)],
      ]),
    };
    expect(confirmedTarget(rows)).toMatchObject({ systolic: 130, diastolic: 80, visitId: later.id });
    expect(emergencyThreshold(rows)).toMatchObject({ visitId: first.id, systolic: 180 });
  });
});

describe("visitHappened: an empty visit is not the last visit", () => {
  const v = (status: VisitRow["status"], script_section: string | null = null) => ({ status, script_section });

  it("planned never; a transcript yes; confirmed with no transcript (the demo seed) yes; nothing captured no", () => {
    expect(visitHappened(v("planned"), { lines: 5 })).toBe(false);
    expect(visitHappened(v("recording"), { lines: 0 })).toBe(false);
    expect(visitHappened(v("review"), { lines: 0 })).toBe(false);
    expect(visitHappened(v("awaiting_transcript"), { lines: 0 })).toBe(false);
    expect(visitHappened(v("transcribing"), { lines: 0 })).toBe(false);
    expect(visitHappened(v("review"), { lines: 3 })).toBe(true);
    expect(visitHappened(v("recording"), { lines: 1 })).toBe(true);
    expect(visitHappened(v("confirmed"), { lines: 0 })).toBe(true);
  });

  it("superseded rows are not a transcript; a replay copy is a re-watch, never a visit", () => {
    expect(visitHappened(v("review"), { lines: [{ lang: "x-superseded" }, { lang: "x-superseded" }] })).toBe(false);
    expect(visitHappened(v("review"), { lines: [{ lang: "x-superseded" }, { lang: "en" }] })).toBe(true);
    expect(isReplayCopy({ script_section: `${COPY_PREFIX}v1` })).toBe(true);
    expect(visitHappened(v("confirmed", `${COPY_PREFIX}v1`), { lines: 12 })).toBe(false);
  });

  it("happenedVisits leaves out the empty recording and the planned follow-up", async () => {
    const scope = await blankAccount();
    const recorded = await recordV1(scope);
    // started and ended with nothing captured (a past day: today's visit is the recorded one)
    const empty = await store.upsertVisit(scope.id, { id: `empty-${randomUUID()}`, kind: "follow_up", place: "Clinic", day: scope.story_day - 3, status: "review" });
    const planned = await store.upsertVisit(scope.id, { id: `planned-${randomUUID()}`, kind: "follow_up", place: "Clinic", day: scope.story_day + 40, status: "planned" });
    const ids = (await happenedVisits(store, scope.id)).map((x) => x.id);
    expect(ids).toContain(recorded.id);
    expect(ids).not.toContain(empty.id);
    expect(ids).not.toContain(planned.id);
  });

  it("the demo's seeded visits all count", async () => {
    const s = await newSession();
    expect((await happenedVisits(store, s.id)).map((x) => x.id)).toEqual(["v1", "v2", "p1", "v3"]);
  });
});
