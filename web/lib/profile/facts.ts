/**
 * His profile facts (M11; journey 01 建档; real-app 2.5; e2e-chains 12). Track C. Server-only.
 *
 *   who wrote it   he did (source "patient", confirmed by him as he writes it); a family member did (source "family",
 *                  unconfirmed): her through her care link, or someone helping on his phone while he was being set up
 *                  (the onboarding round marked "家人帮我填"). A visit's line can be a fact too (source "visit", by
 *                  track F, carrying the visit item).
 *   unconfirmed    a family member's fact waits for him: it is listed for him to answer 「对 / 改一下 / 不对」, and until
 *                  then it is nowhere else: not in an answer's sources, the medicine cards, the brief, and a routine or
 *                  clinic she wrote does not move his reminders (real-app 2.5, M11 rule 4).
 *   his answer     对: confirmed (the routine or clinic then goes into his settings); 改一下: his words replace hers,
 *                  confirmed; 不对: hidden (kept for the record, never shown or used).
 *   two places     his clinic and his routine (breakfast, weekly habits) are a setting the app schedules by
 *                  (session.settings) and, each, a fact row with where it came from (real-app 2.5 「写在哪里」: 每一条事实
 *                  另写一行 profile_fact，带出处). syncSettingFacts keeps the rows in step with the settings after he
 *                  changes a setting; changeOwnFact keeps the settings in step when he changes or removes such a fact.
 *
 * The facts record what was said and by whom. Nothing here explains, infers or advises: a condition is his or her
 * words, a medicine the doctor named is the doctor's.
 */
import { publish } from "@/lib/bus";
import type { NewProfileFact, ProfileFactRow, ScopeRoutineEntry, ScopeSettings, SessionRow, Store } from "@/lib/store/types";
import { isAccount, scopeClinic, scopeRoutine } from "@/lib/store/scope";
import { nowIso } from "@/lib/time/now";
import { clockWords, weekdaysWords } from "./dates";

/** What a fact is about. Free text otherwise ("other"). */
export const FACT_KINDS = ["name", "age", "home", "language", "condition", "allergy", "clinic", "routine", "other"] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export const FACT_TEXT_MAX = 200;

export class ProfileInputError extends Error {
  constructor(readonly code: "text_empty" | "text_too_long" | "kind_unknown" | "age_invalid" | "routine_invalid" | "time_invalid" | "time_out_of_range") {
    super(code);
    this.name = "ProfileInputError";
  }
}

