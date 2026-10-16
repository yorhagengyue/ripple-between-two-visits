/**
 * A store that is some milliseconds away, like the hosted database (C2 track D, 10-11). Server-only.
 *
 * Why: every unit test, e2e spec and journey ran on the memory store, where a call costs nothing. The first run on the
 * hosted database showed what that hid: a request that makes ten calls in a row takes ten round trips, and 「她那边 1 秒内
 * 跟着变」 (real-app 2.22) took 1.7 s and 4 s. With this the same is seen offline:
 *
 *   slowStore(base, ms)       the same store, every call `ms` later and written down (name, start, end)
 *   MemoryEventLog            the bus_event table's contract in memory (per-session ids without gaps), so lib/bus.ts
 *                             runs its shared-log mode, the one the hosted store uses, without a database
 *   slowLog(log, ms)          the same for that log
 *   rounds(calls)             how many round trips deep a stretch of calls was (calls made together wait together)
 *   devSlowMs()               RIPPLE_SLOW_STORE_MS, for a developer's server: with STORE=memory and the developer tools
 *                             on, lib/store getStore() hands out the slow store and lib/bus.ts the slow shared log, so
 *                             the journeys run in a browser against a store 80 ms away. 0 anywhere else: a real
 *                             deployment refuses to start with the developer tools on (lib/dev/enabled.ts), and
 *                             STORE=supabase never reads it.
 *
 * A call's wait is split around the work (half before, half after), as a request that travels, runs and travels back.
 * Short waits are exact to about a millisecond; long ones are timers (see wait()).
 */
import type { BusEvent, BusLog } from "@/lib/bus";
import { devToolsEnabled } from "@/lib/dev/enabled";

export interface StoreCall {
  name: string;
  /** performance.now() when the call was made and when it answered (0 while it is out) */
  start: number;
  end: number;
}

export function wait(ms: number): Promise<void> {
  if (!(ms > 0)) return Promise.resolve();
  // a long wait is a plain timer (on Windows it may run up to 15 ms over: "80 ms away" is then 80 to 95, never less)
  if (ms >= 20) return new Promise((resolve) => setTimeout(resolve, ms));
  // a short one turns the event loop until its time has come: a timer would make "5 ms away" 30
  const until = performance.now() + ms;
  return new Promise((resolve) => {
    const spin = () => (performance.now() >= until ? resolve() : void setImmediate(spin));
    setImmediate(spin);
  });
}

/** `base` with every method call `delayMs()` later; `onCall` hears each call when it is made. */
export function slowStore<T extends object>(base: T, delayMs: () => number, onCall?: (call: StoreCall) => void): T {
  return new Proxy(base, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        const call: StoreCall = { name: prop, start: performance.now(), end: 0 };
        onCall?.(call);
        const half = delayMs() / 2;
        try {
          await wait(half);
          const result = await (value as (...a: unknown[]) => unknown).apply(target, args);
          await wait(half);
          return result;
        } finally {
          call.end = performance.now();
        }
      };
    },
  });
}

/** A shared event log whose every read and write takes `delayMs`. */
export function slowLog(log: BusLog, delayMs: number): BusLog {
  const slow =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      await wait(delayMs / 2);
      const result = await fn(...args);
      await wait(delayMs / 2);
      return result;
    };
  return {
    append: slow((e) => log.append(e)),
    after: slow((s, a, l) => log.after(s, a, l)),
    latest: slow((s, l) => log.latest(s, l)),
    head: slow((s) => log.head(s)),
    clear: slow((s) => log.clear(s)),
  };
}

/** The bus_event table's contract in memory: per-session ids without gaps, never an id before every smaller one. */
export class MemoryEventLog implements BusLog {
  private events = new Map<string, BusEvent[]>();
  private seq = new Map<string, number>();
  async append(event: Omit<BusEvent, "id">): Promise<number> {
    const id = (this.seq.get(event.session_id) ?? 0) + 1;
    this.seq.set(event.session_id, id);
    const list = this.events.get(event.session_id) ?? [];
    list.push(structuredClone({ ...event, id }));
    if (list.length > 200) list.splice(0, list.length - 200);
    this.events.set(event.session_id, list);
    return id;
  }
  async after(sessionId: string, afterId: number, limit: number): Promise<BusEvent[]> {
    return structuredClone((this.events.get(sessionId) ?? []).filter((e) => e.id > afterId).slice(0, limit));
  }
  async latest(sessionId: string, limit: number): Promise<BusEvent[]> {
    return structuredClone((this.events.get(sessionId) ?? []).slice(-limit));
  }
  async head(sessionId: string): Promise<number> {
    return this.seq.get(sessionId) ?? 0;
  }
  async clear(sessionId: string): Promise<void> {
    this.events.set(sessionId, []);
  }
}

/**
 * How many round trips deep a list of calls was: calls made while another is still out wait together, so they count
 * once. (Ten calls in a row are ten; ten calls at once are one.)
 */
export function rounds(calls: readonly StoreCall[]): number {
  let n = 0;
  let busyUntil = -Infinity;
  for (const c of [...calls].sort((a, b) => a.start - b.start)) {
    if (c.start >= busyUntil) n += 1;
    busyUntil = Math.max(busyUntil, c.end || Infinity);
  }
  return n;
}

/** RIPPLE_SLOW_STORE_MS on a developer's server with the memory store; 0 everywhere else. */
export function devSlowMs(env: Record<string, string | undefined> = process.env): number {
  if (!devToolsEnabled(env)) return 0;
  const kind = (env.STORE ?? "").trim().toLowerCase();
  if (kind !== "" && kind !== "memory") return 0;
  const n = Number(env.RIPPLE_SLOW_STORE_MS);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 2000) : 0;
}
