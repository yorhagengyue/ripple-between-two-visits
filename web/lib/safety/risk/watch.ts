/**
 * The watch state (the guided safety harness, step 7; risk/types.ts): it follows him across turns and days, and with it any
 * question about how much medicine is too much goes up the self-harm ladder instead of to the doctor's question list. It is
 * derived ONLY from his own recent safety records (store.listSafetyEvents: the safety_event rows pipeline.ts writes for each
 * of his asks), never stored anywhere of its own, so it cannot drift from what happened and it ends by itself.
 *
 * What a record says: the engine writes output.risk (a RiskSummary: its ladder step, the decision-table row ids that fired,
 * the frame's codes); a record written before the harness has only its route ("self_harm" when the old rules or the crisis
 * screen routed it there).
 *
 * The rule (10-16; an ASSUMPTION the hazard log carries: no vendor or paper publishes how long such a state should last or
 * how it should end, the research report's "「当天」没有依据" and its P1 row 「留意状态跨天并写明退出规则」):
 *   - ON for 7 days (WATCH_THOUGHTS_DAYS) after a record whose ladder was "thoughts" or "danger", or, for a record with no
 *     output.risk (before the harness), whose route was self_harm. His answering "no" to the confirm question does not end
 *     this part: once thoughts of dying were said, a week of closer listening is cheap;
 *   - ON for 72 hours (WATCH_POSSIBLE_HOURS) after a record whose ladder was "possible" or whose frame had distress "yes",
 *     unless a LATER record holds his "no" to the self-harm confirm question (output.risk.rows has a row id starting with
 *     CONFIRM_NO_ROW, the decision table's row for that answer): that clears every possible / distress record before it
 *     (and the one that holds the answer), never a thoughts / danger one;
 *   - a record with output.risk is read by its ladder (a route of self_harm with a ladder of "possible" is the possible part,
 *     so his "no" clears it); a record whose risk names no step but whose route was self_harm counts as thoughts (the safe
 *     side).
 * `since` is the oldest record that keeps it on within its window; `reason` a code: ladder_danger, ladder_thoughts,
 * route_self_harm, ladder_possible or distress (the strongest part). nowMs is the clock his records are stamped in (the
 * store stamps created_at in the scope's own clock: lib/time/clock.ts scopeNowMs; pass the same).
 *
 * Never throws: a store error is { on: false, reason: "store_error" } with a console warning that names the code only (no
 * words of his, no session id); a malformed record is skipped.
 */
import type { SafetyEventRow, Store } from "@/lib/store/types";

export const WATCH_THOUGHTS_DAYS = 7;
export const WATCH_POSSIBLE_HOURS = 72;
/** The decision table's row id prefix for his "no" to the self-harm confirm question (kb/pathways.json, E2). */
export const CONFIRM_NO_ROW = "self-harm-confirm-no";
/** The records read (the newest first): a week of a talkative user's asks, with room. */
const WATCH_RECORDS = 500;

const HOUR = 3_600_000;

export interface WatchState {
  on: boolean;
  since?: string;
  reason?: string;
}

type Step = "none" | "possible" | "thoughts" | "danger";

/** What one record says for the watch (codes only), or null when it says nothing usable. */
function readRecord(r: SafetyEventRow): { t: number; step: Step; distress: boolean; confirmNo: boolean; fromRoute: boolean } | null {
  const t = Date.parse(r.created_at);
  if (!Number.isFinite(t)) return null;
  const out = r.output && typeof r.output === "object" ? (r.output as Record<string, unknown>) : null;
  const risk = out?.risk && typeof out.risk === "object" ? (out.risk as Record<string, unknown>) : null;
  const selfHarmRoute = r.route === "self_harm";
  if (!risk) return { t, step: selfHarmRoute ? "thoughts" : "none", distress: false, confirmNo: false, fromRoute: selfHarmRoute };
  const ladder = typeof risk.ladder === "string" && ["none", "possible", "thoughts", "danger"].includes(risk.ladder) ? (risk.ladder as Step) : null;
  const rows = Array.isArray(risk.rows) ? risk.rows.filter((x): x is string => typeof x === "string") : [];
  const frame = risk.frame && typeof risk.frame === "object" ? (risk.frame as Record<string, unknown>) : null;
  // (E2, 10-16: a record the harness wrote says its own step; "none" on the self-harm route is someone else's crisis he
  // reported, never his: only a record with no ladder at all falls back to its route)
  const step: Step = ladder ?? (selfHarmRoute ? "thoughts" : "none");
  return {
    t,
    step,
    // (E2, 10-16: low mood in a frame about someone else he reported is theirs, not his)
    distress: frame?.distress === "yes" && frame?.about !== "other_adult" && frame?.about !== "child",
    confirmNo: rows.some((id) => id.startsWith(CONFIRM_NO_ROW)),
    fromRoute: selfHarmRoute && !ladder,
  };
}

/** His watch state now (see the header for the rule and its assumption). */
export async function watchState(store: Store, sessionId: string, nowMs: number): Promise<WatchState> {
  let rows: SafetyEventRow[];
  try {
    rows = await store.listSafetyEvents(sessionId, { limit: WATCH_RECORDS });
  } catch {
    console.warn("[risk] watch state unavailable (store_error)");
    return { on: false, reason: "store_error" };
  }
  const recs = rows
    .map((r) => {
      try {
        return readRecord(r);
      } catch {
        return null;
      }
    })
    .filter((x): x is NonNullable<ReturnType<typeof readRecord>> => !!x && x.t <= nowMs + 60_000);
  // his newest "no" to the confirm question clears the possible / distress records up to it
  const clearedUpTo = Math.max(-Infinity, ...recs.filter((r) => r.confirmNo).map((r) => r.t));

  // the records that keep it on: the oldest of them is `since`, the strongest names the reason
  const RANK: Record<string, number> = { ladder_danger: 5, ladder_thoughts: 4, route_self_harm: 3, ladder_possible: 2, distress: 1 };
  const keeping: { t: number; reason: string }[] = [];
  for (const r of recs) {
    const age = nowMs - r.t;
    if ((r.step === "thoughts" || r.step === "danger") && age <= WATCH_THOUGHTS_DAYS * 24 * HOUR) {
      keeping.push({ t: r.t, reason: r.step === "danger" ? "ladder_danger" : r.fromRoute ? "route_self_harm" : "ladder_thoughts" });
    } else if ((r.step === "possible" || r.distress) && age <= WATCH_POSSIBLE_HOURS * HOUR && r.t > clearedUpTo) {
      keeping.push({ t: r.t, reason: r.step === "possible" ? "ladder_possible" : "distress" });
    }
  }
  if (!keeping.length) return { on: false };
  const since = Math.min(...keeping.map((k) => k.t));
  const reason = keeping.reduce((best, k) => (RANK[k.reason] > RANK[best.reason] ? k : best)).reason;
  return { on: true, since: new Date(since).toISOString(), reason };
}