export function cleanFactText(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) throw new ProfileInputError("text_empty");
  if ([...t].length > FACT_TEXT_MAX) throw new ProfileInputError("text_too_long");
  return t;
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
export function cleanTime(time: string): string {
  const m = HHMM.exec(time.trim());
  if (!m) throw new ProfileInputError("time_invalid");
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

export const WEEKDAY_CODES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** A routine entry as he gave it: a label (his words or a preset's), the days ("daily" or weekdays), the time. */
export function cleanRoutineEntry(e: { label: string; label_zh?: string | null; days: "daily" | string[]; time: string }): ScopeRoutineEntry {
  const label = cleanFactText(e.label);
  const labelZh = e.label_zh ? cleanFactText(e.label_zh) : undefined;
  let days: "daily" | string[];
  if (e.days === "daily") days = "daily";
  else {
    const set = new Set(e.days);
    if (!set.size || [...set].some((d) => !(WEEKDAY_CODES as readonly string[]).includes(d))) throw new ProfileInputError("routine_invalid");
    days = WEEKDAY_CODES.filter((d) => set.has(d));
  }
  return { label, ...(labelZh ? { label_zh: labelZh } : {}), days, time: cleanTime(e.time) };
}

/** Who is writing: him, someone helping on his phone, or her through her care link. */
export type FactAuthor = { kind: "patient" } | { kind: "helper" } | { kind: "family"; userId: string; linkId: string; label: string | null };

export interface FactInput {
  kind: FactKind;
  text: string;
  data?: unknown;
}

type Publisher = (scopeId: string, type: "profile.fact_added" | "profile.fact_confirmed" | "profile.fact_changed", say: string, data: unknown) => void;
const defaultPublish: Publisher = (sid, type, say, data) => void publish(sid, type, say, data);

/** The insert for a fact by this author. A family member's is a proposal: source family, unconfirmed. */
export function factRow(input: FactInput, author: FactAuthor, stamp: string = nowIso()): NewProfileFact {
  if (!(FACT_KINDS as readonly string[]).includes(input.kind)) throw new ProfileInputError("kind_unknown");
  const text = cleanFactText(input.text);
  const base = { kind: input.kind, text, data: input.data ?? null };
  if (author.kind === "patient") return { ...base, source: "patient", entered_by: "patient", confirmed_by: "patient", confirmed_at: stamp };
  if (author.kind === "helper") return { ...base, source: "family", entered_by: "family", confirmed_by: null };
  return { ...base, source: "family", entered_by: author.label ?? "family", entered_by_user_id: author.userId, link_id: author.linkId, confirmed_by: null };
}

/** Add a fact (or a family proposal). Publishes profile.fact_added. */
export async function addFact(store: Store, scope: SessionRow, input: FactInput, author: FactAuthor, opts: { publish?: Publisher } = {}): Promise<ProfileFactRow> {
  const row = await store.addProfileFact(scope.id, factRow(input, author));
  (opts.publish ?? defaultPublish)(scope.id, "profile.fact_added", author.kind === "patient" ? `He added a ${row.kind} fact to his profile.` : `His family proposed a ${row.kind} fact for his profile.`, {
    fact: factEvent(row),
  });
  return row;
}

/**
 * C2 track D (only add): the care link a family member's fact was proposed through, for the event's data (`by_link`).
 * Her stream passes his answer on as a content-free hint only for her own link's fact (lib/family/events.ts); his own
 * stream already carries link ids (care_link.*). Not part of factEvent / factOut: a response never carries it.
 */
const byLink = (f: Pick<ProfileFactRow, "link_id">): { by_link?: string } => (f.link_id ? { by_link: f.link_id } : {});

/** What an event carries about a fact: its kind and who wrote it, never the words. */
export function factEvent(f: Pick<ProfileFactRow, "id" | "kind" | "source" | "confirmed_by">): { id: string; kind: string; source: string; confirmed: boolean } {
  return { id: f.id, kind: f.kind, source: f.source, confirmed: f.confirmed_by !== null };
}

/** A fact as a response carries it: no scope id, no user ids, no link id. */
export function factOut(f: ProfileFactRow): { id: string; kind: string; source: string; confirmed: boolean; text: string; entered_by: string | null; hidden: boolean } {
  return { ...factEvent(f), text: f.text, entered_by: f.entered_by, hidden: f.hidden === true };
}

export const isPending = (f: Pick<ProfileFactRow, "source" | "confirmed_by" | "hidden">): boolean => f.source === "family" && f.confirmed_by === null && f.hidden !== true;
export const isShown = (f: Pick<ProfileFactRow, "confirmed_by" | "hidden">): boolean => f.confirmed_by !== null && f.hidden !== true;

/** A confirmed routine or clinic fact goes into his settings (what drives his reminders). */
export function settingsFromFact(f: Pick<ProfileFactRow, "kind" | "text" | "data">, scope: SessionRow): ScopeSettings | null {
  if (f.kind === "clinic") return { clinic: f.text };
  if (f.kind === "routine") {
    const entry = factEntry(f);
    if (!entry) return null;
    const routine = scopeRoutine(scope).filter((r) => !sameRoutine(r, entry));
    // a new breakfast time moves the morning reminder with it: a time he set by hand earlier no longer holds
    return { routine: [...routine, entry], ...(isBreakfast(entry) ? { reminder_time: null } : {}) };
  }
  return null;
}

/** The routine entry a routine fact carries (data.entry), or null. */
export function factEntry(f: Pick<ProfileFactRow, "data">): ScopeRoutineEntry | null {
  const entry = (f.data as { entry?: ScopeRoutineEntry } | null)?.entry;
  return entry && typeof entry.label === "string" && typeof entry.time === "string" && (entry.days === "daily" || Array.isArray(entry.days)) ? entry : null;
}

/** A routine entry as a fact says it: 「早饭 · 早上 7:30」, 「打太极 · 周二、周四 · 早上 7:00」 (stored words are 华语, like every fact). */
export function routineFactText(e: ScopeRoutineEntry): string {
  if (isBreakfast(e)) return `早饭 · ${clockWords(e.time, "zh-Hans")}`;
  return `${e.label_zh ?? e.label} · ${weekdaysWords(e.days, "zh-Hans")} · ${clockWords(e.time, "zh-Hans")}`;
}

const daysKey = (d: "daily" | string[]): string => (d === "daily" ? "daily" : [...d].sort().join(","));
/** The same habit on the same days at the same time. */
export const sameEntry = (a: ScopeRoutineEntry, b: ScopeRoutineEntry): boolean => sameRoutine(a, b) && a.time === b.time && daysKey(a.days) === daysKey(b.days);

/** Breakfast replaces breakfast; another habit replaces the one with the same label. */
export function sameRoutine(a: ScopeRoutineEntry, b: ScopeRoutineEntry): boolean {
  if (isBreakfast(a) && isBreakfast(b)) return true;
  return a.label.trim().toLowerCase() === b.label.trim().toLowerCase();
}

export const isBreakfast = (r: Pick<ScopeRoutineEntry, "label" | "label_zh">): boolean => /breakfast/i.test(r.label) || r.label_zh === "早饭";

export type FactAnswer = { kind: "yes" } | { kind: "no" } | { kind: "edit"; text: string };

export type FactChange = { ok: true; fact: ProfileFactRow; scope: SessionRow } | { ok: false; status: 404 | 409; error: "not_found" | "not_pending" | "hidden" };

/**
 * His answer to a family member's fact: 对 (confirmed; a routine or clinic goes into his settings), 改一下 (his words,
 * confirmed), 不对 (hidden). Only on his own subject. Publishes profile.fact_confirmed or profile.fact_changed.
 */
export async function answerFamilyFact(store: Store, scope: SessionRow, id: string, answer: FactAnswer, opts: { publish?: Publisher; now?: () => string } = {}): Promise<FactChange> {
  const pub = opts.publish ?? defaultPublish;
  const stamp = (opts.now ?? nowIso)();
  const fact = (await store.listProfileFacts(scope.id)).find((f) => f.id === id);
  if (!fact) return { ok: false, status: 404, error: "not_found" };
  if (!isPending(fact)) return { ok: false, status: 409, error: fact.hidden ? "hidden" : "not_pending" };
  if (answer.kind === "no") {
    const row = await store.updateProfileFact(scope.id, id, { hidden: true });
    pub(scope.id, "profile.fact_changed", `He said a ${row.kind} fact his family wrote is not right.`, { fact: factEvent(row), answer: "no", ...byLink(row) });
    return { ok: true, fact: row, scope };
  }
  const text = answer.kind === "edit" ? cleanFactText(answer.text) : fact.text;
  const data = answer.kind === "edit" ? { ...(isObj(fact.data) ? fact.data : {}), edited_from: fact.text } : fact.data;
  const row = await store.updateProfileFact(scope.id, id, { text, data, confirmed_by: "patient", confirmed_at: stamp });
  let next = scope;
  const settings = isAccount(scope) ? settingsFromFact(row, scope) : null;
  if (settings) {
    next = await store.updateScope(scope.id, { settings });
    // what this one replaced (his earlier clinic, an earlier breakfast) is no longer a fact about him
    await syncSettingFacts(store, next, { publish: pub });
  }
  pub(scope.id, "profile.fact_confirmed", `He confirmed a ${row.kind} fact his family wrote${answer.kind === "edit" ? ", in his own words" : ""}.`, { fact: factEvent(row), answer: answer.kind, ...byLink(row) });
  return { ok: true, fact: row, scope: next };
}

/**
 * His own fact: new words, or 「删掉」 (hidden). Only facts that are shown (confirmed). A clinic fact takes his clinic
 * setting with it (new words: the new clinic; removed: no clinic); a removed routine fact takes its habit out of his
 * routine. Publishes profile.fact_changed.
 */
export async function changeOwnFact(store: Store, scope: SessionRow, id: string, change: { text: string } | { hidden: true }, opts: { publish?: Publisher } = {}): Promise<FactChange> {
  const pub = opts.publish ?? defaultPublish;
  const fact = (await store.listProfileFacts(scope.id)).find((f) => f.id === id);
  if (!fact) return { ok: false, status: 404, error: "not_found" };
  if (!isShown(fact)) return { ok: false, status: 409, error: fact.hidden ? "hidden" : "not_pending" };
  const patch = "text" in change ? { text: cleanFactText(change.text) } : { hidden: true };
  const row = await store.updateProfileFact(scope.id, id, patch);
  let next = scope;
  if (isAccount(scope)) {
    let settings: ScopeSettings | null = null;
    if (fact.kind === "clinic" && scopeClinic(scope) === fact.text) settings = { clinic: row.hidden === true ? null : row.text };
    const entry = fact.kind === "routine" ? factEntry(fact) : null;
    if (entry && row.hidden === true && scopeRoutine(scope).some((r) => sameEntry(r, entry))) settings = { routine: scopeRoutine(scope).filter((r) => !sameEntry(r, entry)) };
    if (settings) next = await store.updateScope(scope.id, { settings });
  }
  pub(scope.id, "profile.fact_changed", `He changed a ${row.kind} fact in his profile.`, { fact: factEvent(row) });
  return { ok: true, fact: row, scope: next };
}

/**
 * Bring the clinic and routine facts in step with his settings, after he (or his 对 to a family member's fact) changed
 * them. For his clinic and for each routine entry there is exactly one shown fact: one that says the same is kept,
 * whoever wrote it (「本人确认（女儿写的）」 stays so); one the settings no longer say is hidden (kept for the record);
 * what the settings say and no fact does is written as his own (source patient, confirmed as he writes it).
 * An account's own space only. Returns the facts written.
 */
export async function syncSettingFacts(store: Store, scope: SessionRow, opts: { publish?: Publisher } = {}): Promise<ProfileFactRow[]> {
  if (!isAccount(scope)) return [];
  const pub = opts.publish ?? defaultPublish;
  const shown = (await store.listProfileFacts(scope.id)).filter(isShown);
  const added: ProfileFactRow[] = [];
  const hide = async (f: ProfileFactRow) => {
    const row = await store.updateProfileFact(scope.id, f.id, { hidden: true });
    pub(scope.id, "profile.fact_changed", `A ${row.kind} fact no longer matches his settings and was put away.`, { fact: factEvent(row) });
  };

  const clinic = scopeClinic(scope);
  let clinicKept = false;
  for (const f of shown.filter((x) => x.kind === "clinic")) {
    if (clinic !== null && f.text === clinic && !clinicKept) clinicKept = true;
    else await hide(f);
  }
  if (clinic !== null && !clinicKept) added.push(await addFact(store, scope, { kind: "clinic", text: clinic }, { kind: "patient" }, { publish: pub }));

  const routine = scopeRoutine(scope);
  const said = new Set<number>();
  for (const f of shown.filter((x) => x.kind === "routine")) {
    const entry = factEntry(f);
    const i = entry ? routine.findIndex((r, n) => !said.has(n) && sameEntry(r, entry)) : -1;
    if (i >= 0) said.add(i);
    else await hide(f);
  }
  for (const [n, entry] of routine.entries()) {
    if (said.has(n)) continue;
    added.push(await addFact(store, scope, { kind: "routine", text: routineFactText(entry), data: { entry } }, { kind: "patient" }, { publish: pub }));
  }
  return added;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** His clinic as the app uses it (settings), for pages that show it next to the facts. */
export function clinicOf(scope: SessionRow): string | null {
  return scopeClinic(scope);
}
