/**
 * His consent to AI processing, asked on a family member's read (owner's decision of 2026-10-14: the long press is on
 * the family side too, app/api/explain). Server-only.
 *
 * When she holds one of his records, one model call may write the sentence at the top of the sheet. The gate is his:
 * whether HE agreed to AI processing (lib/safety/consent.ts aiConsent), as it stands now. His consent records are his
 * own rows, and her scoped store hands a person only her own (lib/subject/scoped-store.ts: a user rule), so her route
 * cannot read them through it. It asks here, and this is all it can ask: one yes or no about the owner of the scope her
 * link opens. No record leaves this module, and nothing else of his account is reachable through it. Built like the
 * usage counters' way in (lib/subject/usage.ts).
 */
import { aiConsent } from "@/lib/safety/consent";
import { getStore } from "@/lib/store";
import type { SessionRow, Store } from "@/lib/store/types";
import { ScopeViolation } from "./scoped-store";

const ALLOWED = new Set(["listConsentRecords"]);

function consentReads(base: Store): Store {
  return new Proxy(base, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || typeof value !== "function") return value;
      if (!ALLOWED.has(prop)) {
        return () => {
          throw new ScopeViolation(prop, "is not part of reading his consent to AI processing");
        };
      }
      return (...args: unknown[]) => (value as (...a: unknown[]) => unknown).apply(target, args);
    },
  }) as Store;
}

/**
 * Has the person this scope belongs to agreed to AI processing, as it stands now? For a route that reads his space
 * through a family member's active link (the scope is the one her link resolved to: lib/subject requireSubject).
 * `base`: tests; default the process-wide store.
 */
export function patientAiConsent(scope: Pick<SessionRow, "kind" | "owner_user_id">, base: Store = getStore()): Promise<boolean> {
  return aiConsent(consentReads(base), scope);
}
