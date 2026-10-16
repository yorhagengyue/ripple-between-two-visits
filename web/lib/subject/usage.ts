/**
 * The usage counters' way to the store (C2 track S, round 2; real-app 3.5 rows 「问一句，每人」 and 「DeepSeek 花费，每人」).
 * Server-only.
 *
 * Rate-limit buckets belong to no scope, so a scoped store refuses them (lib/subject/scoped-store.ts: "global"). The ask
 * path counts a person's questions, model tokens and model spend in those buckets (lib/safety/cost-guard.ts
 * StoreCostGuard), and comes here for exactly three methods of the process-wide store and nothing else: the hit, the
 * summed hit, and reading a bucket without counting. Built like lib/subject/care.ts and entry.ts. (Track L's
 * lib/subject/limits.ts limitStore() is the same idea for its own rows; the two can become one once both are merged.)
 */
import { PersonSpend, usagePerson } from "@/lib/llm/person-spend";
import { getStore } from "@/lib/store";
import type { SessionRow, Store } from "@/lib/store/types";
import { ScopeViolation } from "./scoped-store";

/** The methods a usage counter may use. */
export type UsageStore = Pick<Store, "rateHit" | "rateAdd" | "getRateWindow">;

const ALLOWED = new Set(["rateHit", "rateAdd", "getRateWindow"]);

/** The narrow usage store over a given store (tests) or the process-wide one. */
export function usageStore(base: Store = getStore()): UsageStore {
  return new Proxy(base, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || typeof value !== "function") return value;
      if (!ALLOWED.has(prop)) {
        return () => {
          throw new ScopeViolation(prop, "is not part of the usage counters' way in");
        };
      }
      return (...args: unknown[]) => (value as (...a: unknown[]) => unknown).apply(target, args);
    },
  }) as UsageStore;
}

/**
 * One person's model spend today, for a piece of model work done for them outside an ask (a translation, a visit's
 * labelling): ask capped() before the first call, wrap() the client, settle() at the end (lib/llm/person-spend.ts).
 */
export function personSpendFor(scope: Pick<SessionRow, "id"> & Partial<Pick<SessionRow, "kind" | "owner_user_id" | "tz" | "filming" | "clock_offset_ms">>): PersonSpend {
  return new PersonSpend(usageStore(), usagePerson(scope));
}
