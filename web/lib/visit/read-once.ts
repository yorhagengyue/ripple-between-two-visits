/**
 * One request reads each of his tables once (C2 track F, fix round; server-only).
 *
 * The first run against the real database showed what the visit screens cost: every answer of the review built the
 * whole visit view, and the view asked the store for the same rows again and again, one call after another (the brief's
 * numbers read his visits, medicines, questions and items a second time, each kept translation was one read, each
 * visit's transcript was read in turn). 26 round trips in sequence for one view, 33 for one 「是，医生说的」, 66 for
 * 「就这样，存好」; at about 150 ms a round trip from this machine that is 5 s and 10 s of a disabled button.
 *
 * readOnce(store) is the same Store, for the length of one request:
 *   - a read is made once: the same call again gets the first answer (a copy of it, so no caller sees another's edits);
 *   - a narrower read is answered from the wider one when that one is there or being fetched: a visit, a question, a
 *     medicine by id from the list; items of one visit, or only the required lines, from all his items; readings, doses
 *     and notes of some days from all of them; one kept translation from the list. So the reads a screen needs can be
 *     asked for together, at the start, and everything after that is answered from memory (warm);
 *   - a write goes to the store as it is, and what it changed is read again by whoever asks next: the row it returns
 *     replaces its copy in the list where that is all a change can do (an item's answer, a line's speaker, a
 *     question's status), every other write drops the lists it can touch, and a write this file does not know drops
 *     everything. Nothing is ever answered from before a write that could have changed it.
 *
 * It is not a cache between requests and holds nothing after the request: make one per request (or per piece of work)
 * and let it go. Rows another request writes while this one runs are seen or not, as with any read made at its start.
 */
import type { Store } from "@/lib/store/types";

type Fn = (...args: unknown[]) => Promise<unknown>;
type Row = Record<string, unknown>;

const MARK = Symbol.for("ripple.visit.readOnce");

/** Is this store already a readOnce store? (the pieces of one request share it) */
export function isReadOnce(store: Store): boolean {
  return (store as unknown as Record<symbol, unknown>)[MARK] === true;
}

const isObj = (x: unknown): x is Row => typeof x === "object" && x !== null && !Array.isArray(x);
const noFilter = (f: unknown): boolean => f === undefined || f === null || (isObj(f) && Object.values(f).every((v) => v === undefined));
const inRange = (day: unknown, f: Row): boolean =>
  typeof day === "number" && (f.fromDay === undefined || day >= (f.fromDay as number)) && (f.toDay === undefined || day <= (f.toDay as number));
const onlyKeys = (f: unknown, keys: readonly string[]): f is Row => isObj(f) && Object.entries(f).every(([k, v]) => v === undefined || keys.includes(k));

/**
 * A narrower read from the wider list (the store's own filters, lib/store/memory.ts and supabase.ts): the wide call's
 * arguments, and how to take the answer out of its rows. null: no wider read answers this one.
 */
const NARROW: Record<string, (args: unknown[]) => { wide: unknown[]; method?: string; take: (rows: Row[]) => unknown } | null> = {
  getVisit: ([id, visitId]) => ({ method: "listVisits", wide: [id], take: (rows) => rows.find((r) => r.id === visitId) ?? null }),
  getMed: ([id, medId]) => ({ method: "listMeds", wide: [id], take: (rows) => rows.find((r) => r.id === medId) ?? null }),
  getQuestion: ([id, questionId]) => ({ method: "listQuestions", wide: [id], take: (rows) => rows.find((r) => r.id === questionId) ?? null }),
  getTranslation: ([id, direction, sha]) => ({
    method: "listTranslations",
    wide: [id],
    take: (rows) => rows.find((r) => r.direction === direction && r.source_sha256 === sha) ?? null,
  }),
  listQuestions: ([id, f]) =>
    !noFilter(f) && onlyKeys(f, ["status", "for", "origin"])
      ? { wide: [id], take: (rows) => rows.filter((q) => (f.status === undefined || q.status === f.status) && (f.for === undefined || q.for === f.for) && (f.origin === undefined || q.origin === f.origin)) }
      : null,
  listVisitItems: ([id, f]) =>
    !noFilter(f) && onlyKeys(f, ["visit_id", "type", "required_only"])
      ? {
          wide: [id],
          take: (rows) =>
            rows.filter((it) => (f.visit_id === undefined || it.visit_id === f.visit_id) && (f.type === undefined || it.type === f.type) && (!f.required_only || (it.required_line ?? null) !== null)),
        }
      : null,
  listDoses: ([id, f]) =>
    !noFilter(f) && onlyKeys(f, ["fromDay", "toDay", "medication_id"])
      ? { wide: [id], take: (rows) => rows.filter((d) => (f.medication_id === undefined || d.medication_id === f.medication_id) && inRange(d.day, f)) }
      : null,
  // a list that asks for deleted readings too is its own read
  listBp: ([id, f]) => (!noFilter(f) && onlyKeys(f, ["fromDay", "toDay"]) ? { wide: [id], take: (rows) => rows.filter((r) => inRange(r.day, f)) } : null),
  listNotes: ([id, f]) => (!noFilter(f) && onlyKeys(f, ["fromDay", "toDay"]) ? { wide: [id], take: (rows) => rows.filter((r) => inRange(r.day, f)) } : null),
  listDeliveries: ([id, f]) => (!noFilter(f) && onlyKeys(f, ["fromDay", "toDay"]) ? { wide: [id], take: (rows) => rows.filter((r) => inRange(r.day, f)) } : null),
  listConsentRecords: ([userId, f]) => (!noFilter(f) && onlyKeys(f, ["kind"]) ? { wide: [userId], take: (rows) => rows.filter((r) => f.kind === undefined || r.kind === f.kind) } : null),
};

