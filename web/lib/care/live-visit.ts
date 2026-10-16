/**
 * His visit as it is being recorded, on her phone (scene 1 of the owner's video, 2026-10-15: "Dad, we need to see the
 * doctor today"; in the doctor's room his phone records, and hers shows the visit live at the same time). Server-only.
 *
 *   recordingNow   whether he is recording a visit of his own right now (not the example's sample, not a replay), and
 *                  since when: her home's banner. Said whatever his switches (the owner's decision: without his visit
 *                  records her banner says that the visit is being recorded, and nothing more), once he has acknowledged
 *                  her link and while it does not wait for the family text in force (lib/care/home.ts). A recording
 *                  that started more than LIVE_VISIT_MAX_MS ago is not "now" (a recording ends itself after three
 *                  hours: a visit left recording by a closed page is not being recorded)
 *   herLiveVisit   her live view of one visit, as it opens and when her stream says the recording started or ended:
 *                  its state and running time; while he shares his visit records (visit_transcripts) and the visit
 *                  records, every line heard so far with who said it (Ripple's guess: "inferred" until he checks it) and
 *                  Ripple's live summary; after the recording, the final summary once it is made. After the recording
 *                  the lines are not sent again: what she may read of the visit then is its record (only the
 *                  clinicians' words he confirmed: lib/care/shared.ts), and the live view links there
 * The live events themselves reach her page through her stream (lib/family/events.ts, the same switch).
 */
import type { FamilyGrantItems, RoleState, SessionRow, Store, UtteranceRole, VisitRow } from "@/lib/store/types";
import { isReplayCopy } from "@/lib/visit/happened";
import { liveSummaryOf } from "@/lib/visit/ripple-summary";
import { SUPERSEDED_LANG } from "@/lib/visit/state";
import { storedSummary } from "@/lib/visit/summary-item";

/** A recording that started longer ago than this is not being recorded now (three hours and ten minutes). */
export const LIVE_VISIT_MAX_MS = 3 * 3600_000 + 10 * 60_000;

export interface LiveVisitNow {
  id: string;
  /** when the recording started (ISO; the doctor's yes on the consent card), null when unknown */
  startedAt: string | null;
}

export interface HerLiveLine {
  id: string;
  text: string;
  lang: string | null;
  role: UtteranceRole;
  roleState: RoleState;
  tStartMs: number;
  tEndMs: number;
}

export interface HerLiveSummary {
  stage: "live" | "final";
  lang: "en" | "zh-Hans";
  points: string[];
}

export interface HerLiveVisit {
  visitId: string;
  /** recording: being recorded now; ended: the recording is over; missing: no such visit of his to show */
  state: "recording" | "ended" | "missing";
  startedAt: string | null;
  /** his visit records switch for her link: without it, nothing of what is said */
  shared: boolean;
  lines: HerLiveLine[];
  summary: HerLiveSummary | null;
  /** the server's clock when built (ms): the page's running time is counted from it */
  generatedAt: number;
}

/** A visit of his own recording: not the example's sample visit (it has a replay of its own), not a replay copy. */
const ownRecording = (v: VisitRow) => !isReplayCopy(v) && !v.audio_fixture;

/** When the recording of `v` started: the consent the recording began with (its wall clock), else the row's own. */
async function startedAtOf(store: Pick<Store, "listVisitItems">, scopeId: string, v: VisitRow): Promise<string | null> {
  const items = await store.listVisitItems(scopeId, { visit_id: v.id });
  const at = items.find((i) => i.id === `${v.id}-consent-screen`)?.slots?.at;
  return typeof at === "string" ? at : (v.created_at ?? null);
}

/** The visit he is recording now, if any (see the header). */
export async function recordingNow(store: Pick<Store, "listVisits" | "listVisitItems">, scope: Pick<SessionRow, "id">, nowMs: number, visits?: VisitRow[]): Promise<LiveVisitNow | null> {
  const all = visits ?? (await store.listVisits(scope.id));
  const v = all.filter((x) => x.status === "recording" && ownRecording(x)).sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
  if (!v) return null;
  const startedAt = await startedAtOf(store, scope.id, v);
  if (startedAt && nowMs - Date.parse(startedAt) > LIVE_VISIT_MAX_MS) return null;
  return { id: v.id, startedAt };
}

/** Her live view of one visit of his (see the header). */
export async function herLiveVisit(
  store: Pick<Store, "getVisit" | "listVisitItems" | "listUtterances">,
  scope: Pick<SessionRow, "id">,
  visitId: string,
  grants: Pick<FamilyGrantItems, "visit_transcripts">,
  nowMs: number,
): Promise<HerLiveVisit> {
  const shared = grants.visit_transcripts === true;
  const none: HerLiveVisit = { visitId, state: "missing", startedAt: null, shared, lines: [], summary: null, generatedAt: nowMs };
  const v = await store.getVisit(scope.id, visitId);
  if (!v || !ownRecording(v) || v.status === "planned") return none;
  const recording = v.status === "recording";
  const [startedAt, items, rows] = await Promise.all([
    startedAtOf(store, scope.id, v),
    shared && !recording ? store.listVisitItems(scope.id, { visit_id: v.id }) : Promise.resolve(null),
    shared && recording ? store.listUtterances(scope.id, v.id) : Promise.resolve([]),
  ]);
  const out: HerLiveVisit = { ...none, state: recording ? "recording" : "ended", startedAt };
  if (!shared) return out;
  out.lines = rows
    .filter((u) => u.lang !== SUPERSEDED_LANG && u.text.trim())
    .map((u) => ({ id: u.id, text: u.text, lang: u.lang, role: u.role, roleState: u.role_state, tStartMs: u.t_start_ms, tEndMs: u.t_end_ms }));
  if (recording) {
    const live = liveSummaryOf(scope.id, v.id);
    if (live?.points.length) out.summary = { stage: "live", lang: live.locale === "en" ? "en" : "zh-Hans", points: live.points.map((p) => p.text) };
  } else {
    const kept = items ? storedSummary(items, v.id) : null;
    if (kept) out.summary = { stage: "final", lang: kept.lang, points: kept.points.map((p) => p.text) };
  }
  return out;
}
