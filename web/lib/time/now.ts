/**
 * The app's one clock (docs/plan/real-app.md 3.3). Everything that needs "now" on the server asks here: the store's
 * timestamps and its "today" for an account (lib/time/clock.ts projectScope), the scheduled jobs, the auth tokens.
 *
 * Real time, unless the developer test clock is set (POST /api/dev/clock, or setTestClock in a test). The test clock
 * is process-wide (globalThis, so the proxy bundle and the route handlers agree and hot reload keeps it) and only
 * counts while the developer tools are on (lib/dev/enabled.ts): on a production build without RIPPLE_DEV_TOOLS=1 it
 * cannot be set, and a value somehow left behind is ignored.
 *
 *   offset    real time + offsetMs (time keeps flowing)
 *   at        a given moment; it keeps flowing from there unless frozen
 *   frozen    stands still at that moment until changed or cleared (unit tests)
 *
 * Server-only (process.env); client code has its own clock.
 */
import { assertDevTools, devToolsEnabled } from "@/lib/dev/enabled";
import { scopeNowMs, type ScopeClockRow } from "./clock";

export interface TestClockState {
  /** added to the real time */
  offsetMs: number;
  /** the clock stands still at this moment (epoch ms) */
  frozenAtMs: number | null;
  /** when it was set (real epoch ms) */
  setAtRealMs: number;
}

type GlobalWithClock = typeof globalThis & { __rippleTestClock?: TestClockState | null };

const g = globalThis as GlobalWithClock;

/** Real epoch ms; the one place the app reads the machine clock (tests may stub Date.now). */
export function realNowMs(): number {
  return Date.now();
}

/** Now, in epoch ms: real time, or the developer test clock while the developer tools are on. */
export function nowMs(): number {
  const c = g.__rippleTestClock;
  if (!c || !devToolsEnabled()) return realNowMs();
  return c.frozenAtMs ?? realNowMs() + c.offsetMs;
}

/** Now as a Date. */
export function now(): Date {
  return new Date(nowMs());
}

/** Now as an ISO string. */
export function nowIso(): string {
  return now().toISOString();
}

/**
 * C2 track J (filming): now as an ISO string on a scope's own clock (lib/time/clock.ts scopeNowMs: a filming account's
 * clock offset added; exactly nowIso() for a demo session and an ordinary account). For the moments a write path stamps
 * itself into a scope's records (a medicine's start_at), like the store does for created_at.
 */
export function scopeNowIso(scope: Pick<ScopeClockRow, "kind" | "filming" | "clock_offset_ms">): string {
  return new Date(scopeNowMs(scope, nowMs())).toISOString();
}

export interface SetTestClock {
  /** shift real time by this many ms */
  offsetMs?: number;
  /** jump to this moment (ISO string or epoch ms) */
  at?: string | number;
  /** stand still there (default: keep flowing) */
  frozen?: boolean;
}

function parseAt(at: string | number): number {
  const ms = typeof at === "number" ? at : Date.parse(at);
  if (!Number.isFinite(ms)) throw new Error(`Not a moment: ${String(at)}`);
  return ms;
}

/**
 * Set or clear (null) the test clock. Throws when the developer tools are off. Returns the state now in force.
 * `at` wins over `offsetMs`; with neither, the clock goes back to real time.
 */
export function setTestClock(input: SetTestClock | null): TestClockState | null {
  assertDevTools("The test clock");
  if (input === null || (input.at === undefined && input.offsetMs === undefined)) {
    g.__rippleTestClock = null;
    return null;
  }
  const real = realNowMs();
  let state: TestClockState;
  if (input.at !== undefined) {
    const at = parseAt(input.at);
    state = { offsetMs: at - real, frozenAtMs: input.frozen ? at : null, setAtRealMs: real };
  } else {
    const offset = Number(input.offsetMs);
    if (!Number.isFinite(offset)) throw new Error("offsetMs must be a number");
    state = { offsetMs: offset, frozenAtMs: input.frozen ? real + offset : null, setAtRealMs: real };
  }
  g.__rippleTestClock = state;
  return { ...state };
}

/** Move a set (or real) clock forward by ms; keeps it frozen when it was. */
export function advanceTestClock(ms: number): TestClockState {
  assertDevTools("The test clock");
  if (!Number.isFinite(ms)) throw new Error("ms must be a number");
  const c = g.__rippleTestClock;
  const real = realNowMs();
  const next: TestClockState = c
    ? { offsetMs: c.offsetMs + ms, frozenAtMs: c.frozenAtMs === null ? null : c.frozenAtMs + ms, setAtRealMs: real }
    : { offsetMs: ms, frozenAtMs: null, setAtRealMs: real };
  g.__rippleTestClock = next;
  return { ...next };
}

/** The test clock in force (null: real time). */
export function testClock(): TestClockState | null {
  const c = g.__rippleTestClock;
  return c && devToolsEnabled() ? { ...c } : null;
}
