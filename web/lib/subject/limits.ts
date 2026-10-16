/**
 * The limits' way to the store (C2 track L; the rows and the counting are lib/guard/limits.ts). Server-only.
 *
 * Rate-limit buckets belong to no scope, so a scoped store refuses them (lib/subject/scoped-store.ts: "global"). The
 * routes that count against one of track L's rows come here, and get exactly three methods (the hit, the summed hit,
 * forgetting a bucket) and nothing else of the process-wide store, the way lib/subject/care.ts and entry.ts do.
 *
 *   const over = await limitByIp(req, "demoSandbox");                      // per address (lib/guard/client-ip.ts)
 *   const over = await limitByPerson(found.subject, "labelRead");          // per person
 *   const over = await limitByPerson(found.subject, "captionAudio", 12);   // per person, counting an amount
 *   if (over) return over;                                                 // 429 { error: "too_many", limit, until }, Retry-After
 *
 * The film crew's wrong-key count (lib/session/crew-key.ts) lives in the same buckets and comes here the same way:
 * crewAttemptStore() gives it the hit, reading a bucket without counting, and forgetting a bucket, and nothing else.
 */
import { NextResponse, type NextRequest } from "next/server";
import { clientAddress } from "@/lib/guard/client-ip";
import { countAgainst, personKey, retryAfterS, type GuardLimit, type LimitStore, type Over } from "@/lib/guard/limits";
import type { CrewAttemptStore } from "@/lib/session/crew-key";
import { getStore } from "@/lib/store";
import type { Store } from "@/lib/store/types";
import { ScopeViolation } from "./scoped-store";

const ALLOWED = new Set(["rateHit", "rateAdd", "clearRate"]);
const CREW_ALLOWED = new Set(["rateHit", "getRateWindow", "clearRate"]);

/** The narrow limits store over a given store (tests) or the process-wide one. */
export function limitStore(base: Store = getStore()): LimitStore {
  return new Proxy(base, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || typeof value !== "function") return value;
      if (!ALLOWED.has(prop)) {
        return () => {
          throw new ScopeViolation(prop, "is not part of the limits' way in");
        };
      }
      return (...args: unknown[]) => (value as (...a: unknown[]) => unknown).apply(target, args);
    },
  }) as LimitStore;
}

/** The narrow store of the crew key's wrong-key count, over a given store (tests) or the process-wide one. */
export function crewAttemptStore(base: Store = getStore()): CrewAttemptStore {
  return new Proxy(base, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || typeof value !== "function") return value;
      if (!CREW_ALLOWED.has(prop)) {
        return () => {
          throw new ScopeViolation(prop, "is not part of the crew key count's way in");
        };
      }
      return (...args: unknown[]) => (value as (...a: unknown[]) => unknown).apply(target, args);
    },
  }) as CrewAttemptStore;
}

/** The refusal as the browser gets it: 429 with when to try again (never cached). */
export function overResponse(over: Over): NextResponse {
  const seconds = retryAfterS(over.until);
  return NextResponse.json(
    { error: "too_many", limit: over.limit, until: over.until, retry_after_ms: seconds * 1000 },
    { status: 429, headers: { "Retry-After": String(seconds), "Cache-Control": "private, no-store" } },
  );
}

/** Count this request against a per-address row; the 429 once over, else null. */
export async function limitByIp(req: NextRequest, name: GuardLimit): Promise<NextResponse | null> {
  const over = await countAgainst(limitStore(), name, clientAddress(req.headers));
  return over ? overResponse(over) : null;
}

/** Count this request (or `amount` of it) against a per-person row; the 429 once over, else null. */
export async function limitByPerson(subject: { userId: string | null; scope: { id: string } }, name: GuardLimit, amount?: number): Promise<NextResponse | null> {
  const over = await countAgainst(limitStore(), name, personKey(subject), amount === undefined ? {} : { amount });
  return over ? overResponse(over) : null;
}
