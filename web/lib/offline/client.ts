/**
 * The browser's side of the to-send list (C2 track O; real-app 2.25). Client only. The rules are lib/offline/outbox.ts;
 * here are the phone's storage, the network, the clock and the one flusher.
 *
 *   sendDose / sendBp   one try straight to the server, exactly as the pages always did (so nothing changes while there
 *                       is a network). No answer (no network, a timeout, 408 / 429 / 502 / 503 / 504) or a sign-in that
 *                       ended (401, or 400 no_session once its cookies are gone): the entry goes into the list with the
 *                       moment he tapped (a sign-in that ended also sends the page to /login?next=), and the page says
 *                       「已记下（等连网）」. Any other refusal is the page's ordinary failure.
 *   flushOutbox         this account's entries, in order, each with `at` and the owner tag. One flush at a time on the
 *                       phone (a Web Lock between tabs, a shared promise inside one). Called by
 *                       components/offline/OfflineProvider when a page opens, when the network is back, when the app
 *                       comes to the front, and every 20 s while something waits.
 *   tapNow              the phone's clock, anchored on the server's at the last page render: a phone with the wrong time,
 *                       the developer test clock and a filming account's offset all end up on the account's own clock.
 *
 * What is kept in localStorage: the list (rp_outbox_v1), the owner tag of the account last seen on this phone
 * (rp_outbox_owner, for the offline shell's count) and the clock anchor (rp_outbox_clock). Logging out clears all of it
 * (lib/offline/forget.ts).
 */
import { refreshSignIn, sendToLogin } from "@/lib/session/client";
import { add, doseKey, flush, mine, readAll, remove, type FlushReport, type OutboxEntry, type OutboxStorage } from "./outbox";
import { cellWhen, OUTBOX_OWNER_HEADER } from "./tap";

export const LIST_KEY = "rp_outbox_v1";
export const OWNER_KEY = "rp_outbox_owner";
export const CLOCK_KEY = "rp_outbox_clock";
/** Fired on window whenever the list changed in this tab (other tabs hear the browser's own `storage` event). */
export const OUTBOX_EVENT = "rp:outbox";
const LOCK = "rp-outbox";
const TIMEOUT_MS = 10_000;

function ls(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The list in this phone's localStorage. A browser that refuses storage keeps nothing: the pages then fail as before. */
export const phoneStorage: OutboxStorage = {
  read: () => ls()?.getItem(LIST_KEY) ?? null,
  write: (value) => {
    const s = ls();
    if (!s) throw new Error("no storage");
    if (value === null) s.removeItem(LIST_KEY);
    else s.setItem(LIST_KEY, value);
  },
};

function changed(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OUTBOX_EVENT));
}

/** The browser itself says there is no network (it can still be wrong the other way: "online" with nothing reachable). */
export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

// ---- the clock

let clockOffsetMs: number | null = null;

/** Called with the server's now for this account at each page render. */
export function anchorClock(serverNowMs: number): void {
  clockOffsetMs = Math.round(serverNowMs - Date.now());
  try {
    ls()?.setItem(CLOCK_KEY, String(clockOffsetMs));
  } catch {
    // not kept: this page still has it
  }
}

/** Now, on the account's clock. */
export function tapNow(): number {
  if (clockOffsetMs === null) {
    const kept = Number(ls()?.getItem(CLOCK_KEY));
    clockOffsetMs = Number.isFinite(kept) ? kept : 0;
  }
  return Date.now() + clockOffsetMs;
}

/** The account this phone was last drawn for (the offline shell counts its entries). */
export function rememberOwner(owner: string | null): void {
  try {
    if (owner) ls()?.setItem(OWNER_KEY, owner);
  } catch {
    // not kept
  }
}

