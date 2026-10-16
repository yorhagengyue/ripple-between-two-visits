/**
 * Store entry point. Server-only (route handlers, server components, scripts).
 *
 *   import { getStore } from "@/lib/store";
 *   const store = getStore();
 *   const session = await store.getSession(id);
 *
 * STORE=memory (default) -> in-process store on globalThis (lib/store/memory.ts): one always-on server.
 * STORE=supabase         -> lib/store/supabase.ts over PostgREST (SUPABASE_URL + SUPABASE_SERVICE_KEY),
 *                           for serverless hosting with several instances; the schema comes from
 *                           web/supabase/migrations (node scripts/db/migrate.mjs). Without the URL and
 *                           key it fails loudly (StoreError not_configured), never falls back to memory.
 * C2 track D (only add): STORE=memory on a developer's server with RIPPLE_SLOW_STORE_MS=<ms> hands out the same memory
 * store with every call that much later (lib/store/slow.ts), to see offline what a database a round trip away does to
 * a request that makes many calls in a row. Never on a real deployment, never with STORE=supabase.
 */
import { getMemoryStore } from "./memory";
import { devSlowMs, slowStore } from "./slow";
import { getSupabaseStore } from "./supabase";
import { StoreError, type Store } from "./types";

export type StoreKind = "memory" | "supabase";

export function storeKind(env: Record<string, string | undefined> = process.env): StoreKind {
  const raw = (env.STORE ?? "").trim().toLowerCase();
  if (raw === "" || raw === "memory") return "memory";
  if (raw === "supabase") return "supabase";
  throw new StoreError("invalid", `Unknown STORE=${env.STORE}; use memory or supabase`);
}

type GlobalWithSlow = typeof globalThis & { __rippleSlowStore?: { ms: number; base: Store; store: Store } };

/** C2 track D (only add): the developer's slow memory store (RIPPLE_SLOW_STORE_MS), or null. */
function slowMemoryStore(): Store | null {
  const ms = devSlowMs();
  if (!ms) return null;
  const base = getMemoryStore();
  const g = globalThis as GlobalWithSlow;
  if (!g.__rippleSlowStore || g.__rippleSlowStore.ms !== ms || g.__rippleSlowStore.base !== base) g.__rippleSlowStore = { ms, base, store: slowStore<Store>(base, () => ms) };
  return g.__rippleSlowStore.store;
}

export function getStore(): Store {
  if (storeKind() === "supabase") return getSupabaseStore();
  return slowMemoryStore() ?? getMemoryStore();
}

export { createSupabaseStore, supabaseStoreConfig } from "./supabase";
export * from "./types";
