/**
 * Everything the memory store holds of one person, as one string (C2 track G's guard tests): the whole of their space
 * (every per-scope table), and every account-level row that names them (the account, links, switches, consents, events,
 * devices, push subscriptions, deliveries). Two snapshots that are equal mean nothing of theirs was written, moved or
 * deleted in between, in any table, including tables added later: the store's own fields are walked, none is named here.
 *
 * Left out on purpose: rate-limit buckets, job leases and job runs (they belong to nobody and change by themselves).
 * Reads the store's private fields, so it is for tests only and for the memory store only.
 */
import type { MemoryStore } from "@/lib/store/memory";

const SKIP = new Set(["rateLimits", "jobLeases", "opsRuns"]);

const plain = (_key: string, value: unknown): unknown => (value instanceof Map ? [...value.entries()] : value instanceof Set ? [...value.values()] : value);

export function everythingOf(store: MemoryStore, userId: string): string {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(store as unknown as Record<string, unknown>)) {
    if (SKIP.has(name) || typeof value === "function") continue;
    if (value instanceof Map) {
      const rows = [...value.entries()].filter(([k, v]) => k === userId || JSON.stringify(v, plain).includes(userId));
      if (rows.length) out[name] = rows;
    } else if (Array.isArray(value)) {
      const rows = value.filter((v) => JSON.stringify(v, plain).includes(userId));
      if (rows.length) out[name] = rows;
    }
  }
  return JSON.stringify(out, plain);
}

/**
 * Empty every rate-limit bucket of the store: a scan is not a person. The crew key's wrong tries are among them (two
 * buckets per client, lib/session/crew-key.ts), when `store` is the process-wide one the routes count in.
 */
export function resetAllLimits(store: MemoryStore): void {
  (store as unknown as { rateLimits: Map<string, unknown> }).rateLimits.clear();
}
