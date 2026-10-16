/**
 * One ask's reads, each made once and side by side (C2 track S, the latency pass of 10-10). Against the real database
 * every store call from Singapore to the Tokyo test project costs 140-300 ms, and the ask path read the same rows several
 * times, one after another (the visits three times, a visit's transcript twice, the questions twice, the scope row twice):
 * the hero question took 4.6 s. readOnce wraps the request's store (the subject's scoped store, or a test's) for one ask:
 *
 *   a read listed in CACHED goes to the store once per arguments; whoever asks again (the classifier, the doctor's numbers,
 *     the candidates, the question list) gets its own copy of the same rows (structuredClone, as the memory store does), so
 *     nobody can change what another caller sees;
 *   prime() hands it a row the request already holds (the scope row the subject read), warm() starts a read now so the
 *     answer is there when the pipeline asks (prefetchAsk in pipeline.ts);
 *   getTranslation is answered from the scope's translations when they were read (one lookup per doctor line otherwise);
 *   a write goes straight to the store and drops what it may change (WRITES; any other write drops everything), so a read
 *     after a write sees it. Reads not listed pass through untouched.
 *
 * Nothing is kept past the request: each ask makes its own (ask() wraps a store that is not wrapped yet). The answers are
 * the same rows the store gives, so on the memory store an answer is byte for byte what it was.
 */
import type { Store, TranslationRow } from "@/lib/store/types";

/** Reads the ask path makes, cached per arguments. */
const CACHED = new Set<string>([
  "getSession",
  "listVisits",
  "listMeds",
  "listVisitItems",
  "listUtterances",
  "listQuestions",
  "listBp",
  "listDoses",
  "listNotes",
  "listTranslations",
  "getTranslation",
  "getFamilyGrant",
  "listConsentRecords",
]);

/** What a write may change (the reads it drops); any other write drops every cached read. */
const WRITES: Record<string, string[]> = {
  addQuestion: ["listQuestions", "getQuestion"],
  updateQuestion: ["listQuestions", "getQuestion"],
  addNote: ["listNotes"],
  addSafetyEvent: ["listSafetyEvents"],
  addChatMessage: ["listChatMessages"],
  putTranslation: ["listTranslations", "getTranslation"],
};

const READ_ONCE = Symbol.for("ripple.safety.readOnce");

export interface ReadOnceControl {
  /** a row the request already holds, as `method(...args)` would give it */
  prime(method: string, args: unknown[], value: unknown): void;
  /** start `method(...args)` now; whoever asks for it later gets this read (a failure is theirs, never an unhandled one) */
  warm(method: string, ...args: unknown[]): Promise<unknown>;
}

export type ReadOnceStore = Store & { readonly [READ_ONCE]: ReadOnceControl };

export function isReadOnce(store: Store): store is ReadOnceStore {
  return !!(store as Partial<ReadOnceStore>)[READ_ONCE];
}

/** A row the request already holds, as `method(...args)` would give it (a store that is not wrapped: nothing). */
export function primeRead(store: Store, method: string, args: unknown[], value: unknown): void {
  if (isReadOnce(store)) store[READ_ONCE].prime(method, args, value);
}

/** Start `method(...args)` now on a wrapped store (a store that is not wrapped: nothing). Never rejects. */
export function warmRead(store: Store, method: string, ...args: unknown[]): Promise<unknown> {
  return isReadOnce(store) ? store[READ_ONCE].warm(method, ...args).catch(() => undefined) : Promise.resolve(undefined);
}

const keyOf = (method: string, args: unknown[]) => `${method}:${JSON.stringify(args)}`;

/** The store for one ask (see the header). A store that is already wrapped is returned as it is. */
export function readOnce(store: Store): ReadOnceStore {
  if (isReadOnce(store)) return store;
  const cache = new Map<string, Promise<unknown>>();
  const call = (method: string, args: unknown[]): unknown => (Reflect.get(store, method, store) as (...a: unknown[]) => unknown).apply(store, args);

  const shared = (method: string, args: unknown[]): Promise<unknown> => {
    const key = keyOf(method, args);
    const hit = cache.get(key);
    if (hit) return hit;
    let made: Promise<unknown>;
    // a translation is one row of the scope's translations: no lookup of its own when they were read
    const all = method === "getTranslation" ? cache.get(keyOf("listTranslations", [args[0]])) : undefined;
    if (all) {
      const [, direction, sha] = args as [string, TranslationRow["direction"], string];
      made = all.then(
        (rows) => (rows as TranslationRow[]).find((r) => r.direction === direction && r.source_sha256 === sha) ?? null,
        () => call(method, args),
      );
    } else {
      // (a store that throws before its promise starts gives a rejection here too, never a throw out of a prefetch)
      made = new Promise((resolve) => resolve(call(method, args)));
    }
    cache.set(key, made);
    // a failed read is not kept: the next caller asks the store again (and gets its own answer, or its own error)
    made.catch(() => {
      if (cache.get(key) === made) cache.delete(key);
    });
    return made;
  };

  const drop = (method: string) => {
    const reads = WRITES[method];
    if (!reads) {
      cache.clear();
      return;
    }
    for (const key of [...cache.keys()]) if (reads.some((r) => key.startsWith(`${r}:`))) cache.delete(key);
  };

  const control: ReadOnceControl = {
    prime(method, args, value) {
      if (CACHED.has(method)) cache.set(keyOf(method, args), Promise.resolve(value));
    },
    warm(method, ...args) {
      const p = shared(method, args);
      p.catch(() => undefined);
      return p;
    },
  };

  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === READ_ONCE) return control;
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || typeof value !== "function") return value;
      if (CACHED.has(prop)) return (...args: unknown[]) => shared(prop, args).then((rows) => structuredClone(rows));
      if (prop.startsWith("get") || prop.startsWith("list")) return (...args: unknown[]) => call(prop, args);
      return (...args: unknown[]) => {
        drop(prop);
        const out = call(prop, args);
        // and again once it is done: a read that went out while it was being written may have the old rows
        if (out && typeof (out as Promise<unknown>).then === "function") (out as Promise<unknown>).then(() => drop(prop), () => drop(prop));
        return out;
      };
    },
  }) as ReadOnceStore;
}