export function uuid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(16).padStart(8, "0").slice(-8)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`;
}

// ---- the network

interface Answer<T> {
  /** 0: no answer */
  status: number;
  code: string | null;
  json: T | null;
}

async function once<T>(path: string, body: unknown, owner: string | null): Promise<Answer<T>> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(owner ? { [OUTBOX_OWNER_HEADER]: owner } : {}) },
      body: JSON.stringify(body),
      credentials: "same-origin",
      signal: ctl.signal,
    });
    const json = (await res.json().catch(() => null)) as (T & { error?: unknown }) | null;
    const code = typeof json?.error === "string" ? json.error : null;
    // these calls only come from an account's own pages: "no session at all" (the sign-in cookies are already gone)
    // is the same thing as 401 not_signed_in here
    if (res.status === 400 && code === "no_session") return { status: 401, code: "not_signed_in", json: null };
    return { status: res.status, code, json: res.ok ? json : null };
  } catch {
    return { status: 0, code: null, json: null };
  } finally {
    clearTimeout(timer);
  }
}

/** One POST; a sign-in that only needed renewing is renewed once and the call tried again (lib/session/client.ts). */
async function post<T>(path: string, body: unknown, owner: string | null): Promise<Answer<T>> {
  let a = await once<T>(path, body, owner);
  if (a.status === 401 && a.code === "not_signed_in" && (await refreshSignIn())) a = await once<T>(path, body, owner);
  return a;
}

const WAITS = new Set([0, 408, 429, 502, 503, 504]);

export interface OfflineKit {
  /** the signed-in account's tag; null where no account page drew this (the demo, the design gallery): nothing is kept */
  owner: string | null;
}

export type Outcome<T> =
  | { kind: "sent"; json: T }
  /** kept on the phone: `at` is the moment he tapped (ISO), `id` the entry's */
  | { kind: "queued"; at: string; id: string }
  /** the server said no (status), or the phone could not keep it (status 0) */
  | { kind: "failed"; status: number };

function keep(entry: Parameters<typeof add>[1], signedOut: boolean): Outcome<never> {
  if (!add(phoneStorage, entry)) return { kind: "failed", status: 0 };
  changed();
  if (signedOut) sendToLogin();
  return { kind: "queued", at: entry.at, id: entry.id };
}

export interface DoseCellRef {
  medicationId: string;
  slot: string;
  when: "today" | "yesterday";
  /** the cell's date as the page showed it, YYYY-MM-DD */
  date: string;
  tz: string;
}

export interface DoseAnswerBody {
  state: "taken" | "missed" | "unconfirmed";
  reason: string | null;
  reason_text: string | null;
}

/** His answer for one medicine in one slot: to the server, or into the list when the server cannot be reached. */
export async function sendDose(kit: OfflineKit, cell: DoseCellRef, a: DoseAnswerBody): Promise<Outcome<{ dose?: { created_at?: string } | null }>> {
  const tapMs = tapNow();
  const answer = { medication_id: cell.medicationId, slot: cell.slot, state: a.state, reason: a.reason, reason_text: a.reason_text };
  let status = 0;
  if (!isOffline()) {
    const r = await post<{ dose?: { created_at?: string } | null }>("/api/doses", { ...answer, ...(cell.when === "yesterday" ? { when: "yesterday" } : {}) }, null);
    if (r.status >= 200 && r.status < 300) return { kind: "sent", json: r.json ?? ({} as never) };
    status = r.status;
    if (!WAITS.has(status) && status !== 401) return { kind: "failed", status };
  }
  // 「昨天」 is counted from the tap, not from the page (a page left open over midnight)
  const when = cellWhen(cell.date, tapMs, cell.tz);
  if (!kit.owner || !when) return { kind: "failed", status };
  return keep(
    {
      id: uuid(),
      owner: kit.owner,
      kind: "dose",
      key: doseKey(cell.medicationId, cell.date, cell.slot),
      at: new Date(tapMs).toISOString(),
      body: { ...answer, ...(when === "yesterday" ? { when } : {}) },
      label: { kind: "dose", slot: cell.slot, state: a.state, reason: null },
    },
    status === 401,
  );
}

export interface BpEntryBody {
  /** the uuid the page made: the direct try and the kept entry share it */
  id: string;
  systolic?: number;
  diastolic?: number;
  pulse?: number | null;
  state?: "unconfirmed";
}

/** A reading (or 「这次没量」): to the server, or into the list when the server cannot be reached. */
export async function sendBp<T>(kit: OfflineKit, b: BpEntryBody): Promise<Outcome<T>> {
  const tapMs = tapNow();
  const body: Record<string, unknown> = b.state === "unconfirmed" ? { id: b.id, state: "unconfirmed" } : { id: b.id, systolic: b.systolic, diastolic: b.diastolic, ...(b.pulse ? { pulse: b.pulse } : {}) };
  let status = 0;
  if (!isOffline()) {
    const r = await post<T>("/api/bp", body, null);
    if (r.status >= 200 && r.status < 300) return { kind: "sent", json: r.json ?? ({} as never) };
    status = r.status;
    if (!WAITS.has(status) && status !== 401) return { kind: "failed", status };
  }
  if (!kit.owner) return { kind: "failed", status };
  return keep(
    {
      id: b.id,
      owner: kit.owner,
      kind: "bp",
      key: `bp:${b.id}`,
      at: new Date(tapMs).toISOString(),
      body,
      label: { kind: "bp", systolic: b.state === "unconfirmed" ? null : (b.systolic ?? null), diastolic: b.state === "unconfirmed" ? null : (b.diastolic ?? null), pulse: b.state === "unconfirmed" ? null : (b.pulse ?? null) },
    },
    status === 401,
  );
}

/** Take one of his entries out of the list (undo of an answer that never left the phone; putting a refused one away). */
export function takeOut(kit: OfflineKit, id: string): boolean {
  const ok = remove(phoneStorage, kit.owner, id);
  if (ok) changed();
  return ok;
}

/** His waiting answer for a cell, if it is still on the phone. */
export function waitingDose(kit: OfflineKit, cell: Pick<DoseCellRef, "medicationId" | "slot" | "date">): OutboxEntry | null {
  const key = doseKey(cell.medicationId, cell.date, cell.slot);
  return mine(phoneStorage, kit.owner).find((e) => e.key === key && e.state === "waiting") ?? null;
}

// ---- the flusher

const NOTHING: FlushReport = { sent: [], refused: [], stopped: null, waiting: 0 };
let running: Promise<FlushReport> | null = null;

function sender(owner: string) {
  return async (entry: OutboxEntry) => {
    const r = await post<unknown>(entry.kind === "dose" ? "/api/doses" : "/api/bp", { ...entry.body, at: entry.at }, owner);
    return { status: r.status, code: r.code };
  };
}

/**
 * Send what waits for this account. Never throws. A sign-in that ended sends the page to the login (the list stays and
 * goes out when he is back).
 */
export function flushOutbox(kit: OfflineKit): Promise<FlushReport> {
  const owner = kit.owner;
  if (!owner || typeof window === "undefined" || isOffline()) return Promise.resolve(NOTHING);
  if (!mine(phoneStorage, owner).some((e) => e.state === "waiting")) return Promise.resolve(NOTHING);
  running ??= (async () => {
    const work = () => flush(phoneStorage, owner, sender(owner));
    let report: FlushReport | null;
    try {
      const locks = (navigator as Navigator & { locks?: LockManager }).locks;
      // another tab is already sending: leave it to that one (its changes arrive here as storage events)
      report = locks ? await locks.request(LOCK, { ifAvailable: true }, (lock) => (lock ? work() : null)) : await work();
    } catch {
      report = null;
    }
    const out = report ?? { ...NOTHING, waiting: mine(phoneStorage, owner).filter((e) => e.state === "waiting").length };
    if (out.sent.length || out.refused.length) changed();
    if (out.stopped === "signed_out") sendToLogin();
    return out;
  })().finally(() => {
    running = null;
  });
  return running;
}

/** How many entries wait on this phone for the account it was last drawn for (any page, the shell included). */
export function waitingCount(owner: string | null): number {
  return readAll(phoneStorage).filter((e) => e.owner === owner && e.state === "waiting").length;
}

/** router.refresh() needs the network: without one Next falls back to a full page load, which would lose the open page. */
export function refreshWhenOnline(router: { refresh(): void }): void {
  if (!isOffline()) return router.refresh();
  window.addEventListener("online", () => router.refresh(), { once: true });
}
