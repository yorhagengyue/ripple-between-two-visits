/**
 * Realtime bus, exposed to browsers by GET /api/events as Server-Sent Events. Event shape follows
 * docs/plan/spec.md section 6: { type, session_id, at, say, data } plus an increasing `id` used as the
 * SSE id (EventSource resends it as Last-Event-ID on reconnect; /api/events replays what was missed).
 *
 * The store does not publish. A route handler that changes data publishes right after the write:
 *
 *   import { publish } from "@/lib/bus";
 *   publish(sessionId, "dose.logged", "Mr Tan ticked taken for the morning tablet", { dose });
 *
 * `say` is the one human sentence the backstage view shows. Server-only module.
 *
 * Two modes, picked once per process by getBus():
 *   - STORE=memory (default): in-process. Listeners are called synchronously, ids are process-wide,
 *     the last 200 events per session are kept for replay. One always-on server.
 *   - STORE=supabase: every event is also written to the bus_event table (lib/store/supabase.ts,
 *     web/supabase/migrations/0003_bus.sql) so several server instances share one stream. publish()
 *     still returns at once; the write goes through a per-session queue (events of one session are
 *     stored in publish order) and the event's `id` is filled in once it is stored (the per-session
 *     sequence of rp_bus_publish, no gaps). Listeners are fed by a tailer that polls the table for the
 *     session (BUS_POLL_MS, default 300 ms) while anyone on this instance listens, in id order, so an
 *     event published on instance A reaches a stream held by instance B. An event published on this
 *     instance is handed to its own listeners as soon as it is stored, when it is the next id (local
 *     fast path, Tail.offer; the one-server deploy shape never waits for a poll), else the tailer
 *     reads the gap from the table first. `recent()` serves this
 *     instance's copy of the tail and returns [] when it is not current (no live tailer), so a page
 *     rendered here never asks to replay a stale range. Inside a route handler the pending write is
 *     handed to next/server after(), so a serverless runtime keeps the function alive until it lands.
 *     C2 track D (only add): subscribeEarly(). Storing an event is one round trip to the database, and an event that
 *     takes something away from a screen (his switch off, his stop: real-app 2.22, within a second) should not wait for
 *     it. An early listener is called by publish() itself, on this instance, before the event is stored: the same
 *     event with id 0 (it has no place in the sequence yet). The stored event still follows through subscribe(), in
 *     order, here and on every other instance; a listener that acted early must expect it again. Nothing is delivered
 *     early in memory mode: there publish() calls the ordinary listeners at once.
 */
import { after } from "next/server";
import { storeKind } from "@/lib/store";
import { devSlowMs, MemoryEventLog, slowLog } from "@/lib/store/slow";
import { createSupabaseBusLog, supabaseStoreConfig } from "@/lib/store/supabase";

/** Event types listed in spec section 6. */
export const SPEC_EVENT_TYPES = [
  "asr.partial",
  "asr.final",
  "utterance.role",
  "card.created",
  "ask.received",
  "ask.route",
  "verify.layer1",
  "verify.layer2",
  "verify.layer3",
  "ask.blocked",
  "ask.answered",
  "question.created",
  "dose.logged",
  "bp.logged",
  "clock.changed",
  "director.cue",
  "scripted_fallback",
] as const;

