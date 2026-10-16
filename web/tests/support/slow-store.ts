/**
 * The process-wide memory store made slow for a test (C2 track D, the one-second fix round; lib/store/slow.ts has the
 * why and the pieces). Routes reach the store through lib/store getStore(), which hands out the process-wide memory
 * store: this swaps it for the same store with every call `delayMs` later, and writes each call down.
 *
 *   const slow = installSlowStore(80);   // from now on a store call is a round trip of 80 ms
 *   slow.reset(); ... slow.calls         // what a stretch of work asked the store, with times
 *   slow.restore();                      // the plain store again (afterEach)
 */
import { getMemoryStore, type MemoryStore } from "@/lib/store/memory";
import { slowStore, type StoreCall } from "@/lib/store/slow";

export { MemoryEventLog, rounds, slowLog, wait, type StoreCall } from "@/lib/store/slow";

export interface SlowStore {
  /** every call since the last reset(), in the order they were made */
  calls: StoreCall[];
  delayMs: number;
  reset(): void;
  restore(): void;
}

type G = typeof globalThis & { __rippleMemoryStore?: MemoryStore };

export function installSlowStore(delayMs: number): SlowStore {
  const g = globalThis as G;
  const plain = getMemoryStore();
  const out: SlowStore = {
    calls: [],
    delayMs,
    reset: () => {
      out.calls = [];
    },
    restore: () => {
      g.__rippleMemoryStore = plain;
    },
  };
  g.__rippleMemoryStore = slowStore(
    plain,
    () => out.delayMs,
    (call) => out.calls.push(call),
  );
  return out;
}
