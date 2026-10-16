/**
 * What the server half of his visit page hands the phone (components/visit/elder/pages.tsx AccountVisitPage, C2 track
 * V), and Today's row for a visit waiting for its text (TodayVisitWaiting):
 *   - every unfinished visit has its row (the list is not cut), and one whose transcript the server gave up on says so;
 *   - every visit of his is in `known`, with the recording's path the server has: what the phone's kept copies are
 *     judged by (kept.ts), never the rows shown;
 *   - the name his kept copies are filed under is the one-way stand-in of his space, not his scope or user id, and
 *     another account's is different;
 *   - a planned follow-up has its own row: 「今天的复诊（计划）」 on the day, 「大约 …」 while the day is the doctor's
 *     "about", the plain date once he set the day he booked; not one that has passed; never bookable for the sample;
 *   - `assisted` is what sign-up recorded; `speech` is this server's provider.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AccountVisitFlow } from "@/components/visit/elder/AccountVisitFlow";
import { classifyKept } from "@/components/visit/elder/kept";
import { AccountVisitPage } from "@/components/visit/elder/pages";
import { visitsWaiting } from "@/components/visit/elder/TodayVisitWaiting";
import { getSpeechProvider } from "@/lib/asr";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { blobPrefix } from "@/lib/blob";
import { getMemoryStore } from "@/lib/store/memory";
import { scopeD0 } from "@/lib/store/scope";
import type { SessionRow } from "@/lib/store/types";
import type { PageSubject } from "@/lib/subject";
import { setTestClock } from "@/lib/time/now";
import { finalizeVisit, rescheduleFollowUp, setItemVerdict, startVisit } from "@/lib/visit/pipeline";
import { MAX_TRANSCRIPT_SENDS, TRANSCRIPT_TRY } from "@/lib/visit/transcript-tries";

type FlowProps = Parameters<typeof AccountVisitFlow>[0];

const store = getMemoryStore();

beforeAll(() => {
  process.env.MOCK_ASR_JOB_MS = "0";
  delete process.env.SPEECH_PROVIDER;
});
afterEach(() => {
  setTestClock(null);
  delete process.env.SPEECH_PROVIDER;
});

async function account(space: "blank" | "example" = "blank", opts: { assisted?: boolean } = {}): Promise<{ scope: SessionRow; userId: string }> {
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `vp${randomUUID().slice(0, 10)}`, password: "a long test password", space });
  if (opts.assisted) {
    await store.addConsentRecord({ user_id: a.userId, scope_id: a.scope!.id, kind: "terms_privacy", decision: "granted", version: "2026-10-10", text_sha256: "x", method: "signup_screen", evidence: null, assisted: true });
  }
  return { scope: (await store.getSession(a.scope!.id))!, userId: a.userId };
}

/** The props the page's server half hands the flow (his own page: the scope's store, its session, its first day). */
async function pageProps(scopeId: string, visitParam: string | null = null): Promise<FlowProps> {
  const session = (await store.getSession(scopeId))!;
  const ctx = { store, session, d0: scopeD0(session) } as unknown as PageSubject;
  const el = await AccountVisitPage({ ctx, locale: "zh-Hans", visitParam, speed: 1 });
  return el.props as FlowProps;
}

async function fixtureJob(fixture: string) {
  const speech = getSpeechProvider();
  const { jobId } = await speech.createFileJob({ url: `fixture:${fixture}`, lang: "zh-en-mixed", fixture });
  return speech.getFileJob(jobId);
}