/** What a write can change: the reads to forget, or the list its returned row replaces its copy in. */
const WRITES: Record<string, { drop?: readonly string[]; replaceIn?: string; unless?: (args: unknown[]) => boolean }> = {
  // an item's answer, a line's speaker, a question's status: the row keeps its place in the list
  updateVisitItem: { replaceIn: "listVisitItems" },
  updateQuestion: { replaceIn: "listQuestions" },
  // a line's time decides its place: then the list is read again
  updateUtterance: { replaceIn: "listUtterances", unless: (args) => isObj(args[2]) && "t_start_ms" in args[2] },
  addUtterances: { drop: ["listUtterances"] },
  addVisitItems: { drop: ["listVisitItems"] },
  addQuestion: { drop: ["listQuestions"] },
  upsertVisit: { drop: ["listVisits"] },
  // a visit's status, its recording, how its record was made: the row keeps its place; its day decides the place
  updateVisit: { replaceIn: "listVisits", unless: (args) => isObj(args[2]) && ("day" in args[2] || "date" in args[2]) },
  // a visit's lines and items go with it
  deleteVisit: { drop: ["listVisits", "listUtterances", "listVisitItems"] },
  upsertMed: { drop: ["listMeds"] },
  updateMed: { drop: ["listMeds"] },
  deleteMed: { drop: ["listMeds", "listUnderstandingAnswers", "listDoses"] },
  logDose: { drop: ["listDoses"] },
  deleteDose: { drop: ["listDoses"] },
  addBp: { drop: ["listBp"] },
  updateBp: { drop: ["listBp"] },
  deleteBp: { drop: ["listBp"] },
  addNote: { drop: ["listNotes"] },
  addSafetyEvent: { drop: ["listSafetyEvents"] },
  putTranslation: { drop: ["listTranslations"] },
  addConsentRecord: { drop: ["listConsentRecords"] },
  recordDelivery: { drop: ["listDeliveries"] },
  markDeliveryOpened: { drop: ["listDeliveries"] },
};

const READ = /^(?:list|get)[A-Z]/;

export function readOnce<S extends Store>(store: S): S {
  if (isReadOnce(store)) return store;
  // "method\0args" -> the answer (or the read on its way)
  const kept = new Map<string, Promise<unknown>>();
  const key = (method: string, args: unknown[]) => `${method}\0${JSON.stringify(args.map((a) => (a === undefined ? null : a)))}`;
  const trimmed = (args: unknown[]) => {
    const out = [...args];
    while (out.length && noFilter(out[out.length - 1]) && typeof out[out.length - 1] !== "string") out.pop();
    return out;
  };
  const copy = <T>(value: T): T => (typeof value === "object" && value !== null ? structuredClone(value) : value);
  const call = (method: string, args: unknown[]): Promise<unknown> => ((store as unknown as Record<string, Fn>)[method] as Fn).apply(store, args);

  const read = (method: string, rawArgs: unknown[]): Promise<unknown> => {
    const args = trimmed(rawArgs);
    const k = key(method, args);
    const have = kept.get(k);
    if (have) return have.then(copy);
    const narrow = NARROW[method]?.(args) ?? null;
    if (narrow) {
      // the wider list is fetched once and answers every narrower read after it
      return read(narrow.method ?? method, narrow.wide).then((rows) => copy(narrow.take(rows as Row[])));
    }
    const p = call(method, args);
    kept.set(k, p);
    // a read that failed is not an answer: the next caller asks again
    p.catch(() => {
      if (kept.get(k) === p) kept.delete(k);
    });
    return p.then(copy);
  };

  const forget = (methods: readonly string[] | null) => {
    if (!methods) return kept.clear();
    for (const k of [...kept.keys()]) if (methods.includes(k.slice(0, k.indexOf("\0")))) kept.delete(k);
  };

  const write = async (method: string, args: unknown[]): Promise<unknown> => {
    const rule = WRITES[method];
    if (!rule) {
      // a write this file does not know: nothing kept is trusted after it (and nothing fetched while it ran)
      forget(null);
      try {
        return await call(method, args);
      } finally {
        forget(null);
      }
    }
    const replace = rule.replaceIn && !rule.unless?.(args) ? rule.replaceIn : null;
    const drop = replace ? null : (rule.drop ?? (rule.replaceIn ? [rule.replaceIn] : []));
    let out: unknown;
    try {
      out = await call(method, args);
    } catch (err) {
      forget(drop ?? [replace!]);
      throw err;
    }
    if (drop) {
      forget(drop);
    } else if (isObj(out) && typeof out.id === "string") {
      // the row as the store now has it takes its copy's place in every kept list of that kind
      const row = out;
      for (const [k, p] of [...kept.entries()]) {
        if (k.slice(0, k.indexOf("\0")) !== replace) continue;
        kept.set(
          k,
          p.then((rows) => (Array.isArray(rows) ? rows.map((r) => (isObj(r) && r.id === row.id ? structuredClone(row) : r)) : rows)),
        );
      }
    } else {
      forget([replace!]);
    }
    return out;
  };

  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === MARK) return true;
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || typeof value !== "function") return value;
      if (READ.test(prop)) return (...args: unknown[]) => read(prop, args);
      return (...args: unknown[]) => write(prop, args);
    },
  }) as S;
}

/** Ask for these reads together, now; whoever needs them afterwards gets them from memory. Failures are left to the real caller. */
export async function warm(reads: readonly Promise<unknown>[]): Promise<void> {
  await Promise.all(reads.map((p) => p.catch(() => undefined)));
}
