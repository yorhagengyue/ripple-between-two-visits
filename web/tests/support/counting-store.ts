/**
 * A store that counts what a piece of code asks of it, the way the real database would feel it (C2 track F, fix round:
 * the first run against the real database showed 「是，医生说的」 taking five seconds and 「就这样，存好」 more than ten).
 *
 *   calls    every Store method called
 *   trips    round trips to the database as the Supabase adapter makes them (lib/store/supabase.ts): one per call, and a
 *            second one when a list comes back empty or a row is not found (the adapter then reads the session row to
 *            tell "nothing there" from "no such session": orNoSession, one())
 *   rounds   round trips in sequence: what the person waits for. Calls made at the same moment (Promise.all) share a
 *            round; a call made after another one answered is in a later round. An empty answer costs its second round.
 *            At about 80 ms a round from this machine, 25 rounds are two seconds.
 *
 * How rounds are counted: a call joins the round that is open, or opens one; a round closes on the next macrotask
 * (setImmediate), and no call answers before its round closed. The memory store answers within microtasks, so code
 * that awaits one call and then makes the next always lands in the next round, and calls issued together in one.
 */
import type { Store } from "@/lib/store/types";

export interface StoreCount {
  calls: number;
  trips: number;
  rounds: number;
  byMethod: Record<string, number>;
  /** the calls in order, with the round each started in ("3 listVisits") */
  log: string[];
}

export interface CountingStore<S extends Store> {
  store: S;
  count: StoreCount;
  reset(): void;
  /** the count of one piece of work, from a clean slate */
  measure<T>(work: () => Promise<T>): Promise<{ out: T; calls: number; trips: number; rounds: number; byMethod: Record<string, number>; log: string[] }>;
}

const empty = (out: unknown): boolean => out === null || out === undefined || (Array.isArray(out) && out.length === 0);

/** Methods whose empty answer the adapter does not check against the session row (writes answer with the row they wrote). */
const READS = /^(?:list|get)/;

export function countingStore<S extends Store>(base: S): CountingStore<S> {
  const count: StoreCount = { calls: 0, trips: 0, rounds: 0, byMethod: {}, log: [] };
  let closing: Promise<void> | null = null;
  const round = (): Promise<void> => {
    if (!closing) {
      count.rounds++;
      closing = new Promise<void>((resolve) =>
        setImmediate(() => {
          closing = null;
          resolve();
        }),
      );
    }
    return closing;
  };
  const store = new Proxy(base, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        count.calls++;
        count.trips++;
        count.byMethod[prop] = (count.byMethod[prop] ?? 0) + 1;
        const closed = round();
        count.log.push(`${count.rounds} ${prop}`);
        const out = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        await closed;
        if (READS.test(prop) && empty(out)) {
          count.trips++;
          await round();
        }
        return out;
      };
    },
  }) as S;
  const reset = () => {
    count.calls = 0;
    count.trips = 0;
    count.rounds = 0;
    count.byMethod = {};
    count.log = [];
  };
  return {
    store,
    count,
    reset,
    async measure(work) {
      reset();
      const out = await work();
      return { out, calls: count.calls, trips: count.trips, rounds: count.rounds, byMethod: { ...count.byMethod }, log: [...count.log] };
    },
  };
}
