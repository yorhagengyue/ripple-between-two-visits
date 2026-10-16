/**
 * The phone's to-send list (C2 track O; real-app 2.25 没网时: 「吃药、记血压先存进手机上的待发清单，界面马上显示『已记下（等连网）』，
 * 连上后按顺序补发。吃药按『药、日子、格子』覆盖写，血压用手机生成的 uuid 当编号，所以重发不会多出一行。」). Pure: the storage, the
 * sender and nothing else are handed in, so the rules are tested without a browser (tests/unit/offline/outbox.test.ts).
 * The browser's side (localStorage, the network, the lock between tabs) is lib/offline/client.ts.
 *
 * Rules:
 *   order        entries are sent in the order he tapped. A newer unsent answer for the same medicine, day and slot
 *                replaces the older one in the list: the same result as sending both in order, since the server
 *                overwrites that cell.
 *   his time     every entry carries `at`, the moment he tapped; the server records that moment (lib/offline/tap.ts).
 *   resend       sending an entry twice is harmless (the cell is overwritten with the same answer; a reading's uuid
 *                finds its row), so an entry leaves the list only once the server has answered 2xx.
 *   no network   no answer, or 408 / 429 / 502 / 503 / 504: the entry waits and the flush stops there (what is behind
 *                it would fail the same way, and order is kept).
 *   signed out   401: the entry waits; the page sends him to the login and the list goes out when he is back.
 *   refused      any other 4xx: the entry stays in the list as refused, with the server's reason, until he puts it away
 *                himself. Never dropped silently. A 500 that repeats five times is treated the same way (it would
 *                otherwise hold up everything behind it for ever).
 *   whose        every entry is tagged with the account that tapped it (lib/offline/owner.ts). Only that account's
 *                entries are listed or sent; another account's stay where they are, unseen and unsent, until their own
 *                account is back or someone logs out of this phone (which clears everything: lib/offline/forget.ts).
 */

export type OutboxKind = "dose" | "bp";

/** What the list shows for an entry: no medicine name, only the part of the day (as on the lock screen). */
export type OutboxLabel =
  | { kind: "dose"; slot: string; state: "taken" | "missed" | "unconfirmed"; reason: string | null }
  | { kind: "bp"; systolic: number | null; diastolic: number | null; pulse: number | null };

export interface OutboxEntry {
  /** made on the phone; a reading's own id */
  id: string;
  /** the account that tapped it (opaque tag) */
  owner: string;
  kind: OutboxKind;
  /** what a newer entry replaces: dose:<medicine>:<date>:<slot>; a reading is only ever itself (bp:<uuid>) */
  key: string;
  /** when he tapped, ISO, on the account's clock */
  at: string;
  /** the request body, without `at` */
  body: Record<string, unknown>;
  label: OutboxLabel;
  state: "waiting" | "refused";
  /** why the server refused it (its error code) */
  why: string | null;
  /** answers that were a server error so far */
  tries: number;
}

export interface OutboxStorage {
  read(): string | null;
  write(value: string | null): void;
}

export interface SendResult {
  /** the HTTP status; 0 when no answer came (no network, timed out) */
  status: number;
  /** the server's error code, when it gave one */
  code?: string | null;
}

export type Sender = (entry: OutboxEntry) => Promise<SendResult>;

export interface FlushReport {
  sent: OutboxEntry[];
  refused: OutboxEntry[];
  /** why the flush stopped before the end of the list; null when it reached the end */
  stopped: "no_network" | "signed_out" | "other_account" | "server_error" | null;
  /** this account's entries still waiting */
  waiting: number;
}

export const OUTBOX_LIMIT = 200;
const SERVER_ERROR_TRIES = 5;

function isEntry(v: unknown): v is OutboxEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Partial<OutboxEntry>;
  return (
    typeof e.id === "string" &&
    typeof e.owner === "string" &&
    (e.kind === "dose" || e.kind === "bp") &&
    typeof e.key === "string" &&
    typeof e.at === "string" &&
    !!e.body &&
    typeof e.body === "object" &&
    !!e.label &&
    (e.state === "waiting" || e.state === "refused")
  );
}