/** Extra types the session, director, family and data screens need (not in the spec list). */
export const EXTRA_EVENT_TYPES = [
  "session.reset",
  "session.filming_mode",
  "session.member_joined",
  "question.updated",
  "note.logged",
  "med.changed",
  "visit.changed",
  "family_grant.changed",
  "reminder.clip_added",
  // M14: the Whisper service did not answer; the visit screen switched to the replay (data: visit_id, reason, during)
  "asr.fallback",
  // ---- the real app (C2 foundation F1, 10-10). Registered here once so every later track only publishes them; each
  // has a backstage sentence (components/backstage/sentences.ts) and is dropped for the family role until a track
  // decides otherwise on purpose (lib/family/events.ts FAMILY_DROPS).
  // family links (lib/care): data { link: { id, status, relation?, family_label? } }
  "care_link.invited",
  "care_link.accepted",
  "care_link.confirmed",
  "care_link.declined",
  "care_link.revoked",
  "care_link.left",
  // consent records (lib/privacy): data { kind, decision, version? }
  "consent.recorded",
  // web push (lib/push): data { kind?, slot?, count? }; never a medicine name
  "push.subscribed",
  "push.unsubscribed",
  "push.sent",
  "push.opened",
  // his profile (lib/profile): data { fact: { id, kind, source, confirmed? } }
  "profile.fact_added",
  "profile.fact_confirmed",
  "profile.fact_changed",
  // prevention, watch, diet, chat (lib/{prevent,watch,diet,chat})
  "prevent.done",
  "prevent.changed",
  "watch.synced",
  "diet.checked",
  "chat.message",
  // the whole-visit transcript arrived after the visit (awaiting_transcript -> review): data { visit_id }
  "visit.transcribed",
  // Ripple's notes of what was said at his visit (lib/visit/ripple-summary.ts), live while he records and once at its
  // end: data { visit_id, stage: live | final, lang, points: { text, lines }[], at }. His words: her stream drops it
  // (lib/family/events.ts drops every type it does not know), the backstage sentence counts the points only
  "visit.summary",
  // the account itself: data { kind? }
  "account.created",
  "account.changed",
  "account.reseeded",
  // scheduled jobs (lib/jobs): data { job, scopes?, written? }
  "job.ran",
  "job.failed",
  // owner 10-16: a family member was told he said something to Ripple that may need attention (lib/care/told.ts):
  // data { link: { id }, kind }. Never his words. Her own link's stream passes it on as a content-free hint
  // (lib/family/events.ts); every other link's drops it
  "family.told",
] as const;

export type SpecEventType = (typeof SPEC_EVENT_TYPES)[number];
export type ExtraEventType = (typeof EXTRA_EVENT_TYPES)[number];
export type BusEventType = SpecEventType | ExtraEventType;

export interface BusEvent<T = unknown> {
  id: number;
  type: BusEventType;
  session_id: string;
  at: string; // ISO time the event was published (wall clock, not story clock)
  say: string;
  data: T;
}

export type BusListener = (event: BusEvent) => void;

/**
 * Where events are stored when several instances share one stream (STORE=supabase). Ids are a per-session
 * sequence without gaps, and an id is never visible before every smaller id of the same session.
 */
export interface BusLog {
  /** Store one event; resolves to its id. */
  append(event: Omit<BusEvent, "id">): Promise<number>;
  /** Stored events with id > afterId, oldest first, at most `limit`. */
  after(sessionId: string, afterId: number, limit: number): Promise<BusEvent[]>;
  /** The newest `limit` stored events, oldest first. */
  latest(sessionId: string, limit: number): Promise<BusEvent[]>;
  /** The highest id handed out for the session (0 = none yet). */
  head(sessionId: string): Promise<number>;
  /** Drop the session's stored events (ids keep counting up). */
  clear(sessionId: string): Promise<void>;
  /** C2 track H (only add): drop the session's stored events made before `beforeIso`; how many went. */
  prune?(sessionId: string, beforeIso: string): Promise<number>;
}

export interface BusOptions {
  /** null / omitted = in-process only (the memory mode). */
  log?: BusLog | null;
  /** tailer poll interval (ms) */
  pollMs?: number;
  /** keep tailing this long after the last listener left (ms) */
  lingerMs?: number;
  /** recent() answers only when the tailer synced within this many ms */
  freshMs?: number;
}

const HISTORY_PER_SESSION = 200;
const PAGE = 200;

function envMs(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Error text without anything but the message (lib/store/supabase.ts errors carry no secrets). */
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 160);

/** Keep a pending write alive past the response on serverless runtimes; a no-op outside a request. */
function keepAlive(work: Promise<unknown>): void {
  try {
    after(work);
  } catch {
    // outside a request scope (scripts, tests, timers) or no waitUntil on this runtime: the promise just runs
  }
}

/** Polls the bus log for one session and feeds this instance's listeners in id order. */
class Tail {
  head = 0;
  mirror: BusEvent[] = [];
  syncedAt = 0;
  private running = true;
  private ready = false;
  private wake: (() => void) | null = null;
  private poked = false;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;

  constructor(
    private readonly sessionId: string,
    private readonly log: BusLog,
    private readonly deliver: (event: BusEvent) => void,
    private readonly pollMs: number,
  ) {
    void this.loop();
  }

  /**
   * Local publish fast path: an event this instance has just stored. When it is the next id after what this tail
   * has delivered, deliver it now instead of waiting for the next read of the table (the table stays the source of
   * truth: the id came from it, and every other instance still reads the event from there). Anything else (not
   * synced yet, an id gap left by another instance's event, a failing tail) wakes the reader, which fills from the
   * table in id order. An id already delivered is ignored. Returns true when this call delivered the event.
   */
  offer(event: BusEvent): boolean {
    if (!this.running) return false;
    if (!this.ready || this.failures > 0) {
      this.poke();
      return false;
    }
    if (event.id <= this.head) return false; // the table read got it first
    if (event.id !== this.head + 1) {
      this.poke(); // something in between: read it from the table, in order
      return false;
    }
    this.head = event.id;
    this.remember(event);
    this.deliver(event);
    return true;
  }

