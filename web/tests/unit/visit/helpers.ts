/**
 * Shared helpers for the M2 visit tests. Tests (not app code) may read the answer files
 * web/fixtures/visits/<visit>.expected.json to compare the app's output against them.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect } from "vitest";
import { fixtureUtterances } from "@/lib/asr";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow, VisitItemRow } from "@/lib/store/types";
import { finalizeVisit, processChunk, startVisit } from "@/lib/visit/pipeline";
import { getSpeechProvider } from "@/lib/asr";
import type { CheckCardView, VisitView } from "@/lib/visit/types";

export interface ExpectedAnswer {
  id: string;
  true_role: string;
  speaker_name: string;
  expected_item: string;
  required_line: string | null;
}

export function expectedAnswers(visit: string): ExpectedAnswer[] {
  const file = path.join(process.cwd(), "fixtures", "visits", `${visit}.expected.json`);
  return (JSON.parse(readFileSync(file, "utf8")) as { answers: ExpectedAnswer[] }).answers;
}

/** What one expected_item asks for, read from its Chinese category words. */
export type Expectation =
  | { kind: "item"; type: VisitItemRow["type"] }
  | { kind: "check" }
  | { kind: "unknown_med" }
  | { kind: "qlist" }
  | { kind: "none" };

const CATEGORY: Record<string, Expectation> = {
  同意: { kind: "item", type: "consent" },
  读数: { kind: "item", type: "reading" },
  指示: { kind: "item", type: "instruction" },
  生活方式: { kind: "item", type: "lifestyle" },
  目标: { kind: "item", type: "target" },
  警示线: { kind: "item", type: "threshold" },
  复诊: { kind: "item", type: "follow_up" },
  问题: { kind: "item", type: "question" },
  回答: { kind: "item", type: "answer" },
  回答已存: { kind: "item", type: "answer" },
  病情: { kind: "item", type: "diagnosis" },
  用药: { kind: "item", type: "medication" },
  用途和理由: { kind: "item", type: "purpose" },
  检查: { kind: "item", type: "test" },
  用法: { kind: "item", type: "instruction" },
  漏服: { kind: "item", type: "instruction" },
  "teach-back": { kind: "item", type: "answer" },
  药单: { kind: "item", type: "question" },
  核对卡: { kind: "check" },
  "app": { kind: "unknown_med" },
  问题列表出现: { kind: "qlist" },
};

/** "指示：每周量两次；复诊：五周后" -> [instruction, follow_up]; "—" -> [none]. */
export function expectationsOf(expectedItem: string): Expectation[] {
  const text = expectedItem.trim();
  if (text === "—" || text === "" || text.startsWith("（")) return [{ kind: "none" }];
  const out: Expectation[] = [];
  for (const part of text.split("；")) {
    const head = part.trim().split(/[：（\s]/)[0];
    const e = CATEGORY[head];
    if (e) out.push(e);
  }
  if (out.length === 0) throw new Error(`No category for expected item "${expectedItem}"`);
  return out;
}

export async function newSession(opts: { story_day?: number; filming?: boolean } = {}): Promise<SessionRow> {
  return getMemoryStore().createSession({
    story_day: opts.story_day ?? 29,
    filming_mode: opts.filming ?? false,
    ttl_hours: opts.filming ? null : 48,
  });
}

/**
 * Replays a sample visit through the real pipeline without timers: start, then one processChunk per sentence
 * (what the realtime replay does at each sentence end), optionally batched into windows of `windowMs`.
 */
export async function replayLive(session: SessionRow, visit: string, windowMs = 0): Promise<VisitView> {
  await startVisit(getMemoryStore(), session, { mode: "replay", fixture: visit });
  const lines = fixtureUtterances(visit)!;
  let view: VisitView | null = null;
  let batch: typeof lines = [];
  let batchStart = 0;
  for (const u of lines) {
    if (batch.length === 0) batchStart = u.t_start_ms;
    batch.push(u);
    if (windowMs === 0 || u.t_end_ms - batchStart >= windowMs) {
      view = (await processChunk(getMemoryStore(), session, visit, batch)).view;
      batch = [];
    }
  }
  if (batch.length) view = (await processChunk(getMemoryStore(), session, visit, batch)).view;
  return view!;
}

/** The whole-visit pass after the live replay (mock speech job, no recording). */
export async function finalizeReplay(session: SessionRow, visit: string): Promise<VisitView> {
  process.env.MOCK_ASR_JOB_MS = "0";
  const speech = getSpeechProvider();
  const { jobId } = await speech.createFileJob({ url: `fixture:${visit}`, lang: "zh-en-mixed", fixture: visit });
  const job = await speech.getFileJob(jobId);
  return finalizeVisit(getMemoryStore(), session, visit, job);
}

export async function visitItems(sessionId: string, visit: string): Promise<VisitItemRow[]> {
  return (await getMemoryStore().listVisitItems(sessionId, { visit_id: visit })).filter(
    (it) => it.slots?.superseded !== true && it.slots?.rejected !== true,
  );
}

/** Check cards hanging on one line. */
export function checksOn(view: VisitView, anchor: string): CheckCardView[] {
  return view.cards.filter((c): c is CheckCardView => c.kind === "chk" && c.anchor === anchor);
}

/** Roles of every line, the items each expected_item asks for, check cards, the question list and R1-R4 against the answer file. */
export async function assertAgainstAnswers(visit: string, view: VisitView, sessionId: string) {
  const items = await visitItems(sessionId, visit);
  const answers = expectedAnswers(visit);
  const lineRole = new Map(view.lines.map((l) => [l.id, l.role]));
  const problems: string[] = [];
  for (const a of answers) {
    if (lineRole.get(a.id) !== a.true_role) problems.push(`${a.id}: role ${lineRole.get(a.id)}, expected ${a.true_role}`);
    const mine = items.filter((it) => it.utterance_ids.includes(a.id));
    for (const e of expectationsOf(a.expected_item)) {
      if (e.kind === "item" && !mine.some((it) => it.type === e.type)) {
        problems.push(`${a.id}: no ${e.type} item (has ${mine.map((m) => m.type).join(", ") || "none"}) for "${a.expected_item}"`);
      }
      if (e.kind === "none" && mine.length > 0) problems.push(`${a.id}: expected no item, got ${mine.map((m) => m.type).join(", ")}`);
      if (e.kind === "check" && checksOn(view, a.id).length === 0) problems.push(`${a.id}: no check card for "${a.expected_item}"`);
      if (e.kind === "qlist" && view.qlist?.anchor !== a.id) problems.push(`${a.id}: question list anchored at ${view.qlist?.anchor}`);
      if (e.kind === "unknown_med" && !view.cards.some((c) => c.kind === "chk" && c.check === "unknown_med")) {
        problems.push(`${a.id}: no unknown-medicine card`);
      }
    }
    if (a.required_line) {
      const r = mine.find((it) => it.required_line === a.required_line);
      if (!r) problems.push(`${a.id}: required line ${a.required_line} not extracted`);
    }
  }
  expect(problems).toEqual([]);
}