describe("the unfinished visits and what the phone's kept copies are judged by", () => {
  it("seven unfinished visits: seven rows, and all seven in `known`", async () => {
    setTestClock({ at: "2026-10-12T09:30:00+08:00", frozen: false });
    const { scope } = await account();
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push((await startVisit(store, scope, { mode: "record", consent: { given: true } })).id);
    const props = await pageProps(scope.id);
    expect(props.unfinished.map((u) => u.id).sort()).toEqual([...ids].sort());
    expect(props.unfinished.every((u) => u.status === "recording" && u.date === "10月12日" && !u.failed)).toBe(true);
    expect(props.known.map((k) => k.id).sort()).toEqual([...ids].sort());
    // a copy kept for any of them is offered, the oldest one too (it used to be deleted for being off the list)
    for (const id of ids) expect(classifyKept(props.known.find((k) => k.id === id))).toBe("offer");
    // a copy whose visit is not his is held: kept, not offered
    expect(classifyKept(props.known.find((k) => k.id === "someone-elses-visit"))).toBe("hold");
  });

  it("`known` carries the recording's path the server has, and an ended visit with nothing at all is marked empty", async () => {
    const { scope } = await account();
    const withAudio = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    const path = `${blobPrefix(scope)}/visits/${withAudio.id}/recording-1.wav`;
    await store.updateVisit(scope.id, withAudio.id, { status: "awaiting_transcript", audio_path: path });
    const waiting = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    await store.updateVisit(scope.id, waiting.id, { status: "awaiting_transcript" });
    const nothing = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    await store.updateVisit(scope.id, nothing.id, { status: "review" });
    const props = await pageProps(scope.id);
    const of = (id: string) => props.known.find((k) => k.id === id)!;
    expect(of(withAudio.id)).toEqual({ id: withAudio.id, status: "awaiting_transcript", audioPath: path });
    expect(classifyKept(of(withAudio.id))).toBe("saved");
    expect(of(waiting.id)).toEqual({ id: waiting.id, status: "awaiting_transcript", audioPath: null });
    expect(classifyKept(of(waiting.id))).toBe("offer");
    expect(of(nothing.id)).toEqual({ id: nothing.id, status: "review", audioPath: null, empty: true });
    expect(classifyKept(of(nothing.id))).toBe("offer");
  });

  it("a visit whose transcript the server gave up on says so on its row and on Today; one still waiting does not", async () => {
    const { scope } = await account();
    const gaveUp = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    const waiting = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    for (const v of [gaveUp, waiting]) await store.updateVisit(scope.id, v.id, { status: "awaiting_transcript", audio_path: `${blobPrefix(scope)}/visits/${v.id}/r.wav` });
    for (let n = 1; n <= MAX_TRANSCRIPT_SENDS; n++) await store.recordDelivery(scope.id, { kind: TRANSCRIPT_TRY, ref: gaveUp.id, day: gaveUp.day, slot: String(n) });
    await store.recordDelivery(scope.id, { kind: TRANSCRIPT_TRY, ref: waiting.id, day: waiting.day, slot: "1" });
    const props = await pageProps(scope.id);
    expect(props.unfinished.find((u) => u.id === gaveUp.id)).toMatchObject({ status: "awaiting_transcript", failed: true });
    expect(props.unfinished.find((u) => u.id === waiting.id)?.failed).toBeUndefined();
    const today = await visitsWaiting(store, scope.id);
    expect(today.map((v) => [v.id, v.failed]).sort()).toEqual(
      [
        [gaveUp.id, true],
        [waiting.id, false],
      ].sort(),
    );
    // and no waiting visit: no row, no read of the attempts
    const other = await account();
    expect(await visitsWaiting(store, other.scope.id)).toEqual([]);
  });

  it("an empty account has no rows at all (the phone shows 「暂无就诊记录」)", async () => {
    const { scope } = await account();
    const props = await pageProps(scope.id);
    expect([props.unfinished, props.planned, props.past, props.known]).toEqual([[], [], [], []]);
    expect(props.sample).toBeNull();
    expect(props.initialView).toBeNull();
  });
});

describe("the name his kept copies are filed under", () => {
  it("is the one-way stand-in of his space: not his scope id, not his user id, and another account's is different", async () => {
    const a = await account();
    const b = await account();
    const [pa, pb] = [await pageProps(a.scope.id), await pageProps(b.scope.id)];
    expect(pa.owner).toBe(blobPrefix(a.scope));
    expect(pa.owner).not.toBe(pb.owner);
    for (const secret of [a.scope.id, a.userId]) expect(pa.owner.includes(secret)).toBe(false);
    expect(pa.owner.length).toBeGreaterThan(16);
    // the same account, asked again: the same name (the copies are found again after a reload)
    expect((await pageProps(a.scope.id)).owner).toBe(pa.owner);
  });
});