  /** Look for new events now (a local publish was just stored). */
  poke(): void {
    const wake = this.wake;
    if (wake) wake();
    else this.poked = true; // busy reading: skip the next wait
  }

  cancelStop(): void {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
  }

  stopAfter(ms: number, onStop: () => void): void {
    this.cancelStop();
    this.stopTimer = setTimeout(() => {
      this.running = false;
      this.wake?.();
      onStop();
    }, ms);
    this.stopTimer.unref?.();
  }

  stopNow(): void {
    this.cancelStop();
    this.running = false;
    this.wake?.();
  }

  clear(): void {
    this.mirror = [];
  }

  private remember(event: BusEvent): void {
    this.mirror.push(event);
    if (this.mirror.length > HISTORY_PER_SESSION) this.mirror.splice(0, this.mirror.length - HISTORY_PER_SESSION);
  }

  private sleep(ms: number): Promise<void> {
    if (this.poked) {
      this.poked = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        if (this.wake === finish) this.wake = null;
        resolve();
      };
      const timer = setTimeout(finish, ms);
      timer.unref?.();
      this.wake = finish;
    });
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        if (!this.ready) {
          const [head, latest] = await Promise.all([this.log.head(this.sessionId), this.log.latest(this.sessionId, HISTORY_PER_SESSION)]);
          this.head = head;
          this.mirror = latest.filter((e) => e.id <= head);
          this.ready = true;
          this.syncedAt = Date.now();
        }
        for (;;) {
          const batch = await this.log.after(this.sessionId, this.head, PAGE);
          for (const event of batch) {
            if (event.id <= this.head) continue;
            this.head = event.id;
            this.remember(event);
            this.deliver(event);
          }
          if (batch.length < PAGE) break;
        }
        this.syncedAt = Date.now();
        if (this.failures) console.warn(`[bus] event tail for a session recovered after ${this.failures} failed read(s)`);
        this.failures = 0;
      } catch (err) {
        this.failures++;
        if (this.failures === 1 || this.failures % 20 === 0) console.warn(`[bus] could not read events: ${reason(err)}`);
      }
      if (!this.running) break;
      await this.sleep(this.failures ? Math.min(5000, this.pollMs * 2 ** Math.min(this.failures, 4)) : this.pollMs);
    }
  }
}

export class Bus {
  private listeners = new Map<string, Set<BusListener>>();
  private history = new Map<string, BusEvent[]>();
  private seq = 0;
  private readonly log: BusLog | null;
  private readonly writes = new Map<string, Promise<void>>();
  private readonly tails = new Map<string, Tail>();
  /** C2 track D (only add): listeners told about a publish on this instance before it is stored (subscribeEarly) */
  private readonly early = new Map<string, Set<BusListener>>();
  /** tailer poll interval (ms); /api/events uses it as its own retry pace */
  readonly pollMs: number;
  private readonly lingerMs: number;
  private readonly freshMs: number;

  constructor(opts: BusOptions = {}) {
    this.log = opts.log ?? null;
    this.pollMs = opts.pollMs ?? 300;
    this.lingerMs = opts.lingerMs ?? 10_000;
    this.freshMs = opts.freshMs ?? 5_000;
  }

  /** true when events go through a shared log (STORE=supabase) */
  get isRemote(): boolean {
    return this.log !== null;
  }

  publish<T>(sessionId: string, type: BusEventType, say: string, data: T): BusEvent<T> {
    if (this.log) return this.publishRemote(sessionId, type, say, data);
    const event: BusEvent<T> = { id: ++this.seq, type, session_id: sessionId, at: new Date().toISOString(), say, data };
    const past = this.history.get(sessionId) ?? [];
    past.push(event);
    if (past.length > HISTORY_PER_SESSION) past.splice(0, past.length - HISTORY_PER_SESSION);
    this.history.set(sessionId, past);
    for (const listener of [...(this.listeners.get(sessionId) ?? [])]) {
      try {
        listener(event);
      } catch (err) {
        console.error("[bus] listener failed", err);
      }
    }
    return event;
  }