/** Every entry on the phone, whoever tapped it, in order. A list that cannot be read counts as empty. */
export function readAll(storage: OutboxStorage): OutboxEntry[] {
  let raw: string | null = null;
  try {
    raw = storage.read();
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

function writeAll(storage: OutboxStorage, entries: OutboxEntry[]): boolean {
  try {
    storage.write(entries.length ? JSON.stringify(entries) : null);
    return true;
  } catch {
    return false;
  }
}

/** What this account sees: its own entries, waiting and refused, in the order he tapped. */
export function mine(storage: OutboxStorage, owner: string | null): OutboxEntry[] {
  if (!owner) return [];
  return readAll(storage).filter((e) => e.owner === owner);
}

export type NewEntry = Pick<OutboxEntry, "id" | "owner" | "kind" | "key" | "at" | "body" | "label">;

/**
 * Keep an entry. An unsent entry of the same account with the same key is replaced (the list then holds his latest answer
 * for that cell, at the end). False when the phone cannot keep it (storage refused, or the list is full): the caller then
 * says it was not recorded.
 */
export function add(storage: OutboxStorage, entry: NewEntry): boolean {
  if (!entry.owner) return false;
  const all = readAll(storage).filter((e) => !(e.owner === entry.owner && e.key === entry.key && e.state === "waiting"));
  if (all.length >= OUTBOX_LIMIT) return false;
  all.push({ ...entry, state: "waiting", why: null, tries: 0 });
  if (!writeAll(storage, all)) return false;
  return readAll(storage).some((e) => e.id === entry.id);
}

/** Take one of this account's entries out (his undo of an answer not sent yet; putting a refused one away). */
export function remove(storage: OutboxStorage, owner: string | null, id: string): boolean {
  if (!owner) return false;
  const all = readAll(storage);
  const next = all.filter((e) => !(e.owner === owner && e.id === id));
  if (next.length === all.length) return false;
  return writeAll(storage, next);
}

/** Everything goes, every account's (logging out of this phone). */
export function clear(storage: OutboxStorage): void {
  try {
    storage.write(null);
  } catch {
    // nothing can be written: nothing was kept either
  }
}

function update(storage: OutboxStorage, id: string, patch: Partial<OutboxEntry> | null): void {
  const all = readAll(storage);
  const next = patch === null ? all.filter((e) => e.id !== id) : all.map((e) => (e.id === id ? { ...e, ...patch } : e));
  writeAll(storage, next);
}

const WAIT_STATUSES = new Set([0, 408, 429, 502, 503, 504]);

/**
 * Send this account's waiting entries, in order. The list is read again before every send, so an entry another tab sent,
 * replaced or removed meanwhile is not sent from here.
 */
export async function flush(storage: OutboxStorage, owner: string | null, send: Sender): Promise<FlushReport> {
  const report: FlushReport = { sent: [], refused: [], stopped: null, waiting: 0 };
  if (!owner) return report;
  const queue = mine(storage, owner).filter((e) => e.state === "waiting").map((e) => e.id);
  for (const id of queue) {
    const entry = readAll(storage).find((e) => e.id === id && e.owner === owner && e.state === "waiting");
    if (!entry) continue;
    let result: SendResult;
    try {
      result = await send(entry);
    } catch {
      result = { status: 0 };
    }
    const { status } = result;
    const code = result.code ?? null;
    if (status >= 200 && status < 300) {
      update(storage, id, null);
      report.sent.push(entry);
      continue;
    }
    if (WAIT_STATUSES.has(status)) {
      report.stopped = "no_network";
      break;
    }
    if (status === 401) {
      report.stopped = "signed_out";
      break;
    }
    if (code === "other_account") {
      // the phone is signed in to another account than this page was drawn for: nothing of this list goes out
      report.stopped = "other_account";
      break;
    }
    if (status >= 500) {
      const tries = entry.tries + 1;
      if (tries < SERVER_ERROR_TRIES) {
        update(storage, id, { tries });
        report.stopped = "server_error";
        break;
      }
      update(storage, id, { state: "refused", why: code ?? "server_error", tries });
      report.refused.push({ ...entry, state: "refused", why: code ?? "server_error", tries });
      continue;
    }
    // the server understood and said no: it stays, visible, with the reason
    update(storage, id, { state: "refused", why: code ?? `http_${status}` });
    report.refused.push({ ...entry, state: "refused", why: code ?? `http_${status}` });
  }
  report.waiting = mine(storage, owner).filter((e) => e.state === "waiting").length;
  return report;
}

/** The key of a medicine answer: 药、日子、格子. */
export function doseKey(medicationId: string, cellDate: string, slot: string): string {
  return `dose:${medicationId}:${cellDate}:${slot}`;
}
