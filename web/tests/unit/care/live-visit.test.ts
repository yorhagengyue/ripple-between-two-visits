/**
 * His visit as it is recorded, on her phone (scene 1 of the owner's video, 2026-10-15):
 *   lib/family/events.ts      on her real account's stream: a content-free hint when his own recording starts or ends,
 *                             whatever his switches; while he shares his visit records the lines (words, times, language,
 *                             who said them), the speaker changes and Ripple's points, trimmed; nothing of it without the
 *                             switch; the demo's family phone unchanged (tests/unit/family/privacy-r2.test.ts)
 *   lib/care/live-visit.ts    the recording now (her banner) and her live view of it
 *   lib/care/home.ts          the banner on her home: once he acknowledged her link, whatever his switches; `shared`
 *                             follows his visit records switch; never a recording started more than 3 h 10 min ago
 * Mr Tan's example account, his daughter linked through an invitation he confirmed; the developer test clock, frozen.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { toSseFrame, type BusEvent } from "@/lib/bus";
import { hideOff } from "@/lib/care/hide";
import { familyHome } from "@/lib/care/home";
import { herLiveVisit, recordingNow } from "@/lib/care/live-visit";
import { familyEvent, recordingEdge } from "@/lib/family/events";
import { NO_GRANTS } from "@/lib/family/types";
import { MemoryStore } from "@/lib/store/memory";
import type { CareLinkRow, FamilyGrantItems, SessionRow } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";
import { startVisit } from "@/lib/visit/pipeline";
import { SUMMARY_ITEM_TEXT, SUMMARY_ITEM_TYPE, summaryItemId } from "@/lib/visit/summary-item";

const SECRET = "SENTINEL-the-doctor's-card-4471";
const SHARED: FamilyGrantItems = { ...NO_GRANTS, visit_transcripts: true };
const LINK = "link-1";

function ev(type: string, data: unknown): BusEvent {
  return { id: 9, type: type as BusEvent["type"], session_id: "scope-1", at: "2026-10-15T02:00:00.000Z", say: `say ${SECRET}`, data };
}

const line = { id: "v-w1", session_id: "scope-1", visit_id: "v", t_start_ms: 1000, t_end_ms: 4000, speaker_cluster: 2, role: "doctor", role_state: "inferred", text: "Good morning, Mr Tan.", lang: "en", clip_path: `${SECRET}.wav`, scripted_fallback: false, created_at: "x" };

describe("her stream, while he records a visit", () => {
  it("with his visit records on: the lines, the speakers and Ripple's points, trimmed to what her live view shows", () => {
    const final = familyEvent(ev("asr.final", { visit_id: "v", utterances: [line], view: { cards: [{ quote: SECRET }] } }), SHARED, LINK);
    expect(final.kind).toBe("trimmed");
    expect(final.event!.data).toEqual({ visit_id: "v", utterances: [{ id: "v-w1", text: "Good morning, Mr Tan.", lang: "en", t_start_ms: 1000, t_end_ms: 4000, role: "doctor", role_state: "inferred" }] });
    const role = familyEvent(ev("utterance.role", { visit_id: "v", changes: [{ id: "v-w1", role: "family", state: "inferred" }], view: { cards: [{ quote: SECRET }] } }), SHARED, LINK);
    expect(role.event!.data).toEqual({ visit_id: "v", changes: [{ id: "v-w1", role: "family", state: "inferred" }] });
    const summary = familyEvent(ev("visit.summary", { visit_id: "v", stage: "live", lang: "en", points: [{ text: "The doctor checked his blood pressure.", lines: ["v-w1"] }], at: "t" }), SHARED, LINK);
    expect(summary.event!.data).toEqual({ visit_id: "v", stage: "live", lang: "en", points: [{ text: "The doctor checked his blood pressure." }], at: "t" });
    const partial = familyEvent(ev("asr.partial", { visit_id: "v", utterance: { id: "v-w2", text: "Please", t_start_ms: 5000, speaker_cluster: null, lang: "en" }, source: "whisper" }), SHARED, LINK);
    expect(partial.event!.data).toEqual({ visit_id: "v", utterance: { id: "v-w2", text: "Please", lang: "en", t_start_ms: 5000 } });
    for (const r of [final, role, summary, partial]) {
      const frame = toSseFrame(r.event!);
      expect(frame).not.toContain(SECRET);
      expect(r.event!.say).toBe("");
    }
  });

  it("without them: none of it; the demo's family phone gets none of it either", () => {
    for (const type of ["asr.final", "asr.partial", "utterance.role", "visit.summary"]) {
      const data = { visit_id: "v", utterances: [line], utterance: line, changes: [{ id: "v-w1", role: "doctor", state: "inferred" }], points: [{ text: "x" }] };
      expect(familyEvent(ev(type, data), NO_GRANTS, LINK)).toEqual({ kind: "dropped", event: null });
      expect(familyEvent(ev(type, data), SHARED).kind).toBe("dropped");
    }
  });

  it("his own recording starting or ending is a content-free hint whatever his switches; a sample replay or another change of a visit is not", () => {
    const start = ev("visit.changed", { visit: { id: "v", status: "recording", place: SECRET }, mode: "record" });
    const end = ev("visit.changed", { visit: { id: "v", status: "transcribing" }, job_id: "j1" });
    const waits = ev("visit.changed", { visit: { id: "v", status: "awaiting_transcript" }, awaiting_transcript: true });
    for (const e of [start, end, waits]) {
      expect(recordingEdge(e)).toBe(true);
      expect(familyEvent(e, NO_GRANTS, LINK)).toEqual({ kind: "hint", event: { id: 9, type: "visit.changed", session_id: "scope-1", at: e.at, say: "", data: {} } });
    }
    const sample = ev("visit.changed", { visit: { id: "v1", status: "recording" }, mode: "replay", sample: true });
    const planned = ev("visit.changed", { visit: { id: "f", status: "planned" }, planned_from: "v" });
    for (const e of [sample, planned]) {
      expect(recordingEdge(e)).toBe(false);
      expect(familyEvent(e, NO_GRANTS, LINK).kind).toBe("dropped");
    }
    // the demo's family phone, as before: a visit change is a hint only with a section that shows it
    expect(familyEvent(start, NO_GRANTS).kind).toBe("dropped");
  });
});

// ------------------------------------------------------------------ the banner and the live view

const store = new MemoryStore();
const auth = getAuthProvider();
let him: TestAccount;
let link: CareLinkRow;
const T0 = "2026-10-15T09:30:00+08:00";

const scope = async (): Promise<SessionRow> => (await store.getSession(him.userId))!;

beforeAll(async () => {
  setTestClock({ at: T0, frozen: true });
  him = await createAccountWithSpace(store, auth, { login: `lv${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  const her = await createAccountWithSpace(store, auth, { login: `lw${randomUUID().slice(0, 10)}`, password: "a long test password", space: "none" });
  const inv = await store.createInvite({ patient_id: him.userId, patient_label: "爸爸", invite_token_hash: randomUUID(), invite_expires_at: "2099-01-01T00:00:00.000Z" }, NO_GRANTS);
  if (!inv.ok) throw new Error(inv.code);
  const acc = await store.acceptInvite(inv.link.invite_token_hash!, her.userId, "Wei Ling");
  if (!acc.ok) throw new Error(acc.code);
  const ok = await store.confirmLink(inv.link.id, him.userId, true);
  if (!ok.ok) throw new Error(ok.code);
  link = ok.link;
});
afterAll(() => setTestClock(null));

describe("her home and her live view", () => {
  it("while he records: the banner, whatever his switches (`shared` with his visit records); the live view's lines only with them", async () => {
    const s = await scope();
    const now = Date.parse(T0);
    const before = await familyHome(store, s, { link, grants: NO_GRANTS, acknowledged: true }, now);
    expect(before.liveVisit ?? null).toBeNull();
    const visit = await startVisit(store, s, { mode: "record", consent: { given: true } });
    await store.addUtterances(s.id, visit.id, [{ id: `${visit.id}-w1`, t_start_ms: 1000, t_end_ms: 3000, text: "Dad, sit here.", role: "family", role_state: "inferred", lang: "en" }]);
    const off = await familyHome(store, s, { link, grants: NO_GRANTS, acknowledged: true }, now + 60_000);
    expect(off.liveVisit).toEqual({ id: visit.id, startedAt: expect.any(String), shared: false });
    const on = await familyHome(store, s, { link, grants: SHARED, acknowledged: true }, now + 60_000);
    expect(on.liveVisit?.shared).toBe(true);
    // he switches his visit records off while she looks: the banner only says it is being recorded
    expect(hideOff(on, NO_GRANTS).liveVisit?.shared).toBe(false);
    // not before he acknowledged her link
    expect((await familyHome(store, s, { link, grants: SHARED, acknowledged: false }, now)).liveVisit ?? null).toBeNull();

    const shown = await herLiveVisit(store, s, visit.id, SHARED, now + 60_000);
    expect(shown).toMatchObject({ state: "recording", shared: true, lines: [{ text: "Dad, sit here.", role: "family", roleState: "inferred" }] });
    const hidden = await herLiveVisit(store, s, visit.id, NO_GRANTS, now + 60_000);
    expect(hidden).toMatchObject({ state: "recording", shared: false, lines: [], summary: null });

    // a recording left running for more than three hours and ten minutes is not "now"
    expect(await recordingNow(store, s, now + 3 * 3600_000 + 11 * 60_000)).toBeNull();

    // it ends: no banner; the live view says so, sends no lines, and shows the final summary once it is made
    await store.updateVisit(s.id, visit.id, { status: "review" });
    expect((await familyHome(store, s, { link, grants: SHARED, acknowledged: true }, now + 120_000)).liveVisit ?? null).toBeNull();
    await store.addVisitItems(s.id, visit.id, [
      { id: summaryItemId(visit.id), type: SUMMARY_ITEM_TYPE, text: SUMMARY_ITEM_TEXT, utterance_ids: [], slots: { variant: "ripple_summary", summary: { stage: "final", lang: "en", points: [{ text: "The doctor raised the dose.", lines: [] }], made_at: "t" } }, confirmed_by: null, speaker: null },
    ]);
    const ended = await herLiveVisit(store, s, visit.id, SHARED, now + 120_000);
    expect(ended).toMatchObject({ state: "ended", lines: [], summary: { stage: "final", lang: "en", points: ["The doctor raised the dose."] } });
    // the example's sample visit is never "his visit, live"
    expect((await herLiveVisit(store, s, "v3", SHARED, now)).state).toBe("missing");
  });
});