describe("a planned follow-up has its own row", () => {
  it("「大约 …」 from the doctor's line, the plain date once he set the day he booked, 「今天的复诊（计划）」 on the day; gone once recorded", async () => {
    setTestClock({ at: "2026-10-12T09:30:00+08:00", frozen: true });
    const { scope } = await account();
    const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    await finalizeVisit(store, scope, visit.id, await fixtureJob("v1"));
    const followUp = (await store.listVisitItems(scope.id, { visit_id: visit.id })).find((i) => i.type === "follow_up")!;
    await setItemVerdict(store, scope, visit.id, { items: [followUp.id], verdict: "right" });
    let props = await pageProps(scope.id);
    expect(props.planned.length).toBe(1);
    const row = props.planned[0];
    expect(row).toMatchObject({ today: false, canBook: true });
    expect(row.label).toBe(`大约 ${Number(row.date.slice(5, 7))}月${Number(row.date.slice(8, 10))}日的复诊（计划）`);
    expect(props.today).toBe("2026-10-12");
    // not a visit that happened, and not an unfinished one
    expect(props.unfinished.some((u) => u.id === row.id)).toBe(false);
    expect(props.past.some((p) => p.id === row.id)).toBe(false);
    expect(props.known.find((k) => k.id === row.id)).toMatchObject({ status: "planned", audioPath: null });

    // he booked the 21st
    await rescheduleFollowUp(store, (await store.getSession(scope.id))!, row.id, "2026-10-21");
    props = await pageProps(scope.id);
    expect(props.planned[0]).toMatchObject({ id: row.id, date: "2026-10-21", today: false, label: "10月21日的复诊（计划）" });

    // the day comes
    setTestClock({ at: "2026-10-21T09:00:00+08:00", frozen: true });
    props = await pageProps(scope.id);
    expect(props.planned[0]).toMatchObject({ id: row.id, today: true, label: "今天的复诊（计划）", canBook: true });
    expect(props.today).toBe("2026-10-21");

    // at the clinic that day the recording goes onto that row: no longer a plan
    const session = (await store.getSession(scope.id))!;
    const started = await startVisit(store, session, { mode: "record", consent: { given: true }, place: "clinic" });
    expect(started.id).toBe(row.id);
    props = await pageProps(scope.id);
    expect(props.planned).toEqual([]);
    expect(props.unfinished.map((u) => u.id)).toContain(row.id);
  });

  it("a planned day that has passed has no row; the example's follow-up today is a planned row whose day is not his to set", async () => {
    setTestClock({ at: "2026-10-12T09:30:00+08:00", frozen: true });
    const { scope } = await account();
    await store.upsertVisit(scope.id, { id: `p-${randomUUID()}`, kind: "follow_up", place: "Clinic", day: scope.story_day - 3, status: "planned" });
    await store.upsertVisit(scope.id, { id: `p-${randomUUID()}`, kind: "follow_up", place: "Clinic", day: scope.story_day + 9, status: "planned" });
    const props = await pageProps(scope.id);
    expect(props.planned.length).toBe(1);
    // no doctor's "about" behind it: the plain date
    expect(props.planned[0].label).toBe("10月21日的复诊（计划）");

    const example = await account("example");
    const ex = await pageProps(example.scope.id);
    expect(ex.planned.map((p) => [p.label, p.today, p.canBook])).toEqual([["今天的复诊（计划）", true, false]]);
    // the sample entry is its own thing, next to the row
    expect(ex.sample).not.toBeNull();
  });
});

describe("what goes with the doctor's answer, and what this server can do", () => {
  it("`assisted` is what sign-up recorded", async () => {
    const alone = await account();
    const helped = await account("blank", { assisted: true });
    expect((await pageProps(alone.scope.id)).assisted).toBe(false);
    expect((await pageProps(helped.scope.id)).assisted).toBe(true);
  });

  it("`speech` is this server's provider; a setting nobody can read counts as none", async () => {
    const { scope } = await account();
    expect((await pageProps(scope.id)).speech).toBe("mock");
    process.env.SPEECH_PROVIDER = "whisper";
    expect((await pageProps(scope.id)).speech).toBe("whisper");
    process.env.SPEECH_PROVIDER = "not-a-provider";
    expect((await pageProps(scope.id)).speech).toBe("mock");
  });
});