  private publishRemote<T>(sessionId: string, type: BusEventType, say: string, data: T): BusEvent<T> {
    // id 0 until stored; the payload is snapshotted now, so later changes by the caller are not sent
    const event: BusEvent<T> = { id: 0, type, session_id: sessionId, at: new Date().toISOString(), say, data };
    let payload: unknown = null;
    try {
      payload = data === undefined ? null : (JSON.parse(JSON.stringify(data)) as unknown);
    } catch {
      payload = null; // not JSON-serialisable: the SSE frame could not carry it either
    }
    // C2 track D (only add): this instance's early listeners hear it now, as it will be stored, with id 0
    const early = this.early.get(sessionId);
    if (early?.size) {
      const now: BusEvent = { id: 0, type, session_id: sessionId, at: event.at, say, data: payload };
      for (const listener of [...early]) {
        try {
          listener(now);
        } catch (err) {
          console.error("[bus] early listener failed", err);
        }
      }
    }
    const log = this.log!;
    const write = this.enqueue(sessionId, async () => {
      try {
        event.id = await log.append({ type, session_id: sessionId, at: event.at, say, data: payload });
      } catch (err) {
        console.warn(`[bus] could not store event ${type}: ${reason(err)}`);
        return;
      }
      // stored: this instance's listeners get it now (as stored: the snapshot, not the caller's object); other
      // instances read it from the table
      this.tails.get(sessionId)?.offer({ id: event.id, type, session_id: sessionId, at: event.at, say, data: payload });
    });
    keepAlive(write);
    return event;
  }

  /** Run `task` after every earlier write of the session (publish order is storage order). */
  private enqueue(sessionId: string, task: () => Promise<void>): Promise<void> {
    const prev = this.writes.get(sessionId) ?? Promise.resolve();
    const next = prev.then(task, task).catch(() => {});
    this.writes.set(sessionId, next);
    void next.then(() => {
      if (this.writes.get(sessionId) === next) this.writes.delete(sessionId);
    });
    return next;
  }

  /** Wait until every pending write (of one session, or all) is stored. Memory mode: resolves at once. */
  async flush(sessionId?: string): Promise<void> {
    for (;;) {
      const pending = sessionId ? [this.writes.get(sessionId)].filter(Boolean) : [...this.writes.values()];
      if (!pending.length) return;
      await Promise.all(pending);
    }
  }

  /** Returns the unsubscribe function. */
  subscribe(sessionId: string, listener: BusListener): () => void {
    let set = this.listeners.get(sessionId);
    if (!set) {
      set = new Set();
      this.listeners.set(sessionId, set);
    }
    set.add(listener);
    if (this.log) this.ensureTail(sessionId);
    return () => {
      const s = this.listeners.get(sessionId);
      if (!s) return;
      s.delete(listener);
      if (s.size === 0) {
        this.listeners.delete(sessionId);
        const tail = this.tails.get(sessionId);
        tail?.stopAfter(this.lingerMs, () => {
          if (this.tails.get(sessionId) === tail && !this.listeners.has(sessionId)) this.tails.delete(sessionId);
        });
      }
    };
  }

  /**
   * C2 track D (only add): hear this instance's own publishes of a session before they are stored (id 0), so what must
   * leave a screen at once does not wait for the write. Supabase mode only; in memory mode nothing is delivered here
   * (subscribe() already hears a publish at once). Returns the unsubscribe function.
   */
  subscribeEarly(sessionId: string, listener: BusListener): () => void {
    let set = this.early.get(sessionId);
    if (!set) {
      set = new Set();
      this.early.set(sessionId, set);
    }
    set.add(listener);
    return () => {
      const s = this.early.get(sessionId);
      if (!s) return;
      s.delete(listener);
      if (s.size === 0) this.early.delete(sessionId);
    };
  }

  private ensureTail(sessionId: string): void {
    const existing = this.tails.get(sessionId);
    if (existing) {
      existing.cancelStop();
      return;
    }
    const tail = new Tail(sessionId, this.log!, (event) => this.deliver(sessionId, event), this.pollMs);
    this.tails.set(sessionId, tail);
  }

  private deliver(sessionId: string, event: BusEvent): void {
    for (const listener of [...(this.listeners.get(sessionId) ?? [])]) {
      try {
        listener(event);
      } catch (err) {
        console.error("[bus] listener failed", err);
      }
    }
  }

  /**
   * Recent events for a session, oldest first. sinceId = only events with a larger id.
   * Supabase mode: this instance's copy of the session's tail, or [] when no tailer is current here.
   */
  recent(sessionId: string, opts: { sinceId?: number; limit?: number } = {}): BusEvent[] {
    let rows: BusEvent[];
    if (this.log) {
      const tail = this.tails.get(sessionId);
      rows = tail && Date.now() - tail.syncedAt <= this.freshMs ? tail.mirror : [];
    } else {
      rows = this.history.get(sessionId) ?? [];
    }
    if (opts.sinceId !== undefined) rows = rows.filter((e) => e.id > opts.sinceId!);
    if (opts.limit !== undefined) rows = opts.limit > 0 ? rows.slice(-opts.limit) : [];
    return [...rows];
  }

  /** Stored events after `afterId`, oldest first (Supabase mode reads the shared log). */
  async after(sessionId: string, afterId: number, limit = PAGE): Promise<BusEvent[]> {
    if (this.log) return this.log.after(sessionId, afterId, limit);
    return this.recent(sessionId, { sinceId: afterId }).slice(0, limit);
  }

  /** The newest event id of the session (0 = none). */
  async head(sessionId: string): Promise<number> {
    if (this.log) return this.log.head(sessionId);
    return this.history.get(sessionId)?.at(-1)?.id ?? 0;
  }

  listenerCount(sessionId: string): number {
    return this.listeners.get(sessionId)?.size ?? 0;
  }

  /** Drop a session's history (listeners stay connected). Supabase mode also deletes the stored events. */
  clearHistory(sessionId: string): void {
    this.history.delete(sessionId);
    if (!this.log) return;
    this.tails.get(sessionId)?.clear();
    const log = this.log;
    keepAlive(
      this.enqueue(sessionId, async () => {
        try {
          await log.clear(sessionId);
        } catch (err) {
          console.warn(`[bus] could not clear stored events: ${reason(err)}`);
        }
      }),
    );
  }

  /**
   * C2 track H (only add): drop a session's events made before `beforeMs` (docs/plan/real-app.md 3.11 保留期限: bus_event
   * 「每个范围最近 200 条，且不超过 7 天」; the 200 are kept on publish, this is the 7 days; lib/jobs/retention.ts calls it for
   * every account scope). Listeners stay connected and ids keep counting up. Returns how many went: from this
   * process's history, or from the shared log (STORE=supabase).
   */
  async pruneBefore(sessionId: string, beforeMs: number): Promise<number> {
    const old = (e: BusEvent) => Date.parse(e.at) < beforeMs;
    if (!this.log) {
      const past = this.history.get(sessionId);
      if (!past) return 0;
      const keep = past.filter((e) => !old(e));
      if (keep.length) this.history.set(sessionId, keep);
      else this.history.delete(sessionId);
      return past.length - keep.length;
    }
    const tail = this.tails.get(sessionId);
    if (tail) tail.mirror = tail.mirror.filter((e) => !old(e));
    return this.log.prune ? this.log.prune(sessionId, new Date(beforeMs).toISOString()) : 0;
  }

  /** Stop every tailer (tests, shutdown). */
  close(): void {
    for (const tail of this.tails.values()) tail.stopNow();
    this.tails.clear();
  }
}

type GlobalWithBus = typeof globalThis & { __rippleBus?: Bus };

function createProcessBus(): Bus {
  let kind: string;
  try {
    kind = storeKind();
  } catch {
    kind = "memory";
  }
  if (kind !== "supabase") {
    // C2 track D (only add): a developer's server with RIPPLE_SLOW_STORE_MS runs the shared-log mode over a log in
    // memory, each read and write that much later: the mode the hosted store uses, seen offline (lib/store/slow.ts)
    const slow = devSlowMs();
    return slow ? new Bus({ log: slowLog(new MemoryEventLog(), slow), pollMs: envMs("BUS_POLL_MS", 300) }) : new Bus();
  }
  const cfg = supabaseStoreConfig();
  if (!cfg) {
    console.warn("[bus] STORE=supabase without SUPABASE_URL / SUPABASE_SERVICE_KEY: events stay in this process");
    return new Bus();
  }
  return new Bus({ log: createSupabaseBusLog(cfg), pollMs: envMs("BUS_POLL_MS", 300) });
}

export function getBus(): Bus {
  const g = globalThis as GlobalWithBus;
  g.__rippleBus ??= createProcessBus();
  return g.__rippleBus;
}

export function publish<T>(sessionId: string, type: BusEventType, say: string, data: T): BusEvent<T> {
  return getBus().publish(sessionId, type, say, data);
}

/** One SSE frame. JSON.stringify never emits raw newlines, so a single data line is safe. */
export function toSseFrame(event: BusEvent): string {
  return `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
}