describe("the timeline layout's small pieces (web/progress/fe-05.md)", () => {
  it("an unfinished row says when it is a replay of the example's sample visit; his own recording never does", async () => {
    setTestClock({ at: "2026-10-12T09:30:00+08:00", frozen: true });
    const example = await account("example");
    // the sample visit played and left before its end, and a recording of his own on the same day
    await startVisit(store, example.scope, { mode: "replay", fixture: "v3" });
    const own = await startVisit(store, (await store.getSession(example.scope.id))!, { mode: "record", consent: { given: true }, place: "pharmacy" });
    const props = await pageProps(example.scope.id);
    expect(props.unfinished.find((u) => u.id === "v3")).toMatchObject({ status: "recording", sample: true });
    const ownRow = props.unfinished.find((u) => u.id === own.id);
    expect(ownRow).toMatchObject({ status: "recording" });
    expect(ownRow?.sample).toBeUndefined();
    // a blank account's rows never carry it
    const { scope } = await account();
    await startVisit(store, scope, { mode: "record", consent: { given: true } });
    expect((await pageProps(scope.id)).unfinished.every((u) => u.sample === undefined)).toBe(true);
  });

  it("an earlier visit's row carries its date and its place apart (the stored default place in the screen's language)", async () => {
    setTestClock({ at: "2026-10-12T09:30:00+08:00", frozen: true });
    const { scope } = await account();
    const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    await finalizeVisit(store, scope, visit.id, await fixtureJob("v1"));
    await store.updateVisit(scope.id, visit.id, { status: "confirmed" });
    const props = await pageProps(scope.id);
    expect(props.past).toEqual([{ id: visit.id, label: "10月12日 · Clinic", date: "10月12日", place: "诊所" }]);
  });

  it("`clinic` is the name a clinic visit recorded now is filed under: his own clinic, or today's planned follow-up's place; none when only the stored default is there", async () => {
    setTestClock({ at: "2026-10-12T09:30:00+08:00", frozen: true });
    // he never told the app his clinic: no name (the screen says 「诊所」), and the visit is filed under the stored default
    const { scope } = await account();
    expect((await pageProps(scope.id)).clinic).toBeNull();
    // he told the app: that name, and it is the place the visit he records gets
    await store.updateScope(scope.id, { settings: { clinic: "Blossom Family Clinic" } });
    expect((await pageProps(scope.id)).clinic).toBe("Blossom Family Clinic");
    const started = await startVisit(store, (await store.getSession(scope.id))!, { mode: "record", consent: { given: true }, place: "clinic" });
    expect(started.place).toBe("Blossom Family Clinic");

    // a follow-up planned for today is the row a clinic recording continues: its own place counts, as startVisit has it
    const other = await account();
    await store.updateScope(other.scope.id, { settings: { clinic: "Blossom Family Clinic" } });
    await store.upsertVisit(other.scope.id, { id: `p-${randomUUID()}`, kind: "follow_up", place: "Sunrise Polyclinic", day: other.scope.story_day, status: "planned" });
    expect((await pageProps(other.scope.id)).clinic).toBe("Sunrise Polyclinic");
    const onPlan = await startVisit(store, (await store.getSession(other.scope.id))!, { mode: "record", consent: { given: true }, place: "clinic" });
    expect(onPlan.place).toBe("Sunrise Polyclinic");

    // the example's follow-up today is the sample (played, never recorded on): his own recording gets the clinic of his settings
    const example = await account("example");
    const ex = await pageProps(example.scope.id);
    const own = await startVisit(store, (await store.getSession(example.scope.id))!, { mode: "record", consent: { given: true }, place: "clinic" });
    expect(ex.clinic === null ? "Clinic" : ex.clinic).toBe(own.place);
  });

  it("Today lists a review he has not finished (and whether the server has its recording); not a visit with nothing recorded, not the sample replay", async () => {
    setTestClock({ at: "2026-10-12T09:30:00+08:00", frozen: true });
    const { scope } = await account();
    const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    await finalizeVisit(store, scope, visit.id, await fixtureJob("v1"));
    // ended with nothing at all: not a review to finish
    const nothing = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    await store.updateVisit(scope.id, nothing.id, { status: "review" });
    expect(await visitsWaiting(store, scope.id)).toEqual([{ id: visit.id, date: visit.date, failed: false, review: true, recorded: false }]);
    await store.updateVisit(scope.id, visit.id, { audio_path: `${blobPrefix(scope)}/visits/${visit.id}/r.wav` });
    expect(await visitsWaiting(store, scope.id)).toEqual([{ id: visit.id, date: visit.date, failed: false, review: true, recorded: true }]);
    // once he confirmed it, it is done
    await store.updateVisit(scope.id, visit.id, { status: "confirmed" });
    expect(await visitsWaiting(store, scope.id)).toEqual([]);

    // the example's sample visit, played to its review: a replay, never his to finish from Today
    const example = await account("example");
    await startVisit(store, example.scope, { mode: "replay", fixture: "v3" });
    await finalizeVisit(store, example.scope, "v3", await fixtureJob("v3"));
    expect((await store.getVisit(example.scope.id, "v3"))?.status).toBe("review");
    expect(await visitsWaiting(store, example.scope.id)).toEqual([]);
  });
});
